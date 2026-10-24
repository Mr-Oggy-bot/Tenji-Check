"use client";

import { useRef, useState } from "react";

export interface Box {
  bbox: number[];
  label: string;
  color?: string;
  dashed?: boolean;
}

/**
 * Shows a photo with evidence boxes (image-pixel coordinates). In `drawing` mode the user drags (or taps twice)
 * to mark a region, which is reported back in image pixels — the tap-to-mark fallback when AI misses a defect.
 */
export function ImageAnnotator({
  src, width, height, boxes = [], drawing = false, onDraw, alt,
}: {
  src: string; width: number; height: number; boxes?: Box[]; drawing?: boolean; onDraw?: (bbox: number[]) => void; alt: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<[number, number] | null>(null);
  const [current, setCurrent] = useState<number[] | null>(null);

  const toImage = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height];
  };
  const norm = (a: [number, number], b: [number, number]) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];

  const pct = (b: number[]) => ({
    left: `${(b[0] / width) * 100}%`,
    top: `${(b[1] / height) * 100}%`,
    width: `${((b[2] - b[0]) / width) * 100}%`,
    height: `${((b[3] - b[1]) / height) * 100}%`,
  });

  return (
    <div
      ref={ref}
      className={`relative w-full select-none overflow-hidden rounded-lg bg-slate-900 ${drawing ? "cursor-crosshair touch-none ring-2 ring-tactile-500" : ""}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={(e) => {
        if (!drawing) return;
        const p = toImage(e);
        if (start && !current) return;
        setStart(p);
        setCurrent(null);
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => drawing && start && setCurrent(norm(start, toImage(e)))}
      onPointerUp={(e) => {
        if (!drawing || !start) return;
        const b = norm(start, toImage(e));
        const small = b[2] - b[0] < width * 0.02 || b[3] - b[1] < height * 0.02;
        const finalBox = small
          ? [Math.max(0, b[0] - width * 0.06), Math.max(0, b[1] - height * 0.06), Math.min(width, b[0] + width * 0.06), Math.min(height, b[1] + height * 0.06)]
          : b;
        setStart(null);
        setCurrent(null);
        onDraw?.(finalBox.map(Math.round));
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      {boxes.map((b, i) => (
        <div
          key={i}
          className="pointer-events-none absolute border-[3px]"
          style={{ ...pct(b.bbox), borderColor: b.color || "#e53e3e", borderStyle: b.dashed ? "dashed" : "solid" }}
        >
          <span className="absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: b.color || "#e53e3e" }}>
            {b.label}
          </span>
        </div>
      ))}
      {current && <div className="pointer-events-none absolute border-2 border-dashed border-tactile-400 bg-tactile-400/20" style={pct(current)} />}
      {drawing && (
        <p className="absolute bottom-2 left-2 rounded bg-ink-950/80 px-2 py-1 text-xs text-white">Drag over the defect, or tap it</p>
      )}
    </div>
  );
}
