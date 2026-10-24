import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

ROLES = ("admin", "inspector", "engineer", "contractor", "citizen")
STAFF = ("admin", "inspector", "engineer")
REVIEWERS = ("admin", "inspector")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    s = get_settings()
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=s.jwt_expiry_minutes),
    }
    return jwt.encode(payload, s.secret_key, algorithm="HS256")


def _user_from_request(request: Request, db: Session) -> User | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    try:
        payload = jwt.decode(header[7:], get_settings().secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please sign in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid authentication token")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or disabled")
    return user


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    return _user_from_request(request, db)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = _user_from_request(request, db)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    return user


def require_roles(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action requires one of the roles: {', '.join(roles)}")
        return user

    return dep


# --- Signed, expiring media URLs -------------------------------------------------------------

def sign_media(media_id: int, variant: str, exp: int) -> str:
    msg = f"{media_id}:{variant}:{exp}".encode()
    return hmac.new(get_settings().secret_key.encode(), msg, hashlib.sha256).hexdigest()[:32]


def media_url(media_id: int | None, variant: str = "display") -> str | None:
    if media_id is None:
        return None
    exp = int(time.time()) + get_settings().media_url_ttl_seconds
    return f"/api/v1/media/{media_id}/file?variant={variant}&exp={exp}&sig={sign_media(media_id, variant, exp)}"


def check_media_signature(media_id: int, variant: str, exp: int, sig: str) -> bool:
    if exp < time.time():
        return False
    return hmac.compare_digest(sign_media(media_id, variant, exp), sig)
