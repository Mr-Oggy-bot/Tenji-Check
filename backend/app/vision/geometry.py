"""Tile-grid geometry: planar homography turns the detected tile strip into a ruler measured in tile units.

1. Fit the two long edges of the tile strip as lines (robust fit over slices along the principal axis).
2. The edge quadrilateral defines a homography to a rectified, top-down strip. This removes perspective,
   leaving only an unknown scale along the strip axis.
3. That scale is recovered from the tile grid itself: grout joints repeat once per tile, so the dominant
   period of the row-median intensity profile is one tile length. The strip width in tiles follows.
4. Gaps, end bands and texture classes are then measured in tile units.

Assumptions: a roughly straight strip on a flat ground plane, square tiles and visible grout joints.
Whenever these do not hold, `reliable` is False and callers must defer to "verify on site".
"""
from dataclasses import dataclass, field

import cv2
import numpy as np

from .tiles import TYPE_DIRECTIONAL, TYPE_WARNING, TileSegmentation

RECT_W = 96


@dataclass
class StripGeometry:
    quad: np.ndarray
    H: np.ndarray
    rect_len: int
    edge_residual: float
    end_widths_px: tuple[float, float]
    reliable: bool
    reasons: list[str] = field(default_factory=list)

    def rect_to_image(self, pts: np.ndarray) -> np.ndarray:
        pts = np.asarray(pts, np.float32).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, np.linalg.inv(self.H)).reshape(-1, 2)

    def image_to_rect(self, pts: np.ndarray) -> np.ndarray:
        pts = np.asarray(pts, np.float32).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, self.H).reshape(-1, 2)


def _intersect(p, d, q, e):
    a = np.array([[d[0], -e[0]], [d[1], -e[1]]], float)
    if abs(np.linalg.det(a)) < 1e-9:
        return None
    s, _ = np.linalg.solve(a, np.asarray(q, float) - np.asarray(p, float))
    return np.asarray(p, float) + s * np.asarray(d, float)


