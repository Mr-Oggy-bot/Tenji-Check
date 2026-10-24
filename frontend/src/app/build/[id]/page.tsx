"use client";

import { Download, FileText, MapPin, Pause, Play, Route, Send, Square } from "lucide-react";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type MapMarker, MapView } from "@/components/MapView";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, DemoBadge, Field, inputCls, Modal, Notice, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api, ApiError, downloadFile } from "@/lib/api";
import { DEFAULT_CENTER, getPosition, haversine } from "@/lib/geo";
import { fmtDate, OBSERVATION_LABEL, ROUTE_STATUS, SURVEY_STATUS } from "@/lib/labels";
import type { RouteCandidate, Survey, User } from "@/lib/types";

const OBS_COLOR: Record<string, string> = {
  obstacle: "#dc2626", crossing: "#2563eb", kerb_ramp: "#7c3aed", candidate_segment: "#16a885",
  existing_tactile: "#e8ad12", drain_or_utility: "#ea580c", uncertain: "#64748b", note: "#0f172a",
};
const ROUTE_COLORS = ["#16a885", "#7c3aed", "#ea580c"];
const MIN_SPACING_M = 3;
const MIN_INTERVAL_MS = 10_000;

type PickMode = "" | "observation" | "start" | "end";

export default function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RoleGate roles={["admin", "inspector", "engineer", "contractor"]}>{(u) => <Workspace id={Number(id)} user={u} />}</RoleGate>;
}

