"use client";

import { Bell, CloudOff, Footprints, Home, LogIn, LogOut, Megaphone, Menu, Sparkles, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ROLE_LABEL, useAuth } from "@/lib/auth";
import { flushQueue, listQueued, onQueueChange } from "@/lib/offline";
import { myWork, SECTIONS, type Viewer } from "@/lib/services";
import { useAssistant } from "./assistant/AssistantContext";
import { ServiceSearch } from "./ServiceSearch";
import { useToast } from "./toast";

const isActive = (path: string, href: string) =>
  href === "/" ? path === "/" : path === href || (path.startsWith(href + "/") && href !== "/report");

function NavLinks({ role, onNavigate }: { role: Viewer; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {SECTIONS.map((sec) => {
        const items = sec.items.filter((i) => i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={sec.title || "root"}>
            {sec.title && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{sec.title}</p>}
            <ul className="space-y-0.5">
              {items.map((i) => {
                const active = isActive(path, i.href);
                const Icon = i.icon;
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`press flex min-h-[42px] items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? "bg-gov-600 text-white shadow-sm" : "text-slate-600 hover:bg-gov-50 hover:text-gov-700"}`}
                    >
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function OfflineIndicator() {
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const refresh = useCallback(() => listQueued().then((q) => setQueued(q.length)), []);
  const sync = useCallback(async () => {
    setBusy(true);
    const r = await flushQueue();
    setBusy(false);
    if (r.sent) toast.success(`Synced ${r.sent} offline upload(s)`);
    if (r.failed) toast.error(`${r.failed} upload(s) could not be synced yet`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const off = onQueueChange(refresh);
    const on = () => {
      setOnline(true);
      sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", down);
    return () => {
      off();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", down);
    };
  }, [refresh, sync]);
  if (online && queued === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900" role="status">
      <CloudOff className="h-4 w-4" aria-hidden />
      {!online ? "Offline" : "Online"} · {queued} unsynced
      {online && queued > 0 && (
        <button onClick={sync} disabled={busy} className="ml-1 rounded-full bg-amber-900 px-2 py-0.5 text-white">
          {busy ? "Syncing…" : "Sync now"}
        </button>
      )}
    </div>
  );
}

function AssistantButton() {
  const { allowed, open, toggle } = useAssistant();
  if (!allowed) return null;
  return (
    <button onClick={toggle} aria-expanded={open}
      className={`press flex min-h-[40px] items-center gap-2 rounded-full px-3 text-sm font-medium transition sm:px-4 ${open ? "bg-gov-600 text-white" : "bg-gov-50 text-gov-700 hover:bg-gov-100"}`}>
      <Sparkles className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Ask TenjiCheck</span><span className="sr-only sm:hidden">Ask TenjiCheck</span>
    </button>
  );
}

type Note = { href: string; text: string; count: number };

/** Bell with what needs attention for this role; loaded when opened. */
function Notifications({ role }: { role: Viewer }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const staff = role === "admin" || role === "inspector" || role === "engineer";

  useEffect(() => {
    if (!open || notes) return;
    if (!staff) { setNotes([]); return; }
    Promise.allSettled([
      api<{ issues: { open: number }; findings: { by_status: { key: string; count: number }[] } }>("/dashboard/summary"),
      api<{ counts: Record<string, number> }>("/schedules"),
    ]).then(([s, sc]) => {
      const out: Note[] = [];
      if (s.status === "fulfilled") {
        const pending = s.value.findings.by_status.filter((b) => ["ai_proposed", "under_review"].includes(b.key)).reduce((a, b) => a + b.count, 0);
        out.push({ href: "/review", text: "findings awaiting review", count: pending });
        out.push({ href: "/reports", text: "open public reports", count: s.value.issues.open });
      }
      if (sc.status === "fulfilled") {
        out.push({ href: "/schedule", text: "inspections overdue", count: sc.value.counts.overdue ?? 0 });
        out.push({ href: "/schedule", text: "inspections due soon", count: sc.value.counts.due_soon ?? 0 });
      }
      setNotes(out);
    });
  }, [open, notes, staff]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (role === "anon") return null;
  const active = notes?.filter((n) => n.count > 0) ?? [];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen((o) => !o); setNotes(null); }} aria-expanded={open} aria-label="Notifications"
        className="press grid h-10 w-10 place-items-center rounded-full text-slate-700 hover:bg-gov-50">
        <Bell className="h-5 w-5" />
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-slate-100 bg-white p-2 shadow-xl">
          <p className="px-3 pb-1 pt-2 text-sm font-semibold text-slate-900">Notifications</p>
          {!notes ? <p className="px-3 py-3 text-sm text-slate-500">Loading…</p> : active.length ? (
            <ul>
              {active.map((n) => (
                <li key={n.text}>
                  <Link href={n.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-gov-50">
                    <span className="grid h-7 min-w-[28px] place-items-center rounded-full bg-gov-600 px-2 text-xs font-semibold text-white">{n.count}</span>
                    {n.text}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="px-3 py-3 text-sm text-slate-500">You are all caught up.</p>}
        </div>
      )}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

/** Phone-style bottom tab bar (hidden on large screens, where the sidebar is shown). */
function BottomTabs({ role }: { role: Viewer }) {
  const path = usePathname();
  const work = myWork(role);
  const tabs = [
    { href: "/", label: "Home", icon: Home },
    { href: "/report", label: "Report", icon: Megaphone },
    { href: work.href, label: work.label, icon: ListIcon },
    { href: role === "anon" ? "/login" : "/account", label: role === "anon" ? "Sign in" : "Account", icon: role === "anon" ? LogIn : User },
  ];
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {tabs.map((t) => {
          const active = t.href === "/" ? path === "/" : path === t.href || path.startsWith(t.href + "/");
          return (
            <li key={t.label}>
              <Link href={t.href} aria-current={active ? "page" : undefined}
                className={`press flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? "text-gov-600" : "text-slate-500"}`}>
                <t.icon className="h-5 w-5" aria-hidden />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ListIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const role: Viewer = user?.role ?? "anon";

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const brand = (
    <Link href="/" className="flex items-center gap-3" aria-label="TenjiCheck home">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-gov-600 text-white shadow-sm">
        <Footprints className="h-5 w-5" aria-hidden />
      </span>
      <span>
        <span className="block text-lg font-bold leading-none text-slate-900">TenjiCheck</span>
        <span className="text-[11px] text-slate-500">Accessible Paths Portal</span>
      </span>
    </Link>
  );

  const sidebar = (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white px-3 py-5">
      <div className="mb-6 px-2">{brand}</div>
      <div className="-mx-1 flex-1 overflow-y-auto px-1">{!loading && <NavLinks role={role} onNavigate={() => setOpen(false)} />}</div>
      <div className="mt-4 rounded-2xl bg-slate-50 p-3">
        {user ? (
          <div className="flex items-center gap-3">
            <Link href="/account" onClick={() => setOpen(false)} className="flex min-w-0 flex-1 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gov-100 text-sm font-semibold text-gov-800" aria-hidden>{initials(user.display_name)}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">{user.display_name}</span>
                <span className="block text-xs text-slate-500">{ROLE_LABEL[user.role]}</span>
              </span>
            </Link>
            <button onClick={logout} className="press grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-white hover:text-slate-900" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <Link href="/login" className="flex min-h-[40px] items-center gap-2 px-2 text-sm font-medium text-gov-700">
            <LogIn className="h-4 w-4" aria-hidden /> Sign in
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[3000] focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-[1500] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[19rem] max-w-[85vw] overflow-hidden rounded-r-3xl">{sidebar}</div>
          <button className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white" onClick={() => setOpen(false)} aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200/70 bg-white/90 px-3 backdrop-blur sm:px-6">
          <button className="press grid h-10 w-10 place-items-center rounded-full text-slate-800 hover:bg-gov-50 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-6 w-6" />
          </button>
          <span className="text-base font-bold text-slate-900 lg:hidden">TenjiCheck</span>
          {!loading && <ServiceSearch viewer={role} className="hidden w-full max-w-md md:block" />}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <OfflineIndicator />
            <AssistantButton />
            {!loading && <Notifications role={role} />}
            {user ? (
              <Link href="/account" className="press hidden h-10 items-center gap-2 rounded-full pl-1 pr-3 hover:bg-gov-50 sm:flex" title={ROLE_LABEL[user.role]}>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-gov-600 text-xs font-semibold text-white" aria-hidden>{initials(user.display_name)}</span>
                <span className="text-xs font-medium text-slate-600">{ROLE_LABEL[user.role]}</span>
              </Link>
            ) : (
              !loading && <Link href="/login" className="press hidden min-h-[40px] items-center rounded-full bg-gov-600 px-4 text-sm font-semibold text-white sm:flex">Login</Link>
            )}
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>
      {!loading && <BottomTabs role={role} />}
    </div>
  );
}
