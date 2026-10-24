"use client";

// CopilotKit client for "Ask TenjiCheck". Follows OpenIntelligentUI's approach: the agent answers with text, native
// components (stat cards, bar chart, table, page links) or sandboxed generated UI (openGenerativeUI).
// Data tools call the existing TenjiCheck API with the signed-in user's token, so permissions are unchanged.
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup, useAgentContext, useComponent, useFrontendTool } from "@copilotkit/react-core/v2";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { z } from "zod";
import { api, ApiError, getToken } from "@/lib/api";
import { BarChartCard, LinkCards, StatCards, TableCard } from "./GenerativeCards";

const DESIGN_SKILL = `Visual style for generated UI: a formal public-service look. Light grey-blue background (#eef1f6),
white cards with 20px rounded corners and soft shadows, Inter or system-ui, bold dark headings (#0f172a).
Primary colour: blue #0b5cbf for buttons (white text) and accents. Rounded, full-width primary buttons.
Keep text contrast at least 4.5:1, label every control, support keyboard use, and make no network requests
(no external scripts, fonts or images).`;

async function call<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    return { error: e instanceof ApiError ? `${e.status === 403 ? "Not permitted: " : ""}${e.message}` : "Request failed" };
  }
}
const day = (s?: string | null) => (s ? s.slice(0, 10) : null);
const trunc = (s: string | undefined, n = 160) => (s && s.length > n ? `${s.slice(0, n)}…` : s || "");

