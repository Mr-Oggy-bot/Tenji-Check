"use client";

import { useEffect, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { Badge, Card, Notice, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/labels";

interface Models {
  tile_segmenter: { name: string; version: string; trained_on_tenjicheck_data: boolean; note: string };
  obstacle_detector: { name: string; version: string; available: boolean; reason: string; note: string };
  rules: { version: string; review_status: string };
  registry: { name: string; kind: string; version: string; dataset_version: string; metrics: Record<string, unknown>; deployed_at: string }[];
  evaluation: { status: string; message?: string; targets?: Record<string, number>; [k: string]: unknown };
}

export default function ModelsPage() {
  return <RoleGate>{() => <ModelsView />}</RoleGate>;
}

function ModelsView() {
  const [m, setM] = useState<Models | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<Models>("/models").then(setM).catch((e) => setErr(e.message)); }, []);
  if (err) return <Notice tone="red">{err}</Notice>;
  if (!m) return <Spinner />;
  return (
    <>
      <PageHeader eyebrow="Insights" title="AI components & evaluation" subtitle="What the system runs, what it was trained on, and what has (not) been measured." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Tile segmentation">
          <p className="font-mono text-sm">{m.tile_segmenter.name}:{m.tile_segmenter.version}</p>
          <div className="mt-2">{m.tile_segmenter.trained_on_tenjicheck_data ? <Badge tone="teal">Fine-tuned weights loaded</Badge> : <Badge tone="amber">Untrained classical baseline</Badge>}</div>
          {m.tile_segmenter.note && <p className="mt-2 text-sm text-slate-600">{m.tile_segmenter.note}</p>}
        </Card>
        <Card title="Obstacle detection">
          <p className="font-mono text-sm">{m.obstacle_detector.name}:{m.obstacle_detector.version}</p>
          <div className="mt-2">{m.obstacle_detector.available ? <Badge tone="teal">Available</Badge> : <Badge tone="red">Unavailable</Badge>}</div>
          {m.obstacle_detector.reason && <p className="mt-2 text-sm text-red-700">{m.obstacle_detector.reason}</p>}
          <p className="mt-2 text-sm text-slate-600">{m.obstacle_detector.note}</p>
        </Card>
        <Card title="Rules engine">
          <p className="font-mono text-sm">{m.rules.version}</p>
          <p className="mt-2 text-sm text-slate-600">Rule references: {m.rules.review_status}.</p>
        </Card>
      </div>
      <Card title="Held-out evaluation" className="mt-6">
        {m.evaluation.status === "measured" ? (
          <pre className="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(m.evaluation, null, 2)}</pre>
        ) : (
          <Notice title="Results pending">
            {m.evaluation.message} Target: obstacle recall ≥ {m.evaluation.targets?.obstacle_recall ?? 0.8}. Run <code>python ml/evaluation/evaluate.py</code> on a labelled held-out route to populate this.
          </Notice>
        )}
      </Card>
      <Card title="Model registry" className="mt-6">
        {!m.registry.length ? <p className="text-sm text-slate-500">Models are registered the first time they run.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Model</th><th>Kind</th><th>Version</th><th>Status</th><th>First used</th></tr></thead>
            <tbody>{m.registry.map((r) => (
              <tr key={r.name + r.version} className="border-t"><td className="py-2 font-mono">{r.name}</td><td>{r.kind}</td><td className="font-mono">{r.version}</td><td>{String(r.metrics.status || "")}</td><td>{fmtDate(r.deployed_at)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
