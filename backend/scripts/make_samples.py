"""Writes synthetic, watermarked tactile-strip test images to ../sample_images (for demos and UI tests only).

Usage (from backend/):  python -m scripts.make_samples
"""
from pathlib import Path

import cv2

from app.vision.synthetic import strip_scene

OUT = Path(__file__).resolve().parents[2] / "sample_images"
SCENES = {
    "synthetic_gap_2_tiles.jpg": dict(gap=(6, 2), warning_at=("start", "end")),
    "synthetic_continuous_ok.jpg": dict(warning_at=("start", "end")),
    "synthetic_crossing_no_warning.jpg": dict(),
    "synthetic_crossing_with_warning.jpg": dict(warning_at=("end",)),
    "synthetic_obstacle_on_strip.jpg": dict(obstacle_at=5, warning_at=("start", "end")),
}


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, kw in SCENES.items():
        img, _ = strip_scene(**kw)
        cv2.putText(img, "SYNTHETIC TEST IMAGE", (20, img.shape[0] - 24), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.imwrite(str(OUT / name), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if name == "synthetic_continuous_ok.jpg":
            cv2.imwrite(str(OUT / "synthetic_blurry_retake.jpg"), cv2.GaussianBlur(img, (41, 41), 15))
    print(f"Wrote {len(SCENES) + 1} images to {OUT}")


if __name__ == "__main__":
    main()