/* eslint-disable @typescript-eslint/no-explicit-any */
function Tools({ role }: { role: string }) {
  const path = usePathname();
  useAgentContext({ description: "Where the user is in TenjiCheck", value: { current_page: path, role } });

  useFrontendTool({
    name: "list_inspections",
    description: "List inspections the user can see (newest first) with status and finding counts by status.",
    parameters: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    handler: async ({ limit }) => call(async () => (await api<any[]>("/inspections")).slice(0, limit ?? 40).map((i) => ({
      id: i.id, title: i.title, site: i.site_name, site_id: i.project_id, site_name: i.project_name, status: i.status,
      contractor: i.contractor, created: day(i.created_at), findings_by_status: i.finding_counts, demo: i.is_demo,
    }))),
  });

  useFrontendTool({
    name: "get_inspection",
    description: "Details of one inspection: findings (class, status, severity, verify-on-site), photos, punch lists, handover readiness.",
    parameters: z.object({ inspection_id: z.number().int() }),
    handler: async ({ inspection_id }) => call(async () => {
      const i = await api<any>(`/inspections/${inspection_id}`);
      return {
        id: i.id, title: i.title, status: i.status, site: i.project_name, contractor: i.contractor, created: day(i.created_at),
        photos: i.photos.length, punch_lists: i.punch_lists.length, unreviewed: i.unreviewed_count, handover: i.handover,
        findings: i.findings.map((f: any) => ({ id: f.id, type: f.label, status: f.status, severity: f.severity, source: f.source,
          verify_on_site: f.verify_on_site, description: trunc(f.description), reference: f.rule_reference })),
      };
    }),
  });

  useFrontendTool({
    name: "list_schedules",
    description: "Recurring inspection schedules with state (overdue, due_soon, scheduled, paused) and next due date. Staff only.",
    parameters: z.object({}),
    handler: async () => call(async () => {
      const r = await api<any>("/schedules");
      return { today: r.today, counts: r.counts, schedules: r.items.map((s: any) => ({ id: s.id, title: s.title, site: s.project_name,
        every_days: s.interval_days, next_due: s.next_due, state: s.state, days_until_due: s.days_until_due, contractor: s.contractor,
        last_started: s.runs[0] ? day(s.runs[0].started_at) : null })) };
    }),
  });

  useFrontendTool({
    name: "site_history",
    description: "All inspections of one site (site_id = project id) in date order with finding counts and recurrence from the previous inspection.",
    parameters: z.object({ site_id: z.number().int() }),
    handler: async ({ site_id }) => call(async () => {
      const h = await api<any>(`/projects/${site_id}/history`);
      return { site: h.project.name, note: h.note, inspections: h.inspections.map((i: any) => ({ id: i.id, title: i.title, date: day(i.created_at),
        status: i.status, findings: i.findings, open: i.open, resolved: i.resolved, rejected: i.rejected, by_class: i.by_class,
        recurring_from_previous: i.recurring_from_previous })) };
    }),
  });

  useFrontendTool({
    name: "compare_inspections",
    description: "Compare an earlier and a later inspection of the same site: recurring, new and not-seen-again findings.",
    parameters: z.object({ before_id: z.number().int(), after_id: z.number().int() }),
    handler: async ({ before_id, after_id }) => call(async () => {
      const c = await api<any>(`/inspections/${before_id}/compare/${after_id}`);
      const brief = (f: any) => ({ id: f.id, type: f.label, status: f.status });
      return { before: c.before.title, after: c.after.title, totals: c.totals, by_class: c.by_class, method: c.method, caveat: c.caveat,
        recurring: c.recurring.map((r: any) => ({ before: brief(r.before), after: brief(r.after), distance_m: r.distance_m })),
        new: c.new.map(brief), not_seen_again: c.not_seen_again.map(brief) };
    }),
  });

  useFrontendTool({
    name: "workload_summary",
    description: "Last 90 days: findings by status and class, verify-on-site flags, public reports, punch-list metrics, model evaluation status. Staff only.",
    parameters: z.object({}),
    handler: async () => call(async () => {
      const s = await api<any>("/dashboard/summary");
      return { findings: { total: s.findings.total, by_status: s.findings.by_status, by_class: s.findings.by_class.map((c: any) => ({ type: c.label, count: c.count })),
        verify_on_site: s.findings.verify_on_site, ai_reviewed: s.findings.ai_reviewed, ai_confirmed: s.findings.ai_confirmed, ai_rejected: s.findings.ai_rejected },
        public_reports: { total: s.issues.total, open: s.issues.open, median_days_to_resolve: s.issues.median_days_to_resolve },
        workflow: s.workflow, model_evaluation: s.evaluation?.status ?? "pending" };
    }),
  });

  useFrontendTool({
    name: "list_planning_projects",
    description: "Tactile route planning projects the user owns or may review, with the latest version status.",
    parameters: z.object({}),
    handler: async () => call(async () => (await api<any[]>("/planning/projects")).map((p) => ({ id: p.id, title: p.title, site: p.site_name,
      access: p.access, latest_version: p.latest_version ? `v${p.latest_version.number} ${p.latest_version.status}` : "draft", updated: day(p.updated_at) }))),
  });

  useFrontendTool({
    name: "list_sites",
    description: "Sites (inspection projects) with their id (site_id) and number of inspections.",
    parameters: z.object({}),
    handler: async () => call(async () => (await api<any[]>("/projects")).map((p) => ({ site_id: p.id, name: p.name, location: p.location_name,
      inspections: p.inspection_count, demo: p.is_demo }))),
  });

  useComponent({
    name: "show_stat_cards",
    description: "Show 1–6 headline numbers as cards.",
    parameters: z.object({ title: z.string().optional(), items: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), hint: z.string().optional() })).max(6) }),
    render: StatCards,
  });
  useComponent({
    name: "show_bar_chart",
    description: "Show one series of counts across categories or inspections as a bar chart.",
    parameters: z.object({ title: z.string(), description: z.string().optional(), unit: z.string().optional(),
      data: z.array(z.object({ label: z.string(), value: z.number() })).max(24) }),
    render: BarChartCard,
  });
  useComponent({
    name: "show_table",
    description: "Show rows of records as a table.",
    parameters: z.object({ title: z.string(), columns: z.array(z.string()).max(8), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(60) }),
    render: TableCard,
  });
  useComponent({
    name: "show_links",
    description: "Offer TenjiCheck pages to open, e.g. /inspect/12 or /schedule. Internal paths only.",
    parameters: z.object({ items: z.array(z.object({ label: z.string(), href: z.string(), description: z.string().optional() })).max(6) }),
    render: LinkCards,
  });
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** CopilotKit's chat stylesheet, linked once on first use (see app/vendor/copilotkit.css/route.ts). */
function useCopilotStyles() {
  useEffect(() => {
    if (document.getElementById("copilotkit-css")) return;
    const link = document.createElement("link");
    link.id = "copilotkit-css";
    link.rel = "stylesheet";
    link.href = "/vendor/copilotkit.css";
    document.head.appendChild(link);
  }, []);
}

export default function AssistantRuntime({ open, onOpenChange, role }: { open: boolean; onOpenChange: (o: boolean) => void; role: string }) {
  useCopilotStyles();
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint
      headers={() => ({ Authorization: `Bearer ${getToken() ?? ""}` })}
      enableInspector={false}
      showDevConsole={false}
      openGenerativeUI={{ designSkill: DESIGN_SKILL }}
    >
      <Tools role={role} />
      <div className="tc-assistant">
        <CopilotPopup
          open={open}
          onOpenChange={onOpenChange}
          width={420}
          labels={{
            modalHeaderTitle: "Ask TenjiCheck",
            welcomeMessageText: "Ask about inspections, schedules, site history, planning projects or reports. I answer with cards, charts and tables, using only what your account can see.",
            chatInputPlaceholder: "e.g. Which schedules are overdue?",
            chatDisclaimerText: "AI answers can be wrong. TenjiCheck never certifies compliance.",
          }}
        />
      </div>
    </CopilotKit>
  );
}
