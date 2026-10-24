"""Report mode: public tactile-paving issue reports, AI review, triage, duplicates and status lifecycle."""
import secrets
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..gis.geo import haversine
from ..models import Issue, IssueEvent, IssueReview, Media, User, utcnow
from ..security import REVIEWERS, STAFF, current_user, optional_user, require_roles
from ..services.analysis import latest_analysis, queue_analysis, run_analysis
from ..services.documents import to_csv
from ..services.guards import idempotent_lookup, idempotent_store, public_rate_limit
from ..services.media import ingest_image, media_dict, read_upload
from ..workflow import ISSUE_STATES, ISSUE_TRANSITIONS, apply_issue_transition, audit
from .inspect import analysis_dict

router = APIRouter(tags=["report"])
CATEGORIES = {
    "blocked_tactile_path": "Blocked tactile path",
    "damaged_tactile_tile": "Damaged tactile tile",
    "missing_tactile_tile": "Missing tactile tile",
    "interrupted_guidance_path": "Interrupted guidance path",
    "missing_warning_tiles": "Missing warning tiles",
    "ordinary_obstacle": "Obstacle on footpath",
    "other": "Other accessibility issue",
}
SEVERITIES = ("low", "medium", "high")


class StatusIn(BaseModel):
    to_status: str
    note: str = Field(default="", max_length=2000)
    assigned_to: int | None = None
    severity: str | None = None


class IssueReviewIn(BaseModel):
    decision: str  # confirm | edit | reject
    edited_category: str | None = None
    notes: str = Field(default="", max_length=2000)


class DuplicateIn(BaseModel):
    duplicate_of: int
    note: str = Field(default="", max_length=500)


def _reference() -> str:
    return f"TC-{utcnow():%y%m}-{secrets.token_hex(3).upper()}"


def find_possible_duplicates(db: Session, issue: Issue) -> list[int]:
    s = get_settings()
    if issue.lat is None:
        return []
    since = utcnow() - timedelta(days=s.duplicate_window_days)
    q = select(Issue).where(Issue.id != issue.id, Issue.category == issue.category, Issue.created_at >= since,
                            Issue.status != "rejected", Issue.lat.is_not(None))
    return [o.id for o in db.scalars(q) if haversine(issue.lat, issue.lon, o.lat, o.lon) <= s.duplicate_radius_m]


def _users(db: Session) -> dict[int, User]:
    return {u.id: u for u in db.scalars(select(User))}


def issue_dict(db: Session, i: Issue, user: User | None, users: dict[int, User], detail: bool = False) -> dict:
    staff = user is not None and user.role in STAFF
    d = {
        "id": i.id, "reference": i.reference, "category": i.category, "category_label": CATEGORIES.get(i.category, i.category),
        "description": i.description, "status": i.status, "severity": i.severity, "lat": i.lat, "lon": i.lon,
        "location_confirmed": i.location_confirmed, "source": i.source, "is_demo": i.is_demo,
        "assigned_to": i.assigned_to, "assignee": users[i.assigned_to].display_name if i.assigned_to in users else None,
        "rejection_reason": i.rejection_reason, "duplicate_of_id": i.duplicate_of_id,
        "possible_duplicates": i.possible_duplicates, "created_at": i.created_at, "updated_at": i.updated_at,
        "resolved_at": i.resolved_at, "age_days": (utcnow() - i.created_at.replace(tzinfo=utcnow().tzinfo)).days,
        "allowed_transitions": list(ISSUE_TRANSITIONS.get(i.status, ())) if user and user.role in REVIEWERS else [],
    }
    if staff:
        d["reporter"] = users[i.created_by].display_name if i.created_by in users else "anonymous"
        d["reporter_contact"] = i.reporter_contact
    if detail:
        media = db.scalars(select(Media).where(Media.issue_id == i.id).order_by(Media.id)).all()
        d["media"] = [{**media_dict(m, user is not None and user.role in REVIEWERS),
                       "analysis": analysis_dict(latest_analysis(db, m.id)) if staff else None} for m in media]
        d["events"] = [{"from": e.from_status, "to": e.to_status, "note": e.note, "at": e.created_at,
                        "actor": (users[e.actor_id].display_name if e.actor_id in users else "reporter") if staff else None}
                       for e in i.events]
        d["reviews"] = [{"decision": r.decision, "edited_category": r.edited_category, "notes": r.notes,
                         "reviewer": users[r.reviewer_id].display_name if r.reviewer_id in users else None, "at": r.created_at}
                        for r in i.reviews] if staff else []
    return d


def _issue_for(db: Session, issue_id: int, user: User) -> Issue:
    i = db.get(Issue, issue_id)
    if not i:
        raise HTTPException(404, "Report not found")
    if user.role in STAFF or i.created_by == user.id or (user.role == "contractor" and i.assigned_to == user.id):
        return i
    raise HTTPException(403, "You do not have access to this report")


