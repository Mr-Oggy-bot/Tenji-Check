"""Upload validation: size limit, file-signature check, decode, orientation fix and re-encode (strips metadata)."""
import hashlib
import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import get_settings

SIGNATURES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}
MAX_SIDE = 2560


class UploadError(ValueError):
    pass


@dataclass
class NormalizedImage:
    bgr: np.ndarray
    jpeg: bytes
    width: int
    height: int
    sha256: str
    source_mime: str


def sniff_mime(data: bytes) -> str | None:
    for sig, mime in SIGNATURES.items():
        if data.startswith(sig):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def normalize_upload(data: bytes) -> NormalizedImage:
    s = get_settings()
    if not data:
        raise UploadError("The uploaded file is empty")
    if len(data) > s.max_upload_bytes:
        raise UploadError(f"Image is larger than the {s.max_upload_mb:g} MB limit")
    mime = sniff_mime(data)
    if mime is None:
        raise UploadError("Unsupported file type. Upload a JPEG, PNG or WebP photo")
    try:
        Image.open(io.BytesIO(data)).verify()
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise UploadError("The image file is corrupt or could not be decoded") from exc
    if img.width < s.min_image_width or img.height < s.min_image_height:
        raise UploadError(f"Image resolution is too low (minimum {s.min_image_width}x{s.min_image_height})")
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    jpeg = buf.getvalue()
    bgr = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)
    return NormalizedImage(bgr, jpeg, img.width, img.height, hashlib.sha256(jpeg).hexdigest(), mime)


def encode_jpeg(bgr: np.ndarray, quality: int = 88) -> bytes:
    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return buf.tobytes()


def decode_jpeg(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise UploadError("Stored image could not be decoded")
    return img
