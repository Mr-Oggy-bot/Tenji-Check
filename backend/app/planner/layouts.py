"""Compare alternative layouts of the same design.

Options only move where the tile grid starts. The covered area, strip widths, warning areas and route geometry
stay identical, so no option trades away an accessibility feature to save material. A layout whose laid area
differs from the design's is rejected, not offered.
"""
from .document import LAYOUT_OPTIONS, Scene
from .estimator import estimate

DESCRIPTIONS = {
    "start": "Grid starts at the beginning of each run and at the first corner of each warning area; cuts collect at the far ends.",
    "centred": "Grid centred on each run and area, so cuts are split evenly between both ends (symmetrical, usually fewer slivers).",
    "offset": "Grid shifted by half a tile; useful when whole tiles at the start of each run matter less than at the joints.",
}
AREA_TOLERANCE_M2 = 1e-3


def compare(scene: Scene, settings: dict | None) -> list[dict]:
    results = {o: estimate(scene, settings, o, include_cells=False) for o in LAYOUT_OPTIONS}
    if not all(r["ok"] for r in results.values()):
        return []
    ref_area = results["start"]["totals"]["area_m2"]
    rows = []
    for o, r in results.items():
        t, bt = r["totals"], r["by_type"]
        valid = abs(t["area_m2"] - ref_area) <= AREA_TOLERANCE_M2
        rows.append({
            "option": o,
            "description": DESCRIPTIONS[o],
            "valid": valid,
            "area_m2": t["area_m2"],
            "tiles_required": {k: v["tiles_required"] for k, v in bt.items()},
            "purchase_tiles": {k: v["purchase_tiles"] for k, v in bt.items()},
            "cut_pieces": int(t["cut_pieces"]),
            "slivers": sum(v["sliver_pieces"] for v in bt.values()),
            "reusable_offcuts_left": sum(v["leftover_offcuts"] for v in bt.values()),
            "waste_area_m2": round(t["waste_area_m2"], 3),
            "waste_pct": round(100 * t["waste_area_m2"] / max(1e-9, sum(v["tiles_required"] for v in bt.values()) * (r["tile_size_mm"] / 1000) ** 2), 1),
            "total_cost": t["total_cost"],
        })
    valid_rows = [r for r in rows if r["valid"]]
    if valid_rows:
        best = min(valid_rows, key=lambda r: (r["total_cost"], sum(r["purchase_tiles"].values()), r["waste_area_m2"], r["slivers"]))
        base = next(r for r in rows if r["option"] == "start")
        for r in rows:
            r["recommended"] = r is best
            r["waste_vs_start_m2"] = round(r["waste_area_m2"] - base["waste_area_m2"], 3)
            r["cost_vs_start"] = round(r["total_cost"] - base["total_cost"], 2)
    return rows
