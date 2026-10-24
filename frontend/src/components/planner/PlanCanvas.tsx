"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FEATURE_META, TILE_COLORS, dist, inPolygon, newId, polylineDist, rectPoints, round1, snapPoint } from "@/lib/planner/geometry";
import type { FeatureType, PlanDocument, Pt, TileCell, ValidationItem } from "@/lib/planner/types";

export type Tool =
  | "select" | "pan" | `feature:${FeatureType}` | "route" | "warning_rect" | "warning_poly"
  | "tile_directional" | "tile_warning" | "calibrate" | "suggest";

export interface CanvasHandle { fit: () => void; zoom: (f: number) => void; finish: () => void; cancel: () => void }

interface Props {
  doc: PlanDocument;
  onChange: (doc: PlanDocument, commit: boolean) => void;
  tool: Tool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  imageUrl: string | null;
  cells: TileCell[] | null;
  showTiles: boolean;
  markers: ValidationItem[];
  focus: Pt | null;
  tileSizeM: number;
  readOnly: boolean;
  onTwoPoints?: (tool: "calibrate" | "suggest", a: Pt, b: Pt) => void;
  onDraftChange?: (n: number) => void;
  handleRef?: React.Ref<CanvasHandle>;
}

type Drag =
  | { kind: "move"; id: string; start: Pt; orig: PlanDocument }
  | { kind: "vertex"; id: string; vi: number; orig: PlanDocument }
  | { kind: "pan"; start: [number, number]; view: View }
  | { kind: "rect"; start: Pt; cur: Pt };
interface View { k: number; x: number; y: number }

const SEV_COLOR: Record<string, string> = { error: "#dc2626", warning: "#d97706", review: "#7c3aed", info: "#64748b" };

function findShape(doc: PlanDocument, id: string): { pts: Pt[]; kind: "feature" | "route" | "warning" | "tile"; closed: boolean } | null {
  const f = doc.features.find((x) => x.id === id);
  if (f) return { pts: f.points, kind: "feature", closed: FEATURE_META[f.type].geometry === "polygon" };
  const r = doc.routes.find((x) => x.id === id);
  if (r) return { pts: r.points, kind: "route", closed: false };
  const w = doc.warning_areas.find((x) => x.id === id);
  if (w) return { pts: w.points, kind: "warning", closed: true };
  const t = doc.tiles.find((x) => x.id === id);
  if (t) return { pts: [[t.x, t.y]], kind: "tile", closed: false };
  return null;
}

/** Return a copy of the document with the points of shape `id` replaced. */
export function withPoints(doc: PlanDocument, id: string, pts: Pt[]): PlanDocument {
  return {
    ...doc,
    features: doc.features.map((f) => (f.id === id ? { ...f, points: pts } : f)),
    routes: doc.routes.map((r) => (r.id === id ? { ...r, points: pts } : r)),
    warning_areas: doc.warning_areas.map((w) => (w.id === id ? { ...w, points: pts } : w)),
    tiles: doc.tiles.map((t) => (t.id === id ? { ...t, x: pts[0][0], y: pts[0][1] } : t)),
  };
}

