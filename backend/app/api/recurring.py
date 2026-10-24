"""Release 3: recurring inspection schedules, per-site inspection history and inspection comparison.

Additive: new tables only. Starting a scheduled inspection creates an ordinary inspection exactly as
POST /projects/{id}/inspections does, so the existing capture → AI → review → punch list workflow is unchanged.
"""
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Finding, Inspection, Media, Project, User, utcnow
from ..recurring.compare import DEFAULT_RADIUS_M, OPEN_STATES, compare, counted, match
from ..recurring.models import InspectionSchedule, InspectionScheduleRun
from ..security import STAFF, current_user, require_roles
from ..services.documents import LABELS
from ..workflow import audit
from .inspect import CAPTURE_ROLES, _check_contractor, get_inspection_for

router = APIRouter(tags=["recurring"])


class ScheduleIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    site_name: str = Field(default="", max_length=200)
    interval_days: int = Field(ge=1, le=730)
    next_due: date
    remind_days: int = Field(default=7, ge=0, le=90)
    contractor_id: int | None = None
    notes: str = Field(default="", max_length=2000)


class SchedulePatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    site_name: str | None = Field(default=None, max_length=200)
    interval_days: int | None = Field(default=None, ge=1, le=730)
    next_due: date | None = None
    remind_days: int | None = Field(default=None, ge=0, le=90)
    contractor_id: int | None = None
    notes: str | None = Field(default=None, max_length=2000)
    active: bool | None = None


def _day(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _today() -> date:
    return utcnow().date()


def schedule_state(s: InspectionSchedule, today: date | None = None) -> dict:
    today = today or _today()
    days = (s.next_due.date() - today).days
    if not s.active:
        state = "paused"
    elif days < 0:
        state = "overdue"
    elif days <= s.remind_days:
        state = "due_soon"
    else:
        state = "scheduled"
    return {"state": state, "days_until_due": days}


def _schedule_dict(db: Session, s: InspectionSchedule, users: dict[int, User]) -> dict:
    p = db.get(Project, s.project_id)
    runs = []
    for r in reversed(s.runs):
        i = db.get(Inspection, r.inspection_id)
        runs.append({"inspection_id": r.inspection_id, "title": i.title if i else None, "status": i.status if i else None,
                     "due_at": r.due_at, "started_at": r.started_at,
                     "started_by": users[r.started_by].display_name if r.started_by in users else None,
                     "on_time": r.started_at.date() <= r.due_at.date()})
    return {"id": s.id, "project_id": s.project_id, "project_name": p.name if p else None, "title": s.title,
            "site_name": s.site_name, "interval_days": s.interval_days, "next_due": s.next_due.date().isoformat(),
            "remind_days": s.remind_days, "contractor_id": s.contractor_id,
            "contractor": users[s.contractor_id].display_name if s.contractor_id in users else None,
            "notes": s.notes, "active": s.active, "created_at": s.created_at, "updated_at": s.updated_at,
            **schedule_state(s), "runs": runs}


def _schedule(db: Session, schedule_id: int) -> InspectionSchedule:
    s = db.get(InspectionSchedule, schedule_id)
    if not s:
        raise HTTPException(404, "Schedule not found")
    return s


def _users(db: Session) -> dict[int, User]:
    return {u.id: u for u in db.scalars(select(User))}


# --- schedules ----------------------------------------------------------------------------------

@router.get("/schedules")
def list_schedules(project_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(require_roles(*STAFF))):
    q = select(InspectionSchedule).order_by(InspectionSchedule.next_due, InspectionSchedule.id)
    if project_id is not None:
        q = q.where(InspectionSchedule.project_id == project_id)
    users = _users(db)
    items = [_schedule_dict(db, s, users) for s in db.scalars(q)]
    counts = {k: sum(i["state"] == k for i in items) for k in ("overdue", "due_soon", "scheduled", "paused")}
    return {"items": items, "counts": counts, "today": _today().isoformat()}


@router.post("/projects/{project_id}/schedules", status_code=201)
def create_schedule(project_id: int, body: ScheduleIn, db: Session = Depends(get_db),
                    user: User = Depends(require_roles(*CAPTURE_ROLES))):
    if not db.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    _check_contractor(db, body.contractor_id)
    data = body.model_dump()
    s = InspectionSchedule(project_id=project_id, created_by=user.id, **{**data, "next_due": _day(body.next_due)})
    db.add(s)
    db.flush()
    audit(db, user.id, "schedule.create", "inspection_schedule", s.id, project_id=project_id,
          interval_days=body.interval_days, next_due=body.next_due.isoformat())
    db.commit()
    return _schedule_dict(db, s, _users(db))


@router.get("/schedules/{schedule_id}")
def get_schedule(schedule_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*STAFF))):
    return _schedule_dict(db, _schedule(db, schedule_id), _users(db))


