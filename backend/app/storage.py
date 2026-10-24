"""Private file storage. Originals are written once and never modified; derived images are separate keys."""
import uuid
from pathlib import Path

from .config import get_settings


def _root() -> Path:
    root = get_settings().media_dir
    root.mkdir(parents=True, exist_ok=True)
    return root


def new_key(folder: str, suffix: str = ".jpg") -> str:
    return f"{folder}/{uuid.uuid4().hex}{suffix}"


def path_for(key: str) -> Path:
    p = (_root() / key).resolve()
    if _root().resolve() not in p.parents:
        raise ValueError("Invalid storage key")
    return p


def write(key: str, data: bytes, immutable: bool = False) -> None:
    p = path_for(key)
    p.parent.mkdir(parents=True, exist_ok=True)
    if immutable and p.exists():
        raise FileExistsError(f"Refusing to overwrite immutable object {key}")
    p.write_bytes(data)


def read(key: str) -> bytes:
    return path_for(key).read_bytes()


def exists(key: str | None) -> bool:
    return bool(key) and path_for(key).exists()
