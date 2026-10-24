"use client";

import { ArrowRight, GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RoleGate } from "@/components/RoleGate";
import { Pill, PillButton, SoftCard, SoftHeader, softInput } from "@/components/soft";
import { Field, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { FINDING_STATUS } from "@/lib/labels";

interface Site { id: number; name: string; location_name?: string; inspection_count: number }
interface Row {
  id: number; title: string; status: string; created_at: string; photos: number; findings: number; rejected: number;
  open: number; resolved: number; by_class: Record<string, number>; recurring_from_previous: number | null;
}
interface History { project: { id: number; name: string; location_name: string }; inspections: Row[]; classes: { id: string; label: string }[]; note: string }
interface Brief { id: number; label: string; status: string; severity: string; distance_m?: number }
interface Comparison {
  before: { id: number; title: string }; after: { id: number; title: string };
  totals: { before: number; after: number; recurring: number; new: number; not_seen_again: number };
  by_class: { defect_class: string; label: string; before: number; after: number; recurring: number; new: number; not_seen_again: number }[];
  recurring: { before: Brief; after: Brief; distance_m: number | null; matched_by: string }[];
  new: Brief[]; not_seen_again: Brief[]; method: string; caveat: string;
}

const OPEN = "#33363a";
const RESOLVED = "#7c8189";

export default function HistoryPage() {
  return (
    <RoleGate roles={["admin", "inspector", "engineer", "contractor"]}>
      {() => <Suspense fallback={<Spinner />}><SiteHistory /></Suspense>}
    </RoleGate>
  );
}

function SiteHistory() {
  const params = useSearchParams();
  const router = useRouter();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [site, setSite] = useState(params.get("site") ?? "");
  const [hist, setHist] = useState<History | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<Site[]>("/projects").then((s) => {
      setSites(s);
      if (!site && s.length) setSite(String((s.find((x) => x.inspection_count > 1) ?? s[0]).id));
    }).catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load sites"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!site) return;
    setHist(null);
    setErr("");
    router.replace(`/history?site=${site}`, { scroll: false });
    api<History>(`/projects/${site}/history`).then(setHist).catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load the history"));
  }, [site, router]);

  return (
    <div className="font-display">
      <SoftHeader title="Site history"
        subtitle="Every inspection of a site in date order, and a comparison of any two: what recurred, what is new, and what was not recorded again." />
      <div className="mb-5 max-w-md">
        <Field label="Site">{(id) => (
          <select id={id} className={softInput} value={site} onChange={(e) => setSite(e.target.value)} disabled={!sites}>
            {!sites?.length && <option value="">No sites available</option>}
            {sites?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.inspection_count} inspection{s.inspection_count === 1 ? "" : "s"})</option>)}
          </select>
        )}</Field>
      </div>
      {err && <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{err}</p>}
      {site && !hist && !err && <Spinner />}
      {hist && <Timeline hist={hist} />}
      {hist && hist.inspections.length >= 2 && <Compare rows={hist.inspections} />}
    </div>
  );
}