function Workspace({ id, user }: { id: number; user: User }) {
  const toast = useToast();
  const [s, setS] = useState<Survey | null>(null);
  const [err, setErr] = useState("");
  const [tracking, setTracking] = useState(false);
  const [lastFix, setLastFix] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(null);
  const [gpsErr, setGpsErr] = useState("");
  const [pick, setPick] = useState<PickMode>("");
  const [obsDraft, setObsDraft] = useState<{ lat: number; lon: number; accuracy: number | null; source: "gps" | "manual" } | null>(null);
  const [start, setStart] = useState<[number, number] | null>(null);
  const [end, setEnd] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [decision, setDecision] = useState<{ kind: "route" | "survey"; id: number; decision: "approve" | "reject" } | null>(null);
  const watchRef = useRef<number | null>(null);
  const buffer = useRef<{ lat: number; lon: number; accuracy_m: number | null; recorded_at: string }[]>([]);
  const lastKept = useRef<{ lat: number; lon: number; t: number } | null>(null);

  const load = useCallback(() => api<Survey>(`/surveys/${id}`).then(setS).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const owner = s?.owner_id === user.id || user.role === "admin";
  const editable = owner && s && ["recording", "draft"].includes(s.status);
  const approver = ["engineer", "inspector", "admin"].includes(user.role) && (s?.owner_id !== user.id || user.role === "admin");

  const flush = useCallback(async () => {
    if (!buffer.current.length) return;
    const points = buffer.current.splice(0);
    try {
      await api(`/surveys/${id}/track`, { body: { points } });
      load();
    } catch (e) {
      buffer.current.unshift(...points);
      if (!(e instanceof ApiError && e.status === 0)) toast.error(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, load]);

  function startTracking() {
    if (!("geolocation" in navigator)) return setGpsErr("GPS is not available on this device. Add observations with manual pins instead.");
    setGpsErr("");
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
        setLastFix(fix);
        const prev = lastKept.current;
        const now = Date.now();
        if (prev && haversine([prev.lat, prev.lon], [fix.lat, fix.lon]) < MIN_SPACING_M && now - prev.t < MIN_INTERVAL_MS) return;
        lastKept.current = { ...fix, t: now };
        buffer.current.push({ lat: fix.lat, lon: fix.lon, accuracy_m: fix.accuracy, recorded_at: new Date(p.timestamp).toISOString() });
        if (buffer.current.length >= 5) flush();
      },
      (e) => { setGpsErr(e.code === e.PERMISSION_DENIED ? "Location permission denied. You can still add observations with manual pins." : "GPS signal lost. Waiting for a fix…"); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    setTracking(true);
  }
  const stopTracking = useCallback(() => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setTracking(false);
    flush();
  }, [flush]);
  useEffect(() => {
    const t = setInterval(() => tracking && flush(), 15000);
    return () => clearInterval(t);
  }, [tracking, flush]);
  useEffect(() => () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current); }, []);

  async function post(path: string, body: unknown, msg: string) {
    try {
      const r = await api<Survey>(`/surveys/${id}/${path}`, { body });
      if (r && typeof r === "object" && "id" in r) setS(r);
      toast.success(msg);
      load();
    } catch (e) { toast.error(e); }
  }

  async function addObsAtGps() {
    try {
      const f = await getPosition();
      setObsDraft({ lat: f.lat, lon: f.lon, accuracy: f.accuracy, source: "gps" });
    } catch (e) {
      toast.error(e);
      setPick("observation");
    }
  }

  async function movePin(obsId: number, lat: number, lon: number) {
    try {
      await api(`/surveys/${id}/observations/${obsId}`, { method: "PATCH", body: { lat, lon } });
      toast.success("Pin moved (recorded as corrected)");
      load();
    } catch (e) { toast.error(e); load(); }
  }

  async function deletePoint(pid: number) {
    try {
      await api(`/surveys/${id}/track/${pid}`, { method: "DELETE" });
      toast.success("GPS point removed");
      load();
    } catch (e) { toast.error(e); }
  }

  const routes = s?.routes || [];
  const latestBatch = routes.length ? Math.max(...routes.map((r) => r.batch)) : 0;
  const shownRoutes = routes.filter((r) => r.batch === latestBatch || r.approval_status === "approved");

  const markers: MapMarker[] = useMemo(() => {
    if (!s) return [];
    const m: MapMarker[] = [];
    s.track?.forEach((p, i) => m.push({
      id: `t${p.id}`, lat: p.lat, lon: p.lon, color: "#0b1d2a", radius: 3,
      label: `GPS point ${i + 1}${p.accuracy_m ? ` ±${Math.round(p.accuracy_m)} m` : ""}${editable ? " (click to remove as drift)" : ""}`,
      onClick: editable ? () => { if (confirm("Remove this GPS point as drift?")) deletePoint(p.id); } : undefined,
    }));
    s.observations?.forEach((o) => m.push({
      id: `o${o.id}`, lat: o.lat, lon: o.lon, color: OBS_COLOR[o.observation_type] || "#0f172a", draggable: !!editable,
      label: `${OBSERVATION_LABEL[o.observation_type]}${o.note ? `: ${o.note}` : ""} (${o.location_source})`,
      onDragEnd: (lat, lon) => movePin(o.id, lat, lon),
    }));
    if (start) m.push({ id: "start", lat: start[0], lon: start[1], color: "#16a885", label: "Route start", radius: 10 });
    if (end) m.push({ id: "end", lat: end[0], lon: end[1], color: "#dc2626", label: "Route end", radius: 10 });
    if (lastFix && tracking) m.push({ id: "me", lat: lastFix.lat, lon: lastFix.lon, color: "#2563eb", label: "You", radius: 7 });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, start, end, lastFix, tracking, editable]);

  const lines = useMemo(() => {
    const l = [];
    if (s?.track && s.track.length > 1) l.push({ points: s.track.map((p) => [p.lat, p.lon] as [number, number]), color: "#0b1d2a", weight: 3, label: "Recorded GPS track" });
    shownRoutes.forEach((r, i) => l.push({
      points: r.geometry, color: ROUTE_COLORS[i % 3], weight: selected === r.id ? 8 : 5, dashed: r.approval_status !== "approved",
      label: `Route ${r.rank}: ${Math.round(r.distance_m)} m · ${ROUTE_STATUS[r.approval_status]?.label}`,
    }));
    return l;
  }, [s, shownRoutes, selected]);

  if (err) return <Notice tone="red">{err}</Notice>;
  if (!s) return <Spinner />;
  const center: [number, number] = s.track?.[0] ? [s.track[0].lat, s.track[0].lon] : s.observations?.[0] ? [s.observations[0].lat, s.observations[0].lon] : DEFAULT_CENTER;
  const fitPts = [...(s.track || []).map((p) => [p.lat, p.lon] as [number, number]), ...(s.observations || []).map((o) => [o.lat, o.lon] as [number, number])];

  return (
    <>
      <PageHeader eyebrow="Build · site survey" title={s.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} map={SURVEY_STATUS} /> by {s.created_by} · {fmtDate(s.started_at)} <DemoBadge show={s.is_demo} /></span>}
        actions={<>
          <Button variant="secondary" onClick={() => downloadFile(`/surveys/${id}/export.csv`, `survey-${id}.csv`).catch(toast.error)}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="secondary" onClick={() => downloadFile(`/surveys/${id}/export.pdf`, `survey-${id}.pdf`, true).catch(toast.error)}><FileText className="h-4 w-4" /> PDF</Button>
          {owner && s.status === "draft" && <Button onClick={() => post("submit", {}, "Submitted for engineering approval")}><Send className="h-4 w-4" /> Submit for approval</Button>}
          {approver && s.status === "submitted" && <>
            <Button variant="success" onClick={() => setDecision({ kind: "survey", id: s.id, decision: "approve" })}>Approve survey</Button>
            <Button variant="secondary" onClick={() => setDecision({ kind: "survey", id: s.id, decision: "reject" })}>Reject</Button>
          </>}
        </>} />
      {s.review_note && <div className="mb-4"><Notice tone="slate" title={`Reviewed by ${s.reviewed_by}`}>{s.review_note}</Notice></div>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {pick && <Notice tone="teal">Tap the map to place the {pick === "observation" ? "observation pin" : `route ${pick}`}. <button className="underline" onClick={() => setPick("")}>Cancel</button></Notice>}
          <MapView center={center} zoom={17} height={480} markers={markers} lines={lines} fit={fitPts.length ? fitPts : undefined} fitKey={`${s.id}-${s.point_count}-${s.observation_count}`}
            onMapClick={(lat, lon) => {
              if (pick === "observation") setObsDraft({ lat, lon, accuracy: null, source: "manual" });
              else if (pick === "start") setStart([lat, lon]);
              else if (pick === "end") setEnd([lat, lon]);
              setPick("");
            }} />
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1"><span className="inline-block h-1 w-5 bg-ink-900" /> GPS track</span>
            {Object.entries(OBS_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} />{OBSERVATION_LABEL[k]}</span>)}
            <span>Dashed routes are drafts awaiting engineer review.</span>
          </div>

          {(s.routes?.length || 0) > 0 && (
            <Card title="Candidate corridors">
              <div className="grid gap-3 md:grid-cols-3">
                {shownRoutes.map((r, i) => <RouteCard key={r.id} r={r} color={ROUTE_COLORS[i % 3]} selected={selected === r.id} onSelect={() => setSelected(r.id)}
                  canDecide={approver && r.approval_status === "draft"} onDecide={(d) => setDecision({ kind: "route", id: r.id, decision: d })} />)}
              </div>
              <p className="mt-3 text-xs text-slate-500">Routes are proposals for engineer review, not verified accessible paths. Unknown map segments are penalised, never assumed accessible.</p>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {s.status === "recording" && owner && (
            <Card title="Record the walk">
              <div className="space-y-3">
                {!tracking ? <Button onClick={startTracking} className="w-full"><Play className="h-4 w-4" /> Start GPS tracking</Button>
                  : <Button variant="secondary" onClick={stopTracking} className="w-full"><Pause className="h-4 w-4" /> Pause tracking</Button>}
                {lastFix && <p className="text-xs text-slate-600" aria-live="polite">Last fix ±{Math.round(lastFix.accuracy ?? 0)} m{(lastFix.accuracy ?? 0) > 25 ? " — poor accuracy, points may be dropped" : ""}</p>}
                {gpsErr && <Notice>{gpsErr}</Notice>}
                <p className="text-xs text-slate-500">Keep this screen open while walking; browsers may pause tracking in the background. Points are sampled every {MIN_SPACING_M} m / {MIN_INTERVAL_MS / 1000} s; fixes worse than ±60 m are dropped by the server.</p>
                <Button variant="secondary" onClick={() => { stopTracking(); post("finish", {}, "Recording finished"); }} className="w-full"><Square className="h-4 w-4" /> Finish recording</Button>
              </div>
            </Card>
          )}
          {owner && ["draft", "rejected"].includes(s.status) && (
            <Button variant="secondary" className="w-full" onClick={() => post("reopen", {}, "Recording reopened")}>Reopen for recording</Button>
          )}
          {editable && (
            <Card title="Add observation">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={addObsAtGps}><MapPin className="h-4 w-4" /> At my location</Button>
                <Button variant="secondary" onClick={() => setPick("observation")}>Pick on map</Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Drag existing pins on the map to correct GPS drift.</p>
            </Card>
          )}
          <Card title="Generate corridors">
            <RouteForm surveyId={id} start={start} end={end} onPick={setPick} disabled={!s.track?.length && !start}
              onDone={(rs) => { setSelected(rs[0]?.id ?? null); load(); }} />
          </Card>
          <Card title={`Observations (${s.observations?.length || 0})`}>
            <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
              {s.observations?.map((o) => (
                <li key={o.id} className="flex gap-2">
                  <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: OBS_COLOR[o.observation_type] }} />
                  <span><strong>{OBSERVATION_LABEL[o.observation_type]}</strong> <Badge tone="slate">{o.location_source}</Badge>{o.accuracy_m ? <span className="text-xs text-slate-500"> ±{Math.round(o.accuracy_m)} m</span> : null}
                    {o.note && <span className="block text-slate-600">{o.note}</span>}
                    {o.media && <a href={o.media.url} target="_blank" rel="noreferrer" className="text-xs text-teal-700 underline">Photo</a>}</span>
                </li>
              ))}
              {!s.observations?.length && <li className="text-slate-500">None yet.</li>}
            </ul>
          </Card>
        </div>
      </div>

      {obsDraft && <ObservationModal surveyId={id} draft={obsDraft} onClose={() => setObsDraft(null)} onDone={() => { setObsDraft(null); load(); toast.success("Observation added"); }} />}
      {decision && <DecisionModal d={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); load(); }} />}
    </>
  );
}

