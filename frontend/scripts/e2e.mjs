// Browser end-to-end test of every role's workflow against running servers.
// Prerequisites: backend on :8000, `npm run build && npm start` on :3000, sample images generated,
// and `npm install --no-save playwright-core` (uses the locally installed Chrome; no browser download).
// Usage: node scripts/e2e.mjs [screenshotDir]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMG = (n) => path.join(ROOT, "sample_images", n);
const SHOTS = process.argv[2] || path.join(ROOT, "e2e-screenshots");
mkdirSync(SHOTS, { recursive: true });

const problems = [];
const pages = [];
const log = (m) => console.log(`✔ ${m}`);
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || "chrome", headless: true });

async function ctx(role, viewport = { width: 1366, height: 900 }) {
  const c = await browser.newContext({ viewport, permissions: [], acceptDownloads: true });
  const page = await c.newPage();
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && problems.push(`[${role}] console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`[${role}] pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 500 && problems.push(`[${role}] HTTP ${r.status()} ${r.url()}`));
  page.on("dialog", (d) => d.accept());
  pages.push(page);
  if (role !== "anon") {
    await page.goto(`${BASE}/login`);
    const label = { inspector: "Inspector / reviewer", engineer: "Site engineer", contractor: "Contractor", citizen: "Citizen", admin: "Administrator" }[role];
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForURL(`${BASE}/`);
    await page.getByText("Welcome back").waitFor();
  }
  return page;
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const toast = (page, re, timeout = 30000) => page.getByRole("status").filter({ hasText: re }).first().waitFor({ timeout });

async function step(name, fn) {
  try {
    await fn();
    log(name);
  } catch (e) {
    problems.push(`STEP FAILED: ${name}: ${e.message.split("\n")[0]}`);
    await Promise.all(pages.map((pg, i) => shot(pg, `FAIL-${i}`).catch(() => {})));
    throw e;
  }
}

let inspectionUrl = "";
try {
  // --- Engineer: capture, quality gate, AI screening, manual marking -------------------------
  const eng = await ctx("engineer");
  await step("engineer opens demo inspection", async () => {
    await eng.goto(`${BASE}/inspect`);
    await eng.getByRole("link", { name: "Main gate to library walkway" }).click();
    await eng.getByRole("heading", { name: "Main gate to library walkway" }).waitFor();
    inspectionUrl = eng.url();
  });
  await step("upload photo → AI screening finds gap", async () => {
    await eng.locator('input[type=file][capture]').first().setInputFiles(IMG("synthetic_gap_2_tiles.jpg"));
    await eng.getByRole("button", { name: "Upload and screen" }).click();
    await toast(eng, /AI screening started/);
    await eng.getByText(/candidate\(s\)/).first().waitFor({ timeout: 120000 });
    await eng.getByText("Interrupted guide path").first().waitFor();
    await shot(eng, "01-inspection-after-screening");
  });
  await step("obstacle photo screened by YOLO-World", async () => {
    await eng.locator('input[type=file][capture]').first().setInputFiles(IMG("synthetic_obstacle_on_strip.jpg"));
    await eng.getByRole("button", { name: "Upload and screen" }).click();
    await toast(eng, /AI screening started/);
    await eng.waitForFunction(() => !document.body.innerText.includes("AI screening queued") && !document.body.innerText.includes("AI screening running"), null, { timeout: 120000 });
    const txt = await eng.locator("main").innerText();
    if (!/Obstacle detector:/.test(txt)) problems.push("Obstacle detector output not shown (model unavailable?)");
  });
  await step("blurry photo rejected, then kept for manual review", async () => {
    await eng.locator('input[type=file][capture]').first().setInputFiles(IMG("synthetic_blurry_retake.jpg"));
    await eng.getByRole("button", { name: "Upload and screen" }).click();
    await eng.getByText("Photo failed the quality check").waitFor();
    await shot(eng, "02-quality-gate");
    await eng.getByRole("button", { name: "Keep for manual review only" }).click();
    await toast(eng, /manual review only/);
    await eng.getByText("Low quality · manual only").first().waitFor();
  });
  await step("tap-to-mark manual finding", async () => {
    await eng.getByRole("button", { name: "Mark defect manually" }).first().click();
    const dlg = eng.getByRole("dialog", { name: "Mark a defect manually" });
    const box = await dlg.locator("img").first().boundingBox();
    await eng.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await eng.mouse.down();
    await eng.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 5 });
    await eng.mouse.up();
    await dlg.getByLabel("Description").fill("Bollard the model missed (test)");
    await dlg.getByRole("button", { name: "Save finding" }).click();
    await toast(eng, /Manual finding created/);
  });

  // --- Inspector: review gate, punch list ------------------------------------------------------
  const insp = await ctx("inspector");
  await step("punch list blocked while findings unreviewed", async () => {
    await insp.goto(inspectionUrl);
    await insp.getByRole("button", { name: "Generate punch list" }).click();
    await insp.getByRole("alert").filter({ hasText: /need an authorised reviewer decision/ }).waitFor();
  });
  await step("inspector confirms the gap and rejects the rest", async () => {
    await insp.goto(`${BASE}/review`);
    await insp.getByRole("link", { name: /Interrupted guide path/ }).first().click();
    await insp.getByRole("button", { name: "Confirm defect" }).click();
    await toast(insp, /Finding confirmed/);
    await shot(insp, "03-finding-confirmed");
    for (let i = 0; i < 20; i++) {
      await insp.goto(`${BASE}/review`);
      const card = insp.locator("main ul li a").first();
      await card.or(insp.getByText("Nothing waiting here")).first().waitFor();
      if (!(await card.count())) break;
      await card.click();
      await insp.getByRole("button", { name: "Reject", exact: true }).click();
      await insp.getByLabel(/Reason/).fill("Not a defect on inspection (e2e)");
      await insp.getByRole("dialog").getByRole("button", { name: "Reject finding" }).click();
      await toast(insp, /Finding rejected/);
    }
  });
  await step("generate punch list PDF", async () => {
    await insp.goto(inspectionUrl);
    const popup = insp.waitForEvent("popup", { timeout: 30000 }).catch(() => null);
    await insp.getByRole("button", { name: "Generate punch list" }).click();
    await toast(insp, /Punch list v\d+ generated with 1 item/);
    await popup;
    await insp.getByRole("button", { name: "Open PDF" }).first().waitFor();
  });

  // --- Contractor: repair evidence -------------------------------------------------------------
  const con = await ctx("contractor");
  await step("contractor submits repair photo", async () => {
    await con.goto(`${BASE}/tasks`);
    await con.getByRole("link", { name: /Interrupted guide path/ }).first().click();
    await con.getByRole("button", { name: "Submit repair photo" }).click();
    await con.getByRole("dialog").locator("input[type=file]").setInputFiles(IMG("synthetic_continuous_ok.jpg"));
    await con.getByRole("dialog").getByLabel("What was done").fill("Two tiles installed");
    await con.getByRole("button", { name: "Submit for reinspection" }).click();
    await toast(con, /Repair evidence submitted/);
  });

  // --- Inspector: reinspection, closure, handover ------------------------------------------------
  await step("inspector passes reinspection, closes, records handover", async () => {
    await insp.goto(`${BASE}/review`);
    await insp.getByRole("tab", { name: /Awaiting reinspection/ }).click();
    await insp.getByRole("link", { name: /Interrupted guide path/ }).first().click();
    await insp.getByText(/AI second look/).waitFor();
    await insp.getByRole("button", { name: "Pass reinspection" }).click();
    await toast(insp, /Reinspection passed/);
    await insp.getByRole("button", { name: "Close finding" }).click();
    await toast(insp, /Finding closed/);
    await shot(insp, "04-finding-closed-audit");
    await insp.goto(inspectionUrl);
    await insp.getByRole("button", { name: "Record handover" }).click();
    await insp.getByRole("dialog").getByRole("checkbox").check();
    await insp.getByRole("button", { name: "Record decision" }).click();
    await toast(insp, /Handover decision recorded/);
    await insp.getByText(/Handover recorded by/).waitFor();
    await shot(insp, "05-handover");
  });

  // --- Anonymous citizen: report + track ---------------------------------------------------------
  const anon = await ctx("anon", { width: 390, height: 844 });
  let reference = "";
  await step("anonymous citizen reports with map pin (mobile viewport)", async () => {
    await anon.goto(`${BASE}/report`);
    await anon.getByLabel("Issue type").selectOption("blocked_tactile_path");
    await anon.locator("input[type=file]").setInputFiles(IMG("synthetic_obstacle_on_strip.jpg"));
    await anon.getByLabel("Description (optional)").fill("Scooter parked on strip (e2e)");
    await anon.getByRole("button", { name: "Submit report" }).click();
    await anon.getByText(/Add a location|Confirm that the pin/).waitFor();
    const map = anon.locator(".leaflet-container");
    await map.scrollIntoViewIfNeeded();
    const b = await map.boundingBox();
    await anon.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await anon.getByText("The pin marks where the problem is").click();
    await shot(anon, "06-report-form-mobile");
    await anon.getByRole("button", { name: "Submit report" }).click();
    await anon.getByText("Report received").waitFor();
    reference = (await anon.locator(".font-mono").first().innerText()).trim();
    await anon.getByRole("link", { name: "Check status" }).click();
    await anon.getByText(reference).first().waitFor();
    await anon.getByText("Submitted").first().waitFor();
    await shot(anon, "07-track-status-mobile");
  });

  await step("inspector triages the new report", async () => {
    await insp.goto(`${BASE}/reports`);
    await insp.getByRole("link", { name: reference }).click();
    await insp.getByText(/Obstacle detector:|Obstacle model unavailable/).first().waitFor({ timeout: 60000 });
    await insp.getByRole("button", { name: "Confirm", exact: true }).click();
    await toast(insp, /Report confirmed/);
    await insp.getByLabel("Assigned to").selectOption({ label: "Kiran Contractor (contractor)" });
    await toast(insp, /Assignee updated/);
    await insp.getByRole("button", { name: "Update status" }).click();
    await insp.getByRole("dialog").getByLabel("New status").selectOption("assigned");
    await insp.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await toast(insp, /Status updated/);
    await shot(insp, "08-report-detail");
  });

  // --- Build: survey corridors + approval ----------------------------------------------------------
  await step("contractor generates corridors on demo survey", async () => {
    await con.goto(`${BASE}/build`);
    await con.getByRole("link", { name: /hostel to academic block/ }).click();
    await con.getByRole("button", { name: "Generate candidates" }).click();
    await toast(con, /candidate corridor\(s\) generated/, 60000);
    await con.getByText("Candidate corridors").waitFor();
    await shot(con, "09-survey-routes");
    await con.getByRole("button", { name: "Submit for approval" }).click();
    await toast(con, /Submitted for engineering approval/);
  });
  await step("engineer approves corridor and survey", async () => {
    await eng.goto(`${BASE}/build`);
    await eng.getByRole("link", { name: /hostel to academic block/ }).click();
    await eng.getByRole("button", { name: "Approve", exact: true }).first().click();
    await eng.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await toast(eng, /Corridor approved/);
    await eng.getByRole("button", { name: "Approve survey" }).click();
    await eng.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await toast(eng, /Survey approved/);
  });

  // --- Insights pages ------------------------------------------------------------------------------
  const adm = await ctx("admin");
  for (const [p, name, text] of [["/dashboard", "10-dashboard", "Human review enforcement"], ["/map", "11-map", "Shared map"], ["/models", "12-models", "Held-out evaluation"], ["/admin/users", "13-users", "Users & roles"], ["/reports", "14-report-queue", "Report queue"]]) {
    await step(`admin views ${p}`, async () => {
      await adm.goto(`${BASE}${p}`);
      await adm.getByText(text).first().waitFor();
      await adm.waitForTimeout(800);
      await shot(adm, name);
    });
  }
  await step("dashboard shows 100% review enforcement", async () => {
    await adm.goto(`${BASE}/dashboard`);
    await adm.getByText("100%").first().waitFor();
  });
  await step("citizen cannot open staff pages", async () => {
    const cit = await ctx("citizen");
    await cit.goto(`${BASE}/dashboard`);
    await cit.getByText("Not available for your role").waitFor();
  });
  const mob = await ctx("inspector", { width: 390, height: 844 });
  await step("mobile layout of inspection workspace", async () => {
    await mob.goto(inspectionUrl);
    await mob.getByText("Findings (").waitFor();
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) problems.push("Horizontal overflow on mobile inspection page");
    await shot(mob, "15-inspection-mobile");
  });
} catch {
  /* recorded in problems */
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${SHOTS}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.log(" ✗ " + p));
  process.exit(1);
}
console.log("\nAll e2e steps passed with no console errors or server errors.");
