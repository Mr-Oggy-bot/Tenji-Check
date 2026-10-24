"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const SERIES = "#2a78d6";

/** Single-series horizontal bar chart with hover tooltip and an accessible table view. */
export function BarList({ title, data, unit = "" }: { title: string; data: { label: string; count: number }[]; unit?: string }) {
  if (!data.length) return <p className="py-6 text-center text-sm text-slate-500">No data in this period.</p>;
  const height = Math.max(120, data.length * 34 + 30);
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke="#e2e8f0" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: "rgba(42,120,214,.08)" }} formatter={(v: number) => [`${v}${unit}`, "Count"]}
              contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
            <Bar dataKey="count" fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={22}
              label={{ position: "right", fontSize: 11, fill: "#334155" }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-teal-700">View as table</summary>
        <table className="mt-1 w-full">
          <tbody>{data.map((d) => <tr key={d.label} className="border-t"><td className="py-1">{d.label}</td><td className="text-right">{d.count}{unit}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
