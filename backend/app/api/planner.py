"""Tactile Route Planner & Material Estimator API (new module; existing endpoints are untouched).

Access: a planning project belongs to its owner. Reviewers (engineer, inspector, admin) can open a project
read-only only after one of its versions has been submitted for review, and never approve their own work.
"""
import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..config import get_settings
from ..db import get_db
from ..models import Inspection, Project, User, utcnow
from ..planner import autoroute
from ..planner.document import (DEFAULT_SETTINGS, FEATURE_TYPES, LAYOUT_OPTIONS, TILE_TYPES, DocumentIn, empty_document,
                                merged_settings, to_scene)
from ..planner.estimator import ENGINE_VERSION, estimate
from ..planner.layouts import DESCRIPTIONS, compare
from ..planner.models import PlanningEstimate, PlanningProject, PlanningReview, PlanningSiteImage, PlanningVersion
from ..planner.report import version_pdf
from ..planner.validation import validate
from ..security import require_roles
from ..services.media import read_upload
from ..vision.imageio import UploadError, normalize_upload
from ..workflow import audit

router = APIRouter(prefix="/planning", tags=["planning"])
PLANNER_ROLES = ("contractor", "engineer", "inspector", "admin")
REVIEWER_ROLES = ("engineer", "inspector", "admin")
REVIEWABLE = ("submitted", "approved", "rejected")


class PlanningProjectIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    site_name: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=4000)
    project_id: int | None = None


class PlanningProjectPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    site_name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    settings: dict | None = None


class PlanningDocumentSave(BaseModel):
    document: dict
    base_revision: int


class PlanningAnalyzeIn(BaseModel):
    document: dict | None = None
    settings: dict | None = None


class PlanningSuggestIn(BaseModel):
    start: list[float] = Field(min_length=2, max_length=2)
    end: list[float] = Field(min_length=2, max_length=2)
    width_tiles: int = Field(default=1, ge=1, le=4)
    document: dict | None = None


class PlanningVersionIn(BaseModel):
    label: str = Field(default="", max_length=200)


class PlanningReviewIn(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    note: str = Field(default="", max_length=2000)


def _doc(raw: dict) -> dict:
    try:
        return DocumentIn.model_validate(raw).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, {"code": "invalid_document", "message": "; ".join(
            f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:5])}) from exc


def _clean_settings(raw: dict | None) -> dict:
    s = merged_settings(raw)
    try:
        assert 100 <= float(s["tile_size_mm"]) <= 1000
        assert 0 <= float(s["kerf_mm"]) <= 20 and 0 <= float(s["min_offcut_mm"]) <= 1000
        assert 0 <= float(s["spare_pct"]) <= 100 and 0 <= int(s["min_spare_tiles"]) <= 1000
        assert 0 < float(s["sliver_fraction"]) < 1 and float(s["cut_cost_per_cut"]) >= 0
        for t in TILE_TYPES:
            assert 1 <= int(s["prices"][t]["pack_size"]) <= 10000 and float(s["prices"][t]["price_per_pack"]) >= 0
        for k in ("clearance_m", "hazard_approach_m", "min_warning_depth_m", "connect_tolerance_m"):
            assert 0 <= float(s[k]) <= 10
        assert 0 <= float(s["turn_review_deg"]) <= 180
    except (AssertionError, TypeError, ValueError, KeyError) as exc:
        raise HTTPException(422, {"code": "invalid_settings", "message": "Settings out of range"}) from exc
    return s


def _has_reviewable(p: PlanningProject) -> bool:
    return any(v.status in REVIEWABLE for v in p.versions)


def _project_for(db: Session, pid: int, user: User, write: bool = False) -> tuple[PlanningProject, str]:
    p = db.get(PlanningProject, pid)
    if p and p.owner_id == user.id:
        return p, "owner"
    if p and not write and user.role in REVIEWER_ROLES and _has_reviewable(p):
        return p, "reviewer"
    if p and write and user.role in REVIEWER_ROLES and _has_reviewable(p):
        raise HTTPException(403, "Only the owner can edit this design")
    raise HTTPException(404, "Planning project not found")  # do not reveal other users' projects


def _version_for(db: Session, vid: int, user: User) -> tuple[PlanningVersion, str]:
    v = db.get(PlanningVersion, vid)
    if not v:
        raise HTTPException(404, "Version not found")
    p, access = _project_for(db, v.planning_project_id, user)
    if access == "reviewer" and v.status not in REVIEWABLE:
        raise HTTPException(404, "Version not found")
    return v, access


