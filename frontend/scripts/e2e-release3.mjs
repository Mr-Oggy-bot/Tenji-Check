// Browser check of Release 3 (inspection schedule, site history & comparison), the restyled shell/home and the
// "Ask TenjiCheck" assistant gate. Servers must be running.
//   node scripts/e2e-release3.mjs [screenshot-dir]
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.argv[2] || path.join(ROOT, "e2e-screenshots");
mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "tenjicheck-demo";
const TITLE = `E2E quarterly ${Date.now().toString(36)}`;
const problems = [];
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || "chrome", headless: true });

async function session(role, viewport = { width: 1440, height: 950 }) {
  const c = await browser.newContext({ viewport });
  const page = await c.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`[${role}] console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && problems.push(`[${role}] HTTP ${r.status()} ${r.url()}`));
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
    await page?.screenshot({ path: path.join(SHOTS, "release3-failure.png"), fullPage: true });
    console.log("FAILED");
    console.error(problems.join("\n"));
    throw e;
  }
  console.log("ok");
};
const toast = (re) => page.getByRole("status").filter({ hasText: re }).first().waitFor({ timeout: 30000 });
const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const eng = await session("engineer");
page = eng.page;

await step("restyled home: welcome, workload pills, gauge, upcoming inspections", async () => {
  await page.goto(`${BASE}/`);
  await page.getByText("Welcome back").waitFor();
  await page.getByLabel("Current workload").getByText("Awaiting review").waitFor();
  await page.getByRole("heading", { name: "Findings resolved" }).waitFor();
  await page.getByRole("heading", { name: "Upcoming inspections" }).waitFor();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Inspection schedule" }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "release3-home.png"), fullPage: true });
});

let inspectionId = "";
await step("create an overdue quarterly schedule and start the inspection", async () => {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Inspection schedule" }).click();
  await page.getByRole("heading", { name: "Inspection schedule" }).waitFor();
  const site = page.getByLabel("Site");
  await site.selectOption({ index: 1 });
  await page.getByLabel("Title").fill(TITLE);
  await page.getByRole("button", { name: "Quarterly" }).click();
  const past = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("First due").fill(past);
  await page.getByRole("button", { name: "Create schedule" }).click();
  await toast(/Schedule created/);
  const card = page.getByRole("article", { name: TITLE });
  await card.getByText("Overdue", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "release3-schedule.png"), fullPage: true });
  await card.getByRole("button", { name: "Start inspection" }).click();
  await page.waitForURL(/\/inspect\/\d+$/);
  inspectionId = page.url().split("/").pop();
  await page.getByText(TITLE).first().waitFor();
});

await step("schedule moved to its next due date and records the run", async () => {
  await page.goto(`${BASE}/schedule`);
  const card = page.getByRole("article", { name: TITLE });
  await card.getByText(/Due in \d+ days/).waitFor();
  await card.getByText("1 inspection started from this schedule").click();
  await card.getByRole("link", { name: new RegExp(TITLE) }).waitFor();
  await card.getByText("Late", { exact: true }).waitFor();
  await card.getByRole("button", { name: "Pause" }).click();
  await toast(/Schedule paused/);
  await card.getByText("Paused", { exact: true }).first().waitFor();
  if (await card.getByRole("button", { name: "Start inspection" }).count()) throw new Error("paused schedule can still start");
  await card.getByRole("button", { name: "Resume" }).click();
  await toast(/Schedule resumed/);
});

await step("site history: chart, table and comparison of two inspections", async () => {
  await page.getByRole("article", { name: TITLE }).getByRole("link", { name: "Site history" }).click();
  await page.getByRole("heading", { name: "Site history" }).waitFor();
  await page.getByRole("heading", { name: "Findings per inspection" }).waitFor();
  await page.locator(".recharts-surface").first().waitFor();
  await page.getByRole("button", { name: "table" }).click();
  await page.getByRole("link", { name: new RegExp(TITLE) }).waitFor();
  await page.getByRole("heading", { name: "Compare two inspections" }).waitFor();
  await page.getByLabel("Comparison totals").getByText("Recurring").waitFor();
  await page.getByText(/not evidence of a repair/).waitFor();
  if (!(await noHorizontalScroll())) throw new Error("history page scrolls horizontally");
  await page.screenshot({ path: path.join(SHOTS, "release3-history.png"), fullPage: true });
});

await step("assistant: header button, runtime protected, honest when not configured", async () => {
  const anon = await page.request.post(`${BASE}/api/copilotkit`, { data: {} });
  if (anon.status() !== 401) throw new Error(`unauthenticated runtime call returned ${anon.status()}`);
  const st = await page.request.get(`${BASE}/api/assistant-status`, { headers: { Authorization: `Bearer ${eng.token}` } });
  const status = await st.json();
  if (st.status() !== 200 || typeof status.configured !== "boolean") throw new Error("status endpoint");
  if (JSON.stringify(status).includes("ghp_") || JSON.stringify(status).includes("github_pat_")) throw new Error("token leaked");
  await page.getByRole("button", { name: "Ask TenjiCheck" }).click();
  if (status.configured && status.reachable) {
    await page.getByText("Ask about inspections").waitFor({ timeout: 30000 });
  } else if (status.configured) {
    await page.getByRole("dialog", { name: "Ask TenjiCheck" }).getByText(status.reason).waitFor();
  } else {
    const r = await page.request.post(`${BASE}/api/copilotkit`, { headers: { Authorization: `Bearer ${eng.token}` }, data: {} });
    if (r.status() !== 503) throw new Error(`unconfigured runtime returned ${r.status()}`);
    await page.getByRole("dialog", { name: "Ask TenjiCheck" }).getByText(/assistant is off/).waitFor();
  }
  await page.screenshot({ path: path.join(SHOTS, "release3-assistant.png") });
  console.log(`(assistant configured: ${status.configured}, reachable: ${status.reachable})`);
});

await step("citizens get no assistant; contractors no schedule but history", async () => {
  const cit = await session("citizen");
  await cit.page.goto(`${BASE}/`);
  await cit.page.getByText("Welcome back").waitFor();
  if (await cit.page.getByRole("button", { name: "Ask TenjiCheck" }).count()) throw new Error("citizen sees assistant");
  const s = await cit.page.request.get(`${BASE}/api/assistant-status`, { headers: { Authorization: `Bearer ${cit.token}` } });
  if (s.status() !== 401) throw new Error(`citizen status ${s.status()}`);
  await cit.page.context().close();
  const con = await session("contractor");
  page = con.page;
  await page.goto(`${BASE}/`);
  await page.getByText("Welcome back").waitFor();
  const nav = page.getByRole("navigation", { name: "Main" });
  if (await nav.getByRole("link", { name: "Inspection schedule" }).count()) throw new Error("contractor sees schedule");
  await nav.getByRole("link", { name: "Site history" }).waitFor();
  const r = await page.request.get(`${BASE}/api/v1/schedules`, { headers: { Authorization: `Bearer ${con.token}` } });
  if (r.status() !== 403) throw new Error(`contractor schedules ${r.status()}`);
  await page.context().close();
});

await step("phone width: shell, home and schedule fit without horizontal scroll", async () => {
  const m = await session("engineer", { width: 390, height: 844 });
  page = m.page;
  for (const url of ["/", "/schedule", "/history"]) {
    await page.goto(`${BASE}${url}`);
    await page.getByRole("button", { name: "Open navigation" }).waitFor();
    await page.waitForLoadState("networkidle");
    if (!(await noHorizontalScroll())) throw new Error(`${url} scrolls horizontally at 390px`);
  }
  await page.goto(`${BASE}/`);
  await page.getByText("Welcome back").waitFor();
  await page.screenshot({ path: path.join(SHOTS, "release3-mobile-home.png"), fullPage: true });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Site history" }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "release3-mobile-nav.png") });
});

await step("existing pages still load", async () => {
  for (const [url, text] of [["/inspect", "Inspections"], ["/dashboard", "Dashboard"], ["/build", "Site surveys"], ["/live", "Live path planner"],
    ["/planning", "Tactile route planner"], ["/reports", "Report queue"], ["/map", "Shared map"], ["/models", "AI components"], [`/inspect/${inspectionId}`, TITLE]]) {
    await page.goto(`${BASE}${url}`);
    await page.getByRole("heading", { name: new RegExp(text, "i") }).first().waitFor({ timeout: 30000 });
  }
});

await browser.close();
if (problems.length) {
  console.error("Problems:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("Release 3 e2e passed with no console errors or server errors.");