function RouteCard({ r, color, selected, onSelect, canDecide, onDecide }: { r: RouteCandidate; color: string; selected: boolean; onSelect: () => void; canDecide: boolean; onDecide: (d: "approve" | "reject") => void }) {
  const b = r.score_breakdown;
  return (
    <div className={`rounded-lg border p-3 text-sm ${selected ? "border-teal-500 ring-2 ring-teal-500/30" : "border-slate-200"}`}>
      <button onClick={onSelect} className="w-full text-left">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="flex items-center gap-2 whitespace-nowrap font-semibold"><span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />Route {r.rank}</span>
          <StatusBadge status={r.approval_status} map={ROUTE_STATUS} />
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
          <dt className="text-slate-500">Distance</dt><dd>{Math.round(r.distance_m)} m</dd>
          <dt className="text-slate-500">Score</dt><dd>{r.score.toFixed(0)}</dd>
          <dt className="text-slate-500">Barriers</dt><dd>{b.barrier_count}</dd>
          <dt className="text-slate-500">Crossings</dt><dd>{b.crossing_count}</dd>
          <dt className="text-slate-500">Unverified</dt><dd>{Math.round(b.unverified_fraction * 100)}%</dd>
          <dt className="text-slate-500">Turns</dt><dd>{b.turns}</dd>
        </dl>
      </button>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-teal-700">Cost breakdown &amp; materials</summary>
        <ul className="mt-1 space-y-0.5">{Object.entries(b.costs).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
        {b.barriers.length > 0 && <p className="mt-1">Near: {b.barriers.join(", ")}</p>}
        {b.missing_data.length > 0 && <div className="mt-1 text-amber-800">Missing data:<ul className="list-disc pl-4">{b.missing_data.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <p className="mt-1 text-slate-500">{b.assumptions.join(" · ")}</p>
        {r.materials && <p className="mt-2 rounded bg-slate-50 p-2"><strong>Estimate:</strong> {r.materials.directional_tiles} directional + {r.materials.warning_tiles} warning tiles ({r.materials.warning_bands} warning bands, {Math.round(r.materials.waste_factor * 100)}% waste). {r.materials.note}</p>}
      </details>
      {r.approved_by && <p className="mt-2 text-xs text-slate-500">{r.approval_status} by {r.approved_by}{r.review_note ? `: ${r.review_note}` : ""}</p>}
      {canDecide && (
        <div className="mt-2 flex gap-2">
          <Button variant="success" className="flex-1" onClick={() => onDecide("approve")}>Approve</Button>
          <Button variant="secondary" className="flex-1" onClick={() => onDecide("reject")}>Reject</Button>
        </div>
      )}
    </div>
  );
}

function RouteForm({ surveyId, start, end, onPick, onDone, disabled }: { surveyId: number; start: [number, number] | null; end: [number, number] | null; onPick: (m: PickMode) => void; onDone: (r: RouteCandidate[]) => void; disabled: boolean }) {
  const toast = useToast();
  const [useOsm, setUseOsm] = useState(true);
  const [w, setW] = useState({ barrier: 60, crossing: 25, uncertainty: 0.6 });
  const [impassable, setImpassable] = useState(false);
  const [stripWidth, setStripWidth] = useState(1);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await api<RouteCandidate[]>("/routes/candidates", { body: { survey_id: surveyId, start, end, use_osm: useOsm, weights: w, exclude_impassable: impassable, strip_width_tiles: stripWidth } });
      toast.success(`${r.length} candidate corridor(s) generated`);
      onDone(r);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onPick("start")}>{start ? "Move start" : "Pick start"}</Button>
        <Button variant="secondary" onClick={() => onPick("end")}>{end ? "Move end" : "Pick end"}</Button>
      </div>
      <p className="text-xs text-slate-500">Defaults to the first and last GPS points.</p>
      <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={useOsm} onChange={(e) => setUseOsm(e.target.checked)} /> Include OpenStreetMap footpaths (unverified)</label>
      {(["barrier", "crossing", "uncertainty"] as const).map((k) => (
        <Field key={k} label={`${k[0].toUpperCase() + k.slice(1)} weight: ${w[k]}`}>{(id) => (
          <input id={id} type="range" className="w-full accent-teal-600" min={0} max={k === "uncertainty" ? 2 : 200} step={k === "uncertainty" ? 0.1 : 5} value={w[k]}
            onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} />)}</Field>
      ))}
      <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={impassable} onChange={(e) => setImpassable(e.target.checked)} /> Exclude edges with impassable barriers</label>
      <Field label="Strip width for material estimate (tiles)">{(id) => <input id={id} type="number" min={1} max={4} className={inputCls} value={stripWidth} onChange={(e) => setStripWidth(Math.max(1, Math.min(4, Number(e.target.value) || 1)))} />}</Field>
      <Button onClick={run} loading={busy} disabled={disabled} className="w-full"><Route className="h-4 w-4" /> Generate candidates</Button>
    </div>
  );
}

