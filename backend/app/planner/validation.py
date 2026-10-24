"""Design checks. They flag problems and items for professional review; they never certify compliance.

Severities: error (the design contradicts itself, e.g. a strip through a tree), warning (likely problem),
review (needs a qualified person's judgement against the governing guideline), info.
Thresholds come from the project settings and are planning assumptions, not clause values.
"""
import math
from itertools import combinations

from ..rules.engine import references
from . import geometry as g
from .document import ENDPOINT_TYPES, HAZARD_TYPES, OBSTACLE_TYPES, Scene, merged_settings

SEVERITY_ORDER = {"error": 0, "warning": 1, "review": 2, "info": 3}
TYPE_LABEL = {"crossing": "crossing", "kerb": "kerb edge", "stairs": "stairs", "tree": "tree", "pillar": "pillar",
              "obstacle": "obstacle", "obstacle_area": "obstacle area", "entrance": "entrance", "destination": "destination"}


def _ref(rule: str) -> str | None:
    try:
        return references()["rules"][rule]["reference"]
    except Exception:  # noqa: BLE001
        return None


class _Report:
    def __init__(self, scene: Scene):
        self.scene = scene
        self.items: list[dict] = []

    def add(self, severity, code, message, at=None, ids=(), rule=None):
        self.items.append({"severity": severity, "code": code, "message": message,
                           "at": self.scene.px(at) if at is not None else None, "ids": list(ids),
                           "reference": _ref(rule) if rule else None})


def _strip_polys(scene: Scene, T: float):
    """route id -> list of convex quads (metres)."""
    return {r.id: [s.quad for s in g.strip_segments(r.pts, r.width_tiles * T)] for r in scene.routes}


def _dist_quads(quads, shape, closed) -> float:
    return min((g.shape_dist(q, True, shape, closed) for q in quads), default=math.inf)


