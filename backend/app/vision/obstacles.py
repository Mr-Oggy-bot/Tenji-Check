"""Open-vocabulary obstacle detection with pretrained YOLO-World (text prompts, no TenjiCheck fine-tuning).

The first load embeds the prompt vocabulary and saves a local copy, so later starts do not need CLIP.
If the model cannot be loaded, the detector reports itself unavailable and callers must not treat that as
"no obstacle".
"""
import logging
import threading
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from ..config import get_settings

log = logging.getLogger(__name__)

# prompt -> normalised obstacle class
PROMPTS = {
    "pole": "pole",
    "lamp post": "pole",
    "electric pole": "pole",
    "tree trunk": "tree",
    "tree": "tree",
    "bollard": "bollard",
    "signboard": "signboard",
    "parked motorcycle": "vehicle",
    "parked scooter": "vehicle",
    "parked car": "vehicle",
    "bench": "bench",
    "dustbin": "bin",
    "street vendor cart": "vendor_cart",
    "pillar": "pillar",
    "fire hydrant": "hydrant",
    "manhole cover": "utility_cover",
    "drain cover": "utility_cover",
    "utility box": "utility_box",
    "construction barrier": "barrier",
}
UTILITY_CLASSES = {"utility_cover"}


@dataclass
class Detection:
    class_name: str
    prompt: str
    confidence: float
    bbox: list[float]


class UnavailableDetector:
    name = "obstacle-detector"
    version = "unavailable"
    available = False

    def __init__(self, reason: str):
        self.reason = reason

    def detect(self, bgr: np.ndarray) -> list[Detection]:
        raise RuntimeError(self.reason)


class YoloWorldDetector:
    available = True
    reason = ""

    def __init__(self, base: str, conf: float):
        from ultralytics import YOLOWorld

        models_dir = get_settings().models_dir
        models_dir.mkdir(parents=True, exist_ok=True)
        custom = models_dir / f"tenjicheck-{base.replace('.pt', '')}-v{len(PROMPTS)}.pt"
        if custom.exists():
            self.model = YOLOWorld(str(custom))
        else:
            self.model = YOLOWorld(str(models_dir / base))
            self.model.set_classes(list(PROMPTS))
            if hasattr(self.model.model, "clip_model"):
                del self.model.model.clip_model  # text features are embedded; CLIP is not needed at inference
            self.model.save(str(custom))
        self.name = "yolo-world"
        self.version = custom.stem
        self.conf = conf
        self._lock = threading.Lock()

    def detect(self, bgr: np.ndarray) -> list[Detection]:
        with self._lock:
            res = self.model.predict(bgr, conf=self.conf, imgsz=640, verbose=False)[0]
        names = res.names
        out = []
        for box, cls, conf in zip(res.boxes.xyxy.cpu().numpy(), res.boxes.cls.cpu().numpy(), res.boxes.conf.cpu().numpy()):
            prompt = names[int(cls)]
            out.append(Detection(PROMPTS.get(prompt, prompt), prompt, float(conf), [float(v) for v in box]))
        return _suppress_duplicates(out)


def _iou(a, b) -> float:
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _suppress_duplicates(dets: list[Detection]) -> list[Detection]:
    """Synonym prompts (e.g. 'pole'/'lamp post') fire on the same object; keep the most confident box."""
    kept: list[Detection] = []
    for d in sorted(dets, key=lambda d: -d.confidence):
        if all(_iou(d.bbox, k.bbox) < 0.6 for k in kept):
            kept.append(d)
    return kept


_lock = threading.Lock()


@lru_cache
def _load():
    s = get_settings()
    if not s.obstacle_enabled:
        return UnavailableDetector("Obstacle detection disabled by configuration (TC_OBSTACLE_ENABLED=false)")
    try:
        return YoloWorldDetector(s.obstacle_model, s.obstacle_confidence)
    except Exception as exc:  # noqa: BLE001
        log.warning("Obstacle detector unavailable: %s", exc)
        return UnavailableDetector(f"Obstacle model could not be loaded: {exc.__class__.__name__}: {exc}")


def get_obstacle_detector():
    with _lock:
        return _load()
