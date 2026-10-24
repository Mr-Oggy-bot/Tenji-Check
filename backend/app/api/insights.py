"""Shared map, dashboard aggregates, model registry/evaluation status and signed media delivery."""
import json
import statistics
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..config import BACKEND_DIR
from ..db import get_db
from ..models import Analysis, Finding, Inspection, Issue, Media, ModelVersion, PunchList, RouteCandidate, Survey, User, utcnow
from ..rules.engine import references
from ..security import STAFF, check_media_signature, current_user, require_roles
from ..services.documents import LABELS
from ..vision.obstacles import get_obstacle_detector
from ..vision.tiles import get_tile_segmenter
from .issues import CATEGORIES

router = APIRouter(tags=["insights"])
EVAL_REPORT = BACKEND_DIR.parent / "ml" / "evaluation" / "reports" / "latest.json"


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.get("/media/{media_id}/file")
def media_file(media_id: int, variant: str = "display", exp: int = 0, sig: str = ""):
    """Private images are only served through short-lived signed URLs issued to authorised users."""
    from ..db import SessionLocal

    if variant not in ("display", "annotated", "original") or not check_media_signature(media_id, variant, exp, sig):
        raise HTTPException(403, "Link expired or invalid")
    with SessionLocal() as db:
        m = db.get(Media, media_id)
        if not m:
            raise HTTPException(404, "Not found")
        key = {"display": m.display_key, "annotated": m.annotated_key, "original": m.original_key}[variant]
    if not storage.exists(key):
        raise HTTPException(404, "File not available")
    return Response(storage.read(key), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=600"})


@router.get("/map/features")
def map_features(db: Session = Depends(get_db), user: User = Depends(current_user)):
    feats = []
    staff = user.role in STAFF
    fq = select(Finding).where(Finding.lat.is_not(None), Finding.status != "rejected")
    if user.role == "contractor":
        fq = fq.join(Inspection, Finding.inspection_id == Inspection.id).where(Inspection.contractor_id == user.id)
    if staff or user.role == "contractor":
        for f in db.scalars(fq):
            feats.append({"kind": "finding", "id": f.id, "lat": f.lat, "lon": f.lon, "status": f.status,
                          "label": LABELS.get(f.defect_class, f.defect_class), "verify_on_site": f.verify_on_site,
                          "inspection_id": f.inspection_id, "unreviewed": f.status in ("ai_proposed", "under_review")})
    iq = select(Issue).where(Issue.lat.is_not(None))
    if user.role == "citizen":
        iq = iq.where(Issue.created_by == user.id)
    elif user.role == "contractor":
        iq = iq.where(Issue.assigned_to == user.id)
    for i in db.scalars(iq):
        feats.append({"kind": "issue", "id": i.id, "lat": i.lat, "lon": i.lon, "status": i.status, "reference": i.reference,
                      "label": CATEGORIES.get(i.category, i.category), "is_demo": i.is_demo})
    surveys = []
    if user.role != "citizen":
        sq = select(Survey) if staff else select(Survey).where(Survey.created_by == user.id)
        for s in db.scalars(sq):
            approved = db.scalars(select(RouteCandidate).where(RouteCandidate.survey_id == s.id,
                                                               RouteCandidate.approval_status == "approved")).first()
            surveys.append({"id": s.id, "title": s.title, "status": s.status, "track": [[p.lat, p.lon] for p in s.points],
                            "observations": [{"lat": o.lat, "lon": o.lon, "type": o.observation_type} for o in s.observations],
                            "approved_route": approved.geometry if approved else None})
    return {"features": feats, "surveys": surveys,
            "legend_note": "Markers show recorded evidence. Unknown or unmapped areas are not assumed accessible."}


def _bucket_age(days: int) -> str:
    return "0–7 days" if days <= 7 else "8–30 days" if days <= 30 else "31–90 days" if days <= 90 else "> 90 days"


def evaluation_report() -> dict:
    if EVAL_REPORT.exists():
        try:
            return {"status": "measured", **json.loads(EVAL_REPORT.read_text())}
        except ValueError:
            pass
    return {"status": "pending", "message": "No held-out evaluation has been run. Targets are not results.",
            "targets": {"obstacle_recall": 0.80}}


@router.get("/dashboard/summary")
def dashboard(date_from: datetime | None = Query(None, alias="from"), date_to: datetime | None = Query(None, alias="to"),
              db: Session = Depends(get_db), _: User = Depends(require_roles(*STAFF))):
    now = utcnow()
    start = _aware(date_from) if date_from else now - timedelta(days=90)
    end = _aware(date_to) if date_to else now
    issues = [i for i in db.scalars(select(Issue)) if start <= _aware(i.created_at) <= end]
    findings = [f for f in db.scalars(select(Finding)) if start <= _aware(f.created_at) <= end]
    open_issues = [i for i in issues if i.status not in ("resolved", "rejected")]
    cells = Counter((round(i.lat, 3), round(i.lon, 3)) for i in issues if i.lat is not None and i.status != "rejected")
    resolve_days = [(_aware(i.resolved_at) - _aware(i.created_at)).total_seconds() / 86400 for i in issues if i.resolved_at]
    reviewed_ai = [f for f in findings if f.source == "ai" and f.review_decision]
    pls = [p for p in db.scalars(select(PunchList)) if start <= _aware(p.created_at) <= end]
    latencies = [a.latency_ms for a in db.scalars(select(Analysis).where(Analysis.status == "done")) if a.latency_ms is not None]
    surveys = db.scalars(select(Survey)).all()
    return {
        "period": {"from": start, "to": end},
        "demo_records": sum(i.is_demo for i in issues),
        "issues": {
            "total": len(issues), "open": len(open_issues),
            "by_category": [{"key": k, "label": CATEGORIES.get(k, k), "count": v} for k, v in Counter(i.category for i in issues).most_common()],
            "by_status": [{"key": k, "count": v} for k, v in Counter(i.status for i in issues).items()],
            "by_severity": [{"key": k or "unset", "count": v} for k, v in Counter(i.severity for i in open_issues).items()],
            "open_by_age": [{"key": b, "count": sum(_bucket_age((now - _aware(i.created_at)).days) == b for i in open_issues)}
                            for b in ("0–7 days", "8–30 days", "31–90 days", "> 90 days")],
            "recurring_locations": [{"lat": k[0], "lon": k[1], "count": v} for k, v in cells.most_common(10) if v >= 2],
            "possible_duplicates": sum(bool(i.possible_duplicates) for i in issues if i.status != "rejected"),
            "median_days_to_resolve": round(statistics.median(resolve_days), 1) if resolve_days else None,
        },
        "findings": {
            "total": len(findings),
            "by_class": [{"key": k, "label": LABELS.get(k, k), "count": v} for k, v in Counter(f.defect_class for f in findings).most_common()],
            "by_status": [{"key": k, "count": v} for k, v in Counter(f.status for f in findings).items()],
            "by_source": dict(Counter(f.source for f in findings)),
            "verify_on_site": sum(f.verify_on_site for f in findings),
            "ai_reviewed": len(reviewed_ai),
            "ai_confirmed": sum(f.review_decision == "confirm" for f in reviewed_ai),
            "ai_rejected": sum(f.review_decision == "reject" for f in reviewed_ai),
        },
        "workflow": {
            "punch_lists": len(pls),
            "human_review_enforcement": (round(100 * sum(p.unreviewed_at_generation == 0 for p in pls) / len(pls), 1) if pls else None),
            "report_completeness": (round(100 * sum(p.complete_items for p in pls) / max(1, sum(p.item_count for p in pls)), 1)
                                    if pls and sum(p.item_count for p in pls) else None),
            "inference_latency_ms": {"median": statistics.median(latencies) if latencies else None,
                                     "p95": sorted(latencies)[int(0.95 * (len(latencies) - 1))] if latencies else None,
                                     "samples": len(latencies)},
        },
        "surveys": {"by_status": dict(Counter(s.status for s in surveys)),
                    "approved_routes": len(db.scalars(select(RouteCandidate).where(RouteCandidate.approval_status == "approved")).all())},
        "evaluation": evaluation_report(),
    }


@router.get("/models")
def models_status(db: Session = Depends(get_db), _: User = Depends(current_user)):
    det = get_obstacle_detector()
    seg = get_tile_segmenter()
    return {
        "tile_segmenter": {"name": seg.name, "version": seg.version,
                           "trained_on_tenjicheck_data": seg.name != "classical-hsv-baseline",
                           "note": "Classical colour baseline (untrained). Provide TC_TILE_MODEL_PATH with fine-tuned "
                                   "YOLOv8n-seg weights to replace it." if seg.name == "classical-hsv-baseline" else ""},
        "obstacle_detector": {"name": det.name, "version": det.version, "available": det.available,
                              "reason": getattr(det, "reason", ""),
                              "note": "Pretrained open-vocabulary YOLO-World with text prompts; not fine-tuned on TenjiCheck data."},
        "rules": {"version": references()["version"], "review_status": references()["review_status"]},
        "registry": [{"name": m.name, "kind": m.kind, "version": m.version, "dataset_version": m.dataset_version,
                      "metrics": m.metrics, "deployed_at": m.deployed_at} for m in db.scalars(select(ModelVersion))],
        "evaluation": evaluation_report(),
    }
