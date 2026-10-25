"use client";

// Public front page of the portal (signed-out visitors).
import {
  Camera, CheckCircle2, ChevronRight, ClipboardCheck, EyeOff, FileSearch, Footprints, LogIn, MapPin, Megaphone, PhoneCall, Route,
  Ruler, Search, ShieldCheck, Wrench,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const QUICK = [
  { href: "/report", icon: Megaphone, title: "Report an issue", text: "Blocked, broken or missing tactile paving", primary: true },
  { href: "/report/status", icon: Search, title: "Track a report", text: "Check progress with your reference number" },
  { href: "/login", icon: LogIn, title: "Sign in", text: "Citizens, inspectors, engineers and contractors" },
];

const STEPS = [
  { icon: Camera, title: "Photograph the problem", text: "Take a photo and mark the place on the map. No account is needed." },
  { icon: FileSearch, title: "Receive a reference", text: "You get a reference number straight away to follow your report." },
  { icon: ShieldCheck, title: "Inspector review", text: "An authorised inspector reviews the report and assigns the repair." },
  { icon: Wrench, title: "Repair and verification", text: "The repair is photographed and checked before the case is closed." },
];

const MODULES = [
  { icon: ClipboardCheck, title: "Inspection", text: "Photo screening of laid tactile paving, reviewer decisions, punch lists and handover." },
  { icon: Route, title: "Site surveys", text: "GPS walk surveys of proposed routes, with obstacles, crossings and route options." },
  { icon: Ruler, title: "Planning & estimation", text: "Tactile layouts on a site plan with tile quantities, cutting, waste and cost." },
];

export function Landing() {
  const [cats, setCats] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => { api<{ value: string; label: string }[]>("/issues/categories").then(setCats).catch(() => setCats([])); }, []);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[1.25rem] bg-gov-700 text-white shadow-soft">
        <svg className="pointer-events-none absolute -right-10 -top-10 h-72 w-72 text-gov-600 opacity-40" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="100" fill="currentColor" />
        </svg>
        <svg className="pointer-events-none absolute bottom-0 left-0 h-10 w-full" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden>
          <path d="M0 30 C 120 5, 260 40, 400 12" fill="none" stroke="#f2c230" strokeWidth="6" strokeDasharray="1 14" strokeLinecap="round" />
        </svg>
        <div className="relative grid gap-8 px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1 text-xs font-medium text-gov-100">
              <Footprints className="h-3.5 w-3.5" aria-hidden /> Accessible Paths Portal
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-tight sm:text-5xl">Safe tactile paths for everyone</h1>
            <p className="mt-4 max-w-xl text-base text-gov-100 sm:text-lg">
              Report blocked or damaged tactile paving and follow it through inspection and repair.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/report" className="press inline-flex min-h-[50px] items-center gap-2 rounded-xl bg-white px-6 font-semibold text-gov-800 hover:bg-gov-50">
                <Megaphone className="h-5 w-5" aria-hidden /> Report an issue
              </Link>
              <Link href="/report/status" className="press inline-flex min-h-[50px] items-center gap-2 rounded-xl px-6 font-semibold text-white ring-1 ring-inset ring-white/50 hover:bg-white/10">
                <Search className="h-5 w-5" aria-hidden /> Track a report
              </Link>
            </div>
          </div>
          <div className="hidden rounded-2xl bg-gov-800/70 p-5 ring-1 ring-inset ring-white/15 lg:block">
            <p className="text-sm font-semibold">What you can report</p>
            <ul className="mt-3 grid gap-2">
              {(cats.length ? cats : [{ value: "x", label: "Loading…" }]).map((c) => (
                <li key={c.value} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#f2c230]" aria-hidden /> {c.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Quick services */}
      <section aria-labelledby="quick-services">
        <h2 id="quick-services" className="mb-3 text-lg font-bold text-slate-900">Online services</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {QUICK.map((q) => (
            <Link key={q.href} href={q.href}
              className={`press group flex items-center gap-4 rounded-2xl p-5 shadow-soft transition hover:-translate-y-0.5 ${q.primary ? "bg-gov-600 text-white" : "bg-white text-slate-900"}`}>
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${q.primary ? "bg-white/15" : "bg-gov-50 text-gov-600"}`}>
                <q.icon className="h-6 w-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{q.title}</span>
                <span className={`block text-sm ${q.primary ? "text-gov-100" : "text-slate-500"}`}>{q.text}</span>
              </span>
              <ChevronRight className={`h-5 w-5 shrink-0 ${q.primary ? "text-white/70" : "text-slate-300"} transition group-hover:translate-x-0.5`} aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how" className="rounded-[1.25rem] bg-white p-6 shadow-soft sm:p-8">
        <h2 id="how" className="text-lg font-bold text-slate-900">How reporting works</h2>
        <ol className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gov-600 text-white"><s.icon className="h-5 w-5" aria-hidden /></span>
                <span className="text-xs font-semibold uppercase tracking-wider text-gov-600">Step {i + 1}</span>
              </div>
              <h3 className="mt-3 font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Categories (mobile) + assurance */}
      <section className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-[1.25rem] bg-white p-6 shadow-soft lg:hidden">
          <h2 className="text-lg font-bold text-slate-900">What you can report</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {cats.map((c) => <li key={c.value} className="rounded-md bg-gov-50 px-3 py-1.5 text-sm text-gov-800">{c.label}</li>)}
          </ul>
        </div>
        <div className="rounded-[1.25rem] bg-white p-6 shadow-soft">
          <h2 className="text-lg font-bold text-slate-900">Your privacy</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li className="flex gap-3"><EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-gov-600" aria-hidden /> Faces and number plates in photos are blurred automatically where detected.</li>
            <li className="flex gap-3"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gov-600" aria-hidden /> Exact locations and your contact details are visible only to authorised staff.</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gov-600" aria-hidden /> Every finding is decided by an authorised inspector, not by software alone.</li>
          </ul>
        </div>
        <div className="rounded-[1.25rem] bg-white p-6 shadow-soft">
          <h2 className="text-lg font-bold text-slate-900">For departments and contractors</h2>
          <ul className="mt-4 divide-y divide-slate-100">
            {MODULES.map((m) => (
              <li key={m.title} className="flex gap-4 py-3 first:pt-0 last:pb-0">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gov-50 text-gov-600"><m.icon className="h-5 w-5" aria-hidden /></span>
                <span>
                  <span className="block font-semibold text-slate-900">{m.title}</span>
                  <span className="block text-sm text-slate-500">{m.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link href="/login" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-gov-600 hover:underline">Staff sign in <ChevronRight className="h-4 w-4" aria-hidden /></Link>
        </div>
      </section>

      {/* Emergency */}
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-red-200 bg-red-50 px-6 py-4" aria-label="Emergency">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-red-600 text-white"><PhoneCall className="h-5 w-5" aria-hidden /></span>
        <p className="flex-1 text-sm text-red-900">
          <strong>Immediate danger?</strong> This portal is not monitored around the clock. In an emergency, call <a href="tel:112" className="font-bold underline">112</a>.
        </p>
      </section>

      {/* Footer */}
      <footer className="rounded-[1.25rem] bg-slate-900 px-6 py-8 text-slate-300 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-lg font-bold text-white">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gov-600"><Footprints className="h-4 w-4" aria-hidden /></span> TenjiCheck
            </p>
            <p className="mt-1 text-sm text-slate-400">Accessible Paths Portal</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <Link href="/report" className="hover:text-white">Report an issue</Link>
            <Link href="/report/status" className="hover:text-white">Track a report</Link>
            <Link href="/login" className="hover:text-white">Sign in</Link>
          </nav>
        </div>
        <p className="mt-6 border-t border-white/10 pt-4 text-xs text-slate-500">
          TenjiCheck supports inspection and reporting. It does not certify accessibility compliance.
        </p>
      </footer>
    </div>
  );
}
