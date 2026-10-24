"""OpenCV quality gate: blur (variance of Laplacian) and exposure checks, run before any inference."""
import cv2
import numpy as np

from ..config import get_settings


def assess_quality(bgr: np.ndarray) -> dict:
    s = get_settings()
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    scale = 800 / gray.shape[1]
    if scale < 1:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean = float(gray.mean() / 255)
    dark = float((gray < 15).mean())
    bright = float((gray > 245).mean())

    problems = []
    if blur_var < s.blur_min_variance:
        problems.append({"code": "blurry", "message": "Photo is blurry. Hold the phone steady and retake."})
    if mean < s.exposure_min_mean or dark > 0.45:
        problems.append({"code": "underexposed", "message": "Photo is too dark. Retake with more light or avoid deep shade."})
    if mean > s.exposure_max_mean or bright > 0.35:
        problems.append({"code": "overexposed", "message": "Photo is overexposed. Avoid pointing at the sun or glare."})
    return {
        "ok": not problems,
        "blur_variance": round(blur_var, 1),
        "blur_threshold": s.blur_min_variance,
        "mean_brightness": round(mean, 3),
        "dark_fraction": round(dark, 3),
        "bright_fraction": round(bright, 3),
        "problems": problems,
    }