def validate(scene: Scene, settings: dict | None = None) -> dict:
    s = merged_settings(settings)
    rep = _Report(scene)
    T = s["tile_size_mm"] / 1000
    tol = s["connect_tolerance_m"]
    if not scene.m_per_px:
        rep.add("error", "scale_missing", "The drawing has no scale. Calibrate it with a known dimension before checking or estimating.")
        return _finish(rep, s)
    if not scene.routes and not scene.warnings and not scene.tiles:
        rep.add("info", "empty_design", "No tactile route or warning area drawn yet.")
        return _finish(rep, s)

    strips = _strip_polys(scene, T)
    obstacles = [f for f in scene.features if f.type in OBSTACLE_TYPES]
    hazards = [f for f in scene.features if f.type in HAZARD_TYPES]
    footpaths = [f for f in scene.features if f.type == "footpath"]
    endpoints = [f for f in scene.features if f.type in ENDPOINT_TYPES]
    warn_shapes = [(w, w.pts) for w in scene.warnings]

    # Strip through obstacles / stairs, and clearance review.
    for r in scene.routes:
        quads = strips[r.id]
        for f in obstacles + [h for h in hazards if h.type == "stairs"]:
            shape, closed = f.shape(g.circle)
            d = _dist_quads(quads, shape, closed)
            name = f.label or TYPE_LABEL[f.type]
            if d <= 1e-6:
                if f.type == "stairs":
                    rep.add("error", "route_over_stairs", f"Route {r.label or r.id} runs onto {name}. Guide strips should "
                            "lead to a warning area at the top and bottom of stairs, not across them.", f.pts[0], (r.id, f.id),
                            "missing_warning_tiles")
                else:
                    rep.add("error", "route_hits_obstacle", f"Route {r.label or r.id} passes through {name}.", f.pts[0],
                            (r.id, f.id), "obstacle_on_path")
            elif f.type != "stairs" and d < s["clearance_m"]:
                rep.add("review", "low_clearance", f"Route {r.label or r.id} passes {d:.2f} m from {name} (review threshold "
                        f"{s['clearance_m']:.2f} m). Check the clear width required by the governing guideline.",
                        f.pts[0], (r.id, f.id), "obstacle_on_path")
        for w in scene.warnings:
            for f in obstacles:
                shape, closed = f.shape(g.circle)
                if g.shape_dist(w.pts, True, shape, closed) <= 1e-6:
                    rep.add("error", "warning_hits_obstacle", f"Warning area {w.label or w.id} overlaps {f.label or TYPE_LABEL[f.type]}.",
                            f.pts[0], (w.id, f.id))

    # Route leaves the marked footpath.
    if footpaths:
        for r in scene.routes:
            for q in strips[r.id]:
                outside = [p for p in q if not any(g.point_in_polygon(p, f.pts) for f in footpaths)]
                if outside:
                    rep.add("warning", "outside_footpath", f"Part of route {r.label or r.id} lies outside the marked footpath.",
                            outside[0], (r.id,))
                    break

    # Turns: sharp turns, and decision points for review.
    for r in scene.routes:
        pts = g.dedupe(r.pts)
        for i in range(1, len(pts) - 1):
            ang = g.turn_angle_deg(pts[i - 1], pts[i], pts[i + 1])
            covered = any(g.point_in_polygon(pts[i], w.pts) for w in scene.warnings)
            if ang > 90:
                rep.add("warning", "sharp_turn", f"Route {r.label or r.id} turns {ang:.0f} degrees. Turns sharper than a right "
                        "angle are hard to follow underfoot and create awkward cuts.", pts[i], (r.id,))
            elif ang >= s["turn_review_deg"] and not covered:
                rep.add("review", "turn_point", f"Route {r.label or r.id} changes direction by {ang:.0f} degrees here. Check whether "
                        "the governing guideline requires attention/warning tiles at this decision point.", pts[i], (r.id,),
                        "missing_warning_tiles")

    # Connectivity between routes, warning areas and entrances/destinations.
    ids = [r.id for r in scene.routes]
    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in combinations(scene.routes, 2):
        if min(_dist_quads(strips[a.id], q, True) for q in strips[b.id]) <= tol:
            parent[find(a.id)] = find(b.id)
            if _routes_cross(a, b):
                rep.add("review", "routes_cross", f"Routes {a.label or a.id} and {b.label or b.id} cross. A junction normally "
                        "needs an attention/warning area; check the governing guideline.", _crossing_point(a, b), (a.id, b.id))
    for w, poly in warn_shapes:
        touching = [r.id for r in scene.routes if _dist_quads(strips[r.id], poly, True) <= tol]
        for x, y in zip(touching, touching[1:]):
            parent[find(x)] = find(y)
    groups = {find(i) for i in ids}
    if len(groups) > 1:
        rep.add("warning", "disconnected", f"The tactile network has {len(groups)} separate parts that do not connect. "
                "Join them, or confirm each part is intentionally separate.", None, ids)

    for r in scene.routes:
        pts = g.dedupe(r.pts)
        for end in (pts[0], pts[-1]):
            near_route = any(o.id != r.id and _dist_quads(strips[o.id], [end], False) <= tol + r.width_tiles * T / 2
                             for o in scene.routes)
            near_warning = any(g.shape_dist(w.pts, True, [end], False) <= tol + r.width_tiles * T / 2 for w in scene.warnings)
            near_endpoint = any(g.shape_dist([f.pts[0]], False, [end], False) <= 1.0 for f in endpoints)
            if not (near_route or near_warning or near_endpoint):
                rep.add("warning", "dead_end", f"Route {r.label or r.id} ends without reaching another route, a warning area, "
                        "an entrance or a destination.", end, (r.id,), "interrupted_path")

    for f in endpoints:
        if scene.routes and all(_dist_quads(strips[r.id], [f.pts[0]], False) > 1.0 for r in scene.routes):
            rep.add("review", "endpoint_unserved", f"{(f.label or TYPE_LABEL[f.type]).capitalize()} is not reached by any tactile route.",
                    f.pts[0], (f.id,))

    # Hazards next to a route need a warning area between route and hazard.
    for h in hazards:
        shape, closed = h.shape(g.circle)
        name = h.label or TYPE_LABEL[h.type]
        near_routes = [r for r in scene.routes if _dist_quads(strips[r.id], shape, closed) <= s["hazard_approach_m"]]
        if not near_routes:
            continue
        guarded = [w for w in scene.warnings if g.shape_dist(w.pts, True, shape, closed) <= 0.5]
        if not guarded:
            rep.add("warning", "missing_warning", f"A route approaches the {name} but no warning area is marked at it. "
                    "Warning tiles are normally needed before a crossing, kerb edge or stairs.", h.pts[0],
                    (h.id, *[r.id for r in near_routes]), "missing_warning_tiles")
        elif not any(_dist_quads(strips[r.id], w.pts, True) <= tol for w in guarded for r in near_routes):
            rep.add("review", "warning_not_on_route", f"The warning area at the {name} does not meet the route that "
                    "approaches it. Check that the strip leads onto the warning area.", h.pts[0], (h.id,))

    # Warning areas: purpose, depth, overlaps.
    turn_pts = []
    for r in scene.routes:
        pts = g.dedupe(r.pts)
        turn_pts += [pts[0], pts[-1]] + [pts[i] for i in range(1, len(pts) - 1)
                                         if g.turn_angle_deg(pts[i - 1], pts[i], pts[i + 1]) >= s["turn_review_deg"]]
    for w in scene.warnings:
        near_hazard = any(g.shape_dist(w.pts, True, *h.shape(g.circle)) <= 1.0 for h in hazards)
        near_point = any(g.shape_dist(w.pts, True, [p], False) <= 0.5 for p in turn_pts)
        near_endpoint = any(g.shape_dist(w.pts, True, [f.pts[0]], False) <= 1.0 for f in endpoints)
        if not (near_hazard or near_point or near_endpoint):
            rep.add("review", "warning_without_purpose", f"Warning area {w.label or w.id} is not at a marked hazard, route end, "
                    "junction or turn. Unneeded warning tiles can mislead; confirm its purpose.", w.pts[0], (w.id,))
        depth = _min_width(w.pts)
        if depth < s["min_warning_depth_m"] - 1e-6:
            rep.add("review", "warning_depth", f"Warning area {w.label or w.id} is {depth:.2f} m deep at its narrowest "
                    f"(review threshold {s['min_warning_depth_m']:.2f} m). Check the depth the governing guideline requires.",
                    w.pts[0], (w.id,), "missing_warning_tiles")
    for a, b in combinations(scene.warnings, 2):
        if _overlap_area(a.pts, b.pts) > 1e-4:
            rep.add("warning", "warnings_overlap", f"Warning areas {a.label or a.id} and {b.label or b.id} overlap; the overlap "
                    "is counted twice in the estimate. Merge or trim them.", a.pts[0], (a.id, b.id))
    for a, b in combinations(scene.routes, 2):
        shared = sum(g.area(g.clip(qa, qb)) for qa in strips[a.id] for qb in strips[b.id])
        if shared > 2 * (a.width_tiles * T) * (b.width_tiles * T):  # more than a crossing or a butt joint
            rep.add("warning", "routes_overlap", f"Routes {a.label or a.id} and {b.label or b.id} overlap by more than a "
                    "crossing; overlapping strip area is counted twice in the estimate.", None, (a.id, b.id))
    return _finish(rep, s)


