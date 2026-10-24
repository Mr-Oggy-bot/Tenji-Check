"""PDF report for a saved design version (same ReportLab conventions as the punch-list PDF)."""
import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Flowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..services.documents import BODY, GRID, H1, H2, SMALL
from .document import FEATURE_TYPES
from .layouts import DESCRIPTIONS

STATEMENT = ("Planning support only. This design and estimate have not been certified against any accessibility "
             "standard. The automated checks flag likely problems and items for professional review; a qualified "
             "reviewer must assess the design against the applicable, documented requirements before construction.")
COLOURS = {
    ("directional", "whole"): "#2563eb", ("directional", "cut"): "#93c5fd",
    ("warning", "whole"): "#ca8a04", ("warning", "cut"): "#fde047",
}
FEATURE_COLOURS = {"footpath": "#d1fae5", "boundary": "#334155", "stairs": "#fb923c", "obstacle_area": "#ef4444",
                   "tree": "#16a34a", "pillar": "#475569", "obstacle": "#dc2626", "crossing": "#7c3aed", "kerb": "#0f172a",
                   "entrance": "#0891b2", "destination": "#db2777"}


def _fmt(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else "-"


class LayoutDrawing(Flowable):
    """Site plan (optional raster) with features, tile cells and route centrelines, scaled to fit."""

    def __init__(self, doc: dict, cells: list[dict], image: bytes | None, max_w: float, max_h: float):
        super().__init__()
        cw, ch = doc["canvas"]["width"], doc["canvas"]["height"]
        self.k = min(max_w / cw, max_h / ch)
        self.width, self.height = cw * self.k, ch * self.k
        self.doc, self.cells, self.image = doc, cells, image

    def _xy(self, p):
        return p[0] * self.k, self.height - p[1] * self.k

    def _path(self, c, pts, close, stroke, fill=None, width=0.6, alpha=1.0):
        p = c.beginPath()
        x, y = self._xy(pts[0])
        p.moveTo(x, y)
        for q in pts[1:]:
            p.lineTo(*self._xy(q))
        if close:
            p.close()
        c.setStrokeColor(colors.HexColor(stroke))
        c.setLineWidth(width)
        if fill:
            c.setFillColor(colors.HexColor(fill))
            c.setFillAlpha(alpha)
        c.drawPath(p, stroke=1, fill=1 if fill else 0)
        c.setFillAlpha(1)

    def draw(self):
        c = self.canv
        c.saveState()
        c.setStrokeColor(colors.HexColor("#c8d0d6"))
        c.rect(0, 0, self.width, self.height)
        if self.image:
            c.drawImage(ImageReader(io.BytesIO(self.image)), 0, 0, self.width, self.height, mask="auto")
        m = (self.doc.get("scale") or {}).get("m_per_px") or 0
        for f in self.doc.get("features", []):
            geom = FEATURE_TYPES.get(f["type"], ("point", None))[0]
            col = FEATURE_COLOURS.get(f["type"], "#64748b")
            if geom == "polygon" and len(f["points"]) >= 3:
                self._path(c, f["points"], True, col, col if f["type"] in ("footpath", "stairs", "obstacle_area") else None,
                           alpha=0.25)
            elif geom == "polyline" and len(f["points"]) >= 2:
                self._path(c, f["points"], False, col, width=1.4)
            elif f["points"]:
                x, y = self._xy(f["points"][0])
                r = max(2.0, (f.get("radius_m") or FEATURE_TYPES[f["type"]][1] or 0.25) / m * self.k if m else 2.0)
                c.setFillColor(colors.HexColor(col))
                c.circle(x, y, r, stroke=0, fill=1)
        for cell in self.cells:
            self._path(c, cell["polygon"], True, "#1e293b", COLOURS[(cell["type"], cell["kind"])], width=0.15)
        for r in self.doc.get("routes", []):
            if len(r["points"]) >= 2:
                c.setDash(2, 2)
                self._path(c, r["points"], False, "#0f172a", width=0.5)
                c.setDash()
        c.restoreState()


def _legend():
    rows = [["", "Directional tile (whole)", "", "Directional tile (cut)", "", "Warning tile (whole)", "", "Warning tile (cut)"]]
    t = Table(rows, colWidths=[5 * mm, 38 * mm] * 4)
    style = [("FONTSIZE", (0, 0), (-1, -1), 7), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]
    for i, key in enumerate((("directional", "whole"), ("directional", "cut"), ("warning", "whole"), ("warning", "cut"))):
        style.append(("BACKGROUND", (2 * i, 0), (2 * i, 0), colors.HexColor(COLOURS[key])))
    t.setStyle(style)
    return t


def version_pdf(*, project, version, estimate, comparison, users: dict, image: bytes | None) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"Tactile route plan - {project.title} v{version.number}")
    est = estimate or {}
    cur = est.get("currency", "")
    reviews = version.reviews
    story = [
        Paragraph("Tactile route plan and material estimate", H1),
        Paragraph(f"<b>{project.title}</b>" + (f" · {project.site_name}" if project.site_name else ""), BODY),
        Spacer(1, 3 * mm),
        Table([[Paragraph(str(x), SMALL) for x in row] for row in [
            ["Design version", f"v{version.number}" + (f" ({version.label})" if version.label else ""), "Review status", version.status.upper()],
            ["Saved by", getattr(users.get(version.created_by), "display_name", "-"), "Saved at", _fmt(version.created_at)],
            ["Reviewed by", ", ".join(f"{getattr(users.get(r.reviewer_id), 'display_name', '?')} ({r.decision}, {_fmt(r.created_at)})" for r in reviews) or "-",
             "Estimator", est.get("engine_version", "-")],
            ["Scale", _scale_text(version.document), "Tile size", f"{est.get('tile_size_mm', '-')} mm, layout '{est.get('layout_option', '-')}'"],
        ]], colWidths=[28 * mm, 62 * mm, 26 * mm, 64 * mm], style=TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c8d0d6")),
                                                                                   ("FONTSIZE", (0, 0), (-1, -1), 8),
                                                                                   ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f5")),
                                                                                   ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#eef2f5"))])),
        Spacer(1, 3 * mm),
        Paragraph(STATEMENT, SMALL),
        Paragraph("Proposed layout", H2),
        LayoutDrawing(version.document, est.get("cells", []), image, 180 * mm, 150 * mm),
        Spacer(1, 2 * mm),
        _legend(),
    ]
    if est.get("cells_truncated"):
        story.append(Paragraph("Large design: only the first tiles are drawn; quantities include every tile.", SMALL))

    story += [PageBreak(), Paragraph("Quantities and cost", H2)]
    if not est.get("ok"):
        story.append(Paragraph(est.get("reason", "No estimate available."), BODY))
    else:
        bt = est["by_type"]
        rows = [["", "Directional", "Warning"]]
        for label, key, fmt in (
            ("Paving area (m²)", "area_m2", "{:.2f}"), ("Whole tiles", "whole_tiles", "{}"), ("Cut pieces", "cut_pieces", "{}"),
            ("  cut from new tiles", "new_tiles_for_cuts", "{}"), ("  cut from reused offcuts", "pieces_from_offcuts", "{}"),
            ("  slivers (review)", "sliver_pieces", "{}"), ("Tiles required", "tiles_required", "{}"),
            ("Spare allowance", "spare_tiles", "{}"), ("Packs × pack size", None, None), ("Purchase quantity", "purchase_tiles", "{}"),
            ("Reusable offcuts left", "leftover_offcuts", "{}"), ("Waste (m²)", "waste_area_m2", "{:.3f}"), ("Waste (% of tiles laid)", "waste_pct", "{}%"),
            (f"Material cost ({cur})", "material_cost", "{:,.2f}"), (f"Cutting cost ({cur})", "cutting_cost", "{:,.2f}"),
            ("Area ÷ tile area (for comparison)", "naive_area_estimate_tiles", "{}"), ("Supplier", "supplier", "{}"),
        ):
            if key is None:
                rows.append([label] + [f"{bt[t]['packs']} × {bt[t]['pack_size']}" for t in ("directional", "warning")])
            else:
                rows.append([label] + [fmt.format(bt[t][key]) if bt[t][key] != "" else "-" for t in ("directional", "warning")])
        rows.append([f"Total cost ({cur})", f"{est['totals']['total_cost']:,.2f}", ""])
        story.append(Table(rows, colWidths=[70 * mm, 45 * mm, 45 * mm], style=GRID, repeatRows=1))

    if comparison:
        story += [Paragraph("Layout options compared", H2),
                  Paragraph("Options only move where the tile grid starts. Covered area, strip widths and warning areas are "
                            "identical in every option, so no option removes an accessibility feature.", SMALL)]
        rows = [["Option", "Tiles (dir / warn)", "Purchase", "Cut pieces", "Slivers", "Waste m²", f"Cost ({cur})", ""]]
        for r in comparison:
            rows.append([r["option"], f"{r['tiles_required']['directional']} / {r['tiles_required']['warning']}",
                         str(sum(r["purchase_tiles"].values())), str(r["cut_pieces"]), str(r["slivers"]),
                         f"{r['waste_area_m2']:.3f}", f"{r['total_cost']:,.2f}",
                         "recommended" if r.get("recommended") else ("" if r["valid"] else "invalid")])
        story.append(Table(rows, colWidths=[18 * mm, 30 * mm, 20 * mm, 20 * mm, 16 * mm, 20 * mm, 26 * mm, 26 * mm], style=GRID, repeatRows=1))
        for o, d in DESCRIPTIONS.items():
            story.append(Paragraph(f"<b>{o}</b>: {d}", SMALL))

    val = version.validation or {}
    story.append(Paragraph("Validation warnings and review items", H2))
    items = val.get("items", [])
    if items:
        rows = [["Severity", "Check", "Detail", "Reference"]]
        for i in items:
            rows.append([i["severity"], i["code"].replace("_", " "), Paragraph(i["message"], SMALL), Paragraph(i.get("reference") or "-", SMALL)])
        story.append(Table(rows, colWidths=[17 * mm, 28 * mm, 95 * mm, 40 * mm], style=GRID, repeatRows=1))
    else:
        story.append(Paragraph("No issues found by the automated checks (this is not a compliance statement).", BODY))
    if val.get("statement"):
        story.append(Paragraph(val["statement"], SMALL))
    th = val.get("thresholds", {})
    if th:
        story.append(Paragraph("Review thresholds used (planning assumptions, not clause values): " +
                               ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in th.items()) +
                               f". Reference set: {val.get('reference_set', '-')} (pending confirmation by a qualified reviewer).", SMALL))

    story.append(KeepTogether([Paragraph("Assumptions", H2)] + [Paragraph(f"• {a}", SMALL) for a in est.get("assumptions", [])]))
    for r in reviews:
        story.append(Paragraph(f"Review note ({r.decision}): {r.note or '-'}", SMALL))
    doc.build(story)
    return buf.getvalue()


def _scale_text(d: dict) -> str:
    sc = d.get("scale") or {}
    if not sc.get("m_per_px"):
        return "not calibrated"
    cal = sc.get("calibration") or {}
    extra = f", calibrated on a {cal.get('length_m')} m reference" if cal.get("length_m") else ""
    return f"{sc['m_per_px'] * 1000:.2f} mm per px ({sc.get('source')}{extra})"
