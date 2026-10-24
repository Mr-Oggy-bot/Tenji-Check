"""Planner tables. New tables only; existing tables are referenced by foreign key and never altered."""
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base
from ..models import UTCDateTime, utcnow

VERSION_STATUSES = ("saved", "submitted", "approved", "rejected")


class PlanningProject(Base):
    """A planning site and its working (editable) design document."""
    __tablename__ = "planning_projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    site_name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    # Optional link to an existing inspection project ("select an existing site"); read-only reference.
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    document: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # tile spec, prices, allowances
    revision: Mapped[int] = mapped_column(Integer, default=1)  # optimistic concurrency for draft saves
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    versions: Mapped[list["PlanningVersion"]] = relationship(back_populates="planning_project",
                                                             order_by="PlanningVersion.number")


class PlanningSiteImage(Base):
    """Uploaded site plan or drawing (re-encoded, metadata stripped), stored in private media storage."""
    __tablename__ = "planning_site_images"
    id: Mapped[int] = mapped_column(primary_key=True)
    planning_project_id: Mapped[int] = mapped_column(ForeignKey("planning_projects.id"), index=True)
    storage_key: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(50), default="image/jpeg")
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    original_name: Mapped[str] = mapped_column(String(200), default="")
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class PlanningVersion(Base):
    """Immutable snapshot of a design with the validation and estimate computed when it was saved."""
    __tablename__ = "planning_versions"
    __table_args__ = (UniqueConstraint("planning_project_id", "number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    planning_project_id: Mapped[int] = mapped_column(ForeignKey("planning_projects.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(200), default="")
    document: Mapped[dict[str, Any]] = mapped_column(JSON)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON)
    validation: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="saved")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    planning_project: Mapped[PlanningProject] = relationship(back_populates="versions")
    estimate: Mapped["PlanningEstimate | None"] = relationship(back_populates="version", uselist=False)
    reviews: Mapped[list["PlanningReview"]] = relationship(back_populates="version", order_by="PlanningReview.id")


class PlanningEstimate(Base):
    """Material estimate and layout comparison for one version (reproducible from the stored inputs)."""
    __tablename__ = "planning_estimates"
    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("planning_versions.id"), unique=True)
    engine_version: Mapped[str] = mapped_column(String(40))
    result: Mapped[dict[str, Any]] = mapped_column(JSON)
    comparison: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    version: Mapped[PlanningVersion] = relationship(back_populates="estimate")


class PlanningReview(Base):
    __tablename__ = "planning_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("planning_versions.id"), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(20))  # approved | rejected
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    version: Mapped[PlanningVersion] = relationship(back_populates="reviews")
