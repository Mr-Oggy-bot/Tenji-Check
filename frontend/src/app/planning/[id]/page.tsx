"use client";

import {
  Circle, Crosshair, DoorOpen, Expand, Flag, Footprints, Grid2x2, Hand, ImageUp, Layers, MousePointer2, Redo2, Route as RouteIcon,
  Ruler, Save, Sparkles, Spline, Square, SquareDashed, Trees, Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChecksPanel, ComparePanel, EstimatePanel, Legend, PropertiesPanel, SettingsPanel, VersionsPanel } from "@/components/planner/Panels";
import { type CanvasHandle, PlanCanvas, type Tool } from "@/components/planner/PlanCanvas";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Field, inputCls, Modal, Notice, Spinner } from "@/components/ui";
import { api, ApiError, downloadFile } from "@/lib/api";
import { FEATURE_META, dist } from "@/lib/planner/geometry";
import type { Analysis, FeatureType, LayoutOption, PlanDocument, PlanningProject, PlanSettings, Pt, ValidationItem, VersionSummary } from "@/lib/planner/types";

type Tab = "properties" | "checks" | "estimate" | "compare" | "versions" | "settings";

const TOOLS: { group: string; items: { tool: Tool; label: string; icon: React.ElementType; hint: string }[] }[] = [
  { group: "View", items: [
    { tool: "select", label: "Select", icon: MousePointer2, hint: "Click a shape to select it, drag to move it, drag handles to edit corners. Drag empty space to pan." },
    { tool: "pan", label: "Pan", icon: Hand, hint: "Drag to pan. Scroll to zoom." },
  ] },
  { group: "Site", items: [
    { tool: "feature:footpath", label: "Footpath", icon: SquareDashed, hint: "Click corners of the footpath; double-click or press Enter to finish." },
    { tool: "feature:boundary", label: "Boundary", icon: Square, hint: "Click corners of the site boundary; double-click to finish." },
    { tool: "feature:entrance", label: "Entrance", icon: DoorOpen, hint: "Click to mark an entrance." },
    { tool: "feature:destination", label: "Destination", icon: Flag, hint: "Click to mark a destination." },
    { tool: "feature:crossing", label: "Crossing", icon: Footprints, hint: "Click along the crossing edge; double-click to finish." },
    { tool: "feature:kerb", label: "Kerb", icon: Spline, hint: "Click along the kerb edge; double-click to finish." },
    { tool: "feature:stairs", label: "Stairs", icon: Layers, hint: "Click the corners of the stairs; double-click to finish." },
    { tool: "feature:tree", label: "Tree", icon: Trees, hint: "Click to place a tree (radius editable)." },
    { tool: "feature:pillar", label: "Pillar", icon: Circle, hint: "Click to place a pillar." },
    { tool: "feature:obstacle", label: "Obstacle", icon: Crosshair, hint: "Click to place a point obstacle." },
    { tool: "feature:obstacle_area", label: "Obstacle area", icon: Square, hint: "Click the corners of an obstacle area; double-click to finish." },
  ] },
  { group: "Tactile", items: [
    { tool: "route", label: "Route", icon: RouteIcon, hint: "Click along the route centreline (snaps to existing points; Shift for 45°). Double-click to finish." },
    { tool: "warning_rect", label: "Warning area", icon: Grid2x2, hint: "Drag a rectangle of warning tiles." },
    { tool: "warning_poly", label: "Warning polygon", icon: SquareDashed, hint: "Click corners of a warning area; double-click to finish." },
    { tool: "tile_directional", label: "Directional tile", icon: Square, hint: "Click to place a single directional tile." },
    { tool: "tile_warning", label: "Warning tile", icon: Square, hint: "Click to place a single warning tile." },
    { tool: "suggest", label: "Suggest route", icon: Sparkles, hint: "Click a start and an end point on the footpath to get a suggested clear route (editable)." },
  ] },
  { group: "Scale", items: [
    { tool: "calibrate", label: "Calibrate", icon: Ruler, hint: "Click both ends of a known dimension on the drawing, then enter its length." },
  ] },
];

export default function PlanningWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RoleGate roles={["admin", "inspector", "engineer", "contractor"]}>{() => <Workspace id={Number(id)} />}</RoleGate>;
}

