"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FindingTable } from "@/components/FindingTable";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Card, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { api, downloadFile } from "@/lib/api";
import type { Finding, InspectionSummary } from "@/lib/types";

export default function TasksPage() {
  return <RoleGate roles={["contractor", "admin"]}>{() => <Tasks />}</RoleGate>;
}

function Tasks() {
  const toast = useToast();
  const [rows, setRows] = useState<Finding[] | null>(null);
  const [insps, setInsps] = useState<InspectionSummary[]>([]);
  useEffect(() => {
    api<Finding[]>("/contractor/tasks").then(setRows).catch((e) => { toast.error(e); setRows([]); });
    api<InspectionSummary[]>("/inspections").then(setInsps).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!rows) return <Spinner />;
  const todo = rows.filter((r) => r.status === "fix_required");
  const waiting = rows.filter((r) => r.status === "awaiting_reinspection");
  return (
    <>
      <PageHeader eyebrow="Inspect" title="My fix tasks" subtitle="Punch-list items assigned to you. Each one closes only after you submit a repair photo and an inspector verifies it." />
      <div className="space-y-6">
        <Card title={`Fix required (${todo.length})`}><FindingTable rows={todo} empty="No open fixes — nice work" /></Card>
        <Card title={`Awaiting reinspection (${waiting.length})`}><FindingTable rows={waiting} empty="Nothing waiting for an inspector" /></Card>
        <Card title="Punch lists for my inspections">
          {!insps.length ? <EmptyState title="No inspections assigned to you" /> : (
            <ul className="divide-y">
              {insps.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/inspect/${i.id}`} className="font-medium underline-offset-2 hover:underline">{i.project_name} · {i.title}</Link>
                  <PunchLink id={i.id} onError={toast.error} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function PunchLink({ id, onError }: { id: number; onError: (e: unknown) => void }) {
  const [latest, setLatest] = useState<{ pdf_url: string; version: number } | null | undefined>(undefined);
  useEffect(() => { api<{ pdf_url: string; version: number }[]>(`/inspections/${id}/punch-lists`).then((l) => setLatest(l[0] || null)).catch(() => setLatest(null)); }, [id]);
  if (latest === undefined) return null;
  if (!latest) return <span className="text-xs text-slate-500">No punch list yet</span>;
  return (
    <button className="text-sm font-semibold text-teal-700 underline" onClick={() => downloadFile(latest.pdf_url.replace("/api/v1", ""), `punch-list-v${latest.version}.pdf`, true).catch(onError)}>
      Punch list v{latest.version} (PDF)
    </button>
  );
}
