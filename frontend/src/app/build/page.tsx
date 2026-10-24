"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Button, Card, DemoBadge, EmptyState, Field, inputCls, Modal, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, SURVEY_STATUS } from "@/lib/labels";
import type { Survey } from "@/lib/types";

export default function BuildPage() {
  return <RoleGate roles={["admin", "inspector", "engineer", "contractor"]}>{() => <Surveys />}</RoleGate>;
}

function Surveys() {
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<Survey[] | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Survey[]>("/surveys").then(setRows).catch((e) => { toast.error(e); setRows([]); }); }, [toast]);

  async function create() {
    setBusy(true);
    try {
      const s = await api<Survey>("/surveys", { body: { title } });
      router.push(`/build/${s.id}`);
    } catch (e) { toast.error(e); setBusy(false); }
  }

  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader eyebrow="Build" title="Site surveys" subtitle="Walk a proposed site, record GPS and observations, then generate draft corridors for engineering approval."
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New survey</Button>} />
      <Card>
        {!rows.length ? <EmptyState title="No surveys yet" action={<Button onClick={() => setOpen(true)}>Start a survey</Button>} /> : (
          <ul className="divide-y">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/build/${s.id}`} className="font-semibold underline-offset-2 hover:underline">{s.title}</Link> <DemoBadge show={s.is_demo} />
                  <p className="text-sm text-slate-500">{s.created_by} · {fmtDate(s.started_at)} · {s.point_count} GPS points · {s.observation_count} observations</p>
                </div>
                <StatusBadge status={s.status} map={SURVEY_STATUS} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New site survey"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} loading={busy} disabled={title.trim().length < 2}>Create and open</Button></>}>
        <Field label="Survey title" required>{(id) => <input id={id} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hostel gate to academic block" />}</Field>
      </Modal>
    </>
  );
}
