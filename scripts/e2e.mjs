// Browser walk-through of the production build: signs up a throwaway account,
// adds subjects, uploads a PDF, plans an exam, and screenshots every main page
// at desktop and iPhone sizes. It also fails on horizontal overflow and page errors.
//
//   npm run build && npm run test:e2e
//
// Uses the database in .env (DATABASE_URL). The test account it creates is
// clearly named and can be deleted from Settings.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Playwright is not a project dependency (it is large); install it with
// `npm i -D playwright && npx playwright install chromium` to run this locally.
const { chromium } = createRequire(import.meta.url)("playwright");

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve("screenshots");
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, APP_URL: BASE } });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not start:\n" + serverLog);
}

const results = [];
const problems = [];
function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function checkOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (o.sw > o.cw + 1) problems.push(`${label}: horizontal overflow (${o.sw}px > ${o.cw}px)`);
}

let browser;
let page;
try {
  await waitForServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));

  await page.goto(BASE);
  await page.screenshot({ path: `${OUT}/01-landing-desktop.png` });
  step("Landing page loads", (await page.title()).includes("Yaxha"));

  // Protected pages redirect to login when signed out
  await page.goto(`${BASE}/home`);
  step("Signed-out visitors are sent to login", page.url().includes("/login"));

  const email = `e2e-${Date.now()}@example.test`;
  await page.goto(`${BASE}/signup`);
  await page.fill("#fullName", "Rain Yaxha (test account)");
  await page.fill("#email", email);
  await page.fill("#password", "correct-horse-battery");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/welcome/);
  step("Sign up leads to onboarding", true);
  await page.screenshot({ path: `${OUT}/02-welcome-desktop.png`, fullPage: true });

  for (const name of ["MATH 404 Differential Equations", "ENGG 404 Engineering Economics"]) {
    await page.fill("#w-subject", name);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByText(name).first().waitFor();
  }
  step("Subjects added during onboarding", true);
  await page.getByRole("button", { name: "Save and go to Home" }).click();
  await page.waitForURL(/\/home/);
  step("Onboarding saves preferences and opens Home", true);

  await page.goto(`${BASE}/subjects`);
  await page.click("text=ENGG 404 Engineering Economics");
  await page.waitForURL(/\/subjects\/[0-9a-f-]+/);
  const subjectUrl = page.url();
  await page.goto(`${subjectUrl}?tab=materials`);
  await page.waitForLoadState("networkidle"); // let the page hydrate before choosing a file
  await page.setInputFiles("input[type=file]", path.resolve("tests/fixtures/engg-econ-lesson.pdf"));
  await page.getByText("Uploaded and text extracted.").waitFor({ timeout: 30000 });
  step("PDF upload extracts text", true);

  await page.reload();
  await page.click("text=engg-econ-lesson");
  await page.waitForURL(/\/materials\//);
  await page.locator("canvas").first().waitFor({ timeout: 20000 });
  step("PDF opens in the in-app viewer", true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/05-pdf-viewer-desktop.png` });

  await page.goto(`${BASE}/exams`);
  await page.selectOption("#ex-subject", { label: "ENGG 404 Engineering Economics" });
  await page.fill("#ex-title", "Midterm exam");
  const d = new Date(Date.now() + 10 * 86400000);
  const local = `${d.toISOString().slice(0, 10)}T09:00`;
  await page.fill("#ex-at", local);
  await page.fill("#ex-new", "Simple interest, Compound interest, Effective rate");
  await page.getByRole("button", { name: "Create exam and plan" }).click();
  await page.waitForURL(/\/exams\/[0-9a-f-]+/);
  step("Exam created with a study plan", (await page.locator("text=/session|Session/").count()) > 0);
  await page.screenshot({ path: `${OUT}/06-exam-plan-desktop.png`, fullPage: true });

  const pages = [
    ["03-home", "/home"],
    ["04-subject", subjectUrl],
    ["07-study-room", "/study"],
    ["08-classroom", "/classroom"],
    ["09-progress", "/progress"],
    ["10-settings", "/settings"],
    ["11-subjects", "/subjects"],
  ];
  for (const [name, url] of pages) {
    await page.goto(url.startsWith("http") ? url : BASE + url);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${name}-desktop.png`, fullPage: true });
    await checkOverflow(page, `${name} desktop`);
  }
  // Classroom must never claim to be connected without a real authorization
  await page.goto(`${BASE}/classroom`);
  const classroomText = await page.textContent("main");
  step("Classroom page does not claim a connection", !/\bSynchronized\b|Connected as/.test(classroomText ?? ""), (classroomText ?? "").includes("not configured") ? "shows 'not configured' state" : "");

  // Phone (iPhone 14 size)
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const p2 = await phone.newPage();
  p2.on("pageerror", (e) => problems.push(`phone page error: ${e.message}`));
  for (const [name, url] of [["01-landing", "/"], ...pages, ["06-exams", "/exams"]]) {
    await p2.goto(url.startsWith("http") ? url : BASE + url);
    await p2.waitForLoadState("networkidle");
    await p2.screenshot({ path: `${OUT}/${name}-iphone.png`, fullPage: true });
    await checkOverflow(p2, `${name} iPhone`);
  }
  // Tablet
  const tab = await browser.newContext({ viewport: { width: 820, height: 1180 }, storageState: await ctx.storageState() });
  const p3 = await tab.newPage();
  for (const [name, url] of [["03-home", "/home"], ["04-subject", subjectUrl]]) {
    await p3.goto(url.startsWith("http") ? url : BASE + url);
    await p3.waitForLoadState("networkidle");
    await p3.screenshot({ path: `${OUT}/${name}-tablet.png`, fullPage: true });
    await checkOverflow(p3, `${name} tablet`);
  }
  step("No horizontal overflow on desktop, tablet, or iPhone", !problems.some((p) => p.includes("overflow")));
  step("No page errors", !problems.some((p) => p.includes("error")));
} catch (e) {
  step("Walk-through", false, e.message.split("\n")[0]);
  console.log(serverLog.slice(-3000));
  await page?.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser?.close();
  server.kill();
}
if (problems.length) console.log("\nProblems:\n" + problems.map((p) => "  - " + p).join("\n"));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
