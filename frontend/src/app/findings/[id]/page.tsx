"use client";

import { ArrowLeft, Check, Lock, Pencil, RotateCcw, Upload, X } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ImageAnnotator } from "@/components/ImageAnnotator";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Field, inputCls, Modal, Notice, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { CONTEXT_LABEL, DEFECT_LABEL, FINDING_STATUS, fmtDate } from "@/lib/labels";
import type { Finding } from "@/lib/types";

export default function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RoleGate roles={["admin", "inspector", "engineer", "contractor"]}>{() => <FindingView id={Number(id)} />}</RoleGate>;
}

function FindingView({ id }: { id: number }) {
  const toast = useToast();
  const [f, setF] = useState<Finding | null>(null);
  const [err, setErr] = useState("");
  const [dialog, setDialog] = useState<"" | "reject" | "correct" | "fail" | "repair">("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Finding>(`/findings/${id}`).then(setF).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const pendingCheck = f?.repair_ai_check && ["queued", "running"].includes(f.repair_ai_check.status);
  useEffect(() => {
    if (!pendingCheck) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [pendingCheck, load]);

  async function act(path: string, body: unknown, msg: string) {
    setBusy(true);
    try {
      setF(await api<Finding>(`/findings/${id}/${path}`, { body }));
      toast.success(msg);
      setDialog("");
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  if (err) return <Notice tone="red">{err}</Notice>;
  if (!f) return <Spinner />;
  const can = (a: string) => f.actions.includes(a);
  const box = f.bbox ? [{ bbox: f.bbox, label: `F-${f.id} ${f.label}`, color: f.verify_on_site ? "#d97706" : "#dc2626", dashed: true }] : [];

  return (
    <>
      <Link href={`/inspect/${f.inspection_id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-teal-700 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to inspection</Link>
      <PageHeader eyebrow={`Finding F-${f.id}${f.punch_item_no ? ` · punch item #${f.punch_item_no}` : ""}`} title={f.label}
        subtitle={<span className="flex flex-wrap gap-2"><StatusBadge status={f.status} map={FINDING_STATUS} />
          <Badge tone={f.source === "ai" ? "violet" : "blue"}>{f.source === "ai" ? "AI proposal" : "Manual finding"}</Badge>
          {f.verify_on_site && <Badge tone="amber">Verify on site</Badge>}<Badge tone="slate">Severity: {f.severity}</Badge></span>} />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {f.media && <ImageAnnotator src={f.media.url} width={f.media.width} height={f.media.height} boxes={box} alt={`Evidence photo for finding ${f.id}`} />}
          {f.media?.original_url && <a className="text-xs text-teal-700 underline" href={f.media.original_url} target="_blank" rel="noreferrer">View unblurred original (restricted)</a>}
          {f.repair_media && (
            <Card title="Repair evidence">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.repair_media.url} alt="Repair evidence photo submitted by contractor" className="w-full rounded bg-slate-900 object-contain" />
              {f.repair_ai_check && (
                <div className="mt-3 text-sm">
                  <p className="font-semibold">AI second look (advisory)</p>
                  {["queued", "running"].includes(f.repair_ai_check.status) ? <p className="text-slate-500">Screening repair photo…</p> :
                    f.repair_ai_check.candidates.length === 0 ? <p className="text-teal-700">No candidate defects detected in the repair photo. The reviewer still decides.</p> :
                      <ul className="list-disc pl-5 text-amber-800">{f.repair_ai_check.candidates.map((c, i) => <li key={i}>{c.title}: {c.description}</li>)}</ul>}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title="Decision">
            <div className="flex flex-wrap gap-2">
              {can("confirm") && <Button variant="danger" onClick={() => act("review", { decision: "confirm" }, "Finding confirmed")} loading={busy}><Check className="h-4 w-4" /> Confirm defect</Button>}
              {can("confirm") && <Button variant="secondary" onClick={() => setDialog("correct")}><Pencil className="h-4 w-4" /> Correct & confirm</Button>}
              {can("reject") && <Button variant="secondary" onClick={() => setDialog("reject")}><X className="h-4 w-4" /> Reject</Button>}
              {can("reopen_review") && <Button variant="secondary" onClick={() => act("reopen", { notes: "Reopened for review" }, "Reopened for review")}><RotateCcw className="h-4 w-4" /> Reopen review</Button>}
              {can("submit_repair") && <Button onClick={() => setDialog("repair")}><Upload className="h-4 w-4" /> Submit repair photo</Button>}
              {can("pass_reinspection") && <Button variant="success" onClick={() => act("reinspect", { result: "pass" }, "Reinspection passed")} loading={busy}><Check className="h-4 w-4" /> Pass reinspection</Button>}
              {can("fail_reinspection") && <Button variant="danger" onClick={() => setDialog("fail")}><X className="h-4 w-4" /> Fail reinspection</Button>}
              {can("close") && <Button variant="success" onClick={() => act("close", { notes: "" }, "Finding closed")} loading={busy}><Lock className="h-4 w-4" /> Close finding</Button>}
              {!f.actions.length && <p className="text-sm text-slate-500">No actions available for your role in this state.</p>}
            </div>
            {f.status === "confirmed" && <p className="mt-2 text-xs text-slate-500">Confirmed findings move to “fix required” when the punch list is generated.</p>}
          </Card>
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <Row k="Rule reference" v={f.rule_reference || "—"} />
              <Row k="Description" v={f.description || "—"} />
              <Row k="Required fix" v={f.required_fix || "—"} />
              {Object.keys(f.measurement || {}).length > 0 && <Row k="Measurement" v={Object.entries(f.measurement).map(([a, b]) => `${a.replace(/_/g, " ")}: ${b}`).join(" · ")} />}
              {f.verify_on_site && <Row k="Why verify on site" v={f.uncertainty_note || "Not measurable from the photo"} />}
              <Row k="Confidence" v={f.confidence != null ? `${(f.confidence * 100).toFixed(0)}% (model/rule score, not a probability of correctness)` : "—"} />
              <Row k="Context" v={CONTEXT_LABEL[f.context_tag || ""] || "—"} />
              <Row k="Location" v={f.lat != null ? `${f.lat.toFixed(6)}, ${f.lon?.toFixed(6)}` : "Not recorded"} />
              <Row k="Reviewer" v={f.reviewer ? `${f.reviewer} · ${fmtDate(f.reviewed_at)}` : "Not yet reviewed"} />
              {f.review_notes && <Row k="Reviewer notes" v={f.review_notes} />}
            </dl>
            {f.source === "ai" && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-teal-700">Original AI output (unchanged by reviewer edits)</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-900 p-2 text-slate-100">{JSON.stringify(f.ai_output, null, 2)}</pre>
              </details>
            )}
          </Card>
          <Card title="Audit trail">
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4 text-sm">
              {f.events?.map((e, i) => (
                <li key={i}>
                  <StatusBadge status={e.to} map={FINDING_STATUS} /> <span className="text-xs text-slate-500">{fmtDate(e.at)} · {e.actor}</span>
                  {e.note && <p className="mt-0.5 text-slate-700">{e.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <ReasonModal open={dialog === "reject"} title="Reject finding" label="Reason (required)" onClose={() => setDialog("")} busy={busy}
        onSubmit={(notes) => act("review", { decision: "reject", notes }, "Finding rejected")} />
      <ReasonModal open={dialog === "fail"} title="Fail reinspection" label="What is still wrong? (required)" onClose={() => setDialog("")} busy={busy}
        onSubmit={(notes) => act("reinspect", { result: "fail", notes }, "Returned to contractor: fix required")} />
      {dialog === "correct" && <CorrectModal f={f} busy={busy} onClose={() => setDialog("")} onSubmit={(c, notes) => act("review", { decision: "correct", corrections: c, notes }, "Corrected and confirmed")} />}
      {dialog === "repair" && <RepairModal id={f.id} onClose={() => setDialog("")} onDone={(nf) => { setF(nf); setDialog(""); toast.success("Repair evidence submitted for reinspection"); }} />}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-xs font-medium uppercase text-slate-500">{k}</dt><dd className="text-ink-900">{v}</dd></div>;
}

function ReasonModal({ open, title, label, onClose, onSubmit, busy }: { open: boolean; title: string; label: string; onClose: () => void; onSubmit: (s: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!text.trim()} loading={busy} onClick={() => onSubmit(text)}>{title}</Button></>}>
      <Field label={label} required>{(id) => <textarea id={id} className={inputCls} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
    </Modal>
  );
}

function CorrectModal({ f, onClose, onSubmit, busy }: { f: Finding; onClose: () => void; onSubmit: (c: Record<string, unknown>, notes: string) => void; busy: boolean }) {
  const [cls, setCls] = useState(f.defect_class);
  const [sev, setSev] = useState(f.severity);
  const [desc, setDesc] = useState(f.description);
  const [bbox, setBbox] = useState<number[] | null>(f.bbox);
  const [notes, setNotes] = useState("");
  return (
    <Modal open onClose={onClose} title="Correct and confirm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => onSubmit({ defect_class: cls, severity: sev, description: desc, bbox }, notes)}>Save correction</Button></>}>
      {f.media && <ImageAnnotator src={f.media.url} width={f.media.width} height={f.media.height} drawing onDraw={setBbox} alt="Adjust the defect region"
        boxes={bbox ? [{ bbox, label: DEFECT_LABEL[cls], color: "#e8ad12" }] : []} />}
      <Field label="Defect type">{(id) => (
        <select id={id} className={inputCls} value={cls} onChange={(e) => setCls(e.target.value)}>
          {Object.entries(DEFECT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>)}</Field>
      <Field label="Severity">{(id) => (
        <select id={id} className={inputCls} value={sev} onChange={(e) => setSev(e.target.value)}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>)}</Field>
      <Field label="Description">{(id) => <textarea id={id} className={inputCls} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
      <Field label="Reviewer notes">{(id) => <textarea id={id} className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
    </Modal>
  );
}

function RepairModal({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: (f: Finding) => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    form.append("notes", notes);
    try {
      onDone(await api<Finding>(`/findings/${id}/repair`, { form }));
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Submit repair evidence"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={!file} loading={busy}>Submit for reinspection</Button></>}>
      <p className="text-sm text-slate-600">Photograph the repaired segment from a similar position as the original photo.</p>
      <Field label="Repair photo" required>{(i) => <input id={i} type="file" accept="image/*" capture="environment" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] || null)} />}</Field>
      <Field label="What was done">{(i) => <textarea id={i} className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
    </Modal>
  );
}
