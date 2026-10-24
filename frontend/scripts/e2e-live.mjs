// Browser check of the live path planner using Chrome's fake camera.
//   E2E_FEED=path/to/feed.mjpeg E2E_PHOTO=path/to/photo.jpg node scripts/e2e-live.mjs
// The feed is a Motion-JPEG file (concatenated JPEG frames) that Chrome plays as the webcam.
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const FEED = process.env.E2E_FEED;
const PHOTO = process.env.E2E_PHOTO;
const SHOTS = process.env.E2E_SHOTS || "e2e-screenshots";
if (!FEED) throw new Error("Set E2E_FEED to a .mjpeg file");

const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL || "chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${FEED}`],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["camera", "geolocation"] });
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url()}`));

const step = async (name, fn) => {
  process.stdout.write(`- ${name} ... `);
  try {
    await fn();
  } catch (e) {
    await page.screenshot({ path: `${SHOTS}/live-failure.png`, fullPage: true });
    console.error(problems.join("\n"));
    throw e;
  }
  console.log("ok");
};

await step("sign in as engineer", async () => {
  await page.goto(`${BASE}/login`);
  const r = await page.request.post(`${BASE}/api/v1/auth/login`, { data: { email: "engineer@tenjicheck.local", password: "tenjicheck-demo" } });
  const { access_token } = await r.json();
  await page.evaluate((t) => localStorage.setItem("tc_token", t), access_token);
});

await step("open live planner and load models", async () => {
  await page.goto(`${BASE}/live`);
  await page.getByRole("heading", { name: "Live path planner" }).waitFor();
  await page.getByRole("button", { name: /Start camera/ }).waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Loading models"), null, { timeout: 180_000 });
});

await step("camera loop produces proposals", async () => {
  await page.getByRole("button", { name: /Start camera/ }).click();
  await page.getByText(/Live · \d+\.\d fps/).waitFor({ timeout: 30_000 });
  await page.getByText("Strip length").waitFor({ timeout: 60_000 });
  const n1 = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/live/frame")).length);
  await page.waitForTimeout(6000);
  const n2 = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/live/frame")).length);
  if (n2 - n1 < 2) throw new Error(`expected continuous frames, got ${n2 - n1} in 6 s`);
  console.log(`(${n2 - n1} frames in 6 s)`);
  await page.getByText("LIVE", { exact: true }).waitFor(); // live inset while the analysed frame is shown
  await page.screenshot({ path: `${SHOTS}/live-camera.png`, fullPage: true });
});

await step("pause stops the loop", async () => {
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(2500);
  const n1 = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/live/frame")).length);
  await page.waitForTimeout(3000);
  const n2 = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/live/frame")).length);
  if (n2 !== n1) throw new Error("frames still sent while paused");
});

await step("settings: fast model and manual tilt", async () => {
  await page.getByLabel("Surface model").selectOption("fast");
  await page.getByLabel("Camera tilt").selectOption("manual");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByText(/Tilt \d+(\.\d)?° \(set\)/).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Pause" }).click();
});

if (PHOTO) {
  await step("single photo analysis", async () => {
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(PHOTO);
    await page.getByText("Single photo").waitFor();
    await page.getByText("Strip length").waitFor({ timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/live-photo.png`, fullPage: true });
  });
}

await step("second opinion is disabled without a server token", async () => {
  const disabled = await page.getByRole("button", { name: /AI second opinion/ }).isDisabled();
  if (!disabled) throw new Error("expected the GitHub Models button to be disabled");
});

await browser.close();
if (problems.length) {
  console.error("Problems:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("Live planner e2e passed with no console errors or server errors.");
