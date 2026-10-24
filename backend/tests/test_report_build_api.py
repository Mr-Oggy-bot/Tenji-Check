API = "/api/v1"


def submit(client, data, h=None, **form):
    base = {"category": "blocked_tactile_path", "description": "Cart on strip", "lat": "30.3600", "lon": "76.3800",
            "location_confirmed": "true"}
    return client.post(f"{API}/issues", files={"file": ("p.jpg", data, "image/jpeg")}, data={**base, **form}, headers=h or {})


def test_public_report_and_tracking(client, scene):
    data, _ = scene()
    r = submit(client, data)
    assert r.status_code == 201, r.text
    ref = r.json()["reference"]
    t = client.get(f"{API}/issues/track/{ref.lower()}").json()
    assert t["status"] == "submitted"
    assert "lat" not in t and "media" not in t and "reporter" not in t
    assert client.get(f"{API}/issues/track/TC-NOPE").status_code == 404


def test_report_validation(client, scene):
    data, _ = scene()
    assert submit(client, data, category="nonsense").status_code == 422
    assert submit(client, data, location_confirmed="false").status_code == 422
    assert submit(client, data, lat="91").status_code == 422
    photo_only = client.post(f"{API}/issues", files={"file": ("p.jpg", data, "image/jpeg")},
                             data={"category": "damaged_tactile_tile"})
    assert photo_only.status_code == 201 and photo_only.json()["location_recorded"] is False
    assert client.post(f"{API}/issues", data={"category": "other"}).status_code == 422  # photo required


def test_rate_limit(client, scene, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "public_rate_limit_per_minute", 2)
    data, _ = scene()
    codes = [submit(client, data).status_code for _ in range(3)]
    assert codes == [201, 201, 429]


def test_duplicates_and_lifecycle(client, auth, scene):
    data, _ = scene()
    insp = auth("inspector")
    a = submit(client, data, lat="30.37000", lon="76.39000").json()
    b = submit(client, data, lat="30.37005", lon="76.39005").json()
    other_cat = submit(client, data, lat="30.37005", lon="76.39005", category="damaged_tactile_tile").json()
    issue_b = client.get(f"{API}/issues/{b['id']}", headers=insp).json()
    assert a["id"] in issue_b["possible_duplicates"]
    assert client.get(f"{API}/issues/{other_cat['id']}", headers=insp).json()["possible_duplicates"] == []
    assert issue_b["media"][0]["analysis"]["status"] == "done"

    assert client.get(f"{API}/issues", headers=auth("citizen")).status_code == 403
    listing = client.get(f"{API}/issues?status=submitted&sort=-created_at&page_size=5", headers=insp).json()
    assert listing["total"] >= 2 and len(listing["items"]) <= 5

    dup = client.post(f"{API}/issues/{b['id']}/mark-duplicate", json={"duplicate_of": a["id"]}, headers=insp).json()
    assert dup["status"] == "rejected" and dup["duplicate_of_id"] == a["id"]

    iid = a["id"]
    assert client.patch(f"{API}/issues/{iid}/status", json={"to_status": "resolved"}, headers=insp).status_code == 409
    rv = client.post(f"{API}/issues/{iid}/review", json={"decision": "confirm", "notes": "Visible"}, headers=insp).json()
    assert rv["status"] == "under_review" and rv["reviews"][0]["decision"] == "confirm"
    assert client.patch(f"{API}/issues/{iid}/status", json={"to_status": "assigned"}, headers=insp).status_code == 409
    contractor = client.get(f"{API}/users?role=contractor", headers=insp).json()[0]
    r = client.patch(f"{API}/issues/{iid}/status", json={"to_status": "assigned", "assigned_to": contractor["id"], "severity": "high"}, headers=insp)
    assert r.json()["status"] == "assigned"
    client.patch(f"{API}/issues/{iid}/status", json={"to_status": "in_progress"}, headers=insp)
    assert client.patch(f"{API}/issues/{iid}/status", json={"to_status": "resolved"}, headers=insp).status_code == 409
    ev = client.post(f"{API}/issues/{iid}/evidence", files={"file": ("e.jpg", data, "image/jpeg")}, headers=auth("contractor"))
    assert ev.status_code == 201
    done = client.patch(f"{API}/issues/{iid}/status", json={"to_status": "resolved", "note": "Cart removed, photo attached"}, headers=insp).json()
    assert done["status"] == "resolved" and [e["to"] for e in done["events"]] == ["submitted", "under_review", "assigned", "in_progress", "resolved"]
    assert all(e["actor"] for e in done["events"][1:])
    reopened = client.patch(f"{API}/issues/{iid}/status", json={"to_status": "under_review", "note": "Cart back"}, headers=insp).json()
    assert reopened["status"] == "under_review"
    assert client.patch(f"{API}/issues/{iid}/status", json={"to_status": "rejected"}, headers=insp).status_code == 409
    assert client.patch(f"{API}/issues/{iid}/status", json={"to_status": "rejected"}, headers=auth("engineer")).status_code == 403


