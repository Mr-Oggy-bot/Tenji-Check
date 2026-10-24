"""Inspect mode: projects, inspections, photo capture, AI findings, review gate, punch lists, repair loop, handover."""
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import storage
from ..config import get_settings
from ..db import get_db
from ..models import Analysis, Finding, Inspection, Media, Project, PunchList, User, utcnow
from ..rules.engine import CONTEXT_TAGS, references
from ..security import REVIEWERS, STAFF, current_user, require_roles
from ..services.analysis import latest_analysis, queue_analysis, run_analysis
from ..services.documents import LABELS, item_completeness, punch_list_pdf, to_csv
from ..services.guards import idempotent_lookup, idempotent_store
from ..services.media import ingest_image, media_dict, read_upload
from ..workflow import UNREVIEWED_FINDING_STATES, apply_finding_action, audit, finding_actions, record_initial_finding_event

router = APIRouter(tags=["inspect"])
DEFECT_CLASSES = ("obstacle_on_path", "interrupted_path", "missing_warning_tiles", "damaged_tactile_tile", "unassessable", "other")
PUNCH_STATES = ("confirmed", "fix_required", "awaiting_reinspection", "verified", "closed")
CAPTURE_ROLES = ("engineer", "inspector", "admin")


# --- schemas -----------------------------------------------------------------------------------

class ProjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    location_name: str = Field(default="", max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)


class InspectionIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    site_name: str = Field(default="", max_length=200)
    contractor_id: int | None = None


class InspectionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    site_name: str | None = None
    contractor_id: int | None = None


class ManualFindingIn(BaseModel):
    media_id: int
    defect_class: str
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    description: str = Field(default="", max_length=2000)
    severity: str = "high"


class Corrections(BaseModel):
    defect_class: str | None = None
    severity: str | None = None
    description: str | None = Field(default=None, max_length=2000)
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    required_fix: str | None = Field(default=None, max_length=2000)


class ReviewIn(BaseModel):
    decision: str  # start_review | confirm | reject | correct
    notes: str = Field(default="", max_length=2000)
    corrections: Corrections | None = None


class ReinspectIn(BaseModel):
    result: str  # pass | fail
    notes: str = Field(default="", max_length=2000)


class NoteIn(BaseModel):
    notes: str = Field(default="", max_length=2000)


# --- helpers -----------------------------------------------------------------------------------

def _users(db: Session) -> dict[int, User]:
    return {u.id: u for u in db.scalars(select(User))}


def _name(users: dict[int, User], uid: int | None) -> str | None:
    return users[uid].display_name if uid in users else None


def get_inspection_for(db: Session, inspection_id: int, user: User) -> Inspection:
    insp = db.get(Inspection, inspection_id)
    if not insp:
        raise HTTPException(404, "Inspection not found")
    if user.role in STAFF:
        return insp
    if user.role == "contractor" and insp.contractor_id == user.id:
        return insp
    raise HTTPException(403, "You do not have access to this inspection")


def _finding(db: Session, finding_id: int, user: User) -> Finding:
    f = db.get(Finding, finding_id)
    if not f:
        raise HTTPException(404, "Finding not found")
    get_inspection_for(db, f.inspection_id, user)
    return f


