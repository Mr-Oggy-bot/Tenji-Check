"""Small 2-D geometry kit for the planner (metres, plan coordinates). No external dependencies.

Polygons are lists of (x, y). Clipping uses Sutherland-Hodgman, which is exact when the clip window is convex
(tile cells and mitred strip segments are convex); the subject may be concave, and the area of the result is
then still correct.
"""
import math
from dataclasses import dataclass

Point = tuple[float, float]
Poly = list[Point]
EPS = 1e-9


def area(poly: Poly) -> float:
    """Unsigned shoelace area."""
    return abs(signed_area(poly))


def signed_area(poly: Poly) -> float:
    n = len(poly)
    if n < 3:
        return 0.0
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))


def ccw(poly: Poly) -> Poly:
    return poly if signed_area(poly) >= 0 else poly[::-1]


def clip(subject: Poly, window: Poly) -> Poly:
    """Part of `subject` inside the convex `window`."""
    out = list(subject)
    win = ccw(window)
    n = len(win)
    for i in range(n):
        if not out:
            break
        a, b = win[i], win[(i + 1) % n]

        def inside(p, a=a, b=b):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -EPS

        def cross_pt(p, q, a=a, b=b):
            dx1, dy1 = q[0] - p[0], q[1] - p[1]
            dx2, dy2 = b[0] - a[0], b[1] - a[1]
            den = dx1 * dy2 - dy1 * dx2
            if abs(den) < EPS:
                return q
            t = ((a[0] - p[0]) * dy2 - (a[1] - p[1]) * dx2) / den
            return (p[0] + t * dx1, p[1] + t * dy1)

        inp, out = out, []
        for j in range(len(inp)):
            p, q = inp[j], inp[(j + 1) % len(inp)]
            pin, qin = inside(p), inside(q)
            if pin and qin:
                out.append(q)
            elif pin:
                out.append(cross_pt(p, q))
            elif qin:
                out.append(cross_pt(p, q))
                out.append(q)
    return out if len(out) >= 3 else []


def point_in_polygon(p: Point, poly: Poly) -> bool:
    x, y = p
    inside = False
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def point_seg_dist(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 < EPS else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def segments_intersect(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
    def orient(a, b, c):
        v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return 0 if abs(v) < EPS else (1 if v > 0 else -1)

    def on_seg(a, b, c):
        return min(a[0], b[0]) - EPS <= c[0] <= max(a[0], b[0]) + EPS and min(a[1], b[1]) - EPS <= c[1] <= max(a[1], b[1]) + EPS

    o1, o2, o3, o4 = orient(p1, p2, q1), orient(p1, p2, q2), orient(q1, q2, p1), orient(q1, q2, p2)
    if o1 != o2 and o3 != o4:
        return True
    return any(o == 0 and on_seg(a, b, c) for o, a, b, c in
               ((o1, p1, p2, q1), (o2, p1, p2, q2), (o3, q1, q2, p1), (o4, q1, q2, p2)))


def seg_seg_dist(a1: Point, a2: Point, b1: Point, b2: Point) -> float:
    if segments_intersect(a1, a2, b1, b2):
        return 0.0
    return min(point_seg_dist(a1, b1, b2), point_seg_dist(a2, b1, b2), point_seg_dist(b1, a1, a2), point_seg_dist(b2, a1, a2))


def edges(poly: Poly, closed: bool = True):
    n = len(poly)
    for i in range(n if closed else n - 1):
        yield poly[i], poly[(i + 1) % n]


def shape_dist(a: Poly, a_closed: bool, b: Poly, b_closed: bool) -> float:
    """Minimum distance between two shapes (points, polylines or polygons); 0 if they overlap."""
    if a_closed and len(a) >= 3 and any(point_in_polygon(p, a) for p in b):
        return 0.0
    if b_closed and len(b) >= 3 and any(point_in_polygon(p, b) for p in a):
        return 0.0
    ea = list(edges(a, a_closed)) if len(a) > 1 else [(a[0], a[0])]
    eb = list(edges(b, b_closed)) if len(b) > 1 else [(b[0], b[0])]
    return min(seg_seg_dist(p, q, r, s) for p, q in ea for r, s in eb)


def circle(c: Point, r: float, n: int = 16) -> Poly:
    return [(c[0] + r * math.cos(2 * math.pi * k / n), c[1] + r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def turn_angle_deg(a: Point, b: Point, c: Point) -> float:
    """Change of heading at b (0 = straight on)."""
    u = (b[0] - a[0], b[1] - a[1])
    v = (c[0] - b[0], c[1] - b[1])
    nu, nv = math.hypot(*u), math.hypot(*v)
    if nu < EPS or nv < EPS:
        return 0.0
    cosv = max(-1.0, min(1.0, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)))
    return math.degrees(math.acos(cosv))


@dataclass
class StripSegment:
    """One straight run of a tactile strip: a convex quad plus its local tile frame."""
    index: int
    quad: Poly
    origin: Point  # segment start on the centreline
    u: Point  # unit direction of travel
    n: Point  # unit normal (left)
    length: float  # centreline length
    width: float


def _line_intersection(p: Point, d: Point, q: Point, e: Point) -> Point | None:
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < EPS:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + t * d[0], p[1] + t * d[1])


def dedupe(points: list[Point], tol: float = 1e-6) -> list[Point]:
    out: list[Point] = []
    for p in points:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > tol:
            out.append(p)
    return out


def strip_segments(points: list[Point], width: float) -> list[StripSegment]:
    """Split a centreline into convex quads with mitred joints (square ends at the two route ends)."""
    pts = dedupe(points)
    if len(pts) < 2:
        return []
    h = width / 2
    dirs, norms = [], []
    for a, b in zip(pts[:-1], pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        dirs.append(u)
        norms.append((-u[1], u[0]))

    def joint(i: int, side: float) -> Point:
        """Offset corner at vertex i on the given side (+1 left, -1 right)."""
        p = pts[i]
        if i == 0 or i == len(pts) - 1:
            k = 0 if i == 0 else len(dirs) - 1
            return (p[0] + side * h * norms[k][0], p[1] + side * h * norms[k][1])
        n0, n1 = norms[i - 1], norms[i]
        a = (p[0] + side * h * n0[0], p[1] + side * h * n0[1])
        b = (p[0] + side * h * n1[0], p[1] + side * h * n1[1])
        x = _line_intersection(a, dirs[i - 1], b, dirs[i])
        return x if x is not None else a

    segs = []
    for i in range(len(dirs)):
        quad = [joint(i, -1), joint(i + 1, -1), joint(i + 1, 1), joint(i, 1)]
        L = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        segs.append(StripSegment(i, ccw(quad), pts[i], dirs[i], norms[i], L, width))
    return segs


def to_local(p: Point, origin: Point, u: Point, n: Point) -> Point:
    dx, dy = p[0] - origin[0], p[1] - origin[1]
    return (dx * u[0] + dy * u[1], dx * n[0] + dy * n[1])


def from_local(s: float, t: float, origin: Point, u: Point, n: Point) -> Point:
    return (origin[0] + s * u[0] + t * n[0], origin[1] + s * u[1] + t * n[1])


def bbox(poly: Poly) -> tuple[float, float, float, float]:
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)
