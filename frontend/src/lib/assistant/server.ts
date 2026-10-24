// Server-only helpers for the assistant routes. Never import this from client components.
import { readFileSync } from "node:fs";
import path from "node:path";

export const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const ROLES = new Set(["admin", "inspector", "engineer", "contractor"]);

/** TC_GITHUB_MODELS_TOKEN from the environment, else from backend/.env so the token is configured in one place. */
export function githubModels(): { token: string; model: string } {
  let token = process.env.TC_GITHUB_MODELS_TOKEN || "";
  let model = process.env.TC_GITHUB_MODELS_MODEL || "";
  if (!token) {
    try {
      const env = readFileSync(process.env.TC_BACKEND_ENV_FILE || path.join(process.cwd(), "..", "backend", ".env"), "utf8");
      for (const line of env.split(/\r?\n/)) {
        const m = /^\s*(TC_GITHUB_MODELS_TOKEN|TC_GITHUB_MODELS_MODEL)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) continue;
        const v = m[2].replace(/^["']|["']$/g, "");
        if (m[1] === "TC_GITHUB_MODELS_TOKEN") token = v;
        else if (!model) model = v;
      }
    } catch {
      /* no backend/.env: not configured */
    }
  }
  return { token, model: model || "openai/gpt-4.1-mini" };
}

let probe: { at: number; ok: boolean; reason: string } | null = null;

/** Checks (cached 5 min if it works, 30 s if not) that GitHub Models really answers. Some networks return a bare "200 OK" for it. */
export async function probeGithubModels(token: string, model: string): Promise<{ ok: boolean; reason: string }> {
  if (probe && Date.now() - probe.at < (probe.ok ? 5 * 60_000 : 30_000)) return probe;
  let ok = false;
  let reason = "";
  try {
    const r = await fetch("https://models.github.ai/inference/chat/completions", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
    const type = r.headers.get("content-type") || "";
    if (r.status === 401 || r.status === 403) reason = "GitHub Models rejected the token (it needs the models:read permission).";
    else if (r.status === 429) reason = "GitHub Models rate limit reached. Try again later.";
    else if (!type.includes("json")) reason = "GitHub Models is not reachable from this network: it answered with a non-API response. A VPN, firewall or filtering service (e.g. Cloudflare WARP or a campus network) is intercepting it.";
    else if (!r.ok) reason = `GitHub Models returned HTTP ${r.status}.`;
    else ok = true;
  } catch {
    reason = "Could not reach GitHub Models from the server.";
  }
  probe = { at: Date.now(), ok, reason };
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
