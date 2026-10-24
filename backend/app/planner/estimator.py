"""Material estimate from the actual tile layout, not from area / tile area.

1. Lay a square tile grid over every directional strip segment (aligned with the direction of travel, so the
   bars run the right way) and over every warning area (aligned with the area's longest edge, or a set angle).
2. Clip every grid cell against the design geometry. A cell is a whole tile, a cut piece (with its size in the
   tile's own axes), or empty. Directional cells inside a warning area count as warning, not directional.
3. Cut pieces come from new tiles or from reusable offcuts of earlier cuts (first-fit, largest piece first,
   one reuse per offcut). Directional offcuts are not rotated, because the bars must stay aligned; warning
   (dot) offcuts may be rotated 90 degrees.
4. Waste = tile area bought for laying − area laid. Spare allowance, then pack rounding, then price.

Deterministic: the same document and settings always give the same numbers.
"""
import math
from collections import defaultdict

from . import geometry as g
from .document import TILE_TYPES, Scene, merged_settings

ENGINE_VERSION = "planner-estimator-1.0"
WHOLE_FRACTION = 0.995
IGNORE_FRACTION = 0.005  # numerical crumbs from shared edges
MAX_CELLS_RETURNED = 6000


def _longest_edge_angle(poly) -> float:
    best, ang = -1.0, 0.0
    for a, b in g.edges(poly):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L > best:
            best, ang = L, math.atan2(b[1] - a[1], b[0] - a[0])
    return ang


def _grid_start(lo: float, origin_shift: float, T: float) -> int:
    return math.floor((lo - origin_shift) / T + 1e-9)


class _Collector:
    def __init__(self, T: float, scene: Scene):
        self.T = T
        self.scene = scene
        self.pieces: dict[str, list[dict]] = defaultdict(list)
        self.cells: list[dict] = []

    def add(self, ttype: str, cell_world: list, piece_world: list, piece_area: float, local_piece: list, source: str):
        T = self.T
        f = piece_area / (T * T)
        if f < IGNORE_FRACTION:
            return
        ss = [p[0] for p in local_piece]
        tt = [p[1] for p in local_piece]
        pw, ph = min(T, max(ss) - min(ss)), min(T, max(tt) - min(tt))
        whole = f >= WHOLE_FRACTION
        self.pieces[ttype].append({"f": min(1.0, f), "pw": pw, "ph": ph, "whole": whole, "area": min(T * T, piece_area)})
        if len(self.cells) < MAX_CELLS_RETURNED:
            self.cells.append({"type": ttype, "kind": "whole" if whole else "cut", "source": source,
                               "polygon": [self.scene.px(p) for p in (cell_world if whole else piece_world)]})


def _lay_strips(scene: Scene, col: _Collector, option: str):
    T = col.T
    for r in scene.routes:
        width = r.width_tiles * T
        for seg in g.strip_segments(r.pts, width):
            loc = [g.to_local(p, seg.origin, seg.u, seg.n) for p in seg.quad]
            s_lo, s_hi = min(p[0] for p in loc), max(p[0] for p in loc)
            if option == "centred":
                shift = (seg.length - math.floor(seg.length / T) * T) / 2
            elif option == "offset":
                shift = T / 2
            else:
                shift = 0.0
            k0, k1 = _grid_start(s_lo, shift, T), _grid_start(s_hi, shift, T)
            for k in range(k0, k1 + 1):
                s0 = shift + k * T
                for j in range(r.width_tiles):
                    t0 = -width / 2 + j * T
                    cell_loc = [(s0, t0), (s0 + T, t0), (s0 + T, t0 + T), (s0, t0 + T)]
                    cell = [g.from_local(s, t, seg.origin, seg.u, seg.n) for s, t in cell_loc]
                    piece = g.clip(seg.quad, cell)
                    if not piece:
                        continue
                    a = g.area(piece)
                    for w in scene.warnings:  # warning tiles replace directional ones where areas overlap
                        ov = g.clip(w.pts, piece)
                        if ov:
                            a -= g.area(ov)
                    if a <= 0:
                        continue
                    local = [g.to_local(p, (cell[0][0], cell[0][1]), seg.u, seg.n) for p in piece]
                    col.add("directional", cell, piece, a, local, f"route:{r.id}")