def finding_dict(db: Session, f: Finding, user: User, users: dict[int, User], with_events: bool = False) -> dict:
    d = {
        "id": f.id, "inspection_id": f.inspection_id, "source": f.source, "defect_class": f.defect_class,
        "label": LABELS.get(f.defect_class, f.defect_class), "status": f.status, "severity": f.severity,
        "verify_on_site": f.verify_on_site, "uncertainty_note": f.uncertainty_note, "confidence": f.confidence,
        "bbox": f.bbox, "measurement": f.measurement, "rule_id": f.rule_id, "rule_reference": f.rule_reference,
        "description": f.description, "required_fix": f.required_fix, "context_tag": f.context_tag,
        "lat": f.lat, "lon": f.lon, "ai_output": f.ai_output,
        "reviewer": _name(users, f.reviewer_id), "reviewed_at": f.reviewed_at, "review_decision": f.review_decision,
        "review_notes": f.review_notes, "reinspected_by": _name(users, f.reinspected_by), "reinspected_at": f.reinspected_at,
        "closed_by": _name(users, f.closed_by), "closed_at": f.closed_at, "punch_item_no": f.punch_item_no,
        "created_at": f.created_at, "updated_at": f.updated_at,
        "media": media_dict(db.get(Media, f.media_id) if f.media_id else None, user.role in REVIEWERS),
        "repair_media": media_dict(db.get(Media, f.repair_media_id) if f.repair_media_id else None),
        "actions": finding_actions(f, user.role),
    }
    if f.repair_media_id:
        a = latest_analysis(db, f.repair_media_id)
        d["repair_ai_check"] = None if not a else {"status": a.status, "candidates": a.result.get("candidates", []) if a.result else []}
    if with_events:
        d["events"] = [{"from": e.from_status, "to": e.to_status, "actor": _name(users, e.actor_id) or "system",
                        "note": e.note, "data": e.data, "at": e.created_at} for e in f.events]
    return d


def analysis_dict(a: Analysis | None) -> dict | None:
    if a is None:
        return None
    return {"id": a.id, "status": a.status, "latency_ms": a.latency_ms, "error": a.error, "tile_model": a.tile_model,
            "obstacle_model": a.obstacle_model, "rules_version": a.rules_version, "result": a.result,
            "created_at": a.created_at, "finished_at": a.finished_at}


def handover_state(findings: list[Finding], photo_count: int) -> dict:
    blocking = [f for f in findings if f.status not in ("closed", "rejected")]
    reasons = []
    if photo_count == 0:
        reasons.append("No inspection photos have been captured")
    if blocking:
        reasons.append(f"{len(blocking)} finding(s) are not closed or rejected")
    return {"ready": not reasons, "blocking_reasons": reasons,
            "statement": "Handover readiness only means every recorded finding was resolved by a human reviewer. "
                         "TenjiCheck never certifies accessibility compliance."}


# --- projects & inspections ---------------------------------------------------------------------

@router.get("/projects")
def list_projects(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.role not in STAFF + ("contractor",):
        raise HTTPException(403, "Not permitted")
    projects = db.scalars(select(Project).order_by(Project.id.desc())).all()
    out = []
    for p in projects:
        insps = [i for i in p.inspections if user.role in STAFF or i.contractor_id == user.id]
        if user.role == "contractor" and not insps:
            continue
        out.append({"id": p.id, "name": p.name, "location_name": p.location_name, "lat": p.lat, "lon": p.lon,
                    "is_demo": p.is_demo, "created_at": p.created_at, "inspection_count": len(insps)})
    return out


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*CAPTURE_ROLES))):
    p = Project(**body.model_dump(), created_by=user.id)
    db.add(p)
    db.flush()
    audit(db, user.id, "project.create", "project", p.id)
    db.commit()
    return {"id": p.id, "name": p.name}


