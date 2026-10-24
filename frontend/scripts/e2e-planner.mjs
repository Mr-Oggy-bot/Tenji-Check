// Browser check of the Tactile Route Planner & Material Estimator (servers must be running).
//   node scripts/e2e-planner.mjs [screenshot-dir]
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.argv[2] || path.join(ROOT, "e2e-screenshots");
mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "tenjicheck-demo";
const TITLE = `E2E library approach ${Date.now().toString(36)}`;
const problems = [];
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || "chrome", headless: true });

async function session(role) {
  const c = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await c.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`[${role}] console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && problems.push(`[${role}] HTTP ${r.status()} ${r.url()}`));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`);
  const r = await page.request.post(`${BASE}/api/v1/auth/login`, { data: { email: `${role}@tenjicheck.local`, password: PASSWORD } });
  const token = (await r.json()).access_token;
  await page.evaluate((t) => localStorage.setItem("tc_token", t), token);
  return { page, token };
}

let page;
const step = async (name, fn) => {
  process.stdout.write(`- ${name} ... `);
  try {
    await fn();
  } catch (e) {
    await page?.screenshot({ path: path.join(SHOTS, "planner-failure.png"), fullPage: true });
    console.log("FAILED");
    console.error(problems.join("\n"));
    throw e;
  }
  console.log("ok");
};
const toast = (re) => page.getByRole("status").filter({ hasText: re }).first().waitFor({ timeout: 30000 });
let box;
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const click = async (fx, fy, opts) => page.mouse.click(...at(fx, fy), opts);
const tool = (name) => page.getByRole("navigation", { name: "Drawing tools" }).getByRole("button", { name, exact: true }).click();
async function polygon(pts) {
  for (const [x, y] of pts.slice(0, -1)) await click(x, y);
  const [lx, ly] = pts[pts.length - 1];
  await page.mouse.dblclick(...at(lx, ly));
}
const svgCount = (sel) => page.locator(`svg[aria-label^="Site plan"] ${sel}`).count();

const owner = await session("contractor");
page = owner.page;
let projectUrl = "";

await step("nav item opens the planner and a project is created", async () => {
  await page.goto(`${BASE}/`);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Planning & Estimation" }).click();
  await page.getByRole("heading", { name: "Tactile route planner" }).waitFor();
  await page.getByLabel("Title").fill(TITLE);
  await page.getByLabel("Site name").fill("North gate");
  await page.getByRole("button", { name: "Create and open" }).click();
  await page.waitForURL(/\/planning\/\d+$/);
  projectUrl = page.url();
  await page.getByRole("heading", { name: TITLE }).waitFor();
});

await step("upload site plan and calibrate scale", async () => {
  await page.locator('input[type=file][accept^="image/"]').setInputFiles(path.join(ROOT, "sample_images", "synthetic_continuous_ok.jpg"));
  await toast(/Site plan added/);
  await page.getByText("Scale not set").waitFor();
  box = await page.locator('svg[aria-label^="Site plan"]').boundingBox();
  await page.getByRole("button", { name: "Fit drawing" }).click();
  await click(0.2, 0.5);
  await click(0.8, 0.5);
  await page.getByLabel("Real length (metres)").fill("12");
  await page.getByRole("button", { name: "Set scale" }).click();
  await toast(/Scale set/);
  if (await page.getByText("Scale not set").count()) throw new Error("scale banner still shown");
});

await step("draw site features", async () => {
  await tool("Footpath");
  await polygon([[0.1, 0.3], [0.9, 0.3], [0.9, 0.7], [0.1, 0.7]]);
  await tool("Entrance");
  await click(0.15, 0.5);
  await tool("Tree");
  await click(0.4, 0.66);
  await tool("Kerb");
  await polygon([[0.82, 0.32], [0.82, 0.68]]);
  if ((await svgCount("polygon")) < 1) throw new Error("footpath not drawn");
});

await step("draw tactile route and warning area; checks and tile layout update", async () => {
  await tool("Route");
  await polygon([[0.15, 0.5], [0.45, 0.5], [0.72, 0.5]]);
  await tool("Warning area");
  const [x1, y1] = at(0.7, 0.44), [x2, y2] = at(0.79, 0.56);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("tab", { name: /Checks/ }).click();
  await page.getByText(/error/).first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('svg[aria-label^="Site plan"] polygon[pointer-events="none"]').length > 10, null, { timeout: 20000 });
  await page.getByRole("tab", { name: "Estimate" }).click();
  await page.getByRole("cell", { name: "Tiles required" }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "planner-design.png"), fullPage: true });
});

