import os
import shutil
import tempfile

_TMP = tempfile.mkdtemp(prefix="tenjicheck-test-")
os.environ["TC_DATA_DIR"] = _TMP
os.environ["TC_OBSTACLE_ENABLED"] = "false"
os.environ["TC_OSM_ENABLED"] = "false"
os.environ["TC_PUBLIC_RATE_LIMIT_PER_MINUTE"] = "1000"

import cv2  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.seed import DEMO_PASSWORD  # noqa: E402
from app.services.guards import limiter  # noqa: E402
from app.vision.synthetic import strip_scene  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture(autouse=True)
def _reset_limits():
    limiter.reset()


def login(client, role: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"email": f"{role}@tenjicheck.local", "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def auth(client):
    return lambda role: login(client, role)


def jpeg(img) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return buf.tobytes()


@pytest.fixture
def scene():
    def make(**kw):
        img, truth = strip_scene(**kw)
        return jpeg(img), truth
    return make
