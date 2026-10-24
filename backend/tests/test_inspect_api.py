"""End-to-end Inspect loop: photo -> AI candidates -> review gate -> punch list -> repair -> reinspect -> close -> handover."""
import cv2
import numpy as np

API = "/api/v1"


def make_inspection(client, h):
    p = client.post(f"{API}/projects", json={"name": "Test project", "lat": 30.35, "lon": 76.37}, headers=h).json()
    users = client.get(f"{API}/users?role=contractor", headers=h).json()
    i = client.post(f"{API}/projects/{p['id']}/inspections",
                    json={"title": "Walkway", "site_name": "A", "contractor_id": users[0]["id"]}, headers=h)
    assert i.status_code == 201, i.text
    return i.json()["id"]


def upload(client, h, insp, data, **form):
    files = {"file": ("photo.jpg", data, "image/jpeg")}
    return client.post(f"{API}/inspections/{insp}/photos", files=files,
                       data={"context_tag": "segment", "lat": "30.3561", "lon": "76.3702", **form}, headers=h)


def test_role_checks(client, auth):
    assert client.get(f"{API}/projects").status_code == 401
    assert client.post(f"{API}/projects", json={"name": "x"}, headers=auth("citizen")).status_code in (403, 422)
    assert client.post(f"{API}/projects", json={"name": "Nope"}, headers=auth("contractor")).status_code == 403
    assert client.get(f"{API}/review/queue", headers=auth("engineer")).status_code == 403
    bad = {"Authorization": "Bearer not-a-token"}
    assert client.get(f"{API}/auth/me", headers=bad).status_code == 401


def test_full_verification_loop(client, auth, scene):
    eng, insp_h, con = auth("engineer"), auth("inspector"), auth("contractor")
    insp = make_inspection(client, eng)
    data, _ = scene(gap=(6, 2), warning_at=("start", "end"))
    r = upload(client, eng, insp, data, segment_label="near gate")
    assert r.status_code == 201, r.text
    media_id = r.json()["media"]["id"]

    a = client.get(f"{API}/media/{media_id}/analysis", headers=eng).json()["analysis"]
    assert a["status"] == "done", a
    assert a["result"]["geometry"]["gaps"][0]["length_tiles"] > 1.0
    assert a["result"]["obstacles"]["available"] is False  # disabled in tests; must be reported

    detail = client.get(f"{API}/inspections/{insp}", headers=eng).json()
    ai = [f for f in detail["findings"] if f["source"] == "ai"]
    assert [f["defect_class"] for f in ai] == ["interrupted_path"]
    assert ai[0]["status"] == "ai_proposed" and ai[0]["media"]["annotated_url"]

    # Manual tap-to-mark finding (e.g. obstacle the model could not see).
    m = client.post(f"{API}/inspections/{insp}/findings",
                    json={"media_id": media_id, "defect_class": "obstacle_on_path", "bbox": [400, 600, 500, 800],
                          "description": "Bollard"}, headers=eng)
    assert m.status_code == 201 and m.json()["status"] == "under_review"
    manual_id = m.json()["id"]

    # Review gate: no PDF while findings are unreviewed; non-reviewers cannot decide.
    blocked = client.post(f"{API}/inspections/{insp}/punch-list", headers=insp_h)
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "review_required"
    assert client.post(f"{API}/findings/{ai[0]['id']}/review", json={"decision": "confirm"}, headers=con).status_code == 403
    assert client.post(f"{API}/findings/{manual_id}/review", json={"decision": "reject"}, headers=insp_h).status_code == 422

    ok = client.post(f"{API}/findings/{ai[0]['id']}/review", json={"decision": "confirm", "notes": "Gap visible"}, headers=insp_h)
    assert ok.status_code == 200 and ok.json()["status"] == "confirmed" and ok.json()["reviewer"]
    rej = client.post(f"{API}/findings/{manual_id}/review", json={"decision": "reject", "notes": "Shadow, not a bollard"}, headers=insp_h)
    assert rej.json()["status"] == "rejected"
    assert ok.json()["ai_output"]["defect_class"] == "interrupted_path"  # model output kept separate

    pl = client.post(f"{API}/inspections/{insp}/punch-list", headers=insp_h)
    assert pl.status_code == 201, pl.text
    assert pl.json()["item_count"] == 1
    pdf = client.get(pl.json()["pdf_url"], headers=con)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    f = client.get(f"{API}/findings/{ai[0]['id']}", headers=con).json()
    assert f["status"] == "fix_required" and f["punch_item_no"] == 1

    # Closure enforcement.
    assert client.post(f"{API}/findings/{f['id']}/close", json={}, headers=insp_h).status_code == 409
    assert client.post(f"{API}/inspections/{insp}/handover", json={}, headers=insp_h).status_code == 409

    fixed, _ = scene(warning_at=("start", "end"))
    rep = client.post(f"{API}/findings/{f['id']}/repair", files={"file": ("fix.jpg", fixed, "image/jpeg")},
                      data={"notes": "Tiles installed"}, headers=con)
    assert rep.status_code == 200 and rep.json()["status"] == "awaiting_reinspection"
    check = client.get(f"{API}/findings/{f['id']}", headers=insp_h).json()["repair_ai_check"]
    assert check["status"] == "done" and check["candidates"] == []
    fail = client.post(f"{API}/findings/{f['id']}/reinspect", json={"result": "fail", "notes": "Tiles loose"}, headers=insp_h)
    assert fail.json()["status"] == "fix_required" and fail.json()["repair_media"] is None

    client.post(f"{API}/findings/{f['id']}/repair", files={"file": ("fix2.jpg", fixed, "image/jpeg")}, headers=con)
    passed = client.post(f"{API}/findings/{f['id']}/reinspect", json={"result": "pass"}, headers=insp_h)
    assert passed.json()["status"] == "verified"
    closed = client.post(f"{API}/findings/{f['id']}/close", json={"notes": "OK"}, headers=insp_h)
    assert closed.json()["status"] == "closed"
    assert [e["to"] for e in closed.json()["events"]] == [
        "ai_proposed", "confirmed", "fix_required", "awaiting_reinspection", "fix_required",
        "awaiting_reinspection", "verified", "closed"]

    hv = client.post(f"{API}/inspections/{insp}/handover", json={"notes": "Engineer accepts"}, headers=insp_h)
    assert hv.status_code == 200 and "never certifies" in hv.json()["statement"]
    csv = client.get(f"{API}/inspections/{insp}/export.csv", headers=eng)
    assert csv.status_code == 200 and "interrupted_path" in csv.text and "Not a compliance certificate" in csv.text

    dash = client.get(f"{API}/dashboard/summary", headers=insp_h).json()
    assert dash["workflow"]["human_review_enforcement"] == 100.0
    assert dash["workflow"]["report_completeness"] == 100.0