def test_citizen_sees_only_own_reports(client, auth, scene):
    data, _ = scene()
    cit = auth("citizen")
    mine = submit(client, data, h=cit).json()
    anon = submit(client, data).json()
    assert client.get(f"{API}/issues/{mine['id']}", headers=cit).status_code == 200
    assert client.get(f"{API}/issues/{anon['id']}", headers=cit).status_code == 403
    assert any(i["id"] == mine["id"] for i in client.get(f"{API}/issues/mine", headers=cit).json())


def test_survey_routes_and_approval(client, auth, scene):
    con, eng = auth("contractor"), auth("engineer")
    s = client.post(f"{API}/surveys", json={"title": "Hostel walk"}, headers=con).json()
    pts = [{"lat": 30.35 + k * 0.0001, "lon": 76.37, "accuracy_m": 5} for k in range(10)]
    pts.insert(3, {"lat": 30.3503, "lon": 76.37, "accuracy_m": 200})  # poor fix dropped
    pts.insert(5, dict(pts[4]))  # duplicate fix dropped
    r = client.post(f"{API}/surveys/{s['id']}/track", json={"points": pts}, headers=con).json()
    assert r["kept"] == 10 and r["dropped"] == 2
    data, _ = scene()
    o = client.post(f"{API}/surveys/{s['id']}/observations", data={"lat": "30.3504", "lon": "76.37001", "observation_type": "obstacle",
                                                                 "note": "pole"}, files={"file": ("o.jpg", data, "image/jpeg")}, headers=con)
    assert o.status_code == 201
    moved = client.patch(f"{API}/surveys/{s['id']}/observations/{o.json()['id']}", json={"lat": 30.35041, "lon": 76.37002}, headers=con)
    assert moved.status_code == 200
    assert client.post(f"{API}/surveys/{s['id']}/submit", headers=con).status_code == 409
    client.post(f"{API}/surveys/{s['id']}/finish", headers=con)
    routes = client.post(f"{API}/routes/candidates", json={"survey_id": s["id"], "use_osm": False}, headers=con)
    assert routes.status_code == 201, routes.text
    rt = routes.json()[0]
    assert rt["distance_m"] > 90 and rt["score_breakdown"]["barrier_count"] == 1
    assert rt["materials"]["directional_tiles"] > 0
    assert client.post(f"{API}/surveys/{s['id']}/submit", headers=con).json()["status"] == "submitted"

    assert client.post(f"{API}/routes/{rt['id']}/decision", json={"decision": "approve"}, headers=con).status_code == 403
    assert client.post(f"{API}/routes/{rt['id']}/decision", json={"decision": "approve"}, headers=auth("citizen")).status_code == 403
    ok = client.post(f"{API}/routes/{rt['id']}/decision", json={"decision": "approve", "note": "Verified"}, headers=eng).json()
    assert ok["approval_status"] == "approved" and ok["approved_by"]
    assert client.post(f"{API}/surveys/{s['id']}/review", json={"decision": "reject"}, headers=eng).status_code == 422
    assert client.post(f"{API}/surveys/{s['id']}/review", json={"decision": "approve"}, headers=eng).json()["status"] == "approved"
    assert client.get(f"{API}/surveys/{s['id']}/export.pdf", headers=con).content.startswith(b"%PDF")
    assert "observation" in client.get(f"{API}/surveys/{s['id']}/export.csv", headers=con).text
    feats = client.get(f"{API}/map/features", headers=eng).json()
    assert any(sv["id"] == s["id"] and sv["approved_route"] for sv in feats["surveys"])


def test_no_path_is_explained(client, auth):
    con = auth("contractor")
    s = client.post(f"{API}/surveys", json={"title": "Empty"}, headers=con).json()
    r = client.post(f"{API}/routes/candidates", json={"survey_id": s["id"], "use_osm": True,
                                                    "start": [30.1, 76.1], "end": [30.2, 76.2]}, headers=con)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "no_path"


def test_admin_user_management(client, auth):
    adm = auth("admin")
    u = client.post(f"{API}/users", json={"email": "new@x.org", "display_name": "New Eng", "password": "longpassword", "role": "engineer"}, headers=adm)
    assert u.status_code == 201
    assert client.post(f"{API}/users", json={"email": "x@x.org", "display_name": "X", "password": "longpassword", "role": "god"}, headers=adm).status_code == 422
    assert client.post(f"{API}/users", json={"email": "y@x.org", "display_name": "Y", "password": "longpassword", "role": "admin"}, headers=auth("inspector")).status_code == 403
    reg = client.post(f"{API}/auth/register", json={"email": "pub@x.org", "display_name": "Pub", "password": "longpassword"})
    assert reg.status_code == 201 and reg.json()["user"]["role"] == "citizen"
    me = client.get(f"{API}/auth/me", headers=adm).json()
    assert client.patch(f"{API}/users/{me['id']}", json={"role": "citizen"}, headers=adm).status_code == 409


def test_persistence_across_restart(client, auth):
    from app.db import SessionLocal
    from app.main import create_app
    from app.models import Project
    from fastapi.testclient import TestClient

    with SessionLocal() as db:
        before = db.query(Project).count()
    with TestClient(create_app()) as c2:
        r = c2.post(f"{API}/auth/login", json={"email": "admin@tenjicheck.local", "password": "tenjicheck-demo"})
        projects = c2.get(f"{API}/projects", headers={"Authorization": "Bearer " + r.json()["access_token"]}).json()
    assert len(projects) == before
