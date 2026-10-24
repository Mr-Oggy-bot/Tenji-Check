"""Proposes where a directional tactile strip could be laid in the visible scene, keeping clear of obstacles.

Works on the bird's-eye surface grid (see groundplane.py). A dynamic programme walks forward row by row
(0.1 m per row), letting the strip shift sideways by a bounded amount per row, and picks the route that reaches
furthest while maximising clearance and minimising sideways moves. Output is a proposal for an engineer to
check on site, not a design.
"""
from dataclasses import dataclass, field

import cv2
import numpy as np

from .groundplane import Grid
from .surface import BLOCKED, CARRIAGEWAY, GROUP_NAMES, HAZARD, LAYABLE, MARGINAL, UNKNOWN

TILE_M = 0.3
# Assumptions, not clause values: the strip edge keeps this clear width from obstacles, and a 2x2 warning pad
# goes at each direction change and before a carriageway or hazard. Verify against the governing guideline.
DEFAULT_CLEARANCE_M = 0.6
TURN_DEG = 15.0


@dataclass
class PlanParams:
    strip_width_tiles: int = 1
    clearance_m: float = DEFAULT_CLEARANCE_M
    max_shift_per_m: float = 1.0  # sideways metres per metre forward (45 degrees)
    unpaved_penalty: float = 2.0
    shift_penalty: float = 1.5
    centre_penalty: float = 0.15  # mild preference for starting in front of the user


@dataclass
class Plan:
    ok: bool
    points_m: list[tuple[float, float]] = field(default_factory=list)  # simplified centreline (x, y)
    length_m: float = 0.0
    turns: int = 0
    min_clearance_m: float | None = None
    unpaved_m: float = 0.0
    existing_m: float = 0.0  # length that runs on tactile tiles already in place
    new_m: float = 0.0
    stop_reason: str = ""
    stop_code: str = ""
    materials: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _dist(mask: np.ndarray, cell: float) -> np.ndarray:
    """Distance in metres from each True cell to the nearest False cell."""
    if mask.all():
        return np.full(mask.shape, 1e6, np.float32)
    return cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5) * cell


