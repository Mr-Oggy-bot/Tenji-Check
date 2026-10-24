"""Optional pedestrian-network context from OpenStreetMap via Overpass (ODbL; attribution required).

OSM tags are not visual ground truth: a missing tactile_paving tag does not mean tactile paving is absent.
"""
import hashlib
import json
import logging

import httpx

from ..config import get_settings

log = logging.getLogger(__name__)
WAY_FILTER = "footway|pedestrian|path|living_street|residential|service|steps|crossing|unclassified|tertiary"


def fetch_pedestrian_ways(south: float, west: float, north: float, east: float) -> tuple[dict | None, str | None]:
    s = get_settings()
    if not s.osm_enabled:
        return None, "OpenStreetMap lookup disabled by configuration"
    bbox = f"{south:.5f},{west:.5f},{north:.5f},{east:.5f}"
    cache_dir = s.data_dir / "osm_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_dir / (hashlib.sha1(bbox.encode()).hexdigest()[:16] + ".json")
    if cache.exists():
        return json.loads(cache.read_text()), None
    query = f'[out:json][timeout:15];(way["highway"~"{WAY_FILTER}"]({bbox}););(._;>;);out body;'
    try:
        r = httpx.post(s.overpass_url, data={"data": query}, timeout=s.osm_timeout_seconds,
                       headers={"User-Agent": "TenjiCheck-prototype/0.1"})
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("Overpass request failed: %s", exc)
        return None, f"OpenStreetMap network unavailable ({exc.__class__.__name__}); only surveyed track used"
    cache.write_text(json.dumps(data))
    return data, None