@router.get("/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    users = _users(db)
    insps = [i for i in p.inspections if user.role in STAFF or (user.role == "contractor" and i.contractor_id == user.id)]
    if not insps and user.role not in STAFF:
        raise HTTPException(403, "You do not have access to this project")
    return {"id": p.id, "name": p.name, "location_name": p.location_name, "lat": p.lat, "lon": p.lon, "is_demo": p.is_demo,
            "inspections": [_inspection_summary(db, i, users) for i in sorted(insps, key=lambda i: -i.id)]}


def _inspection_summary(db: Session, i: Inspection, users) -> dict:
    counts = dict(db.execute(select(Finding.status, func.count()).where(Finding.inspection_id == i.id).group_by(Finding.status)).all())
    return {"id": i.id, "title": i.title, "site_name": i.site_name, "status": i.status, "is_demo": i.is_demo,
            "contractor": _name(users, i.contractor_id), "contractor_id": i.contractor_id, "created_at": i.created_at,
            "finding_counts": counts, "project_id": i.project_id, "project_name": i.project.name}


@router.get("/inspections")
def list_inspections(db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(Inspection).order_by(Inspection.id.desc())
    if user.role == "contractor":
        q = q.where(Inspection.contractor_id == user.id)
    elif user.role not in STAFF:
        raise HTTPException(403, "Not permitted")
    users = _users(db)
    return [_inspection_summary(db, i, users) for i in db.scalars(q)]


@router.post("/projects/{project_id}/inspections", status_code=201)
def create_inspection(project_id: int, body: InspectionIn, db: Session = Depends(get_db),
                      user: User = Depends(require_roles(*CAPTURE_ROLES))):
    if not db.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    _check_contractor(db, body.contractor_id)
    i = Inspection(project_id=project_id, created_by=user.id, **body.model_dump())
    db.add(i)
    db.flush()
    audit(db, user.id, "inspection.create", "inspection", i.id)
    db.commit()
    return {"id": i.id, "title": i.title}


def _check_contractor(db: Session, contractor_id: int | None) -> None:
    if contractor_id is not None:
        c = db.get(User, contractor_id)
        if not c or c.role != "contractor":
            raise HTTPException(422, "contractor_id must reference a contractor account")


@router.patch("/inspections/{inspection_id}")
def update_inspection(inspection_id: int, body: InspectionPatch, db: Session = Depends(get_db),
                      user: User = Depends(require_roles(*CAPTURE_ROLES))):
    insp = get_inspection_for(db, inspection_id, user)
    data = body.model_dump(exclude_unset=True)
    if "contractor_id" in data:
        _check_contractor(db, data["contractor_id"])
    for k, v in data.items():
        setattr(insp, k, v)
    audit(db, user.id, "inspection.update", "inspection", insp.id, **data)
    db.commit()
    return {"ok": True}


@router.get("/inspections/{inspection_id}")
def get_inspection(inspection_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    insp = get_inspection_for(db, inspection_id, user)
    users = _users(db)
    photos = db.scalars(select(Media).where(Media.inspection_id == insp.id, Media.kind == "inspection_photo").order_by(Media.id)).all()
    findings = db.scalars(select(Finding).where(Finding.inspection_id == insp.id).order_by(Finding.id)).all()
    pls = db.scalars(select(PunchList).where(PunchList.inspection_id == insp.id).order_by(PunchList.id.desc())).all()
    return {
        **_inspection_summary(db, insp, users),
        "handover_by": _name(users, insp.handover_by), "handover_at": insp.handover_at, "handover_note": insp.handover_note,
        "photos": [{**media_dict(m, user.role in REVIEWERS), "analysis": analysis_dict(latest_analysis(db, m.id))} for m in photos],
        "findings": [finding_dict(db, f, user, users) for f in findings],
        "punch_lists": [_punch_dict(p, users) for p in pls],
        "handover": handover_state(findings, len(photos)),
        "unreviewed_count": sum(f.status in UNREVIEWED_FINDING_STATES for f in findings),
        "context_tags": CONTEXT_TAGS,
        "rules": references(),
    }


def _punch_dict(p: PunchList, users) -> dict:
    return {"id": p.id, "version": p.version, "generated_by": _name(users, p.generated_by), "created_at": p.created_at,
            "item_count": p.item_count, "complete_items": p.complete_items, "pdf_url": f"/api/v1/punch-lists/{p.id}/pdf"}


# --- capture -----------------------------------------------------------------------------------

@router.post("/inspections/{inspection_id}/photos", status_code=201)
async def upload_photo(
    inspection_id: int, background: BackgroundTasks,
    file: UploadFile = File(...), context_tag: str = Form("segment"), segment_label: str = Form(""),
    lat: float | None = Form(None), lon: float | None = Form(None), gps_accuracy_m: float | None = Form(None),
    captured_at: str | None = Form(None), allow_low_quality: bool = Form(False), strip_width_tiles: int = Form(1),
    idempotency_key: str | None = Header(None), db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CAPTURE_ROLES)),
):
    insp = get_inspection_for(db, inspection_id, user)
    scope = f"photo:{user.id}:{inspection_id}"
    prev = idempotent_lookup(db, idempotency_key, scope)
    if prev:
        return JSONResponse(prev.response, status_code=prev.status_code)
    if insp.status == "handover_approved":
        raise HTTPException(409, "Handover is already recorded for this inspection")
    if context_tag not in CONTEXT_TAGS:
        raise HTTPException(422, f"context_tag must be one of {', '.join(CONTEXT_TAGS)}")
    if (lat is None) != (lon is None) or (lat is not None and not (-90 <= lat <= 90 and -180 <= lon <= 180)):
        raise HTTPException(422, "Provide both latitude and longitude within valid ranges, or neither")
    if not 1 <= strip_width_tiles <= 6:
        raise HTTPException(422, "strip_width_tiles must be between 1 and 6")
    data = await read_upload(file, get_settings().max_upload_bytes)
    media = ingest_image(db, data, "inspection_photo", user.id, allow_low_quality=allow_low_quality,
                         inspection_id=insp.id, context_tag=context_tag, segment_label=segment_label[:120],
                         lat=lat, lon=lon, gps_accuracy_m=gps_accuracy_m, captured_at=captured_at)
    analysis = None
    if media.quality_ok and get_settings().inference_on_upload:
        analysis = queue_analysis(db, media)
    elif not media.quality_ok:
        analysis = Analysis(media_id=media.id, status="skipped", error="Low-quality photo accepted for manual review only; AI screening not run")
        db.add(analysis)
        db.flush()
    resp = {"media": media_dict(media), "analysis": analysis_dict(analysis)}
    idempotent_store(db, idempotency_key, scope, 201, resp)
    db.commit()
    if analysis is not None and analysis.status == "queued":
        background.add_task(run_analysis, analysis.id, strip_width_tiles)
    return resp


@router.get("/media/{media_id}/analysis")
def get_analysis(media_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Photo not found")
    _check_media_access(db, m, user)
    return {"media": media_dict(m, user.role in REVIEWERS), "analysis": analysis_dict(latest_analysis(db, m.id))}


@router.post("/media/{media_id}/reanalyze", status_code=202)
def reanalyze(media_id: int, background: BackgroundTasks, strip_width_tiles: int = 1, db: Session = Depends(get_db),
              user: User = Depends(require_roles(*REVIEWERS, "engineer"))):
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Photo not found")
    if m.kind == "inspection_photo":
        open_ai = db.scalars(select(Finding).where(Finding.media_id == m.id, Finding.source == "ai",
                                                   Finding.status.in_(UNREVIEWED_FINDING_STATES))).first()
        if open_ai:
            raise HTTPException(409, "Review or reject the existing AI proposals for this photo before re-running screening")
    a = queue_analysis(db, m)
    db.commit()
    background.add_task(run_analysis, a.id, strip_width_tiles)
    return analysis_dict(a)


def _check_media_access(db: Session, m: Media, user: User) -> None:
    if user.role in STAFF:
        return
    if m.owner_id == user.id:
        return
    if user.role == "contractor" and m.inspection_id:
        get_inspection_for(db, m.inspection_id, user)
        return
    if user.role == "contractor" and m.finding_id:
        f = db.get(Finding, m.finding_id)
        get_inspection_for(db, f.inspection_id, user)
        return
    raise HTTPException(403, "You do not have access to this photo")


# --- findings & review gate ---------------------------------------------------------------------

@router.post("/inspections/{inspection_id}/findings", status_code=201)
def create_manual_finding(inspection_id: int, body: ManualFindingIn, db: Session = Depends(get_db),
                          user: User = Depends(require_roles(*CAPTURE_ROLES))):
    insp = get_inspection_for(db, inspection_id, user)
    if body.defect_class not in DEFECT_CLASSES:
        raise HTTPException(422, f"defect_class must be one of {', '.join(DEFECT_CLASSES)}")
    if body.severity not in ("low", "medium", "high"):
        raise HTTPException(422, "severity must be low, medium or high")
    m = db.get(Media, body.media_id)
    if not m or m.inspection_id != insp.id:
        raise HTTPException(422, "media_id must be a photo from this inspection")
    rule = references()["rules"].get(body.defect_class)
    f = Finding(inspection_id=insp.id, media_id=m.id, source="manual", defect_class=body.defect_class,
                status="under_review", severity=body.severity, bbox=body.bbox, description=body.description,
                rule_id=body.defect_class if rule else "", rule_reference=rule["reference"] if rule else "Manual finding (no rule reference)",
                required_fix=rule["required_fix"] if rule else "", context_tag=m.context_tag, lat=m.lat, lon=m.lon,
                ai_output={})
    db.add(f)
    db.flush()
    record_initial_finding_event(db, f, user.id, "Manual (tap-to-mark) finding created")
    db.commit()
    return finding_dict(db, f, user, _users(db))


@router.get("/findings/{finding_id}")
def get_finding(finding_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    f = _finding(db, finding_id, user)
    return finding_dict(db, f, user, _users(db), with_events=True)


@router.post("/findings/{finding_id}/review")
def review_finding(finding_id: int, body: ReviewIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    f = _finding(db, finding_id, user)
    data = {}
    if body.decision == "correct":
        if not body.corrections:
            raise HTTPException(422, "Provide corrections when decision is 'correct'")
        c = body.corrections.model_dump(exclude_none=True)
        if "defect_class" in c and c["defect_class"] not in DEFECT_CLASSES:
            raise HTTPException(422, "Unknown defect_class")
        if "severity" in c and c["severity"] not in ("low", "medium", "high"):
            raise HTTPException(422, "severity must be low, medium or high")
        data["before"] = {k: getattr(f, k) for k in c}
        data["after"] = c
        for k, v in c.items():
            setattr(f, k, v)
        if "defect_class" in c:
            rule = references()["rules"].get(c["defect_class"])
            if rule:
                f.rule_id, f.rule_reference = c["defect_class"], rule["reference"]
                if "required_fix" not in c:
                    f.required_fix = rule["required_fix"]
        action = "confirm"
    elif body.decision in ("start_review", "confirm", "reject"):
        action = body.decision
    else:
        raise HTTPException(422, "decision must be start_review, confirm, reject or correct")
    if action == "reject" and not body.notes.strip():
        raise HTTPException(422, "Give a reason when rejecting a finding")
    apply_finding_action(db, f, action, user, body.notes, data)
    db.commit()
    return finding_dict(db, f, user, _users(db), with_events=True)


@router.post("/findings/{finding_id}/reopen")
def reopen_finding(finding_id: int, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    f = _finding(db, finding_id, user)
    apply_finding_action(db, f, "reopen_review", user, body.notes)
    db.commit()
    return finding_dict(db, f, user, _users(db), with_events=True)


@router.get("/review/queue")
def review_queue(db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    users = _users(db)
    rows = db.scalars(select(Finding).where(Finding.status.in_(UNREVIEWED_FINDING_STATES + ("awaiting_reinspection", "verified")))
                      .order_by(Finding.verify_on_site.desc(), Finding.id)).all()
    return [{**finding_dict(db, f, user, users), "inspection_title": f.inspection.title,
             "project_name": f.inspection.project.name} for f in rows]


# --- punch list ---------------------------------------------------------------------------------

@router.post("/inspections/{inspection_id}/punch-list", status_code=201)
def generate_punch_list(inspection_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    insp = get_inspection_for(db, inspection_id, user)
    findings = db.scalars(select(Finding).where(Finding.inspection_id == insp.id).order_by(Finding.id)).all()
    unreviewed = [f.id for f in findings if f.status in UNREVIEWED_FINDING_STATES]
    if unreviewed:
        raise HTTPException(409, {"code": "review_required",
                                  "message": f"{len(unreviewed)} finding(s) still need an authorised reviewer decision "
                                             "before a punch list can be generated.", "finding_ids": unreviewed})
    users = _users(db)
    items = [f for f in findings if f.status in PUNCH_STATES]
    incomplete = {f.id: [k for k, ok in item_completeness(f, users).items() if not ok] for f in items}
    incomplete = {k: v for k, v in incomplete.items() if v}
    if incomplete:
        raise HTTPException(409, {"code": "incomplete_items", "message": "Some punch-list items are missing required fields",
                                  "items": incomplete})
    next_no = max([f.punch_item_no or 0 for f in findings] + [0]) + 1
    for f in items:
        if f.punch_item_no is None:
            f.punch_item_no, next_no = next_no, next_no + 1
        if f.status == "confirmed":
            apply_finding_action(db, f, "issue_punch_list", user, "Added to punch list; contractor fix required")
    db.flush()
    version = (db.scalar(select(func.max(PunchList.version)).where(PunchList.inspection_id == insp.id)) or 0) + 1
    media_ids = {f.media_id for f in items} | {f.repair_media_id for f in items}
    media = {m.id: m for m in db.scalars(select(Media).where(Media.id.in_([i for i in media_ids if i])))}
    rejected = [f for f in findings if f.status == "rejected"]
    pdf = punch_list_pdf(insp, sorted(items, key=lambda f: f.punch_item_no), rejected, media, users, version, user)
    key = storage.new_key("punchlists", ".pdf")
    storage.write(key, pdf, immutable=True)
    pl = PunchList(inspection_id=insp.id, version=version, generated_by=user.id, pdf_key=key, item_count=len(items),
                   unreviewed_at_generation=0, complete_items=len(items))
    db.add(pl)
    db.flush()
    audit(db, user.id, "punchlist.generate", "inspection", insp.id, version=version, items=len(items))
    db.commit()
    return _punch_dict(pl, users)


@router.get("/inspections/{inspection_id}/punch-lists")
def list_punch_lists(inspection_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    insp = get_inspection_for(db, inspection_id, user)
    users = _users(db)
    return [_punch_dict(p, users) for p in db.scalars(select(PunchList).where(PunchList.inspection_id == insp.id).order_by(PunchList.id.desc()))]


@router.get("/punch-lists/{punch_id}/pdf")
def download_punch_list(punch_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    pl = db.get(PunchList, punch_id)
    if not pl:
        raise HTTPException(404, "Punch list not found")
    get_inspection_for(db, pl.inspection_id, user)
    return Response(storage.read(pl.pdf_key), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="punch-list-{pl.inspection_id}-v{pl.version}.pdf"'})


# --- repair loop & handover --------------------------------------------------------------------

@router.get("/contractor/tasks")
def contractor_tasks(db: Session = Depends(get_db), user: User = Depends(require_roles("contractor", "admin"))):
    q = select(Finding).join(Inspection, Finding.inspection_id == Inspection.id).where(
        Finding.status.in_(("fix_required", "awaiting_reinspection")))
    if user.role == "contractor":
        q = q.where(Inspection.contractor_id == user.id)
    users = _users(db)
    return [{**finding_dict(db, f, user, users), "inspection_title": f.inspection.title, "project_name": f.inspection.project.name}
            for f in db.scalars(q.order_by(Finding.id))]


@router.post("/findings/{finding_id}/repair")
async def submit_repair(finding_id: int, background: BackgroundTasks, file: UploadFile = File(...), notes: str = Form(""),
                        lat: float | None = Form(None), lon: float | None = Form(None),
                        db: Session = Depends(get_db), user: User = Depends(require_roles("contractor", "admin"))):
    f = _finding(db, finding_id, user)
    if f.status != "fix_required":
        raise HTTPException(409, f"Repair evidence can only be submitted while the finding is 'fix_required' (now '{f.status}')")
    data = await read_upload(file, get_settings().max_upload_bytes)
    m = ingest_image(db, data, "repair_evidence", user.id, finding_id=f.id, context_tag=f.context_tag, lat=lat, lon=lon)
    f.repair_media_id = m.id
    apply_finding_action(db, f, "submit_repair", user, notes[:2000], {"repair_media_id": m.id})
    a = queue_analysis(db, m)
    db.commit()
    background.add_task(run_analysis, a.id, 1)
    return finding_dict(db, f, user, _users(db), with_events=True)


@router.post("/findings/{finding_id}/reinspect")
def reinspect(finding_id: int, body: ReinspectIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    f = _finding(db, finding_id, user)
    if body.result not in ("pass", "fail"):
        raise HTTPException(422, "result must be 'pass' or 'fail'")
    if body.result == "fail" and not body.notes.strip():
        raise HTTPException(422, "Explain why the reinspection failed")
    apply_finding_action(db, f, "pass_reinspection" if body.result == "pass" else "fail_reinspection", user, body.notes)
    if body.result == "fail":
        f.repair_media_id = None  # a new repair photo is required next time; the old one stays in the event log
    db.commit()
    return finding_dict(db, f, user, _users(db), with_events=True)


@router.post("/findings/{finding_id}/close")
def close_finding(finding_id: int, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    f = _finding(db, finding_id, user)
    apply_finding_action(db, f, "close", user, body.notes)
    db.commit()
    return finding_dict(db, f, user, _users(db), with_events=True)


@router.post("/inspections/{inspection_id}/handover")
def record_handover(inspection_id: int, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWERS))):
    insp = get_inspection_for(db, inspection_id, user)
    if insp.status == "handover_approved":
        raise HTTPException(409, "Handover has already been recorded")
    findings = db.scalars(select(Finding).where(Finding.inspection_id == insp.id)).all()
    photos = db.scalar(select(func.count()).select_from(Media).where(Media.inspection_id == insp.id, Media.kind == "inspection_photo"))
    state = handover_state(findings, photos)
    if not state["ready"]:
        raise HTTPException(409, {"code": "handover_blocked", "message": "; ".join(state["blocking_reasons"])})
    insp.status, insp.handover_by, insp.handover_at, insp.handover_note = "handover_approved", user.id, utcnow(), body.notes
    audit(db, user.id, "inspection.handover", "inspection", insp.id, note=body.notes)
    db.commit()
    return {"ok": True, "statement": state["statement"]}


@router.get("/inspections/{inspection_id}/export.csv")
def export_inspection(inspection_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    insp = get_inspection_for(db, inspection_id, user)
    users = _users(db)
    rows = []
    for f in db.scalars(select(Finding).where(Finding.inspection_id == insp.id).order_by(Finding.id)):
        rows.append([f.id, f.punch_item_no or "", f.source, f.defect_class, f.status, f.severity, f.verify_on_site,
                     f.lat or "", f.lon or "", f.context_tag or "", f.rule_reference, f.description,
                     f"media:{f.media_id}" if f.media_id else "", f"media:{f.repair_media_id}" if f.repair_media_id else "",
                     _name(users, f.reviewer_id) or "", f.reviewed_at or "", f.review_decision or "", f.review_notes,
                     f.closed_at or "", f.created_at])
    body = to_csv(["finding_id", "punch_item", "source", "defect_class", "status", "severity", "verify_on_site", "lat", "lon",
                   "context", "rule_reference", "description", "evidence_photo", "repair_photo", "reviewer", "reviewed_at",
                   "decision", "review_notes", "closed_at", "created_at"], rows)
    body += "\n# Caveat: AI proposals are candidates; only reviewer-confirmed rows are findings. Not a compliance certificate.\n"
    return Response(body, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="inspection-{insp.id}.csv"'})