@router.patch("/schedules/{schedule_id}")
def update_schedule(schedule_id: int, body: SchedulePatch, db: Session = Depends(get_db),
                    user: User = Depends(require_roles(*CAPTURE_ROLES))):
    s = _schedule(db, schedule_id)
    data = body.model_dump(exclude_unset=True)
    if "contractor_id" in data:
        _check_contractor(db, data["contractor_id"])
    for k, v in data.items():
        setattr(s, k, _day(v) if k == "next_due" else v)
    s.updated_at = utcnow()
    audit(db, user.id, "schedule.update", "inspection_schedule", s.id,
          **{k: (v.isoformat() if isinstance(v, date) else v) for k, v in data.items()})
    db.commit()
    return _schedule_dict(db, s, _users(db))


@router.post("/schedules/{schedule_id}/start", status_code=201)
def start_scheduled_inspection(schedule_id: int, db: Session = Depends(get_db),
                               user: User = Depends(require_roles(*CAPTURE_ROLES))):
    """Create the inspection that is due and move the schedule to its next due date after today."""
    s = _schedule(db, schedule_id)
    if not s.active:
        raise HTTPException(409, {"code": "schedule_paused", "message": "This schedule is paused. Resume it first."})
    _check_contractor(db, s.contractor_id)
    due = s.next_due
    insp = Inspection(project_id=s.project_id, created_by=user.id, contractor_id=s.contractor_id,
                      title=f"{s.title} · due {due.date().isoformat()}", site_name=s.site_name)
    db.add(insp)
    db.flush()
    audit(db, user.id, "inspection.create", "inspection", insp.id, schedule_id=s.id)
    db.add(InspectionScheduleRun(schedule_id=s.id, inspection_id=insp.id, due_at=due, started_by=user.id))
    today = _today()
    nxt = due
    while nxt.date() <= today:
        nxt = nxt + timedelta(days=s.interval_days)
    s.next_due = nxt
    s.updated_at = utcnow()
    audit(db, user.id, "schedule.start", "inspection_schedule", s.id, inspection_id=insp.id,
          due=due.date().isoformat(), next_due=nxt.date().isoformat())
    db.commit()
    return {"inspection_id": insp.id, "title": insp.title, "next_due": nxt.date().isoformat()}


# --- history & comparison -----------------------------------------------------------------------

def _accessible_inspections(p: Project, user: User) -> list[Inspection]:
    insps = [i for i in p.inspections if user.role in STAFF or (user.role == "contractor" and i.contractor_id == user.id)]
    return sorted(insps, key=lambda i: (i.created_at, i.id))


@router.get("/projects/{project_id}/history")
def project_history(project_id: int, radius_m: float = Query(DEFAULT_RADIUS_M, ge=1, le=200),
                    db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Every inspection of a site in date order, with finding counts and what recurred from the previous one."""
    if user.role not in STAFF + ("contractor",):
        raise HTTPException(403, "Not permitted")
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    insps = _accessible_inspections(p, user)
    if not insps and user.role not in STAFF:
        raise HTTPException(403, "You do not have access to this project")
    rows = []
    prev: list[Finding] | None = None
    classes: set[str] = set()
    for i in insps:
        fs = db.scalars(select(Finding).where(Finding.inspection_id == i.id).order_by(Finding.id)).all()
        live = counted(fs)
        classes.update(f.defect_class for f in live)
        photos = db.scalar(select(func.count()).select_from(Media).where(Media.inspection_id == i.id,
                                                                         Media.kind == "inspection_photo")) or 0
        recurring = len(match(prev, live, radius_m)) if prev is not None else None
        rows.append({"id": i.id, "title": i.title, "status": i.status, "created_at": i.created_at,
                     "handover_at": i.handover_at, "photos": photos, "findings": len(live),
                     "rejected": len(fs) - len(live), "open": sum(f.status in OPEN_STATES for f in live),
                     "resolved": sum(f.status in ("verified", "closed") for f in live),
                     "by_class": {c: sum(f.defect_class == c for f in live) for c in {f.defect_class for f in live}},
                     "recurring_from_previous": recurring})
        prev = live
    return {"project": {"id": p.id, "name": p.name, "location_name": p.location_name, "is_demo": p.is_demo},
            "inspections": rows, "classes": [{"id": c, "label": LABELS.get(c, c)} for c in sorted(classes)],
            "radius_m": radius_m,
            "note": "Counts exclude findings a reviewer rejected. Recurrence is matched by class and location; see the comparison for the method."}


@router.get("/inspections/{before_id}/compare/{after_id}")
def compare_inspections(before_id: int, after_id: int, radius_m: float = Query(DEFAULT_RADIUS_M, ge=1, le=200),
                        db: Session = Depends(get_db), user: User = Depends(current_user)):
    if before_id == after_id:
        raise HTTPException(422, "Choose two different inspections")
    a = get_inspection_for(db, before_id, user)
    b = get_inspection_for(db, after_id, user)
    if a.project_id != b.project_id:
        raise HTTPException(422, {"code": "different_sites", "message": "Only inspections of the same site can be compared"})
    fa = db.scalars(select(Finding).where(Finding.inspection_id == a.id).order_by(Finding.id)).all()
    fb = db.scalars(select(Finding).where(Finding.inspection_id == b.id).order_by(Finding.id)).all()
    head = lambda i: {"id": i.id, "title": i.title, "status": i.status, "created_at": i.created_at}  # noqa: E731
    return {"before": head(a), "after": head(b), **compare(fa, fb, radius_m)}
