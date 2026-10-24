"""Candidate corridor search: A* over a pedestrian graph with an explicit, explainable cost.

    Cost(e) = distance(e) + w1·barrier_penalty(e) + w2·crossing_penalty(e) + w3·uncertainty_penalty(e)

Surveyed track edges are treated as observed; OSM edges and connectors are unverified and carry an uncertainty
penalty, so unknown segments are never silently treated as accessible. Weights are configuration values that
need stakeholder review and field validation.
"""
import math
from dataclasses import dataclass, field

import networkx as nx

from .geo import bearing, haversine, point_segment_distance, polyline_length


@dataclass
class Weights:
    barrier: float = 60.0       # metres-equivalent per barrier near the edge
    crossing: float = 25.0      # metres-equivalent per crossing edge
    uncertainty: float = 0.6    # multiplier on unverified distance
    barrier_buffer_m: float = 4.0
    exclude_impassable: bool = False


@dataclass
class Barrier:
    lat: float
    lon: float
    label: str
    source: str
    verified: bool = True
    impassable: bool = False


@dataclass
class GraphInputs:
    track: list[tuple[float, float]]
    crossings: list[tuple[float, float]] = field(default_factory=list)
    barriers: list[Barrier] = field(default_factory=list)
    osm: dict | None = None


class NoPathError(ValueError):
    pass


def build_graph(inp: GraphInputs, w: Weights) -> nx.Graph:
    g = nx.Graph()

    def add_edge(u, v, a, b, source, verified, crossing=False, uncertainty=0.0, tags=None):
        d = haversine(*a, *b)
        if d < 0.05:
            return
        near = [br for br in inp.barriers if point_segment_distance((br.lat, br.lon), a, b) <= w.barrier_buffer_m]
        if w.exclude_impassable and any(br.impassable for br in near):
            return
        barrier_units = sum(1.0 if br.verified else 0.5 for br in near)
        crossing = crossing or any(point_segment_distance(c, a, b) <= 6.0 for c in inp.crossings)
        costs = {"distance": d, "barrier": w.barrier * barrier_units, "crossing": w.crossing if crossing else 0.0,
                 "uncertainty": w.uncertainty * uncertainty * d}
        g.add_edge(u, v, weight=sum(costs.values()), costs=costs, length=d, source=source, verified=verified,
                   crossing=crossing, barriers=[br.label for br in near], tags=tags or {})

    for i, p in enumerate(inp.track):
        g.add_node(f"t{i}", pos=p)
    for i in range(len(inp.track) - 1):
        add_edge(f"t{i}", f"t{i + 1}", inp.track[i], inp.track[i + 1], "survey", True)

    if inp.osm:
        nodes = {e["id"]: (e["lat"], e["lon"]) for e in inp.osm.get("elements", []) if e["type"] == "node"}
        for way in (e for e in inp.osm.get("elements", []) if e["type"] == "way"):
            tags = way.get("tags", {})
            is_crossing = tags.get("footway") == "crossing" or tags.get("highway") == "crossing"
            tactile = tags.get("tactile_paving") == "yes"
            unc = 0.5 if tactile else 1.0
            ids = [n for n in way.get("nodes", []) if n in nodes]
            for a, b in zip(ids, ids[1:]):
                g.add_node(f"o{a}", pos=nodes[a])
                g.add_node(f"o{b}", pos=nodes[b])
                add_edge(f"o{a}", f"o{b}", nodes[a], nodes[b], "osm", False, is_crossing, unc,
                         {k: tags[k] for k in ("highway", "footway", "tactile_paving", "surface") if k in tags})
        osm_nodes = [n for n in g.nodes if n.startswith("o")]
        for t in [n for n in g.nodes if n.startswith("t")]:
            tp = g.nodes[t]["pos"]
            best = min(osm_nodes, key=lambda n: haversine(*tp, *g.nodes[n]["pos"]), default=None)
            if best and haversine(*tp, *g.nodes[best]["pos"]) <= 20:
                add_edge(t, best, tp, g.nodes[best]["pos"], "connector", False, uncertainty=1.0)
    return g


def nearest_node(g: nx.Graph, p: tuple[float, float]) -> tuple[str, float]:
    best = min(g.nodes, key=lambda n: haversine(*p, *g.nodes[n]["pos"]))
    return best, haversine(*p, *g.nodes[best]["pos"])


def count_turns(points: list[tuple[float, float]], min_angle: float = 35.0, min_leg_m: float = 3.0) -> int:
    pts = [points[0]] if points else []
    for p in points[1:]:
        if haversine(*pts[-1], *p) >= min_leg_m:
            pts.append(p)
    turns = 0
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        diff = abs((bearing(b, c) - bearing(a, b) + 180) % 360 - 180)
        turns += diff >= min_angle
    return turns


