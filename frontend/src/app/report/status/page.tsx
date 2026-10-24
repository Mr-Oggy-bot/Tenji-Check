"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Card, Field, inputCls, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, ISSUE_STATUS } from "@/lib/labels";

interface Tracked {
  reference: string;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
  history: { status: string; at: string }[];
  rejection_reason: string | null;
}

function Status() {
  const initial = useSearchParams().get("ref") || "";
  const [ref, setRef] = useState(initial);
  const [data, setData] = useState<Tracked | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function lookup(r = ref) {
    if (!r.trim()) return;
    setBusy(true);
    setErr("");
    try {
      setData(await api<Tracked>(`/issues/track/${encodeURIComponent(r.trim())}`));
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "Lookup failed");
    } finally { setBusy(false); }
  }
  useEffect(() => {
    if (initial) lookup(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader eyebrow="Report" title="Track a report" />
      <Card>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
          <div className="min-w-[220px] flex-1">
            <Field label="Reference number">{(id) => <input id={id} className={`${inputCls} font-mono uppercase`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="TC-2610-ABC123" />}</Field>
          </div>
          <Button type="submit" loading={busy}>Look up</Button>
        </form>
      </Card>
      {err && <Notice tone="red">{err}</Notice>}
      {data && (
        <Card title={<span className="font-mono">{data.reference}</span>} actions={<StatusBadge status={data.status} map={ISSUE_STATUS} />}>
          <p className="text-sm text-slate-600">{data.category} · submitted {fmtDate(data.created_at)}</p>
          {data.rejection_reason && <div className="mt-3"><Notice tone="slate" title="Closed without action">{data.rejection_reason}</Notice></div>}
          <ol className="mt-4 space-y-3 border-l-2 border-slate-200 pl-4">
            {data.history.map((h, i) => (
              <li key={i} className="text-sm"><StatusBadge status={h.status} map={ISSUE_STATUS} /> <span className="text-slate-500">{fmtDate(h.at)}</span></li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

export default function StatusPage() {
  return <Suspense><Status /></Suspense>;
}
