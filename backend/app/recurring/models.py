"""Schedule tables. New tables only; projects, inspections and users are referenced by foreign key and never altered."""
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base
from ..models import UTCDateTime, utcnow


class InspectionSchedule(Base):
    """A recurring inspection of one site: every `interval_days`, starting from `next_due`."""
    __tablename__ = "inspection_schedules"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    site_name: Mapped[str] = mapped_column(String(200), default="")
    interval_days: Mapped[int] = mapped_column(Integer)
    next_due: Mapped[datetime] = mapped_column(UTCDateTime)
    remind_days: Mapped[int] = mapped_column(Integer, default=7)
    contractor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    notes: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    runs: Mapped[list["InspectionScheduleRun"]] = relationship(order_by="InspectionScheduleRun.id")


class InspectionScheduleRun(Base):
    """One inspection started from a schedule, with the due date it satisfied."""
    __tablename__ = "inspection_schedule_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("inspection_schedules.id"), index=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id"), unique=True)
    due_at: Mapped[datetime] = mapped_column(UTCDateTime)
    started_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
