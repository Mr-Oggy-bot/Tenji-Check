"""PDF punch lists, survey exports and CSV exports built from the same database records shown in the UI."""
import csv
import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .. import storage
from ..models import Finding, Inspection, Media, Survey, User

DISCLAIMER = ("TenjiCheck screens; the engineer decides. This document lists reviewer-confirmed findings and their "
              "status. It is not an accessibility compliance certificate and does not replace on-site inspection.")
REQUIRED_FIELDS = ("photo", "rule_reference", "reviewer", "status", "date")

_styles = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=_styles["Heading1"], fontSize=17, spaceAfter=4, textColor=colors.HexColor("#0b2233"))
H2 = ParagraphStyle("h2", parent=_styles["Heading2"], fontSize=12, spaceBefore=8, spaceAfter=4)
BODY = ParagraphStyle("b", parent=_styles["BodyText"], fontSize=9, leading=12)
SMALL = ParagraphStyle("s", parent=BODY, fontSize=8, textColor=colors.HexColor("#555555"))
GRID = TableStyle([
    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c8d0d6")),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0b2233")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTSIZE", (0, 0), (-1, -1), 8),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
])
LABELS = {
    "obstacle_on_path": "Obstacle on guide path", "interrupted_path": "Interrupted guide path",
    "missing_warning_tiles": "Missing warning tiles", "damaged_tactile_tile": "Damaged tactile tile",
    "unassessable": "Not assessable from photo", "other": "Other",
}


def _fmt(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else "-"


def _img(key: str | None, max_w: float, max_h: float):
    if not storage.exists(key):
        return None
    im = Image(io.BytesIO(storage.read(key)))
    ratio = min(max_w / im.imageWidth, max_h / im.imageHeight)
    im.drawWidth, im.drawHeight = im.imageWidth * ratio, im.imageHeight * ratio
    return im


def item_completeness(f: Finding, users: dict[int, User]) -> dict[str, bool]:
    return {
        "photo": f.media_id is not None,
        "rule_reference": bool(f.rule_reference),
        "reviewer": f.reviewer_id in users,
        "status": bool(f.status),
        "date": f.reviewed_at is not None,
    }


def punch_list_pdf(inspection: Inspection, items: list[Finding], rejected: list[Finding], media: dict[int, Media],
                   users: dict[int, User], version: int, generated_by: User) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"Punch list - {inspection.title}")
    s = [Paragraph("TenjiCheck punch list", H1),
         Paragraph(f"<b>{inspection.project.name}</b> &middot; {inspection.title} &middot; site: {inspection.site_name or '-'}", BODY),
         Paragraph(f"Version {version} &middot; generated {_fmt(datetime.utcnow())} by {generated_by.display_name} ({generated_by.role})", SMALL),
         Spacer(1, 4), Paragraph(DISCLAIMER, SMALL)]
    if inspection.is_demo:
        s.append(Paragraph("<font color='#b45309'><b>Demo data:</b> synthetic images, not a real site inspection.</font>", BODY))

    rows = [["#", "Finding", "Status", "Severity", "Rule reference", "Reviewer"]]
    for f in items:
        rows.append([str(f.punch_item_no), Paragraph(f"F-{f.id} {LABELS.get(f.defect_class, f.defect_class)}", BODY),
                     f.status.replace("_", " "), f.severity, Paragraph(f.rule_reference or "-", BODY),
                     users[f.reviewer_id].display_name if f.reviewer_id in users else "-"])
    s += [Paragraph("Summary", H2), Table(rows, colWidths=[8 * mm, 52 * mm, 28 * mm, 16 * mm, 50 * mm, 26 * mm], style=GRID)]

    for f in items:
        m = media.get(f.media_id)
        rm = media.get(f.repair_media_id)
        meas = ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in (f.measurement or {}).items()) or "-"
        loc = f"{f.lat:.6f}, {f.lon:.6f}" if f.lat is not None else "not recorded"
        details = [
            ["Finding", f"F-{f.id} ({f.source.upper()} proposal)" if f.source == "ai" else f"F-{f.id} (manual)"],
            ["Category", LABELS.get(f.defect_class, f.defect_class)],
            ["Status", f.status.replace("_", " ")],
            ["Location / context", f"{loc} · {(f.context_tag or '-').replace('_', ' ')}" + (f" · {m.segment_label}" if m and m.segment_label else "")],
            ["Rule reference", Paragraph(f.rule_reference or "-", BODY)],
            ["Description", Paragraph(f.description or "-", BODY)],
            ["Required fix", Paragraph(f.required_fix or "-", BODY)],
            ["Measurement", Paragraph(meas, BODY)],
            ["Reviewer", f"{users[f.reviewer_id].display_name if f.reviewer_id in users else '-'} · {_fmt(f.reviewed_at)}"],
            ["Reviewer notes", Paragraph(f.review_notes or "-", BODY)],
        ]
        if f.verify_on_site:
            details.append(["Verify on site", Paragraph(f.uncertainty_note or "Measurement not reliable from photo", BODY)])
        if f.reinspected_at:
            details.append(["Reinspection", f"{users[f.reinspected_by].display_name if f.reinspected_by in users else '-'} · {_fmt(f.reinspected_at)}"])
        if f.closed_at:
            details.append(["Closed", _fmt(f.closed_at)])
        t = Table(details, colWidths=[32 * mm, 66 * mm],
                  style=TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#d5dbe0")),
                                    ("FONTSIZE", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f5"))]))
        photos = [p for p in (_img(m.annotated_key or m.display_key, 78 * mm, 70 * mm) if m else None,
                              _img(rm.display_key, 78 * mm, 50 * mm) if rm else None) if p]
        photo_cell = Table([[p] for p in photos] or [["No photo"]], style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 7)]))
        block = [Paragraph(f"Item {f.punch_item_no}: {LABELS.get(f.defect_class, f.defect_class)}", H2),
                 Table([[t, photo_cell]], colWidths=[100 * mm, 80 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))]
        if rm:
            block.append(Paragraph("Lower photo: repair / reinspection evidence submitted by the contractor.", SMALL))
        s.append(KeepTogether(block))

    if rejected:
        s += [PageBreak(), Paragraph("Rejected AI proposals (kept for audit)", H2)]
        rrows = [["Finding", "Category", "Reviewer", "Reason"]]
        for f in rejected:
            rrows.append([f"F-{f.id}", LABELS.get(f.defect_class, f.defect_class),
                          users[f.reviewer_id].display_name if f.reviewer_id in users else "-", Paragraph(f.review_notes or "-", BODY)])
        s.append(Table(rrows, colWidths=[18 * mm, 44 * mm, 34 * mm, 84 * mm], style=GRID))
    doc.build(s)
    return buf.getvalue()


