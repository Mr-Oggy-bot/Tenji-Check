"""State machines. These are the only code paths allowed to change Finding.status or Issue.status.

Inspection findings (pre-handover loop):
    ai_proposed -> under_review -> confirmed | rejected
    confirmed -> fix_required -> awaiting_reinspection -> verified -> closed
    awaiting_reinspection -> fix_required   (failed reinspection)

Citizen issues (report mode):
    submitted -> under_review -> assigned -> in_progress -> resolved
    any open state -> rejected (reason required); resolved -> under_review (reopen)
"""
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import AuditLog, Finding, FindingEvent, Issue, IssueEvent, utcnow


class TransitionError(HTTPException):
    def __init__(self, detail: str):
        super().__init__(status_code=409, detail=detail)


@dataclass(frozen=True)
class Transition:
    to: str
    roles: tuple[str, ...]


FINDING_STATES = (
    "ai_proposed", "under_review", "confirmed", "rejected",
    "fix_required", "awaiting_reinspection", "verified", "closed",
)
UNREVIEWED_FINDING_STATES = ("ai_proposed", "under_review")
FINDING_TRANSITIONS: dict[str, dict[str, Transition]] = {
    "ai_proposed": {
        "start_review": Transition("under_review", ("inspector", "admin")),
        "confirm": Transition("confirmed", ("inspector", "admin")),
        "reject": Transition("rejected", ("inspector", "admin")),
    },
    "under_review": {
        "confirm": Transition("confirmed", ("inspector", "admin")),
        "reject": Transition("rejected", ("inspector", "admin")),
    },
    "confirmed": {
        "issue_punch_list": Transition("fix_required", ("inspector", "admin")),
        "reopen_review": Transition("under_review", ("inspector", "admin")),
    },
    "rejected": {"reopen_review": Transition("under_review", ("inspector", "admin"))},
    "fix_required": {"submit_repair": Transition("awaiting_reinspection", ("contractor", "admin"))},
    "awaiting_reinspection": {
        "pass_reinspection": Transition("verified", ("inspector", "admin")),
        "fail_reinspection": Transition("fix_required", ("inspector", "admin")),
    },
    "verified": {"close": Transition("closed", ("inspector", "admin"))},
    "closed": {},
}

ISSUE_STATES = ("submitted", "under_review", "assigned", "in_progress", "resolved", "rejected")
ISSUE_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "submitted": ("under_review", "rejected"),
    "under_review": ("assigned", "rejected"),
    "assigned": ("in_progress", "under_review", "rejected"),
    "in_progress": ("resolved", "assigned", "rejected"),
    "resolved": ("under_review",),
    "rejected": ("under_review",),
}
ISSUE_STAFF_ROLES = ("inspector", "admin")


def finding_actions(finding: Finding, role: str) -> list[str]:
    return [a for a, t in FINDING_TRANSITIONS.get(finding.status, {}).items() if role in t.roles]


def apply_finding_action(db: Session, finding: Finding, action: str, actor, note: str = "", data: dict | None = None) -> Finding:
    transitions = FINDING_TRANSITIONS.get(finding.status, {})
    if action not in transitions:
        raise TransitionError(f"Action '{action}' is not allowed while the finding is '{finding.status}'")
    t = transitions[action]
    if actor.role not in t.roles:
        raise HTTPException(403, f"Role '{actor.role}' cannot perform '{action}'")
    _check_finding_guards(finding, action)
    now = utcnow()
    if action in ("confirm", "reject"):
        finding.reviewer_id, finding.reviewed_at, finding.review_decision = actor.id, now, action
        finding.review_notes = note
    elif action in ("pass_reinspection", "fail_reinspection"):
        finding.reinspected_by, finding.reinspected_at = actor.id, now
    elif action == "close":
        finding.closed_by, finding.closed_at = actor.id, now
    db.add(FindingEvent(finding_id=finding.id, from_status=finding.status, to_status=t.to,
                        actor_id=actor.id, note=note, data=data or {}))
    finding.status = t.to
    return finding


def _check_finding_guards(finding: Finding, action: str) -> None:
    if action == "submit_repair" and finding.repair_media_id is None:
        raise TransitionError("A repair evidence photo is required before requesting reinspection")
    if action in ("pass_reinspection", "close") and finding.repair_media_id is None:
        raise TransitionError("A finding cannot be verified or closed without a reinspection photo on file")
    if action == "close" and finding.reinspected_by is None:
        raise TransitionError("A finding can only be closed after an authorised reinspection")
    if action == "issue_punch_list" and finding.reviewer_id is None:
        raise TransitionError("Only reviewer-confirmed findings can enter the punch list")


def record_initial_finding_event(db: Session, finding: Finding, actor_id: int | None, note: str) -> None:
    db.add(FindingEvent(finding_id=finding.id, from_status=None, to_status=finding.status, actor_id=actor_id, note=note))


def apply_issue_transition(db: Session, issue: Issue, to_status: str, actor, note: str = "") -> Issue:
    if to_status not in ISSUE_STATES:
        raise HTTPException(422, f"Unknown status '{to_status}'")
    if actor.role not in ISSUE_STAFF_ROLES:
        raise HTTPException(403, "Only inspectors or administrators can change report status")
    allowed = ISSUE_TRANSITIONS.get(issue.status, ())
    if to_status not in allowed:
        raise TransitionError(f"Cannot move a report from '{issue.status}' to '{to_status}'")
    if to_status == "rejected" and not note.strip():
        raise TransitionError("A reason is required to reject a report")
    if to_status == "assigned" and issue.assigned_to is None:
        raise TransitionError("Assign the report to a team member before moving it to 'assigned'")
    if to_status == "resolved" and not note.strip():
        raise TransitionError("Describe the closure evidence when resolving a report")
    db.add(IssueEvent(issue_id=issue.id, from_status=issue.status, to_status=to_status, actor_id=actor.id, note=note))
    if to_status == "rejected":
        issue.rejection_reason = note
    issue.resolved_at = utcnow() if to_status == "resolved" else None
    issue.status = to_status
    return issue


def audit(db: Session, actor_id: int | None, action: str, entity_type: str, entity_id: int | None, **data) -> None:
    db.add(AuditLog(actor_id=actor_id, action=action, entity_type=entity_type, entity_id=entity_id, data=data))
