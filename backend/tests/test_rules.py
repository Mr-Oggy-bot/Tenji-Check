import numpy as np

from app.rules.engine import evaluate
from app.vision.geometry import analyze_strip, fit_strip
from app.vision.obstacles import Detection
from app.vision.synthetic import strip_scene
from app.vision.tiles import ClassicalTileSegmenter


def run(context="segment", obstacles=(), **kw):
    img, truth = strip_scene(**kw)
    seg = ClassicalTileSegmenter().segment(img)
    geom = fit_strip(seg.mask)
    strip = analyze_strip(img, seg, geom) if geom else None
    cands, notes = evaluate(context, seg.area_fraction, geom, strip, list(obstacles), img.shape)
    return cands, notes, truth


def classes(cands):
    return sorted(c["defect_class"] for c in cands if not c["verify_on_site"])


def test_gap_wider_than_one_tile_is_interrupted_path():
    cands, _, _ = run(gap=(6, 2), warning_at=("start", "end"))
    assert classes(cands) == ["interrupted_path"]
    c = cands[0]
    assert c["measurement"]["gap_tiles"] > 1.0
    assert "3.7" in c["rule_reference"] and c["required_fix"]


def test_continuous_strip_has_no_defects():
    cands, _, _ = run(warning_at=("start", "end"))
    assert cands == []


def test_crossing_without_warning_band_flags_missing_warning():
    cands, _, _ = run(context="crossing")
    assert classes(cands) == ["missing_warning_tiles"]


def test_crossing_with_warning_band_passes():
    cands, _, _ = run(context="crossing", warning_at=("end",))
    assert classes(cands) == []


def test_obstacle_inside_corridor_is_flagged():
    _, _, truth = run(obstacle_at=5)
    det = Detection("pole", "pole", 0.71, truth["obstacle_bbox"])
    cands, _, _ = run(obstacle_at=5, obstacles=[det], warning_at=("start", "end"))
    obs = [c for c in cands if c["defect_class"] == "obstacle_on_path"]
    assert len(obs) == 1 and obs[0]["confidence"] == 0.71
    assert obs[0]["measurement"]["corridor_width_overlap"] > 0.15


def test_obstacle_beside_corridor_is_ignored():
    det = Detection("pole", "pole", 0.9, [10, 900, 60, 1100])
    cands, _, _ = run(obstacles=[det], warning_at=("start", "end"))
    assert not [c for c in cands if c["defect_class"] == "obstacle_on_path"]


def test_utility_cover_on_strip_counts_as_interruption():
    _, _, truth = run(obstacle_at=6)
    det = Detection("utility_cover", "manhole cover", 0.6, truth["obstacle_bbox"])
    cands, _, _ = run(obstacle_at=6, obstacles=[det], warning_at=("start", "end"))
    assert "interrupted_path" in classes(cands)
    assert "obstacle_on_path" not in classes(cands)


def test_no_tiles_defers_to_verify_on_site():
    blank = np.full((600, 800, 3), 140, np.uint8)
    seg = ClassicalTileSegmenter().segment(blank)
    cands, _ = evaluate("segment", seg.area_fraction, None, None, [], blank.shape)
    assert len(cands) == 1 and cands[0]["defect_class"] == "unassessable" and cands[0]["verify_on_site"]
    assert cands[0]["measurement"] == {}


def test_unavailable_detector_is_reported_not_silent():
    img, _ = strip_scene()
    seg = ClassicalTileSegmenter().segment(img)
    geom = fit_strip(seg.mask)
    _, notes = evaluate("segment", seg.area_fraction, geom, analyze_strip(img, seg, geom), None, img.shape)
    assert any("unavailable" in n for n in notes)