def fit_strip(mask: np.ndarray) -> StripGeometry | None:
    ys, xs = np.nonzero(mask)
    if len(xs) < 400:
        return None
    pts = np.column_stack([xs, ys]).astype(np.float64)
    if len(pts) > 80000:
        pts = pts[:: len(pts) // 80000 + 1]
    c = pts.mean(axis=0)
    evals, evecs = np.linalg.eigh(np.cov((pts - c).T))
    u = evecs[:, int(np.argmax(evals))]
    if abs(u[1]) >= abs(u[0]):
        u = u if u[1] > 0 else -u  # strip start = top of image (usually far end)
    else:
        u = u if u[0] > 0 else -u
    n = np.array([-u[1], u[0]])
    t, sv = (pts - c) @ u, (pts - c) @ n
    t0, t1 = np.percentile(t, 0.5), np.percentile(t, 99.5)
    if t1 - t0 < 10:
        return None

    edges = np.linspace(t0, t1, 41)
    left, right, widths, tm = [], [], [], []
    for a, b in zip(edges[:-1], edges[1:]):
        sel = (t >= a) & (t < b)
        if sel.sum() < 25:
            continue
        sl, sr = np.percentile(sv[sel], 2), np.percentile(sv[sel], 98)
        if sr - sl < 3:
            continue
        m = t[sel].mean()
        left.append(c + m * u + sl * n)
        right.append(c + m * u + sr * n)
        widths.append(sr - sl)
        tm.append(m)
    if len(left) < 6:
        return None
    left, right = np.array(left, np.float32), np.array(right, np.float32)
    lv = cv2.fitLine(left, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    rv = cv2.fitLine(right, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()

    def line_resid(pts, line):
        d, p = line[:2], line[2:]
        return np.abs((pts - p) @ np.array([-d[1], d[0]]))

    med_w = float(np.median(widths))
    residual = float(np.sqrt(np.mean(np.concatenate([line_resid(left, lv), line_resid(right, rv)]) ** 2)) / med_w)

    corners = []
    for tt in (t0, t1):
        p = c + tt * u
        lp = _intersect(p, n, lv[2:], lv[:2])
        rp = _intersect(p, n, rv[2:], rv[:2])
        if lp is None or rp is None:
            return None
        corners.append((lp, rp))
    quad = np.array([corners[0][0], corners[0][1], corners[1][1], corners[1][0]], np.float32)
    w0 = float(np.linalg.norm(quad[1] - quad[0]))
    w1 = float(np.linalg.norm(quad[2] - quad[3]))
    reasons = []
    if residual > 0.12:
        reasons.append("Strip edges are not straight (curved, irregular or occluded strip)")
    if min(w0, w1) < 4 or (quad[1] - quad[0]) @ n < 0 or (quad[2] - quad[3]) @ n < 0:
        reasons.append("Strip edges cross inside the photo; perspective is too steep to rectify")
    if len(left) < 10:
        reasons.append("Too little of the tile strip is visible")
    rect_len = int(np.clip(RECT_W * (t1 - t0) / max(med_w, 1.0), 64, 6000))
    dst = np.array([[0, 0], [RECT_W, 0], [RECT_W, rect_len], [0, rect_len]], np.float32)
    H = cv2.getPerspectiveTransform(quad, dst)
    return StripGeometry(quad, H, rect_len, residual, (w0, w1), not reasons, reasons)


def _dominant_period(profile: np.ndarray, lo: int, hi: int) -> tuple[float | None, float]:
    x = profile - cv2.blur(profile.reshape(-1, 1).astype(np.float32), (1, max(3, hi * 2 | 1))).ravel()
    x = x - x.mean()
    if len(x) < lo * 2 or np.allclose(x, 0):
        return None, 0.0
    ac = np.correlate(x, x, mode="full")[len(x) - 1:]
    ac = ac / (ac[0] + 1e-9)
    hi = min(hi, len(ac) - 2)
    peaks = [k for k in range(max(lo, 1), hi) if ac[k] > ac[k - 1] and ac[k] >= ac[k + 1] and ac[k] > 0.2]
    if not peaks:
        return None, 0.0
    best = max(ac[k] for k in peaks)
    k = min(k for k in peaks if ac[k] >= 0.85 * best)
    # parabolic refinement
    y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]
    denom = y0 - 2 * y1 + y2
    off = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-9 else 0.0
    return float(k + off), float(y1)


def _runs(flags: np.ndarray) -> list[tuple[int, int]]:
    runs, start = [], None
    for i, f in enumerate(flags):
        if f and start is None:
            start = i
        elif not f and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(flags)))
    return runs


def classify_texture(gray_patch: np.ndarray, mask_patch: np.ndarray) -> tuple[str, float]:
    """Directional bars run along the strip axis (rectified y): gradient energy is dominated by x.
    Warning dots are isotropic. Returns (label, anisotropy)."""
    m = mask_patch > 0
    if m.sum() < 50:
        return "none", 0.0
    gx = cv2.Sobel(gray_patch, cv2.CV_32F, 1, 0, ksize=3)[m]
    gy = cv2.Sobel(gray_patch, cv2.CV_32F, 0, 1, ksize=3)[m]
    ex, ey = float((gx ** 2).mean()), float((gy ** 2).mean())
    energy = ex + ey
    if energy < 150:
        return "unknown", 0.0
    a = (ex - ey) / energy
    if a > 0.45:
        return "directional", a
    if a < 0.28:
        return "warning", a
    return "unknown", a


