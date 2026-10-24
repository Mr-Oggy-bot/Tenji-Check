"use client";

import { useCallback, useEffect, useState } from "react";
import { BarList } from "@/components/BarList";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Card, Field, inputCls, Notice, PageHeader, Spinner, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { DEFECT_LABEL, FINDING_STATUS, fmtDate, ISSUE_STATUS } from "@/lib/labels";

interface KV { key: string; label?: string; count: number }
interface Summary {
  period: { from: string; to: string };
  demo_records: number;
  issues: { total: number; open: number; by_category: KV[]; by_status: KV[]; by_severity: KV[]; open_by_age: KV[];
    recurring_locations: { lat: number; lon: number; count: number }[]; possible_duplicates: number; median_days_to_resolve: number | null };
  findings: { total: number; by_class: KV[]; by_status: KV[]; by_source: Record<string, number>; verify_on_site: number; ai_reviewed: number; ai_confirmed: number; ai_rejected: number };
  workflow: { punch_lists: number; human_review_enforcement: number | null; report_completeness: number | null; inference_latency_ms: { median: number | null; p95: number | null; samples: number } };
  surveys: { by_status: Record<string, number>; approved_routes: number };
  evaluation: { status: string; message?: string; targets?: Record<string, number>; per_class?: Record<string, { recall: number; precision: number }> };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function DashboardPage() {
  return <RoleGate roles={["admin", "inspector", "engineer"]}>{() => <Dashboard />}</RoleGate>;
}

function Dashboard() {
  const toast = useToast();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 90 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [d, setD] = useState<Summary | null>(null);
  const load = useCallback(() => {
    api<Summary>(`/dashboard/summary?from=${from}T00:00:00Z&to=${to}T23:59:59Z`).then(setD).catch((e) => toast.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <Spinner />;
  const precisionProxy = d.findings.ai_reviewed ? Math.round((100 * d.findings.ai_confirmed) / d.findings.ai_reviewed) : null;
  return (
    <>
      <PageHeader eyebrow="Insights" title="Dashboard" subtitle={`Derived from database records · ${fmtDate(d.period.from, false)} – ${fmtDate(d.period.to, false)}`}
        actions={<div className="flex flex-wrap items-end gap-2">
          <Field label="From">{(id) => <input id={id} type="date" className={inputCls} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(id) => <input id={id} type="date" className={inputCls} value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>} />
      {d.demo_records > 0 && <div className="mb-4"><Notice>{d.demo_records} report(s) in this period are seeded demo records, not live infrastructure data.</Notice></div>}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Inspection quality gate</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Human review enforcement" value={d.workflow.human_review_enforcement != null ? `${d.workflow.human_review_enforcement}%` : "—"} tone="teal"
          hint={`${d.workflow.punch_lists} punch list(s); target 100% reviewed before PDF`} />
        <Stat label="Report completeness" value={d.workflow.report_completeness != null ? `${d.workflow.report_completeness}%` : "—"} tone="teal" hint="Photo, rule, reviewer, status, date" />
        <Stat label="Obstacle recall" value={d.evaluation.status === "measured" && d.evaluation.per_class?.obstacle_on_path ? d.evaluation.per_class.obstacle_on_path.recall.toFixed(2) : "Pending"}
          tone="amber" hint="Target ≥ 0.80 on a held-out route; not yet measured" />
        <Stat label="Inference latency" value={d.workflow.inference_latency_ms.median != null ? `${(d.workflow.inference_latency_ms.median / 1000).toFixed(1)} s` : "—"}
          hint={`median · p95 ${d.workflow.inference_latency_ms.p95 != null ? (d.workflow.inference_latency_ms.p95 / 1000).toFixed(1) + " s" : "—"} · n=${d.workflow.inference_latency_ms.samples}`} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Findings" value={d.findings.total} hint={`${d.findings.by_source.ai || 0} AI · ${d.findings.by_source.manual || 0} manual`} />
        <Stat label="AI proposals confirmed" value={precisionProxy != null ? `${precisionProxy}%` : "—"} hint={`${d.findings.ai_confirmed} confirmed / ${d.findings.ai_rejected} rejected by reviewers`} />
        <Stat label="Verify-on-site flags" value={d.findings.verify_on_site} tone={d.findings.verify_on_site ? "amber" : undefined} />
        <Stat label="Approved corridors" value={d.surveys.approved_routes} hint={Object.entries(d.surveys.by_status).map(([k, v]) => `${v} ${k}`).join(" · ") || "No surveys"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Findings by defect class"><BarList title="Findings by defect class" data={d.findings.by_class.map((x) => ({ label: DEFECT_LABEL[x.key] || x.key, count: x.count }))} /></Card>
        <Card title="Findings by status"><BarList title="Findings by status" data={d.findings.by_status.map((x) => ({ label: FINDING_STATUS[x.key]?.label || x.key, count: x.count }))} /></Card>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Public reports</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Reports" value={d.issues.total} />
        <Stat label="Open" value={d.issues.open} tone={d.issues.open ? "amber" : undefined} />
        <Stat label="Possible duplicates" value={d.issues.possible_duplicates} />
        <Stat label="Median days to resolve" value={d.issues.median_days_to_resolve ?? "—"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="By category"><BarList title="Reports by category" data={d.issues.by_category.map((x) => ({ label: x.label || x.key, count: x.count }))} /></Card>
        <Card title="By status"><BarList title="Reports by status" data={d.issues.by_status.map((x) => ({ label: ISSUE_STATUS[x.key]?.label || x.key, count: x.count }))} /></Card>
        <Card title="Open reports by age"><BarList title="Open reports by age" data={d.issues.open_by_age.map((x) => ({ label: x.key, count: x.count }))} /></Card>
      </div>
      <Card title="Recurring locations (≈100 m cells with 2+ reports)" className="mt-6">
        {!d.issues.recurring_locations.length ? <p className="text-sm text-slate-500">No location has repeated reports in this period.</p> : (
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>Cell centre</th><th className="text-right">Reports</th></tr></thead>
            <tbody>{d.issues.recurring_locations.map((r) => <tr key={`${r.lat},${r.lon}`} className="border-t"><td className="py-1 font-mono">{r.lat.toFixed(3)}, {r.lon.toFixed(3)}</td><td className="text-right">{r.count}</td></tr>)}</tbody></table>
        )}
      </Card>
    </>
  );
}
