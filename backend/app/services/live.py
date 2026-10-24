"""Per-frame live analysis: walkable surface + obstacles -> ground grid -> proposed strip. Nothing is stored."""
import base64
import time
from dataclasses import asdict

import cv2
import numpy as np

from ..vision.groundplane import Camera, Grid, to_birds_eye
from ..vision.layplan import PlanParams, group_counts, plan_strip
from ..vision.obstacles import get_obstacle_detector
from ..vision.surface import BLOCKED, CARRIAGEWAY, HAZARD, LAYABLE, MARGINAL, UNKNOWN, get_surface_segmenter
from ..vision.tiles import ClassicalTileSegmenter

ANALYSIS_WIDTH = 512
GRID = Grid()
# RGBA overlay colours per surface group
COLOURS = {LAYABLE: (22, 168, 133, 90), MARGINAL: (232, 173, 18, 90), CARRIAGEWAY: (220, 38, 38, 90),
           BLOCKED: (100, 116, 139, 70), HAZARD: (234, 88, 12, 110)}
TILE_BGR = (18, 200, 250)  # existing yellow tactile tiles
PLAN_BGR = (235, 99, 37)  # proposed strip (blue), distinct from existing tiles
_tiles = ClassicalTileSegmenter()


def _png_data_url(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode() if ok else ""


def _surface_overlay(groups: np.ndarray, tiles: np.ndarray) -> str:
    small = cv2.resize(groups, (groups.shape[1] // 2, groups.shape[0] // 2), interpolation=cv2.INTER_NEAREST)
    rgba = np.zeros((*small.shape, 4), np.uint8)
    for g, (r, gr, b, a) in COLOURS.items():
        rgba[small == g] = (b, gr, r, a)  # OpenCV writes BGRA
    t = cv2.resize(tiles, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
    rgba[t] = (*TILE_BGR, 150)
    return _png_data_url(rgba)


def _birds_eye_png(bev: np.ndarray, tiles: np.ndarray, plan, grid: Grid, half_w: float) -> str:
    scale = 4
    img = np.full((*bev.shape, 3), 245, np.uint8)
    img[bev == UNKNOWN] = (226, 232, 240)
    for g, (r, gr, b, _) in COLOURS.items():
        img[bev == g] = (b, gr, r)
    img[tiles] = TILE_BGR
    img = cv2.resize(img, (bev.shape[1] * scale, bev.shape[0] * scale), interpolation=cv2.INTER_NEAREST)

    def px(x, y):
        return int((x + grid.half_width_m) / grid.cell_m * scale), int(y / grid.cell_m * scale)

    for m in range(1, int(grid.max_range_m) + 1):  # 1 m range rings
        cv2.line(img, (0, m * 10 * scale), (img.shape[1], m * 10 * scale), (203, 213, 225), 1)
    if plan.ok and len(plan.points_m) > 1:
        pts = np.array([px(x, y) for x, y in plan.points_m], np.int32)
        cv2.polylines(img, [pts], False, PLAN_BGR, max(2, int(2 * half_w / grid.cell_m * scale)), cv2.LINE_AA)
        cv2.polylines(img, [pts], False, (15, 23, 42), 1, cv2.LINE_AA)
    cv2.circle(img, px(0, 0), 6, (15, 23, 42), -1)
    return _png_data_url(cv2.flip(img, 0))  # far away at the top, like a map


def _strip_polygon(cam: Camera, pts: list[tuple[float, float]], half_w: float) -> tuple[list, list]:
    """Densify the centreline, offset both edges by half the strip width, project to the image."""
    if len(pts) < 2:
        return [], []
    dense = []
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        n = max(2, int(np.hypot(x1 - x0, y1 - y0) / 0.1))
        for t in np.linspace(0, 1, n, endpoint=False):
            dense.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    dense.append(pts[-1])
    d = np.array(dense)
    tang = np.gradient(d, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-9
    normal = np.stack([tang[:, 1], -tang[:, 0]], 1)
    left, right = d + normal * half_w, d - normal * half_w
    poly = np.vstack([left, right[::-1]])
    u, v, _ = cam.ground_to_image(poly[:, 0], poly[:, 1])
    cu, cv_, _ = cam.ground_to_image(d[:, 0], d[:, 1])
    return ([[round(float(a), 1), round(float(b), 1)] for a, b in zip(u, v)],
            [[round(float(a), 1), round(float(b), 1)] for a, b in zip(cu, cv_)])


def estimate_pitch(groups: np.ndarray, hfov_deg: float) -> float | None:
    """Horizon guess for frames without an orientation sensor: just above where the visible ground ends.

    Buildings or kerbs that end the ground early make this guess too steep (distances read short).
    """
    h, w = groups.shape
    ground_rows = np.where(np.isin(groups, (LAYABLE, MARGINAL, CARRIAGEWAY)).mean(1) > 0.05)[0]
    if len(ground_rows) < h * 0.15:
        return None
    hy = ground_rows[0] - 0.03 * h
    f = (w / 2) / np.tan(np.radians(hfov_deg) / 2)
    return float(np.clip(np.degrees(np.arctan((h / 2 - hy) / f)), 8, 80))


VEHICLE_CLASSES = {"vehicle", "vendor_cart"}
CONFIDENT_DETECTION = 0.30
NOISE_BLOB_FRAC = 0.004
TILE_BLOB_FRAC = 0.08


def absorb_enclosed_blobs(groups: np.ndarray, tiles: np.ndarray) -> int:
    """Non-ground blobs enclosed by walkway are usually texture the segmenter mislabels: small ones (stains, shadows)
    and larger ones ringed by tactile tiles (the dark dots of a warning field). Detected obstacles are painted
    afterwards, so real ones are kept. `groups` and `tiles` are updated in place."""
    h, w = groups.shape
    tile = tiles  # boolean, updated in place
    k = np.ones((5, 5), np.uint8)
    walk = (groups == LAYABLE) | (groups == MARGINAL)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((groups == BLOCKED).astype(np.uint8), connectivity=8)
    changed = 0
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area > TILE_BLOB_FRAC * h * w or x == 0 or y == 0 or x + bw >= w or y + bh >= h:
            continue
        y0, y1, x0, x1 = max(0, y - 3), min(h, y + bh + 3), max(0, x - 3), min(w, x + bw + 3)
        comp = (lab[y0:y1, x0:x1] == i).astype(np.uint8)
        ring = (cv2.dilate(comp, k) > 0) & (comp == 0)
        if not ring.any():
            continue
        small = area <= NOISE_BLOB_FRAC * h * w and walk[y0:y1, x0:x1][ring].mean() >= 0.9
        tiled = tile[y0:y1, x0:x1][ring].mean() >= 0.6
        if small or tiled:
            sub = groups[y0:y1, x0:x1]
            sub[comp > 0] = LAYABLE if tiled or (sub[ring] == LAYABLE).mean() >= 0.5 else MARGINAL
            if tiled:
                tile[y0:y1, x0:x1][comp > 0] = True
            changed += 1
    return changed


def analyze_frame(bgr: np.ndarray, *, pitch_deg: float | None, height_m: float, hfov_deg: float,
                  params: PlanParams, detect_obstacles: bool = True, quality: str = "") -> dict:
    t0 = time.perf_counter()
    h0, w0 = bgr.shape[:2]
    if w0 != ANALYSIS_WIDTH:
        bgr = cv2.resize(bgr, (ANALYSIS_WIDTH, int(round(h0 * ANALYSIS_WIDTH / w0))), interpolation=cv2.INTER_AREA)
    h, w = bgr.shape[:2]
    sx = w0 / w
    timings: dict[str, int] = {}
    notes: list[str] = []

    seg = get_surface_segmenter(quality)
    if not seg.available:
        return {"ok": False, "code": "surface_unavailable", "message": seg.reason}

    dets = []
    det = get_obstacle_detector()
    if detect_obstacles and det.available:
        t = time.perf_counter()
        dets = det.detect(bgr)
        timings["obstacles_ms"] = int((time.perf_counter() - t) * 1000)
    elif detect_obstacles:
        notes.append(f"Object detector unavailable ({det.reason}); obstacles come from surface segmentation only.")

    t = time.perf_counter()
    groups, _ = seg.segment(bgr, vehicles_detected=any(d.class_name in VEHICLE_CLASSES for d in dets))
    timings["surface_ms"] = int((time.perf_counter() - t) * 1000)

    pitch_source = "sensor_or_user"
    if pitch_deg is None:
        pitch_deg = estimate_pitch(groups, hfov_deg)
        pitch_source = "estimated"
        if pitch_deg is None:
            pitch_deg, pitch_source = 40.0, "default"
            notes.append("Too little ground in view to estimate camera tilt; assumed 40 degrees.")
    cam = Camera(w, h, hfov_deg=hfov_deg, pitch_deg=pitch_deg, height_m=height_m)

    # Everything above the horizon cannot be ground.
    hy = int(np.clip(np.ceil(cam.horizon_y), 0, h))
    groups[:hy] = UNKNOWN

    # Yellow tiles only count on paved ground below the horizon (yellow leaves, grass and signs are not paving).
    tiles = _tiles.segment(bgr).mask
    tiles[:hy] = 0
    tiles[groups != LAYABLE] = 0
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    tiles = cv2.morphologyEx(tiles, cv2.MORPH_CLOSE, k)  # fill the dark dots/bars between yellow
    tile_bool = (tiles > 0) & (groups != CARRIAGEWAY)
    absorb_enclosed_blobs(groups, tile_bool)
    groups[tile_bool] = LAYABLE
    tiles = tile_bool.astype(np.uint8) * 255

    obstacles = []
    for d in dets:
        x1, y1, x2, y2 = [int(round(v)) for v in d.bbox]
        box = groups[max(0, y1):y2, max(0, x1):x2]
        # Weak detections only count when the segmenter agrees the box is not open ground (fewer false
        # "obstacles" on patterned paving); confident ones always count.
        confirmed = d.confidence >= CONFIDENT_DETECTION or (box.size and (box == BLOCKED).mean() >= 0.5)
        if not confirmed:
            pass
        elif d.class_name == "utility_cover":  # flush with the ground: a laying constraint, not a collision
            box[box != UNKNOWN] = HAZARD
        else:
            box[:] = BLOCKED
        gx, gy, valid = cam.image_to_ground(np.array([(x1 + x2) / 2]), np.array([float(y2)]))
        dist = round(float(np.hypot(gx[0], gy[0])), 1) if valid[0] and y2 > hy else None
        obstacles.append({"class": d.class_name, "prompt": d.prompt, "confidence": round(d.confidence, 2),
                          "bbox": [round(v * sx, 1) for v in d.bbox], "distance_m": dist, "avoided": bool(confirmed)})

    t = time.perf_counter()
    bev = to_birds_eye(groups, cam, GRID, fill=UNKNOWN)
    bev_tiles = to_birds_eye(tiles, cam, GRID, fill=0) > 0
    plan = plan_strip(bev, GRID, params, existing=bev_tiles)
    timings["plan_ms"] = int((time.perf_counter() - t) * 1000)
    half_w = params.strip_width_tiles * 0.15
    poly, centre = _strip_polygon(cam, plan.points_m, half_w) if plan.ok else ([], [])
    timings["total_ms"] = int((time.perf_counter() - t0) * 1000)
    below = groups[hy:] if hy < h else groups[:0]
    return {
        "ok": True,
        "frame": {"width": w0, "height": h0},
        "camera": {"pitch_deg": round(pitch_deg, 1), "pitch_source": pitch_source, "height_m": height_m,
                   "hfov_deg": hfov_deg, "horizon_y": round(float(cam.horizon_y) * sx, 1)},
        "plan": {**asdict(plan), "strip_polygon": [[x * sx, y * sx] for x, y in poly],
                 "centreline": [[x * sx, y * sx] for x, y in centre]},
        "obstacles": obstacles,
        "surface": {"overlay_png": _surface_overlay(groups, tiles), "fractions": group_counts(below) if below.size else {},
                    "existing_tactile_fraction": round(float((tiles[hy:] > 0).mean()), 3) if hy < h else 0.0},
        "birds_eye_png": _birds_eye_png(bev, bev_tiles, plan, GRID, half_w),
        "grid": {"cell_m": GRID.cell_m, "half_width_m": GRID.half_width_m, "max_range_m": GRID.max_range_m},
        "models": {"surface": f"{seg.name}:{seg.version}",
                   "obstacles": f"{det.name}:{det.version}" if det.available else "unavailable",
                   "tiles": f"{_tiles.name}:{_tiles.version}"},
        "timings": timings,
        "notes": notes + plan.notes,
        "disclaimer": "Proposal from pretrained models that were not trained on tactile paving, on an assumed flat "
                      "ground plane. Verify on site before marking out.",
    }
