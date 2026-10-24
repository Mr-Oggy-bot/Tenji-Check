// The portal's services: one list drives the sidebar, the service search and the home page grid.
import {
  BarChart3, Boxes, CalendarClock, ClipboardCheck, Hammer, History, Home, ListChecks, Map, Megaphone, Route, Ruler, ScanLine,
  Search, ShieldCheck, Users,
} from "lucide-react";
import type { Role } from "./types";

export type Viewer = Role | "anon";
export interface Service { href: string; label: string; description?: string; icon: React.ElementType; roles: Viewer[]; keywords?: string }

const STAFF: Role[] = ["admin", "inspector", "engineer"];
const WORKERS: Role[] = ["admin", "inspector", "engineer", "contractor"];

export const SECTIONS: { title: string; items: Service[] }[] = [
  { title: "", items: [{ href: "/", label: "Home", icon: Home, roles: ["admin", "inspector", "engineer", "contractor", "citizen", "anon"] }] },
  {
    title: "Inspect",
    items: [
      { href: "/inspect", label: "Inspections", description: "Photo screening and punch lists before handover", icon: ClipboardCheck, roles: STAFF, keywords: "photo ai defect punch list handover" },
      { href: "/review", label: "Review queue", description: "Confirm or reject AI findings", icon: ShieldCheck, roles: ["admin", "inspector"], keywords: "confirm reject findings" },
      { href: "/schedule", label: "Inspection schedule", description: "Recurring inspections and due dates", icon: CalendarClock, roles: STAFF, keywords: "recurring due overdue" },
      { href: "/history", label: "Site history", description: "Compare inspections of a site", icon: History, roles: WORKERS, keywords: "compare previous inspections" },
      { href: "/tasks", label: "My fix tasks", description: "Repairs assigned to you", icon: Hammer, roles: ["contractor", "admin"], keywords: "repair contractor" },
    ],
  },
  {
    title: "Build",
    items: [
      { href: "/build", label: "Site surveys", description: "GPS walk surveys and route options", icon: Route, roles: WORKERS, keywords: "gps corridor route" },
      { href: "/live", label: "Live path planner", description: "Camera guidance for laying a strip", icon: ScanLine, roles: WORKERS, keywords: "camera obstacles strip" },
      { href: "/planning", label: "Planning & Estimation", description: "Tactile layouts, tiles and cost", icon: Ruler, roles: WORKERS, keywords: "tiles cost estimate layout" },
    ],
  },
  {
    title: "Report",
    items: [
      { href: "/report", label: "Report an issue", description: "Blocked, broken or missing tactile paving", icon: Megaphone, roles: ["citizen", "anon", "admin", "inspector", "engineer", "contractor"], keywords: "complaint blocked broken" },
      { href: "/report/status", label: "Track a report", description: "Check progress with your reference", icon: Search, roles: ["citizen", "anon"], keywords: "reference status" },
      { href: "/report/mine", label: "My reports", description: "Reports you have submitted", icon: ListChecks, roles: ["citizen"], keywords: "complaints" },
      { href: "/reports", label: "Report queue", description: "Public reports to triage", icon: ListChecks, roles: STAFF, keywords: "public complaints triage" },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/map", label: "Shared map", description: "Reports and findings on a map", icon: Map, roles: ["admin", "inspector", "engineer", "contractor", "citizen"] },
      { href: "/dashboard", label: "Dashboard", description: "Workload and performance figures", icon: BarChart3, roles: STAFF, keywords: "metrics statistics" },
      { href: "/models", label: "AI models", description: "Models in use and their status", icon: Boxes, roles: WORKERS },
      { href: "/admin/users", label: "Users", description: "Staff and citizen accounts", icon: Users, roles: ["admin"], keywords: "accounts staff" },
    ],
  },
];

export function servicesFor(viewer: Viewer): Service[] {
  return SECTIONS.flatMap((s) => s.items).filter((i) => i.href !== "/" && i.roles.includes(viewer));
}

/** Where "My reports" in the bottom bar goes for each viewer. */
export function myWork(viewer: Viewer): { href: string; label: string } {
  if (viewer === "citizen") return { href: "/report/mine", label: "My Reports" };
  if (viewer === "contractor") return { href: "/tasks", label: "My Tasks" };
  if (viewer === "anon") return { href: "/report/status", label: "Track" };
  return { href: "/reports", label: "Reports" };
}
