from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..security import ROLES, create_token, current_user, hash_password, require_roles, verify_password
from ..services.guards import limiter
from ..workflow import audit

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class RegisterIn(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=200)


class UserCreateIn(RegisterIn):
    role: str


class UserPatchIn(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    display_name: str | None = Field(default=None, min_length=2, max_length=120)


def user_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "display_name": u.display_name, "role": u.role,
            "is_active": u.is_active, "created_at": u.created_at}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    limiter.check(f"login:{request.client.host if request.client else '-'}", 20)
    user = db.scalars(select(User).where(User.email == body.email.lower().strip())).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    if not user.is_active:
        raise HTTPException(403, "This account is disabled")
    return {"access_token": create_token(user), "token_type": "bearer", "user": user_dict(user)}


@router.post("/auth/register", status_code=201)
def register_citizen(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    """Self-registration always creates a citizen account; staff roles are granted by an administrator."""
    limiter.check(f"register:{request.client.host if request.client else '-'}", 5)
    email = body.email.lower()
    if db.scalars(select(User).where(User.email == email)).first():
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, display_name=body.display_name, role="citizen", password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    return {"access_token": create_token(user), "token_type": "bearer", "user": user_dict(user)}


@router.get("/auth/me")
def me(user: User = Depends(current_user)):
    return user_dict(user)


@router.get("/users")
def list_users(role: str | None = None, db: Session = Depends(get_db),
               _: User = Depends(require_roles("admin", "inspector", "engineer"))):
    q = select(User).where(User.is_active.is_(True)).order_by(User.display_name)
    if role:
        q = q.where(User.role.in_(role.split(",")))
    return [user_dict(u) for u in db.scalars(q)]


@router.post("/users", status_code=201)
def create_user(body: UserCreateIn, db: Session = Depends(get_db), admin: User = Depends(require_roles("admin"))):
    if body.role not in ROLES:
        raise HTTPException(422, f"Role must be one of {', '.join(ROLES)}")
    email = body.email.lower()
    if db.scalars(select(User).where(User.email == email)).first():
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, display_name=body.display_name, role=body.role, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    audit(db, admin.id, "user.create", "user", user.id, role=body.role)
    db.commit()
    return user_dict(user)


@router.get("/admin/users")
def all_users(db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    return [user_dict(u) for u in db.scalars(select(User).order_by(User.id))]


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserPatchIn, db: Session = Depends(get_db), admin: User = Depends(require_roles("admin"))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(422, f"Role must be one of {', '.join(ROLES)}")
        if user.id == admin.id and body.role != "admin":
            raise HTTPException(409, "You cannot remove your own administrator role")
        user.role = body.role
    if body.is_active is not None:
        if user.id == admin.id and not body.is_active:
            raise HTTPException(409, "You cannot disable your own account")
        user.is_active = body.is_active
    if body.display_name:
        user.display_name = body.display_name
    audit(db, admin.id, "user.update", "user", user.id, **body.model_dump(exclude_none=True))
    db.commit()
    return user_dict(user)
