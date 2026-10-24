"use client";

import { Plus, Ruler } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { VERSION_STATUS } from "@/components/planner/Panels";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, EmptyState, Field, inputCls, Notice, PageHeader, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { PlanningProject } from "@/lib/planner/types";

interface SiteOption { id: number; name: string; location_name?: string }

export default function PlanningListPage() {
  return <RoleGate roles={["admin", "inspector", "engineer", "contractor"]}>{() => <PlanningList />}</RoleGate>;
}

function PlanningList() {
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<PlanningProject[] | null>(null);
  const [err, setErr] = useState("");
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [form, setForm] = useState({ title: "", site_name: "", description: "", project_id: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PlanningProject[]>("/planning/projects").then(setItems).catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load"));
    api<SiteOption[]>("/projects").then(setSites).catch(() => setSites([]));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api<PlanningProject>("/planning/projects", {
        body: { title: form.title, site_name: form.site_name, description: form.description, project_id: form.project_id ? Number(form.project_id) : null },
      });
      toast.success("Planning project created");
      router.push(`/planning/${p.id}`);
    } catch (e2) {
      toast.error(e2 instanceof ApiError ? e2.message : "Could not create the project");
      setBusy(false);
    }
  }

  const own = items?.filter((p) => p.access === "owner") ?? [];
  const review = items?.filter((p) => p.access === "reviewer") ?? [];
  return (
    <>
      <PageHeader eyebrow="Planning & Estimation" title="Tactile route planner"
        subtitle="Draw a site, design the tactile route and warning areas, check the design, and estimate tiles, cuts, waste and cost from the actual layout." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {err && <Notice tone="red">{err}</Notice>}
          {!items && !err && <Spinner />}
          {items && (
            <Card title="My planning projects">
              {!own.length ? (
                <EmptyState title="No planning projects yet">Create one to start drawing a site plan.</EmptyState>
              ) : <ProjectList items={own} />}
            </Card>
          )}
          {review.length > 0 && <Card title="Submitted for review by others"><ProjectList items={review} /></Card>}
        </div>
        <Card title={<span className="flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden /> New planning project</span>}>
          <form className="space-y-3" onSubmit={create}>
            <Field label="Title" required>{(id) => <input id={id} className={inputCls} required minLength={2} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
            <Field label="Site name">{(id) => <input id={id} className={inputCls} maxLength={200} value={form.site_name} onChange={(e) => setForm({ ...form, site_name: e.target.value })} />}</Field>
            {sites.length > 0 && (
              <Field label="Existing site (optional)" hint="Links the plan to an inspection project for reference. Inspections are not changed.">
                {(id) => (
                  <select id={id} className={inputCls} value={form.project_id} onChange={(e) => {
                    const s = sites.find((x) => String(x.id) === e.target.value);
                    setForm({ ...form, project_id: e.target.value, site_name: form.site_name || s?.location_name || s?.name || "" });
                  }}>
                    <option value="">None</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </Field>
            )}
            <Field label="Description">{(id) => <textarea id={id} className={inputCls} rows={3} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
            <Button type="submit" loading={busy}><Ruler className="h-4 w-4" aria-hidden /> Create and open</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

function ProjectList({ items }: { items: PlanningProject[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((p) => (
        <li key={p.id}>
          <Link href={`/planning/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-slate-50">
            <span>
              <span className="block font-semibold text-ink-900">{p.title}</span>
              <span className="text-xs text-slate-500">{p.site_name || "No site name"} · {p.access === "reviewer" ? `by ${p.owner}` : `updated ${new Date(p.updated_at).toLocaleDateString()}`}</span>
            </span>
            {p.latest_version ? <Badge tone={VERSION_STATUS[p.latest_version.status].tone}>v{p.latest_version.number} · {VERSION_STATUS[p.latest_version.status].label}</Badge> : <Badge tone="slate">Draft</Badge>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