def plan_strip(groups: np.ndarray, grid: Grid, p: PlanParams | None = None, existing: np.ndarray | None = None) -> Plan:
    """`existing` marks cells with tactile tiles already in place; the route prefers to reuse them."""
    p = p or PlanParams()
    existing = np.zeros(groups.shape, bool) if existing is None else existing.astype(bool)
    ny, nx = groups.shape
    cell = grid.cell_m
    half_w = p.strip_width_tiles * TILE_M / 2
    walkable = (groups == LAYABLE) | (groups == MARGINAL)
    blocking = (groups == BLOCKED) | (groups == CARRIAGEWAY) | (groups == HAZARD)
    d_block = _dist(~blocking, cell)  # clearance to anything the strip must avoid
    d_surface = _dist(walkable, cell)  # the strip itself must sit on visible walkable ground
    need = half_w + p.clearance_m
    feasible = walkable & (d_block >= need - 1e-6) & (d_surface >= half_w - 1e-6)

    visible_rows = np.where((groups != UNKNOWN).any(1))[0]
    if not len(visible_rows):
        return Plan(False, stop_reason="No ground visible. Tilt the camera down towards the footpath.", stop_code="no_ground")
    r0 = int(visible_rows[0])
    start_rows = range(r0, min(ny, r0 + int(3.0 / cell)))
    first = next((r for r in start_rows if feasible[r].any()), None)
    if first is None:
        why = "No stretch of walkable surface near you is wide enough for a strip with the required clearance."
        if not walkable[list(start_rows)].any():
            why = "The ground in front of you is not recognised as a walkway."
        return Plan(False, stop_reason=why, stop_code="no_start", notes=[f"Needs {2 * need:.1f} m clear width"])

    k = max(1, int(round(p.max_shift_per_m)))  # columns per row (cell-sized steps)
    xs = grid.col_x(np.arange(nx))
    pref = need + 0.5
    step = np.where(feasible, 1.0 + 2.0 * np.clip(pref - d_block, 0, None) / pref + p.unpaved_penalty * (groups == MARGINAL),
                    np.inf)
    step = np.where(existing, step * 0.5, step)
    cost = np.full((ny, nx), np.inf)
    back = np.zeros((ny, nx), np.int16)
    cost[first] = step[first] + p.centre_penalty * np.abs(xs) / cell
    last = first
    for r in range(first + 1, ny):
        prev = cost[r - 1]
        best = np.full(nx, np.inf)
        arg = np.zeros(nx, np.int16)
        for dc in range(-k, k + 1):
            shifted = np.full(nx, np.inf)
            if dc >= 0:
                shifted[dc:] = prev[: nx - dc] if dc else prev
            else:
                shifted[:dc] = prev[-dc:]
            cand = shifted + p.shift_penalty * abs(dc)
            better = cand < best
            best[better] = cand[better]
            arg[better] = np.arange(nx)[better] - dc
        cost[r] = best + step[r]
        back[r] = arg
        if np.isfinite(cost[r]).any():
            last = r
        else:
            break

    c = int(np.argmin(cost[last]))
    cells = []
    for r in range(last, first - 1, -1):
        cells.append((r, c))
        c = int(back[r, c])
    cells.reverse()
    pts = np.array([[grid.col_x(c), grid.row_y(r)] for r, c in cells], np.float32)

    simp = cv2.approxPolyDP(pts.reshape(-1, 1, 2), 0.12, False).reshape(-1, 2) if len(pts) > 2 else pts
    seg = np.diff(simp, axis=0)
    length = float(np.linalg.norm(seg, axis=1).sum()) if len(seg) else 0.0
    turns = 0
    for a, b in zip(seg[:-1], seg[1:]):
        ang = np.degrees(np.arccos(np.clip(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9), -1, 1)))
        turns += int(ang > TURN_DEG)
    clear = [float(d_block[r, c]) - half_w for r, c in cells]
    unpaved = sum(groups[r, c] == MARGINAL for r, c in cells) * cell
    on_existing = sum(bool(existing[r, c]) for r, c in cells) / max(1, len(cells))

    code, reason = _stop_reason(groups, last, cells[-1][1], ny, nx, int(round(half_w / cell)) + 2, grid)
    warning_pads = int(turns + (code in ("carriageway", "hazard")))
    plan = Plan(True, [(round(float(x), 3), round(float(y), 3)) for x, y in simp], round(length, 2), int(turns),
                round(min(clear), 2) if clear and blocking.any() else None, round(float(unpaved), 2),
                round(length * on_existing, 2), round(length * (1 - on_existing), 2), reason, code)
    directional = int(np.ceil(plan.new_m / TILE_M)) * p.strip_width_tiles
    plan.materials = {"directional_tiles": directional, "warning_tiles": warning_pads * 4,
                      "warning_pads": int(warning_pads), "strip_width_m": round(2 * half_w, 2)}
    if on_existing > 0.2:
        plan.notes.append(f"{plan.existing_m:.1f} m follows tactile tiles already in place; only new sections are costed.")
    if unpaved > 0:
        plan.notes.append(f"{unpaved:.1f} m crosses unpaved ground: needs a paved base before tiles can be laid.")
    if code == "carriageway":
        plan.notes.append("Strip ends at a carriageway: a warning band is needed at the kerb edge.")
    return plan


def _stop_reason(groups, last, col, ny, nx, half_cols, grid) -> tuple[str, str]:
    if last >= ny - 1:
        return "range", f"Reached the planning range ({grid.max_range_m:.0f} m). Move forward to continue."
    ahead = groups[last + 1: min(ny, last + 1 + int(0.8 / grid.cell_m)), max(0, col - half_cols): min(nx, col + half_cols + 1)]
    vals, counts = np.unique(ahead, return_counts=True)
    present = dict(zip(vals.tolist(), counts.tolist()))
    for g, code, msg in ((CARRIAGEWAY, "carriageway", "Carriageway ahead."),
                         (HAZARD, "hazard", "Hazard ahead (steps or water)."),
                         (BLOCKED, "blocked", "Obstacle ahead with no clear way around it in view.")):
        if present.get(g):
            return code, msg
    if present.get(UNKNOWN, 0) >= ahead.size * 0.5:
        return "out_of_view", "Ground beyond this point is not visible or not recognised."
    return "narrow", "Walkway becomes too narrow for the strip plus clearance."


def group_counts(groups: np.ndarray) -> dict[str, float]:
    total = groups.size
    return {GROUP_NAMES[g]: round(float((groups == g).sum()) / total, 3) for g in GROUP_NAMES}
