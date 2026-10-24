import math

import numpy as np
import pytest
from sqlalchemy import inspect as sa_inspect

from app.db import engine
from app.planner import autoroute, geometry as g
from app.planner.document import to_scene
from app.planner.estimator import estimate
from app.planner.layouts import compare
from app.planner.validation import validate

from conftest import jpeg

API = "/api/v1/planning"


def doc(**kw):
    base = {"canvas": {"width": 2000, "height": 1500}, "scale": {"m_per_px": 0.01, "source": "manual"}}
    base.update(kw)
    return base


def route(points, rid="r1", w=1):
    return {"id": rid, "points": points, "width_tiles": w}


def area(points, wid="w1"):
    return {"id": wid, "points": points}


def feat(ftype, points, fid=None, **kw):
    return {"id": fid or ftype, "type": ftype, "points": points, **kw}


def codes(v):
    return {i["code"] for i in v["items"]}


# ---------- geometry ----------

def test_clip_square_against_triangle_and_concave_subject():
    sq = [(0, 0), (1, 0), (1, 1), (0, 1)]
    assert g.area(g.clip([(0, 0), (2, 0), (0, 2)], sq)) == pytest.approx(1.0)  # square fully inside triangle
    concave = [(0, 0), (3, 0), (3, 3), (2, 3), (2, 1), (1, 1), (1, 3), (0, 3)]  # U shape
    win = [(0, 0), (3, 0), (3, 2), (0, 2)]
    assert g.area(g.clip(concave, win)) == pytest.approx(3 + 2 * 1)  # bottom bar + two arms of height 1


def test_mitred_strip_preserves_area():
    segs = g.strip_segments([(0, 0), (3, 0), (3, 3)], 0.3)
    assert sum(g.area(s.quad) for s in segs) == pytest.approx(2 * 3 * 0.3)


# ---------- estimator ----------

def test_exact_strip_is_all_whole_tiles():
    e = estimate(to_scene(doc(routes=[route([[0, 0], [300, 0]])])))
    d = e["by_type"]["directional"]
    assert (d["whole_tiles"], d["cut_pieces"], d["tiles_required"], d["waste_area_m2"]) == (10, 0, 10, 0)


def test_cut_pieces_and_offcut_reuse_beat_naive_area_estimate():
    # 3.14 m x 2 tiles wide: each lane ends in a 140 mm piece; the first cut leaves a 157 mm offcut (after the
    # 3 mm kerf) that supplies the second. (At 3.15 m the 147 mm offcut would be too short for a 150 mm piece.)
    e = estimate(to_scene(doc(routes=[route([[0, 0], [314, 0]], w=2)])))
    d = e["by_type"]["directional"]
    assert d["whole_tiles"] == 20 and d["cut_pieces"] == 2
    assert d["new_tiles_for_cuts"] == 1 and d["pieces_from_offcuts"] == 1
    assert d["tiles_required"] == 21
    assert d["naive_area_estimate_tiles"] == 21
    # Without reuse each piece needs its own tile.
    e2 = estimate(to_scene(doc(routes=[route([[0, 0], [314, 0]], w=2)])), {"reuse_offcuts": False})
    assert e2["by_type"]["directional"]["tiles_required"] == 22


def test_offcut_below_minimum_is_waste():
    # 3.25 m: 250 mm pieces leave 47 mm offcuts, below the 60 mm minimum, so nothing is reused.
    e = estimate(to_scene(doc(routes=[route([[0, 0], [325, 0]], w=2)])))
    d = e["by_type"]["directional"]
    assert d["pieces_from_offcuts"] == 0 and d["tiles_required"] == 22
    assert d["waste_area_m2"] == pytest.approx(22 * 0.09 - 3.25 * 0.6, abs=1e-6)


def test_warning_overlap_replaces_directional_tiles():
    d = doc(routes=[route([[0, 0], [300, 0]])], warning_areas=[area([[240, -15], [300, -15], [300, 15], [240, 15]])])
    e = estimate(to_scene(d))
    assert e["by_type"]["directional"]["area_m2"] == pytest.approx(0.9 - 0.18)
    assert e["by_type"]["warning"]["area_m2"] == pytest.approx(0.18)


def test_spare_pack_rounding_and_cost():
    s = {"spare_pct": 10, "min_spare_tiles": 1,
         "prices": {"directional": {"pack_size": 4, "price_per_pack": 100.0}, "warning": {"pack_size": 10, "price_per_pack": 50.0}}}
    e = estimate(to_scene(doc(routes=[route([[0, 0], [300, 0]])])), s)
    d = e["by_type"]["directional"]
    assert d["spare_tiles"] == 1 and d["packs"] == 3 and d["purchase_tiles"] == 12 and d["pack_surplus_tiles"] == 1
    assert d["material_cost"] == 300.0 and e["totals"]["total_cost"] == 300.0
    assert e["by_type"]["warning"]["packs"] == 0


