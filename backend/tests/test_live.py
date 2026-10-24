import json

import cv2
import numpy as np
import pytest

from app.config import get_settings
from app.services import github_models
from app.services.live import absorb_enclosed_blobs, estimate_pitch
from app.vision.groundplane import Camera, Grid, to_birds_eye
from app.vision.layplan import PlanParams, plan_strip
from app.vision.surface import BLOCKED, CARRIAGEWAY, LAYABLE, UNKNOWN, VARIANTS, _hysteresis

from conftest import jpeg

GRID = Grid()


def walkway(width_m=3.0, sides=BLOCKED) -> np.ndarray:
    """Bird's-eye grid: a straight paved walkway centred on the camera between walls (or `sides`)."""
    g = np.full((GRID.ny, GRID.nx), sides, np.uint8)
    xs = GRID.col_x(np.arange(GRID.nx))
    g[:, np.abs(xs) <= width_m / 2] = LAYABLE
    return g


def cells(x0, x1, y0, y1):
    xs, ys = GRID.col_x(np.arange(GRID.nx)), GRID.row_y(np.arange(GRID.ny))
    return np.ix_((ys >= y0) & (ys < y1), (xs >= x0) & (xs < x1))


def test_ground_projection_round_trip():
    cam = Camera(640, 480, hfov_deg=63, pitch_deg=35, height_m=1.4)
    x, y = np.array([-1.0, 0.0, 0.8]), np.array([2.0, 4.0, 7.5])
    u, v, ok = cam.ground_to_image(x, y)
    assert ok.all()
    gx, gy, ok2 = cam.image_to_ground(u, v)
    assert ok2.all()
    assert np.allclose(gx, x, atol=1e-6) and np.allclose(gy, y, atol=1e-6)
    # straight down the optical axis hits the ground at h / tan(pitch)
    _, gy0, _ = cam.image_to_ground(np.array([320.0]), np.array([240.0]))
    assert gy0[0] == pytest.approx(1.4 / np.tan(np.radians(35)), rel=1e-6)
    assert cam.horizon_y < 240


def test_birds_eye_marks_cells_outside_view_unknown():
    cam = Camera(320, 240, pitch_deg=40)
    bev = to_birds_eye(np.full((240, 320), LAYABLE, np.uint8), cam, GRID, fill=UNKNOWN)
    assert (bev == LAYABLE).any() and (bev == UNKNOWN).any()
    assert bev[0, 0] == UNKNOWN  # beside the camera's feet is out of frame


def test_open_view_edges_are_not_obstacles():
    plan = plan_strip(walkway(1.0, sides=UNKNOWN), GRID)
    assert plan.ok and plan.min_clearance_m is None  # nothing to keep clear of in view


def test_straight_walkway_gives_straight_strip_to_range():
    plan = plan_strip(walkway(3.0), GRID)
    assert plan.ok and plan.stop_code == "range"
    assert plan.turns == 0
    assert plan.length_m == pytest.approx(GRID.max_range_m, abs=0.3)
    assert plan.materials["directional_tiles"] == int(np.ceil(plan.new_m / 0.3))


def test_strip_detours_round_obstacle_with_clearance():
    g = walkway(5.0)
    g[cells(-0.6, 0.6, 4.0, 4.6)] = BLOCKED  # a 1.2 m wide obstacle dead ahead
    plan = plan_strip(g, GRID, PlanParams(clearance_m=0.6))
    assert plan.ok and plan.stop_code == "range"
    assert plan.min_clearance_m >= 0.6 - 0.1  # grid resolution
    pts = np.array(plan.points_m)
    x_beside = abs(np.interp(4.3, pts[:, 1], pts[:, 0]))
    assert x_beside >= 0.6 + 0.6 + 0.15 - 0.1  # obstacle half-width + clearance + strip half-width


def test_gap_narrower_than_strip_plus_clearance_is_not_used():
    g = walkway(4.0)  # 1.4 m either side of the obstacle; 1.5 m needed
    g[cells(-0.6, 0.6, 4.0, 4.6)] = BLOCKED
    plan = plan_strip(g, GRID, PlanParams(clearance_m=0.6))
    assert plan.ok and plan.stop_code == "narrow"
    assert max(y for _, y in plan.points_m) < 4.0


def test_too_narrow_walkway_has_no_start():
    plan = plan_strip(walkway(1.0), GRID, PlanParams(clearance_m=0.6))
    assert not plan.ok and plan.stop_code == "no_start"
    # with no clearance requirement the same walkway fits a strip
    assert plan_strip(walkway(1.0), GRID, PlanParams(clearance_m=0.2)).ok


def test_strip_stops_at_carriageway():
    g = walkway(3.0)
    g[cells(-5, 5, 6.0, 10)] = CARRIAGEWAY
    plan = plan_strip(g, GRID)
    assert plan.ok and plan.stop_code == "carriageway"
    assert max(y for _, y in plan.points_m) < 6.0 - 0.6
    assert plan.materials["warning_pads"] >= 1


def test_existing_tiles_are_reused_and_not_costed():
    g = walkway(3.0)
    existing = np.zeros_like(g, bool)
    existing[cells(0.5, 0.8, 0, 10)] = True
    plan = plan_strip(g, GRID, existing=existing)
    assert plan.existing_m > 0.8 * plan.length_m
    assert plan.materials["directional_tiles"] < np.ceil(plan.length_m / 0.3) / 2


