"use client";

import {
  BarChart3, Boxes, CalendarClock, ClipboardCheck, CloudOff, Footprints, Hammer, History, Home, ListChecks, LogIn, LogOut, Map,
  Megaphone, Menu, Route, Ruler, ScanLine, Search, ShieldCheck, Sparkles, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ROLE_LABEL, useAuth } from "@/lib/auth";
import { flushQueue, listQueued, onQueueChange } from "@/lib/offline";
import type { Role } from "@/lib/types";
import { useAssistant } from "./assistant/AssistantContext";
import { useToast } from "./toast";

type Item = { href: string; label: string; icon: React.ElementType; roles?: (Role | "anon")[] };
const STAFF: Role[] = ["admin", "inspector", "engineer"];

const SECTIONS: { title: string; items: Item[] }[] = [
  { title: "", items: [{ href: "/", label: "Home", icon: Home, roles: ["admin", "inspector", "engineer", "contractor", "citizen", "anon"] }] },
  {
    title: "Inspect",
    items: [
      { href: "/inspect", label: "Inspections", icon: ClipboardCheck, roles: STAFF },
      { href: "/review", label: "Review queue", icon: ShieldCheck, roles: ["admin", "inspector"] },
      { href: "/schedule", label: "Inspection schedule", icon: CalendarClock, roles: STAFF },
      { href: "/history", label: "Site history", icon: History, roles: ["admin", "inspector", "engineer", "contractor"] },
      { href: "/tasks", label: "My fix tasks", icon: Hammer, roles: ["contractor", "admin"] },
    ],
  },
  {
    title: "Build",
    items: [
      { href: "/build", label: "Site surveys", icon: Route, roles: ["admin", "inspector", "engineer", "contractor"] },
      { href: "/live", label: "Live path planner", icon: ScanLine, roles: ["admin", "inspector", "engineer", "contractor"] },
      { href: "/planning", label: "Planning & Estimation", icon: Ruler, roles: ["admin", "inspector", "engineer", "contractor"] },
    ],
  },
  {
    title: "Report",
    items: [
      { href: "/report", label: "Report an issue", icon: Megaphone, roles: ["citizen", "anon", "admin", "inspector", "engineer", "contractor"] },
      { href: "/report/status", label: "Track a report", icon: Search, roles: ["citizen", "anon"] },
      { href: "/report/mine", label: "My reports", icon: ListChecks, roles: ["citizen"] },
      { href: "/reports", label: "Report queue", icon: ListChecks, roles: ["admin", "inspector", "engineer"] },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/map", label: "Shared map", icon: Map, roles: ["admin", "inspector", "engineer", "contractor", "citizen"] },
      { href: "/dashboard", label: "Dashboard", icon: BarChart3, roles: STAFF },
      { href: "/models", label: "AI models", icon: Boxes, roles: ["admin", "inspector", "engineer", "contractor"] },
      { href: "/admin/users", label: "Users", icon: Users, roles: ["admin"] },
    ],
  },
];

function NavLinks({ role, onNavigate }: { role: Role | "anon"; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {SECTIONS.map((sec) => {
        const items = sec.items.filter((i) => !i.roles || i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={sec.title || "root"}>
            {sec.title && <p className="mb-1.5 px-4 text-[11px] uppercase tracking-[0.16em] text-mist-400">{sec.title}</p>}
            <ul className="space-y-0.5">
              {items.map((i) => {
                const active = i.href === "/" ? path === "/" : path === i.href || (path.startsWith(i.href + "/") && i.href !== "/report");
                const Icon = i.icon;
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-[40px] items-center gap-3 rounded-full px-4 py-2 text-sm transition ${active ? "bg-volt-400 font-medium text-mist-900" : "text-mist-200 hover:bg-white/10 hover:text-white"}`}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
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
      className={`flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm transition ${open ? "bg-mist-900 text-white" : "bg-white/80 text-mist-900 hover:bg-white"}`}>
      <Sparkles className={`h-4 w-4 ${open ? "text-volt-400" : ""}`} aria-hidden /> Ask TenjiCheck
    </button>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const role: Role | "anon" = user?.role ?? "anon";

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const sidebar = (
    <div className="flex h-full flex-col rounded-4xl bg-mist-900 px-3 py-5 font-display text-white shadow-soft">
      <Link href="/" className="mb-7 flex items-center gap-3 px-3" aria-label="TenjiCheck home">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-volt-400 text-mist-900">
          <Footprints className="h-5 w-5" aria-hidden />
        </span>
        <span>
          <span className="block text-xl font-light leading-none">TenjiCheck</span>
          <span className="text-[11px] text-mist-400">Inspect · Build · Report</span>
        </span>
      </Link>
      <div className="-mx-1 flex-1 overflow-y-auto px-1">{!loading && <NavLinks role={role} onNavigate={() => setOpen(false)} />}</div>
      <div className="mt-4 rounded-3xl bg-white/5 p-3">
        {user ? (
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mist-200 text-sm font-medium text-mist-900" aria-hidden>{initials(user.display_name)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{user.display_name}</p>
              <p className="text-xs text-mist-400">{ROLE_LABEL[user.role]}</p>
            </div>
            <button onClick={logout} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-mist-200 hover:bg-white/20 hover:text-white" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <Link href="/login" className="flex min-h-[40px] items-center gap-2 px-2 text-sm text-mist-200 hover:text-white">
            <LogIn className="h-4 w-4" aria-hidden /> Sign in
          </Link>
        )}
      </div>
      <p className="mt-3 px-3 text-[11px] leading-snug text-mist-500">TenjiCheck screens. The engineer decides.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-mist-200">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[3000] focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 p-3 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-[1500] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-mist-900/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[19rem] max-w-[85vw] p-2">{sidebar}</div>
          <button className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white" onClick={() => setOpen(false)} aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-mist-200/85 px-4 font-display backdrop-blur sm:px-6">
          <button className="grid h-11 w-11 place-items-center rounded-full bg-white/80 hover:bg-white lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-lg font-light text-mist-900 lg:hidden">TenjiCheck</span>
          <div className="ml-auto flex items-center gap-2">
            <OfflineIndicator />
            <AssistantButton />
            {user && <span className="hidden rounded-full bg-white/60 px-3 py-1.5 text-xs text-mist-700 sm:inline">{ROLE_LABEL[user.role]}</span>}
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-4 pb-10 pt-2 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