def test_quality_gate_and_overrides(client, auth, scene):
    eng = auth("engineer")
    insp = make_inspection(client, eng)
    data, _ = scene()
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    blurry = cv2.imencode(".jpg", cv2.GaussianBlur(img, (41, 41), 15))[1].tobytes()
    r = upload(client, eng, insp, blurry)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "quality_rejected"
    r = upload(client, eng, insp, blurry, allow_low_quality="true")
    assert r.status_code == 201 and r.json()["analysis"]["status"] == "skipped"
    assert upload(client, eng, insp, b"not an image").status_code == 422
    assert upload(client, eng, insp, data, context_tag="bogus").status_code == 422
    assert upload(client, eng, insp, data, lat="95").status_code == 422


def test_idempotent_upload(client, auth, scene):
    eng = auth("engineer")
    insp = make_inspection(client, eng)
    data, _ = scene()
    h = {**eng, "Idempotency-Key": "abc-123"}
    a = upload(client, h, insp, data).json()
    b = upload(client, h, insp, data).json()
    assert a["media"]["id"] == b["media"]["id"]
    photos = client.get(f"{API}/inspections/{insp}", headers=eng).json()["photos"]
    assert len(photos) == 1


def test_contractor_cannot_see_unassigned_inspection(client, auth):
    adm = auth("admin")
    p = client.post(f"{API}/projects", json={"name": "Other"}, headers=adm).json()
    i = client.post(f"{API}/projects/{p['id']}/inspections", json={"title": "No contractor"}, headers=adm).json()
    assert client.get(f"{API}/inspections/{i['id']}", headers=auth("contractor")).status_code == 403


def test_signed_media_urls(client, auth, scene):
    eng = auth("engineer")
    insp = make_inspection(client, eng)
    data, _ = scene()
    media = upload(client, eng, insp, data).json()["media"]
    assert client.get(media["url"]).status_code == 200
    tampered = media["url"].replace("variant=display", "variant=original")
    assert client.get(tampered).status_code == 403
    assert "original_url" not in media
