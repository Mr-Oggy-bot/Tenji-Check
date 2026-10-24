"use client";

import { Loader2 } from "lucide-react";
import type { AnalysisInfo } from "@/lib/types";
import { Badge, Notice } from "./ui";

export function AnalysisPanel({ analysis }: { analysis: AnalysisInfo | null }) {
  if (!analysis) return <p className="text-xs text-slate-500">AI screening not run.</p>;
  if (analysis.status === "queued" || analysis.status === "running")
    return (
      <p className="flex items-center gap-2 text-sm text-slate-600" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" /> AI screening {analysis.status}…
      </p>
    );
  if (analysis.status === "failed") return <Notice tone="red" title="AI screening failed">{analysis.error} — mark defects manually or re-run screening.</Notice>;
  if (analysis.status === "skipped") return <Notice>{analysis.error}</Notice>;
  const r = analysis.result;
  const g = r.geometry;
  return (
    <div className="space-y-2 text-xs text-slate-600">
      <div className="flex flex-wrap gap-1">
        <Badge tone="slate">{r.candidates?.length ?? 0} candidate(s)</Badge>
        <Badge tone={g?.reliable ? "teal" : "amber"}>{g ? (g.reliable ? "Tile grid read" : "Grid unreliable") : "No tile strip found"}</Badge>
        {g?.length_tiles != null && <Badge tone="slate">≈{g.length_tiles} tiles visible</Badge>}
        {analysis.latency_ms != null && <Badge tone="slate">{(analysis.latency_ms / 1000).toFixed(1)} s</Badge>}
      </div>
      {r.obstacles && !r.obstacles.available && (
        <Notice>Obstacle model unavailable ({r.obstacles.reason || r.obstacles.error}). Obstacles were <strong>not</strong> checked; use manual marking.</Notice>
      )}
      {r.obstacles?.available && (
        <p>
          Obstacle detector: {r.obstacles.detections.length ? r.obstacles.detections.map((d) => `${d.prompt} ${(d.confidence * 100).toFixed(0)}%${d.uncertain ? " (uncertain)" : ""}`).join(", ") : "no obstacles detected"}
        </p>
      )}
      {r.notes?.map((n, i) => <p key={i}>• {n}</p>)}
      <p className="text-[11px] text-slate-400">
        Tiles: {analysis.tile_model} · Obstacles: {analysis.obstacle_model} · Rules: {analysis.rules_version}
      </p>
    </div>
  );
}