@router.get("/issues/categories")
def categories():
    return [{"value": k, "label": v} for k, v in CATEGORIES.items()]


@router.post("/issues", status_code=201, dependencies=[Depends(public_rate_limit)])
async def create_issue(
    background: BackgroundTasks, request: Request,
    category: str = Form(...), description: str = Form(""), file: UploadFile = File(...),
    lat: float | None = Form(None), lon: float | None = Form(None), gps_accuracy_m: float | None = Form(None),
    location_confirmed: bool = Form(False), reporter_contact: str = Form(""),
    idempotency_key: str | None = Header(None),
    db: Session = Depends(get_db), user: User | None = Depends(optional_user),
):
    scope = f"issue:{user.id if user else request.client.host if request.client else '-'}"
    prev = idempotent_lookup(db, idempotency_key, scope)
    if prev:
        return JSONResponse(prev.response, status_code=prev.status_code)
    if category not in CATEGORIES:
        raise HTTPException(422, f"category must be one of {', '.join(CATEGORIES)}")
    if (lat is None) != (lon is None) or (lat is not None and not (-90 <= lat <= 90 and -180 <= lon <= 180)):
        raise HTTPException(422, "Provide both latitude and longitude within valid ranges, or neither (photo-only report)")
    if lat is not None and not location_confirmed:
        raise HTTPException(422, "Please confirm the map pin location before submitting")
    data = await read_upload(file, get_settings().max_upload_bytes)
    issue = Issue(reference=_reference(), category=category, description=description[:2000], lat=lat, lon=lon,
                  location_confirmed=location_confirmed and lat is not None, created_by=user.id if user else None,
                  reporter_contact=reporter_contact[:200], source="citizen_report" if not user or user.role == "citizen" else "staff_report")
    db.add(issue)
    db.flush()
    # Citizen photos are accepted even when imperfect (quality is recorded for reviewers, not used to refuse reports).
    m = ingest_image(db, data, "report_photo", user.id if user else None, enforce_quality=False, issue_id=issue.id,
                     lat=lat, lon=lon, gps_accuracy_m=gps_accuracy_m, context_tag="other", consent_basis="reporter submission")
    db.add(IssueEvent(issue_id=issue.id, from_status=None, to_status="submitted", actor_id=user.id if user else None,
                      note="Report submitted"))
    issue.possible_duplicates = find_possible_duplicates(db, issue)
    a = queue_analysis(db, m)
    resp = {"id": issue.id, "reference": issue.reference, "status": issue.status,
            "message": "Thank you. Keep this reference to check the status of your report.",
            "location_recorded": issue.lat is not None}
    idempotent_store(db, idempotency_key, scope, 201, resp)
    db.commit()
    background.add_task(run_analysis, a.id, 1)
    return resp


@router.get("/issues/track/{reference}", dependencies=[Depends(public_rate_limit)])
def track_issue(reference: str, db: Session = Depends(get_db)):
    """Public status lookup: no photos, identities or exact coordinates."""
    i = db.scalars(select(Issue).where(Issue.reference == reference.strip().upper())).first()
    if not i:
        raise HTTPException(404, "No report found with that reference")
    return {"reference": i.reference, "category": CATEGORIES.get(i.category, i.category), "status": i.status,
            "created_at": i.created_at, "updated_at": i.updated_at,
            "history": [{"status": e.to_status, "at": e.created_at} for e in i.events],
            "rejection_reason": i.rejection_reason if i.status == "rejected" else None}


@router.get("/issues/mine")
def my_issues(db: Session = Depends(get_db), user: User = Depends(current_user)):
    users = _users(db)
    return [issue_dict(db, i, user, users) for i in db.scalars(select(Issue).where(Issue.created_by == user.id).order_by(Issue.id.desc()))]


