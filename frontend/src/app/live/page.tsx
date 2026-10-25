"use client";

import { Camera, Film, ImageIcon, Pause, Play, Save, Sparkles, SwitchCamera } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Field, inputCls, Modal, Notice, PageHeader, Spinner, Stat } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { getPosition } from "@/lib/geo";
import type { LiveResult, LiveStatus, Survey } from "@/lib/types";

type Source = "camera" | "video" | "photo";
type PitchMode = "auto" | "sensor" | "manual";
interface Settings {
  pitchMode: PitchMode;
  manualPitch: number;
  height: number;
  hfov: number;
  stripTiles: number;
  clearance: number;
  quality: "fast" | "accurate";
  detect: boolean;
  aligned: boolean;
}

const FRAME_WIDTH = 640;
const SURFACE_LEGEND = [
  { key: "paved_walkway", label: "Paved walkway", color: "#16a885" },
  { key: "unpaved", label: "Unpaved", color: "#e8ad12" },
  { key: "carriageway", label: "Carriageway", color: "#dc2626" },
  { key: "obstacle", label: "Not walkable", color: "#64748b" },
  { key: "hazard", label: "Hazard / cover", color: "#ea580c" },
];
const STOP_TONE: Record<string, "teal" | "amber" | "red" | "slate"> = {
  range: "teal", out_of_view: "slate", narrow: "amber", blocked: "red", carriageway: "red", hazard: "red",
  no_start: "amber", no_ground: "amber",
};

export default function LivePage() {
  return <RoleGate roles={["admin", "inspector", "engineer", "contractor"]}>{() => <LivePlanner />}</RoleGate>;
}

function sensorPitch(beta: number | null, gamma: number | null): number | null {
  if (beta == null || gamma == null) return null;
  const angle = typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0;
  const p = angle === 90 || angle === 270 ? 90 - Math.abs(gamma) : 90 - beta;
  return Math.min(85, Math.max(5, p));
}

