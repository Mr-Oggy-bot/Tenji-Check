// CopilotKit runtime for the "Ask TenjiCheck" assistant (pattern from CopilotKit/OpenIntelligentUI).
//
// - The model is any OpenAI-compatible chat-completions server set in backend/.env (by default a local Ollama
//   server). Any API key is read on the server only and never reaches the browser.
// - Only signed-in staff and contractors may use it: the caller's TenjiCheck bearer token is checked with the backend.
// - The agent has no server-side data access. It reads TenjiCheck data only through frontend tools that call the
//   existing API with the user's own token, so it never sees more than the user can.
import "./no-telemetry";
import { createOpenAI } from "@ai-sdk/openai";
import { CopilotRuntime, ExperimentalEmptyAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import type { NextRequest } from "next/server";
import { ASSISTANT_PROMPT } from "@/lib/assistant/prompt";
import { assistantCaller, assistantConfig, jsonError } from "@/lib/assistant/server";
import { toolCallShim } from "@/lib/assistant/toolcall-shim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  if (!(await assistantCaller(req))) return jsonError(401, "not_authorised", "Sign in as staff or a contractor to use the assistant.");
  const cfg = assistantConfig();
  if (!cfg) return jsonError(503, "assistant_not_configured", "The assistant is off. Set TC_ASSISTANT_BASE_URL and TC_ASSISTANT_MODEL on the server.");

  const provider = createOpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, name: "assistant", ...(cfg.toolCallShim ? { fetch: toolCallShim() } : {}) });
  const agent = new BuiltInAgent({ model: provider.chat(cfg.model), prompt: ASSISTANT_PROMPT, temperature: 0.2, maxSteps: 8 });
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime: new CopilotRuntime({ agents: { default: agent }, openGenerativeUI: cfg.generativeUI }),
  });
  return handleRequest(req);
}

export const GET = handle;
export const POST = handle;
