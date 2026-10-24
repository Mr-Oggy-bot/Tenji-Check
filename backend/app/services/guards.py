"""Rate limiting for public endpoints and idempotency keys for safe client retries."""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import IdempotencyRecord


class RateLimiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float = 60.0) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(429, "Too many submissions from this device. Please wait a minute and try again.")
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def public_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    limiter.check(f"public:{ip}", get_settings().public_rate_limit_per_minute)


def idempotent_lookup(db: Session, key: str | None, scope: str) -> IdempotencyRecord | None:
    if not key:
        return None
    return db.scalars(select(IdempotencyRecord).where(IdempotencyRecord.key == key[:100],
                                                      IdempotencyRecord.scope == scope)).first()


def idempotent_store(db: Session, key: str | None, scope: str, status_code: int, response) -> None:
    if key:
        db.add(IdempotencyRecord(key=key[:100], scope=scope, status_code=status_code, response=jsonable_encoder(response)))