def test_estimate_is_reproducible_and_requires_scale():
    d = doc(routes=[route([[0, 0], [310, 0], [310, 410]])], warning_areas=[area([[280, 400], [360, 400], [360, 470], [280, 470]])])
    a, b = estimate(to_scene(d)), estimate(to_scene(d))
    assert a["by_type"] == b["by_type"]
    assert not estimate(to_scene({**d, "scale": {"m_per_px": None}}))["ok"]


def test_layout_options_keep_identical_coverage_and_pick_least_waste():
    rows = compare(to_scene(doc(warning_areas=[area([[0, 0], [100, 0], [100, 70], [0, 70]])])), None)
    assert {r["option"] for r in rows} == {"start", "centred", "offset"}
    assert all(r["valid"] for r in rows)
    assert len({round(r["area_m2"], 6) for r in rows}) == 1
    rec = [r for r in rows if r["recommended"]]
    assert len(rec) == 1 and rec[0]["option"] == "start"
    assert next(r for r in rows if r["option"] == "centred")["slivers"] > rec[0]["slivers"]


# ---------- validation ----------

def test_validation_flags_obstacle_missing_warning_and_dead_end():
    v = validate(to_scene(doc(routes=[route([[0, 100], [500, 100]])],
                              features=[feat("tree", [[250, 110]]), feat("kerb", [[550, 0], [550, 200]])])))
    assert {"route_hits_obstacle", "missing_warning", "dead_end"} <= codes(v)
    hit = next(i for i in v["items"] if i["code"] == "route_hits_obstacle")
    assert hit["severity"] == "error" and hit["at"] == [250.0, 110.0] and hit["reference"]
    assert "do not establish compliance" in v["statement"]


def test_good_design_has_no_errors_or_warnings():
    d = doc(features=[feat("entrance", [[0, 100]]), feat("kerb", [[560, 0], [560, 200]]),
                      feat("footpath", [[-50, 0], [600, 0], [600, 200], [-50, 200]])],
            routes=[route([[0, 100], [500, 100]])],
            warning_areas=[area([[500, 70], [560, 70], [560, 130], [500, 130]])])
    v = validate(to_scene(d))
    assert v["counts"]["error"] == 0 and v["counts"]["warning"] == 0, v["items"]


def test_disconnected_network_turns_and_outside_footpath():
    d = doc(features=[feat("footpath", [[0, 0], [400, 0], [400, 200], [0, 200]])],
            routes=[route([[20, 50], [200, 50], [200, 180]], "a"), route([[300, 50], [600, 50]], "b")])
    c = codes(validate(to_scene(d)))
    assert {"disconnected", "turn_point", "outside_footpath"} <= c


def test_low_clearance_is_review_not_error():
    v = validate(to_scene(doc(routes=[route([[0, 100], [500, 100]])], features=[feat("pillar", [[250, 160]])])))
    item = next(i for i in v["items"] if i["code"] == "low_clearance")
    assert item["severity"] == "review"


def test_warning_without_purpose_and_shallow_depth():
    v = validate(to_scene(doc(routes=[route([[0, 100], [500, 100]])],
                              warning_areas=[area([[1000, 1000], [1100, 1000], [1100, 1030], [1000, 1030]])])))
    assert {"warning_without_purpose", "warning_depth"} <= codes(v)


def test_missing_scale_is_an_error():
    v = validate(to_scene({"scale": {"m_per_px": None}, "routes": [route([[0, 0], [100, 0]])]}))
    assert codes(v) == {"scale_missing"}


# ---------- route suggestion ----------

def test_suggested_route_avoids_obstacle_and_stays_on_footpath():
    d = doc(canvas={"width": 1000, "height": 400},
            features=[feat("footpath", [[0, 0], [1000, 0], [1000, 400], [0, 400]]),
                      feat("obstacle_area", [[450, 0], [550, 0], [550, 300], [450, 300]])])
    r = autoroute.suggest(to_scene(d), (1000, 400), [50, 100], [950, 100], 1)
    assert r["min_clearance_m"] >= 0
    sc = to_scene(doc(routes=[route(r["points"])], features=d["features"]))
    assert "route_hits_obstacle" not in codes(validate(sc))
    assert max(p[1] for p in r["points"]) > 300  # went round the bottom of the obstacle
    with pytest.raises(autoroute.NoRoute):
        autoroute.suggest(to_scene(d), (1000, 400), [500, 100], [950, 100], 1)  # start inside the obstacle


