"use client";

import { Camera, ImagePlus, LocateFixed, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, idemKey } from "@/lib/api";
import { type Fix, getPosition } from "@/lib/geo";
import { CONTEXT_LABEL } from "@/lib/labels";
import { sendOrQueue } from "@/lib/offline";
import { useToast } from "./toast";
import { Button, Field, inputCls, Notice } from "./ui";

interface QualityProblem { code: string; message: string }

export function CapturePhoto({ inspectionId, contextTags, onUploaded }: { inspectionId: number; contextTags: string[]; onUploaded: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [context, setContext] = useState("segment");
  const [segment, setSegment] = useState("");
  const [stripWidth, setStripWidth] = useState(1);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locErr, setLocErr] = useState("");
  const [locBusy, setLocBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState<QualityProblem[] | null>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function locate() {
    setLocBusy(true);
    setLocErr("");
    try {
      setFix(await getPosition());
    } catch (e) {
      setLocErr((e as Error).message);
    } finally {
      setLocBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setQuality(null);
  }

  async function upload(allowLow = false) {
    if (!file) return;
    setBusy(true);
    const fields: Record<string, string> = { context_tag: context, segment_label: segment, strip_width_tiles: String(stripWidth), captured_at: new Date().toISOString() };
    if (fix) {
      Object.assign(fields, { lat: String(fix.lat), lon: String(fix.lon) });
      if (fix.accuracy != null) fields.gps_accuracy_m = String(fix.accuracy);
    }
    if (allowLow) fields.allow_low_quality = "true";
    try {
      const res = await sendOrQueue({ id: idemKey(), path: `/inspections/${inspectionId}/photos`, label: `Inspection photo (${CONTEXT_LABEL[context]})`, fields, file, fileName: file.name || "photo.jpg", createdAt: Date.now() });
      toast.success(res ? (allowLow ? "Photo saved for manual review only" : "Photo uploaded. AI screening started.") : "You are offline. Photo saved and will upload automatically.");
      reset();
      onUploaded();
    } catch (e) {
      if (e instanceof ApiError && e.code === "quality_rejected") {
        const d = e.detail as { quality: { problems: QualityProblem[] } };
        setQuality(d.quality.problems);
      } else toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Selected photo preview" className="aspect-[4/3] w-full rounded-lg bg-slate-900 object-contain" />
        ) : (
          <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-600 hover:border-teal-500">
            <Camera className="h-8 w-8 text-slate-400" aria-hidden />
            <span className="font-semibold">Take or choose a photo</span>
            <span className="px-6 text-xs">Stand square to the strip, include both strip edges and, for ends and crossings, the kerb edge.</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setQuality(null); }} />
          </label>
        )}
        {file && (
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={reset}><RotateCcw className="h-4 w-4" /> Choose another</Button>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <Field label="Location context" required hint="Drives which rules run (e.g. warning tiles are checked at path ends and crossings).">
          {(id) => (
            <select id={id} className={inputCls} value={context} onChange={(e) => setContext(e.target.value)}>
              {contextTags.map((t) => <option key={t} value={t}>{CONTEXT_LABEL[t] || t}</option>)}
            </select>
          )}
        </Field>
        <Field label="Segment label">{(id) => <input id={id} className={inputCls} value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="e.g. A3, near gate" />}</Field>
        <Field label="Guide strip width (tiles)" hint="Used only to interpret tile texture; gap lengths come from the tile grid itself.">
          {(id) => <input id={id} type="number" min={1} max={6} className={inputCls} value={stripWidth} onChange={(e) => setStripWidth(Math.max(1, Math.min(6, Number(e.target.value) || 1)))} />}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={locate} loading={locBusy}><LocateFixed className="h-4 w-4" /> {fix ? "Update location" : "Add GPS location"}</Button>
          {fix && <span className="text-xs text-slate-600">{fix.lat.toFixed(6)}, {fix.lon.toFixed(6)} · ±{Math.round(fix.accuracy ?? 0)} m</span>}
        </div>
        {fix && (fix.accuracy ?? 0) > 25 && <Notice>GPS accuracy is poor (±{Math.round(fix.accuracy ?? 0)} m). The location is recorded as approximate.</Notice>}
        {locErr && <Notice>{locErr} The photo can still be uploaded without coordinates.</Notice>}
        {quality && (
          <Notice tone="red" title="Photo failed the quality check">
            <ul className="list-disc pl-4">{quality.map((p) => <li key={p.code}>{p.message}</li>)}</ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg bg-ink-900 px-3 text-sm font-semibold text-white">
                <ImagePlus className="h-4 w-4" /> Retake
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] || null); setQuality(null); }} />
              </label>
              <Button variant="secondary" onClick={() => upload(true)} loading={busy}>Keep for manual review only</Button>
            </div>
          </Notice>
        )}
        {!quality && <Button onClick={() => upload(false)} disabled={!file} loading={busy} className="w-full">Upload and screen</Button>}
      </div>
    </div>
  );
}
