"""Tactile tile segmentation.

Two interchangeable implementations:
* YoloTileSegmenter: YOLOv8n-seg weights fine-tuned on labelled tactile-tile masks (TC_TILE_MODEL_PATH).
  No such weights ship with this repository; they must be trained with ml/training/train.py first.
* ClassicalTileSegmenter: an untrained colour/morphology baseline for yellow tactile tiles. It is a
  prototype heuristic, not a validated model, and fails on grey/unpainted tiles or strong colour casts.
"""
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

from ..config import get_settings

TYPE_NONE, TYPE_DIRECTIONAL, TYPE_WARNING = 0, 1, 2


@dataclass
class TileSegmentation:
    mask: np.ndarray
    method: str
    model_version: str
    type_map: np.ndarray | None = None
    components: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def area_fraction(self) -> float:
        return float((self.mask > 0).mean())


def _components(mask: np.ndarray, min_frac: float) -> tuple[np.ndarray, list[dict]]:
    h, w = mask.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros_like(mask)
    comps = []
    for i in range(1, n):
        x, y, cw, ch, area = stats[i]
        if area < min_frac * h * w:
            continue
        keep[labels == i] = 255
        contours, _ = cv2.findContours((labels == i).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        poly = cv2.approxPolyDP(max(contours, key=cv2.contourArea), 0.01 * max(h, w), True)
        comps.append({
            "bbox": [int(x), int(y), int(x + cw), int(y + ch)],
            "area_fraction": round(float(area) / (h * w), 4),
            "polygon": poly.reshape(-1, 2).astype(int).tolist(),
        })
    return keep, comps


class ClassicalTileSegmenter:
    name = "classical-hsv-baseline"
    version = "0.1.0"

    def segment(self, bgr: np.ndarray) -> TileSegmentation:
        h, w = bgr.shape[:2]
        hsv = cv2.cvtColor(cv2.GaussianBlur(bgr, (5, 5), 0), cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, (14, 70, 60), (40, 255, 255))
        k = max(3, int(min(h, w) * 0.012)) | 1
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k // 2 | 1, k // 2 | 1)))
        mask, comps = _components(mask, 0.0008)
        notes = ["Untrained colour baseline: detects yellow tactile tiles only."]
        return TileSegmentation(mask, self.name, self.version, None, comps, notes)


class YoloTileSegmenter:
    name = "yolov8n-seg-tactile"

    def __init__(self, path: Path):
        from ultralytics import YOLO

        self.model = YOLO(str(path))
        self.version = path.stem
        self.names = self.model.names

    def segment(self, bgr: np.ndarray) -> TileSegmentation:
        h, w = bgr.shape[:2]
        res = self.model.predict(bgr, imgsz=640, verbose=False)[0]
        mask = np.zeros((h, w), np.uint8)
        type_map = np.zeros((h, w), np.uint8)
        if res.masks is not None:
            for m, cls in zip(res.masks.data.cpu().numpy(), res.boxes.cls.cpu().numpy().astype(int)):
                m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST) > 0.5
                name = str(self.names.get(cls, ""))
                mask[m] = 255
                type_map[m] = TYPE_WARNING if "warning" in name else TYPE_DIRECTIONAL
        mask, comps = _components(mask, 0.002)
        return TileSegmentation(mask, self.name, self.version, type_map, comps, [])


@lru_cache
def get_tile_segmenter():
    path = get_settings().tile_model_path
    if path and Path(path).is_file():
        try:
            return YoloTileSegmenter(Path(path))
        except Exception:  # noqa: BLE001 - fall back to the baseline but keep the app usable
            pass
    return ClassicalTileSegmenter()
