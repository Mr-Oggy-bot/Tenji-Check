"use client";

import { useEffect, useMemo, useState } from "react";
import { FindingTable } from "@/components/FindingTable";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Notice, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { Finding } from "@/lib/types";

const TABS = [
  { key: "review", label: "Needs review", states: ["ai_proposed", "under_review"] },
  { key: "reinspect", label: "Awaiting reinspection", states: ["awaiting_reinspection"] },
  { key: "close", label: "Verified — ready to close", states: ["verified"] },
];

export default function ReviewPage() {
  return <RoleGate roles={["admin", "inspector"]}>{() => <Queue />}</RoleGate>;
}

function Queue() {
  const toast = useToast();
  const [rows, setRows] = useState<Finding[] | null>(null);
  const [tab, setTab] = useState("review");
  useEffect(() => {
    api<Finding[]>("/review/queue").then(setRows).catch((e) => { toast.error(e); setRows([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const current = TABS.find((t) => t.key === tab)!;
  const shown = useMemo(() => (rows || []).filter((f) => current.states.includes(f.status)), [rows, current]);
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader eyebrow="Inspect" title="Review queue" subtitle="Every AI proposal must be confirmed or rejected here before it can reach a punch list. Verify-on-site items are listed first." />
      <div role="tablist" aria-label="Queue" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const n = rows.filter((f) => t.states.includes(f.status)).length;
          return (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`min-h-[40px] rounded-full px-4 text-sm font-medium ${tab === t.key ? "bg-ink-900 text-white" : "bg-white text-ink-800 ring-1 ring-slate-200"}`}>
              {t.label} ({n})
            </button>
          );
        })}
      </div>
      {tab === "review" && <div className="mb-4"><Notice tone="slate">Confidence values are model/rule scores, not probabilities. Check the evidence photo before deciding.</Notice></div>}
      <FindingTable rows={shown} empty="Nothing waiting here" />
    </>
  );
}
