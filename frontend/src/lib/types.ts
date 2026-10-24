export type Role = "admin" | "inspector" | "engineer" | "contractor" | "citizen";

export interface User {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  is_active: boolean;
}

export interface MediaInfo {
  id: number;
  kind: string;
  width: number;
  height: number;
  url: string;
  annotated_url: string | null;
  original_url?: string;
  lat: number | null;
  lon: number | null;
  gps_accuracy_m: number | null;
  context_tag: string | null;
  segment_label: string;
  quality_ok: boolean;
  quality: { ok: boolean; blur_variance: number; mean_brightness: number; problems: { code: string; message: string }[] };
  privacy: { faces_blurred?: number; plates_blurred?: number };
  created_at: string;
}

export interface Candidate {
  defect_class: string;
  title: string;
  confidence: number | null;
  bbox: number[] | null;
  description: string;
  verify_on_site: boolean;
  uncertainty_note: string;
  rule_reference: string;
  measurement: Record<string, number>;
}

export interface AnalysisInfo {
  id: number;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  latency_ms: number | null;
  error: string | null;
  tile_model: string;
  obstacle_model: string;
  rules_version: string;
  result: {
    tiles?: { method: string; version: string; area_fraction: number; components: number; notes: string[] };
    geometry?: {
      reliable: boolean;
      notes: string[];
      tile_period_px: number | null;
      length_tiles: number | null;
      gaps: { length_tiles: number | null; bbox: number[] }[];
      ends: Record<string, { visible: boolean; type: string }>;
    } | null;
    obstacles?: {
      available: boolean;
      model: string;
      reason?: string;
      error?: string;
      detections: { class_name: string; prompt: string; confidence: number; bbox: number[]; uncertain: boolean }[];
    };
    candidates?: Candidate[];
    notes?: string[];
  };
}

export interface FindingEvent {
  from: string | null;
  to: string;
  actor: string;
  note: string;
  at: string;
  data: Record<string, unknown>;
}

export interface Finding {
  id: number;
  inspection_id: number;
  source: "ai" | "manual";
  defect_class: string;
  label: string;
  status: string;
  severity: string;
  verify_on_site: boolean;
  uncertainty_note: string;
  confidence: number | null;
  bbox: number[] | null;
  measurement: Record<string, number>;
  rule_reference: string;
  description: string;
  required_fix: string;
  context_tag: string | null;
  lat: number | null;
  lon: number | null;
  ai_output: Record<string, unknown>;
  reviewer: string | null;
  reviewed_at: string | null;
  review_decision: string | null;
  review_notes: string;
  reinspected_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  punch_item_no: number | null;
  created_at: string;
  media: MediaInfo | null;
  repair_media: MediaInfo | null;
  repair_ai_check?: { status: string; candidates: Candidate[] } | null;
  actions: string[];
  events?: FindingEvent[];
  inspection_title?: string;
  project_name?: string;
}

export interface PunchListInfo {
  id: number;
  version: number;
  generated_by: string;
  created_at: string;
  item_count: number;
  complete_items: number;
  pdf_url: string;
}

export interface InspectionSummary {
  id: number;
  title: string;
  site_name: string;
  status: string;
  is_demo: boolean;
  contractor: string | null;
  contractor_id: number | null;
  created_at: string;
  finding_counts: Record<string, number>;
  project_id: number;
  project_name: string;
}

export interface InspectionDetail extends InspectionSummary {
  photos: (MediaInfo & { analysis: AnalysisInfo | null })[];
  findings: Finding[];
  punch_lists: PunchListInfo[];
  handover: { ready: boolean; blocking_reasons: string[]; statement: string };
  handover_by: string | null;
  handover_at: string | null;
  unreviewed_count: number;
  context_tags: string[];
}

export interface Issue {
  id: number;
  reference: string;
  category: string;
  category_label: string;
  description: string;
  status: string;
  severity: string | null;
  lat: number | null;
  lon: number | null;
  location_confirmed: boolean;
  source: string;
  is_demo: boolean;
  assigned_to: number | null;
  assignee: string | null;
  rejection_reason: string;
  duplicate_of_id: number | null;
  possible_duplicates: number[];
  created_at: string;
  updated_at: string;
  age_days: number;
  allowed_transitions: string[];
  reporter?: string;
  reporter_contact?: string;
  media?: (MediaInfo & { analysis: AnalysisInfo | null })[];
  events?: { from: string | null; to: string; note: string; at: string; actor: string | null }[];
  reviews?: { decision: string; edited_category: string | null; notes: string; reviewer: string; at: string }[];
}

export interface RouteCandidate {
  id: number;
  batch: number;
  rank: number;
  geometry: [number, number][];
  distance_m: number;
  score: number;
  score_breakdown: {
    costs: Record<string, number>;
    weights: Record<string, number | boolean>;
    barrier_count: number;
    barriers: string[];
    crossing_count: number;
    unverified_fraction: number;
    turns: number;
    assumptions: string[];
    missing_data: string[];
  };
  materials: {
    directional_tiles: number;
    warning_tiles: number;
    warning_bands: number;
    waste_factor: number;
    tile_size_m: number;
    note: string;
  };
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  review_note: string;
  created_at: string;
}

export interface Survey {
  id: number;
  title: string;
  status: string;
  notes: string;
  created_by: string | null;
  owner_id: number;
  started_at: string;
  ended_at: string | null;
  is_demo: boolean;
  reviewed_by: string | null;
  review_note: string;
  point_count: number;
  observation_count: number;
  track?: { id: number; lat: number; lon: number; accuracy_m: number | null; recorded_at: string }[];
  observations?: {
    id: number;
    lat: number;
    lon: number;
    accuracy_m: number | null;
    location_source: string;
    observation_type: string;
    note: string;
    media: MediaInfo | null;
  }[];
  routes?: RouteCandidate[];
}

export interface LiveObstacle {
  class: string;
  prompt: string;
  confidence: number;
  bbox: [number, number, number, number];
  distance_m: number | null;
  avoided: boolean;
}

export interface LivePlan {
  ok: boolean;
  points_m: [number, number][];
  length_m: number;
  turns: number;
  min_clearance_m: number | null;
  unpaved_m: number;
  existing_m: number;
  new_m: number;
  stop_reason: string;
  stop_code: string;
  materials: { directional_tiles?: number; warning_tiles?: number; warning_pads?: number; strip_width_m?: number };
  notes: string[];
  strip_polygon: [number, number][];
  centreline: [number, number][];
}

export interface LiveResult {
  ok: true;
  frame: { width: number; height: number };
  camera: { pitch_deg: number; pitch_source: string; height_m: number; hfov_deg: number; horizon_y: number };
  plan: LivePlan;
  obstacles: LiveObstacle[];
  surface: { overlay_png: string; fractions: Record<string, number>; existing_tactile_fraction: number };
  birds_eye_png: string;
  grid: { cell_m: number; half_width_m: number; max_range_m: number };
  models: Record<string, string>;
  timings: Record<string, number>;
  notes: string[];
  disclaimer: string;
}

export interface LiveStatus {
  surface: Record<string, { available: boolean; model: string; reason: string }>;
  default_quality: string;
  obstacles: { available: boolean; model: string; reason: string };
  github_models: { configured: boolean; model: string };
  defaults: { clearance_m: number; height_m: number; hfov_deg: number };
}
