"""Scores predictions against ground-truth YOLO labels on the locked test split. Recall is reported first.

    python ml/evaluation/evaluate.py --labels dataset/labels/test --preds preds/ --names data.yaml \
        --manifest manifest_split.csv --out ml/evaluation/reports/latest.json

Predictions are either evaluate-ready JSON from predict.py (deployed pipeline) or YOLO txt files with a
confidence column (raw detector). Matching: greedy by confidence, same class, IoU >= --iou. "Verify on site"
candidates are counted separately and are not treated as positive predictions. Writing to
reports/latest.json makes the dashboard and models page show the measured result.
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import SYSTEM_TO_TAXONOMY, iou, read_manifest, read_yolo_labels  # noqa: E402


def match(gts: list[dict], preds: list[dict], thr: float) -> dict[str, dict[str, int]]:
    stats: dict[str, dict[str, int]] = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    used = set()
    for p in sorted(preds, key=lambda p: -p.get("confidence", 1.0)):
        best, best_iou = None, thr
        for i, g in enumerate(gts):
            if i in used or g["class_name"] != p["class_name"]:
                continue
            v = iou(g["bbox"], p["bbox"])
            if v >= best_iou:
                best, best_iou = i, v
        if best is None:
            stats[p["class_name"]]["fp"] += 1
        else:
            used.add(best)
            stats[p["class_name"]]["tp"] += 1
    for i, g in enumerate(gts):
        if i not in used:
            stats[g["class_name"]]["fn"] += 1
    return stats


def summarise(s: dict[str, int]) -> dict:
    tp, fp, fn = s["tp"], s["fp"], s["fn"]
    recall = tp / (tp + fn) if tp + fn else None
    precision = tp / (tp + fp) if tp + fp else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
    return {"recall": recall, "precision": precision, "f1": f1, "tp": tp, "fp": fp, "fn": fn, "support": tp + fn}


def load_preds(path_stem: Path, names: list[str], w: int, h: int) -> tuple[list[dict], int, tuple[int, int] | None]:
    js = path_stem.with_suffix(".json")
    if js.exists():
        d = json.loads(js.read_text())
        preds, vos = [], 0
        for c in d["candidates"]:
            if c.get("verify_on_site") or not c.get("bbox"):
                vos += 1
                continue
            preds.append({"class_name": SYSTEM_TO_TAXONOMY.get(c["defect_class"], c["defect_class"]),
                          "bbox": c["bbox"], "confidence": c.get("confidence") or 0.5})
        return preds, vos, (d["width"], d["height"])
    return read_yolo_labels(path_stem.with_suffix(".txt"), names, w, h, with_conf=True), 0, None


def evaluate_dir(labels: Path, preds: Path, names: list[str], thr: float = 0.5, conditions: dict | None = None) -> dict:
    total: dict[str, dict[str, int]] = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    by_cond: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0}))
    images, verify_on_site = 0, 0
    for lbl in sorted(labels.glob("*.txt")):
        images += 1
        pred_list, vos, size = load_preds(preds / lbl.stem, names, 1, 1)
        w, h = size or (1, 1)  # JSON predictions are in pixels; YOLO txt predictions stay normalised
        gts = read_yolo_labels(lbl, names, w, h)
        verify_on_site += vos
        for cls, s in match(gts, pred_list, thr).items():
            for k in s:
                total[cls][k] += s[k]
                if conditions and lbl.stem in conditions:
                    by_cond[conditions[lbl.stem]][cls][k] += s[k]
    per_class = {c: summarise(s) for c, s in sorted(total.items())}
    return {
        "images": images, "iou_threshold": thr, "verify_on_site_candidates": verify_on_site,
        "per_class": per_class,
        "by_condition": {cond: {c: summarise(s) for c, s in d.items()} for cond, d in by_cond.items()},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--preds", type=Path, required=True)
    ap.add_argument("--names", type=Path, required=True, help="data.yaml with class names")
    ap.add_argument("--manifest", type=Path, help="adds per-condition breakdown (lighting)")
    ap.add_argument("--condition-column", default="lighting")
    ap.add_argument("--iou", type=float, default=0.5)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    raw = yaml.safe_load(a.names.read_text())["names"]
    names = [raw[i] for i in sorted(raw)] if isinstance(raw, dict) else list(raw)
    cond = None
    if a.manifest:
        cond = {Path(r["file"]).stem: r.get(a.condition_column) or "unknown" for r in read_manifest(a.manifest) if r.get("split") == "test"}
    rep = evaluate_dir(a.labels, a.preds, names, a.iou, cond)
    if rep["images"] == 0:
        raise SystemExit("No label files found; nothing evaluated.")
    rep.update(evaluated_at=datetime.now(timezone.utc).isoformat(), targets={"blocked_tactile_path_recall": 0.80},
               caveat="Measured on the provided held-out split only; report sample counts alongside metrics.")
    if "blocked_tactile_path" in rep["per_class"]:
        rep["per_class"]["obstacle_on_path"] = rep["per_class"]["blocked_tactile_path"]
    text = json.dumps(rep, indent=2)
    print(text)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text)


if __name__ == "__main__":
    main()
