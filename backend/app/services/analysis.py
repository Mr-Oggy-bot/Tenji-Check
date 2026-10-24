"""Inference orchestration: tiles -> homography -> obstacles -> rules -> stored predictions and candidates."""
import logging
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..db import SessionLocal
from ..models import AIPrediction, Analysis, Finding, Inspection, Media, ModelVersion, utcnow
from ..rules.engine import evaluate, references
from ..vision.annotate import render
from ..vision.geometry import analyze_strip, fit_strip
from ..vision.imageio import decode_jpeg, encode_jpeg
from ..vision.obstacles import get_obstacle_detector
from ..vision.tiles import get_tile_segmenter
from ..workflow import record_initial_finding_event

log = logging.getLogger(__name__)
UNCERTAIN_CONFIDENCE = 0.35


def queue_analysis(db: Session, media: Media) -> Analysis:
    a = Analysis(media_id=media.id, status="queued")
    db.add(a)
    db.flush()
    return a


def latest_analysis(db: Session, media_id: int) -> Analysis | None:
    return db.scalars(select(Analysis).where(Analysis.media_id == media_id).order_by(Analysis.id.desc())).first()


def _register_model(db: Session, name: str, kind: str, version: str) -> None:
    exists = db.scalars(select(ModelVersion).where(ModelVersion.name == name, ModelVersion.version == version)).first()
    if not exists:
        db.add(ModelVersion(name=name, kind=kind, version=version,
                            metrics={"status": "not evaluated on a held-out TenjiCheck test set"}))


def run_analysis(analysis_id: int, strip_width_tiles: int = 1) -> None:
    db = SessionLocal()
    try:
        _run(db, analysis_id, strip_width_tiles)
    finally:
        db.close()


def _run(db: Session, analysis_id: int, strip_width_tiles: int) -> None:
    analysis = db.get(Analysis, analysis_id)
    media = db.get(Media, analysis.media_id)
    analysis.status, analysis.started_at = "running", utcnow()
    db.commit()
    t0 = time.perf_counter()
    try:
        bgr = decode_jpeg(storage.read(media.original_key))
        segmenter = get_tile_segmenter()
        seg = segmenter.segment(bgr)
        geom = fit_strip(seg.mask)
        strip = analyze_strip(bgr, seg, geom, strip_width_tiles) if geom else None

        detector = get_obstacle_detector()
        obstacles, obstacle_status = None, {"available": detector.available, "model": detector.version}
        if detector.available:
            try:
                obstacles = detector.detect(bgr)
            except Exception as exc:  # noqa: BLE001
                obstacle_status = {"available": False, "model": detector.version, "error": str(exc)}
        else:
            obstacle_status["reason"] = detector.reason

        candidates, notes = evaluate(media.context_tag, seg.area_fraction, geom, strip, obstacles, bgr.shape)

        for comp in seg.components:
            db.add(AIPrediction(analysis_id=analysis.id, media_id=media.id, model_version=f"{segmenter.name}:{segmenter.version}",
                                class_name="tactile_tile_region", confidence=None, bbox=comp["bbox"], polygon=comp["polygon"]))
        for d in obstacles or []:
            db.add(AIPrediction(analysis_id=analysis.id, media_id=media.id, model_version=f"{detector.name}:{detector.version}",
                                class_name=d.class_name, confidence=round(d.confidence, 3), bbox=[round(v, 1) for v in d.bbox],
                                uncertain=d.confidence < UNCERTAIN_CONFIDENCE))
        _register_model(db, segmenter.name, "tile_segmentation", segmenter.version)
        if detector.available:
            _register_model(db, detector.name, "obstacle_detection", detector.version)

        numbers = list(range(1, len(candidates) + 1))
        if media.kind == "inspection_photo" and media.inspection_id:
            numbers = _create_findings(db, media, analysis, candidates)

        display = decode_jpeg(storage.read(media.display_key))
        annotated_key = storage.new_key("annotated")
        storage.write(annotated_key, encode_jpeg(render(display, strip["quad"] if strip else None, candidates, numbers)))
        media.annotated_key = annotated_key

        public_strip = {k: v for k, v in (strip or {}).items() if not k.startswith("_")} if strip else None
        analysis.result = {
            "tiles": {"method": seg.method, "version": seg.model_version, "area_fraction": round(seg.area_fraction, 4),
                      "components": len(seg.components), "notes": seg.notes},
            "geometry": public_strip,
            "obstacles": {**obstacle_status, "detections": [
                {"class_name": d.class_name, "prompt": d.prompt, "confidence": round(d.confidence, 3),
                 "bbox": [round(v, 1) for v in d.bbox], "uncertain": d.confidence < UNCERTAIN_CONFIDENCE}
                for d in obstacles or []]},
            "candidates": candidates,
            "notes": notes,
            "disclaimer": "AI output is a candidate for human review, not a compliance decision.",
        }
        analysis.tile_model = f"{segmenter.name}:{segmenter.version}"
        analysis.obstacle_model = f"{detector.name}:{detector.version}"
        analysis.rules_version = references()["version"]
        analysis.status = "done"
    except Exception as exc:  # noqa: BLE001 - failures must be visible, never silently "no defect"
        log.exception("Analysis %s failed", analysis_id)
        db.rollback()
        analysis = db.get(Analysis, analysis_id)
        analysis.status, analysis.error = "failed", f"{exc.__class__.__name__}: {exc}"
    analysis.finished_at = utcnow()
    analysis.latency_ms = int((time.perf_counter() - t0) * 1000)
    db.commit()


def _create_findings(db: Session, media: Media, analysis: Analysis, candidates: list[dict]) -> list[int]:
    inspection = db.get(Inspection, media.inspection_id)
    numbers = []
    for c in candidates:
        f = Finding(
            inspection_id=inspection.id, media_id=media.id, analysis_id=analysis.id, source="ai",
            defect_class=c["defect_class"], status="ai_proposed", severity=c["severity"],
            verify_on_site=c["verify_on_site"], uncertainty_note=c["uncertainty_note"],
            confidence=c["confidence"], bbox=c["bbox"], measurement=c["measurement"],
            rule_id=c["rule_id"], rule_reference=c["rule_reference"], description=c["description"],
            required_fix=c["required_fix"], context_tag=media.context_tag, lat=media.lat, lon=media.lon,
            ai_output=c,
        )
        db.add(f)
        db.flush()
        record_initial_finding_event(db, f, None, f"Proposed by {analysis.obstacle_model or 'rules engine'} / rules {c['rules_version']}")
        numbers.append(f.id)
    return numbers
