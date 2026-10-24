"""Design document schema, default settings, and conversion from plan pixels to metres.

Geometry is stored in plan pixels (the site-plan image, or a blank canvas) plus a scale, so recalibrating the
drawing never distorts what was drawn on it.
"""
import copy
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field, field_validator

FEATURE_TYPES = {
    # type: (geometry, default radius in m for point features)
    "footpath": ("polygon", None),
    "boundary": ("polygon", None),
    "entrance": ("point", None),
    "destination": ("point", None),
    "crossing": ("polyline", None),
    "kerb": ("polyline", None),
    "stairs": ("polygon", None),
    "tree": ("point", 0.5),
    "pillar": ("point", 0.3),
    "obstacle": ("point", 0.4),
    "obstacle_area": ("polygon", None),
}
OBSTACLE_TYPES = {"tree", "pillar", "obstacle", "obstacle_area"}
HAZARD_TYPES = {"crossing", "kerb", "stairs"}
ENDPOINT_TYPES = {"entrance", "destination"}
TILE_TYPES = ("directional", "warning")
LAYOUT_OPTIONS = ("start", "centred", "offset")
MAX_ITEMS = 2000
MAX_POINTS = 500

DEFAULT_SETTINGS = {
    "tile_size_mm": 300,
    "kerf_mm": 3,
    "min_offcut_mm": 60,
    "sliver_fraction": 0.15,
    "reuse_offcuts": True,
    "spare_pct": 5.0,
    "min_spare_tiles": 2,
    "currency": "INR",
    "cut_cost_per_cut": 0.0,
    "prices": {
        "directional": {"pack_size": 10, "price_per_pack": 0.0, "supplier": ""},
        "warning": {"pack_size": 10, "price_per_pack": 0.0, "supplier": ""},
    },
    # Review thresholds: planning assumptions, NOT clause values. Confirm against the governing guideline.
    "clearance_m": 0.6,
    "hazard_approach_m": 1.0,
    "min_warning_depth_m": 0.6,
    "turn_review_deg": 30.0,
    "connect_tolerance_m": 0.15,
}


def merged_settings(s: dict | None) -> dict:
    out = copy.deepcopy(DEFAULT_SETTINGS)
    for k, v in (s or {}).items():
        if k == "prices" and isinstance(v, dict):
            for t, pv in v.items():
                if t in out["prices"] and isinstance(pv, dict):
                    out["prices"][t].update({kk: pv[kk] for kk in ("pack_size", "price_per_pack", "supplier") if kk in pv})
        elif k in out:
            out[k] = v
    return out


Pt = list[float]


class _Shape(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    label: str = Field(default="", max_length=200)
    points: list[Pt] = Field(min_length=1, max_length=MAX_POINTS)

    @field_validator("points")
    @classmethod
    def _xy(cls, v):
        for p in v:
            if len(p) != 2 or not all(isinstance(c, (int, float)) and abs(c) < 1e7 for c in p):
                raise ValueError("points must be [x, y] pairs")
        return v


class FeatureIn(_Shape):
    type: str
    radius_m: float | None = Field(default=None, gt=0, le=20)

    @field_validator("type")
    @classmethod
    def _type(cls, v):
        if v not in FEATURE_TYPES:
            raise ValueError(f"unknown feature type {v}")
        return v


class RouteIn(_Shape):
    width_tiles: int = Field(default=1, ge=1, le=4)


class WarningAreaIn(_Shape):
    angle_deg: float | None = Field(default=None, ge=-360, le=360)  # tile grid orientation; None = longest edge


class TileIn(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    type: Literal["directional", "warning"]
    x: float
    y: float
    angle_deg: float = 0.0


class ScaleIn(BaseModel):
    m_per_px: float | None = Field(default=None, gt=0, le=100)
    source: Literal["default", "calibrated", "manual", "none"] = "none"
    calibration: dict | None = None


class CanvasIn(BaseModel):
    width: int = Field(default=3000, ge=100, le=20000)
    height: int = Field(default=2000, ge=100, le=20000)


class DocumentIn(BaseModel):
    schema_version: int = 1
    canvas: CanvasIn = CanvasIn()
    scale: ScaleIn = ScaleIn()
    site_image_id: int | None = None
    features: list[FeatureIn] = Field(default_factory=list, max_length=MAX_ITEMS)
    routes: list[RouteIn] = Field(default_factory=list, max_length=MAX_ITEMS)
    warning_areas: list[WarningAreaIn] = Field(default_factory=list, max_length=MAX_ITEMS)
    tiles: list[TileIn] = Field(default_factory=list, max_length=MAX_ITEMS)
    layout_option: Literal["start", "centred", "offset"] = "start"


def empty_document() -> dict:
    return DocumentIn(scale=ScaleIn(m_per_px=0.01, source="default")).model_dump()


@dataclass
class Feature:
    id: str
    type: str
    label: str
    pts: list[tuple[float, float]]
    radius: float | None = None

    @property
    def geometry(self) -> str:
        return FEATURE_TYPES[self.type][0]

    def shape(self, circle_fn) -> tuple[list[tuple[float, float]], bool]:
        """(points, closed) in metres; point obstacles become circles of their radius."""
        if self.geometry == "point":
            return (circle_fn(self.pts[0], self.radius) if self.radius else [self.pts[0]]), bool(self.radius)
        return self.pts, self.geometry == "polygon"


@dataclass
class Route:
    id: str
    label: str
    pts: list[tuple[float, float]]
    width_tiles: int


@dataclass
class WarningArea:
    id: str
    label: str
    pts: list[tuple[float, float]]
    angle_deg: float | None


@dataclass
class Tile:
    id: str
    type: str
    pt: tuple[float, float]
    angle_deg: float


@dataclass
class Scene:
    """The design in metres."""
    m_per_px: float | None
    features: list[Feature] = field(default_factory=list)
    routes: list[Route] = field(default_factory=list)
    warnings: list[WarningArea] = field(default_factory=list)
    tiles: list[Tile] = field(default_factory=list)
    layout_option: str = "start"

    def px(self, p: tuple[float, float]) -> list[float]:
        """Metres back to plan pixels (for locating messages on the drawing)."""
        k = self.m_per_px or 1.0
        return [round(p[0] / k, 1), round(p[1] / k, 1)]


def to_scene(doc: dict) -> Scene:
    d = DocumentIn.model_validate(doc)
    k = d.scale.m_per_px
    f = k or 1.0

    def m(points):
        return [(p[0] * f, p[1] * f) for p in points]

    sc = Scene(k, layout_option=d.layout_option)
    for x in d.features:
        geom, default_r = FEATURE_TYPES[x.type]
        need = {"point": 1, "polyline": 2, "polygon": 3}[geom]
        if len(x.points) < need:
            continue
        pts = m(x.points[:1] if geom == "point" else x.points)
        sc.features.append(Feature(x.id, x.type, x.label, pts, x.radius_m or default_r))
    sc.routes = [Route(r.id, r.label, m(r.points), r.width_tiles) for r in d.routes if len(r.points) >= 2]
    sc.warnings = [WarningArea(w.id, w.label, m(w.points), w.angle_deg) for w in d.warning_areas if len(w.points) >= 3]
    sc.tiles = [Tile(t.id, t.type, (t.x * f, t.y * f), t.angle_deg) for t in d.tiles]
    return sc
