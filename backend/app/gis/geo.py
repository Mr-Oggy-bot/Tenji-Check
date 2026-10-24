import math

R_EARTH = 6371008.8


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


def _to_xy(lat: float, lon: float, lat0: float) -> tuple[float, float]:
    return (math.radians(lon) * R_EARTH * math.cos(math.radians(lat0)), math.radians(lat) * R_EARTH)


def point_segment_distance(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance in metres from point p to segment ab (all (lat, lon)); local equirectangular approximation."""
    lat0 = (a[0] + b[0]) / 2
    px, py = _to_xy(*p, lat0)
    ax, ay = _to_xy(*a, lat0)
    bx, by = _to_xy(*b, lat0)
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def polyline_length(points: list[tuple[float, float]]) -> float:
    return sum(haversine(*a, *b) for a, b in zip(points, points[1:]))
