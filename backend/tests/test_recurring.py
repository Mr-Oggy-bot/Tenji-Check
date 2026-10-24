from datetime import date, datetime, timedelta, timezone

from sqlalchemy import inspect as sa_inspect

from app import db as dbmod
from app.models import Finding
from app.recurring.compare import compare, match


def F(id, cls, lat=None, lon=None, status="confirmed", tag=None):
    return Finding(id=id, inspection_id=0, source="manual", defect_class=cls, status=status, severity="high",
                   lat=lat, lon=lon, context_tag=tag, measurement={}, ai_output={})


# --- matching -----------------------------------------------------------------------------------

def test_match_by_class_and_distance_closest_first():
    before = [F(1, "obstacle_on_path", 30.0, 76.0), F(2, "obstacle_on_path", 30.0, 76.0001)]
    after = [F(11, "obstacle_on_path", 30.0, 76.00011), F(12, "interrupted_path", 30.0, 76.0)]
    pairs = match(before, after, 15)
    assert [(a.id, b.id) for a, b, _ in pairs] == [(2, 11)]  # closest pair wins; other class never matches


def test_far_findings_do_not_match_and_rejected_are_excluded():
    before = [F(1, "obstacle_on_path", 30.0, 76.0), F(2, "interrupted_path", 30.0, 76.0, status="rejected")]
    after = [F(11, "obstacle_on_path", 30.001, 76.0)]  # ~111 m away
    r = compare(before, after, 15)
    assert r["totals"] == {"before": 1, "after": 1, "recurring": 0, "new": 1, "not_seen_again": 1}


def test_no_gps_falls_back_to_class_and_context_tag():
    r = compare([F(1, "missing_warning_tiles", tag="crossing")], [F(11, "missing_warning_tiles", tag="crossing"),
                                                                 F(12, "missing_warning_tiles", tag="stairs")])
    assert r["totals"]["recurring"] == 1 and r["recurring"][0]["matched_by"] == "type_and_context"
    assert r["totals"]["new"] == 1
    assert "not evidence of a repair" in r["caveat"]


# --- API ----------------------------------------------------------------------------------------

def _site(client, h, name="Recurring site"):
    r = client.post("/api/v1/projects", json={"name": name, "location_name": "Block A"}, headers=h)
    assert r.status_code == 201
    return r.json()["id"]