def _users(db: Session) -> dict[int, User]:
    return {u.id: u for u in db.scalars(select(User))}


def _version_summary(v: PlanningVersion, users) -> dict:
    est = v.estimate.result if v.estimate else {}
    return {
        "id": v.id, "number": v.number, "label": v.label, "status": v.status,
        "created_by": getattr(users.get(v.created_by), "display_name", None), "created_at": v.created_at,
        "submitted_at": v.submitted_at,
        "counts": (v.validation or {}).get("counts", {}),
        "total_cost": (est.get("totals") or {}).get("total_cost"), "currency": est.get("currency"),
        "reviews": [{"decision": r.decision, "note": r.note, "reviewer": getattr(users.get(r.reviewer_id), "display_name", None),
                     "at": r.created_at} for r in v.reviews],
    }


def _project_dict(db: Session, p: PlanningProject, access: str, detail: bool = False) -> dict:
    users = _users(db)
    versions = p.versions if access == "owner" else [v for v in p.versions if v.status in REVIEWABLE]
    out = {
        "id": p.id, "title": p.title, "site_name": p.site_name, "description": p.description, "project_id": p.project_id,
        "owner": getattr(users.get(p.owner_id), "display_name", None), "access": access,
        "created_at": p.created_at, "updated_at": p.updated_at, "revision": p.revision,
        "latest_version": _version_summary(versions[-1], users) if versions else None,
    }
    if detail:
        out["document"] = p.document if access == "owner" else (versions[-1].document if versions else empty_document())
        out["settings"] = merged_settings(p.settings)
        out["versions"] = [_version_summary(v, users) for v in versions]
        imgs = db.scalars(select(PlanningSiteImage).where(PlanningSiteImage.planning_project_id == p.id)
                          .order_by(PlanningSiteImage.id.desc())).all()
        out["site_images"] = [{"id": i.id, "width": i.width, "height": i.height, "name": i.original_name} for i in imgs]
    return out


@router.get("/meta")
def meta(user: User = Depends(require_roles(*PLANNER_ROLES))):
    return {"feature_types": {k: v[0] for k, v in FEATURE_TYPES.items()}, "tile_types": list(TILE_TYPES),
            "layout_options": [{"id": o, "description": DESCRIPTIONS[o]} for o in LAYOUT_OPTIONS],
            "default_settings": DEFAULT_SETTINGS, "engine_version": ENGINE_VERSION}


