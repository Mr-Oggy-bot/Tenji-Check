"""Fine-tunes a small pretrained Ultralytics model on the labelled TenjiCheck dataset.

    python ml/training/train.py --data path/to/data.yaml --task segment --model yolov8n-seg.pt --epochs 50

Refuses to start when splits have no labels, so an empty run is never mistaken for a trained model.
Writes a run record (dataset hash, params, weights SHA-256) for the model card. Review the Ultralytics
licence (AGPL-3.0) against your deployment before shipping the weights.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import yaml


def check_dataset(data_yaml: Path) -> dict:
    cfg = yaml.safe_load(data_yaml.read_text())
    root = Path(cfg.get("path", data_yaml.parent))
    counts = {}
    for split in ("train", "val"):
        img_dir = root / cfg[split]
        lbl_dir = Path(str(img_dir).replace("images", "labels"))
        imgs = [p for p in img_dir.glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png")] if img_dir.exists() else []
        labelled = [p for p in imgs if (lbl_dir / f"{p.stem}.txt").exists()]
        counts[split] = {"images": len(imgs), "with_label_file": len(labelled)}
        if not labelled:
            raise SystemExit(f"No labelled images in '{split}' ({img_dir}). Label data before training.")
    return {"classes": cfg["names"], "counts": counts}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--task", choices=("detect", "segment"), default="segment")
    ap.add_argument("--model", default="yolov8n-seg.pt")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--project", default="runs/tenjicheck")
    a = ap.parse_args()

    info = check_dataset(a.data)
    from ultralytics import YOLO

    model = YOLO(a.model)
    # Modest augmentation only: do not augment away the tactile pattern itself.
    res = model.train(data=str(a.data), epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, project=a.project,
                      hsv_h=0.01, hsv_s=0.4, hsv_v=0.3, degrees=3, scale=0.2, perspective=0.0005, fliplr=0.5, mosaic=0.5)
    best = Path(res.save_dir) / "weights" / "best.pt"
    record = {
        "trained_at": datetime.now(timezone.utc).isoformat(), "base_model": a.model, "task": a.task,
        "params": {"epochs": a.epochs, "imgsz": a.imgsz, "batch": a.batch},
        "dataset": info, "data_yaml_sha256": hashlib.sha256(a.data.read_bytes()).hexdigest(),
        "weights": str(best), "weights_sha256": hashlib.sha256(best.read_bytes()).hexdigest() if best.exists() else None,
        "note": "Validation metrics from training are not a held-out evaluation; run ml/evaluation/evaluate.py on the locked test split.",
    }
    (Path(res.save_dir) / "run_record.json").write_text(json.dumps(record, indent=2))
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