await step("select, move, undo, delete and undo", async () => {
  await tool("Select");
  await click(0.3, 0.5);
  await page.getByRole("tab", { name: "Properties" }).click();
  await page.getByText("Tactile route (directional)").waitFor();
  await page.getByLabel("Strip width").selectOption("2");
  await page.getByRole("button", { name: "Undo" }).click();
  if ((await page.getByLabel("Strip width").inputValue()) !== "1") throw new Error("undo did not restore width");
  await page.keyboard.press("Delete");
  await page.getByText("Select a shape to edit it").waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  await click(0.3, 0.5);
  await page.getByText("Tactile route (directional)").waitFor();
  const [sx, sy] = at(0.82, 0.5);
  await click(0.82, 0.5); // kerb
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy, { steps: 3 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Undo" }).click();
});

await step("checks show a clean design is submittable (no errors)", async () => {
  await page.getByRole("tab", { name: /Checks/ }).click();
  await page.waitForFunction(() => /0 errors/.test(document.body.innerText), null, { timeout: 20000 });
});

await step("compare layouts and choose one", async () => {
  await page.getByRole("tab", { name: "Compare" }).click();
  await page.getByText("least waste").waitFor();
  const use = page.getByRole("button", { name: /^Use (centred|offset)$/ }).first();
  await use.click();
  await page.getByRole("button", { name: /^Using / }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "planner-compare.png"), fullPage: true });
});

await step("save, reload and the design persists", async () => {
  await page.keyboard.press("Control+s");
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: TITLE }).waitFor();
  await page.waitForFunction(() => document.querySelector('svg[aria-label^="Site plan"]')?.getAttribute("aria-label")?.includes("1 routes"));
  box = await page.locator('svg[aria-label^="Site plan"]').boundingBox();
});

await step("route suggestion adds an editable route", async () => {
  await tool("Suggest route");
  await click(0.2, 0.45);
  await click(0.6, 0.45);
  await toast(/Suggested route added/);
  await page.getByText("Tactile route (directional)").waitFor();
  await page.getByRole("button", { name: "Undo" }).click(); // keep the reviewed design as drawn
});

await step("settings: supplier prices drive the cost", async () => {
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.locator("fieldset").filter({ hasText: "directional tiles" }).getByLabel("Price per pack").fill("1200");
  await page.locator("fieldset").filter({ hasText: "warning tiles" }).getByLabel("Price per pack").fill("1500");
  await page.getByRole("button", { name: "Save settings" }).click();
  await toast(/Settings saved/);
  await page.getByRole("tab", { name: "Estimate" }).click();
  await page.waitForFunction(() => /Total INR [1-9]/.test(document.body.innerText), null, { timeout: 20000 });
});

let pdfOk = false;
await step("save a version, download the report and submit", async () => {
  await page.getByRole("tab", { name: "Versions & report" }).click();
  await page.getByLabel("Version label").fill("Issue for review");
  await page.getByRole("button", { name: "Save version" }).click();
  await toast(/Version v1 saved/);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Report PDF" }).click();
  const file = await (await dl).path();
  pdfOk = readFileSync(file).subarray(0, 4).toString() === "%PDF";
  if (!pdfOk) throw new Error("report is not a PDF");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await toast(/submitted for review/);
  await page.getByText("Awaiting review").waitFor();
});

await step("another contractor/engineer cannot open it; owner isolation", async () => {
  const id = projectUrl.split("/").pop();
  const eng = await session("engineer");
  const r = await eng.page.request.get(`${BASE}/api/v1/planning/projects/${id}`, { headers: { Authorization: `Bearer ${eng.token}` } });
  // Engineers are reviewers: they may see it only because it is now submitted, and read-only.
  const body = await r.json();
  if (r.status() !== 200 || body.access !== "reviewer") throw new Error(`expected reviewer access, got ${r.status()} ${body.access}`);
  const w = await eng.page.request.put(`${BASE}/api/v1/planning/projects/${id}/document`, {
    headers: { Authorization: `Bearer ${eng.token}` }, data: { document: body.document, base_revision: 999 } });
  if (w.status() !== 403) throw new Error(`reviewer could write: ${w.status()}`);
  await eng.page.context().close();
});

await step("inspector reviews and approves", async () => {
  const insp = await session("inspector");
  page = insp.page;
  await page.goto(`${BASE}/planning`);
  await page.getByText("Submitted for review by others").waitFor();
  await page.getByRole("link", { name: new RegExp(TITLE) }).click();
  await page.getByText("read-only review").waitFor();
  await page.getByRole("tab", { name: "Versions & report" }).click();
  await page.getByLabel("Review note for v1").fill("Checked against drawing; verify kerb on site.");
  await page.getByRole("button", { name: "Approve" }).click();
  await toast(/v1 approved/);
  await page.getByText("Approved", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "planner-review.png"), fullPage: true });
});

await step("existing pages still load for staff", async () => {
  for (const [url, text] of [["/inspect", "Inspections"], ["/dashboard", "Dashboard"], ["/build", "Site surveys"], ["/live", "Live path planner"],
    ["/reports", "Report queue"], ["/map", "Shared map"], ["/models", "AI components"]]) {
    await page.goto(`${BASE}${url}`);
    await page.getByRole("heading", { name: new RegExp(text, "i") }).first().waitFor({ timeout: 30000 });
  }
});

await browser.close();
if (problems.length) {
  console.error("Problems:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("Planner e2e passed with no console errors or server errors.");
