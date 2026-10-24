export type Pt = [number, number];

export type FeatureType =
  | "footpath" | "boundary" | "entrance" | "destination" | "crossing" | "kerb" | "stairs"
  | "tree" | "pillar" | "obstacle" | "obstacle_area";
export type Geometry = "point" | "polyline" | "polygon";

export interface Feature { id: string; type: FeatureType; label: string; points: Pt[]; radius_m?: number | null }
export interface Route { id: string; label: string; points: Pt[]; width_tiles: number }
export interface WarningArea { id: string; label: string; points: Pt[]; angle_deg?: number | null }
export interface PlacedTile { id: string; type: "directional" | "warning"; x: number; y: number; angle_deg: number }
export type LayoutOption = "start" | "centred" | "offset";

export interface PlanDocument {
  schema_version: number;
  canvas: { width: number; height: number };
  scale: { m_per_px: number | null; source: "default" | "calibrated" | "manual" | "none"; calibration?: { a: Pt; b: Pt; length_m: number } | null };
  site_image_id: number | null;
  features: Feature[];
  routes: Route[];
  warning_areas: WarningArea[];
  tiles: PlacedTile[];
  layout_option: LayoutOption;
}

export interface PriceSpec { pack_size: number; price_per_pack: number; supplier: string }
export interface PlanSettings {
  tile_size_mm: number; kerf_mm: number; min_offcut_mm: number; sliver_fraction: number; reuse_offcuts: boolean;
  spare_pct: number; min_spare_tiles: number; currency: string; cut_cost_per_cut: number;
  prices: { directional: PriceSpec; warning: PriceSpec };
  clearance_m: number; hazard_approach_m: number; min_warning_depth_m: number; turn_review_deg: number; connect_tolerance_m: number;
}

export interface ValidationItem { severity: "error" | "warning" | "review" | "info"; code: string; message: string; at: Pt | null; ids: string[]; reference: string | null }
export interface Validation { items: ValidationItem[]; counts: Record<string, number>; thresholds: Record<string, number>; reference_set: string; statement: string }

export interface TypeEstimate {
  area_m2: number; whole_tiles: number; cut_pieces: number; new_tiles_for_cuts: number; pieces_from_offcuts: number;
  leftover_offcuts: number; leftover_offcut_area_m2: number; sliver_pieces: number; tiles_required: number;
  waste_area_m2: number; waste_pct: number; spare_tiles: number; packs: number; pack_size: number; purchase_tiles: number;
  pack_surplus_tiles: number; material_cost: number; cutting_cost: number; naive_area_estimate_tiles: number; supplier: string;
}
export interface TileCell { type: "directional" | "warning"; kind: "whole" | "cut"; source: string; polygon: Pt[] }
export interface Estimate {
  ok: boolean; reason?: string; engine_version?: string; layout_option?: LayoutOption; tile_size_mm?: number; currency?: string;
  by_type?: { directional: TypeEstimate; warning: TypeEstimate };
  totals?: Record<string, number>; assumptions?: string[]; cells?: TileCell[]; cells_truncated?: boolean;
}
export interface ComparisonRow {
  option: LayoutOption; description: string; valid: boolean; area_m2: number;
  tiles_required: Record<string, number>; purchase_tiles: Record<string, number>; cut_pieces: number; slivers: number;
  reusable_offcuts_left: number; waste_area_m2: number; waste_pct: number; total_cost: number;
  recommended?: boolean; waste_vs_start_m2?: number; cost_vs_start?: number;
}
export interface Analysis { validation: Validation; estimate: Estimate; comparison: ComparisonRow[] }

export interface VersionSummary {
  id: number; number: number; label: string; status: "saved" | "submitted" | "approved" | "rejected";
  created_by: string | null; created_at: string; submitted_at: string | null; counts: Record<string, number>;
  total_cost: number | null; currency: string | null;
  reviews: { decision: string; note: string; reviewer: string | null; at: string }[];
}
export interface PlanningProject {
  id: number; title: string; site_name: string; description: string; project_id: number | null; owner: string | null;
  access: "owner" | "reviewer"; created_at: string; updated_at: string; revision: number; latest_version: VersionSummary | null;
  document?: PlanDocument; settings?: PlanSettings; versions?: VersionSummary[];
  site_images?: { id: number; width: number; height: number; name: string }[];
}