def test_hysteresis_keeps_weak_ground_connected_to_strong():
    p = np.zeros((20, 20), np.float32)
    p[:, :10] = 0.9
    p[:, 10:14] = 0.35  # patterned paving next to confident ground
    p[:, 17:] = 0.35  # isolated weak region: not ground
    m = _hysteresis(p, 0.5, 0.3)
    assert m[:, :14].all() and not m[:, 14:].any()


def test_small_enclosed_blob_is_absorbed_but_edge_blob_kept():
    g = np.full((100, 100), LAYABLE, np.uint8)
    g[40:44, 40:44] = BLOCKED  # stain in the middle of the walkway
    g[0:30, 0:30] = BLOCKED  # wall at the frame edge
    absorb_enclosed_blobs(g, np.zeros_like(g, bool))
    assert (g[40:44, 40:44] == LAYABLE).all()
    assert (g[0:30, 0:30] == BLOCKED).all()


def test_pitch_estimate_follows_ground_extent():
    # The more of the frame the ground fills, the further down the camera is pointing.
    g = np.full((384, 512), BLOCKED, np.uint8)
    g[60:] = LAYABLE
    steep = estimate_pitch(g, 63)
    g2 = np.full((384, 512), BLOCKED, np.uint8)
    g2[150:] = LAYABLE
    shallow = estimate_pitch(g2, 63)
    assert steep > shallow > 0
    assert estimate_pitch(np.full((384, 512), BLOCKED, np.uint8), 63) is None


def test_live_endpoints_require_staff_or_contractor(client, auth):
    assert client.get("/api/v1/live/status").status_code == 401
    assert client.get("/api/v1/live/status", headers=auth("citizen")).status_code == 403
    r = client.get("/api/v1/live/status", headers=auth("contractor"))
    assert r.status_code == 200
    assert r.json()["github_models"]["configured"] is False


def test_scene_check_not_configured(client, auth):
    img = np.full((240, 320, 3), 128, np.uint8)
    r = client.post("/api/v1/live/scene-check", headers=auth("engineer"), files={"file": ("f.jpg", jpeg(img), "image/jpeg")})
    assert r.status_code == 501 and r.json()["detail"]["code"] == "not_configured"


def test_scene_check_parses_github_models_reply(client, auth, monkeypatch):
    sent = {}

    class Reply:
        status_code = 200
        text = ""

        def json(self):
            return {"choices": [{"message": {"content": json.dumps({"walkway_visible": True, "confidence": "low"})}}]}

    def fake_post(url, json=None, headers=None, timeout=None):
        sent.update(url=url, headers=headers, body=json)
        return Reply()

    monkeypatch.setattr(get_settings(), "github_models_token", "test-token")
    monkeypatch.setattr(github_models.httpx, "post", fake_post)
    img = np.full((240, 320, 3), 128, np.uint8)
    r = client.post("/api/v1/live/scene-check", headers=auth("engineer"), files={"file": ("f.jpg", jpeg(img), "image/jpeg")})
    assert r.status_code == 200, r.text
    assert r.json()["answer"]["walkway_visible"] is True
    assert sent["url"].startswith("https://models.github.ai/")
    assert sent["headers"]["Authorization"] == "Bearer test-token"
    assert sent["body"]["messages"][0]["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_frame_rejects_garbage(client, auth):
    r = client.post("/api/v1/live/frame", headers=auth("engineer"), files={"file": ("f.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 422


@pytest.mark.skipif(not (get_settings().models_dir / VARIANTS["fast"][0]).exists(), reason="SegFormer weights not downloaded")
def test_frame_end_to_end_with_real_surface_model(client, auth):
    # A plain grey "pavement" below a blue "sky": enough for the pipeline to run; content checks are in unit tests.
    img = np.zeros((360, 640, 3), np.uint8)
    img[:120] = (235, 206, 135)
    img[120:] = (150, 150, 150)
    img = cv2.GaussianBlur(cv2.randn(img.copy(), (150,) * 3, (12,) * 3), (3, 3), 0)
    r = client.post("/api/v1/live/frame", headers=auth("engineer"), data={"quality": "fast", "pitch_deg": "35"},
                    files={"file": ("f.jpg", jpeg(img), "image/jpeg")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["frame"] == {"width": 640, "height": 360}
    assert body["camera"]["pitch_deg"] == 35 and body["camera"]["pitch_source"] == "sensor_or_user"
    assert body["surface"]["overlay_png"].startswith("data:image/png;base64,")
    assert body["birds_eye_png"].startswith("data:image/png;base64,")
    assert "plan" in body and "stop_reason" in body["plan"]
    assert body["models"]["obstacles"] == "unavailable"  # disabled in tests


def test_plan_with_turns_is_json_serialisable():
    from dataclasses import asdict

    g = walkway(5.0)
    g[cells(-5, 0, 0, 3.0)] = BLOCKED  # staggered walkway: right half near, left half far
    g[cells(0, 5, 5.0, 10)] = BLOCKED
    plan = plan_strip(g, GRID)
    assert plan.turns >= 1 and plan.materials["warning_pads"] >= 1
    json.dumps(asdict(plan))  # numpy scalars would raise here (and 500 the API)
