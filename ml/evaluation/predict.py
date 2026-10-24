"""Runs the deployed TenjiCheck pipeline (quality gate -> tiles -> homography -> obstacles -> rules) on a folder of
test images and writes one JSON of candidate findings per image, for scoring with evaluate.py.

    python ml/evaluation/predict.py --images dataset/images/test --manifest manifest.csv --out preds/
(run from the repository root with the backend virtualenv active)
"""
import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

import cv2  # noqa: E402

from app.rules.engine import evaluate  # noqa: E402
from app.vision.geometry import analyze_strip, fit_strip  # noqa: E402
from app.vision.obstacles import get_obstacle_detector  # noqa: E402
from app.vision.quality import assess_quality  # noqa: E402
from app.vision.tiles import get_tile_segmenter  # noqa: E402


def run_one(path: Path, context: str) -> dict:
    bgr = cv2.imread(str(path))
    q = assess_quality(bgr)
    seg = get_tile_segmenter().segment(bgr)
    geom = fit_strip(seg.mask)
    strip = analyze_strip(bgr, seg, geom) if geom else None
    det = get_obstacle_detector()
    obstacles = det.detect(bgr) if det.available else None
    cands, notes = evaluate(context, seg.area_fraction, geom, strip, obstacles, bgr.shape)
    return {"image": path.name, "width": bgr.shape[1], "height": bgr.shape[0], "quality": q, "notes": notes,
            "obstacle_model": det.version, "tile_model": f"{seg.method}:{seg.model_version}", "candidates": cands}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--manifest", type=Path, help="optional CSV with columns file,context_tag")
    a = ap.parse_args()
    ctx = {}
    if a.manifest:
        with open(a.manifest, newline="", encoding="utf-8") as f:
            ctx = {Path(r["file"]).name: r.get("context_tag") or "segment" for r in csv.DictReader(f)}
    a.out.mkdir(parents=True, exist_ok=True)
    imgs = sorted(p for p in a.images.glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    for p in imgs:
        (a.out / f"{p.stem}.json").write_text(json.dumps(run_one(p, ctx.get(p.name, "segment")), indent=1))
    print(f"Wrote predictions for {len(imgs)} image(s) to {a.out}")


if __name__ == "__main__":
    main()
