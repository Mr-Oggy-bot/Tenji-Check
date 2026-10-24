"use client";

import { CheckCircle2, Download, FileText, PencilRuler, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { CapturePhoto } from "@/components/CapturePhoto";
import { ImageAnnotator } from "@/components/ImageAnnotator";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, DemoBadge, EmptyState, Field, inputCls, Modal, Notice, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api, ApiError, downloadFile } from "@/lib/api";
import { CONTEXT_LABEL, DEFECT_LABEL, FINDING_STATUS, fmtDate } from "@/lib/labels";
import type { InspectionDetail, MediaInfo, User } from "@/lib/types";

const STEPS = ["Capture", "Quality", "Screen", "Rules", "Review", "Punch list", "Repair evidence", "Reinspect & close"];

export default function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RoleGate roles={["admin", "inspector", "engineer", "contractor"]}>{(u) => <Workspace id={Number(id)} user={u} />}</RoleGate>;
}

function Workspace({ id, user }: { id: number; user: User }) {
  const toast = useToast();
  const [data, setData] = useState<InspectionDetail | null>(null);
  const [error, setError] = useState("");
  const [contractors, setContractors] = useState<User[]>([]);
  const [marking, setMarking] = useState<MediaInfo | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const reviewer = ["inspector", "admin"].includes(user.role);
  const capture = ["engineer", "inspector", "admin"].includes(user.role);

  const load = useCallback(async () => {
    try {
      setData(await api<InspectionDetail>(`/inspections/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (capture) api<User[]>("/users?role=contractor").then(setContractors).catch(() => {});
  }, [capture]);
  const pending = data?.photos.some((p) => p.analysis && ["queued", "running"].includes(p.analysis.status));
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [pending, load]);

  async function punchList() {
    setBusy("punch");
    try {
      const pl = await api<{ pdf_url: string; version: number; item_count: number }>(`/inspections/${id}/punch-list`, { method: "POST" });
      toast.success(`Punch list v${pl.version} generated with ${pl.item_count} item(s)`);
      await load();
      downloadFile(pl.pdf_url.replace("/api/v1", ""), `punch-list-${id}-v${pl.version}.pdf`, true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "review_required") toast.error(`${e.message} Open the review queue to decide them.`);
      else toast.error(e);
    } finally { setBusy(""); }
  }

  async function reanalyze(mediaId: number) {
    try {
      await api(`/media/${mediaId}/reanalyze`, { method: "POST" });
      toast.success("Screening re-queued");
      load();
    } catch (e) { toast.error(e); }
  }

  async function assign(cid: string) {
    try {
      await api(`/inspections/${id}`, { method: "PATCH", body: { contractor_id: cid ? Number(cid) : null } });
      toast.success("Contractor updated");
      load();
    } catch (e) { toast.error(e); }
  }

  if (error) return <Notice tone="red">{error}</Notice>;
  if (!data) return <Spinner />;

  const f = data.findings;
  const has = (s: string[]) => f.some((x) => s.includes(x.status));
  const done = [
    data.photos.length > 0,
    data.photos.some((p) => p.quality_ok),
    data.photos.some((p) => p.analysis?.status === "done"),
    data.photos.some((p) => p.analysis?.status === "done"),
    f.length > 0 && data.unreviewed_count === 0,
    data.punch_lists.length > 0,
    has(["awaiting_reinspection", "verified", "closed"]),
    f.length > 0 && f.every((x) => ["closed", "rejected"].includes(x.status)),
  ];
  const handoverDone = data.status === "handover_approved";

  return (
    <>
      <PageHeader eyebrow={data.project_name} title={data.title}
        subtitle={<span className="flex flex-wrap items-center gap-2">{data.site_name} <DemoBadge show={data.is_demo} />
          {handoverDone ? <Badge tone="green" className="max-w-full !whitespace-normal">Handover recorded by {data.handover_by} · {fmtDate(data.handover_at)}</Badge> : <Badge tone="slate">Open</Badge>}</span>}
        actions={<>
          <Button variant="secondary" onClick={() => downloadFile(`/inspections/${id}/export.csv`, `inspection-${id}.csv`).catch(toast.error)}><Download className="h-4 w-4" /> CSV</Button>
          {reviewer && <Button onClick={punchList} loading={busy === "punch"}><FileText className="h-4 w-4" /> Generate punch list</Button>}
          {reviewer && !handoverDone && <Button variant="success" disabled={!data.handover.ready} onClick={() => setHandoverOpen(true)}><ShieldCheck className="h-4 w-4" /> Record handover</Button>}
        </>} />

      <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" aria-label="Inspection workflow progress">
        {STEPS.map((s, i) => (
          <li key={s} className={`rounded-lg border px-3 py-2 text-xs font-medium ${done[i] ? "border-teal-200 bg-teal-50 text-teal-800" : i === 4 && data.unreviewed_count ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-500"}`}>
            <span className="flex items-center gap-1">{done[i] && <CheckCircle2 className="h-3.5 w-3.5" aria-label="done" />}{i + 1} · {s}</span>
          </li>
        ))}
      </ol>

      {data.unreviewed_count > 0 && (
        <div className="mb-4"><Notice title={`${data.unreviewed_count} finding(s) need a reviewer decision`}>
          No punch list can be generated until every AI proposal is confirmed or rejected by an authorised reviewer.
        </Notice></div>
      )}
      {!handoverDone && !data.handover.ready && data.findings.length > 0 && (
        <div className="mb-4"><Notice tone="slate" title="Handover blocked">{data.handover.blocking_reasons.join("; ")}</Notice></div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {capture && !handoverDone && (
            <Card title="Capture a photo"><CapturePhoto inspectionId={id} contextTags={data.context_tags} onUploaded={load} /></Card>
          )}
          <Card title={`Photos (${data.photos.length})`}>
            {!data.photos.length ? <EmptyState title="No photos yet">Capture the first photo of this segment above.</EmptyState> : (
              <div className="grid gap-4 md:grid-cols-2">
                {data.photos.map((p) => (
                  <figure key={p.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.annotated_url || p.url} alt={`Inspection photo ${p.id}${p.annotated_url ? " with AI annotations" : ""}`} className="w-full rounded bg-slate-900 object-contain" style={{ aspectRatio: `${p.width}/${p.height}` }} />
                    <figcaption className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        <Badge tone="slate">{CONTEXT_LABEL[p.context_tag || ""] || p.context_tag}</Badge>
                        {p.segment_label && <Badge tone="slate">{p.segment_label}</Badge>}
                        {!p.quality_ok && <Badge tone="amber">Low quality · manual only</Badge>}
                        {p.lat != null ? <Badge tone="slate">{p.lat.toFixed(5)}, {p.lon?.toFixed(5)}</Badge> : <Badge tone="slate">No GPS</Badge>}
                        {(p.privacy.faces_blurred || 0) + (p.privacy.plates_blurred || 0) > 0 && <Badge tone="teal">{(p.privacy.faces_blurred || 0) + (p.privacy.plates_blurred || 0)} region(s) blurred</Badge>}
                      </div>
                      <AnalysisPanel analysis={p.analysis} />
                      {capture && !handoverDone && (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setMarking(p)}><PencilRuler className="h-4 w-4" /> Mark defect manually</Button>
                          {p.quality_ok && p.analysis?.status !== "running" && <Button variant="ghost" onClick={() => reanalyze(p.id)}><RefreshCw className="h-4 w-4" /> Re-run</Button>}
                        </div>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={`Findings (${f.length})`}>
            {!f.length ? <EmptyState title="No findings">AI candidates and manual findings appear here.</EmptyState> : (
              <ul className="divide-y divide-slate-100">
                {f.map((x) => (
                  <li key={x.id} className="py-3">
                    <Link href={`/findings/${x.id}`} className="group block">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-ink-900 group-hover:underline">
                          {x.punch_item_no ? `#${x.punch_item_no} ` : ""}F-{x.id} {x.label}
                        </span>
                        <StatusBadge status={x.status} map={FINDING_STATUS} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">{x.description}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={x.source === "ai" ? "violet" : "blue"}>{x.source === "ai" ? "AI proposal" : "Manual"}</Badge>
                        {x.confidence != null && <Badge tone="slate">conf {(x.confidence * 100).toFixed(0)}%</Badge>}
                        {x.verify_on_site && <Badge tone="amber">Verify on site</Badge>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Contractor">
            {capture ? (
              <select aria-label="Assigned contractor" className={inputCls} value={data.contractor_id ?? ""} onChange={(e) => assign(e.target.value)} disabled={handoverDone}>
                <option value="">Not assigned</option>
                {contractors.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            ) : <p className="text-sm">{data.contractor || "Not assigned"}</p>}
          </Card>
          <Card title="Punch lists">
            {!data.punch_lists.length ? <p className="text-sm text-slate-500">None generated yet.</p> : (
              <ul className="space-y-2">
                {data.punch_lists.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>v{p.version} · {p.item_count} item(s) · {fmtDate(p.created_at)}<br /><span className="text-xs text-slate-500">by {p.generated_by}</span></span>
                    <Button variant="secondary" onClick={() => downloadFile(p.pdf_url.replace("/api/v1", ""), `punch-list-v${p.version}.pdf`, true).catch(toast.error)}>Open PDF</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="text-xs text-slate-500">{data.handover.statement}</p>
        </div>
      </div>

      {marking && <ManualFindingModal media={marking} inspectionId={id} onClose={() => setMarking(null)} onDone={() => { setMarking(null); load(); }} />}
      <HandoverModal open={handoverOpen} id={id} statement={data.handover.statement} onClose={() => setHandoverOpen(false)} onDone={() => { setHandoverOpen(false); load(); }} />
    </>
  );
}

function ManualFindingModal({ media, inspectionId, onClose, onDone }: { media: MediaInfo; inspectionId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [bbox, setBbox] = useState<number[] | null>(null);
  const [cls, setCls] = useState("obstacle_on_path");
  const [severity, setSeverity] = useState("high");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/inspections/${inspectionId}/findings`, { body: { media_id: media.id, defect_class: cls, bbox, description: desc, severity } });
      toast.success("Manual finding created; it still needs a reviewer decision");
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Mark a defect manually"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save finding</Button></>}>
      <ImageAnnotator src={media.url} width={media.width} height={media.height} drawing onDraw={setBbox} alt="Photo for manual marking"
        boxes={bbox ? [{ bbox, label: DEFECT_LABEL[cls], color: "#e8ad12" }] : []} />
      <p className="text-xs text-slate-500">{bbox ? "Region marked. Drag again to change it." : "Optional: mark the region on the photo."}</p>
      <Field label="Defect type" required>{(id) => (
        <select id={id} className={inputCls} value={cls} onChange={(e) => setCls(e.target.value)}>
          {Object.entries(DEFECT_LABEL).filter(([k]) => k !== "unassessable").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>)}</Field>
      <Field label="Severity">{(id) => (
        <select id={id} className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>)}</Field>
      <Field label="Description">{(id) => <textarea id={id} className={inputCls} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
    </Modal>
  );
}

function HandoverModal({ open, id, statement, onClose, onDone }: { open: boolean; id: number; statement: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/inspections/${id}/handover`, { body: { notes: note } });
      toast.success("Handover decision recorded");
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record handover decision"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" onClick={save} loading={busy} disabled={!ack}>Record decision</Button></>}>
      <Notice tone="slate">{statement}</Notice>
      <Field label="Engineer's note">{(i) => <textarea id={i} className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        I have inspected the site and take responsibility for this acceptance decision.
      </label>
    </Modal>
  );
}
