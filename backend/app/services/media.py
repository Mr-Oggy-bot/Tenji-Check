from datetime import datetime

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import storage
from ..models import Media
from ..security import media_url
from ..vision.imageio import UploadError, encode_jpeg, normalize_upload
from ..vision.privacy import blur_sensitive
from ..vision.quality import assess_quality


class QualityRejected(HTTPException):
    def __init__(self, quality: dict):
        super().__init__(status_code=422, detail={
            "code": "quality_rejected",
            "message": "Photo failed the quality check. Retake it, or submit it for manual review only.",
            "quality": quality,
        })


async def read_upload(file: UploadFile, limit: int) -> bytes:
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File exceeds the {limit // (1024 * 1024)} MB upload limit")
    return data


def ingest_image(
    db: Session, data: bytes, kind: str, owner_id: int | None, *, enforce_quality: bool = True,
    allow_low_quality: bool = False, **fields,
) -> Media:
    """Validate, quality-check, store the immutable original and a privacy-blurred display copy."""
    try:
        img = normalize_upload(data)
    except UploadError as exc:
        raise HTTPException(422, {"code": "invalid_image", "message": str(exc)}) from exc
    quality = assess_quality(img.bgr)
    if enforce_quality and not quality["ok"] and not allow_low_quality:
        raise QualityRejected(quality)

    original_key = storage.new_key(f"originals/{kind}")
    storage.write(original_key, img.jpeg, immutable=True)
    blurred, privacy = blur_sensitive(img.bgr)
    display_key = storage.new_key(f"display/{kind}")
    storage.write(display_key, encode_jpeg(blurred))

    captured_at = fields.pop("captured_at", None)
    if isinstance(captured_at, str) and captured_at:
        try:
            captured_at = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        except ValueError:
            captured_at = None
    media = Media(
        kind=kind, owner_id=owner_id, original_key=original_key, display_key=display_key,
        width=img.width, height=img.height, size_bytes=len(img.jpeg), sha256=img.sha256,
        captured_at=captured_at or None, quality_ok=quality["ok"], quality=quality, privacy=privacy,
        **fields,
    )
    db.add(media)
    db.flush()
    return media


def media_dict(m: Media | None, include_original: bool = False) -> dict | None:
    if m is None:
        return None
    d = {
        "id": m.id, "kind": m.kind, "width": m.width, "height": m.height,
        "created_at": m.created_at, "captured_at": m.captured_at,
        "lat": m.lat, "lon": m.lon, "gps_accuracy_m": m.gps_accuracy_m,
        "context_tag": m.context_tag, "segment_label": m.segment_label,
        "quality_ok": m.quality_ok, "quality": m.quality, "privacy": m.privacy,
        "url": media_url(m.id, "display"),
        "annotated_url": media_url(m.id, "annotated") if m.annotated_key else None,
    }
    if include_original:
        d["original_url"] = media_url(m.id, "original")
    return d
