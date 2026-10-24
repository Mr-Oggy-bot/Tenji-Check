"""Face and licence-plate blurring for stored display copies (OpenCV Haar cascades; best-effort, not guaranteed)."""
from functools import lru_cache

import cv2
import numpy as np


@lru_cache
def _cascades():
    base = cv2.data.haarcascades
    return (cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml"),
            cv2.CascadeClassifier(base + "haarcascade_russian_plate_number.xml"))


def blur_sensitive(bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    faces_cc, plates_cc = _cascades()
    gray = cv2.equalizeHist(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
    min_side = max(24, min(gray.shape) // 40)
    faces = faces_cc.detectMultiScale(gray, 1.1, 6, minSize=(min_side, min_side))
    plates = plates_cc.detectMultiScale(gray, 1.1, 5, minSize=(min_side * 2, min_side // 2))
    out = bgr.copy()
    for x, y, w, h in [*faces, *plates]:
        pad = int(0.15 * max(w, h))
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(out.shape[1], x + w + pad), min(out.shape[0], y + h + pad)
        roi = out[y0:y1, x0:x1]
        k = max(15, (max(roi.shape[:2]) // 3) | 1)
        out[y0:y1, x0:x1] = cv2.GaussianBlur(roi, (k, k), 0)
    return out, {"faces_blurred": int(len(faces)), "plates_blurred": int(len(plates)), "method": "opencv-haar"}