@router.get("/issues")
def list_issues(
    status: str | None = None, category: str | None = None, severity: str | None = None, q: str | None = None,
    assigned_to: int | None = None, duplicates_only: bool = False,
    sort: str = Query("-created_at", pattern="^-?(created_at|updated_at|severity|status)$"),
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    if user.role not in STAFF + ("contractor",):
        raise HTTPException(403, "Not permitted")
    stmt = select(Issue)
    if user.role == "contractor":
        stmt = stmt.where(Issue.assigned_to == user.id)
    if status:
        stmt = stmt.where(Issue.status.in_(status.split(",")))
    if category:
        stmt = stmt.where(Issue.category.in_(category.split(",")))
    if severity:
        stmt = stmt.where(Issue.severity.in_(severity.split(",")))
    if assigned_to:
        stmt = stmt.where(Issue.assigned_to == assigned_to)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Issue.reference.ilike(like), Issue.description.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    col = getattr(Issue, sort.lstrip("-"))
    stmt = stmt.order_by(col.desc() if sort.startswith("-") else col.asc(), Issue.id.desc())
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    users = _users(db)
    items = [issue_dict(db, i, user, users) for i in rows]
    if duplicates_only:
        items = [i for i in items if i["possible_duplicates"]]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/issues/export.csv")
def export_issues(db: Session = Depends(get_db), user: User = Depends(require_roles(*STAFF))):
    rows = [[i.reference, i.category, i.status, i.severity or "", i.lat or "", i.lon or "", i.location_confirmed,
             i.created_at, i.updated_at, i.resolved_at or "", i.duplicate_of_id or "", i.rejection_reason, i.is_demo]
            for i in db.scalars(select(Issue).order_by(Issue.id))]
    body = to_csv(["reference", "category", "status", "severity", "lat", "lon", "location_confirmed", "created_at",
                   "updated_at", "resolved_at", "duplicate_of", "rejection_reason", "demo_data"], rows)
    return Response(body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="reports.csv"'})


@router.get("/issues/{issue_id}")
def get_issue(issue_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    i = _issue_for(db, issue_id, user)
    return issue_dict(db, i, user, _users(db), detail=True)


@router.post("/issues/{issue_id}/review")
def review_issue(issue_id: int, body: IssueReviewIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    """Confirm, edit or reject the AI/reporter classification. Stored separately from model predictions."""
    i = _issue_for(db, issue_id, user)
    if body.decision not in ("confirm", "edit", "reject"):
        raise HTTPException(422, "decision must be confirm, edit or reject")
    if body.decision == "edit":
        if body.edited_category not in CATEGORIES:
            raise HTTPException(422, "edited_category must be a valid category")
        i.category = body.edited_category
    db.add(IssueReview(issue_id=i.id, reviewer_id=user.id, decision=body.decision, edited_category=body.edited_category,
                       notes=body.notes))
    if body.decision == "reject" and i.status in ("submitted", "under_review", "assigned", "in_progress"):
        apply_issue_transition(db, i, "rejected", user, body.notes or "Reviewer rejected the report")
    elif i.status == "submitted":
        apply_issue_transition(db, i, "under_review", user, "Reviewer checked the evidence")
    db.commit()
    return issue_dict(db, i, user, _users(db), detail=True)


@router.patch("/issues/{issue_id}/status")
def change_status(issue_id: int, body: StatusIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    i = _issue_for(db, issue_id, user)
    if body.severity is not None:
        if body.severity not in SEVERITIES:
            raise HTTPException(422, "severity must be low, medium or high")
        i.severity = body.severity
    if body.assigned_to is not None:
        a = db.get(User, body.assigned_to)
        if not a or a.role not in ("inspector", "contractor", "engineer", "admin") or not a.is_active:
            raise HTTPException(422, "Assignee must be an active inspector, engineer, contractor or admin")
        i.assigned_to = a.id
    if body.to_status != i.status:
        apply_issue_transition(db, i, body.to_status, user, body.note)
    db.commit()
    return issue_dict(db, i, user, _users(db), detail=True)


@router.post("/issues/{issue_id}/evidence", status_code=201)
async def add_evidence(issue_id: int, file: UploadFile = File(...), note: str = Form(""), db: Session = Depends(get_db),
                       user: User = Depends(current_user)):
    i = _issue_for(db, issue_id, user)
    if user.role not in ("inspector", "admin", "contractor", "engineer"):
        raise HTTPException(403, "Only assigned staff can attach closure evidence")
    data = await read_upload(file, get_settings().max_upload_bytes)
    m = ingest_image(db, data, "closure_evidence", user.id, enforce_quality=False, issue_id=i.id, lat=i.lat, lon=i.lon)
    audit(db, user.id, "issue.evidence", "issue", i.id, media_id=m.id, note=note[:500])
    db.commit()
    return media_dict(m)


@router.post("/issues/{issue_id}/mark-duplicate")
def mark_duplicate(issue_id: int, body: DuplicateIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    i = _issue_for(db, issue_id, user)
    original = db.get(Issue, body.duplicate_of)
    if not original or original.id == i.id:
        raise HTTPException(422, "duplicate_of must reference a different existing report")
    i.duplicate_of_id = original.id
    apply_issue_transition(db, i, "rejected", user, f"Duplicate of {original.reference}. {body.note}".strip())
    db.commit()
    return issue_dict(db, i, user, _users(db), detail=True)


@router.get("/issues-meta/states")
def states():
    return {"states": ISSUE_STATES, "transitions": ISSUE_TRANSITIONS, "categories": CATEGORIES}