export function PlanCanvas(p: Props) {
  const { doc, tool, readOnly } = p;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ k: 0.3, x: 0, y: 0 });
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const m = doc.scale.m_per_px;
  const W = doc.canvas.width, H = doc.canvas.height;
  const px = (meters: number) => (m ? meters / m : meters * 100);
  const handle = 8 / view.k;

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const k = Math.min(el.clientWidth / W, el.clientHeight / H) * 0.95;
    setView({ k, x: (el.clientWidth - W * k) / 2, y: (el.clientHeight - H * k) / 2 });
  }, [W, H]);
  useEffect(() => fit(), [fit]);

  // Centre on a requested point (e.g. a validation item).
  useEffect(() => {
    const el = wrapRef.current;
    if (!p.focus || !el) return;
    setView((v) => ({ ...v, x: el.clientWidth / 2 - p.focus![0] * v.k, y: el.clientHeight / 2 - p.focus![1] * v.k }));
  }, [p.focus]);

  useEffect(() => {
    setDraft([]);
  }, [tool]);
  const onDraftChange = useRef(p.onDraftChange);
  onDraftChange.current = p.onDraftChange;
  useEffect(() => onDraftChange.current?.(draft.length), [draft.length]);

  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k];
  };

  const zoom = useCallback((f: number, at?: [number, number]) => {
    const el = wrapRef.current;
    if (!el) return;
    const [cx, cy] = at ?? [el.clientWidth / 2, el.clientHeight / 2];
    setView((v) => {
      const k = Math.min(20, Math.max(0.02, v.k * f));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  }, []);

  const finishDraft = useCallback(() => {
    if (readOnly) return;
    const pts = draft.map(round1);
    let next: PlanDocument | null = null;
    let id: string | null = null;
    if (tool === "route" && pts.length >= 2) {
      id = newId("route");
      next = { ...doc, routes: [...doc.routes, { id, label: `Route ${doc.routes.length + 1}`, points: pts, width_tiles: 1 }] };
    } else if (tool === "warning_poly" && pts.length >= 3) {
      id = newId("warn");
      next = { ...doc, warning_areas: [...doc.warning_areas, { id, label: `Warning ${doc.warning_areas.length + 1}`, points: pts }] };
    } else if (tool.startsWith("feature:")) {
      const type = tool.slice(8) as FeatureType;
      const need = FEATURE_META[type].geometry === "polygon" ? 3 : 2;
      if (pts.length >= need) {
        id = newId(type);
        next = { ...doc, features: [...doc.features, { id, type, label: "", points: pts }] };
      }
    }
    setDraft([]);
    if (next && id) {
      p.onChange(next, true);
      p.onSelect(id);
    }
  }, [draft, tool, doc, p, readOnly]);

  // Non-passive wheel listener so zooming does not scroll the page.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, [e.clientX - r.left, e.clientY - r.top]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom]);

  useImperativeHandle(p.handleRef, () => ({ fit, zoom: (f) => zoom(f), finish: finishDraft, cancel: () => setDraft([]) }), [fit, zoom, finishDraft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "Enter") finishDraft();
      if (e.key === "Escape") setDraft([]);
      if (e.key === "Backspace" && draft.length) {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft, draft.length]);

  const constrain = (prev: Pt | undefined, q: Pt, shift: boolean): Pt => {
    if (!shift || !prev) return q;
    const dx = q[0] - prev[0], dy = q[1] - prev[1];
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const L = Math.hypot(dx, dy);
    return [prev[0] + L * Math.cos(ang), prev[1] + L * Math.sin(ang)];
  };

  const hitTest = (q: Pt): string | null => {
    const tol = 6 / view.k;
    for (const t of [...doc.tiles].reverse()) if (dist(q, [t.x, t.y]) < px(p.tileSizeM) / 2) return t.id;
    for (const r of [...doc.routes].reverse())
      if (polylineDist(q, r.points, false) < Math.max(tol, px(r.width_tiles * p.tileSizeM) / 2)) return r.id;
    for (const w of [...doc.warning_areas].reverse()) if (inPolygon(q, w.points) || polylineDist(q, w.points, true) < tol) return w.id;
    for (const f of [...doc.features].reverse()) {
      const g = FEATURE_META[f.type];
      if (g.geometry === "point") {
        if (dist(q, f.points[0]) < Math.max(tol * 1.5, px(f.radius_m ?? g.radius ?? 0.3))) return f.id;
      } else if (polylineDist(q, f.points, g.geometry === "polygon") < tol || (g.geometry === "polygon" && f.type !== "footpath" && f.type !== "boundary" && inPolygon(q, f.points))) {
        return f.id;
      }
    }
    for (const f of [...doc.features].reverse()) if ((f.type === "footpath" || f.type === "boundary") && inPolygon(q, f.points)) return f.id;
    return null;
  };

  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 1 || tool === "pan" || (e.button === 0 && e.altKey)) {
      setDrag({ kind: "pan", start: [e.clientX, e.clientY], view });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const raw = toPlan(e);
    const target = e.target as SVGElement;
    if (tool === "select") {
      const vid = target.dataset.vid, vi = target.dataset.vi, mid = target.dataset.mid;
      if (!readOnly && vid && vi !== undefined) {
        setDrag({ kind: "vertex", id: vid, vi: Number(vi), orig: doc });
      } else if (!readOnly && vid && mid !== undefined) {
        const s = findShape(doc, vid);
        if (s) {
          const at = Number(mid) + 1;
          const pts = [...s.pts.slice(0, at), round1(raw), ...s.pts.slice(at)];
          const next = withPoints(doc, vid, pts);
          p.onChange(next, false);
          setDrag({ kind: "vertex", id: vid, vi: at, orig: doc });
        }
      } else {
        const id = hitTest(raw);
        p.onSelect(id);
        if (id && !readOnly) setDrag({ kind: "move", id, start: raw, orig: doc });
        else if (!id) setDrag({ kind: "pan", start: [e.clientX, e.clientY], view });
      }
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (readOnly) return;
    const q = tool === "route" || tool === "warning_poly" ? constrain(draft[draft.length - 1], snapPoint(doc, raw, 10 / view.k), e.shiftKey) : raw;
    if (tool === "warning_rect") {
      setDrag({ kind: "rect", start: snapPoint(doc, raw, 10 / view.k), cur: raw });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (tool === "calibrate" || tool === "suggest") {
      const pts = [...draft, tool === "suggest" ? q : raw];
      if (pts.length === 2) {
        p.onTwoPoints?.(tool, round1(pts[0]), round1(pts[1]));
        setDraft([]);
      } else setDraft(pts);
      return;
    }
    if (tool === "tile_directional" || tool === "tile_warning") {
      const id = newId("tile");
      const type = tool === "tile_directional" ? "directional" : "warning";
      p.onChange({ ...doc, tiles: [...doc.tiles, { id, type, x: round1(raw)[0], y: round1(raw)[1], angle_deg: 0 }] }, true);
      return;
    }
    if (tool.startsWith("feature:")) {
      const type = tool.slice(8) as FeatureType;
      if (FEATURE_META[type].geometry === "point") {
        const id = newId(type);
        p.onChange({ ...doc, features: [...doc.features, { id, type, label: "", points: [round1(raw)] }] }, true);
        p.onSelect(id);
        return;
      }
    }
    if (e.detail >= 2) return; // the double-click finishes (handled in onDoubleClick)
    setDraft((d) => [...d, q]);
  }

  function onPointerMove(e: React.PointerEvent) {
    const q = toPlan(e);
    setHover(tool === "route" || tool === "warning_poly" ? constrain(draft[draft.length - 1], snapPoint(doc, q, 10 / view.k), e.shiftKey) : q);
    if (!drag) return;
    if (drag.kind === "pan") {
      setView({ ...drag.view, x: drag.view.x + e.clientX - drag.start[0], y: drag.view.y + e.clientY - drag.start[1] });
    } else if (drag.kind === "move") {
      const s = findShape(drag.orig, drag.id);
      if (!s) return;
      const dx = q[0] - drag.start[0], dy = q[1] - drag.start[1];
      p.onChange(withPoints(drag.orig, drag.id, s.pts.map(([x, y]) => round1([x + dx, y + dy]))), false);
    } else if (drag.kind === "vertex") {
      const s = findShape(doc, drag.id);
      if (!s) return;
      const pts = [...s.pts];
      pts[drag.vi] = round1(snapPoint(doc, q, 10 / view.k, drag.id));
      p.onChange(withPoints(doc, drag.id, pts), false);
    } else if (drag.kind === "rect") {
      setDrag({ ...drag, cur: q });
    }
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.kind === "move" || drag.kind === "vertex") {
      if (doc !== drag.orig) p.onChange(doc, true);
    } else if (drag.kind === "rect") {
      const a = drag.start, b = drag.cur;
      if (Math.abs(a[0] - b[0]) > 3 && Math.abs(a[1] - b[1]) > 3) {
        const id = newId("warn");
        p.onChange({ ...doc, warning_areas: [...doc.warning_areas, { id, label: `Warning ${doc.warning_areas.length + 1}`, points: rectPoints(round1(a), round1(b)) }] }, true);
        p.onSelect(id);
      }
    }
    setDrag(null);
  }

  const T = px(p.tileSizeM);
  const sel = p.selectedId ? findShape(doc, p.selectedId) : null;
  const cursor = tool === "pan" || drag?.kind === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";
  const scaleBar = m ? [1, 2, 5, 10, 20, 50].find((len) => (len / m) * view.k >= 60) ?? 50 : null;

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none select-none overflow-hidden bg-slate-200">
      <svg className="h-full w-full" style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)} onDoubleClick={finishDraft} role="img"
        aria-label={`Site plan with ${doc.features.length} features, ${doc.routes.length} routes and ${doc.warning_areas.length} warning areas`}>
        <defs>
          <pattern id="dots" width={Math.max(T / 5, 2)} height={Math.max(T / 5, 2)} patternUnits="userSpaceOnUse">
            <circle cx={Math.max(T / 10, 1)} cy={Math.max(T / 10, 1)} r={Math.max(T / 22, 0.6)} fill="#854d0e" />
          </pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
          {p.imageUrl ? (
            <image href={p.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" opacity={0.85} />
          ) : (
            m && Array.from({ length: Math.floor((W * m) / 1) + 1 }, (_, i) => (
              <line key={`gx${i}`} x1={i / m} y1={0} x2={i / m} y2={H} stroke={i % 5 ? "#eef2f6" : "#dbe3ea"} strokeWidth={1 / view.k} />
            )).concat(Array.from({ length: Math.floor(H * m) + 1 }, (_, i) => (
              <line key={`gy${i}`} x1={0} y1={i / m} x2={W} y2={i / m} stroke={i % 5 ? "#eef2f6" : "#dbe3ea"} strokeWidth={1 / view.k} />
            )))
          )}

          {doc.features.filter((f) => FEATURE_META[f.type].geometry === "polygon").map((f) => (
            <polygon key={f.id} points={f.points.map((q) => q.join(",")).join(" ")} fill={FEATURE_META[f.type].fill ?? "none"}
              stroke={FEATURE_META[f.type].color} strokeWidth={2 / view.k} strokeDasharray={f.type === "boundary" ? `${8 / view.k} ${4 / view.k}` : undefined} />
          ))}
          {doc.warning_areas.map((w) => (
            <g key={w.id}>
              <polygon points={w.points.map((q) => q.join(",")).join(" ")} fill="#facc15" fillOpacity={0.75} stroke="#a16207" strokeWidth={1.5 / view.k} />
              <polygon points={w.points.map((q) => q.join(",")).join(" ")} fill="url(#dots)" />
            </g>
          ))}
          {doc.routes.map((r) => (
            <g key={r.id}>
              <polyline points={r.points.map((q) => q.join(",")).join(" ")} fill="none" stroke="#2563eb" strokeOpacity={0.55}
                strokeWidth={px(r.width_tiles * p.tileSizeM)} strokeLinejoin="miter" strokeMiterlimit={10} strokeLinecap="butt" />
              <polyline points={r.points.map((q) => q.join(",")).join(" ")} fill="none" stroke="#1e3a8a" strokeWidth={1.2 / view.k}
                strokeDasharray={`${6 / view.k} ${4 / view.k}`} />
            </g>
          ))}
          {p.showTiles && p.cells?.map((c, i) => (
            <polygon key={i} points={c.polygon.map((q) => q.join(",")).join(" ")} fill={TILE_COLORS[c.type][c.kind]}
              stroke="#1e293b" strokeWidth={0.6 / view.k} opacity={0.9} pointerEvents="none" />
          ))}
          {doc.tiles.map((t) => (
            <rect key={t.id} x={t.x - T / 2} y={t.y - T / 2} width={T} height={T} transform={`rotate(${t.angle_deg} ${t.x} ${t.y})`}
              fill={t.type === "directional" ? TILE_COLORS.directional.whole : TILE_COLORS.warning.whole} stroke="#0f172a" strokeWidth={1 / view.k} />
          ))}
          {doc.features.filter((f) => FEATURE_META[f.type].geometry === "polyline").map((f) => (
            <polyline key={f.id} points={f.points.map((q) => q.join(",")).join(" ")} fill="none" stroke={FEATURE_META[f.type].color}
              strokeWidth={(f.type === "kerb" ? 4 : 3) / view.k} strokeDasharray={f.type === "crossing" ? `${10 / view.k} ${5 / view.k}` : undefined} />
          ))}
          {doc.features.filter((f) => FEATURE_META[f.type].geometry === "point").map((f) => {
            const g = FEATURE_META[f.type];
            const r = g.radius ? px(f.radius_m ?? g.radius) : 7 / view.k;
            return (
              <g key={f.id}>
                <circle cx={f.points[0][0]} cy={f.points[0][1]} r={r} fill={g.color} fillOpacity={g.radius ? 0.45 : 1} stroke={g.color} strokeWidth={1.5 / view.k} />
                {!g.radius && <text x={f.points[0][0]} y={f.points[0][1] - r - 3 / view.k} fontSize={11 / view.k} textAnchor="middle" fill={g.color} fontWeight={600}>{f.label || g.label}</text>}
              </g>
            );
          })}

          {p.markers.filter((mk) => mk.at).map((mk, i) => (
            <g key={i} pointerEvents="none">
              <circle cx={mk.at![0]} cy={mk.at![1]} r={9 / view.k} fill="#fff" stroke={SEV_COLOR[mk.severity]} strokeWidth={3 / view.k} />
              <text x={mk.at![0]} y={mk.at![1] + 4 / view.k} fontSize={11 / view.k} textAnchor="middle" fill={SEV_COLOR[mk.severity]} fontWeight={700}>!</text>
            </g>
          ))}

          {sel && !readOnly && tool === "select" && (
            <g>
              {sel.kind !== "tile" && sel.pts.length > 1 && sel.pts.slice(0, sel.closed ? undefined : -1).map((q, i) => {
                const nq = sel.pts[(i + 1) % sel.pts.length];
                return <circle key={`m${i}`} data-vid={p.selectedId!} data-mid={i} cx={(q[0] + nq[0]) / 2} cy={(q[1] + nq[1]) / 2} r={handle / 2.2}
                  fill="#fff" stroke="#0d9488" strokeWidth={1.5 / view.k} style={{ cursor: "copy" }} />;
              })}
              {sel.pts.map((q, i) => (
                <rect key={`v${i}`} data-vid={p.selectedId!} data-vi={i} x={q[0] - handle / 2} y={q[1] - handle / 2} width={handle} height={handle}
                  fill="#0d9488" stroke="#fff" strokeWidth={1.5 / view.k} style={{ cursor: "move" }} />
              ))}
            </g>
          )}
          {sel && (readOnly || tool !== "select") && sel.pts.map((q, i) => (
            <rect key={`s${i}`} x={q[0] - handle / 3} y={q[1] - handle / 3} width={(2 * handle) / 3} height={(2 * handle) / 3} fill="#0d9488" pointerEvents="none" />
          ))}

          {draft.length > 0 && (
            <polyline points={[...draft, ...(hover ? [hover] : [])].map((q) => q.join(",")).join(" ")} fill="none"
              stroke={tool === "calibrate" ? "#db2777" : "#0d9488"} strokeWidth={2 / view.k} strokeDasharray={`${5 / view.k} ${3 / view.k}`} pointerEvents="none" />
          )}
          {draft.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={4 / view.k} fill="#0d9488" pointerEvents="none" />)}
          {drag?.kind === "rect" && (
            <polygon points={rectPoints(drag.start, drag.cur).map((q) => q.join(",")).join(" ")} fill="#facc15" fillOpacity={0.5} stroke="#a16207" strokeWidth={1.5 / view.k} pointerEvents="none" />
          )}
        </g>
      </svg>

      {scaleBar && m && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[11px] text-slate-700 shadow">
          <div className="h-1.5 border-x-2 border-b-2 border-slate-700" style={{ width: (scaleBar / m) * view.k }} />
          {scaleBar} m
        </div>
      )}
      {hover && m && (
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-600 shadow">
          {(hover[0] * m).toFixed(2)} m, {(hover[1] * m).toFixed(2)} m
          {draft.length > 0 && ` · segment ${(dist(draft[draft.length - 1], hover) * m).toFixed(2)} m`}
        </div>
      )}
    </div>
  );
}
