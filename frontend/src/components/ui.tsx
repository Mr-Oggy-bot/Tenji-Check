"use client";

import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import type { Tone } from "@/lib/labels";

type BtnVariant = "primary" | "secondary" | "danger" | "ghost" | "success";

const BTN: Record<BtnVariant, string> = {
  primary: "bg-gov-600 text-white shadow-sm hover:bg-gov-700 focus-visible:ring-gov-500",
  secondary: "bg-white text-gov-700 border border-gov-200 hover:bg-gov-50 focus-visible:ring-gov-500",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
  success: "bg-teal-600 text-white hover:bg-teal-700 focus-visible:ring-teal-500",
  ghost: "text-gov-700 hover:bg-gov-50 focus-visible:ring-gov-500",
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${BTN[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", children, className = "" }: { href: string; variant?: BtnVariant; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${BTN[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ children, className = "", title, actions }: { children: React.ReactNode; className?: string; title?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-200/70 bg-white shadow-soft ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          {title && <h2 className="text-base font-semibold text-ink-900">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const TONE: Record<Tone, string> = {
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  teal: "bg-teal-50 text-teal-800 ring-teal-100",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
};

export function Badge({ tone = "slate", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]} ${className}`}>{children}</span>;
}

export function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; tone: Tone }> }) {
  const s = map[status] || { label: status, tone: "slate" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string; children: (id: string) => React.ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-ink-900">
        {label} {required && <span className="text-red-600" aria-hidden>*</span>}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputCls =
  "block w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-ink-900 shadow-sm placeholder:text-slate-400 focus:border-gov-500 focus:outline-none focus:ring-2 focus:ring-gov-500/25";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-gov-200 bg-gov-50/40 px-6 py-10 text-center">
      <Inbox className="mb-2 h-8 w-8 text-gov-300" aria-hidden />
      <p className="font-medium text-ink-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "amber", title, children }: { tone?: "amber" | "red" | "teal" | "slate"; title?: string; children: React.ReactNode }) {
  const cls = {
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    red: "border-red-200 bg-red-50 text-red-900",
    teal: "border-teal-100 bg-teal-50 text-teal-900",
    slate: "border-slate-200 bg-slate-50 text-slate-800",
  }[tone];
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`} role={tone === "red" ? "alert" : "note"}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-gov-600">{eyebrow}</p>}
        <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink-950/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-xl sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} className="rounded p-2 hover:bg-slate-100" aria-label="Close dialog">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "teal" | "amber" | "red" }) {
  const c = tone === "teal" ? "text-teal-700" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-ink-900";
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-soft">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${c}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function DemoBadge({ show }: { show?: boolean }) {
  return show ? <Badge tone="amber">Demo data</Badge> : null;
}
