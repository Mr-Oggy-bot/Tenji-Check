"use client";

import { ArrowUpRight, CalendarClock, ClipboardCheck, Hammer, History, Map, Megaphone, Route, Ruler, ScanLine, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Gauge, Pill, RoundIcon, SoftCard } from "@/components/soft";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Summary {
  issues: { open: number; possible_duplicates: number };
  findings: { total: number; verify_on_site: number; by_status: { key: string; count: number }[] };
  evaluation: { status: string };
}
interface ScheduleItem { id: number; title: string; project_name: string; next_due: string; state: string; days_until_due: number; contractor: string | null }
interface Schedules { items: ScheduleItem[]; counts: Record<string, number> }

const MODES = [
  { icon: ClipboardCheck, title: "Inspect", text: "Photograph laid tactile paving, let the AI screen for obstacles, gaps and missing warning tiles, and close every confirmed defect with evidence before handover." },
  { icon: Route, title: "Build", text: "Walk a proposed site with GPS, log obstacles and crossings, and compare candidate corridors with an explainable cost and material estimate. Point the camera at a footpath for a live proposal of where a strip could be laid around obstacles." },
  { icon: Megaphone, title: "Report", text: "Citizens report blocked or damaged tactile paths with a photo and a map pin, then track the status with a reference number." },
];

const STATE_PILL: Record<string, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-800" },
  due_soon: { label: "Due soon", cls: "bg-volt-400 text-mist-900" },
  scheduled: { label: "Scheduled", cls: "bg-white/15 text-mist-100" },
  paused: { label: "Paused", cls: "bg-white/10 text-mist-300" },
};

