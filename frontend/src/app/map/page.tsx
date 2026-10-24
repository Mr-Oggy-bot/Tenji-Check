"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type MapLine, type MapMarker, MapView } from "@/components/MapView";
import { RoleGate } from "@/components/RoleGate";
import { Notice, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { DEFAULT_CENTER } from "@/lib/geo";
import { FINDING_STATUS, ISSUE_STATUS } from "@/lib/labels";

interface Feature { kind: "finding" | "issue"; id: number; lat: number; lon: number; status: string; label: string; reference?: string; verify_on_site?: boolean; inspection_id?: number; unreviewed?: boolean; is_demo?: boolean }
interface SurveyLayer { id: number; title: string; status: string; track: [number, number][]; observations: { lat: number; lon: number; type: string }[]; approved_route: [number, number][] | null }

const LAYERS = { findings: "Inspection findings", issues: "Public reports", surveys: "Survey tracks", routes: "Approved corridors" } as const;

export default function MapPage() {
  return <RoleGate>{() => <SharedMap />}</RoleGate>;
}

function SharedMap() {
  const [data, setData] = useState<{ features: Feature[]; surveys: SurveyLayer[]; legend_note: string } | null>(null);
  const [err, setErr] = useState("");
  const [on, setOn] = useState<Record<keyof typeof LAYERS, boolean>>({ findings: true, issues: true, surveys: true, routes: true });
  useEffect(() => { api<typeof data>("/map/features").then(setData).catch((e) => setErr(e.message)); }, []);

  const markers: MapMarker[] = useMemo(() => (data?.features || [])
    .filter((f) => (f.kind === "finding" ? on.findings : on.issues))
    .map((f) => ({
      id: `${f.kind}${f.id}`, lat: f.lat, lon: f.lon, radius: 9,
      color: f.kind === "finding" ? (f.unreviewed ? "#7c3aed" : f.status === "closed" ? "#16a34a" : "#dc2626") : (["resolved", "rejected"].includes(f.status) ? "#64748b" : "#ea580c"),
      label: f.kind === "finding" ? `Finding F-${f.id}: ${f.label}` : `Report ${f.reference}: ${f.label}`,
      popup: (
        <div className="space-y-1 text-sm">
          <p className="font-semibold">{f.kind === "finding" ? `F-${f.id} ${f.label}` : `${f.reference} · ${f.label}`}</p>
          <p>{f.kind === "finding" ? FINDING_STATUS[f.status]?.label : ISSUE_STATUS[f.status]?.label}{f.verify_on_site ? " · verify on site" : ""}{f.is_demo ? " · demo data" : ""}</p>
          <Link className="text-teal-700 underline" href={f.kind === "finding" ? `/findings/${f.id}` : `/reports/${f.id}`}>Open</Link>
        </div>
      ),
    })), [data, on]);

  const lines: MapLine[] = useMemo(() => {
    const l: MapLine[] = [];
    data?.surveys.forEach((s) => {
      if (on.surveys && s.track.length > 1) l.push({ points: s.track, color: "#0b1d2a", weight: 3, label: `Survey: ${s.title}` });
      if (on.routes && s.approved_route) l.push({ points: s.approved_route, color: "#16a885", weight: 6, label: `Approved corridor: ${s.title}` });
    });
    return l;
  }, [data, on]);

  if (err) return <Notice tone="red">{err}</Notice>;
  if (!data) return <Spinner />;
  const fit = [...markers.map((m) => [m.lat, m.lon] as [number, number]), ...lines.flatMap((l) => l.points)];
  return (
    <>
      <PageHeader eyebrow="Insights" title="Shared map" subtitle="Inspection findings, public reports and Build surveys in one view, filtered to what your role may see." />
      <fieldset className="mb-3 flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Layers</legend>
        {(Object.keys(LAYERS) as (keyof typeof LAYERS)[]).map((k) => (
          <label key={k} className="flex min-h-[40px] items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={on[k]} onChange={(e) => setOn({ ...on, [k]: e.target.checked })} /> {LAYERS[k]}</label>
        ))}
      </fieldset>
      <MapView center={fit[0] || DEFAULT_CENTER} zoom={16} height={560} markers={markers} lines={lines} fit={fit.length ? fit : undefined} fitKey={fit.length} />
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
        {[["#7c3aed", "Finding awaiting review"], ["#dc2626", "Confirmed / open finding"], ["#16a34a", "Closed finding"], ["#ea580c", "Open public report"], ["#64748b", "Resolved / rejected report"]].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} />{l}</span>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">{data.legend_note} Findings without GPS are not shown.</p>
    </>
  );
}
