"use client";

// Native generative-UI components the assistant can render in chat. Props may arrive partially while streaming.
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const card = "my-2 rounded-3xl bg-white p-4 font-display text-mist-900 shadow-soft";

export function StatCards({ title, items }: { title?: string; items?: { label: string; value: string | number; hint?: string }[] }) {
  return (
    <div className={card}>
      {title && <p className="mb-2 text-sm text-mist-600">{title}</p>}
      <div className="grid grid-cols-2 gap-2">
        {(items ?? []).map((s, i) => (
          <div key={i} className={`rounded-2xl p-3 ${i === 0 ? "bg-volt-400" : "bg-mist-100"}`}>
            <p className="text-xs text-mist-700">{s.label}</p>
            <p className="text-2xl font-light">{s.value}</p>
            {s.hint && <p className="text-[11px] text-mist-600">{s.hint}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarChartCard({ title, description, unit, data }: { title?: string; description?: string; unit?: string; data?: { label: string; value: number }[] }) {
  const rows = (data ?? []).filter((d) => d && typeof d.value === "number");
  return (
    <figure className={card}>
      <figcaption>
        <p className="text-base">{title}</p>
        {description && <p className="text-xs text-mist-600">{description}</p>}
      </figcaption>
      {rows.length ? (
        <div className="mt-2 h-56" role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 18, right: 4, bottom: 0, left: -18 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5d6269" }} tickLine={false} axisLine={{ stroke: "#c3c7cc" }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5d6269" }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "#e9ebed" }} formatter={(v) => [`${v}${unit ? ` ${unit}` : ""}`, title]} contentStyle={{ borderRadius: 12, border: "1px solid #d9dce0", fontSize: 12 }} />
              <Bar dataKey="value" fill="#33363a" radius={[4, 4, 0, 0]} maxBarSize={40}>
                {rows.length <= 8 && <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: "#26292c" }} />}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-mist-600">No data</p>
      )}
    </figure>
  );
}

export function TableCard({ title, columns, rows }: { title?: string; columns?: string[]; rows?: (string | number | null)[][] }) {
  return (
    <div className={card}>
      <p className="mb-2 text-base">{title}</p>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-mist-600">
            <tr>{(columns ?? []).map((c, i) => <th key={i} className="px-2 py-1.5 font-medium">{c}</th>)}</tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r, i) => (
              <tr key={i} className="border-t border-mist-100">
                {(r ?? []).map((v, j) => <td key={j} className="px-2 py-1.5 align-top">{v ?? "–"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const internal = (href: string) => typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.includes("\\");

export function LinkCards({ items }: { items?: { label: string; href: string; description?: string }[] }) {
  const ok = (items ?? []).filter((i) => i && internal(i.href));
  return (
    <div className="my-2 grid gap-2 font-display">
      {ok.map((i) => (
        <Link key={i.href + i.label} href={i.href} className="flex items-center justify-between gap-3 rounded-2xl bg-mist-900 px-4 py-3 text-white hover:bg-mist-800">
          <span>
            <span className="block text-sm">{i.label}</span>
            {i.description && <span className="block text-xs text-mist-300">{i.description}</span>}
          </span>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-volt-400 text-mist-900"><ArrowUpRight className="h-4 w-4" aria-hidden /></span>
        </Link>
      ))}
    </div>
  );
}