def analyze_strip(bgr: np.ndarray, seg: TileSegmentation, geom: StripGeometry, strip_width_tiles: int = 1) -> dict:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h_img, w_img = gray.shape
    W, L = RECT_W, geom.rect_len
    rmask = cv2.warpPerspective(seg.mask, geom.H, (W, L), flags=cv2.INTER_NEAREST)
    rgray = cv2.warpPerspective(gray, geom.H, (W, L), flags=cv2.INTER_LINEAR)
    inner = slice(int(0.1 * W), int(0.9 * W))
    coverage = (rmask[:, inner] > 0).mean(axis=1)
    tile_rows = coverage >= 0.5

    # Row-median intensity dips at grout joints, which repeat once per tile length.
    med = np.median(rgray[:, inner], axis=1).astype(np.float32)
    med[~tile_rows] = med[tile_rows].mean() if tile_rows.any() else 0
    period, period_conf = _dominant_period(-med, lo=int(0.25 * W), hi=int(4 * W))

    notes = list(geom.reasons)
    reliable = geom.reliable
    if period is None:
        reliable = False
        notes.append("Tile grid (grout joints) not readable, so tile-unit measurement is unavailable")
        strip_tiles, fy = None, 1.0
    else:
        # Strip width in tiles cannot be read from a 1-D profile; it only affects texture isotropy, never lengths.
        strip_tiles = max(1, strip_width_tiles)
        fy = (W / strip_tiles) / period  # rescale rows so tiles become square
    unit = (W / strip_tiles) if strip_tiles else float(W)

    if abs(fy - 1.0) > 1e-3:
        Ls = max(8, int(round(L * fy)))
        rmask = cv2.resize(rmask, (W, Ls), interpolation=cv2.INTER_NEAREST)
        rgray = cv2.resize(rgray, (W, Ls), interpolation=cv2.INTER_LINEAR)
        coverage = (rmask[:, inner] > 0).mean(axis=1)
        tile_rows = coverage >= 0.5
    Ls = rmask.shape[0]

    def to_image(y0: float, y1: float, x0: float = 0, x1: float = W) -> list[int]:
        poly = geom.rect_to_image(np.array([[x0, y0 / fy], [x1, y0 / fy], [x1, y1 / fy], [x0, y1 / fy]]))
        poly[:, 0] = np.clip(poly[:, 0], 0, w_img - 1)
        poly[:, 1] = np.clip(poly[:, 1], 0, h_img - 1)
        return [int(poly[:, 0].min()), int(poly[:, 1].min()), int(poly[:, 0].max()), int(poly[:, 1].max())]

    # Per-tile-row texture classes, with blocks aligned to the grout-joint phase so each block is one tile row.
    blocks = []
    step = max(4, int(round(unit)))
    phase = 0
    if period is not None:
        med_iso = np.median(rgray[:, inner], axis=1).astype(np.float32)
        dip = cv2.blur(med_iso.reshape(-1, 1), (1, step * 2 | 1)).ravel() - med_iso
        dip[~tile_rows] = 0
        phase = int(np.argmax([dip[o::step].mean() for o in range(step)]))
    type_rect = None
    if seg.type_map is not None:
        type_rect = cv2.warpPerspective(seg.type_map, geom.H, (W, L), flags=cv2.INTER_NEAREST)
        type_rect = cv2.resize(type_rect, (W, Ls), interpolation=cv2.INTER_NEAREST)
    starts = list(range(phase - step if phase else 0, Ls, step))
    for y in starts:
        y, y2 = max(0, y), min(Ls, y + step)
        if y2 - y < 0.3 * step:
            continue
        cov = float(coverage[y:y2].mean())
        if type_rect is not None:
            vals = type_rect[y:y2][type_rect[y:y2] > 0]
            label = "none" if vals.size == 0 else ("warning" if (vals == TYPE_WARNING).mean() > 0.5 else "directional")
            aniso = None
        else:
            pad = int(0.18 * (y2 - y))
            label, aniso = classify_texture(rgray[y + pad:y2 - pad, inner], rmask[y + pad:y2 - pad, inner])
        if cov < 0.25:
            label = "gap"
        blocks.append({"row": [y, y2], "coverage": round(cov, 2), "type": label,
                       "anisotropy": None if aniso is None else round(aniso, 2)})
    if period is None:
        for b in blocks:
            if b["type"] in ("warning", "directional"):
                b["type"] = "unknown"

    # Interior gaps (rows without tiles bounded by tiles on both sides).
    gaps = []
    gap_flags = coverage < 0.25
    for a, b in _runs(gap_flags):
        if a == 0 or b == Ls:
            continue
        length_tiles = (b - a) / unit if period is not None else None
        if period is not None and length_tiles < 0.15:
            continue
        gaps.append({"rows": [a, b], "length_tiles": None if length_tiles is None else round(length_tiles, 2),
                     "bbox": to_image(a, b)})

    def end_info(which: str) -> dict:
        pts = geom.quad[:2] if which == "start" else geom.quad[2:]
        margin = 0.02 * max(w_img, h_img)
        visible = bool(all(margin < p[0] < w_img - margin and margin < p[1] < h_img - margin for p in pts))
        tile_blocks = [b for b in blocks if b["type"] != "gap"]
        blk = (tile_blocks[0] if which == "start" else tile_blocks[-1]) if tile_blocks else None
        width = geom.end_widths_px[0 if which == "start" else 1]
        y0, y1 = (0, step) if which == "start" else (Ls - step, Ls)
        return {"visible": visible, "type": blk["type"] if blk else "none", "width_px": round(width, 1),
                "bbox": to_image(y0, y1), "near": width >= 0.4 * max(geom.end_widths_px)}

    return {
        "reliable": reliable,
        "notes": notes,
        "edge_residual": round(geom.edge_residual, 3),
        "tile_period_px": None if period is None else round(period, 2),
        "period_confidence": round(period_conf, 2),
        "strip_width_tiles": strip_tiles,
        "length_tiles": round(Ls / unit, 1) if period is not None else None,
        "tile_coverage": round(float(tile_rows.mean()), 2),
        "blocks": blocks,
        "gaps": gaps,
        "ends": {"start": end_info("start"), "end": end_info("end")},
        "quad": geom.quad.round(1).tolist(),
        "_fy": fy,
        "_unit": unit,
    }