def survey_pdf(survey: Survey, owner: User | None, routes: list, users: dict[int, User]) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"Survey - {survey.title}")
    s = [Paragraph(f"TenjiCheck Build survey: {survey.title}", H1),
         Paragraph(f"Status: {survey.status} &middot; by {owner.display_name if owner else '-'} &middot; "
                   f"{_fmt(survey.started_at)} to {_fmt(survey.ended_at)}", BODY),
         Paragraph("Draft for engineering review. Routes and material estimates are proposals based on recorded "
                   "observations and available map data; an engineer must verify dimensions, standards, utilities, "
                   "drainage and crossings. Unknown map attributes are not treated as accessible.", SMALL)]
    s.append(Paragraph(f"Track: {len(survey.points)} GPS points", H2))
    obs = [["#", "Type", "Lat, Lon", "Source", "Accuracy", "Note"]]
    for i, o in enumerate(survey.observations, 1):
        obs.append([str(i), o.observation_type.replace("_", " "), f"{o.lat:.6f}, {o.lon:.6f}", o.location_source,
                    f"±{o.accuracy_m:.0f} m" if o.accuracy_m else "-", Paragraph(o.note or "-", BODY)])
    s += [Paragraph("Observations", H2), Table(obs, colWidths=[8 * mm, 30 * mm, 40 * mm, 18 * mm, 18 * mm, 66 * mm], style=GRID)]
    for r in routes:
        b = r.score_breakdown
        s.append(Paragraph(f"Candidate route {r.rank} (batch {r.batch}) — {r.approval_status}", H2))
        rows = [["Distance", f"{r.distance_m:.0f} m"], ["Score", f"{r.score:.1f}"],
                ["Barriers near route", str(b.get("barrier_count", 0))], ["Crossings", str(b.get("crossing_count", 0))],
                ["Unverified share", f"{b.get('unverified_fraction', 0):.0%}"],
                ["Assumptions", Paragraph("; ".join(b.get("assumptions", [])) or "-", BODY)],
                ["Missing data", Paragraph("; ".join(b.get("missing_data", [])) or "-", BODY)]]
        if r.materials:
            m = r.materials
            rows.append(["Material estimate", Paragraph(f"{m['directional_tiles']} directional + {m['warning_tiles']} warning tiles "
                                                        f"(incl. {m['waste_factor']:.0%} waste). {m['note']}", BODY)])
        if r.approved_by:
            rows.append(["Decision", f"{users[r.approved_by].display_name if r.approved_by in users else '-'} · {_fmt(r.approved_at)} · {r.review_note}"])
        s.append(Table(rows, colWidths=[40 * mm, 140 * mm], style=TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
                                                                              ("FONTSIZE", (0, 0), (-1, -1), 8)])))
    doc.build(s)
    return buf.getvalue()


def to_csv(header: list[str], rows: list[list]) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(header)
    w.writerows(rows)
    return out.getvalue()
