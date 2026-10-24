"""Build mode: GPS site surveys, geotagged observations, candidate corridors, material estimates and approval."""
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..gis.geo import haversine
from ..gis.osm import fetch_pedestrian_ways
from ..gis.routing import Barrier, GraphInputs, NoPathError, Weights, build_graph, candidate_routes, estimate_materials
from ..models import Finding, Issue, Media, RouteCandidate, Survey, SurveyObservation, TrackPoint, User, utcnow
from ..security import STAFF, current_user, require_roles
from ..services.documents import survey_pdf, to_csv
from ..services.media import ingest_image, media_dict, read_upload
from ..workflow import audit

router = APIRouter(tags=["build"])
SURVEY_ROLES = ("contractor", "engineer", "inspector", "admin")
APPROVER_ROLES = ("engineer", "inspector", "admin")
OBSERVATION_TYPES = ("obstacle", "crossing", "kerb_ramp", "candidate_segment", "existing_tactile", "drain_or_utility",
                     "uncertain", "note")
MIN_POINT_SPACING_M = 2.0
MAX_ACCURACY_M = 60.0


class SurveyIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    project_id: int | None = None
    notes: str = Field(default="", max_length=2000)


class PointIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    recorded_at: datetime | None = None


class TrackIn(BaseModel):
    points: list[PointIn] = Field(max_length=2000)


