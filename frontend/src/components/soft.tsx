// Building blocks for the soft-grey / volt look used by the shell, home and the newer pages.
import { Loader2 } from "lucide-react";

export function SoftCard({ children, className = "", as: Tag = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" }) {
  return <Tag className={`rounded-4xl bg-mist-50 p-5 shadow-soft sm:p-6 ${className}`}>{children}</Tag>;
}

export function RoundIcon({ children, tone = "light" }: { children: React.ReactNode; tone?: "light" | "volt" | "dark" }) {
  const cls = tone === "volt" ? "bg-volt-400 text-mist-900" : tone === "dark" ? "bg-mist-900 text-white" : "bg-mist-200 text-mist-900";
  return <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${cls}`}>{children}</span>;
}

/** Labelled value pill (mockup: "Interviews 25%"); tone carries no meaning on its own, the label does. */
export function Pill({ label, value, tone }: { label: string; value: React.ReactNode; tone: "dark" | "volt" | "hatch" | "outline" }) {
  const cls = {
    dark: "bg-mist-900 text-white",
    volt: "bg-volt-400 text-mist-900",
    hatch: "hatch bg-mist-100 text-mist-900",
    outline: "border border-mist-500 text-mist-900",
  }[tone];
  return (
    <div>
      <p className="mb-1 px-1 text-xs text-mist-700">{label}</p>
      <p className={`flex min-h-[48px] items-center rounded-full px-5 text-lg ${cls}`}>{value}</p>
    </div>
  );
}

export function PillButton({ children, tone = "light", className = "", loading, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "light" | "dark" | "volt" | "danger"; loading?: boolean }) {
  const cls = {
    light: "bg-mist-200 text-mist-900 hover:bg-mist-300",
    dark: "bg-mist-900 text-white hover:bg-mist-800",
    volt: "bg-volt-400 text-mist-900 hover:bg-volt-300",
    danger: "bg-red-100 text-red-800 hover:bg-red-200",
  }[tone];
  return (
    <button {...props} disabled={props.disabled || loading}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-mist-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function SoftHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4 px-1">
      <div>
        <h1 className="text-4xl font-light text-mist-900 sm:text-5xl">{title}</h1>
        {subtitle && <div className="mt-2 max-w-3xl text-sm text-mist-700">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const softInput =
  "block w-full min-h-[44px] rounded-2xl border-0 bg-white px-4 py-2 text-sm text-mist-900 ring-1 ring-inset ring-mist-300 placeholder:text-mist-400 focus:outline-none focus:ring-2 focus:ring-mist-900";

/** Semicircle gauge (mockup: "Security status 55%"). value is a 0–1 share, or null when there is no data. */
export function Gauge({ value, label }: { value: number | null; label: string }) {
  const r = 80;
  const len = Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const gap = v > 0 && v < 1 ? 28 : 0; // room for both round caps plus a visible gap
  const filled = Math.max(0, v * len - gap / 2);
  const pct = value == null ? "–" : `${Math.round(v * 100)}%`;
  return (
    <figure className="my-2 w-full max-w-[280px]">
      <svg viewBox="0 0 200 112" className="w-full" role="img" aria-label={`${pct}. ${label}`}>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#33363a" strokeWidth="22" strokeLinecap="round"
          strokeDasharray={`${Math.max(0, len - filled - gap)} ${len}`} strokeDashoffset={-(filled + gap)} />
        {v > 0 && <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#eef21a" strokeWidth="22" strokeLinecap="round" strokeDasharray={`${filled} ${len}`} />}
        <text x="100" y="92" textAnchor="middle" className="fill-mist-900" style={{ fontSize: 34, fontWeight: 300 }}>{pct}</text>
      </svg>
      <figcaption className="text-center text-sm text-mist-700">{label}</figcaption>
    </figure>
  );
}