function LivePlanner() {
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const lastFrameRef = useRef<Blob | null>(null);
  const frameRef = useRef<ImageBitmap | null>(null);
  const pipRef = useRef<HTMLCanvasElement>(null);
  const tiltRef = useRef<number | null>(null);

  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [statusErr, setStatusErr] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [fps, setFps] = useState(0);
  const [err, setErr] = useState("");
  const [tilt, setTilt] = useState<number | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [settings, setSettings] = useState<Settings>({
    pitchMode: "auto", manualPitch: 40, height: 1.4, hfov: 63, stripTiles: 1, clearance: 0.6, quality: "accurate", detect: true, aligned: true,
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [announce, setAnnounce] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [opinion, setOpinion] = useState<{ model: string; answer: Record<string, unknown> } | null>(null);
  const [opinionBusy, setOpinionBusy] = useState(false);

  useEffect(() => {
    api<LiveStatus>("/live/status")
      .then((s) => {
        setStatus(s);
        setSettings((x) => ({ ...x, quality: (s.default_quality as Settings["quality"]) || "accurate", clearance: s.defaults.clearance_m }));
      })
      .catch((e) => setStatusErr(e instanceof ApiError ? e.message : "Could not load live planner status"));
  }, []);

  // Phone tilt sensor (pitch of the rear camera below the horizon).
  useEffect(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      const p = sensorPitch(e.beta, e.gamma);
      tiltRef.current = p;
      setTilt(p == null ? null : Math.round(p));
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => {
    runningRef.current = false;
    stopStream();
  }, [stopStream]);

  useEffect(() => () => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  }, [mediaUrl]);

  async function startCamera(face = facing) {
    setErr("");
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("Camera access needs a secure connection (https or localhost) and a browser that supports it.");
      return;
    }
    try {
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof DOE.requestPermission === "function") await DOE.requestPermission().catch(() => "denied");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: face }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      streamRef.current = stream;
      setMediaUrl("");
      setSource("camera");
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setRunning(true);
    } catch (e) {
      setErr(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was denied." : "Could not start the camera.");
    }
  }

  function openFile(file: File | undefined, kind: "video" | "photo") {
    if (!file) return;
    stopStream();
    setErr("");
    setResult(null);
    setMediaUrl(URL.createObjectURL(file));
    setSource(kind);
    if (kind === "video") {
      setRunning(true);
    } else {
      setRunning(false);
    }
  }

  useEffect(() => {
    const v = videoRef.current;
    if (source === "video" && v && mediaUrl) {
      v.srcObject = null;
      v.src = mediaUrl;
      v.play().catch(() => {});
    }
  }, [source, mediaUrl]);

  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    const el = source === "photo" ? imgRef.current : videoRef.current;
    if (!el) return null;
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!w || !h) return null;
    const c = document.createElement("canvas");
    c.width = Math.min(FRAME_WIDTH, w);
    c.height = Math.round((h * c.width) / w);
    c.getContext("2d")!.drawImage(el, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.8));
  }, [source]);

  const analyse = useCallback(async (): Promise<boolean> => {
    const blob = await captureFrame();
    if (!blob) return false;
    const s = settingsRef.current;
    const fd = new FormData();
    fd.append("file", blob, "frame.jpg");
    const pitch = s.pitchMode === "manual" ? s.manualPitch : s.pitchMode === "sensor" ? tiltRef.current : null;
    if (pitch != null) fd.append("pitch_deg", String(pitch));
    fd.append("height_m", String(s.height));
    fd.append("hfov_deg", String(s.hfov));
    fd.append("strip_width_tiles", String(s.stripTiles));
    fd.append("clearance_m", String(s.clearance));
    fd.append("detect_obstacles", String(s.detect));
    fd.append("quality", s.quality);
    try {
      const r = await api<LiveResult>("/live/frame", { form: fd });
      lastFrameRef.current = blob;
      frameRef.current?.close();
      frameRef.current = await createImageBitmap(blob);
      setResult(r);
      setErr("");
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "busy") return false;
      setErr(e instanceof ApiError ? e.message : "Frame analysis failed");
      return false;
    }
  }, [captureFrame]);

  // Analysis loop: one frame in flight at a time.
  useEffect(() => {
    if (!running || source === "photo") return;
    runningRef.current = true;
    let stopped = false;
    const times: number[] = [];
    (async () => {
      while (!stopped && runningRef.current) {
        const t0 = performance.now();
        const ok = await analyse();
        if (ok) {
          times.push(performance.now() - t0);
          if (times.length > 5) times.shift();
          setFps(1000 / (times.reduce((a, b) => a + b, 0) / times.length));
        } else {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    })();
    return () => {
      stopped = true;
      runningRef.current = false;
    };
  }, [running, source, analyse]);

  // Draw the overlay whenever a new result arrives.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !result) return;
    const { width, height } = result.frame;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    // Aligned view: draw the frame the result was computed on, so the overlay can never lag the picture.
    if (settings.aligned && frameRef.current) ctx.drawImage(frameRef.current, 0, 0, width, height);
    const surf = new Image();
    surf.onload = () => {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(surf, 0, 0, width, height);
      ctx.restore();
      drawVectors(ctx, result);
    };
    surf.src = result.surface.overlay_png;
  }, [result, settings.aligned]);

  // Small live inset for aiming while the main view shows the analysed frame.
  const showPip = settings.aligned && !!result && (source === "camera" || source === "video");
  useEffect(() => {
    if (!showPip) return;
    let raf = 0;
    const draw = () => {
      const v = videoRef.current;
      const c = pipRef.current;
      if (v && c && v.videoWidth) {
        c.width = 192;
        c.height = Math.round((192 * v.videoHeight) / v.videoWidth);
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [showPip]);

  // Screen-reader summary: only when the situation changes.
  useEffect(() => {
    if (!result) return;
    const p = result.plan;
    const avoided = result.obstacles.filter((o) => o.avoided).length;
    setAnnounce(p.ok
      ? `Proposed strip ${p.length_m.toFixed(1)} metres. ${p.stop_reason} ${avoided ? `${avoided} obstacle${avoided > 1 ? "s" : ""} avoided.` : ""}`
      : p.stop_reason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.plan.stop_code, result?.plan.ok, result?.obstacles.length]);

  async function secondOpinion() {
    const blob = lastFrameRef.current ?? (await captureFrame());
    if (!blob) return;
    setOpinionBusy(true);
    const fd = new FormData();
    fd.append("file", blob, "frame.jpg");
    try {
      setOpinion(await api("/live/scene-check", { form: fd }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Second opinion failed");
    } finally {
      setOpinionBusy(false);
    }
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const surfaceOk = status && Object.values(status.surface).some((s) => s.available);
  const plan = result?.plan;

  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Live path planner"
        subtitle="Point the camera along a footpath. TenjiCheck finds walkable paved ground and obstacles in each frame and proposes where a directional tactile strip could be laid, with clearance around obstacles."
        actions={<Link href="/build" className="text-sm font-medium text-teal-700 underline">Site surveys</Link>}
      />
      <div className="mb-4">
        <Notice tone="amber" title="Decision support only">
          The proposal comes from pretrained models that were <strong>not trained on tactile paving</strong>, on an assumed flat ground
          plane. Distances are estimates. Mark out and check every route on site against the governing guideline before laying.
        </Notice>
      </div>
      {statusErr && <div className="mb-4"><Notice tone="red">{statusErr}</Notice></div>}
      {status && !surfaceOk && (
        <div className="mb-4">
          <Notice tone="red" title="Surface model not installed">
            {Object.values(status.surface)[0]?.reason} Run <code>python scripts/fetch_models.py</code> in the backend.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card
            title="Camera"
            actions={
              <>
                <Button variant="success" onClick={() => startCamera()} disabled={!surfaceOk}>
                  <Camera className="h-4 w-4" aria-hidden /> {source === "camera" ? "Restart camera" : "Start camera"}
                </Button>
                {source === "camera" && (
                  <Button variant="secondary" aria-label="Switch camera" onClick={() => {
                    const f = facing === "environment" ? "user" : "environment";
                    setFacing(f);
                    startCamera(f);
                  }}>
                    <SwitchCamera className="h-4 w-4" aria-hidden />
                  </Button>
                )}
                <label className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-slate-50 ${!surfaceOk ? "pointer-events-none opacity-50" : ""}`}>
                  <Film className="h-4 w-4" aria-hidden /> Video file
                  <input type="file" accept="video/*" className="sr-only" onChange={(e) => openFile(e.target.files?.[0], "video")} />
                </label>
                <label className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-slate-50 ${!surfaceOk ? "pointer-events-none opacity-50" : ""}`}>
                  <ImageIcon className="h-4 w-4" aria-hidden /> Photo
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => openFile(e.target.files?.[0], "photo")} />
                </label>
              </>
            }
          >
            {!status && !statusErr && <Spinner label="Loading models (first start can take a minute)" />}
            <div className="relative overflow-hidden rounded-lg bg-ink-950" style={{ minHeight: source ? undefined : 240 }}>
              <video ref={videoRef} playsInline muted loop className={`block w-full ${source === "camera" || source === "video" ? "" : "hidden"}`} aria-label="Camera view" />
              {source === "photo" && mediaUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img ref={imgRef} src={mediaUrl} alt="Selected photo" className="block w-full" onLoad={() => analyse()} />
              )}
              <canvas ref={canvasRef} className={`pointer-events-none absolute inset-0 h-full w-full ${result ? "" : "hidden"}`} aria-hidden />
              {showPip && (
                <div className="absolute bottom-2 right-2 overflow-hidden rounded-md border-2 border-white shadow-lg">
                  <canvas ref={pipRef} className="block w-32 sm:w-48" aria-hidden />
                  <span className="absolute left-1 top-1 rounded bg-ink-950/80 px-1.5 text-[10px] font-semibold text-white">LIVE</span>
                </div>
              )}
              {!source && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-300">
                  Start the camera, or open a video or photo of a footpath taken at about chest height.
                </div>
              )}
              {source && (
                <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                  <span className="rounded bg-ink-950/80 px-2 py-1 text-xs font-medium text-white">
                    {source === "photo" ? "Single photo" : running ? `Live · ${fps ? fps.toFixed(1) : "…"} fps` : "Paused"}
                  </span>
                  {result && (
                    <span className="rounded bg-ink-950/80 px-2 py-1 text-xs text-white">
                      Tilt {result.camera.pitch_deg}° ({result.camera.pitch_source === "estimated" ? "estimated" : result.camera.pitch_source === "default" ? "assumed" : "set"})
                    </span>
                  )}
                </div>
              )}
            </div>
            {err && <div className="mt-3"><Notice tone="red">{err}</Notice></div>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {source && source !== "photo" && (
                <Button variant="secondary" onClick={() => setRunning((r) => !r)}>
                  {running ? <><Pause className="h-4 w-4" aria-hidden /> Pause</> : <><Play className="h-4 w-4" aria-hidden /> Resume</>}
                </Button>
              )}
              {source === "photo" && <Button variant="secondary" onClick={() => analyse()}>Re-analyse</Button>}
              <Button variant="secondary" disabled={!plan?.ok} onClick={() => setSaveOpen(true)}>
                <Save className="h-4 w-4" aria-hidden /> Save to survey
              </Button>
              <Button variant="secondary" disabled={!result || !status?.github_models.configured} loading={opinionBusy} onClick={secondOpinion}
                title={status?.github_models.configured ? `Ask ${status.github_models.model} on GitHub Models` : "Unavailable: GitHub retired GitHub Models in July 2026"}>
                <Sparkles className="h-4 w-4" aria-hidden /> AI second opinion
              </Button>
              {status && !status.github_models.configured && (
                <span className="text-xs text-slate-500">Second opinion is unavailable: it used GitHub Models, which GitHub retired in July 2026.</span>
              )}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Overlay legend">
              <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm bg-blue-600" /> Proposed strip</li>
              <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ background: "#facc15" }} /> Existing tactile tiles</li>
              {SURFACE_LEGEND.map((l) => (
                <li key={l.key} className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm opacity-70" style={{ background: l.color }} /> {l.label}</li>
              ))}
              <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border-2 border-red-600" /> Obstacle avoided</li>
              <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border-2 border-dashed border-amber-500" /> Possible obstacle (weak)</li>
            </ul>
          </Card>
          <p className="sr-only" aria-live="polite">{announce}</p>

          {opinion && (
            <Card title={`Second opinion · ${opinion.model}`} actions={<Badge tone="violet">LLM advice, may be wrong</Badge>}>
              <OpinionView answer={opinion.answer} />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Proposal">
            {!result ? (
              <p className="text-sm text-slate-500">No frame analysed yet.</p>
            ) : (
              <div className="space-y-3">
                <Notice tone={STOP_TONE[plan!.stop_code] ?? "slate"}>{plan!.stop_reason}</Notice>
                {plan!.ok && (
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Strip length" value={`${plan!.length_m.toFixed(1)} m`} hint={plan!.existing_m ? `${plan!.existing_m.toFixed(1)} m on existing tiles` : undefined} />
                    <Stat label="Min clearance" value={plan!.min_clearance_m != null ? `${plan!.min_clearance_m.toFixed(2)} m` : "–"} hint="edge of strip to obstacle" />
                    <Stat label="Directional tiles" value={plan!.materials.directional_tiles ?? 0} hint="300 mm, new sections" />
                    <Stat label="Warning pads" value={plan!.materials.warning_pads ?? 0} hint={`${plan!.materials.warning_tiles ?? 0} tiles at turns/ends`} />
                  </div>
                )}
                {[...new Set(result.notes)].map((n) => <p key={n} className="text-xs text-slate-600">• {n}</p>)}
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.birds_eye_png} alt={`Plan view: ${plan!.ok ? `proposed strip of ${plan!.length_m.toFixed(1)} m` : "no strip proposed"}`} className="w-full rounded-lg border border-slate-200" style={{ imageRendering: "pixelated" }} />
                  <figcaption className="mt-1 text-xs text-slate-500">Plan view, {result.grid.half_width_m * 2} m wide × {result.grid.max_range_m} m ahead; lines every 1 m; dot = camera.</figcaption>
                </figure>
              </div>
            )}
          </Card>

          <Card title="Obstacles in view">
            {!result?.obstacles.length ? (
              <p className="text-sm text-slate-500">{result ? "No objects detected (surface segmentation still marks non-walkable areas)." : "—"}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {result.obstacles.map((o, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="capitalize">{o.class.replace(/_/g, " ")}</span>
                    <span className="flex items-center gap-2 text-xs text-slate-500">
                      {o.distance_m != null && `${o.distance_m} m`} · {Math.round(o.confidence * 100)}%
                      <Badge tone={o.avoided ? "red" : "amber"}>{o.avoided ? "avoided" : "weak"}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Settings">
            <div className="space-y-3">
              <Field label="Camera tilt" hint={tilt != null ? `Phone sensor reads ${tilt}° below horizontal` : "No tilt sensor detected (desktop or video)."}>
                {(id) => (
                  <select id={id} className={inputCls} value={settings.pitchMode} onChange={(e) => set("pitchMode", e.target.value as PitchMode)}>
                    <option value="auto">Estimate from the scene</option>
                    <option value="sensor" disabled={tilt == null}>Phone tilt sensor</option>
                    <option value="manual">Manual</option>
                  </select>
                )}
              </Field>
              {settings.pitchMode === "manual" && (
                <Range label="Tilt below horizontal" unit="°" min={5} max={85} step={1} value={settings.manualPitch} onChange={(v) => set("manualPitch", v)} />
              )}
              <Range label="Camera height" unit=" m" min={0.5} max={2.5} step={0.05} value={settings.height} onChange={(v) => set("height", v)} />
              <Range label="Horizontal field of view" unit="°" min={40} max={100} step={1} value={settings.hfov} onChange={(v) => set("hfov", v)} />
              <Range label="Clearance from obstacles" unit=" m" min={0} max={1.5} step={0.05} value={settings.clearance} onChange={(v) => set("clearance", v)}
                hint="Planning assumption, not a clause value. Check the governing guideline." />
              <Field label="Strip width">
                {(id) => (
                  <select id={id} className={inputCls} value={settings.stripTiles} onChange={(e) => set("stripTiles", Number(e.target.value))}>
                    <option value={1}>1 tile (300 mm)</option>
                    <option value={2}>2 tiles (600 mm)</option>
                  </select>
                )}
              </Field>
              <Field label="Surface model">
                {(id) => (
                  <select id={id} className={inputCls} value={settings.quality} onChange={(e) => set("quality", e.target.value as Settings["quality"])}>
                    <option value="accurate" disabled={status ? !status.surface.accurate?.available : false}>Accurate (SegFormer-b2)</option>
                    <option value="fast" disabled={status ? !status.surface.fast?.available : false}>Fast (SegFormer-b0)</option>
                  </select>
                )}
              </Field>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input type="checkbox" checked={settings.detect} onChange={(e) => set("detect", e.target.checked)} className="h-4 w-4" />
                Detect objects (YOLO-World)
              </label>
              <label className="flex min-h-[44px] items-start gap-2 text-sm">
                <input type="checkbox" checked={settings.aligned} onChange={(e) => set("aligned", e.target.checked)} className="mt-1 h-4 w-4" />
                <span>Show the analysed frame under the overlay<span className="block text-xs text-slate-500">Keeps the overlay aligned; the live view moves to the inset. Off draws over live video, which lags by one analysis.</span></span>
              </label>
              {result && (
                <p className="text-xs text-slate-500">
                  {Object.entries(result.timings).map(([k, v]) => `${k.replace("_ms", "")} ${v} ms`).join(" · ")}
                  <br />
                  {Object.values(result.models).join(" · ")}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <SaveDialog open={saveOpen} onClose={() => setSaveOpen(false)} result={result} canvas={canvasRef} frame={frameRef} />
    </>
  );
}

function drawVectors(ctx: CanvasRenderingContext2D, r: LiveResult) {
  const { width, height } = r.frame;
  const lw = Math.max(2, width / 320);
  if (r.camera.horizon_y > 0 && r.camera.horizon_y < height) {
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, r.camera.horizon_y);
    ctx.lineTo(width, r.camera.horizon_y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const poly = r.plan.strip_polygon;
  if (poly.length > 2) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(37,99,235,0.6)";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = lw;
    ctx.stroke();
    const c = r.plan.centreline;
    if (c.length > 1) {
      ctx.setLineDash([lw * 3, lw * 3]);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = lw / 2;
      ctx.beginPath();
      c.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.font = `600 ${Math.max(11, Math.round(width / 50))}px system-ui, sans-serif`;
  for (const o of r.obstacles) {
    const [x1, y1, x2, y2] = o.bbox;
    ctx.setLineDash(o.avoided ? [] : [6, 4]);
    ctx.strokeStyle = o.avoided ? "#dc2626" : "#f59e0b";
    ctx.lineWidth = lw;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    const label = `${o.class.replace(/_/g, " ")}${o.distance_m != null ? ` ${o.distance_m} m` : ""}`;
    const tw = ctx.measureText(label).width + 8;
    const ty = Math.max(0, y1 - 18);
    ctx.fillStyle = o.avoided ? "#dc2626" : "#b45309";
    ctx.fillRect(x1, ty, tw, 18);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x1 + 4, ty + 13);
  }
}

function Range({ label, unit, min, max, step, value, onChange, hint }: {
  label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <Field label={`${label}: ${value}${unit}`} hint={hint}>
      {(id) => <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-teal-600" />}
    </Field>
  );
}

function OpinionView({ answer }: { answer: Record<string, unknown> }) {
  const obstacles = Array.isArray(answer.obstacles) ? (answer.obstacles as { name?: string; position?: string; blocks_route?: boolean }[]) : [];
  const hazards = Array.isArray(answer.hazards) ? (answer.hazards as string[]) : [];
  return (
    <dl className="space-y-2 text-sm">
      {typeof answer.suggested_route === "string" && (<div><dt className="font-semibold">Suggested route</dt><dd>{answer.suggested_route}</dd></div>)}
      {typeof answer.surface === "string" && (<div><dt className="font-semibold">Surface</dt><dd>{answer.surface}</dd></div>)}
      {obstacles.length > 0 && (
        <div><dt className="font-semibold">Obstacles</dt><dd>{obstacles.map((o) => `${o.name ?? "?"} (${o.position ?? "?"}${o.blocks_route ? ", blocks route" : ""})`).join("; ")}</dd></div>
      )}
      {hazards.length > 0 && (<div><dt className="font-semibold">Hazards</dt><dd>{hazards.join("; ")}</dd></div>)}
      {typeof answer.confidence === "string" && (<div><dt className="font-semibold">Model confidence</dt><dd>{answer.confidence}</dd></div>)}
    </dl>
  );
}

function SaveDialog({ open, onClose, result, canvas, frame }: {
  open: boolean; onClose: () => void; result: LiveResult | null; canvas: React.RefObject<HTMLCanvasElement | null>;
  frame: React.RefObject<ImageBitmap | null>;
}) {
  const toast = useToast();
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [surveyId, setSurveyId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr("");
    api<Survey[]>("/surveys")
      .then((list) => {
        const editable = list.filter((s) => s.status === "recording" || s.status === "draft");
        setSurveys(editable);
        if (editable[0]) setSurveyId(String(editable[0].id));
      })
      .catch(() => setSurveys([]));
  }, [open]);

  async function save() {
    if (!result || !surveyId) return;
    setBusy(true);
    setErr("");
    try {
      const fix = await getPosition();
      // Annotated snapshot: the analysed frame with the proposal drawn on it.
      const c = document.createElement("canvas");
      c.width = result.frame.width;
      c.height = result.frame.height;
      const ctx = c.getContext("2d")!;
      if (frame.current) ctx.drawImage(frame.current, 0, 0, c.width, c.height);
      if (canvas.current) ctx.drawImage(canvas.current, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
      const p = result.plan;
      const summary = `Live planner proposal (unverified): ${p.length_m.toFixed(1)} m strip, ${p.materials.directional_tiles ?? 0} new directional tiles, ` +
        `${p.materials.warning_pads ?? 0} warning pads, min clearance ${p.min_clearance_m ?? "n/a"} m. ${p.stop_reason} ` +
        `Tilt ${result.camera.pitch_deg} deg (${result.camera.pitch_source}).`;
      const fd = new FormData();
      fd.append("lat", String(fix.lat));
      fd.append("lon", String(fix.lon));
      if (fix.accuracy != null) fd.append("accuracy_m", String(fix.accuracy));
      fd.append("observation_type", "candidate_segment");
      fd.append("location_source", "gps");
      fd.append("note", `${summary}${note ? `\n${note}` : ""}`.slice(0, 2000));
      if (blob) fd.append("file", blob, "live-proposal.jpg");
      await api(`/surveys/${surveyId}/observations`, { form: fd });
      toast.success("Saved to the survey as a candidate segment");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Save proposal to a survey"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!surveyId}>Save</Button></>}>
      {surveys == null ? <Spinner /> : !surveys.length ? (
        <Notice tone="slate">No survey is recording. <Link className="underline" href="/build">Start a survey</Link> first.</Notice>
      ) : (
        <div className="space-y-3">
          <Field label="Survey">
            {(id) => (
              <select id={id} className={inputCls} value={surveyId} onChange={(e) => setSurveyId(e.target.value)}>
                {surveys.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            )}
          </Field>
          <Field label="Note (optional)">{(id) => <textarea id={id} className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <p className="text-xs text-slate-500">Saves your current GPS position, the annotated frame and the plan summary as a candidate segment observation.</p>
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      )}
    </Modal>
  );
}
