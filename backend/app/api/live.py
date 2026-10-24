"""Live path planner: analyse camera frames on the fly. Frames are processed in memory and never stored."""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import partial

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from ..config import get_settings
from ..models import User
from ..security import require_roles
from ..services import github_models
from ..services.live import analyze_frame
from ..services.media import read_upload
from ..vision.layplan import DEFAULT_CLEARANCE_M, PlanParams
from ..vision.obstacles import get_obstacle_detector
from ..vision.surface import VARIANTS, get_surface_segmenter

router = APIRouter(prefix="/live", tags=["live"])
LIVE_ROLES = ("contractor", "engineer", "inspector", "admin")
MAX_FRAME_BYTES = 3 * 1024 * 1024
_slots = threading.BoundedSemaphore(get_settings().live_max_concurrent)
# All live inference runs on one thread. PyTorch keeps an OpenMP pool per calling thread; spreading frames over
# FastAPI's threadpool creates several spinning pools that fight for the cores (measured ~6x slower).
_inference = ThreadPoolExecutor(max_workers=1, thread_name_prefix="live-inference")


def _decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None or min(img.shape[:2]) < 120:
        raise HTTPException(422, {"code": "invalid_frame", "message": "Frame could not be decoded or is too small"})
    return img


@router.get("/status")
def live_status(user: User = Depends(require_roles(*LIVE_ROLES))):
    det = get_obstacle_detector()
    surfaces = {q: get_surface_segmenter(q) for q in VARIANTS}
    return {
        "surface": {q: {"available": m.available, "model": f"{m.name}:{m.version}", "reason": m.reason}
                    for q, m in surfaces.items()},
        "default_quality": get_settings().surface_quality,
        "obstacles": {"available": det.available, "model": f"{det.name}:{det.version}", "reason": det.reason},
        "github_models": {"configured": github_models.configured(), "model": get_settings().github_models_model},
        "defaults": {"clearance_m": DEFAULT_CLEARANCE_M, "height_m": 1.4, "hfov_deg": 63},
    }


@router.post("/frame")
async def live_frame(
    file: UploadFile = File(...),
    pitch_deg: float | None = Form(None, ge=5, le=85), height_m: float = Form(1.4, ge=0.3, le=3.0),
    hfov_deg: float = Form(63.0, ge=30, le=120), strip_width_tiles: int = Form(1, ge=1, le=3),
    clearance_m: float = Form(DEFAULT_CLEARANCE_M, ge=0.0, le=2.0), detect_obstacles: bool = Form(True),
    quality: str = Form("", pattern="^(|fast|accurate)$"),
    user: User = Depends(require_roles(*LIVE_ROLES)),
):
    data = await read_upload(file, MAX_FRAME_BYTES)
    img = _decode(data)
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, {"code": "busy", "message": "Live analysis is busy. Frame skipped."})
    try:
        result = await asyncio.get_running_loop().run_in_executor(_inference, partial(
            analyze_frame, img, pitch_deg=pitch_deg, height_m=height_m, hfov_deg=hfov_deg,
            params=PlanParams(strip_width_tiles=strip_width_tiles, clearance_m=clearance_m),
            detect_obstacles=detect_obstacles, quality=quality))
    finally:
        _slots.release()
    if not result["ok"]:
        raise HTTPException(503, {"code": result["code"], "message": result["message"]})
    return result


@router.post("/scene-check")
async def scene_check(file: UploadFile = File(...), user: User = Depends(require_roles(*LIVE_ROLES))):
    data = await read_upload(file, MAX_FRAME_BYTES)
    img = _decode(data)
    scale = 768 / max(img.shape[:2])
    if scale < 1:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    try:
        return await run_in_threadpool(github_models.scene_check, buf.tobytes())
    except github_models.NotConfigured as exc:
        raise HTTPException(501, {"code": "not_configured", "message": str(exc)}) from exc
    except github_models.UpstreamError as exc:
        raise HTTPException(502, {"code": "upstream_error", "message": str(exc)}) from exc
