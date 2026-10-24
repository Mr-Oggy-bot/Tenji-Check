// Serves CopilotKit's prebuilt chat stylesheet untouched. It is Tailwind v4 output, which the app's Tailwind v3
// PostCSS pipeline cannot process, so it is linked at runtime (only when the assistant opens) instead of imported.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const css = await readFile(path.join(process.cwd(), "node_modules", "@copilotkit", "react-core", "dist", "v2", "index.css"), "utf8");
  return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
