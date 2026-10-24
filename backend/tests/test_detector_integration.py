"""Runs the real pretrained YOLO-World detector when its weights are present (skipped otherwise)."""
import pytest

from app.config import get_settings

pytest.importorskip("ultralytics")
WEIGHTS = get_settings().models_dir


@pytest.mark.skipif(not any(WEIGHTS.glob("tenjicheck-*.pt")) and not (WEIGHTS / "yolov8s-worldv2.pt").exists(),
                    reason="YOLO-World weights not downloaded")
def test_real_detector_returns_structured_detections():
    import cv2
    from ultralytics.utils import ASSETS

    from app.vision.obstacles import PROMPTS, YoloWorldDetector

    det = YoloWorldDetector(get_settings().obstacle_model, 0.15)
    out = det.detect(cv2.imread(str(ASSETS / "bus.jpg")))
    assert isinstance(out, list)
    for d in out:
        assert d.prompt in PROMPTS and 0 < d.confidence <= 1 and len(d.bbox) == 4
