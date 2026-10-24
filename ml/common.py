"""Shared helpers for the TenjiCheck dataset / training / evaluation scripts."""
import csv
from pathlib import Path

# Proposed taxonomy (PRD+TRD §5). Only classes that are actually labelled should appear in data.yaml.
CLASSES = [
    "blocked_tactile_path", "damaged_tactile_tile", "missing_tactile_tile", "interrupted_guidance_path",
    "warning_tile_present", "directional_tile_present", "ordinary_obstacle",
]
# Model / rule output names -> taxonomy names, so the deployed pipeline can be scored against labels.
SYSTEM_TO_TAXONOMY = {
    "obstacle_on_path": "blocked_tactile_path",
    "interrupted_path": "interrupted_guidance_path",
    "missing_warning_tiles": "missing_tactile_tile",
    "damaged_tactile_tile": "damaged_tactile_tile",
}
MANIFEST_FIELDS = ["image_id", "file", "split", "capture_site_id", "capture_route_id", "capture_session_id", "capture_date",
                   "device_class", "lighting", "defect_staged", "annotator", "label_version", "source", "license", "needs_review"]


def read_manifest(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    missing = [c for c in ("image_id", "file") if rows and c not in rows[0]]
    if missing:
        raise ValueError(f"Manifest is missing required columns: {missing}")
    return rows


def write_manifest(path: Path, rows: list[dict]) -> None:
    fields = list(dict.fromkeys(MANIFEST_FIELDS + [k for r in rows for k in r]))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def read_yolo_labels(path: Path, names: list[str], img_w: int = 1, img_h: int = 1, with_conf: bool = False) -> list[dict]:
    """Reads 'class xc yc w h [conf]' lines (normalised) into xyxy boxes in image pixels."""
    out = []
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        c, xc, yc, w, h = int(parts[0]), *map(float, parts[1:5])
        box = [(xc - w / 2) * img_w, (yc - h / 2) * img_h, (xc + w / 2) * img_w, (yc + h / 2) * img_h]
        d = {"class_name": names[c], "bbox": box}
        if with_conf:
            d["confidence"] = float(parts[5]) if len(parts) > 5 else 1.0
        out.append(d)
    return out


def iou(a, b) -> float:
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0