def _overlap_area(a, b) -> float:
    """Overlap of two polygons when at least one is convex; otherwise a vertex-containment test."""
    if _convex(b):
        return g.area(g.clip(a, b))
    if _convex(a):
        return g.area(g.clip(b, a))
    return 1.0 if any(g.point_in_polygon(p, b) for p in a) or any(g.point_in_polygon(p, a) for p in b) else 0.0


def _convex(poly) -> bool:
    n = len(poly)
    sign = 0
    for i in range(n):
        a, b, c = poly[i], poly[(i + 1) % n], poly[(i + 2) % n]
        cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cr) > 1e-12:
            if sign and (cr > 0) != (sign > 0):
                return False
            sign = 1 if cr > 0 else -1
    return True


def _min_width(poly) -> float:
    """Smallest width of a polygon over all edge directions (rotating calipers on the vertices)."""
    best = math.inf
    for a, b in g.edges(poly):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-9:
            continue
        nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
        proj = [(p[0] - a[0]) * nx + (p[1] - a[1]) * ny for p in poly]
        best = min(best, max(proj) - min(proj))
    return best


def _routes_cross(a, b) -> bool:
    pa, pb = g.dedupe(a.pts), g.dedupe(b.pts)
    for p1, p2 in zip(pa, pa[1:]):
        for q1, q2 in zip(pb, pb[1:]):
            if g.segments_intersect(p1, p2, q1, q2):
                ends = (pa[0], pa[-1], pb[0], pb[-1])
                if not any(g.point_seg_dist(e, q1, q2) < 1e-6 or g.point_seg_dist(e, p1, p2) < 1e-6 for e in ends):
                    return True
    return False


def _crossing_point(a, b):
    pa, pb = g.dedupe(a.pts), g.dedupe(b.pts)
    for p1, p2 in zip(pa, pa[1:]):
        for q1, q2 in zip(pb, pb[1:]):
            if g.segments_intersect(p1, p2, q1, q2):
                return ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
    return None


def _finish(rep: _Report, s: dict) -> dict:
    items = sorted(rep.items, key=lambda i: SEVERITY_ORDER[i["severity"]])
    counts = {k: sum(1 for i in items if i["severity"] == k) for k in SEVERITY_ORDER}
    return {
        "items": items,
        "counts": counts,
        "thresholds": {k: s[k] for k in ("clearance_m", "hazard_approach_m", "min_warning_depth_m", "turn_review_deg",
                                         "connect_tolerance_m")},
        "reference_set": references().get("version"),
        "statement": "Automated checks for planning support only. They do not establish compliance with any "
                     "accessibility standard; a qualified reviewer must assess the design against the applicable, "
                     "documented requirements.",
    }
