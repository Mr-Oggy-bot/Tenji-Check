"""Tests for the dataset/evaluation tooling in ml/ (no real dataset needed)."""
import json
import sys
from pathlib import Path

import pytest

ML = Path(__file__).resolve().parents[2] / "ml"
sys.path[:0] = [str(ML), str(ML / "training"), str(ML / "evaluation")]

from evaluate import evaluate_dir, match  # noqa: E402
from kappa import cohens_kappa  # noqa: E402
from make_splits import assign_splits  # noqa: E402


def rows(groups):
    return [{"image_id": f"{g}-{i}", "file": f"{g}-{i}.jpg", "capture_route_id": g} for g, n in groups.items() for i in range(n)]


def test_splits_keep_groups_together_and_hold_out_route():
    r = assign_splits(rows({"A": 30, "B": 25, "C": 20, "D": 15, "E": 10}), holdout="E")
    by_group = {}
    for x in r:
        by_group.setdefault(x["capture_route_id"], set()).add(x["split"])
    assert all(len(s) == 1 for s in by_group.values())  # no group spans splits (no leakage)
    assert by_group["E"] == {"test"}
    assert {"train", "val"} <= {s for g, ss in by_group.items() if g != "E" for s in ss}
    assert "test" not in {s for g, ss in by_group.items() if g != "E" for s in ss}


def test_splits_require_group_and_valid_holdout():
    with pytest.raises(ValueError):
        assign_splits([{"image_id": "x", "file": "x.jpg", "capture_route_id": ""}])
    with pytest.raises(ValueError):
        assign_splits(rows({"A": 3}), holdout="Z")


def test_cohens_kappa_known_values():
    assert cohens_kappa(list("aabb"), list("aabb")) == 1.0
    assert cohens_kappa(list("abab"), list("baba")) == pytest.approx(-1.0)
    # 2x2 example: po = 35/50 = 0.7, pe = (35*30 + 15*20)/2500 = 0.54, kappa = 0.16/0.46
    a = ["y"] * 25 + ["y"] * 10 + ["n"] * 5 + ["n"] * 10
    b = ["y"] * 25 + ["n"] * 10 + ["y"] * 5 + ["n"] * 10
    assert cohens_kappa(a, b) == pytest.approx(0.16 / 0.46, abs=1e-9)


def test_matching_counts_tp_fp_fn():
    gts = [{"class_name": "blocked_tactile_path", "bbox": [0, 0, 10, 10]}, {"class_name": "blocked_tactile_path", "bbox": [50, 50, 60, 60]}]
    preds = [{"class_name": "blocked_tactile_path", "bbox": [1, 1, 10, 10], "confidence": 0.9},
             {"class_name": "blocked_tactile_path", "bbox": [100, 100, 110, 110], "confidence": 0.8},
             {"class_name": "interrupted_guidance_path", "bbox": [50, 50, 60, 60], "confidence": 0.7}]
    s = match(gts, preds, 0.5)
    assert s["blocked_tactile_path"] == {"tp": 1, "fp": 1, "fn": 1}
    assert s["interrupted_guidance_path"] == {"tp": 0, "fp": 1, "fn": 0}


def test_evaluate_pipeline_json_predictions(tmp_path):
    labels, preds = tmp_path / "labels", tmp_path / "preds"
    labels.mkdir()
    preds.mkdir()
    (labels / "img1.txt").write_text("0 0.5 0.5 0.2 0.2\n")
    (labels / "img2.txt").write_text("")  # hard negative
    (preds / "img1.json").write_text(json.dumps({"width": 100, "height": 100, "candidates": [
        {"defect_class": "obstacle_on_path", "bbox": [40, 40, 60, 60], "confidence": 0.6, "verify_on_site": False}]}))
    (preds / "img2.json").write_text(json.dumps({"width": 100, "height": 100, "candidates": [
        {"defect_class": "unassessable", "bbox": None, "confidence": None, "verify_on_site": True}]}))
    rep = evaluate_dir(labels, preds, ["blocked_tactile_path"])
    assert rep["images"] == 2 and rep["verify_on_site_candidates"] == 1
    assert rep["per_class"]["blocked_tactile_path"]["recall"] == 1.0
