"use client";

import { CalendarClock, Pause, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { Pill, PillButton, RoundIcon, SoftCard, SoftHeader, softInput } from "@/components/soft";
import { useToast } from "@/components/toast";
import { Field, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Run { inspection_id: number; title: string | null; status: string | null; due_at: string; started_at: string; started_by: string | null; on_time: boolean }
interface Schedule {
  id: number; project_id: number; project_name: string; title: string; site_name: string; interval_days: number; next_due: string;
  remind_days: number; contractor: string | null; contractor_id: number | null; notes: string; active: boolean;
  state: "overdue" | "due_soon" | "scheduled" | "paused"; days_until_due: number; runs: Run[];
}
interface List { items: Schedule[]; counts: Record<string, number>; today: string }
interface Site { id: number; name: string; location_name?: string }
interface Person { id: number; display_name: string }

const STATE: Record<Schedule["state"], { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-800" },
  due_soon: { label: "Due soon", cls: "bg-volt-400 text-mist-900" },
  scheduled: { label: "Scheduled", cls: "bg-mist-200 text-mist-800" },
  paused: { label: "Paused", cls: "border border-mist-400 text-mist-700" },
};
const CADENCE = [
  { days: 30, label: "Monthly" },
  { days: 90, label: "Quarterly" },
  { days: 180, label: "Half-yearly" },
  { days: 365, label: "Yearly" },
];
const cadence = (d: number) => CADENCE.find((c) => c.days === d)?.label ?? `Every ${d} days`;
const due = (s: Schedule) => (s.days_until_due < 0 ? `${-s.days_until_due} days overdue` : s.days_until_due === 0 ? "Due today" : `Due in ${s.days_until_due} days`);

export default function SchedulePage() {
  return <RoleGate roles={["admin", "inspector", "engineer"]}>{() => <Schedules />}</RoleGate>;
}

function Schedules() {
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = useState<List | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => api<List>("/schedules").then(setData).catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load schedules")), []);
  useEffect(() => { load(); }, [load]);

  async function start(s: Schedule) {
    setBusy(s.id);
    try {
      const r = await api<{ inspection_id: number; next_due: string }>(`/schedules/${s.id}/start`, { method: "POST" });
      toast.success(`Inspection started. Next due ${r.next_due}`);
      router.push(`/inspect/${r.inspection_id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start the inspection");
      setBusy(null);
    }
  }
  async function setActive(s: Schedule, active: boolean) {
    setBusy(s.id);
    try {
      await api(`/schedules/${s.id}`, { method: "PATCH", body: { active } });
      toast.success(active ? "Schedule resumed" : "Schedule paused");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update the schedule");
    }
    setBusy(null);
  }

  return (
    <div className="font-display">
      <SoftHeader title="Inspection schedule"
        subtitle="Recurring inspections per site. Starting one creates an ordinary inspection in the usual capture, review and punch-list workflow, and moves the schedule to its next due date." />
      {err && <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{err}</p>}
      {!data && !err && <Spinner />}
      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4" aria-label="Schedule status">
            <Pill label="Overdue" value={data.counts.overdue} tone="dark" />
            <Pill label="Due soon" value={data.counts.due_soon} tone="volt" />
            <Pill label="Scheduled" value={data.counts.scheduled} tone="hatch" />
            <Pill label="Paused" value={data.counts.paused} tone="outline" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
            <div className="space-y-3">
              {!data.items.length && (
                <SoftCard className="text-center">
                  <p className="text-xl font-light text-mist-900">No schedules yet</p>
                  <p className="mt-1 text-sm text-mist-600">Create one to have TenjiCheck track when each site is due for its next inspection.</p>
                </SoftCard>
              )}
              {data.items.map((s) => (
                <article key={s.id} className="rounded-4xl bg-mist-50 p-5 shadow-soft" aria-label={s.title}>
                  <div className="flex flex-wrap items-start gap-3">
                    <RoundIcon tone={s.state === "overdue" ? "dark" : s.state === "due_soon" ? "volt" : "light"}><CalendarClock className="h-5 w-5" aria-hidden /></RoundIcon>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl text-mist-900">{s.title}</h2>
                      <p className="text-sm text-mist-600">{s.project_name}{s.site_name ? ` · ${s.site_name}` : ""}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs ${STATE[s.state].cls}`}>{STATE[s.state].label}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-mist-500">Cadence</dt><dd className="text-mist-900">{cadence(s.interval_days)}</dd></div>
                    <div><dt className="text-xs text-mist-500">Next due</dt><dd className="text-mist-900">{s.next_due}</dd></div>
                    <div><dt className="text-xs text-mist-500">Status</dt><dd className={s.state === "overdue" ? "text-red-700" : "text-mist-900"}>{s.active ? due(s) : "Paused"}</dd></div>
                    <div><dt className="text-xs text-mist-500">Contractor</dt><dd className="text-mist-900">{s.contractor || "Unassigned"}</dd></div>
                  </dl>
                  {s.notes && <p className="mt-3 text-sm text-mist-700">{s.notes}</p>}
                  {s.runs.length > 0 && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-mist-700">{s.runs.length} inspection{s.runs.length === 1 ? "" : "s"} started from this schedule</summary>
                      <ul className="mt-2 space-y-1">
                        {s.runs.map((r) => (
                          <li key={r.inspection_id} className="flex flex-wrap items-center gap-2">
                            <Link className="text-mist-900 underline" href={`/inspect/${r.inspection_id}`}>{r.title ?? `Inspection ${r.inspection_id}`}</Link>
                            <span className="text-xs text-mist-500">started {r.started_at.slice(0, 10)}{r.started_by ? ` by ${r.started_by}` : ""} · due {r.due_at.slice(0, 10)}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.on_time ? "bg-mist-200 text-mist-800" : "bg-red-100 text-red-800"}`}>{r.on_time ? "On time" : "Late"}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {s.active && <PillButton tone="dark" loading={busy === s.id} onClick={() => start(s)}><Play className="h-4 w-4" aria-hidden /> Start inspection</PillButton>}
                    <PillButton tone="light" disabled={busy === s.id} onClick={() => setActive(s, !s.active)}>
                      {s.active ? <><Pause className="h-4 w-4" aria-hidden /> Pause</> : <><Play className="h-4 w-4" aria-hidden /> Resume</>}
                    </PillButton>
                    <Link href={`/history?site=${s.project_id}`} className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm text-mist-800 hover:bg-mist-200">Site history</Link>
                  </div>
                </article>
              ))}
            </div>
            <NewSchedule onCreated={load} />
          </div>
        </>
      )}
    </div>
  );
}

function NewSchedule({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const blank = { project_id: "", title: "", site_name: "", interval_days: 90, next_due: today, remind_days: 7, contractor_id: "", notes: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Site[]>("/projects").then(setSites).catch(() => setSites([]));
    api<Person[]>("/users?role=contractor").then(setPeople).catch(() => setPeople([]));
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/projects/${f.project_id}/schedules`, {
        body: { title: f.title, site_name: f.site_name, interval_days: Number(f.interval_days), next_due: f.next_due,
          remind_days: Number(f.remind_days), contractor_id: f.contractor_id ? Number(f.contractor_id) : null, notes: f.notes },
      });
      toast.success("Schedule created");
      setF(blank);
      onCreated();
    } catch (e2) {
      toast.error(e2 instanceof ApiError ? e2.message : "Could not create the schedule");
    }
    setBusy(false);
  }

  return (
    <SoftCard className="h-fit">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-light text-mist-900"><Plus className="h-5 w-5" aria-hidden /> New schedule</h2>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Site" required>{(id) => (
          <select id={id} required className={softInput} value={f.project_id}
            onChange={(e) => { const s = sites.find((x) => String(x.id) === e.target.value); setF({ ...f, project_id: e.target.value, title: f.title || (s ? `${s.name} inspection` : ""), site_name: f.site_name || s?.location_name || "" }); }}>
            <option value="">Choose a site</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}</Field>
        <Field label="Title" required>{(id) => <input id={id} required minLength={2} maxLength={200} className={softInput} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink-900">Repeat</legend>
          <div className="flex flex-wrap gap-2">
            {CADENCE.map((c) => (
              <button type="button" key={c.days} aria-pressed={f.interval_days === c.days} onClick={() => setF({ ...f, interval_days: c.days })}
                className={`min-h-[40px] rounded-full px-4 text-sm ${f.interval_days === c.days ? "bg-mist-900 text-white" : "bg-mist-200 text-mist-900 hover:bg-mist-300"}`}>{c.label}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every (days)" required>{(id) => <input id={id} type="number" min={1} max={730} required className={softInput} value={f.interval_days} onChange={(e) => setF({ ...f, interval_days: Number(e.target.value) })} />}</Field>
          <Field label="First due" required>{(id) => <input id={id} type="date" required className={softInput} value={f.next_due} onChange={(e) => setF({ ...f, next_due: e.target.value })} />}</Field>
        </div>
        <Field label="Remind (days before)" hint="Shown as 'Due soon' from this many days before the due date.">{(id) => <input id={id} type="number" min={0} max={90} className={softInput} value={f.remind_days} onChange={(e) => setF({ ...f, remind_days: Number(e.target.value) })} />}</Field>
        <Field label="Contractor (optional)">{(id) => (
          <select id={id} className={softInput} value={f.contractor_id} onChange={(e) => setF({ ...f, contractor_id: e.target.value })}>
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        )}</Field>
        <Field label="Notes">{(id) => <textarea id={id} rows={2} maxLength={2000} className={softInput} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        <PillButton type="submit" tone="volt" loading={busy} className="w-full">Create schedule</PillButton>
      </form>
    </SoftCard>
  );
}
