"""Synthetic tactile-strip scenes with known ground truth.

Used by unit tests and for clearly labelled demo images. They are drawings, not field photos, and must never
be used to report model accuracy.
"""
import cv2
import numpy as np

YELLOW = (20, 185, 235)
YELLOW_DARK = (10, 140, 190)
PAVEMENT = (165, 175, 185)


def _tile(kind: str, size: int) -> np.ndarray:
    t = np.full((size, size, 3), YELLOW, np.uint8)
    if kind == "directional":
        n = 4
        for i in range(n):
            cx = int((i + 0.5) * size / n)
            cv2.rectangle(t, (cx - size // 18, size // 10), (cx + size // 18, size - size // 10), YELLOW_DARK, -1)
            cv2.line(t, (cx - size // 18, size // 10), (cx - size // 18, size - size // 10), (5, 90, 140), 1)
    else:
        n = 5
        for i in range(n):
            for j in range(n):
                c = (int((i + 0.5) * size / n), int((j + 0.5) * size / n))
                cv2.circle(t, c, size // 16, YELLOW_DARK, -1)
                cv2.circle(t, c, size // 16, (5, 90, 140), 1)
    cv2.rectangle(t, (0, 0), (size - 1, size - 1), (40, 60, 70), 2)  # grout joint
    return t


def strip_scene(
    n_tiles: int = 14,
    tile_px: int = 60,
    width_tiles: int = 1,
    gap: tuple[int, int] | None = None,
    warning_at: tuple[str, ...] = (),
    perspective: float = 0.35,
    obstacle_at: int | None = None,
    margin_tiles: float = 1.5,
    out_size: tuple[int, int] = (960, 1280),
    seed: int = 0,
) -> tuple[np.ndarray, dict]:
    """Render a straight strip running away from the camera. Tile 0 is the far end (top of image).

    gap=(start, count) removes `count` tiles starting at index `start`. warning_at may contain "start"/"end".
    Returns (bgr_image, ground_truth).
    """
    rng = np.random.default_rng(seed)
    cw = int(tile_px * (width_tiles + 3))
    ch = int(tile_px * (n_tiles + 2 * margin_tiles))
    canvas = np.full((ch, cw, 3), PAVEMENT, np.uint8)
    noise = rng.normal(0, 7, (ch, cw, 1)).astype(np.int16)
    canvas = np.clip(canvas.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    x0 = (cw - width_tiles * tile_px) // 2
    y0 = int(margin_tiles * tile_px)
    gap_set = set(range(gap[0], gap[0] + gap[1])) if gap else set()
    for i in range(n_tiles):
        if i in gap_set:
            continue
        kind = "directional"
        if (i == 0 and "start" in warning_at) or (i == n_tiles - 1 and "end" in warning_at):
            kind = "warning"
        for j in range(width_tiles):
            canvas[y0 + i * tile_px: y0 + (i + 1) * tile_px, x0 + j * tile_px: x0 + (j + 1) * tile_px] = _tile(kind, tile_px)
    if obstacle_at is not None:
        cy = y0 + int((obstacle_at + 0.5) * tile_px)
        cv2.circle(canvas, (cw // 2, cy), int(tile_px * 0.45), (90, 90, 95), -1)

    W, H = out_size
    top_half = W * (0.5 - perspective / 2) * 0.9
    src = np.float32([[0, 0], [cw, 0], [cw, ch], [0, ch]])
    dst = np.float32([[W / 2 - top_half / 2 * 0.6, H * 0.04], [W / 2 + top_half / 2 * 0.6, H * 0.04],
                      [W * 0.95, H * 0.98], [W * 0.05, H * 0.98]])
    Hm = cv2.getPerspectiveTransform(src, dst)
    bg = np.full((H, W, 3), (120, 140, 150), np.uint8)
    img = cv2.warpPerspective(canvas, Hm, (W, H), dst=bg, borderMode=cv2.BORDER_TRANSPARENT)

    obstacle_bbox = None
    if obstacle_at is not None:
        cy = y0 + int((obstacle_at + 0.5) * tile_px)
        r = tile_px * 0.45
        pts = cv2.perspectiveTransform(np.float32([[[cw / 2 - r, cy - r]], [[cw / 2 + r, cy + r]]]), Hm).reshape(-1, 2)
        bx1, by1, bx2, by2 = pts[0][0], pts[0][1], pts[1][0], pts[1][1]
        obstacle_bbox = [float(bx1), float(by1 - (by2 - by1) * 2), float(bx2), float(by2)]
        cv2.rectangle(img, (int(bx1) + 4, int(obstacle_bbox[1])), (int(bx2) - 4, int(by2)), (80, 80, 85), -1)

    truth = {"n_tiles": n_tiles, "width_tiles": width_tiles, "gap": gap, "warning_at": warning_at,
             "obstacle_bbox": obstacle_bbox, "synthetic": True}
    return img, truth
