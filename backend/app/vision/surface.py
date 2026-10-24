"""Walkable-surface segmentation with pretrained SegFormer (ADE20K, 150 classes; no TenjiCheck fine-tuning).

From a pedestrian's viewpoint ADE20K models are good at "is this ground?" but unreliable at "footpath or road?"
(close-up paving is often called road). So groups are built from summed class probabilities: ground vs not
ground, paved vs unpaved, and a surface is only called a carriageway when road clearly dominates and vehicles
are in view. Every plan still needs a site check.
"""
import logging
import threading
from functools import lru_cache

import cv2
import numpy as np

from ..config import get_settings

log = logging.getLogger(__name__)

# surface groups (values in the group map)
UNKNOWN, LAYABLE, MARGINAL, CARRIAGEWAY, BLOCKED, HAZARD = 0, 1, 2, 3, 4, 5
GROUP_NAMES = {UNKNOWN: "unknown", LAYABLE: "paved_walkway", MARGINAL: "unpaved", CARRIAGEWAY: "carriageway",
               BLOCKED: "obstacle", HAZARD: "hazard"}

_PAVED = {"floor", "sidewalk", "path", "runway", "road", "rug"}
_UNPAVED = {"grass", "earth", "field", "sand", "dirt track", "land"}
_HAZARD = {"stairs", "stairway", "step", "water", "river", "sea", "lake", "pool", "swimming pool", "escalator"}
_SKY = {"sky", "ceiling"}  # never ground; left unknown so they do not read as obstacles
_VEHICLES = {"car", "truck", "bus", "van", "minibike", "bicycle"}
VEHICLE_CONTEXT_FRAC = 0.005
ROAD_DOMINANCE = 0.65  # share of paved probability that must be "road" to call a carriageway
# Ground if p >= STRONG, or p >= WEAK and connected to strong ground. Patterned paving (tactile dots, bars)
# often splits its probability between "floor" and "building"; objects stay near zero.
GROUND_STRONG, GROUND_WEAK = 0.5, 0.3


def _hysteresis(p: np.ndarray, strong: float, weak: float) -> np.ndarray:
    n, lab = cv2.connectedComponents((p >= weak).astype(np.uint8), connectivity=8)
    keep = np.zeros(n, bool)
    keep[np.unique(lab[p >= strong])] = True
    keep[0] = False
    return keep[lab]

# name -> (folder in backend/models, inference height); width follows the frame aspect ratio
VARIANTS = {"fast": ("segformer-b0-ade", 384), "accurate": ("segformer-b2-ade", 384)}


class UnavailableSurface:
    name = "surface-segmenter"
    version = "unavailable"
    available = False

    def __init__(self, reason: str):
        self.reason = reason

    def segment(self, bgr: np.ndarray, vehicles_detected: bool = False):
        raise RuntimeError(self.reason)


class SegformerSurface:
    available = True
    reason = ""

    def __init__(self, path: str, height: int = 384):
        import torch
        from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

        self.torch = torch
        self.processor = SegformerImageProcessor.from_pretrained(path)
        self.model = SegformerForSemanticSegmentation.from_pretrained(path).eval()
        self.height = height
        self.labels = {int(k): v.strip() for k, v in self.model.config.id2label.items()}

        def ids(names):
            return [i for i, n in self.labels.items() if n in names]

        self.paved, self.unpaved, self.hazard = ids(_PAVED), ids(_UNPAVED), ids(_HAZARD)
        self.road, self.sky, self.vehicles = ids({"road"}), ids(_SKY), ids(_VEHICLES)
        self.name = "segformer-ade20k"
        self.version = path.replace("\\", "/").rstrip("/").split("/")[-1]
        self._lock = threading.Lock()

    def probabilities(self, bgr: np.ndarray) -> np.ndarray:
        """Class probabilities (C x h x w) at a quarter of the inference resolution."""
        h, w = bgr.shape[:2]
        size = {"height": self.height, "width": int(round(w * self.height / h / 32)) * 32}
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        inputs = self.processor(images=rgb, size=size, return_tensors="pt")
        with self._lock, self.torch.inference_mode():
            logits = self.model(**inputs).logits[0]
            return logits.softmax(0).numpy()

    def segment(self, bgr: np.ndarray, vehicles_detected: bool = False) -> tuple[np.ndarray, np.ndarray]:
        """Surface group map and ground probability, both at the input resolution."""
        h, w = bgr.shape[:2]
        p = self.probabilities(bgr)
        paved, unpaved = p[self.paved].sum(0), p[self.unpaved].sum(0)
        hazard, road, sky = p[self.hazard].sum(0), p[self.road].sum(0), p[self.sky].sum(0)
        top = p.argmax(0)
        vehicles = vehicles_detected or np.isin(top, self.vehicles).mean() > VEHICLE_CONTEXT_FRAC

        groups = np.full(top.shape, BLOCKED, np.uint8)
        ground = paved + unpaved
        is_ground = _hysteresis(ground, GROUND_STRONG, GROUND_WEAK)
        groups[is_ground & (unpaved > paved)] = MARGINAL
        paved_px = is_ground & (paved >= unpaved)
        groups[paved_px] = LAYABLE
        if vehicles:
            groups[paved_px & (road >= ROAD_DOMINANCE * paved)] = CARRIAGEWAY
        groups[(hazard >= 0.5) & (hazard > ground)] = HAZARD
        groups[(sky >= 0.5) & ~is_ground] = UNKNOWN
        return (cv2.resize(groups, (w, h), interpolation=cv2.INTER_NEAREST),
                cv2.resize(ground.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR))


@lru_cache
def _load(variant: str):
    s = get_settings()
    folder, height = VARIANTS.get(variant, VARIANTS["accurate"])
    path = s.models_dir / folder
    if not path.exists():
        return UnavailableSurface(f"Surface model not found at {path}. Run scripts/fetch_models.py")
    try:
        return SegformerSurface(str(path), height)
    except Exception as exc:  # noqa: BLE001
        log.warning("Surface segmenter unavailable: %s", exc)
        return UnavailableSurface(f"Surface model could not be loaded: {exc.__class__.__name__}: {exc}")


_lock = threading.Lock()


def get_surface_segmenter(variant: str = ""):
    with _lock:
        return _load(variant or get_settings().surface_quality)