def test_schedule_lifecycle(client, auth):
    h = auth("engineer")
    pid = _site(client, h)
    today = datetime.now(timezone.utc).date()  # the server works in UTC dates
    r = client.post(f"/api/v1/projects/{pid}/schedules", headers=h,
                    json={"title": "Quarterly check", "interval_days": 90, "next_due": (today - timedelta(days=200)).isoformat()})
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["state"] == "overdue" and s["days_until_due"] == -200

    lst = client.get("/api/v1/schedules", headers=h).json()
    assert lst["counts"]["overdue"] >= 1 and any(i["id"] == s["id"] for i in lst["items"])

    r = client.post(f"/api/v1/schedules/{s['id']}/start", headers=h)
    assert r.status_code == 201, r.text
    started = r.json()
    nd = date.fromisoformat(started["next_due"])
    assert nd > today and (nd - (today - timedelta(days=200))).days % 90 == 0  # advanced on the original cadence

    # The new inspection is an ordinary inspection in the existing workflow.
    insp = client.get(f"/api/v1/inspections/{started['inspection_id']}", headers=h)
    assert insp.status_code == 200 and insp.json()["project_id"] == pid and insp.json()["status"] == "open"

    s2 = client.get(f"/api/v1/schedules/{s['id']}", headers=h).json()
    assert s2["runs"][0]["inspection_id"] == started["inspection_id"] and s2["runs"][0]["on_time"] is False
    assert s2["state"] in ("scheduled", "due_soon")

    r = client.patch(f"/api/v1/schedules/{s['id']}", headers=h, json={"active": False})
    assert r.json()["state"] == "paused"
    r = client.post(f"/api/v1/schedules/{s['id']}/start", headers=h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "schedule_paused"


def test_schedule_permissions_and_validation(client, auth):
    h = auth("engineer")
    pid = _site(client, h, "Perm site")
    body = {"title": "Monthly", "interval_days": 30, "next_due": date.today().isoformat()}
    assert client.post(f"/api/v1/projects/{pid}/schedules", headers=auth("contractor"), json=body).status_code == 403
    assert client.get("/api/v1/schedules", headers=auth("contractor")).status_code == 403
    assert client.get("/api/v1/schedules", headers=auth("citizen")).status_code == 403
    assert client.post(f"/api/v1/projects/{pid}/schedules", headers=h, json={**body, "interval_days": 0}).status_code == 422
    assert client.post(f"/api/v1/projects/{pid}/schedules", headers=h, json={**body, "contractor_id": 1}).status_code == 422
    assert client.post("/api/v1/projects/999999/schedules", headers=h, json=body).status_code == 404


def test_history_and_compare(client, auth):
    h = auth("engineer")
    pid = _site(client, h, "History site")
    a = client.post(f"/api/v1/projects/{pid}/inspections", headers=h, json={"title": "Round 1"}).json()["id"]
    b = client.post(f"/api/v1/projects/{pid}/inspections", headers=h, json={"title": "Round 2"}).json()["id"]
    with dbmod.SessionLocal() as s:
        for iid, cls, lat, st in [(a, "obstacle_on_path", 12.97, "closed"), (a, "interrupted_path", 12.98, "confirmed"),
                                  (b, "obstacle_on_path", 12.97003, "confirmed"), (b, "missing_warning_tiles", 12.99, "ai_proposed"),
                                  (b, "damaged_tactile_tile", 13.0, "rejected")]:  # far from other tests' routes
            s.add(Finding(inspection_id=iid, source="manual", defect_class=cls, status=st, severity="high",
                          lat=lat, lon=77.59, measurement={}, ai_output={}))
        s.commit()

    hist = client.get(f"/api/v1/projects/{pid}/history", headers=h).json()
    rows = hist["inspections"]
    assert [r["id"] for r in rows] == [a, b]
    assert rows[0]["recurring_from_previous"] is None and rows[1]["recurring_from_previous"] == 1
    assert rows[1]["findings"] == 2 and rows[1]["rejected"] == 1 and rows[0]["resolved"] == 1

    c = client.get(f"/api/v1/inspections/{a}/compare/{b}", headers=h).json()
    assert c["totals"] == {"before": 2, "after": 2, "recurring": 1, "new": 1, "not_seen_again": 1}
    assert c["recurring"][0]["distance_m"] < 15
    assert c["new"][0]["defect_class"] == "missing_warning_tiles"
    assert c["not_seen_again"][0]["defect_class"] == "interrupted_path"

    other = _site(client, h, "Other site")
    x = client.post(f"/api/v1/projects/{other}/inspections", headers=h, json={"title": "Elsewhere"}).json()["id"]
    r = client.get(f"/api/v1/inspections/{a}/compare/{x}", headers=h)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "different_sites"
    # Contractors only see inspections assigned to them.
    assert client.get(f"/api/v1/inspections/{a}/compare/{b}", headers=auth("contractor")).status_code == 403
    assert client.get(f"/api/v1/projects/{pid}/history", headers=auth("contractor")).status_code == 403
    assert client.get(f"/api/v1/projects/{pid}/history", headers=auth("citizen")).status_code == 403


def test_recurring_adds_tables_only_and_keeps_openapi_contract():
    import json

    from fastapi import FastAPI

    from app.api import auth, build, insights, inspect, issues, live, planner, recurring

    tables = set(sa_inspect(dbmod.engine).get_table_names())
    assert {"inspection_schedules", "inspection_schedule_runs"} <= tables
    for t in ("projects", "inspections", "findings"):
        assert not any("schedule" in c["name"] for c in sa_inspect(dbmod.engine).get_columns(t))

    def spec(routers):
        a = FastAPI()
        for r in routers:
            a.include_router(r, prefix="/api/v1")
        return a.openapi()

    base = [auth.router, inspect.router, issues.router, build.router, insights.router, live.router, planner.router]
    old, new = spec(base), spec(base + [recurring.router])
    assert {k: new["paths"][k] for k in old["paths"]} == old["paths"]
    for name, schema in old["components"]["schemas"].items():
        assert json.dumps(new["components"]["schemas"].get(name), sort_keys=True) == json.dumps(schema, sort_keys=True), name