@router.get("/projects")
def list_projects(db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    own = db.scalars(select(PlanningProject).where(PlanningProject.owner_id == user.id)
                     .order_by(PlanningProject.updated_at.desc())).all()
    out = [_project_dict(db, p, "owner") for p in own]
    if user.role in REVIEWER_ROLES:
        others = db.scalars(select(PlanningProject).where(PlanningProject.owner_id != user.id)
                            .order_by(PlanningProject.updated_at.desc())).all()
        out += [_project_dict(db, p, "reviewer") for p in others if _has_reviewable(p)]
    return out


@router.post("/projects", status_code=201)
def create_project(body: PlanningProjectIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    if body.project_id is not None:
        proj = db.get(Project, body.project_id)
        if not proj:
            raise HTTPException(422, "Linked site (project) not found")
        if user.role == "contractor" and not db.scalars(select(Inspection).where(
                Inspection.project_id == proj.id, Inspection.contractor_id == user.id)).first():
            raise HTTPException(403, "You are not assigned to that site")
    p = PlanningProject(owner_id=user.id, title=body.title.strip(), site_name=body.site_name.strip(),
                        description=body.description, project_id=body.project_id, document=empty_document(),
                        settings=merged_settings(None))
    db.add(p)
    db.flush()
    audit(db, user.id, "planning.project_created", "planning_project", p.id, title=p.title)
    db.commit()
    return _project_dict(db, p, "owner", detail=True)


@router.get("/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    p, access = _project_for(db, pid, user)
    return _project_dict(db, p, access, detail=True)


@router.patch("/projects/{pid}")
def patch_project(pid: int, body: PlanningProjectPatch, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    p, _ = _project_for(db, pid, user, write=True)
    for k in ("title", "site_name", "description"):
        v = getattr(body, k)
        if v is not None:
            setattr(p, k, v.strip() if k != "description" else v)
    if body.settings is not None:
        p.settings = _clean_settings(body.settings)
    p.updated_at = utcnow()
    db.commit()
    return _project_dict(db, p, "owner", detail=True)


@router.put("/projects/{pid}/document")
def save_document(pid: int, body: PlanningDocumentSave, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    p, _ = _project_for(db, pid, user, write=True)
    if body.base_revision != p.revision:
        raise HTTPException(409, {"code": "stale_revision", "message": "This design was changed elsewhere. Reload before saving.",
                                  "revision": p.revision})
    doc = _doc(body.document)
    if doc["site_image_id"] is not None and not db.scalars(select(PlanningSiteImage).where(
            PlanningSiteImage.id == doc["site_image_id"], PlanningSiteImage.planning_project_id == p.id)).first():
        raise HTTPException(422, "Site image does not belong to this project")
    p.document = doc
    p.revision += 1
    p.updated_at = utcnow()
    db.commit()
    return {"revision": p.revision, "updated_at": p.updated_at}


@router.post("/projects/{pid}/site-image", status_code=201)
async def upload_site_image(pid: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                            user: User = Depends(require_roles(*PLANNER_ROLES))):
    p, _ = _project_for(db, pid, user, write=True)
    data = await read_upload(file, get_settings().max_upload_bytes)
    try:
        img = normalize_upload(data)
    except UploadError as exc:
        raise HTTPException(422, {"code": "invalid_image", "message": str(exc)}) from exc
    key = storage.new_key(f"planning/{p.id}")
    storage.write(key, img.jpeg, immutable=True)
    rec = PlanningSiteImage(planning_project_id=p.id, storage_key=key, width=img.width, height=img.height,
                            original_name=(file.filename or "")[:200], uploaded_by=user.id)
    db.add(rec)
    db.flush()
    audit(db, user.id, "planning.site_image_uploaded", "planning_project", p.id, image_id=rec.id)
    db.commit()
    return {"id": rec.id, "width": rec.width, "height": rec.height, "name": rec.original_name}


@router.get("/site-images/{image_id}/file")
def site_image_file(image_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    rec = db.get(PlanningSiteImage, image_id)
    if not rec:
        raise HTTPException(404, "Not found")
    _project_for(db, rec.planning_project_id, user)
    return Response(storage.read(rec.storage_key), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=600"})


def _analyse(doc: dict, settings: dict) -> dict:
    scene = to_scene(doc)
    return {"validation": validate(scene, settings), "estimate": estimate(scene, settings), "comparison": compare(scene, settings)}


@router.post("/projects/{pid}/analyze")
def analyze(pid: int, body: PlanningAnalyzeIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    """Checks and estimate for the current draft (or the stored one). Nothing is saved."""
    p, access = _project_for(db, pid, user)
    if access != "owner" and body.document is not None:
        raise HTTPException(403, "Only the owner can analyse an unsaved draft")
    if body.document is not None:
        doc = _doc(body.document)
    elif access == "owner":
        doc = p.document
    else:  # reviewers only ever see submitted (or decided) versions, never drafts
        doc = [v for v in p.versions if v.status in REVIEWABLE][-1].document
    settings = _clean_settings(body.settings if body.settings is not None else p.settings)
    return _analyse(doc, settings)


@router.post("/projects/{pid}/suggest-route")
def suggest_route(pid: int, body: PlanningSuggestIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    p, _ = _project_for(db, pid, user, write=True)
    doc = _doc(body.document) if body.document is not None else p.document
    try:
        return autoroute.suggest(to_scene(doc), (doc["canvas"]["width"], doc["canvas"]["height"]), body.start, body.end,
                                 body.width_tiles, p.settings)
    except autoroute.NoRoute as exc:
        raise HTTPException(422, {"code": "no_route", "message": str(exc)}) from exc


@router.post("/projects/{pid}/versions", status_code=201)
def create_version(pid: int, body: PlanningVersionIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    """Freeze the saved draft as a numbered version, with its checks and estimate."""
    p, _ = _project_for(db, pid, user, write=True)
    settings = merged_settings(p.settings)
    result = _analyse(p.document, settings)
    number = (max((v.number for v in p.versions), default=0)) + 1
    v = PlanningVersion(planning_project_id=p.id, number=number, label=body.label.strip(), document=p.document,
                        settings=settings, validation=result["validation"], status="saved", created_by=user.id)
    db.add(v)
    db.flush()
    db.add(PlanningEstimate(version_id=v.id, engine_version=ENGINE_VERSION, result=result["estimate"],
                            comparison=result["comparison"]))
    p.updated_at = utcnow()
    audit(db, user.id, "planning.version_saved", "planning_version", v.id, project=p.id, number=number)
    db.commit()
    db.refresh(v)
    return _version_detail(v, _users(db), "owner")


def _version_detail(v: PlanningVersion, users, access: str) -> dict:
    return {**_version_summary(v, users), "access": access, "planning_project_id": v.planning_project_id,
            "document": v.document, "settings": v.settings, "validation": v.validation,
            "estimate": v.estimate.result if v.estimate else None,
            "comparison": v.estimate.comparison if v.estimate else []}


@router.get("/versions/{vid}")
def get_version(vid: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    v, access = _version_for(db, vid, user)
    return _version_detail(v, _users(db), access)


@router.post("/versions/{vid}/submit")
def submit_version(vid: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    v, access = _version_for(db, vid, user)
    if access != "owner":
        raise HTTPException(403, "Only the owner can submit")
    if v.status != "saved":
        raise HTTPException(409, f"Version is already {v.status}")
    errors = (v.validation or {}).get("counts", {}).get("error", 0)
    if errors:
        raise HTTPException(409, {"code": "has_errors", "message": f"Fix the {errors} error(s) found by the checks, save a new version, then submit."})
    v.status = "submitted"
    v.submitted_at = utcnow()
    audit(db, user.id, "planning.version_submitted", "planning_version", v.id)
    db.commit()
    return _version_summary(v, _users(db))


@router.post("/versions/{vid}/review")
def review_version(vid: int, body: PlanningReviewIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*REVIEWER_ROLES))):
    v, _ = _version_for(db, vid, user)
    if v.created_by == user.id or v.planning_project.owner_id == user.id:
        raise HTTPException(403, "A design must be reviewed by someone other than its author")
    if v.status != "submitted":
        raise HTTPException(409, "Only submitted versions can be reviewed")
    if body.decision == "reject" and not body.note.strip():
        raise HTTPException(422, "A reason is required to reject a design")
    v.status = "approved" if body.decision == "approve" else "rejected"
    db.add(PlanningReview(version_id=v.id, reviewer_id=user.id, decision=v.status, note=body.note.strip()))
    audit(db, user.id, f"planning.version_{v.status}", "planning_version", v.id, note=body.note.strip())
    db.commit()
    db.refresh(v)
    return _version_summary(v, _users(db))


@router.get("/versions/{vid}/report.pdf")
def version_report(vid: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    v, _ = _version_for(db, vid, user)
    p = v.planning_project
    image = None
    if v.document.get("site_image_id"):
        rec = db.get(PlanningSiteImage, v.document["site_image_id"])
        if rec and rec.planning_project_id == p.id and storage.exists(rec.storage_key):
            image = storage.read(rec.storage_key)
    pdf = version_pdf(project=p, version=v, estimate=v.estimate.result if v.estimate else None,
                      comparison=v.estimate.comparison if v.estimate else [], users=_users(db), image=image)
    name = f"tactile-plan-{p.id}-v{v.number}.pdf"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/versions/{vid}/estimate.csv")
def version_csv(vid: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*PLANNER_ROLES))):
    v, _ = _version_for(db, vid, user)
    est = v.estimate.result if v.estimate else {}
    buf = io.StringIO()
    w = csv.writer(buf)
    fields = ["area_m2", "whole_tiles", "cut_pieces", "new_tiles_for_cuts", "pieces_from_offcuts", "sliver_pieces",
              "tiles_required", "spare_tiles", "packs", "pack_size", "purchase_tiles", "leftover_offcuts", "waste_area_m2",
              "waste_pct", "material_cost", "cutting_cost", "naive_area_estimate_tiles", "supplier"]
    w.writerow(["tile_type", *fields, "currency", "version", "status"])
    for t, row in (est.get("by_type") or {}).items():
        w.writerow([t, *[row.get(f) for f in fields], est.get("currency"), v.number, v.status])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="tactile-estimate-v{v.number}.csv"'})


@router.get("/approved-layouts")
def approved_layouts(project_id: int | None = None, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*REVIEWER_ROLES))):
    """Integration point for a future inspection enhancement: approved layouts, optionally for one site.
    Read-only; nothing in the existing inspection workflow calls it."""
    q = select(PlanningVersion).join(PlanningProject).where(PlanningVersion.status == "approved")
    if project_id is not None:
        q = q.where(PlanningProject.project_id == project_id)
    return [{"version_id": v.id, "planning_project_id": v.planning_project_id, "project_id": v.planning_project.project_id,
             "title": v.planning_project.title, "number": v.number, "document": v.document,
             "approved_at": v.reviews[-1].created_at if v.reviews else None} for v in db.scalars(q)]
