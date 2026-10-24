"use client";

import dynamic from "next/dynamic";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  color: string;
  label?: string;
  popup?: React.ReactNode;
  radius?: number;
  draggable?: boolean;
  onDragEnd?: (lat: number, lon: number) => void;
  onClick?: () => void;
}

export interface MapLine {
  points: [number, number][];
  color: string;
  dashed?: boolean;
  weight?: number;
  label?: string;
}

export interface MapViewProps {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  lines?: MapLine[];
  onMapClick?: (lat: number, lon: number) => void;
  fit?: [number, number][];
  fitKey?: string | number;
  height?: number;
}

const Inner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => <div className="grid h-[420px] place-items-center rounded-xl bg-slate-100 text-sm text-slate-500">Loading map…</div>,
});

export function MapView(props: MapViewProps) {
  return (
    <div role="region" aria-label="Map" className="overflow-hidden rounded-xl border border-slate-200">
      <Inner {...props} />
    </div>
  );
}
