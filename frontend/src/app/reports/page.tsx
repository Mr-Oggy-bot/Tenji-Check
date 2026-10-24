"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, DemoBadge, EmptyState, inputCls, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api, downloadFile } from "@/lib/api";
import { fmtDate, ISSUE_STATUS } from "@/lib/labels";
import type { Issue } from "@/lib/types";

interface Page { items: Issue[]; total: number; page: number; page_size: number }

export default function ReportsQueue() {
  return <RoleGate roles={["admin", "inspector", "engineer"]}>{() => <Queue />}</RoleGate>;
}

function Queue() {
  const toast = useToast();
  const [cats, setCats] = useState<{ value: string; label: string }[]>([]);
  const [status, setStatus] = useState("submitted,under_review,assigned,in_progress");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [q, setQ] = useState("");
  const [dupes, setDupes] = useState(false);
  const [sort, setSort] = useState("-created_at");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);

  useEffect(() => { api<{ value: string; label: string }[]>("/issues/categories").then(setCats).catch(() => {}); }, []);
  const load = useCallback(() => {
    const p = new URLSearchParams({ sort, page: String(page), page_size: "15" });
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    if (severity) p.set("severity", severity);
    if (q.trim()) p.set("q", q.trim());
    if (dupes) p.set("duplicates_only", "true");
    api<Page>(`/issues?${p}`).then(setData).catch((e) => toast.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, category, severity, q, dupes, sort, page]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => setPage(1), [status, category, severity, q, dupes, sort]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <>
      <PageHeader eyebrow="Report" title="Report queue" subtitle="Public reports to verify, triage and resolve. Possible duplicates are flagged, never deleted."
        actions={<Button variant="secondary" onClick={() => downloadFile("/issues/export.csv", "reports.csv").catch(toast.error)}><Download className="h-4 w-4" /> Export CSV</Button>} />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <input aria-label="Search reference or description" placeholder="Search…" className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Status filter" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="submitted,under_review,assigned,in_progress">All open</option>
            {Object.entries(ISSUE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="">Any status</option>
          </select>
          <select aria-label="Category filter" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select aria-label="Severity filter" className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Any severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
          <select aria-label="Sort" className={inputCls} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="-created_at">Newest first</option><option value="created_at">Oldest first</option>
            <option value="-updated_at">Recently updated</option><option value="severity">Severity</option>
          </select>
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={dupes} onChange={(e) => setDupes(e.target.checked)} /> Possible duplicates</label>
        </div>
        {!data ? <Spinner /> : !data.items.length ? <EmptyState title="No reports match these filters" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-2">Reference</th><th>Category</th><th>Status</th><th>Severity</th><th>Assignee</th><th>Age</th><th>Flags</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="py-3"><Link className="font-mono font-semibold underline-offset-2 hover:underline" href={`/reports/${i.id}`}>{i.reference}</Link></td>
                    <td>{i.category_label}</td>
                    <td><StatusBadge status={i.status} map={ISSUE_STATUS} /></td>
                    <td>{i.severity ? <Badge tone={i.severity === "high" ? "red" : i.severity === "medium" ? "amber" : "slate"}>{i.severity}</Badge> : "—"}</td>
                    <td>{i.assignee || <span className="text-slate-400">—</span>}</td>
                    <td title={fmtDate(i.created_at)}>{i.age_days} d</td>
                    <td className="space-x-1">
                      {i.possible_duplicates.length > 0 && <Badge tone="violet">Possible duplicate</Badge>}
                      {i.lat == null && <Badge tone="slate">No location</Badge>}
                      <DemoBadge show={i.is_demo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
            <span className="text-slate-500">{data.total} report(s) · page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </nav>
        )}
      </Card>
    </>
  );
}