function ObservationModal({ surveyId, draft, onClose, onDone }: { surveyId: number; draft: { lat: number; lon: number; accuracy: number | null; source: "gps" | "manual" }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [type, setType] = useState("obstacle");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const f = new FormData();
    f.append("lat", String(draft.lat));
    f.append("lon", String(draft.lon));
    f.append("observation_type", type);
    f.append("note", note);
    f.append("location_source", draft.source);
    if (draft.accuracy) f.append("accuracy_m", String(draft.accuracy));
    if (file) f.append("file", file);
    try { await api(`/surveys/${surveyId}/observations`, { form: f }); onDone(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New observation" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <p className="text-xs text-slate-600">{draft.lat.toFixed(6)}, {draft.lon.toFixed(6)} · {draft.source === "gps" ? `GPS ±${Math.round(draft.accuracy ?? 0)} m` : "manual pin"}</p>
      <Field label="Type">{(id) => <select id={id} className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(OBSERVATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
      <Field label="Note">{(id) => <textarea id={id} className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <Field label="Photo (optional)">{(id) => <input id={id} type="file" accept="image/*" capture="environment" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] || null)} />}</Field>
    </Modal>
  );
}

function DecisionModal({ d, onClose, onDone }: { d: { kind: "route" | "survey"; id: number; decision: "approve" | "reject" }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(d.kind === "route" ? `/routes/${d.id}/decision` : `/surveys/${d.id}/review`, { body: { decision: d.decision, note } });
      toast.success(`${d.kind === "route" ? "Corridor" : "Survey"} ${d.decision === "approve" ? "approved" : "rejected"}`);
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  const needs = d.decision === "reject" && d.kind === "survey";
  return (
    <Modal open onClose={onClose} title={`${d.decision === "approve" ? "Approve" : "Reject"} ${d.kind === "route" ? "corridor" : "survey"}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={d.decision === "approve" ? "success" : "danger"} loading={busy} disabled={needs && !note.trim()} onClick={save}>Confirm</Button></>}>
      {d.decision === "approve" && <Notice tone="slate">Approval records your engineering judgement. Verify dimensions, standards, utilities, drainage and crossings on site.</Notice>}
      <Field label={needs ? "Reason (required)" : "Note"} required={needs}>{(id) => <textarea id={id} className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Modal>
  );
}