function Workspace({ id }: { id: number }) {
  const toast = useToast();
  const canvasRef = useRef<CanvasHandle>(null);
  const [project, setProject] = useState<PlanningProject | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  const [settings, setSettings] = useState<PlanSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [past, setPast] = useState<PlanDocument[]>([]);
  const [future, setFuture] = useState<PlanDocument[]>([]);
  const committed = useRef<PlanDocument | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("checks");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [stale, setStale] = useState(false);
  const [showTiles, setShowTiles] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [focus, setFocus] = useState<Pt | null>(null);
  const [calib, setCalib] = useState<{ a: Pt; b: Pt } | null>(null);
  const [calibLen, setCalibLen] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftPts, setDraftPts] = useState(0);
  const readOnly = project?.access !== "owner";

  const load = useCallback(async () => {
    try {
      const p = await api<PlanningProject>(`/planning/projects/${id}`);
      setProject(p);
      setDoc(p.document!);
      committed.current = p.document!;
      setSettings(p.settings!);
      setRevision(p.revision);
      setDirty(false);
      setPast([]);
      setFuture([]);
    } catch (e) {
      setLoadErr(e instanceof ApiError ? e.message : "Could not load the planning project");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Site-plan image (fetched with the session token; never a public URL).
  useEffect(() => {
    let url: string | null = null;
    const imgId = doc?.site_image_id;
    if (!imgId) {
      setImageUrl(null);
      return;
    }
    api<Response>(`/planning/site-images/${imgId}/file`, { raw: true })
      .then((r) => r.blob())
      .then((b) => {
        url = URL.createObjectURL(b);
        setImageUrl(url);
      })
      .catch(() => setImageUrl(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [doc?.site_image_id]);

  // Checks and estimate follow the draft automatically.
  useEffect(() => {
    if (!doc || !project) return;
    setStale(true);
    const t = setTimeout(() => {
      api<Analysis>(`/planning/projects/${id}/analyze`, { body: readOnly ? {} : { document: doc, settings } })
        .then((a) => { setAnalysis(a); setStale(false); })
        .catch((e) => { setStale(false); if (e instanceof ApiError && e.status !== 0) toast.error(e.message); });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, settings, id, readOnly, project?.id]);

  const change = useCallback((next: PlanDocument, commit: boolean) => {
    if (readOnly) return;
    setDoc(next);
    setDirty(true);
    if (commit) {
      const prev = committed.current;
      if (prev && prev !== next) {
        setPast((p) => [...p.slice(-99), prev]);
        setFuture([]);
      }
      committed.current = next;
    }
  }, [readOnly]);

  const undo = useCallback(() => {
    if (!past.length || !doc) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((f) => [doc, ...f]);
    setDoc(prev);
    committed.current = prev;
    setDirty(true);
  }, [past, doc]);
  const redo = useCallback(() => {
    if (!future.length || !doc) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast((p) => [...p, doc]);
    setDoc(next);
    committed.current = next;
    setDirty(true);
  }, [future, doc]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!doc || readOnly) return false;
    setSaving(true);
    try {
      const r = await api<{ revision: number }>(`/planning/projects/${id}/document`, { method: "PUT", body: { document: doc, base_revision: revision } });
      setRevision(r.revision);
      setDirty(false);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "stale_revision") toast.error("This design was changed in another window. Reload the page to get the latest version.");
      else toast.error(e instanceof ApiError ? e.message : "Could not save");
      return false;
    } finally {
      setSaving(false);
    }
  }, [doc, id, revision, readOnly, toast]);

  const deleteSelected = useCallback(() => {
    if (!doc || !selected) return;
    change({
      ...doc,
      features: doc.features.filter((x) => x.id !== selected), routes: doc.routes.filter((x) => x.id !== selected),
      warning_areas: doc.warning_areas.filter((x) => x.id !== selected), tiles: doc.tiles.filter((x) => x.id !== selected),
    }, true);
    setSelected(null);
  }, [doc, selected, change]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((e.key === "Delete" || (e.key === "Backspace" && draftPts === 0)) && selected && !readOnly) { e.preventDefault(); deleteSelected(); }
      else if (e.key === "Escape" && draftPts === 0) setTool("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo, deleteSelected, selected, readOnly, draftPts]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function uploadImage(file: File | undefined) {
    if (!file || !doc) return;
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      const img = await api<{ id: number; width: number; height: number }>(`/planning/projects/${id}/site-image`, { form: fd });
      const keepScale = doc.scale.source === "calibrated" || doc.scale.source === "manual";
      change({ ...doc, site_image_id: img.id, canvas: { width: img.width, height: img.height },
        scale: keepScale ? doc.scale : { m_per_px: null, source: "none", calibration: null } }, true);
      toast.success(keepScale ? "Site plan added" : "Site plan added. Use Calibrate to set its scale from a known dimension.");
      if (!keepScale) setTool("calibrate");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onTwoPoints(kind: "calibrate" | "suggest", a: Pt, b: Pt) {
    if (!doc) return;
    if (kind === "calibrate") {
      setCalib({ a, b });
      setCalibLen("");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ points: Pt[]; length_m: number; min_clearance_m: number; note: string }>(`/planning/projects/${id}/suggest-route`,
        { body: { start: a, end: b, width_tiles: 1, document: doc } });
      const rid = `route-s${Date.now().toString(36)}`;
      change({ ...doc, routes: [...doc.routes, { id: rid, label: `Suggested route ${doc.routes.length + 1}`, points: r.points, width_tiles: 1 }] }, true);
      setSelected(rid);
      setTool("select");
      setTab("properties");
      toast.success(`Suggested route added: ${r.length_m} m, min clearance ${r.min_clearance_m} m. Edit it as needed.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No route could be suggested");
    } finally {
      setBusy(false);
    }
  }

  function applyCalibration() {
    if (!doc || !calib) return;
    const L = Number(calibLen);
    const dpx = dist(calib.a, calib.b);
    if (!(L > 0) || dpx < 2) return;
    change({ ...doc, scale: { m_per_px: L / dpx, source: "calibrated", calibration: { a: calib.a, b: calib.b, length_m: L } } }, true);
    setCalib(null);
    setTool("select");
    toast.success(`Scale set: ${((L / dpx) * 1000).toFixed(2)} mm per pixel`);
  }

  async function saveSettings(s: PlanSettings) {
    setBusy(true);
    try {
      const p = await api<PlanningProject>(`/planning/projects/${id}`, { method: "PATCH", body: { settings: s } });
      setSettings(p.settings!);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  async function refreshVersions() {
    const p = await api<PlanningProject>(`/planning/projects/${id}`);
    setProject((old) => (old ? { ...old, versions: p.versions, latest_version: p.latest_version } : p));
  }

  async function saveVersion(label: string) {
    setBusy(true);
    try {
      if (dirty && !(await save())) return;
      const v = await api<VersionSummary>(`/planning/projects/${id}/versions`, { body: { label } });
      toast.success(`Version v${v.number} saved`);
      await refreshVersions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save a version");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await refreshVersions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const focusItem = (i: ValidationItem) => {
    if (i.at) setFocus([...i.at] as Pt);
    if (i.ids[0]) setSelected(i.ids[0]);
  };

  const hint = useMemo(() => TOOLS.flatMap((g) => g.items).find((t) => t.tool === tool)?.hint ?? "", [tool]);
  const tileM = (settings?.tile_size_mm ?? 300) / 1000;

  if (loadErr) return <Notice tone="red">{loadErr} <Link className="underline" href="/planning">Back to planning</Link></Notice>;
  if (!project || !doc || !settings) return <Spinner />;
  const counts = analysis?.validation.counts;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/planning" className="text-xs font-semibold uppercase tracking-wider text-teal-600">Planning & Estimation</Link>
          <h1 className="text-2xl font-bold text-ink-900">{project.title}</h1>
          <p className="text-sm text-slate-600">{project.site_name || "No site name"}{readOnly && ` · by ${project.owner} · read-only review`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && <Badge tone={dirty ? "amber" : "green"}>{saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</Badge>}
          {counts && <Badge tone={counts.error ? "red" : counts.warning ? "amber" : "green"}>{counts.error ?? 0} errors · {counts.warning ?? 0} warnings · {counts.review ?? 0} review</Badge>}
          {!readOnly && (
            <>
              <Button variant="secondary" onClick={undo} disabled={!past.length} aria-label="Undo"><Undo2 className="h-4 w-4" aria-hidden /></Button>
              <Button variant="secondary" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 className="h-4 w-4" aria-hidden /></Button>
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-slate-50">
                <ImageUp className="h-4 w-4" aria-hidden /> Site plan
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { uploadImage(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <Button onClick={save} loading={saving} disabled={!dirty}><Save className="h-4 w-4" aria-hidden /> Save</Button>
            </>
          )}
        </div>
      </div>

      <Notice tone="amber">
        Planning support only. Checks flag likely problems and items for professional review; they do not establish compliance with any
        accessibility standard. Review thresholds are assumptions you can change in Settings.
      </Notice>
      {!doc.scale.m_per_px && <Notice tone="red" title="Scale not set">Use <strong>Calibrate</strong> on a known dimension of the drawing before checks and estimates can run.</Notice>}

      <div className="grid gap-3 xl:grid-cols-[170px_minmax(0,1fr)_380px]">
        {!readOnly ? (
          <nav aria-label="Drawing tools" className="space-y-3 rounded-xl border border-slate-200 bg-white p-2 shadow-card xl:max-h-[78vh] xl:overflow-y-auto">
            {TOOLS.map((g) => (
              <div key={g.group}>
                <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</p>
                <div className="grid grid-cols-3 gap-1 xl:grid-cols-1">
                  {g.items.map((t) => {
                    const Icon = t.icon;
                    const active = tool === t.tool;
                    const color = t.tool.startsWith("feature:") ? FEATURE_META[t.tool.slice(8) as FeatureType].color : undefined;
                    return (
                      <button key={t.tool} onClick={() => setTool(t.tool)} aria-pressed={active} title={t.hint}
                        className={`flex min-h-[36px] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium ${active ? "bg-teal-600 text-white" : "text-ink-900 hover:bg-slate-100"}`}>
                        <Icon className="h-4 w-4 shrink-0" aria-hidden style={!active && color ? { color } : undefined} /> {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        ) : <div className="hidden xl:block" />}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="min-w-0 flex-1" aria-live="polite">{readOnly ? "Read-only: select shapes to inspect them." : hint}</span>
            {draftPts > 0 && <Button variant="secondary" className="min-h-[32px] py-1" onClick={() => canvasRef.current?.finish()}>Finish shape</Button>}
            <label className="flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4" checked={showTiles} onChange={(e) => setShowTiles(e.target.checked)} /> Tile layout</label>
            <Button variant="ghost" className="min-h-[32px] px-2 py-1" aria-label="Zoom in" onClick={() => canvasRef.current?.zoom(1.25)}><ZoomIn className="h-4 w-4" /></Button>
            <Button variant="ghost" className="min-h-[32px] px-2 py-1" aria-label="Zoom out" onClick={() => canvasRef.current?.zoom(0.8)}><ZoomOut className="h-4 w-4" /></Button>
            <Button variant="ghost" className="min-h-[32px] px-2 py-1" aria-label="Fit drawing" onClick={() => canvasRef.current?.fit()}><Expand className="h-4 w-4" /></Button>
          </div>
          <div className="h-[62vh] overflow-hidden rounded-xl border border-slate-200 shadow-card xl:h-[74vh]">
            <PlanCanvas handleRef={canvasRef} doc={doc} onChange={change} tool={readOnly ? "select" : tool} selectedId={selected} onSelect={setSelected}
              imageUrl={imageUrl} cells={analysis?.estimate.cells ?? null} showTiles={showTiles} markers={analysis?.validation.items ?? []}
              focus={focus} tileSizeM={tileM} readOnly={readOnly} onTwoPoints={onTwoPoints} onDraftChange={setDraftPts} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card"><Legend /></div>
          {busy && <p className="text-xs text-slate-500" role="status">Working…</p>}
        </div>

        <aside className="rounded-xl border border-slate-200 bg-white shadow-card xl:max-h-[78vh] xl:overflow-y-auto">
          <div role="tablist" aria-label="Design panels" className="flex flex-wrap gap-1 border-b border-slate-100 p-2">
            {([["properties", "Properties"], ["checks", "Checks"], ["estimate", "Estimate"], ["compare", "Compare"], ["versions", "Versions & report"], ["settings", "Settings"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${tab === k ? "bg-ink-900 text-white" : "text-ink-800 hover:bg-slate-100"}`}>
                {l}{k === "checks" && counts && (counts.error || counts.warning) ? ` (${(counts.error ?? 0) + (counts.warning ?? 0)})` : ""}
              </button>
            ))}
          </div>
          <div className="p-3" role="tabpanel">
            {tab === "properties" && (
              <div className="space-y-4">
                <PropertiesPanel doc={doc} id={selected} onChange={(d) => change(d, true)} onDelete={deleteSelected} readOnly={readOnly} mPerPx={doc.scale.m_per_px} />
                <ScaleBox doc={doc} readOnly={readOnly} onChange={(d) => change(d, true)} />
              </div>
            )}
            {tab === "checks" && <ChecksPanel analysis={analysis} stale={stale} onFocus={focusItem} />}
            {tab === "estimate" && <EstimatePanel estimate={analysis?.estimate ?? null} />}
            {tab === "compare" && <ComparePanel rows={analysis?.comparison ?? []} current={doc.layout_option} currency={analysis?.estimate.currency}
              readOnly={readOnly} onUse={(o: LayoutOption) => change({ ...doc, layout_option: o }, true)} />}
            {tab === "versions" && (
              <VersionsPanel versions={project.versions ?? []} access={project.access} dirty={dirty} busy={busy} onSaveVersion={saveVersion}
                onSubmit={(v) => act(() => api(`/planning/versions/${v.id}/submit`, { method: "POST" }), `v${v.number} submitted for review`)}
                onReview={(v, decision, note) => act(() => api(`/planning/versions/${v.id}/review`, { body: { decision, note } }), `v${v.number} ${decision === "approve" ? "approved" : "rejected"}`)}
                onDownload={(v, kind) => downloadFile(`/planning/versions/${v.id}/${kind === "pdf" ? "report.pdf" : "estimate.csv"}`,
                  `tactile-plan-${project.id}-v${v.number}.${kind}`).catch(() => toast.error("Download failed"))} />
            )}
            {tab === "settings" && <SettingsPanel key={JSON.stringify(settings)} settings={settings} onSave={saveSettings} readOnly={readOnly} busy={busy} />}
          </div>
        </aside>
      </div>

      <Modal open={!!calib} onClose={() => setCalib(null)} title="Calibrate scale"
        footer={<><Button variant="ghost" onClick={() => setCalib(null)}>Cancel</Button><Button onClick={applyCalibration} disabled={!(Number(calibLen) > 0)}>Set scale</Button></>}>
        <p className="mb-3 text-sm text-slate-600">The two points are {calib ? dist(calib.a, calib.b).toFixed(0) : 0} pixels apart on the drawing. Enter the real distance between them.</p>
        <Field label="Real length (metres)">
          {(fid) => <input id={fid} type="number" min={0.01} step={0.01} autoFocus className={inputCls} value={calibLen}
            onChange={(e) => setCalibLen(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyCalibration()} />}
        </Field>
      </Modal>
    </div>
  );
}

function ScaleBox({ doc, readOnly, onChange }: { doc: PlanDocument; readOnly: boolean; onChange: (d: PlanDocument) => void }) {
  const [mm, setMm] = useState(doc.scale.m_per_px ? String(+(doc.scale.m_per_px * 1000).toFixed(3)) : "");
  useEffect(() => setMm(doc.scale.m_per_px ? String(+(doc.scale.m_per_px * 1000).toFixed(3)) : ""), [doc.scale.m_per_px]);
  const size = doc.scale.m_per_px ? `${(doc.canvas.width * doc.scale.m_per_px).toFixed(1)} × ${(doc.canvas.height * doc.scale.m_per_px).toFixed(1)} m` : "unknown size";
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-semibold text-ink-900">Drawing scale</p>
      <p className="text-xs text-slate-600">
        {doc.scale.m_per_px ? `${(doc.scale.m_per_px * 1000).toFixed(2)} mm per pixel (${doc.scale.source}${doc.scale.calibration ? `, from a ${doc.scale.calibration.length_m} m reference` : ""}).` : "Not set."}
        {" "}Drawing area {size}.
      </p>
      {!readOnly && (
        <form className="flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          const v = Number(mm);
          if (v > 0) onChange({ ...doc, scale: { m_per_px: v / 1000, source: "manual", calibration: null } });
        }}>
          <input aria-label="Millimetres per pixel" type="number" min={0.01} step={0.01} className={inputCls} value={mm} onChange={(e) => setMm(e.target.value)} />
          <Button type="submit" variant="secondary">Set mm/px</Button>
        </form>
      )}
    </div>
  );
}