class ObservationPatch(BaseModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    observation_type: str | None = None
    note: str | None = Field(default=None, max_length=2000)


class DecisionIn(BaseModel):
    decision: str  # approve | reject
    note: str = Field(default="", max_length=2000)


class RouteRequest(BaseModel):
    survey_id: int
    start: list[float] | None = Field(default=None, min_length=2, max_length=2)
    end: list[float] | None = Field(default=None, min_length=2, max_length=2)
    use_osm: bool = True
    weights: dict[str, float] | None = None
    exclude_impassable: bool = False
    strip_width_tiles: int = Field(default=1, ge=1, le=4)


def _users(db: Session) -> dict[int, User]:
    return {u.id: u for u in db.scalars(select(User))}


def _survey_for(db: Session, survey_id: int, user: User, write: bool = False) -> Survey:
    s = db.get(Survey, survey_id)
    if not s:
        raise HTTPException(404, "Survey not found")
    if user.role in STAFF or s.created_by == user.id:
        if write and s.created_by != user.id and user.role not in ("admin",):
            raise HTTPException(403, "Only the survey owner can modify it")
        return s
    raise HTTPException(403, "You do not have access to this survey")


def survey_dict(db: Session, s: Survey, users: dict[int, User], detail: bool = False) -> dict:
    d = {"id": s.id, "title": s.title, "status": s.status, "notes": s.notes, "project_id": s.project_id,
         "created_by": users[s.created_by].display_name if s.created_by in users else None, "owner_id": s.created_by,
         "started_at": s.started_at, "ended_at": s.ended_at, "is_demo": s.is_demo,
         "reviewed_by": users[s.reviewed_by].display_name if s.reviewed_by in users else None,
         "reviewed_at": s.reviewed_at, "review_note": s.review_note,
         "point_count": len(s.points), "observation_count": len(s.observations)}
    if detail:
        d["track"] = [{"id": p.id, "lat": p.lat, "lon": p.lon, "accuracy_m": p.accuracy_m, "recorded_at": p.recorded_at} for p in s.points]
        d["observations"] = [{"id": o.id, "lat": o.lat, "lon": o.lon, "accuracy_m": o.accuracy_m, "location_source": o.location_source,
                              "observation_type": o.observation_type, "note": o.note, "created_at": o.created_at,
                              "media": media_dict(db.get(Media, o.media_id)) if o.media_id else None}
                             for o in s.observations]
        routes = db.scalars(select(RouteCandidate).where(RouteCandidate.survey_id == s.id).order_by(RouteCandidate.batch.desc(), RouteCandidate.rank)).all()
        d["routes"] = [route_dict(r, users) for r in routes]
    return d


def route_dict(r: RouteCandidate, users) -> dict:
    return {"id": r.id, "batch": r.batch, "rank": r.rank, "geometry": r.geometry, "distance_m": r.distance_m, "score": r.score,
            "score_breakdown": r.score_breakdown, "materials": r.materials, "params": r.params,
            "approval_status": r.approval_status, "approved_by": users[r.approved_by].display_name if r.approved_by in users else None,
            "approved_at": r.approved_at, "review_note": r.review_note, "created_at": r.created_at}


@router.get("/surveys")
def list_surveys(db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    q = select(Survey).order_by(Survey.id.desc())
    if user.role not in STAFF:
        q = q.where(Survey.created_by == user.id)
    users = _users(db)
    return [survey_dict(db, s, users) for s in db.scalars(q)]


@router.post("/surveys", status_code=201)
def create_survey(body: SurveyIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    s = Survey(title=body.title, project_id=body.project_id, notes=body.notes, created_by=user.id)
    db.add(s)
    db.flush()
    audit(db, user.id, "survey.create", "survey", s.id)
    db.commit()
    return survey_dict(db, s, _users(db), detail=True)


@router.get("/surveys/{survey_id}")
def get_survey(survey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return survey_dict(db, _survey_for(db, survey_id, user), _users(db), detail=True)


@router.post("/surveys/{survey_id}/track")
def add_track(survey_id: int, body: TrackIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    """Append GPS fixes. Sampling policy: drop fixes worse than ±60 m or closer than 2 m to the previous kept fix."""
    s = _survey_for(db, survey_id, user, write=True)
    if s.status != "recording":
        raise HTTPException(409, "Track points can only be added while the survey is recording")
    last = s.points[-1] if s.points else None
    seq = (last.seq + 1) if last else 0
    kept = dropped = 0
    for p in body.points:
        if p.accuracy_m is not None and p.accuracy_m > MAX_ACCURACY_M:
            dropped += 1
            continue
        if last and haversine(last.lat, last.lon, p.lat, p.lon) < MIN_POINT_SPACING_M:
            dropped += 1
            continue
        tp = TrackPoint(survey_id=s.id, seq=seq, lat=p.lat, lon=p.lon, accuracy_m=p.accuracy_m, recorded_at=p.recorded_at or utcnow())
        db.add(tp)
        s.points.append(tp)
        last, seq, kept = tp, seq + 1, kept + 1
    db.commit()
    return {"kept": kept, "dropped": dropped, "point_count": len(s.points)}


@router.delete("/surveys/{survey_id}/track/{point_id}")
def delete_point(survey_id: int, point_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    s = _survey_for(db, survey_id, user, write=True)
    if s.status not in ("recording", "draft"):
        raise HTTPException(409, "Submitted surveys cannot be edited")
    p = db.get(TrackPoint, point_id)
    if not p or p.survey_id != s.id:
        raise HTTPException(404, "Track point not found")
    db.delete(p)
    audit(db, user.id, "survey.track_point_removed", "survey", s.id, lat=p.lat, lon=p.lon)
    db.commit()
    return {"ok": True}


@router.post("/surveys/{survey_id}/observations", status_code=201)
async def add_observation(
    survey_id: int, lat: float = Form(..., ge=-90, le=90), lon: float = Form(..., ge=-180, le=180),
    observation_type: str = Form(...), note: str = Form(""), accuracy_m: float | None = Form(None),
    location_source: str = Form("gps"), file: UploadFile | None = File(None),
    db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES)),
):
    s = _survey_for(db, survey_id, user, write=True)
    if s.status not in ("recording", "draft"):
        raise HTTPException(409, "Submitted surveys cannot be edited")
    if observation_type not in OBSERVATION_TYPES:
        raise HTTPException(422, f"observation_type must be one of {', '.join(OBSERVATION_TYPES)}")
    if location_source not in ("gps", "manual"):
        raise HTTPException(422, "location_source must be gps or manual")
    media_id = None
    if file is not None and file.filename:
        data = await read_upload(file, get_settings().max_upload_bytes)
        m = ingest_image(db, data, "observation_photo", user.id, enforce_quality=False, survey_id=s.id, lat=lat, lon=lon,
                         gps_accuracy_m=accuracy_m, context_tag="other")
        media_id = m.id
    o = SurveyObservation(survey_id=s.id, lat=lat, lon=lon, accuracy_m=accuracy_m, location_source=location_source,
                          observation_type=observation_type, note=note[:2000], media_id=media_id,
                          verified=observation_type != "uncertain")
    db.add(o)
    db.commit()
    return {"id": o.id}


@router.patch("/surveys/{survey_id}/observations/{obs_id}")
def update_observation(survey_id: int, obs_id: int, body: ObservationPatch, db: Session = Depends(get_db),
                       user: User = Depends(require_roles(*SURVEY_ROLES))):
    s = _survey_for(db, survey_id, user, write=True)
    if s.status not in ("recording", "draft"):
        raise HTTPException(409, "Submitted surveys cannot be edited")
    o = db.get(SurveyObservation, obs_id)
    if not o or o.survey_id != s.id:
        raise HTTPException(404, "Observation not found")
    data = body.model_dump(exclude_none=True)
    if "observation_type" in data and data["observation_type"] not in OBSERVATION_TYPES:
        raise HTTPException(422, "Unknown observation type")
    if ("lat" in data) != ("lon" in data):
        raise HTTPException(422, "Move the pin by sending both lat and lon")
    if "lat" in data:
        audit(db, user.id, "survey.pin_corrected", "survey", s.id, obs=o.id, before=[o.lat, o.lon], after=[data["lat"], data["lon"]])
        o.location_source = "corrected"
    for k, v in data.items():
        setattr(o, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/surveys/{survey_id}/observations/{obs_id}")
def delete_observation(survey_id: int, obs_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    s = _survey_for(db, survey_id, user, write=True)
    if s.status not in ("recording", "draft"):
        raise HTTPException(409, "Submitted surveys cannot be edited")
    o = db.get(SurveyObservation, obs_id)
    if not o or o.survey_id != s.id:
        raise HTTPException(404, "Observation not found")
    db.delete(o)
    db.commit()
    return {"ok": True}


@router.post("/surveys/{survey_id}/finish")
def finish_survey(survey_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    s = _survey_for(db, survey_id, user, write=True)
    if s.status != "recording":
        raise HTTPException(409, "Survey is not recording")
    s.status, s.ended_at = "draft", utcnow()
    db.commit()
    return survey_dict(db, s, _users(db), detail=True)


@router.post("/surveys/{survey_id}/submit")
def submit_survey(survey_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    s = _survey_for(db, survey_id, user, write=True)
    if s.status != "draft":
        raise HTTPException(409, "Finish recording before submitting the survey for approval")
    if not db.scalar(select(func.count()).select_from(RouteCandidate).where(RouteCandidate.survey_id == s.id)):
        raise HTTPException(409, "Generate at least one candidate corridor before submitting")
    s.status = "submitted"
    audit(db, user.id, "survey.submit", "survey", s.id)
    db.commit()
    return survey_dict(db, s, _users(db), detail=True)


@router.post("/surveys/{survey_id}/reopen")
def reopen_survey(survey_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    s = _survey_for(db, survey_id, user, write=True)
    if s.status not in ("draft", "rejected"):
        raise HTTPException(409, "Only draft or rejected surveys can be reopened for recording")
    s.status = "recording"
    db.commit()
    return survey_dict(db, s, _users(db), detail=True)


@router.post("/surveys/{survey_id}/review")
def review_survey(survey_id: int, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*APPROVER_ROLES))):
    s = _survey_for(db, survey_id, user)
    if s.status != "submitted":
        raise HTTPException(409, "Only submitted surveys can be reviewed")
    if s.created_by == user.id and user.role != "admin":
        raise HTTPException(403, "A survey must be approved by someone other than its author")
    if body.decision not in ("approve", "reject"):
        raise HTTPException(422, "decision must be approve or reject")
    if body.decision == "reject" and not body.note.strip():
        raise HTTPException(422, "Give a reason for rejecting the survey")
    s.status = "approved" if body.decision == "approve" else "rejected"
    s.reviewed_by, s.reviewed_at, s.review_note = user.id, utcnow(), body.note
    audit(db, user.id, f"survey.{body.decision}", "survey", s.id, note=body.note)
    db.commit()
    return survey_dict(db, s, _users(db), detail=True)


def _barriers(db: Session, survey: Survey) -> tuple[list[Barrier], list[tuple[float, float]]]:
    barriers, crossings = [], []
    for o in survey.observations:
        if o.observation_type == "obstacle":
            barriers.append(Barrier(o.lat, o.lon, f"Survey obstacle #{o.id}", "survey", o.verified))
        elif o.observation_type == "drain_or_utility":
            barriers.append(Barrier(o.lat, o.lon, f"Drain/utility #{o.id}", "survey", o.verified))
        elif o.observation_type == "crossing":
            crossings.append((o.lat, o.lon))
    for f in db.scalars(select(Finding).where(Finding.defect_class == "obstacle_on_path", Finding.lat.is_not(None),
                                              Finding.status.in_(("confirmed", "fix_required", "awaiting_reinspection")))):
        barriers.append(Barrier(f.lat, f.lon, f"Confirmed inspection finding F-{f.id}", "inspection", True))
    for i in db.scalars(select(Issue).where(Issue.category.in_(("blocked_tactile_path", "ordinary_obstacle")), Issue.lat.is_not(None),
                                            Issue.status.in_(("submitted", "under_review", "assigned", "in_progress")))):
        barriers.append(Barrier(i.lat, i.lon, f"Public report {i.reference}", "report", i.status != "submitted"))
    return barriers, crossings


@router.post("/routes/candidates", status_code=201)
def generate_routes(body: RouteRequest, db: Session = Depends(get_db), user: User = Depends(require_roles(*SURVEY_ROLES))):
    s = _survey_for(db, body.survey_id, user)
    track = [(p.lat, p.lon) for p in s.points]
    if len(track) < 2 and not body.use_osm:
        raise HTTPException(422, "Record at least two GPS points or enable map context")
    start = tuple(body.start) if body.start else (track[0] if track else None)
    end = tuple(body.end) if body.end else (track[-1] if track else None)
    if not start or not end:
        raise HTTPException(422, "Choose start and end points")
    w = Weights(exclude_impassable=body.exclude_impassable)
    for k, v in (body.weights or {}).items():
        if k in ("barrier", "crossing", "uncertainty", "barrier_buffer_m"):
            if v < 0:
                raise HTTPException(422, "Weights must be non-negative")
            setattr(w, k, float(v))
    barriers, crossings = _barriers(db, s)
    osm, osm_note = None, None
    if body.use_osm:
        lats = [p[0] for p in track] + [start[0], end[0]]
        lons = [p[1] for p in track] + [start[1], end[1]]
        pad = 0.002
        osm, osm_note = fetch_pedestrian_ways(min(lats) - pad, min(lons) - pad, max(lats) + pad, max(lons) + pad)
    g = build_graph(GraphInputs(track, crossings, barriers, osm), w)
    try:
        results = candidate_routes(g, start, end, w)
    except NoPathError as exc:
        raise HTTPException(422, {"code": "no_path", "message": str(exc), "osm_note": osm_note}) from exc
    batch = (db.scalar(select(func.max(RouteCandidate.batch)).where(RouteCandidate.survey_id == s.id)) or 0) + 1
    out = []
    for rank, r in enumerate(results, 1):
        bd = r["score_breakdown"]
        if osm_note:
            bd["missing_data"].append(osm_note)
        if not body.use_osm:
            bd["missing_data"].append("Map context not requested: only the surveyed track was searched")
        mats = estimate_materials(r["distance_m"], bd["crossing_count"], bd["turns"], strip_width_tiles=body.strip_width_tiles)
        rc = RouteCandidate(survey_id=s.id, batch=batch, rank=rank, geometry=r["geometry"], distance_m=r["distance_m"],
                            score=r["score"], score_breakdown=bd, materials=mats,
                            params={"start": list(start), "end": list(end), "use_osm": body.use_osm,
                                    "graph_edges": g.number_of_edges(), "barriers_considered": len(barriers)})
        db.add(rc)
        out.append(rc)
    db.commit()
    users = _users(db)
    return [route_dict(r, users) for r in out]


@router.get("/surveys/{survey_id}/routes")
def list_routes(survey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = _survey_for(db, survey_id, user)
    users = _users(db)
    return [route_dict(r, users) for r in db.scalars(select(RouteCandidate).where(RouteCandidate.survey_id == s.id)
                                                      .order_by(RouteCandidate.batch.desc(), RouteCandidate.rank))]


@router.post("/routes/{route_id}/decision")
def decide_route(route_id: int, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*APPROVER_ROLES))):
    r = db.get(RouteCandidate, route_id)
    if not r:
        raise HTTPException(404, "Route candidate not found")
    s = _survey_for(db, r.survey_id, user)
    if s.created_by == user.id and user.role != "admin":
        raise HTTPException(403, "A corridor must be approved by someone other than the survey author")
    if r.approval_status != "draft":
        raise HTTPException(409, f"Route is already {r.approval_status}")
    if body.decision not in ("approve", "reject"):
        raise HTTPException(422, "decision must be approve or reject")
    if body.decision == "approve":
        for other in db.scalars(select(RouteCandidate).where(RouteCandidate.survey_id == s.id, RouteCandidate.id != r.id,
                                                             RouteCandidate.approval_status == "approved")):
            other.approval_status = "superseded"
    r.approval_status = "approved" if body.decision == "approve" else "rejected"
    r.approved_by, r.approved_at, r.review_note = user.id, utcnow(), body.note
    audit(db, user.id, f"route.{body.decision}", "route", r.id, survey=s.id)
    db.commit()
    return route_dict(r, _users(db))


@router.get("/surveys/{survey_id}/export.csv")
def export_survey_csv(survey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = _survey_for(db, survey_id, user)
    rows = [["track_point", p.seq, p.lat, p.lon, p.accuracy_m or "", "", p.recorded_at, ""] for p in s.points]
    rows += [["observation", o.id, o.lat, o.lon, o.accuracy_m or "", o.observation_type, o.created_at,
              f"{o.location_source}; {o.note}" + (f"; media:{o.media_id}" if o.media_id else "")] for o in s.observations]
    body = to_csv(["record", "id", "lat", "lon", "accuracy_m", "type", "timestamp", "notes"], rows)
    body += "\n# Caveat: draft survey data for engineering review; GPS accuracy as reported by the device.\n"
    return Response(body, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="survey-{s.id}.csv"'})


@router.get("/surveys/{survey_id}/export.pdf")
def export_survey_pdf(survey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = _survey_for(db, survey_id, user)
    users = _users(db)
    routes = db.scalars(select(RouteCandidate).where(RouteCandidate.survey_id == s.id).order_by(RouteCandidate.batch.desc(), RouteCandidate.rank)).all()
    pdf = survey_pdf(s, users.get(s.created_by), routes, users)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="survey-{s.id}.pdf"'})