def obstacle_overlap(geom: StripGeometry | None, strip: dict | None, bbox: list[float], img_shape) -> dict:
    """Relate an obstacle box to the guide corridor using its ground-contact footprint (bottom of the box)."""
    x1, y1, x2, y2 = bbox
    foot_top = y2 - 0.2 * (y2 - y1)
    if geom is None:
        return {"on_path": False, "known": False}
    h, w = img_shape[:2]
    corridor = np.zeros((h, w), np.uint8)
    cv2.fillPoly(corridor, [geom.quad.astype(np.int32)], 255)
    corridor = cv2.dilate(corridor, np.ones((5, 5), np.uint8))
    fx1, fy1, fx2, fy2 = (int(max(0, v)) for v in (x1, foot_top, x2, y2))
    patch = corridor[fy1:min(h, fy2 + 1), fx1:min(w, fx2 + 1)]
    img_overlap = float((patch > 0).mean()) if patch.size else 0.0
    result = {"known": True, "image_overlap": round(img_overlap, 2)}
    if strip is not None and strip.get("reliable"):
        fy, unit = strip["_fy"], strip["_unit"]
        r = geom.image_to_rect(np.array([[x1, y2], [x2, y2], [(x1 + x2) / 2, y2]]))
        xs = np.sort(r[:2, 0])
        if np.all(np.abs(r) < 50 * RECT_W):
            width_overlap = max(0.0, min(xs[1], RECT_W) - max(xs[0], 0)) / RECT_W
            along = float(r[2, 1] * fy / unit)
            result.update({"corridor_width_overlap": round(width_overlap, 2), "position_tiles": round(along, 1)})
            result["on_path"] = width_overlap > 0.15 and -1.0 <= along <= strip["length_tiles"] + 1.0
            return result
    result["on_path"] = img_overlap >= 0.15
    return result