# ---------- API ----------

@pytest.fixture
def plan_project(client, auth):
    h = auth("contractor")
    r = client.post(f"{API}/projects", json={"title": "Library approach", "site_name": "North gate"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json(), h


def good_doc():
    return doc(features=[feat("entrance", [[0, 100]]), feat("kerb", [[560, 0], [560, 200]])],
               routes=[route([[0, 100], [500, 100]])], warning_areas=[area([[500, 70], [560, 70], [560, 130], [500, 130]])])


def test_citizen_and_anonymous_cannot_use_planner(client, auth):
    assert client.get(f"{API}/projects").status_code == 401
    assert client.get(f"{API}/projects", headers=auth("citizen")).status_code == 403


def test_owner_isolation_until_submitted(client, auth, plan_project):
    p, h = plan_project
    assert client.get(f"{API}/projects/{p['id']}", headers=h).json()["access"] == "owner"
    for role in ("engineer", "inspector", "admin"):
        assert client.get(f"{API}/projects/{p['id']}", headers=auth(role)).status_code == 404
        assert all(x["id"] != p["id"] for x in client.get(f"{API}/projects", headers=auth(role)).json())


def test_save_analyse_version_submit_review_report(client, auth, plan_project):
    p, h = plan_project
    r = client.put(f"{API}/projects/{p['id']}/document", json={"document": good_doc(), "base_revision": p["revision"]}, headers=h)
    assert r.status_code == 200, r.text
    rev = r.json()["revision"]
    stale = client.put(f"{API}/projects/{p['id']}/document", json={"document": good_doc(), "base_revision": rev - 1}, headers=h)
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_revision"

    a = client.post(f"{API}/projects/{p['id']}/analyze", json={}, headers=h).json()
    assert a["estimate"]["ok"] and a["estimate"]["by_type"]["directional"]["tiles_required"] > 0
    assert a["validation"]["counts"]["error"] == 0
    assert len(a["comparison"]) == 3

    s = client.patch(f"{API}/projects/{p['id']}", json={"settings": {"prices": {"directional": {"pack_size": 5, "price_per_pack": 250}}}}, headers=h)
    assert s.status_code == 200 and s.json()["settings"]["prices"]["directional"]["pack_size"] == 5
    assert client.patch(f"{API}/projects/{p['id']}", json={"settings": {"tile_size_mm": 5}}, headers=h).status_code == 422

    v = client.post(f"{API}/projects/{p['id']}/versions", json={"label": "first issue"}, headers=h)
    assert v.status_code == 201, v.text
    v = v.json()
    assert v["number"] == 1 and v["status"] == "saved" and v["estimate"]["by_type"]["directional"]["pack_size"] == 5
    assert client.get(f"{API}/versions/{v['id']}", headers=auth("inspector")).status_code == 404  # not yet submitted

    assert client.post(f"{API}/versions/{v['id']}/submit", headers=h).json()["status"] == "submitted"
    insp = auth("inspector")
    assert client.get(f"{API}/projects/{p['id']}", headers=insp).json()["access"] == "reviewer"
    # A later unsubmitted version and the owner's draft stay invisible to the reviewer.
    client.put(f"{API}/projects/{p['id']}/document", json={"document": doc(), "base_revision": rev}, headers=h)
    hidden = client.post(f"{API}/projects/{p['id']}/versions", json={"label": "private"}, headers=h).json()
    seen = client.get(f"{API}/projects/{p['id']}", headers=insp).json()
    assert [x["id"] for x in seen["versions"]] == [v["id"]] and seen["document"]["routes"]
    assert client.get(f"{API}/versions/{hidden['id']}", headers=insp).status_code == 404
    ra = client.post(f"{API}/projects/{p['id']}/analyze", json={}, headers=insp).json()
    assert ra["estimate"]["by_type"]["directional"]["tiles_required"] > 0  # analysed the submitted version, not the empty draft
    rev += 1
    assert client.put(f"{API}/projects/{p['id']}/document", json={"document": good_doc(), "base_revision": rev}, headers=insp).status_code == 403
    assert client.post(f"{API}/versions/{v['id']}/review", json={"decision": "reject"}, headers=insp).status_code == 422
    ok = client.post(f"{API}/versions/{v['id']}/review", json={"decision": "approve", "note": "checked on drawing"}, headers=insp)
    assert ok.status_code == 200 and ok.json()["status"] == "approved"

    pdf = client.get(f"{API}/versions/{v['id']}/report.pdf", headers=h)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF" and len(pdf.content) > 3000
    csv_ = client.get(f"{API}/versions/{v['id']}/estimate.csv", headers=h)
    assert csv_.status_code == 200 and csv_.text.startswith("tile_type,area_m2")
    layouts = client.get(f"{API}/approved-layouts", headers=insp).json()
    assert any(x["version_id"] == v["id"] for x in layouts)
    assert client.get(f"{API}/approved-layouts", headers=h).status_code == 403  # contractor is not a reviewer role


def test_submit_blocked_by_errors_and_self_review_forbidden(client, auth):
    h = auth("engineer")
    p = client.post(f"{API}/projects", json={"title": "Own review"}, headers=h).json()
    bad = doc(routes=[route([[0, 100], [500, 100]])], features=[feat("tree", [[250, 100]])])
    client.put(f"{API}/projects/{p['id']}/document", json={"document": bad, "base_revision": p["revision"]}, headers=h)
    v = client.post(f"{API}/projects/{p['id']}/versions", json={}, headers=h).json()
    r = client.post(f"{API}/versions/{v['id']}/submit", headers=h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "has_errors"
    p2 = client.get(f"{API}/projects/{p['id']}", headers=h).json()
    client.put(f"{API}/projects/{p['id']}/document", json={"document": good_doc(), "base_revision": p2["revision"]}, headers=h)
    v2 = client.post(f"{API}/projects/{p['id']}/versions", json={}, headers=h).json()
    assert v2["number"] == 2
    assert client.post(f"{API}/versions/{v2['id']}/submit", headers=h).status_code == 200
    assert client.post(f"{API}/versions/{v2['id']}/review", json={"decision": "approve"}, headers=h).status_code == 403


def test_document_validation_and_site_image(client, plan_project):
    p, h = plan_project
    bad = client.put(f"{API}/projects/{p['id']}/document",
                     json={"document": {"features": [{"id": "x", "type": "spaceship", "points": [[0, 0]]}]},
                           "base_revision": p["revision"]}, headers=h)
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_document"
    img = np.full((600, 800, 3), 240, np.uint8)
    up = client.post(f"{API}/projects/{p['id']}/site-image", files={"file": ("plan.jpg", jpeg(img), "image/jpeg")}, headers=h)
    assert up.status_code == 201 and up.json()["width"] == 800
    f = client.get(f"{API}/site-images/{up.json()['id']}/file", headers=h)
    assert f.status_code == 200 and f.headers["content-type"] == "image/jpeg"
    garbage = client.post(f"{API}/projects/{p['id']}/site-image", files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")}, headers=h)
    assert garbage.status_code == 422


def test_other_owner_cannot_touch_project(client, auth, plan_project):
    p, _ = plan_project
    other = auth("engineer")
    assert client.put(f"{API}/projects/{p['id']}/document", json={"document": good_doc(), "base_revision": 1}, headers=other).status_code == 404
    assert client.post(f"{API}/projects/{p['id']}/analyze", json={}, headers=other).status_code == 404


def test_suggest_route_endpoint(client, plan_project):
    p, h = plan_project
    d = doc(features=[feat("footpath", [[0, 0], [1000, 0], [1000, 400], [0, 400]])])
    r = client.post(f"{API}/projects/{p['id']}/suggest-route", json={"start": [50, 200], "end": [950, 200], "document": d}, headers=h)
    assert r.status_code == 200 and math.isclose(r.json()["length_m"], 9.0, abs_tol=0.3)
    r = client.post(f"{API}/projects/{p['id']}/suggest-route", json={"start": [50, 200], "end": [1950, 200], "document": d}, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "no_route"


def test_new_tables_only_and_existing_tables_unchanged():
    insp = sa_inspect(engine)
    tables = set(insp.get_table_names())
    assert {"planning_projects", "planning_site_images", "planning_versions", "planning_estimates", "planning_reviews"} <= tables
    for t in ("users", "projects", "inspections", "findings", "issues", "surveys"):
        assert not any(c["name"].startswith("planning") for c in insp.get_columns(t))


def test_planner_leaves_existing_openapi_contract_untouched():
    """Adding the planner must not rename or change any existing operation or schema (e.g. through name clashes)."""
    import json

    from fastapi import FastAPI

    from app.api import auth, build, insights, inspect, issues, live, planner

    def spec(routers):
        a = FastAPI()
        for r in routers:
            a.include_router(r, prefix="/api/v1")
        return a.openapi()

    base = [auth.router, inspect.router, issues.router, build.router, insights.router, live.router]
    old, new = spec(base), spec(base + [planner.router])
    assert {k: new["paths"][k] for k in old["paths"]} == old["paths"]
    for name, schema in old["components"]["schemas"].items():
        assert json.dumps(new["components"]["schemas"].get(name), sort_keys=True) == json.dumps(schema, sort_keys=True), name
