"""Optional route suggestion: shortest clear path between two points on the marked footpath.

Rasterises the site at 0.1 m (coarser on very large sites), blocks obstacles, stairs, kerb lines and anything
outside the footpath/site boundary, then runs A* with a penalty for passing closer than the review clearance.
The suggestion is an ordinary editable route; manual drawing is always available.
"""
import heapq
import math

import cv2
import numpy as np

from . import geometry as g
from .document import OBSTACLE_TYPES, Scene, merged_settings

MAX_CELLS = 400_000


class NoRoute(Exception):
    pass


def suggest(scene: Scene, canvas_px: tuple[int, int], start_px, end_px, width_tiles: int = 1, settings=None) -> dict:
    s = merged_settings(settings)
    if not scene.m_per_px:
        raise NoRoute("Calibrate the drawing scale first.")
    k = scene.m_per_px
    W = width_tiles * s["tile_size_mm"] / 1000
    w_m, h_m = canvas_px[0] * k, canvas_px[1] * k
    cell = max(0.1, math.sqrt(w_m * h_m / MAX_CELLS))
    nx, ny = int(math.ceil(w_m / cell)), int(math.ceil(h_m / cell))

    def px(pts):
        return np.array([[int(round(x / cell)), int(round(y / cell))] for x, y in pts], np.int32)

    footpaths = [f for f in scene.features if f.type == "footpath"]
    boundary = [f for f in scene.features if f.type == "boundary"]
    free = np.zeros((ny, nx), np.uint8)
    if footpaths:
        for f in footpaths:
            cv2.fillPoly(free, [px(f.pts)], 1)
    else:
        free[:] = 1
    if boundary:
        inside = np.zeros_like(free)
        for f in boundary:
            cv2.fillPoly(inside, [px(f.pts)], 1)
        free &= inside
    for f in scene.features:
        if f.type in OBSTACLE_TYPES or f.type == "stairs":
            shape, closed = f.shape(g.circle)
            if closed:
                cv2.fillPoly(free, [px(shape)], 0)
            else:
                cv2.circle(free, tuple(px(shape)[0]), 1, 0, -1)
        elif f.type == "kerb":
            cv2.polylines(free, [px(f.pts)], False, 0, 1)

    clear = cv2.distanceTransform(free, cv2.DIST_L2, 5) * cell  # metres to nearest blocked cell
    need = W / 2
    pref = W / 2 + s["clearance_m"]
    ok = clear >= need - 1e-6
    a = (int(start_px[0] * k / cell), int(start_px[1] * k / cell))
    b = (int(end_px[0] * k / cell), int(end_px[1] * k / cell))
    for name, p in (("Start", a), ("End", b)):
        if not (0 <= p[0] < nx and 0 <= p[1] < ny) or not ok[p[1], p[0]]:
            raise NoRoute(f"{name} point is not on clear footpath wide enough for the strip.")

    penalty = np.where(ok, 1.0 + 3.0 * np.clip(pref - clear, 0, None) / max(pref, 1e-6), np.inf)
    steps = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
             (1, 1, math.sqrt(2)), (1, -1, math.sqrt(2)), (-1, 1, math.sqrt(2)), (-1, -1, math.sqrt(2))]
    dist = {a: 0.0}
    prev = {}
    heap = [(0.0, a)]
    while heap:
        _, cur = heapq.heappop(heap)
        if cur == b:
            break
        d0 = dist[cur]
        for dx, dy, L in steps:
            nb = (cur[0] + dx, cur[1] + dy)
            if not (0 <= nb[0] < nx and 0 <= nb[1] < ny):
                continue
            c = penalty[nb[1], nb[0]]
            if not np.isfinite(c):
                continue
            nd = d0 + L * c
            if nd < dist.get(nb, math.inf):
                dist[nb] = nd
                prev[nb] = cur
                heapq.heappush(heap, (nd + math.hypot(b[0] - nb[0], b[1] - nb[1]), nb))
    if b not in dist:
        raise NoRoute("No clear path between the two points within the marked footpath.")
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    path.reverse()

    simplified = _simplify(np.array(path, np.float32), ok)
    pts_m = [((x + 0.5) * cell, (y + 0.5) * cell) for x, y in simplified]
    pts_m[0] = (start_px[0] * k, start_px[1] * k)
    pts_m[-1] = (end_px[0] * k, end_px[1] * k)
    min_clear = float(min(clear[y, x] for x, y in path)) - W / 2
    length = sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(pts_m, pts_m[1:]))
    return {"points": [scene.px(p) for p in pts_m], "length_m": round(length, 2), "min_clearance_m": round(min_clear, 2),
            "grid_cell_m": round(cell, 3),
            "note": "Suggested shortest clear path. Edit it freely; the suggestion does not consider guideline-specific "
                    "rules such as preferred alignment along building lines."}


def _simplify(path: np.ndarray, ok: np.ndarray) -> list[tuple[int, int]]:
    """Douglas-Peucker, tightening the tolerance until every simplified segment stays on clear cells."""
    for eps in (3.0, 2.0, 1.0, 0.5):
        simp = cv2.approxPolyDP(path.reshape(-1, 1, 2), eps, False).reshape(-1, 2).astype(int)
        if all(_segment_clear(p, q, ok) for p, q in zip(simp, simp[1:])):
            return [tuple(map(int, p)) for p in simp]
    return [tuple(map(int, p)) for p in path.astype(int)]


def _segment_clear(p, q, ok) -> bool:
    n = int(max(abs(q[0] - p[0]), abs(q[1] - p[1]))) + 1
    xs = np.linspace(p[0], q[0], n).round().astype(int)
    ys = np.linspace(p[1], q[1], n).round().astype(int)
    return bool(ok[ys, xs].all())