function Timeline({ hist }: { hist: History }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const data = hist.inspections.map((r) => ({ name: `#${r.id}`, title: r.title, date: r.created_at.slice(0, 10), Open: r.open, Resolved: r.resolved }));
  if (!hist.inspections.length) {
    return <SoftCard className="text-center"><p className="text-xl font-light text-mist-900">No inspections of this site yet</p></SoftCard>;
  }
  return (
    <SoftCard className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-light text-mist-900">Findings per inspection</h2>
        <div className="flex rounded-full bg-mist-200 p-1" role="group" aria-label="View">
          {(["chart", "table"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}
              className={`min-h-[36px] rounded-full px-4 text-sm capitalize ${view === v ? "bg-mist-900 text-white" : "text-mist-800"}`}>{v}</button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-mist-600">{hist.note}</p>
      {view === "chart" ? (
        <div className="mt-4 h-64" role="img" aria-label={`Open and resolved findings for ${data.length} inspections. Switch to table view for the numbers.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5d6269" }} tickLine={false} axisLine={{ stroke: "#c3c7cc" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#5d6269" }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "#e9ebed" }} contentStyle={{ borderRadius: 14, border: "1px solid #d9dce0", fontSize: 12 }}
                labelFormatter={(_, p) => (p?.[0] ? `${p[0].payload.title} · ${p[0].payload.date}` : "")} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "#26292c" }} />
              <Bar dataKey="Open" stackId="f" fill={OPEN} stroke="#f4f5f6" strokeWidth={2} maxBarSize={48} />
              <Bar dataKey="Resolved" stackId="f" fill={RESOLVED} stroke="#f4f5f6" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-mist-600">
              <tr><th className="py-2 pr-3 font-normal">Inspection</th><th className="pr-3 font-normal">Date</th><th className="pr-3 font-normal">Status</th><th className="pr-3 text-right font-normal">Photos</th><th className="pr-3 text-right font-normal">Findings</th><th className="pr-3 text-right font-normal">Open</th><th className="pr-3 text-right font-normal">Resolved</th><th className="pr-3 text-right font-normal">Rejected</th><th className="text-right font-normal">Recurring from previous</th></tr>
            </thead>
            <tbody>
              {hist.inspections.map((r) => (
                <tr key={r.id} className="border-t border-mist-200">
                  <td className="py-2 pr-3"><Link className="underline" href={`/inspect/${r.id}`}>{r.title}</Link></td>
                  <td className="pr-3">{r.created_at.slice(0, 10)}</td>
                  <td className="pr-3">{r.status.replace(/_/g, " ")}</td>
                  <td className="pr-3 text-right">{r.photos}</td><td className="pr-3 text-right">{r.findings}</td>
                  <td className="pr-3 text-right">{r.open}</td><td className="pr-3 text-right">{r.resolved}</td><td className="pr-3 text-right">{r.rejected}</td>
                  <td className="text-right">{r.recurring_from_previous ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SoftCard>
  );
}

function Compare({ rows }: { rows: Row[] }) {
  const [before, setBefore] = useState(String(rows[rows.length - 2].id));
  const [after, setAfter] = useState(String(rows[rows.length - 1].id));
  const [res, setRes] = useState<Comparison | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const order = useMemo(() => new Map(rows.map((r, i) => [String(r.id), i])), [rows]);

  async function run() {
    setBusy(true);
    setErr("");
    try {
      setRes(await api<Comparison>(`/inspections/${before}/compare/${after}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not compare");
    }
    setBusy(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, []);
  const reversed = (order.get(before) ?? 0) > (order.get(after) ?? 0);

  return (
    <SoftCard>
      <h2 className="flex items-center gap-2 text-2xl font-light text-mist-900"><GitCompareArrows className="h-6 w-6" aria-hidden /> Compare two inspections</h2>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><Field label="Earlier inspection">{(id) => (
          <select id={id} className={softInput} value={before} onChange={(e) => setBefore(e.target.value)}>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.title} · {r.created_at.slice(0, 10)}</option>)}
          </select>)}</Field></div>
        <ArrowRight className="mb-3 h-5 w-5 text-mist-500" aria-hidden />
        <div className="min-w-[220px] flex-1"><Field label="Later inspection">{(id) => (
          <select id={id} className={softInput} value={after} onChange={(e) => setAfter(e.target.value)}>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.title} · {r.created_at.slice(0, 10)}</option>)}
          </select>)}</Field></div>
        <PillButton tone="dark" loading={busy} disabled={before === after} onClick={run}>Compare</PillButton>
      </div>
      {reversed && <p className="mt-2 text-xs text-amber-800">The &ldquo;earlier&rdquo; inspection is newer than the &ldquo;later&rdquo; one; results are read in that order.</p>}
      {err && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{err}</p>}
      {res && (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4" aria-label="Comparison totals">
            <Pill label="Recurring" value={res.totals.recurring} tone="dark" />
            <Pill label="New" value={res.totals.new} tone="volt" />
            <Pill label="Not seen again" value={res.totals.not_seen_again} tone="hatch" />
            <Pill label="Findings before → after" value={`${res.totals.before} → ${res.totals.after}`} tone="outline" />
          </div>
          {res.by_class.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Findings by defect type</caption>
                <thead className="text-xs text-mist-600"><tr><th className="py-2 pr-3 font-normal">Defect type</th><th className="pr-3 text-right font-normal">Before</th><th className="pr-3 text-right font-normal">After</th><th className="pr-3 text-right font-normal">Recurring</th><th className="pr-3 text-right font-normal">New</th><th className="text-right font-normal">Not seen again</th></tr></thead>
                <tbody>
                  {res.by_class.map((c) => (
                    <tr key={c.defect_class} className="border-t border-mist-200">
                      <td className="py-2 pr-3">{c.label}</td><td className="pr-3 text-right">{c.before}</td><td className="pr-3 text-right">{c.after}</td>
                      <td className="pr-3 text-right">{c.recurring}</td><td className="pr-3 text-right">{c.new}</td><td className="text-right">{c.not_seen_again}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <FindingList title="Recurring" tone="dark" items={res.recurring.map((r) => ({ ...r.after, note: r.distance_m != null ? `${r.distance_m} m from F-${r.before.id}` : `type and context match with F-${r.before.id}` }))} />
            <FindingList title="New" tone="volt" items={res.new} />
            <FindingList title="Not seen again" tone="light" items={res.not_seen_again} />
          </div>
          <div className="space-y-1 rounded-3xl bg-mist-100 px-4 py-3 text-xs text-mist-700">
            <p>{res.method}</p>
            <p><strong>{res.caveat}</strong></p>
          </div>
        </div>
      )}
    </SoftCard>
  );
}

function FindingList({ title, tone, items }: { title: string; tone: "dark" | "volt" | "light"; items: (Brief & { note?: string })[] }) {
  const head = tone === "dark" ? "bg-mist-900 text-white" : tone === "volt" ? "bg-volt-400 text-mist-900" : "hatch bg-mist-100 text-mist-900";
  return (
    <section className="overflow-hidden rounded-3xl bg-white" aria-label={title}>
      <h3 className={`flex items-center justify-between px-4 py-2.5 text-sm ${head}`}>{title}<span>{items.length}</span></h3>
      {items.length ? (
        <ul className="divide-y divide-mist-100">
          {items.map((f) => (
            <li key={f.id} className="px-4 py-2.5 text-sm">
              <Link href={`/findings/${f.id}`} className="text-mist-900 underline">F-{f.id} {f.label}</Link>
              <p className="text-xs text-mist-600">{FINDING_STATUS[f.status]?.label ?? f.status}{f.note ? ` · ${f.note}` : ""}</p>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-4 text-sm text-mist-500">None</p>}
    </section>
  );
}
