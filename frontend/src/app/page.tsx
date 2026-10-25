"use client";

import { CalendarClock, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ServiceSearch } from "@/components/ServiceSearch";
import { Landing } from "@/components/Landing";
import { Gauge, SoftCard } from "@/components/soft";
import { api } from "@/lib/api";
import { ROLE_LABEL, useAuth } from "@/lib/auth";
import { SECTIONS } from "@/lib/services";

interface Summary {
  issues: { open: number; possible_duplicates: number };
  findings: { total: number; verify_on_site: number; by_status: { key: string; count: number }[] };
  evaluation: { status: string };
}
interface ScheduleItem { id: number; title: string; project_name: string; next_due: string; state: string; days_until_due: number }
interface Schedules { items: ScheduleItem[]; counts: Record<string, number> }

const STATE_PILL: Record<string, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200" },
  due_soon: { label: "Due soon", cls: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200" },
  scheduled: { label: "Scheduled", cls: "bg-gov-50 text-gov-700 ring-1 ring-inset ring-gov-100" },
};

function dueText(s: ScheduleItem) {
  if (s.days_until_due < 0) return `${-s.days_until_due} d overdue`;
  if (s.days_until_due === 0) return "due today";
  return `in ${s.days_until_due} d`;
}

function Stat({ label, value, alert }: { label: string; value: React.ReactNode; alert?: boolean }) {
  return (
    <div className={`rounded-xl p-4 shadow-soft ${alert ? "bg-gov-600 text-white" : "bg-white text-slate-900"}`}>
      <p className={`text-xs ${alert ? "text-gov-100" : "text-slate-500"}`}>{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function Home() {
  const { user, loading } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [schedules, setSchedules] = useState<Schedules | null>(null);
  const staff = user && ["admin", "inspector", "engineer"].includes(user.role);

  useEffect(() => {
    if (!staff) return;
    api<Summary>("/dashboard/summary").then(setSummary).catch(() => setSummary(null));
    api<Schedules>("/schedules").then(setSchedules).catch(() => setSchedules(null));
  }, [staff]);

  if (loading) return null;
  const viewer = user?.role ?? "anon";

  if (!user) return <Landing />;

  const count = (keys: string[]) => summary?.findings.by_status.filter((s) => keys.includes(s.key)).reduce((a, s) => a + s.count, 0) ?? 0;
  const pending = count(["ai_proposed", "under_review"]);
  const resolved = count(["verified", "closed", "rejected"]);
  const total = summary?.findings.total ?? 0;
  const upcoming = (schedules?.items ?? []).filter((s) => s.state !== "paused").slice(0, 5);
  const attention = (schedules?.counts.overdue ?? 0) + (schedules?.counts.due_soon ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Welcome back, {user.display_name.split(" ")[0]}</h1>
          <p className="text-sm text-slate-500">{ROLE_LABEL[user.role]}</p>
        </div>
      </div>

      <ServiceSearch viewer={viewer} large className="md:hidden" />

      {summary && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Current workload">
          <Stat label="Awaiting review" value={pending} alert={pending > 0} />
          <Stat label="Verify on site" value={summary.findings.verify_on_site} />
          <Stat label="Open public reports" value={summary.issues.open} />
          <Stat label="Model evaluation" value={summary.evaluation.status === "measured" ? "Measured" : "Pending"} />
        </section>
      )}

      <section aria-labelledby="services" className="space-y-5">
        <h2 id="services" className="text-lg font-bold text-slate-900">Services</h2>
        {SECTIONS.filter((sec) => sec.title).map((sec) => {
          const items = sec.items.filter((i) => i.roles.includes(viewer));
          if (!items.length) return null;
          return (
            <div key={sec.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{sec.title}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
                {items.map((s) => (
                  <Link key={s.href} href={s.href}
                    className="press group flex items-center gap-4 rounded-xl border border-slate-200/70 bg-white p-4 shadow-soft transition hover:border-gov-200 hover:shadow-md">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gov-50 text-gov-600 transition group-hover:bg-gov-600 group-hover:text-white">
                      <s.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-900">{s.label}</span>
                      {s.description && <span className="block truncate text-sm text-slate-500">{s.description}</span>}
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-gov-600" aria-hidden />
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {staff && (summary || schedules) && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {summary && (
            <SoftCard className="flex flex-col items-center text-center">
              <h2 className="text-lg font-bold text-slate-900">Findings resolved</h2>
              <Gauge value={total ? resolved / total : null} label={total ? `${resolved} of ${total} findings · last 90 days` : "No findings in the last 90 days"} />
            </SoftCard>
          )}
          {schedules && (
            <SoftCard>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Upcoming inspections</h2>
                <Link href="/schedule" className="text-sm font-semibold text-gov-600 hover:underline" aria-label={`${attention} of ${schedules.items.length} schedules need attention. Open the schedule`}>
                  {attention}/{schedules.items.length} need attention
                </Link>
              </div>
              {upcoming.length ? (
                <ul className="mt-3 divide-y divide-slate-100">
                  {upcoming.map((s) => (
                    <li key={s.id}>
                      <Link href="/schedule" className="press flex items-center gap-3 rounded-lg px-1 py-2.5 hover:bg-gov-50">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gov-50 text-gov-600"><CalendarClock className="h-4 w-4" aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">{s.title}</span>
                          <span className="block truncate text-xs text-slate-500">{s.project_name} · {s.next_due} · {dueText(s)}</span>
                        </span>
                        <span className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium ${STATE_PILL[s.state]?.cls}`}>{STATE_PILL[s.state]?.label}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No recurring inspections. <Link href="/schedule" className="font-semibold text-gov-600 hover:underline">Create a schedule</Link></p>
              )}
            </SoftCard>
          )}
        </section>
      )}
    </div>
  );
}
