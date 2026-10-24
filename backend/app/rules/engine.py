"""Rules engine: turns tile geometry and obstacle detections into candidate findings.

Every candidate is a proposal for human review. Where geometry is unreliable the candidate carries
verify_on_site=True instead of a guessed measurement.
"""
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from ..vision.geometry import StripGeometry, obstacle_overlap
from ..vision.obstacles import UTILITY_CLASSES, Detection

CONTEXT_TAGS = ("segment", "path_end", "crossing", "other")
HAZARD_CONTEXTS = ("path_end", "crossing")


@lru_cache
def references() -> dict:
    return yaml.safe_load((Path(__file__).parent / "references.yaml").read_text(encoding="utf-8"))


@dataclass
class Candidate:
    defect_class: str
    confidence: float | None
    bbox: list[float] | None
    description: str
    verify_on_site: bool = False
    uncertainty_note: str = ""
    severity: str = "high"
    measurement: dict = field(default_factory=dict)
    evidence: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        ref = references()["rules"][self.defect_class]
        d = asdict(self)
        d.update(rule_id=self.defect_class, rule_reference=ref["reference"], required_fix=ref["required_fix"],
                 title=ref["title"], rules_version=references()["version"])
        return d


def evaluate(context_tag: str | None, tiles_area: float, geom: StripGeometry | None, strip: dict | None,
             obstacles: list[Detection] | None, image_shape) -> tuple[list[dict], list[str]]:
    refs = references()
    gap_thr = refs["gap_threshold_tiles"]
    notes: list[str] = []
    out: list[Candidate] = []
    context = context_tag or "segment"

    if geom is None or strip is None:
        out.append(Candidate(
            "unassessable", None, None,
            "No tactile tile strip could be located in this photo.",
            verify_on_site=True, severity="medium",
            uncertainty_note="Tile grid absent or not detected; nothing was measured. Verify on site or mark manually.",
            evidence={"tile_area_fraction": round(tiles_area, 4)},
        ))
        if obstacles:
            for d in obstacles:
                out.append(Candidate("obstacle_on_path", round(d.confidence, 2), d.bbox,
                                     f"{d.prompt.capitalize()} detected, but the guide corridor could not be located.",
                                     verify_on_site=True, uncertainty_note="Corridor unknown: overlap with the guide path not measured.",
                                     evidence={"detector_class": d.class_name, "prompt": d.prompt}))
        return [c.to_dict() for c in out], notes

    reliable = bool(strip["reliable"])
    if not reliable:
        notes.extend(strip["notes"])
    unreliable_note = "; ".join(strip["notes"]) or "Geometry unreliable"

    # Rule A: obstacle on guide path (utility covers break the strip, so they feed rule B instead).
    obstacle_spans = []
    if obstacles is None:
        notes.append("Obstacle detector unavailable: obstacle rule not evaluated. Use tap-to-mark for obstacles.")
    for d in obstacles or []:
        ov = obstacle_overlap(geom, strip, d.bbox, image_shape)
        if not ov.get("on_path"):
            continue
        is_cover = d.class_name in UTILITY_CLASSES
        if not is_cover:
            obstacle_spans.append(d.bbox)
        meas = {k: ov[k] for k in ("corridor_width_overlap", "position_tiles", "image_overlap") if k in ov}
        if is_cover:
            out.append(Candidate(
                "interrupted_path", round(d.confidence, 2), d.bbox,
                f"{d.prompt.capitalize()} sits inside the guide strip and breaks its continuity.",
                verify_on_site=not reliable, uncertainty_note="" if reliable else unreliable_note,
                measurement=meas, evidence={"detector_class": d.class_name, "prompt": d.prompt}))
        else:
            out.append(Candidate(
                "obstacle_on_path", round(d.confidence, 2), d.bbox,
                f"{d.prompt.capitalize()} overlaps the guide corridor"
                + (f" ({meas['corridor_width_overlap']:.0%} of its width)." if "corridor_width_overlap" in meas else "."),
                verify_on_site=not reliable, uncertainty_note="" if reliable else unreliable_note,
                measurement=meas, evidence={"detector_class": d.class_name, "prompt": d.prompt}))

    # Rule B: interrupted guide path (gap wider than one tile unit, or a dead-end strip).
    for g in strip["gaps"]:
        explained = any(_overlaps(g["bbox"], b) for b in obstacle_spans)
        if explained:
            notes.append("A gap in the strip is covered by a detected obstacle; reported under the obstacle rule.")
            continue
        if g["length_tiles"] is None:
            out.append(Candidate("interrupted_path", None, g["bbox"],
                                 "A break in the tile strip is visible, but its length cannot be measured.",
                                 verify_on_site=True, uncertainty_note=unreliable_note, severity="medium"))
        elif g["length_tiles"] > gap_thr:
            conf = min(0.95, 0.5 + 0.1 * g["length_tiles"]) * (1.0 if reliable else 0.6)
            out.append(Candidate(
                "interrupted_path", round(conf, 2), g["bbox"],
                f"Gap of about {g['length_tiles']:.1f} tile units in the guide strip (limit {gap_thr:g}).",
                verify_on_site=not reliable, uncertainty_note="" if reliable else unreliable_note,
                severity="high" if g["length_tiles"] >= 2 else "medium",
                measurement={"gap_tiles": g["length_tiles"], "threshold_tiles": gap_thr}))

    ends = strip["ends"]
    if context == "segment":
        for name, e in ends.items():
            if e["visible"] and e["near"] and e["type"] == "directional":
                out.append(Candidate(
                    "interrupted_path", 0.4, e["bbox"],
                    "Directional strip ends inside the frame without a warning band (possible dead end).",
                    verify_on_site=True, severity="medium",
                    uncertainty_note="The path may continue or turn outside the photo; confirm on site.",
                    evidence={"end": name}))

    # Rule C: missing warning tiles before a kerb/crossing/path end.
    if context in HAZARD_CONTEXTS:
        visible = {k: e for k, e in ends.items() if e["visible"]}
        if not visible:
            out.append(Candidate("missing_warning_tiles", None, None,
                                 "The strip end nearest the hazard is not inside the photo.",
                                 verify_on_site=True, severity="medium",
                                 uncertainty_note="Retake the photo including the kerb/crossing edge."))
        elif not any(e["type"] == "warning" for e in visible.values()):
            unknown = any(e["type"] in ("unknown", "none") for e in visible.values())
            end_name, e = max(visible.items(), key=lambda kv: kv[1]["width_px"])
            out.append(Candidate(
                "missing_warning_tiles", None if unknown else 0.6, e["bbox"],
                f"No warning (dot) tiles detected at the strip end before the {context.replace('_', ' ')}.",
                verify_on_site=unknown or not reliable,
                uncertainty_note=("Tile texture could not be classified" if unknown else "")
                + ("" if reliable else ("; " if unknown else "") + unreliable_note),
                evidence={"end": end_name, "end_types": {k: v["type"] for k, v in visible.items()}}))

    return [c.to_dict() for c in out], notes


def _overlaps(a, b) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])
