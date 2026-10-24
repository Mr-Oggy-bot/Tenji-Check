"use client";

import Link from "next/link";
import { FINDING_STATUS, fmtDate } from "@/lib/labels";
import type { Finding } from "@/lib/types";
import { Badge, EmptyState, StatusBadge } from "./ui";

export function FindingTable({ rows, empty }: { rows: Finding[]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((f) => (
        <li key={f.id}>
          <Link href={`/findings/${f.id}`} className="flex h-full gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-card transition hover:border-teal-400">
            {f.media && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.media.annotated_url || f.media.url} alt="" className="h-24 w-24 shrink-0 rounded object-cover" />
            )}
            <div className="min-w-0 space-y-1">
              <p className="truncate font-semibold">F-{f.id} {f.label}</p>
              <p className="truncate text-xs text-slate-500">{f.project_name} · {f.inspection_title}</p>
              <div className="flex flex-wrap gap-1">
                <StatusBadge status={f.status} map={FINDING_STATUS} />
                <Badge tone={f.source === "ai" ? "violet" : "blue"}>{f.source === "ai" ? "AI" : "Manual"}</Badge>
                {f.verify_on_site && <Badge tone="amber">Verify on site</Badge>}
              </div>
              <p className="text-xs text-slate-400">{fmtDate(f.created_at)}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
