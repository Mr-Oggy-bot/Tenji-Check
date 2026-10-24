"""Compare the findings of two inspections of the same site.

Findings are matched by defect class and location: the nearest pair of the same class within `radius_m` when both
have GPS, otherwise the same class and the same context tag (a weaker match, flagged as such). Rejected findings
(false positives dismissed by a reviewer) are left out. "Not seen again" only means the later inspection recorded
nothing there; it is not evidence of a repair unless the later inspection covered that spot.
"""
from ..gis.geo import haversine
from ..models import Finding
from ..services.documents import LABELS

DEFAULT_RADIUS_M = 15.0
OPEN_STATES = ("ai_proposed", "under_review", "confirmed", "fix_required", "awaiting_reinspection")


def counted(findings: list[Finding]) -> list[Finding]:
    return [f for f in findings if f.status != "rejected"]


def _dist(a: Finding, b: Finding) -> float | None:
    if None in (a.lat, a.lon, b.lat, b.lon):
        return None
    return haversine(a.lat, a.lon, b.lat, b.lon)


def match(before: list[Finding], after: list[Finding], radius_m: float = DEFAULT_RADIUS_M) -> list[tuple[Finding, Finding, float | None]]:
    """Greedy one-to-one matching, closest GPS pairs first, then class + context tag for findings without GPS."""
    pairs: list[tuple[float, int, int]] = []
    for i, a in enumerate(before):
        for j, b in enumerate(after):
            if a.defect_class != b.defect_class:
                continue
            d = _dist(a, b)
            if d is not None and d <= radius_m:
                pairs.append((d, i, j))
    pairs.sort()
    used_a: set[int] = set()
    used_b: set[int] = set()
    out: list[tuple[Finding, Finding, float | None]] = []
    for d, i, j in pairs:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        out.append((before[i], after[j], d))
    for i, a in enumerate(before):
        if i in used_a or (a.lat is not None and a.lon is not None):
            continue
        for j, b in enumerate(after):
            if j in used_b or b.defect_class != a.defect_class or (b.lat is not None and b.lon is not None):
                continue
            if a.context_tag and a.context_tag == b.context_tag:
                used_a.add(i)
                used_b.add(j)
                out.append((a, b, None))
                break
    return out


def _brief(f: Finding) -> dict:
    return {"id": f.id, "defect_class": f.defect_class, "label": LABELS.get(f.defect_class, f.defect_class),
            "status": f.status, "severity": f.severity, "context_tag": f.context_tag, "lat": f.lat, "lon": f.lon,
            "description": f.description, "open": f.status in OPEN_STATES}


def compare(before: list[Finding], after: list[Finding], radius_m: float = DEFAULT_RADIUS_M) -> dict:
    before, after = counted(before), counted(after)
    matched = match(before, after, radius_m)
    ma = {a.id for a, _, _ in matched}
    mb = {b.id for _, b, _ in matched}
    recurring = [{"before": _brief(a), "after": _brief(b), "distance_m": None if d is None else round(d, 1),
                  "matched_by": "location" if d is not None else "type_and_context"} for a, b, d in matched]
    not_seen = [_brief(a) for a in before if a.id not in ma]
    new = [_brief(b) for b in after if b.id not in mb]
    classes = sorted({f.defect_class for f in before + after})
    by_class = [{"defect_class": c, "label": LABELS.get(c, c),
                 "before": sum(f.defect_class == c for f in before), "after": sum(f.defect_class == c for f in after),
                 "recurring": sum(r["before"]["defect_class"] == c for r in recurring),
                 "new": sum(f["defect_class"] == c for f in new), "not_seen_again": sum(f["defect_class"] == c for f in not_seen)}
                for c in classes]
    return {
        "radius_m": radius_m,
        "totals": {"before": len(before), "after": len(after), "recurring": len(recurring), "new": len(new),
                   "not_seen_again": len(not_seen)},
        "by_class": by_class, "recurring": recurring, "new": new, "not_seen_again": not_seen,
        "method": (f"Findings are matched by defect class and GPS distance (within {radius_m:g} m, closest first). "
                   "Findings without GPS are matched by class and context tag only. Rejected findings are excluded."),
        "caveat": ("'Not seen again' means the later inspection recorded nothing there. It is not evidence of a repair "
                   "unless the later inspection photographed that location."),
    }
