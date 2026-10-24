"use client";

import { CheckCircle2, Download, FileText, Send, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Field, inputCls, Notice } from "@/components/ui";
import type { Tone } from "@/lib/labels";
import { FEATURE_META, TILE_COLORS } from "@/lib/planner/geometry";
import type { Analysis, ComparisonRow, Estimate, LayoutOption, PlanDocument, PlanSettings, ValidationItem, VersionSummary } from "@/lib/planner/types";

export const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  error: { label: "Error", tone: "red" }, warning: { label: "Warning", tone: "amber" },
  review: { label: "Needs professional review", tone: "violet" }, info: { label: "Info", tone: "slate" },
};
export const VERSION_STATUS: Record<string, { label: string; tone: Tone }> = {
  saved: { label: "Saved", tone: "slate" }, submitted: { label: "Awaiting review", tone: "blue" },
  approved: { label: "Approved", tone: "green" }, rejected: { label: "Rejected", tone: "red" },
};

export function Legend() {
  const sw = (bg: string, extra = "") => <span className={`inline-block h-3 w-5 rounded-sm border border-slate-400 ${extra}`} style={{ background: bg }} />;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700" aria-label="Legend">
      <li className="flex items-center gap-1.5">{sw(TILE_COLORS.directional.whole)} Directional tile</li>
      <li className="flex items-center gap-1.5">{sw(TILE_COLORS.directional.cut)} Directional, cut</li>
      <li className="flex items-center gap-1.5">{sw(TILE_COLORS.warning.whole)} Warning tile</li>
      <li className="flex items-center gap-1.5">{sw(TILE_COLORS.warning.cut)} Warning, cut</li>
      <li className="flex items-center gap-1.5">{sw("rgba(37,99,235,0.55)")} Route strip (design)</li>
      <li className="flex items-center gap-1.5">{sw("#facc15")} Warning area (design)</li>
      {(["footpath", "stairs", "kerb", "crossing", "tree", "pillar", "obstacle", "entrance", "destination"] as const).map((t) => (
        <li key={t} className="flex items-center gap-1.5">{sw(FEATURE_META[t].fill ?? FEATURE_META[t].color)} {FEATURE_META[t].label}</li>
      ))}
    </ul>
  );
}

export function PropertiesPanel({ doc, id, onChange, onDelete, readOnly, mPerPx }: {
  doc: PlanDocument; id: string | null; onChange: (d: PlanDocument) => void; onDelete: () => void; readOnly: boolean; mPerPx: number | null;
}) {
  if (!id) return <p className="text-sm text-slate-500">Select a shape to edit it. Drag shapes to move them, drag the square handles to move corners, and drag the round handles to add a corner.</p>;
  const f = doc.features.find((x) => x.id === id);
  const r = doc.routes.find((x) => x.id === id);
  const w = doc.warning_areas.find((x) => x.id === id);
  const t = doc.tiles.find((x) => x.id === id);
  const pts = f?.points ?? r?.points ?? w?.points;
  const length = pts && mPerPx && pts.length > 1
    ? pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0) * mPerPx : null;
  const kind = f ? FEATURE_META[f.type].label : r ? "Tactile route (directional)" : w ? "Warning tile area" : t ? `Single ${t.type} tile` : "";
  const setLabel = (label: string) => onChange({
    ...doc,
    features: doc.features.map((x) => (x.id === id ? { ...x, label } : x)),
    routes: doc.routes.map((x) => (x.id === id ? { ...x, label } : x)),
    warning_areas: doc.warning_areas.map((x) => (x.id === id ? { ...x, label } : x)),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-ink-900">{kind}</p>
      {!t && (
        <Field label="Label">{(fid) => <input id={fid} className={inputCls} disabled={readOnly} value={(f ?? r ?? w)?.label ?? ""} onChange={(e) => setLabel(e.target.value)} />}</Field>
      )}
      {r && (
        <Field label="Strip width" hint="Whole tiles across the direction of travel.">
          {(fid) => (
            <select id={fid} className={inputCls} disabled={readOnly} value={r.width_tiles}
              onChange={(e) => onChange({ ...doc, routes: doc.routes.map((x) => (x.id === id ? { ...x, width_tiles: Number(e.target.value) } : x)) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} tile{n > 1 ? "s" : ""}</option>)}
            </select>
          )}
        </Field>
      )}
      {f && FEATURE_META[f.type].radius && (
        <Field label="Radius (m)" hint="Footprint used for clash and clearance checks.">
          {(fid) => <input id={fid} type="number" min={0.05} max={20} step={0.05} className={inputCls} disabled={readOnly}
            value={f.radius_m ?? FEATURE_META[f.type].radius}
            onChange={(e) => onChange({ ...doc, features: doc.features.map((x) => (x.id === id ? { ...x, radius_m: Number(e.target.value) || null } : x)) })} />}
        </Field>
      )}
      {(w || t) && (
        <Field label="Tile grid angle (degrees)" hint={w ? "Leave empty to align with the area's longest edge." : undefined}>
          {(fid) => <input id={fid} type="number" step={5} className={inputCls} disabled={readOnly}
            value={(w ? w.angle_deg : t!.angle_deg) ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              onChange(w
                ? { ...doc, warning_areas: doc.warning_areas.map((x) => (x.id === id ? { ...x, angle_deg: v } : x)) }
                : { ...doc, tiles: doc.tiles.map((x) => (x.id === id ? { ...x, angle_deg: v ?? 0 } : x)) });
            }} />}
        </Field>
      )}
      {length != null && <p className="text-xs text-slate-600">{w || (f && FEATURE_META[f.type].geometry === "polygon") ? "Perimeter (open)" : "Length"}: {length.toFixed(2)} m · {pts!.length} points</p>}
      {!readOnly && <Button variant="danger" onClick={onDelete}><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>}
    </div>
  );
}

