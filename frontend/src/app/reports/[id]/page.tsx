"use client";

import { ArrowLeft, Copy, Upload } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { MapView } from "@/components/MapView";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, DemoBadge, Field, inputCls, Modal, Notice, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, ISSUE_STATUS } from "@/lib/labels";
import type { Issue, User } from "@/lib/types";

export default function ReportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RoleGate roles={["admin", "inspector", "engineer", "contractor", "citizen"]}>{(u) => <Detail id={Number(id)} user={u} />}</RoleGate>;
}

function Detail({ id, user }: { id: number; user: User }) {
  const toast = useToast();
  const [i, setI] = useState<Issue | null>(null);
  const [err, setErr] = useState("");
  const [cats, setCats] = useState<{ value: string; label: string }[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [modal, setModal] = useState<"" | "status" | "edit" | "reject-ai" | "evidence">("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const reviewer = ["inspector", "admin"].includes(user.role);

  const load = useCallback(() => api<Issue>(`/issues/${id}`).then(setI).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api<{ value: string; label: string }[]>("/issues/categories").then(setCats).catch(() => {});
    if (reviewer) api<User[]>("/users?role=inspector,contractor,engineer").then(setStaff).catch(() => {});
  }, [reviewer]);
  const analysing = i?.media?.some((m) => m.analysis && ["queued", "running"].includes(m.analysis.status));
  useEffect(() => { if (!analysing) return; const t = setInterval(load, 2000); return () => clearInterval(t); }, [analysing, load]);

  async function call(path: string, method: string, body: unknown, msg: string) {
    setBusy(true);
    try {
      setI(await api<Issue>(`/issues/${id}${path}`, { method, body }));
      toast.success(msg);
      setModal("");
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  if (err) return <Notice tone="red">{err}</Notice>;
  if (!i) return <Spinner />;
  const photo = i.media?.find((m) => m.kind === "report_photo");
  const evidence = i.media?.filter((m) => m.kind === "closure_evidence") || [];

  return (
    <>
      {reviewer && <Link href="/reports" className="mb-3 inline-flex items-center gap-1 text-sm text-teal-700 hover:underline"><ArrowLeft className="h-4 w-4" /> Report queue</Link>}
      <PageHeader eyebrow={`Report · ${i.source.replace("_", " ")}`} title={i.reference}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={i.status} map={ISSUE_STATUS} />{i.category_label}<DemoBadge show={i.is_demo} /></span>}
        actions={reviewer && i.allowed_transitions.length > 0 ? <Button onClick={() => { setTarget(i.allowed_transitions[0]); setModal("status"); }}>Update status</Button> : undefined} />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {photo && (
            <Card title="Reporter photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.annotated_url || photo.url} alt="Photo submitted with the report" className="w-full rounded bg-slate-900 object-contain" />
              {photo.analysis && <div className="mt-3"><AnalysisPanel analysis={photo.analysis} /></div>}
              {photo.analysis?.result.candidates?.length ? (
                <ul className="mt-2 list-disc pl-5 text-sm">{photo.analysis.result.candidates.map((c, n) => <li key={n}><strong>{c.title}</strong>{c.verify_on_site ? " (verify on site)" : ""}: {c.description}</li>)}</ul>
              ) : null}
            </Card>
          )}
          {i.description && <Card title="Description"><p className="whitespace-pre-wrap text-sm">{i.description}</p></Card>}
          {evidence.length > 0 && (
            <Card title="Closure evidence">
              <div className="grid grid-cols-2 gap-2">{evidence.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.id} src={m.url} alt="Closure evidence" className="rounded" />))}</div>
            </Card>
          )}
          {i.lat != null && i.lon != null && (
            <MapView center={[i.lat, i.lon]} zoom={18} height={280} markers={[{ id: "i", lat: i.lat, lon: i.lon, color: "#dc2626", label: i.reference }]} />
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {reviewer && (
            <Card title="Verify the evidence">
              <p className="mb-3 text-sm text-slate-600">Your decision is stored separately from the AI prediction and the reporter&apos;s category.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" loading={busy} onClick={() => call("/review", "POST", { decision: "confirm" }, "Report confirmed")}>Confirm</Button>
                <Button variant="secondary" onClick={() => setModal("edit")}>Edit category</Button>
                <Button variant="secondary" onClick={() => setModal("reject-ai")} disabled={["resolved", "rejected"].includes(i.status)}>Reject report</Button>
              </div>
            </Card>
          )}
          {reviewer && (
            <Card title="Triage">
              <div className="space-y-3">
                <Field label="Assigned to">{(fid) => (
                  <select id={fid} className={inputCls} value={i.assigned_to ?? ""} onChange={(e) => e.target.value && call("/status", "PATCH", { to_status: i.status, assigned_to: Number(e.target.value) }, "Assignee updated")}>
                    <option value="">Unassigned</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name} ({s.role})</option>)}
                  </select>)}</Field>
                <Field label="Severity">{(fid) => (
                  <select id={fid} className={inputCls} value={i.severity ?? ""} onChange={(e) => call("/status", "PATCH", { to_status: i.status, severity: e.target.value }, "Severity updated")}>
                    <option value="" disabled>Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>)}</Field>
                <Button variant="secondary" onClick={() => setModal("evidence")}><Upload className="h-4 w-4" /> Attach closure evidence</Button>
              </div>
            </Card>
          )}
          {i.possible_duplicates.length > 0 && reviewer && (
            <Card title="Possible duplicates">
              <p className="mb-2 text-sm text-slate-600">Same category within the duplicate radius and time window. Review before merging.</p>
              <ul className="space-y-2">{i.possible_duplicates.map((d) => (
                <li key={d} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/reports/${d}`} className="text-teal-700 underline">Report #{d}</Link>
                  <Button variant="secondary" disabled={i.status === "rejected"} onClick={() => call("/mark-duplicate", "POST", { duplicate_of: d }, "Marked as duplicate")}><Copy className="h-4 w-4" /> Mark duplicate of this</Button>
                </li>))}</ul>
            </Card>
          )}
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs uppercase text-slate-500">Submitted</dt><dd>{fmtDate(i.created_at)} · {i.age_days} day(s) ago</dd></div>
              {i.reporter && <div><dt className="text-xs uppercase text-slate-500">Reporter</dt><dd>{i.reporter}{i.reporter_contact ? ` · ${i.reporter_contact}` : ""}</dd></div>}
              <div><dt className="text-xs uppercase text-slate-500">Location</dt><dd>{i.lat != null ? `${i.lat.toFixed(6)}, ${i.lon?.toFixed(6)}${i.location_confirmed ? " (pin confirmed)" : ""}` : "Photo-only report"}</dd></div>
              {i.assignee && <div><dt className="text-xs uppercase text-slate-500">Assignee</dt><dd>{i.assignee}</dd></div>}
              {i.rejection_reason && <div><dt className="text-xs uppercase text-slate-500">Rejection reason</dt><dd>{i.rejection_reason}</dd></div>}
            </dl>
          </Card>
          {i.reviews && i.reviews.length > 0 && (
            <Card title="Reviewer decisions">
              <ul className="space-y-2 text-sm">{i.reviews.map((r, n) => (
                <li key={n}><Badge tone={r.decision === "reject" ? "slate" : "teal"}>{r.decision}</Badge> {r.edited_category && `→ ${r.edited_category}`} <span className="text-xs text-slate-500">{r.reviewer} · {fmtDate(r.at)}</span>{r.notes && <p>{r.notes}</p>}</li>))}</ul>
            </Card>
          )}
          <Card title="Status history">
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4 text-sm">
              {i.events?.map((e, n) => (
                <li key={n}><StatusBadge status={e.to} map={ISSUE_STATUS} /> <span className="text-xs text-slate-500">{fmtDate(e.at)}{e.actor ? ` · ${e.actor}` : ""}</span>{e.note && <p className="text-slate-700">{e.note}</p>}</li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <StatusModal open={modal === "status"} issue={i} target={target} setTarget={setTarget} busy={busy} onClose={() => setModal("")}
        onSubmit={(note) => call("/status", "PATCH", { to_status: target, note }, "Status updated")} />
      <EditModal open={modal === "edit"} cats={cats} current={i.category} busy={busy} onClose={() => setModal("")}
        onSubmit={(cat, notes) => call("/review", "POST", { decision: "edit", edited_category: cat, notes }, "Category updated")} />
      <NoteModal open={modal === "reject-ai"} title="Reject report" busy={busy} onClose={() => setModal("")}
        onSubmit={(notes) => call("/review", "POST", { decision: "reject", notes }, "Report rejected")} />
      {modal === "evidence" && <EvidenceModal id={id} onClose={() => setModal("")} onDone={() => { setModal(""); load(); toast.success("Evidence attached"); }} />}
    </>
  );
}

function StatusModal({ open, issue, target, setTarget, busy, onClose, onSubmit }: { open: boolean; issue: Issue; target: string; setTarget: (s: string) => void; busy: boolean; onClose: () => void; onSubmit: (n: string) => void }) {
  const [note, setNote] = useState("");
  const needs = target === "rejected" || target === "resolved";
  return (
    <Modal open={open} onClose={onClose} title="Update status"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={needs && !note.trim()} onClick={() => onSubmit(note)}>Save</Button></>}>
      <Field label="New status">{(id) => (
        <select id={id} className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)}>
          {issue.allowed_transitions.map((s) => <option key={s} value={s}>{ISSUE_STATUS[s]?.label || s}</option>)}
        </select>)}</Field>
      {target === "assigned" && !issue.assigned_to && <Notice>Choose an assignee in the Triage panel first.</Notice>}
      <Field label={needs ? (target === "resolved" ? "Closure evidence / what was done (required)" : "Reason (required)") : "Note"} required={needs}>
        {(id) => <textarea id={id} className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Modal>
  );
}

function EditModal({ open, cats, current, busy, onClose, onSubmit }: { open: boolean; cats: { value: string; label: string }[]; current: string; busy: boolean; onClose: () => void; onSubmit: (c: string, n: string) => void }) {
  const [cat, setCat] = useState(current);
  const [notes, setNotes] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Edit category" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => onSubmit(cat, notes)}>Save</Button></>}>
      <Field label="Category">{(id) => <select id={id} className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>}</Field>
      <Field label="Notes">{(id) => <textarea id={id} className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
    </Modal>
  );
}

function NoteModal({ open, title, busy, onClose, onSubmit }: { open: boolean; title: string; busy: boolean; onClose: () => void; onSubmit: (n: string) => void }) {
  const [notes, setNotes] = useState("");
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!notes.trim()} onClick={() => onSubmit(notes)}>{title}</Button></>}>
      <Field label="Reason (required)" required>{(id) => <textarea id={id} className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
    </Modal>
  );
}

function EvidenceModal({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!file) return;
    setBusy(true);
    const f = new FormData();
    f.append("file", file);
    f.append("note", note);
    try { await api(`/issues/${id}/evidence`, { form: f }); onDone(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Attach closure evidence" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={!file} loading={busy}>Upload</Button></>}>
      <Field label="Photo" required>{(i) => <input id={i} type="file" accept="image/*" capture="environment" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] || null)} />}</Field>
      <Field label="Note">{(i) => <input id={i} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Modal>
  );
}
