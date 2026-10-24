import type { FeatureType, Geometry, PlanDocument, Pt } from "./types";

export const FEATURE_META: Record<FeatureType, { label: string; geometry: Geometry; color: string; fill?: string; radius?: number }> = {
  footpath: { label: "Footpath", geometry: "polygon", color: "#059669", fill: "rgba(16,185,129,0.12)" },
  boundary: { label: "Site boundary", geometry: "polygon", color: "#334155" },
  entrance: { label: "Entrance", geometry: "point", color: "#0891b2" },
  destination: { label: "Destination", geometry: "point", color: "#db2777" },
  crossing: { label: "Crossing", geometry: "polyline", color: "#7c3aed" },
  kerb: { label: "Kerb edge", geometry: "polyline", color: "#0f172a" },
  stairs: { label: "Stairs", geometry: "polygon", color: "#ea580c", fill: "rgba(251,146,60,0.25)" },
  tree: { label: "Tree", geometry: "point", color: "#16a34a", radius: 0.5 },
  pillar: { label: "Pillar", geometry: "point", color: "#475569", radius: 0.3 },
  obstacle: { label: "Obstacle", geometry: "point", color: "#dc2626", radius: 0.4 },
  obstacle_area: { label: "Obstacle area", geometry: "polygon", color: "#dc2626", fill: "rgba(239,68,68,0.18)" },
};

export const TILE_COLORS = {
  directional: { whole: "#2563eb", cut: "#93c5fd" },
  warning: { whole: "#ca8a04", cut: "#fde047" },
};

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polylineDist(p: Pt, pts: Pt[], closed: boolean): number {
  if (pts.length === 1) return dist(p, pts[0]);
  let d = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) d = Math.min(d, segDist(p, pts[i], pts[(i + 1) % pts.length]));
  return d;
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Nearest existing vertex (routes, warning areas, features) within `tol` plan px. */
export function snapPoint(doc: PlanDocument, p: Pt, tol: number, skipId?: string): Pt {
  let best: Pt = p;
  let bd = tol;
  const visit = (id: string, pts: Pt[]) => {
    if (id === skipId) return;
    for (const q of pts) {
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = [q[0], q[1]];
      }
    }
  };
  doc.routes.forEach((r) => visit(r.id, r.points));
  doc.warning_areas.forEach((w) => visit(w.id, w.points));
  doc.features.forEach((f) => visit(f.id, f.points));
  return best;
}

export function rectPoints(a: Pt, b: Pt): Pt[] {
  return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
}

export const round1 = (p: Pt): Pt => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
