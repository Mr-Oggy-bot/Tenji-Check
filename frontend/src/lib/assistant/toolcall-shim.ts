// Server-only. Some local models (e.g. qwen2.5-coder on Ollama) answer a tool call as plain JSON text instead of a
// structured `tool_calls` field, so the agent never runs the tool. This fetch wrapper asks the server for a complete
// (non-streamed) reply, turns such JSON into proper tool calls when it names one of the offered tools, and replays
// the result as an OpenAI-style event stream. Replies arrive in one piece instead of word by word.

type Call = { name: string; arguments?: unknown };

function candidates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) out.push(m[1]);
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) out.push(m[1]);
  out.push(text);
  return out;
}

/** Top-level JSON objects/arrays in a text, in order (handles several calls on separate lines). */
function jsonValues(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{" || ch === "[") { if (depth === 0) start = i; depth++; }
    else if ((ch === "}" || ch === "]") && depth > 0 && --depth === 0 && start >= 0) {
      try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip */ }
      start = -1;
    }
  }
  return out;
}

/** Tool calls written as JSON in the reply text, limited to the offered tool names. */
export function extractToolCalls(text: string, names: string[]): Call[] {
  for (const c of candidates(text.trim())) {
    const list: Call[] = jsonValues(c).flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((x): x is Call => !!x && typeof (x as Call).name === "string");
    if (list.length && list.every((x) => names.includes(x.name))) {
      // Fetch data before drawing: when data tools and show_* tools come together, run only the data tools now;
      // the model renders after it has seen the results.
      const data = list.filter((x) => !x.name.startsWith("show_"));
      return data.length ? data : list;
    }
  }
  return [];
}

/** True when the reply only calls show_* tools with no rows, items or data in them. */
function drawsNothing(j: { choices?: { message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] } }[] }, names: string[]): boolean {
  const msg = j.choices?.[0]?.message ?? {};
  const calls: { name: string; arguments?: unknown }[] = msg.tool_calls?.length
    ? msg.tool_calls.map((t) => ({ name: t.function.name, arguments: typeof t.function.arguments === "string" ? safeParse(t.function.arguments) : t.function.arguments }))
    : extractToolCalls(msg.content ?? "", names);
  if (!calls.length || !calls.every((c) => c.name.startsWith("show_"))) return false;
  return calls.every((c) => {
    const a = (c.arguments ?? {}) as Record<string, unknown>;
    return ["rows", "items", "data"].every((k) => !Array.isArray(a[k]) || (a[k] as unknown[]).length === 0);
  });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

const NO_DATA = "I could not look that up. Try asking about inspections, schedules, sites, findings or planning projects.";

export function toolCallShim(): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") return fetch(input, init);
    let body: Record<string, unknown>;
    try { body = JSON.parse(init.body); } catch { return fetch(input, init); }
    if (!body.stream) return fetch(input, init);
    const { stream_options: _drop, ...rest } = body as { stream_options?: unknown } & Record<string, unknown>;
    void _drop;
    const ask = (extra?: string) => fetch(input, { ...init, body: JSON.stringify({ ...rest, stream: false,
      ...(extra ? { messages: [...(rest.messages as unknown[]), { role: "system", content: extra }] } : {}) }) });
    let r = await ask();
    if (!r.ok) return r;
    let j = await r.json();
    // A small model sometimes draws before it has fetched anything; ask once more to fetch first.
    const hadResults = ((rest.messages as { role?: string }[]) ?? []).some((m) => m.role === "tool");
    if (!hadResults && drawsNothing(j, ((body.tools as { function?: { name?: string } }[]) ?? []).map((t) => t.function?.name ?? ""))) {
      r = await ask("First call a data tool (for example list_schedules, list_inspections or workload_summary) to get real data. Do not call show_* tools yet.");
      if (!r.ok) return r;
      j = await r.json();
    }
    const choice = j.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    let content: string = msg.content ?? "";
    let calls: { id: string; name: string; args: string }[] = (msg.tool_calls ?? []).map(
      (t: { id?: string; function: { name: string; arguments: unknown } }, i: number) => ({
        id: t.id || `call_${Date.now()}_${i}`, name: t.function.name,
        args: typeof t.function.arguments === "string" ? t.function.arguments : JSON.stringify(t.function.arguments ?? {}),
      }));
    const tools = (body.tools as { function?: { name?: string } }[] | undefined) ?? [];
    if (!calls.length && tools.length && content) {
      const found = extractToolCalls(content, tools.map((t) => t.function?.name ?? "").filter(Boolean));
      if (found.length) {
        calls = found.map((c, i) => ({ id: `call_${Date.now()}_${i}`, name: c.name, args: JSON.stringify(c.arguments ?? {}) }));
        content = "";
      }
    }
    // Safeguards: never draw before real data was fetched, and never show raw tool-call JSON to the user.
    if (!hadResults && calls.length && calls.every((c) => c.name.startsWith("show_"))) {
      calls = [];
      content = NO_DATA;
    }
    if (!calls.length && /^\s*[[{]/.test(content) && /"name"\s*:/.test(content)) content = NO_DATA;
    const base = { id: j.id ?? `chatcmpl-${Date.now()}`, object: "chat.completion.chunk", created: j.created ?? Math.floor(Date.now() / 1000), model: j.model };
    const chunks: unknown[] = [];
    if (content) chunks.push({ ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] });
    if (calls.length) chunks.push({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: calls.map((c, i) => ({ index: i, id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) }, finish_reason: null }] });
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: calls.length ? "tool_calls" : (choice.finish_reason ?? "stop") }], usage: j.usage ?? null });
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}