export function ChecksPanel({ analysis, stale, onFocus }: { analysis: Analysis | null; stale: boolean; onFocus: (i: ValidationItem) => void }) {
  if (!analysis) return <p className="text-sm text-slate-500">Checks run automatically after each change.</p>;
  const v = analysis.validation;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(SEVERITY).map(([k, s]) => <Badge key={k} tone={s.tone}>{v.counts[k] ?? 0} {s.label.toLowerCase()}</Badge>)}
        {stale && <Badge tone="slate">updating…</Badge>}
      </div>
      {v.items.length === 0 && <p className="flex items-center gap-1.5 text-sm text-teal-800"><CheckCircle2 className="h-4 w-4" aria-hidden /> No issues found by the automated checks.</p>}
      <ul className="space-y-2">
        {v.items.map((i, n) => (
          <li key={n}>
            <button onClick={() => onFocus(i)} className="w-full rounded-lg border border-slate-200 p-2 text-left text-sm hover:border-teal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
              <Badge tone={SEVERITY[i.severity].tone}>{SEVERITY[i.severity].label}</Badge>
              <span className="mt-1 block text-ink-900">{i.message}</span>
              {i.reference && <span className="mt-0.5 block text-xs text-slate-500">See: {i.reference} (reference pending confirmation)</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">{v.statement}</p>
    </div>
  );
}

const money = (v: number, cur?: string) => `${cur ?? ""} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

export function EstimatePanel({ estimate }: { estimate: Estimate | null }) {
  if (!estimate) return <p className="text-sm text-slate-500">The estimate appears once a route or warning area is drawn.</p>;
  if (!estimate.ok) return <Notice tone="amber">{estimate.reason}</Notice>;
  const bt = estimate.by_type!;
  const rows: [string, (t: typeof bt.directional) => React.ReactNode][] = [
    ["Paving area", (t) => `${t.area_m2.toFixed(2)} m²`],
    ["Whole tiles", (t) => t.whole_tiles],
    ["Cut pieces", (t) => t.cut_pieces],
    ["· from new tiles", (t) => t.new_tiles_for_cuts],
    ["· from reused offcuts", (t) => t.pieces_from_offcuts],
    ["· slivers (review)", (t) => t.sliver_pieces],
    ["Tiles required", (t) => <strong>{t.tiles_required}</strong>],
    ["Spare allowance", (t) => t.spare_tiles],
    ["Packs", (t) => `${t.packs} × ${t.pack_size}`],
    ["Purchase quantity", (t) => <strong>{t.purchase_tiles}</strong>],
    ["Reusable offcuts left", (t) => t.leftover_offcuts],
    ["Waste", (t) => `${t.waste_area_m2.toFixed(3)} m² (${t.waste_pct}%)`],
    ["Material cost", (t) => money(t.material_cost, estimate.currency)],
    ["Cutting cost", (t) => money(t.cutting_cost, estimate.currency)],
    ["Area ÷ tile area", (t) => t.naive_area_estimate_tiles],
  ];
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium" /><th className="py-1 font-medium">Directional</th><th className="py-1 font-medium">Warning</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([label, f]) => (
              <tr key={label}><td className="py-1 pr-2 text-slate-600">{label}</td><td className="py-1 tabular-nums">{f(bt.directional)}</td><td className="py-1 tabular-nums">{f(bt.warning)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-base font-semibold text-ink-900">Total {money(estimate.totals!.total_cost, estimate.currency)}</p>
      <p className="text-xs text-slate-500">&quot;Area ÷ tile area&quot; is shown only for comparison: the estimate counts each tile and cut from the actual layout ({estimate.tile_size_mm} mm tiles, layout &quot;{estimate.layout_option}&quot;, {estimate.engine_version}).</p>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-ink-900">Assumptions</summary>
        <ul className="mt-1 list-disc space-y-1 pl-4">{estimate.assumptions!.map((a) => <li key={a}>{a}</li>)}</ul>
      </details>
    </div>
  );
}

export function ComparePanel({ rows, current, currency, onUse, readOnly }: { rows: ComparisonRow[]; current: LayoutOption; currency?: string; onUse: (o: LayoutOption) => void; readOnly: boolean }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Draw a route or warning area and calibrate the scale to compare layouts.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">Each option moves only where the tile grid starts. The covered area, strip widths and warning areas are identical, so no option removes an accessibility feature to save material.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Option</th><th>Tiles</th><th>Cuts</th><th>Slivers</th><th>Waste</th><th>Cost</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.option} className={r.option === current ? "bg-teal-50" : ""}>
                <td className="py-1.5 pr-1 font-medium">{r.option}{r.recommended && <Badge tone="green" className="ml-1">least waste</Badge>}</td>
                <td className="tabular-nums">{r.tiles_required.directional + r.tiles_required.warning}</td>
                <td className="tabular-nums">{r.cut_pieces}</td>
                <td className="tabular-nums">{r.slivers}</td>
                <td className="tabular-nums">{r.waste_area_m2.toFixed(2)} m²{r.waste_vs_start_m2 ? <span className="block text-[11px] text-slate-500">{r.waste_vs_start_m2 > 0 ? "+" : ""}{r.waste_vs_start_m2.toFixed(2)}</span> : null}</td>
                <td className="tabular-nums">{money(r.total_cost, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-1 text-xs text-slate-600">{rows.map((r) => <li key={r.option}><strong>{r.option}</strong>: {r.description}</li>)}</ul>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {rows.filter((r) => r.valid).map((r) => (
            <Button key={r.option} variant={r.option === current ? "success" : "secondary"} onClick={() => onUse(r.option)} disabled={r.option === current}>
              {r.option === current ? `Using ${r.option}` : `Use ${r.option}`}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ settings, onSave, readOnly, busy }: { settings: PlanSettings; onSave: (s: PlanSettings) => void; readOnly: boolean; busy: boolean }) {
  const [s, setS] = useState(settings);
  const num = (k: keyof PlanSettings, label: string, step = 1, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => <input id={id} type="number" step={step} className={inputCls} disabled={readOnly} value={s[k] as number}
        onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />}
    </Field>
  );
  const price = (t: "directional" | "warning", k: "pack_size" | "price_per_pack" | "supplier", label: string) => (
    <Field label={label}>
      {(id) => <input id={id} type={k === "supplier" ? "text" : "number"} className={inputCls} disabled={readOnly} value={s.prices[t][k]}
        onChange={(e) => setS({ ...s, prices: { ...s.prices, [t]: { ...s.prices[t], [k]: k === "supplier" ? e.target.value : Number(e.target.value) } } })} />}
    </Field>
  );
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(s); }}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tiles and cutting</p>
      <div className="grid grid-cols-2 gap-2">
        {num("tile_size_mm", "Tile size (mm)", 10)}
        {num("kerf_mm", "Saw kerf (mm)")}
        {num("min_offcut_mm", "Min. reusable offcut (mm)", 5)}
        {num("sliver_fraction", "Sliver threshold (fraction)", 0.01)}
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" disabled={readOnly} checked={s.reuse_offcuts} onChange={(e) => setS({ ...s, reuse_offcuts: e.target.checked })} /> Reuse offcuts for other cut pieces</label>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allowances and prices</p>
      <div className="grid grid-cols-2 gap-2">
        {num("spare_pct", "Spare allowance (%)", 0.5)}
        {num("min_spare_tiles", "Min. spare per type")}
        <Field label="Currency">{(id) => <input id={id} className={inputCls} disabled={readOnly} maxLength={8} value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })} />}</Field>
        {num("cut_cost_per_cut", "Cost per cut", 0.5)}
      </div>
      {(["directional", "warning"] as const).map((t) => (
        <fieldset key={t} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-2">
          <legend className="px-1 text-xs font-semibold capitalize text-ink-900">{t} tiles</legend>
          {price(t, "pack_size", "Tiles per pack")}
          {price(t, "price_per_pack", "Price per pack")}
          <div className="col-span-2">{price(t, "supplier", "Supplier")}</div>
        </fieldset>
      ))}
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review thresholds (assumptions, not clause values)</p>
      <div className="grid grid-cols-2 gap-2">
        {num("clearance_m", "Obstacle clearance (m)", 0.05)}
        {num("hazard_approach_m", "Hazard approach (m)", 0.1)}
        {num("min_warning_depth_m", "Min. warning depth (m)", 0.05)}
        {num("turn_review_deg", "Turn review angle (°)", 5)}
      </div>
      {!readOnly && <Button type="submit" loading={busy}>Save settings</Button>}
    </form>
  );
}

export function VersionsPanel({ versions, access, dirty, busy, onSaveVersion, onSubmit, onReview, onDownload }: {
  versions: VersionSummary[]; access: "owner" | "reviewer"; dirty: boolean; busy: boolean;
  onSaveVersion: (label: string) => void; onSubmit: (v: VersionSummary) => void;
  onReview: (v: VersionSummary, decision: "approve" | "reject", note: string) => void; onDownload: (v: VersionSummary, kind: "pdf" | "csv") => void;
}) {
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  return (
    <div className="space-y-3">
      {access === "owner" && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSaveVersion(label); setLabel(""); }}>
          <input aria-label="Version label" className={inputCls} placeholder="Version label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" loading={busy}>Save version</Button>
        </form>
      )}
      {access === "owner" && dirty && <p className="text-xs text-slate-500">Unsaved changes are saved first.</p>}
      {!versions.length && <p className="text-sm text-slate-500">No versions yet. A version freezes the design with its checks and estimate for the report and review.</p>}
      <ul className="space-y-2">
        {[...versions].reverse().map((v) => (
          <li key={v.id} className="rounded-lg border border-slate-200 p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">v{v.number}{v.label && ` · ${v.label}`}</span>
              <Badge tone={VERSION_STATUS[v.status].tone}>{VERSION_STATUS[v.status].label}</Badge>
            </div>
            <p className="text-xs text-slate-500">{v.created_by} · {new Date(v.created_at).toLocaleString()} · {v.counts.error ?? 0} errors, {v.counts.warning ?? 0} warnings, {v.counts.review ?? 0} review
              {v.total_cost != null && ` · ${money(v.total_cost, v.currency ?? "")}`}</p>
            {v.reviews.map((r, i) => <p key={i} className="text-xs text-slate-600">{r.reviewer}: {r.decision}{r.note && ` – ${r.note}`}</p>)}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onDownload(v, "pdf")}><FileText className="h-4 w-4" aria-hidden /> Report PDF</Button>
              <Button variant="ghost" onClick={() => onDownload(v, "csv")}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
              {access === "owner" && v.status === "saved" && <Button variant="secondary" onClick={() => onSubmit(v)}><Send className="h-4 w-4" aria-hidden /> Submit for review</Button>}
            </div>
            {access === "reviewer" && v.status === "submitted" && (
              <div className="mt-2 space-y-2">
                <textarea aria-label={`Review note for v${v.number}`} className={inputCls} rows={2} placeholder="Review note (required to reject)"
                  value={notes[v.id] ?? ""} onChange={(e) => setNotes({ ...notes, [v.id]: e.target.value })} />
                <div className="flex gap-2">
                  <Button variant="success" onClick={() => onReview(v, "approve", notes[v.id] ?? "")}><ThumbsUp className="h-4 w-4" aria-hidden /> Approve</Button>
                  <Button variant="danger" onClick={() => onReview(v, "reject", notes[v.id] ?? "")}><ThumbsDown className="h-4 w-4" aria-hidden /> Reject</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