def _lay_warnings(scene: Scene, col: _Collector, option: str):
    T = col.T
    for w in scene.warnings:
        ang = math.radians(w.angle_deg) if w.angle_deg is not None else _longest_edge_angle(w.pts)
        u, n = (math.cos(ang), math.sin(ang)), (-math.sin(ang), math.cos(ang))
        origin = w.pts[0]
        loc = [g.to_local(p, origin, u, n) for p in w.pts]
        s_lo, s_hi = min(p[0] for p in loc), max(p[0] for p in loc)
        t_lo, t_hi = min(p[1] for p in loc), max(p[1] for p in loc)
        if option == "centred":
            ss = ((s_hi - s_lo) - math.floor((s_hi - s_lo) / T) * T) / 2 + s_lo
            ts = ((t_hi - t_lo) - math.floor((t_hi - t_lo) / T) * T) / 2 + t_lo
        elif option == "offset":
            ss, ts = T / 2, T / 2
        else:
            ss, ts = 0.0, 0.0
        for k in range(_grid_start(s_lo, ss, T), _grid_start(s_hi, ss, T) + 1):
            for j in range(_grid_start(t_lo, ts, T), _grid_start(t_hi, ts, T) + 1):
                s0, t0 = ss + k * T, ts + j * T
                cell = [g.from_local(s, t, origin, u, n) for s, t in ((s0, t0), (s0 + T, t0), (s0 + T, t0 + T), (s0, t0 + T))]
                piece = g.clip(w.pts, cell)
                if not piece:
                    continue
                local = [g.to_local(p, cell[0], u, n) for p in piece]
                col.add("warning", cell, piece, g.area(piece), local, f"warning:{w.id}")


def _lay_single_tiles(scene: Scene, col: _Collector):
    T = col.T
    for t in scene.tiles:
        a = math.radians(t.angle_deg)
        u, n = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
        o = g.from_local(-T / 2, -T / 2, t.pt, u, n)
        cell = [g.from_local(s, q, o, u, n) for s, q in ((0, 0), (T, 0), (T, T), (0, T))]
        col.add(t.type, cell, cell, T * T, [(0, 0), (T, T)], f"tile:{t.id}")


def _cut_plan(pieces: list[dict], T: float, kerf: float, min_offcut: float, reuse: bool, rotate: bool) -> dict:
    """Match cut pieces to offcuts; every piece not covered by an offcut consumes a new tile."""
    cuts = sorted((p for p in pieces if not p["whole"]), key=lambda p: -p["area"])
    inventory: list[tuple[float, float]] = []
    new_tiles = reused = 0
    for p in cuts:
        pw, ph = p["pw"], p["ph"]
        hit = None
        if reuse:
            for i, (w, h) in enumerate(inventory):
                if (w >= pw - 1e-9 and h >= ph - 1e-9) or (rotate and w >= ph - 1e-9 and h >= pw - 1e-9):
                    hit = i
                    break
        if hit is not None:
            inventory.pop(hit)
            reused += 1
            continue
        new_tiles += 1
        # The remainder of the tile after cutting this piece (largest rectangle of the L-shaped remainder).
        r1 = (T - pw - kerf, T)
        r2 = (T, T - ph - kerf)
        best = max((r for r in (r1, r2) if r[0] > 0 and r[1] > 0), key=lambda r: r[0] * r[1], default=None)
        if best and min(best) >= min_offcut:
            inventory.append(best)
    return {"cut_pieces": len(cuts), "new_tiles_for_cuts": new_tiles, "pieces_from_offcuts": reused,
            "leftover_offcuts": len(inventory), "leftover_offcut_area_m2": round(sum(w * h for w, h in inventory), 4)}


