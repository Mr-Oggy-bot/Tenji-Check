"use client";

import { FolderPlus, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, DemoBadge, EmptyState, Field, inputCls, Modal, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/labels";
import type { InspectionSummary, User } from "@/lib/types";

interface Project { id: number; name: string; location_name: string; is_demo: boolean; inspection_count: number }

export default function InspectPage() {
  return <RoleGate roles={["admin", "inspector", "engineer"]}>{() => <Inspections />}</RoleGate>;
}

function Inspections() {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [inspections, setInspections] = useState<InspectionSummary[]>([]);
  const [contractors, setContractors] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [showProject, setShowProject] = useState(false);
  const [showInsp, setShowInsp] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, i, c] = await Promise.all([api<Project[]>("/projects"), api<InspectionSummary[]>("/inspections"), api<User[]>("/users?role=contractor")]);
      setProjects(p);
      setInspections(i);
      setContractors(c);
    } catch (e) {
      toast.error(e);
      setProjects([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => inspections.filter((i) => `${i.title} ${i.site_name} ${i.project_name}`.toLowerCase().includes(q.toLowerCase())),
    [inspections, q],
  );

  if (!projects) return <Spinner />;
  return (
    <>
      <PageHeader eyebrow="Inspect" title="Pre-handover inspections" subtitle="Each inspection collects photos, AI candidate findings, reviewer decisions and the punch list for one site segment."
        actions={<>
          <Button variant="secondary" onClick={() => setShowProject(true)}><FolderPlus className="h-4 w-4" /> New project</Button>
          <Button onClick={() => setShowInsp(true)} disabled={!projects.length}><Plus className="h-4 w-4" /> New inspection</Button>
        </>} />
      <Card title="Inspections" actions={<input aria-label="Search inspections" placeholder="Search…" className={`${inputCls} w-56`} value={q} onChange={(e) => setQ(e.target.value)} />}>
        {!filtered.length ? (
          <EmptyState title={inspections.length ? "No inspections match your search" : "No inspections yet"}
            action={!inspections.length && projects.length ? <Button onClick={() => setShowInsp(true)}>Create the first inspection</Button> : undefined}>
            {!projects.length && "Create a project first, then add an inspection for a site segment."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-2">Inspection</th><th>Project</th><th>Contractor</th><th>Findings</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((i) => {
                  const pending = (i.finding_counts.ai_proposed || 0) + (i.finding_counts.under_review || 0);
                  const open = Object.entries(i.finding_counts).filter(([k]) => !["closed", "rejected"].includes(k)).reduce((a, [, v]) => a + v, 0);
                  return (
                    <tr key={i.id} className="hover:bg-slate-50">
                      <td className="py-3"><Link href={`/inspect/${i.id}`} className="font-semibold text-ink-900 underline-offset-2 hover:underline">{i.title}</Link>
                        <div className="text-xs text-slate-500">{i.site_name}</div></td>
                      <td>{i.project_name} <DemoBadge show={i.is_demo} /></td>
                      <td>{i.contractor || <span className="text-slate-400">Unassigned</span>}</td>
                      <td className="space-x-1">
                        {pending > 0 && <Badge tone="violet">{pending} to review</Badge>}
                        <Badge tone={open ? "red" : "green"}>{open} open</Badge>
                      </td>
                      <td>{i.status === "handover_approved" ? <Badge tone="green">Handover recorded</Badge> : <Badge tone="slate">Open</Badge>}</td>
                      <td className="text-slate-500">{fmtDate(i.created_at, false)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ProjectModal open={showProject} onClose={() => setShowProject(false)} onDone={() => { setShowProject(false); load(); }} />
      <InspectionModal open={showInsp} projects={projects} contractors={contractors} onClose={() => setShowInsp(false)} onDone={() => { setShowInsp(false); load(); }} />
    </>
  );
}

function ProjectModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [loc, setLoc] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("/projects", { body: { name, location_name: loc } });
      toast.success("Project created");
      setName(""); setLoc("");
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New project" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={name.trim().length < 2}>Create</Button></>}>
      <Field label="Project name" required>{(id) => <input id={id} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Location">{(id) => <input id={id} className={inputCls} value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="e.g. Main campus, Patiala" />}</Field>
    </Modal>
  );
}

function InspectionModal({ open, projects, contractors, onClose, onDone }: { open: boolean; projects: Project[]; contractors: User[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [projectId, setProjectId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [site, setSite] = useState("");
  const [contractor, setContractor] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (projects.length && projectId === "") setProjectId(projects[0].id); }, [projects, projectId]);
  async function save() {
    setBusy(true);
    try {
      await api(`/projects/${projectId}/inspections`, { body: { title, site_name: site, contractor_id: contractor || null } });
      toast.success("Inspection created");
      setTitle(""); setSite("");
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New inspection" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={title.trim().length < 2 || !projectId}>Create</Button></>}>
      <Field label="Project" required>{(id) => (
        <select id={id} className={inputCls} value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>)}</Field>
      <Field label="Inspection title" required>{(id) => <input id={id} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gate 2 to library" />}</Field>
      <Field label="Site / segment">{(id) => <input id={id} className={inputCls} value={site} onChange={(e) => setSite(e.target.value)} />}</Field>
      <Field label="Contractor" hint="The contractor receives the punch list and submits repair photos.">{(id) => (
        <select id={id} className={inputCls} value={contractor} onChange={(e) => setContractor(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Not assigned yet</option>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>)}</Field>
    </Modal>
  );
}
