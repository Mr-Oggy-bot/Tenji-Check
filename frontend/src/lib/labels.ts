export const FINDING_STATUS: Record<string, { label: string; tone: Tone }> = {
  ai_proposed: { label: "AI proposed", tone: "violet" },
  under_review: { label: "Under review", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "red" },
  rejected: { label: "Rejected", tone: "slate" },
  fix_required: { label: "Fix required", tone: "red" },
  awaiting_reinspection: { label: "Awaiting reinspection", tone: "amber" },
  verified: { label: "Verified", tone: "teal" },
  closed: { label: "Closed", tone: "green" },
};

export const ISSUE_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Submitted", tone: "violet" },
  under_review: { label: "Under review", tone: "amber" },
  assigned: { label: "Assigned", tone: "blue" },
  in_progress: { label: "In progress", tone: "blue" },
  resolved: { label: "Resolved", tone: "green" },
  rejected: { label: "Rejected", tone: "slate" },
};

export const SURVEY_STATUS: Record<string, { label: string; tone: Tone }> = {
  recording: { label: "Recording", tone: "red" },
  draft: { label: "Draft", tone: "slate" },
  submitted: { label: "Submitted for approval", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "slate" },
};

export const ROUTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft — needs engineer review", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "slate" },
  superseded: { label: "Superseded", tone: "slate" },
};

export const DEFECT_LABEL: Record<string, string> = {
  obstacle_on_path: "Obstacle on guide path",
  interrupted_path: "Interrupted guide path",
  missing_warning_tiles: "Missing warning tiles",
  damaged_tactile_tile: "Damaged tactile tile",
  unassessable: "Not assessable from photo",
  other: "Other",
};

export const CONTEXT_LABEL: Record<string, string> = {
  segment: "Path segment",
  path_end: "Path end",
  crossing: "Crossing / kerb",
  other: "Other",
};

export const OBSERVATION_LABEL: Record<string, string> = {
  obstacle: "Obstacle",
  crossing: "Crossing",
  kerb_ramp: "Kerb ramp",
  candidate_segment: "Candidate tactile segment",
  existing_tactile: "Existing tactile paving",
  drain_or_utility: "Drain / utility cover",
  uncertain: "Uncertain — needs check",
  note: "Note",
};

export const ACTION_LABEL: Record<string, string> = {
  start_review: "Start review",
  confirm: "Confirm",
  reject: "Reject",
  issue_punch_list: "Issue punch list",
  reopen_review: "Reopen review",
  submit_repair: "Submit repair",
  pass_reinspection: "Pass reinspection",
  fail_reinspection: "Fail reinspection",
  close: "Close finding",
};

export type Tone = "violet" | "amber" | "red" | "slate" | "teal" | "green" | "blue";

export function fmtDate(s: string | null | undefined, withTime = true): string {
  if (!s) return "—";
  const d = new Date(s);
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;
}
