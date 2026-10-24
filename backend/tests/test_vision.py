import cv2
import numpy as np
import pytest

from app.vision.geometry import analyze_strip, fit_strip
from app.vision.imageio import UploadError, normalize_upload
from app.vision.privacy import blur_sensitive
from app.vision.quality import assess_quality
from app.vision.synthetic import strip_scene
from app.vision.tiles import ClassicalTileSegmenter


def _strip(**kw):
    img, truth = strip_scene(**kw)
    seg = ClassicalTileSegmenter().segment(img)
    geom = fit_strip(seg.mask)
    assert geom is not None
    return analyze_strip(img, seg, geom), truth


def test_quality_gate_accepts_sharp_and_rejects_blur_and_dark():
    img, _ = strip_scene()
    assert assess_quality(img)["ok"]
    blurred = assess_quality(cv2.GaussianBlur(img, (41, 41), 15))
    assert not blurred["ok"] and blurred["problems"][0]["code"] == "blurry"
    dark = assess_quality((img * 0.05).astype(np.uint8))
    assert any(p["code"] == "underexposed" for p in dark["problems"])


def test_upload_validation_rejects_bad_files():
    with pytest.raises(UploadError, match="Unsupported"):
        normalize_upload(b"GIF89a....")
    with pytest.raises(UploadError, match="corrupt"):
        normalize_upload(b"\xff\xd8\xff" + b"\x00" * 200)
    small = cv2.imencode(".png", np.zeros((50, 50, 3), np.uint8))[1].tobytes()
    with pytest.raises(UploadError, match="resolution"):
        normalize_upload(small)
    with pytest.raises(UploadError, match="empty"):
        normalize_upload(b"")


def test_upload_is_reencoded_as_jpeg():
    img, _ = strip_scene()
    png = cv2.imencode(".png", img)[1].tobytes()
    out = normalize_upload(png)
    assert out.jpeg.startswith(b"\xff\xd8\xff") and out.width == img.shape[1]


@pytest.mark.parametrize("gap,expected", [((6, 2), 2.0), ((5, 3), 3.0), ((3, 1), 1.0)])
def test_homography_measures_gaps_in_tile_units(gap, expected):
    s, _ = _strip(gap=gap)
    assert s["reliable"]
    assert len(s["gaps"]) == 1
    assert s["gaps"][0]["length_tiles"] == pytest.approx(expected, abs=0.25)


def test_measurement_is_robust_to_stronger_perspective():
    s, _ = _strip(perspective=0.6, gap=(7, 2))
    assert s["gaps"][0]["length_tiles"] == pytest.approx(2.0, abs=0.3)
    assert s["length_tiles"] == pytest.approx(14, abs=1.0)


def test_no_gap_on_continuous_strip():
    s, _ = _strip()
    assert s["gaps"] == []


def test_texture_distinguishes_warning_from_directional():
    s, _ = _strip(warning_at=("start", "end"))
    assert s["ends"]["start"]["type"] == "warning"
    assert s["ends"]["end"]["type"] == "warning"
    middle = [b["type"] for b in s["blocks"][2:-2]]
    assert middle.count("directional") >= len(middle) - 1


def test_no_strip_returns_none():
    blank = np.full((600, 800, 3), 140, np.uint8)
    seg = ClassicalTileSegmenter().segment(blank)
    assert fit_strip(seg.mask) is None


def test_privacy_blur_returns_counts_and_same_shape():
    img, _ = strip_scene()
    out, info = blur_sensitive(img)
    assert out.shape == img.shape
    assert {"faces_blurred", "plates_blurred"} <= info.keys()