def candidate_routes(g: nx.Graph, start: tuple[float, float], end: tuple[float, float], w: Weights, k: int = 3) -> list[dict]:
    if g.number_of_edges() == 0:
        raise NoPathError("No pedestrian network: record a survey track or enable OpenStreetMap context")
    s, ds = nearest_node(g, start)
    t, dt = nearest_node(g, end)
    if s == t:
        raise NoPathError("Start and end snap to the same point; choose points further apart")
    work = g.copy()

    def h(u, v):
        return haversine(*work.nodes[u]["pos"], *work.nodes[v]["pos"])

    results, seen = [], set()
    for _ in range(k * 2):
        try:
            path = nx.astar_path(work, s, t, heuristic=h, weight="weight")
        except nx.NetworkXNoPath:
            break
        key = tuple(path)
        if key not in seen:
            seen.add(key)
            results.append(_describe(g, path, w, ds, dt))
        for u, v in zip(path, path[1:]):
            work[u][v]["weight"] *= 1.8
        if len(results) >= k:
            break
    if not results:
        raise NoPathError("No connected path between the chosen points in the available network")
    results.sort(key=lambda r: r["score"])
    return results


def _describe(g: nx.Graph, path: list[str], w: Weights, snap_start: float, snap_end: float) -> dict:
    coords = [list(g.nodes[n]["pos"]) for n in path]
    totals = {"distance": 0.0, "barrier": 0.0, "crossing": 0.0, "uncertainty": 0.0}
    unverified = 0.0
    barriers, crossings, tactile_tagged, osm_len = [], 0, 0.0, 0.0
    for u, v in zip(path, path[1:]):
        e = g[u][v]
        for key in totals:
            totals[key] += e["costs"][key]
        if not e["verified"]:
            unverified += e["length"]
        if e["source"] == "osm":
            osm_len += e["length"]
            if e["tags"].get("tactile_paving") == "yes":
                tactile_tagged += e["length"]
        barriers += e["barriers"]
        crossings += e["crossing"]
    dist = totals["distance"]
    missing = []
    if unverified > 0:
        missing.append(f"{unverified:.0f} m of the route is not surveyed (map data or connectors only)")
    if osm_len > 0 and tactile_tagged < osm_len:
        missing.append(f"tactile_paving not tagged on {osm_len - tactile_tagged:.0f} m of map segments (unknown, not assumed present)")
    if max(snap_start, snap_end) > 15:
        missing.append(f"start/end snapped {max(snap_start, snap_end):.0f} m to the nearest network point")
    return {
        "geometry": coords,
        "distance_m": round(dist, 1),
        "score": round(sum(totals.values()), 1),
        "score_breakdown": {
            "costs": {k: round(v, 1) for k, v in totals.items()},
            "weights": {"barrier": w.barrier, "crossing": w.crossing, "uncertainty": w.uncertainty,
                        "barrier_buffer_m": w.barrier_buffer_m, "exclude_impassable": w.exclude_impassable},
            "barrier_count": len(set(barriers)), "barriers": sorted(set(barriers)),
            "crossing_count": int(crossings),
            "unverified_fraction": round(unverified / dist, 3) if dist else 0.0,
            "turns": count_turns([tuple(c) for c in coords]),
            "assumptions": [
                "Cost(e) = distance + w1·barriers + w2·crossings + w3·unverified distance",
                "Unverified and unknown segments are penalised, never assumed accessible",
                "Weights are provisional configuration values pending stakeholder review",
            ],
            "missing_data": missing,
        },
        "length_check_m": round(polyline_length([tuple(c) for c in coords]), 1),
    }


def estimate_materials(distance_m: float, crossings: int, turns: int, tile_size_m: float = 0.3,
                       strip_width_tiles: int = 1, warning_band_width_tiles: int = 3,
                       warning_band_depth_tiles: int = 2, waste_factor: float = 0.05) -> dict:
    directional = math.ceil(distance_m / tile_size_m) * strip_width_tiles
    bands = 2 + 2 * crossings + turns
    warning = bands * warning_band_width_tiles * warning_band_depth_tiles
    return {
        "tile_size_m": tile_size_m, "strip_width_tiles": strip_width_tiles,
        "warning_bands": bands, "warning_band_tiles": warning_band_width_tiles * warning_band_depth_tiles,
        "directional_tiles": math.ceil(directional * (1 + waste_factor)),
        "warning_tiles": math.ceil(warning * (1 + waste_factor)),
        "waste_factor": waste_factor,
        "note": "Planning estimate only (both route ends, both sides of each crossing, one band per turn). "
                "An engineer must verify layout and quantities on site.",
    }