def estimate(scene: Scene, settings: dict | None = None, option: str | None = None, include_cells: bool = True) -> dict:
    s = merged_settings(settings)
    option = option or scene.layout_option
    if not scene.m_per_px:
        return {"ok": False, "reason": "Calibrate the drawing scale before estimating materials."}
    T = s["tile_size_mm"] / 1000.0
    kerf, min_off = s["kerf_mm"] / 1000.0, s["min_offcut_mm"] / 1000.0
    col = _Collector(T, scene)
    _lay_strips(scene, col, option)
    _lay_warnings(scene, col, option)
    _lay_single_tiles(scene, col)

    by_type, totals = {}, defaultdict(float)
    for ttype in TILE_TYPES:
        ps = col.pieces.get(ttype, [])
        whole = sum(1 for p in ps if p["whole"])
        plan = _cut_plan(ps, T, kerf, min_off, s["reuse_offcuts"], rotate=ttype == "warning")
        slivers = sum(1 for p in ps if not p["whole"] and p["f"] < s["sliver_fraction"])
        laid_area = sum(p["area"] for p in ps)
        required = whole + plan["new_tiles_for_cuts"]
        bought_area = required * T * T
        waste = max(0.0, bought_area - laid_area)
        spare = 0 if required == 0 else max(s["min_spare_tiles"], math.ceil(required * s["spare_pct"] / 100))
        price = s["prices"][ttype]
        pack = max(1, int(price["pack_size"]))
        packs = math.ceil((required + spare) / pack) if required else 0
        purchase = packs * pack
        naive = math.ceil(laid_area / (T * T)) if laid_area else 0
        cost = round(packs * float(price["price_per_pack"]), 2)
        cut_cost = round(plan["cut_pieces"] * float(s["cut_cost_per_cut"]), 2)
        by_type[ttype] = {
            "area_m2": round(laid_area, 3),
            "whole_tiles": whole,
            **plan,
            "sliver_pieces": slivers,
            "tiles_required": required,
            "waste_area_m2": round(waste, 4),
            "waste_pct": round(100 * waste / bought_area, 1) if bought_area else 0.0,
            "spare_tiles": spare,
            "packs": packs,
            "pack_size": pack,
            "purchase_tiles": purchase,
            "pack_surplus_tiles": purchase - required - spare,
            "material_cost": cost,
            "cutting_cost": cut_cost,
            "naive_area_estimate_tiles": naive,
            "supplier": price.get("supplier", ""),
        }
        for k in ("area_m2", "tiles_required", "purchase_tiles", "material_cost", "cutting_cost", "waste_area_m2", "cut_pieces"):
            totals[k] += by_type[ttype][k]
    totals = {k: round(v, 4) for k, v in totals.items()}
    totals["total_cost"] = round(totals["material_cost"] + totals["cutting_cost"], 2)
    out = {
        "ok": True,
        "engine_version": ENGINE_VERSION,
        "layout_option": option,
        "tile_size_mm": s["tile_size_mm"],
        "currency": s["currency"],
        "by_type": by_type,
        "totals": totals,
        "assumptions": assumptions(s),
    }
    if include_cells:
        out["cells"] = col.cells
        out["cells_truncated"] = len(col.cells) >= MAX_CELLS_RETURNED
    return out


def assumptions(s: dict) -> list[str]:
    T = s["tile_size_mm"]
    return [
        f"Square {T} x {T} mm tiles; directional tile grid aligned with each straight run of the route, warning "
        "tile grid aligned with the longest edge of each warning area unless an angle is set.",
        "Route strips are laid at their full drawn width (whole tiles across); corners are mitred, which creates "
        "angled cut pieces on both runs.",
        "Where a warning area overlaps a route, warning tiles replace directional tiles. Where two routes cross, "
        "the crossing square is counted in both routes (a small overcount, flagged for review).",
        f"Cut pieces are cut from new tiles unless a reusable offcut fits ({'enabled' if s['reuse_offcuts'] else 'disabled'}). "
        f"Offcuts narrower than {s['min_offcut_mm']} mm are treated as waste; saw kerf {s['kerf_mm']} mm. "
        "Directional offcuts are not rotated; warning offcuts may be rotated 90 degrees. Each offcut is reused once.",
        "Angled pieces are sized by their bounding box in the tile's axes, which is conservative for reuse.",
        f"Cut pieces smaller than {round(100 * s['sliver_fraction'])}% of a tile are flagged as slivers (hard to "
        "bed and likely to loosen); consider a different layout option.",
        f"Spare allowance {s['spare_pct']}% of tiles required (minimum {s['min_spare_tiles']} per tile type), then "
        "rounded up to whole packs.",
        "Costs are tile purchase costs from the configured supplier prices, plus an optional per-cut charge. "
        "Bedding, jointing, edge restraint, labour and delivery are not included.",
        "Quantities come from the drawn geometry and calibrated scale; verify dimensions on site before ordering.",
    ]
