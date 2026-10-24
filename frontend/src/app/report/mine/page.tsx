"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { Card, EmptyState, LinkButton, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, ISSUE_STATUS } from "@/lib/labels";
import type { Issue } from "@/lib/types";

export default function MyReports() {
  return <RoleGate>{() => <List />}</RoleGate>;
}

function List() {
  const [rows, setRows] = useState<Issue[] | null>(null);
  useEffect(() => { api<Issue[]>("/issues/mine").then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader eyebrow="Report" title="My reports" actions={<LinkButton href="/report">New report</LinkButton>} />
      <Card>
        {!rows.length ? <EmptyState title="You have not submitted any reports yet" /> : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <Link href={`/report/status?ref=${r.reference}`} className="font-mono font-semibold underline-offset-2 hover:underline">{r.reference}</Link>
                  <p className="text-sm text-slate-600">{r.category_label} · {fmtDate(r.created_at)}</p>
                </div>
                <StatusBadge status={r.status} map={ISSUE_STATUS} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
