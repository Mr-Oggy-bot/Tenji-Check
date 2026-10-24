"""Demo accounts and clearly flagged demo records (is_demo=True). Runs only on an empty database."""
from datetime import timedelta

from sqlalchemy import func, select

from .db import SessionLocal
from .models import Inspection, Issue, IssueEvent, Project, Survey, SurveyObservation, TrackPoint, User, utcnow
from .security import hash_password

DEMO_PASSWORD = "tenjicheck-demo"
DEMO_USERS = [
    ("admin@tenjicheck.local", "Asha Admin", "admin"),
    ("inspector@tenjicheck.local", "Imran Inspector", "inspector"),
    ("engineer@tenjicheck.local", "Esha Site Engineer", "engineer"),
    ("contractor@tenjicheck.local", "Kiran Contractor", "contractor"),
    ("citizen@tenjicheck.local", "Chetan Citizen", "citizen"),
]
CAMPUS = (30.35640, 76.37210)  # approximate campus location, illustrative only


def seed() -> None:
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(User)):
            return
        users = {}
        for email, name, role in DEMO_USERS:
            u = User(email=email, display_name=name, role=role, password_hash=hash_password(DEMO_PASSWORD))
            db.add(u)
            users[role] = u
        db.flush()

        p = Project(name="Campus tactile path upgrade (demo)", location_name="University campus, Patiala",
                    lat=CAMPUS[0], lon=CAMPUS[1], created_by=users["engineer"].id, is_demo=True)
        db.add(p)
        db.flush()
        db.add(Inspection(project_id=p.id, title="Main gate to library walkway", site_name="Segment A (demo)",
                          contractor_id=users["contractor"].id, created_by=users["engineer"].id, is_demo=True))

        now = utcnow()
        demo_issues = [
            ("blocked_tactile_path", "Vendor cart parked on the yellow strip near the gate", 0.00030, 0.00010, "under_review", 12),
            ("blocked_tactile_path", "Cart blocking tactile path at gate", 0.00032, 0.00012, "submitted", 2),
            ("damaged_tactile_tile", "Two cracked dot tiles before the crossing", -0.00055, 0.00042, "assigned", 25),
            ("missing_warning_tiles", "No warning tiles where the path meets the road", 0.00110, -0.00065, "resolved", 60),
        ]
        for n, (cat, desc, dlat, dlon, status, age) in enumerate(demo_issues, 1):
            created = now - timedelta(days=age)
            i = Issue(reference=f"TC-DEMO-{n:04d}", category=cat, description=desc, lat=CAMPUS[0] + dlat, lon=CAMPUS[1] + dlon,
                      location_confirmed=True, status=status, is_demo=True, created_at=created, updated_at=created,
                      severity="high" if cat == "blocked_tactile_path" else "medium",
                      assigned_to=users["contractor"].id if status in ("assigned", "resolved") else None,
                      resolved_at=created + timedelta(days=9) if status == "resolved" else None)
            db.add(i)
            db.flush()
            db.add(IssueEvent(issue_id=i.id, to_status="submitted", note="Demo record", created_at=created))
            if status != "submitted":
                db.add(IssueEvent(issue_id=i.id, from_status="submitted", to_status=status, actor_id=users["inspector"].id,
                                  note="Demo transition", created_at=created + timedelta(days=1)))
        first = db.scalars(select(Issue).where(Issue.reference == "TC-DEMO-0001")).first()
        second = db.scalars(select(Issue).where(Issue.reference == "TC-DEMO-0002")).first()
        second.possible_duplicates = [first.id]

        s = Survey(title="Proposed corridor: hostel to academic block (demo)", created_by=users["contractor"].id,
                   project_id=p.id, status="draft", is_demo=True, started_at=now - timedelta(hours=3),
                   ended_at=now - timedelta(hours=2, minutes=40))
        db.add(s)
        db.flush()
        track = [(CAMPUS[0] - 0.0009 + k * 0.00012, CAMPUS[1] - 0.0006 + (k * 0.00002 if k < 8 else 0.00016 + (k - 8) * 0.00011))
                 for k in range(14)]
        for k, (la, lo) in enumerate(track):
            db.add(TrackPoint(survey_id=s.id, seq=k, lat=la, lon=lo, accuracy_m=6.0, recorded_at=s.started_at + timedelta(seconds=20 * k)))
        db.add(SurveyObservation(survey_id=s.id, lat=track[5][0], lon=track[5][1] + 0.00001, observation_type="obstacle",
                                 note="Lamp post on the walking line (demo)", accuracy_m=6.0))
        db.add(SurveyObservation(survey_id=s.id, lat=track[9][0], lon=track[9][1], observation_type="crossing",
                                 note="Internal road crossing (demo)", accuracy_m=6.0))
        db.commit()
