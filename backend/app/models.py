"""Database tables.

Model output (ai_predictions, analyses, Finding.ai_output) is always stored separately from human
decisions (reviews, Finding.review_*), and every status change is written to an append-only event table.
"""
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .db import Base


class UTCDateTime(TypeDecorator):
    """Always returns timezone-aware UTC datetimes (SQLite drops tzinfo on storage)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    location_name: Mapped[str] = mapped_column(String(200), default="")
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    inspections: Mapped[list["Inspection"]] = relationship(back_populates="project")


class Inspection(TimestampMixin, Base):
    __tablename__ = "inspections"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    site_name: Mapped[str] = mapped_column(String(200), default="")
    contractor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="open")
    handover_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    handover_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    handover_note: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    project: Mapped[Project] = relationship(back_populates="inspections")
    findings: Mapped[list["Finding"]] = relationship(back_populates="inspection", foreign_keys="Finding.inspection_id")


class Media(TimestampMixin, Base):
    __tablename__ = "media"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    inspection_id: Mapped[int | None] = mapped_column(ForeignKey("inspections.id"), index=True)
    finding_id: Mapped[int | None] = mapped_column(ForeignKey("findings.id", use_alter=True), index=True)
    issue_id: Mapped[int | None] = mapped_column(ForeignKey("issues.id", use_alter=True), index=True)
    survey_id: Mapped[int | None] = mapped_column(ForeignKey("surveys.id", use_alter=True), index=True)
    original_key: Mapped[str] = mapped_column(String(300))
    display_key: Mapped[str] = mapped_column(String(300))
    annotated_key: Mapped[str | None] = mapped_column(String(300))
    mime: Mapped[str] = mapped_column(String(50), default="image/jpeg")
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    captured_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    gps_accuracy_m: Mapped[float | None] = mapped_column(Float)
    context_tag: Mapped[str | None] = mapped_column(String(30))
    segment_label: Mapped[str] = mapped_column(String(120), default="")
    quality_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    quality: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    privacy: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    consent_basis: Mapped[str] = mapped_column(String(120), default="")
    retention_until: Mapped[datetime | None] = mapped_column(UTCDateTime)


class Analysis(TimestampMixin, Base):
    __tablename__ = "analyses"
    id: Mapped[int] = mapped_column(primary_key=True)
    media_id: Mapped[int] = mapped_column(ForeignKey("media.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|running|done|failed|skipped
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    tile_model: Mapped[str] = mapped_column(String(120), default="")
    obstacle_model: Mapped[str] = mapped_column(String(120), default="")
    rules_version: Mapped[str] = mapped_column(String(60), default="")
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AIPrediction(TimestampMixin, Base):
    __tablename__ = "ai_predictions"
    id: Mapped[int] = mapped_column(primary_key=True)
    analysis_id: Mapped[int] = mapped_column(ForeignKey("analyses.id"), index=True)
    media_id: Mapped[int] = mapped_column(ForeignKey("media.id"), index=True)
    model_version: Mapped[str] = mapped_column(String(120))
    class_name: Mapped[str] = mapped_column(String(60))
    confidence: Mapped[float | None] = mapped_column(Float)
    bbox: Mapped[list[float] | None] = mapped_column(JSON)
    polygon: Mapped[list[list[float]] | None] = mapped_column(JSON)
    uncertain: Mapped[bool] = mapped_column(Boolean, default=False)


class Finding(TimestampMixin, Base):
    __tablename__ = "findings"
    id: Mapped[int] = mapped_column(primary_key=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id"), index=True)
    media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id"))
    analysis_id: Mapped[int | None] = mapped_column(ForeignKey("analyses.id"))
    source: Mapped[str] = mapped_column(String(10))  # ai | manual
    defect_class: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    severity: Mapped[str] = mapped_column(String(10), default="high")
    verify_on_site: Mapped[bool] = mapped_column(Boolean, default=False)
    uncertainty_note: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float | None] = mapped_column(Float)
    bbox: Mapped[list[float] | None] = mapped_column(JSON)
    measurement: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    rule_id: Mapped[str] = mapped_column(String(40), default="")
    rule_reference: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    required_fix: Mapped[str] = mapped_column(Text, default="")
    context_tag: Mapped[str | None] = mapped_column(String(30))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    ai_output: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # immutable original proposal
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    review_decision: Mapped[str | None] = mapped_column(String(20))
    review_notes: Mapped[str] = mapped_column(Text, default="")
    repair_media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id"))
    reinspected_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reinspected_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    punch_item_no: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    inspection: Mapped[Inspection] = relationship(back_populates="findings", foreign_keys=[inspection_id])
    events: Mapped[list["FindingEvent"]] = relationship(order_by="FindingEvent.id")


class FindingEvent(TimestampMixin, Base):
    __tablename__ = "finding_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    finding_id: Mapped[int] = mapped_column(ForeignKey("findings.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str] = mapped_column(String(30))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class PunchList(TimestampMixin, Base):
    __tablename__ = "punch_lists"
    id: Mapped[int] = mapped_column(primary_key=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    generated_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    pdf_key: Mapped[str] = mapped_column(String(300))
    item_count: Mapped[int] = mapped_column(Integer)
    unreviewed_at_generation: Mapped[int] = mapped_column(Integer, default=0)
    complete_items: Mapped[int] = mapped_column(Integer, default=0)


class Issue(TimestampMixin, Base):
    __tablename__ = "issues"
    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(40), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), index=True, default="submitted")
    severity: Mapped[str | None] = mapped_column(String(10))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    location_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(20), default="citizen_report")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reporter_contact: Mapped[str] = mapped_column(String(200), default="")
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    rejection_reason: Mapped[str] = mapped_column(Text, default="")
    duplicate_of_id: Mapped[int | None] = mapped_column(ForeignKey("issues.id"))
    possible_duplicates: Mapped[list[int]] = mapped_column(JSON, default=list)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    events: Mapped[list["IssueEvent"]] = relationship(order_by="IssueEvent.id")
    reviews: Mapped[list["IssueReview"]] = relationship(order_by="IssueReview.id")


class IssueEvent(TimestampMixin, Base):
    __tablename__ = "status_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text, default="")


class IssueReview(TimestampMixin, Base):
    __tablename__ = "reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id"), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(10))  # confirm | edit | reject
    edited_category: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[str] = mapped_column(Text, default="")


class Survey(TimestampMixin, Base):
    __tablename__ = "surveys"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    status: Mapped[str] = mapped_column(String(20), default="recording")
    notes: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    review_note: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    points: Mapped[list["TrackPoint"]] = relationship(order_by="TrackPoint.seq", cascade="all, delete-orphan")
    observations: Mapped[list["SurveyObservation"]] = relationship(order_by="SurveyObservation.id", cascade="all, delete-orphan")


class TrackPoint(Base):
    __tablename__ = "track_points"
    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class SurveyObservation(TimestampMixin, Base):
    __tablename__ = "survey_observations"
    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float)
    location_source: Mapped[str] = mapped_column(String(15), default="gps")  # gps | manual | corrected
    observation_type: Mapped[str] = mapped_column(String(30))
    note: Mapped[str] = mapped_column(Text, default="")
    media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id"))
    verified: Mapped[bool] = mapped_column(Boolean, default=True)


class RouteCandidate(TimestampMixin, Base):
    __tablename__ = "route_candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id"), index=True)
    batch: Mapped[int] = mapped_column(Integer)
    rank: Mapped[int] = mapped_column(Integer)
    geometry: Mapped[list[list[float]]] = mapped_column(JSON)
    distance_m: Mapped[float] = mapped_column(Float)
    score: Mapped[float] = mapped_column(Float)
    score_breakdown: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    materials: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    approval_status: Mapped[str] = mapped_column(String(15), default="draft")
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    review_note: Mapped[str] = mapped_column(Text, default="")


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(30))
    version: Mapped[str] = mapped_column(String(60))
    artifact_hash: Mapped[str] = mapped_column(String(64), default="")
    dataset_version: Mapped[str] = mapped_column(String(60), default="")
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    deployed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("name", "version"),)


class IdempotencyRecord(TimestampMixin, Base):
    __tablename__ = "idempotency_keys"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(100))
    scope: Mapped[str] = mapped_column(String(100))
    status_code: Mapped[int] = mapped_column(Integer)
    response: Mapped[dict[str, Any]] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("key", "scope"),)


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity_type: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
