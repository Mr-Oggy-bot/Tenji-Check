"""Draws model/rule evidence on the (privacy-blurred) display image for reviewers."""
import cv2
import numpy as np

RED = (60, 60, 230)
AMBER = (40, 170, 245)
GREEN = (120, 200, 40)


def _dashed_rect(img, p1, p2, color, thick=3, dash=14):
    x1, y1 = p1
    x2, y2 = p2
    for (a, b) in [((x1, y1), (x2, y1)), ((x2, y1), (x2, y2)), ((x2, y2), (x1, y2)), ((x1, y2), (x1, y1))]:
        a, b = np.array(a, float), np.array(b, float)
        length = np.linalg.norm(b - a)
        n = max(1, int(length // dash))
        for i in range(0, n, 2):
            s = a + (b - a) * i / n
            e = a + (b - a) * min(i + 1, n) / n
            cv2.line(img, tuple(int(v) for v in s), tuple(int(v) for v in e), color, thick, cv2.LINE_AA)


def _badge(img, text, org, color):
    scale = max(0.6, img.shape[1] / 1400)
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
    x, y = int(org[0]), int(max(th + 8, org[1]))
    cv2.rectangle(img, (x, y - th - 8), (x + tw + 12, y + 4), color, -1)
    cv2.putText(img, text, (x + 6, y - 3), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 2, cv2.LINE_AA)


def render(display_bgr: np.ndarray, quad: list | None, candidates: list[dict], finding_numbers: list[int] | None = None) -> np.ndarray:
    img = display_bgr.copy()
    overlay = img.copy()
    if quad is not None:
        q = np.array(quad, np.int32)
        cv2.fillPoly(overlay, [q], GREEN)
        img = cv2.addWeighted(overlay, 0.18, img, 0.82, 0)
        cv2.polylines(img, [q], True, GREEN, 2, cv2.LINE_AA)
    for i, c in enumerate(candidates):
        no = finding_numbers[i] if finding_numbers else i + 1
        color = AMBER if c.get("verify_on_site") else RED
        if c.get("bbox"):
            x1, y1, x2, y2 = (int(v) for v in c["bbox"])
            _dashed_rect(img, (x1, y1), (x2, y2), color)
            label = f"{no} {c.get('title', c['defect_class'])}"
            if c.get("verify_on_site"):
                label += " - verify on site"
            _badge(img, label, (x1, y1 - 6), color)
            if c["defect_class"] == "obstacle_on_path" and not c.get("verify_on_site"):
                cx, cy = (x1 + x2) // 2, y2
                r = int(0.75 * (x2 - x1))
                cv2.ellipse(img, (cx, cy), (r, max(10, r // 3)), 0, 0, 180, GREEN, 3, cv2.LINE_AA)
                _badge(img, "Proposed route - needs review", (cx - r, cy + r // 3 + 30), (60, 110, 30))
        else:
            _badge(img, f"{no} {c.get('title', c['defect_class'])} - verify on site", (10, 40 + 36 * i), color)
    return img