function dueText(s: ScheduleItem) {
  if (s.days_until_due < 0) return `${-s.days_until_due} d overdue`;
  if (s.days_until_due === 0) return "due today";
  return `in ${s.days_until_due} d`;
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

  const tiles = [
    { href: "/inspect", icon: ClipboardCheck, label: "Inspections", show: staff },
    { href: "/review", icon: ShieldCheck, label: "Review queue", show: user && ["admin", "inspector"].includes(user.role) },
    { href: "/schedule", icon: CalendarClock, label: "Inspection schedule", show: staff },
    { href: "/history", icon: History, label: "Site history", show: user && user.role !== "citizen" },
    { href: "/tasks", icon: Hammer, label: "My fix tasks", show: user?.role === "contractor" },
    { href: "/build", icon: Route, label: "Site surveys", show: user && user.role !== "citizen" },
    { href: "/live", icon: ScanLine, label: "Live path planner", show: user && user.role !== "citizen" },
    { href: "/planning", icon: Ruler, label: "Planning & Estimation", show: user && user.role !== "citizen" },
    { href: "/report", icon: Megaphone, label: "Report an issue", show: true },
    { href: user?.role === "citizen" ? "/report/mine" : "/report/status", icon: Search, label: user?.role === "citizen" ? "My reports" : "Track a report", show: !staff },
    { href: "/map", icon: Map, label: "Shared map", show: !!user },
  ].filter((t) => t.show);

  const count = (keys: string[]) => summary?.findings.by_status.filter((s) => keys.includes(s.key)).reduce((a, s) => a + s.count, 0) ?? 0;
  const pending = count(["ai_proposed", "under_review"]);
  const resolved = count(["verified", "closed", "rejected"]);
  const total = summary?.findings.total ?? 0;
  const upcoming = (schedules?.items ?? []).filter((s) => s.state !== "paused").slice(0, 5);
  const attention = (schedules?.counts.overdue ?? 0) + (schedules?.counts.due_soon ?? 0);

  return (
    <div className="space-y-5 font-display">
      <section className="rounded-4xl bg-mist-700 px-6 py-8 text-white sm:px-10 sm:py-10">
        <p className="text-sm text-volt-300">Tactile paving accessibility</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-light leading-tight sm:text-5xl">
          Find tactile-path defects before handover, not after someone gets hurt.
        </h1>
        <p className="mt-4 max-w-2xl text-mist-200">
          TenjiCheck screens photos with AI and turns every confirmed defect into a punch-list item that must be fixed and re-photographed before it can close.
          AI proposes; authorised inspectors decide. The software never certifies compliance.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {!user && <Link href="/login" className="inline-flex min-h-[44px] items-center rounded-full bg-volt-400 px-5 text-mist-900 hover:bg-volt-300">Sign in</Link>}
          <Link href="/report" className={`inline-flex min-h-[44px] items-center rounded-full px-5 ${user ? "bg-volt-400 text-mist-900 hover:bg-volt-300" : "bg-white/15 text-white hover:bg-white/25"}`}>Report an issue</Link>
          {!user && <Link href="/report/status" className="inline-flex min-h-[44px] items-center rounded-full px-5 text-white hover:bg-white/10">Track a report</Link>}
        </div>
      </section>

      {user && (
        <section aria-labelledby="quick">
          <h2 id="quick" className="mb-3 mt-2 px-1 text-3xl font-light text-mist-900">Welcome back, {user.display_name.split(" ")[0]}</h2>
          {summary && (
            <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4" aria-label="Current workload">
              <Pill label="Awaiting review" value={pending} tone="dark" />
              <Pill label="Verify on site" value={summary.findings.verify_on_site} tone="volt" />
              <Pill label="Open public reports" value={summary.issues.open} tone="hatch" />
              <Pill label="Model evaluation" value={summary.evaluation.status === "measured" ? "Measured" : "Pending"} tone="outline" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tiles.map((t) => (
              <Link key={t.href} href={t.href} className="group flex min-h-[112px] flex-col justify-between rounded-3xl bg-mist-50 p-4 shadow-soft transition hover:bg-white">
                <div className="flex items-start justify-between">
                  <RoundIcon><t.icon className="h-5 w-5" aria-hidden /></RoundIcon>
                  <ArrowUpRight className="h-4 w-4 text-mist-400 transition group-hover:text-mist-900" aria-hidden />
                </div>
                <span className="text-base text-mist-900">{t.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {staff && (summary || schedules) && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {summary && (
            <SoftCard className="flex flex-col items-center text-center">
              <h2 className="text-2xl font-light text-mist-900">Findings resolved</h2>
              <Gauge value={total ? resolved / total : null} label={total ? `${resolved} of ${total} findings, last 90 days` : "No findings in the last 90 days"} />
              <p className="max-w-sm text-xs text-mist-600">Verified, closed or rejected by a reviewer. Unreviewed AI proposals count as unresolved.</p>
            </SoftCard>
          )}
          {schedules && (
            <section className="rounded-4xl bg-mist-900 p-5 text-white sm:p-6" aria-labelledby="upcoming">
              <div className="flex items-center justify-between">
                <h2 id="upcoming" className="text-lg font-light">Upcoming inspections</h2>
                <p className="text-3xl font-light" aria-label={`${attention} of ${schedules.items.length} schedules need attention`}>
                  {attention}<span className="text-mist-400">/{schedules.items.length}</span>
                </p>
              </div>
              {upcoming.length ? (
                <ul className="mt-3 space-y-1">
                  {upcoming.map((s) => (
                    <li key={s.id}>
                      <Link href="/schedule" className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white/5">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mist-100 text-mist-900"><CalendarClock className="h-4 w-4" aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{s.title}</span>
                          <span className="block truncate text-xs text-mist-400">{s.project_name} · {s.next_due} · {dueText(s)}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${STATE_PILL[s.state]?.cls}`}>{STATE_PILL[s.state]?.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-mist-300">No recurring inspections yet. <Link href="/schedule" className="underline">Set up a schedule</Link>.</p>
              )}
            </section>
          )}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {MODES.map((m) => (
          <SoftCard key={m.title}>
            <RoundIcon tone="volt"><m.icon className="h-5 w-5" aria-hidden /></RoundIcon>
            <h3 className="mt-4 text-2xl font-light text-mist-900">{m.title}</h3>
            <p className="mt-1 text-sm text-mist-700">{m.text}</p>
          </SoftCard>
        ))}
      </section>

      <SoftCard className="bg-mist-100">
        <h2 className="text-base text-mist-900">How the AI is used</h2>
        <p className="mt-1 text-sm text-mist-700">
          Detections and rule matches are candidates. Every one is confirmed or rejected by an authorised reviewer before it reaches a punch list,
          and anything the system cannot measure reliably is flagged <strong>verify on site</strong> instead of guessed.
        </p>
      </SoftCard>
    </div>
  );
}
