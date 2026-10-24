// Building blocks for the formal portal look (white cards, blue actions) used by the shell, home and newer pages.
import { Loader2 } from "lucide-react";

export function SoftCard({ children, className = "", as: Tag = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" }) {
  return <Tag className={`rounded-3xl bg-white p-5 shadow-soft sm:p-6 ${className}`}>{children}</Tag>;
}

export function RoundIcon({ children, tone = "light" }: { children: React.ReactNode; tone?: "light" | "volt" | "dark" }) {
  const cls = tone === "volt" ? "bg-gov-600 text-white" : tone === "dark" ? "bg-gov-800 text-white" : "bg-gov-50 text-gov-700";
  return <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${cls}`}>{children}</span>;
}

/** Labelled figure; tone carries no meaning on its own, the label does. */
export function Pill({ label, value, tone }: { label: string; value: React.ReactNode; tone: "dark" | "volt" | "hatch" | "outline" }) {
  const cls = {
    dark: "bg-gov-700 text-white",
    volt: "bg-gov-600 text-white",
    hatch: "hatch bg-white text-gov-800 ring-1 ring-inset ring-gov-100",
    outline: "bg-white text-gov-800 ring-1 ring-inset ring-gov-200",
  }[tone];
  return (
    <div className={`rounded-2xl px-4 py-3 shadow-soft ${cls}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export function PillButton({ children, tone = "light", className = "", loading, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "light" | "dark" | "volt" | "danger"; loading?: boolean }) {
  const cls = {
    light: "bg-white text-gov-700 ring-1 ring-inset ring-gov-200 hover:bg-gov-50",
    dark: "bg-gov-600 text-white shadow-sm hover:bg-gov-700",
    volt: "bg-gov-600 text-white shadow-sm hover:bg-gov-700",
    danger: "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200 hover:bg-red-100",
  }[tone];
  return (
    <button {...props} disabled={props.disabled || loading}
      className={`press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gov-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function SoftHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const softInput =
  "block w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-gov-500 focus:outline-none focus:ring-2 focus:ring-gov-500/25";

/** Semicircle gauge. value is a 0–1 share, or null when there is no data. */
export function Gauge({ value, label }: { value: number | null; label: string }) {
  const r = 80;
  const len = Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const gap = v > 0 && v < 1 ? 26 : 0; // room for both round caps plus a visible gap
  const filled = Math.max(0, v * len - gap / 2);
  const pct = value == null ? "–" : `${Math.round(v * 100)}%`;
  return (
    <figure className="my-2 w-full max-w-[260px]">
      <svg viewBox="0 0 200 112" className="w-full" role="img" aria-label={`${pct}. ${label}`}>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#dbe7f9" strokeWidth="18" strokeLinecap="round"
          strokeDasharray={`${Math.max(0, len - filled - gap)} ${len}`} strokeDashoffset={-(filled + gap)} />
        {v > 0 && <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#0b5cbf" strokeWidth="18" strokeLinecap="round" strokeDasharray={`${filled} ${len}`} />}
        <text x="100" y="92" textAnchor="middle" className="fill-slate-900" style={{ fontSize: 32, fontWeight: 700 }}>{pct}</text>
      </svg>
      <figcaption className="text-center text-sm text-slate-500">{label}</figcaption>
    </figure>
  );
}
