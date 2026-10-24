// Tells the UI whether the assistant can run, so the CopilotKit runtime is only contacted when the model is
// configured and actually reachable.
import { assistantCaller, githubModels, jsonError, probeGithubModels } from "@/lib/assistant/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await assistantCaller(req))) return jsonError(401, "not_authorised", "Sign in as staff or a contractor to use the assistant.");
  const gm = githubModels();
  const reach = gm.token ? await probeGithubModels(gm.token, gm.model) : { ok: false, reason: "" };
  return Response.json({ configured: !!gm.token, reachable: reach.ok, reason: reach.reason, model: gm.model, provider: "GitHub Models" },
    { headers: { "Cache-Control": "no-store" } });
}
