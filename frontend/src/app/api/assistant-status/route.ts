// Tells the UI whether the assistant can run, so the CopilotKit runtime is only contacted when the model is
// configured and actually reachable.
import { assistantCaller, assistantConfig, jsonError, probeAssistant } from "@/lib/assistant/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await assistantCaller(req))) return jsonError(401, "not_authorised", "Sign in as staff or a contractor to use the assistant.");
  const cfg = assistantConfig();
  const reach = cfg ? await probeAssistant(cfg) : { ok: false, reason: "" };
  return Response.json({ configured: !!cfg, reachable: reach.ok, reason: reach.reason, model: cfg?.model ?? null, provider: cfg?.provider ?? null },
    { headers: { "Cache-Control": "no-store" } });
}
