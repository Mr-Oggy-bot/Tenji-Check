// Server-only helpers for the assistant routes. Never import this from client components.
import { readFileSync } from "node:fs";
import path from "node:path";

export const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const ROLES = new Set(["admin", "inspector", "engineer", "contractor"]);

export interface AssistantConfig {
  baseURL: string; // any OpenAI-compatible chat-completions endpoint, e.g. a local Ollama server
  apiKey: string;
  model: string;
  provider: string; // label shown to users
  generativeUI: boolean; // sandboxed generated UI needs a strong model; off by default for small local ones
  toolCallShim: boolean; // convert tool calls that a local model writes as plain JSON (see toolcall-shim.ts)
}

const KEYS = ["TC_ASSISTANT_BASE_URL", "TC_ASSISTANT_API_KEY", "TC_ASSISTANT_MODEL", "TC_ASSISTANT_PROVIDER", "TC_ASSISTANT_GENERATIVE_UI", "TC_ASSISTANT_TOOL_SHIM"] as const;

/** Assistant settings from the environment, else from backend/.env so they are configured in one place. */
export function assistantConfig(): AssistantConfig | null {
  const v: Record<string, string> = {};
  for (const k of KEYS) if (process.env[k]) v[k] = process.env[k]!;
  try {
    const env = readFileSync(process.env.TC_BACKEND_ENV_FILE || path.join(process.cwd(), "..", "backend", ".env"), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && (KEYS as readonly string[]).includes(m[1]) && !(m[1] in v)) v[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no backend/.env */
  }
  if (!v.TC_ASSISTANT_BASE_URL || !v.TC_ASSISTANT_MODEL) return null;
  return {
    baseURL: v.TC_ASSISTANT_BASE_URL.replace(/\/+$/, ""),
    apiKey: v.TC_ASSISTANT_API_KEY || "not-needed",
    model: v.TC_ASSISTANT_MODEL,
    provider: v.TC_ASSISTANT_PROVIDER || "AI model",
    generativeUI: /^(1|true|yes)$/i.test(v.TC_ASSISTANT_GENERATIVE_UI || ""),
    toolCallShim: /^(1|true|yes)$/i.test(v.TC_ASSISTANT_TOOL_SHIM || ""),
  };
}

let probe: { at: number; key: string; ok: boolean; reason: string } | null = null;

/** Checks (cached 5 min if it works, 30 s if not) that the model server answers and has the configured model. */
export async function probeAssistant(cfg: AssistantConfig): Promise<{ ok: boolean; reason: string }> {
  const key = `${cfg.baseURL}|${cfg.model}`;
  if (probe && probe.key === key && Date.now() - probe.at < (probe.ok ? 5 * 60_000 : 30_000)) return probe;
  let ok = false;
  let reason = "";
  try {
    const r = await fetch(`${cfg.baseURL}/models`, {
      cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    const type = r.headers.get("content-type") || "";
    if (r.status === 401 || r.status === 403) reason = `${cfg.provider} rejected the API key.`;
    else if (!r.ok || !type.includes("json")) reason = `${cfg.provider} returned an unexpected response (HTTP ${r.status}).`;
    else {
      const ids: string[] = ((await r.json()).data ?? []).map((m: { id: string }) => m.id);
      if (ids.length && !ids.includes(cfg.model)) reason = `${cfg.provider} does not have the model "${cfg.model}".`;
      else ok = true;
    }
  } catch {
    reason = `${cfg.provider} is not running or not reachable at ${cfg.baseURL}.`;
  }
  probe = { at: Date.now(), key, ok, reason };
  return probe;
}

/** The signed-in TenjiCheck user behind the request's bearer token, if they may use the assistant. */
export async function assistantCaller(req: Request): Promise<{ role: string } | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const r = await fetch(`${BACKEND}/api/v1/auth/me`, { headers: { Authorization: auth }, cache: "no-store" });
    if (!r.ok) return null;
    const u = (await r.json()) as { role?: string };
    return u.role && ROLES.has(u.role) ? { role: u.role } : null;
  } catch {
    return null;
  }
}

export const jsonError = (status: number, code: string, message: string) =>
  Response.json({ detail: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
