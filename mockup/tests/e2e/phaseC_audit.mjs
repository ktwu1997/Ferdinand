// Phase C audit — screenshot every page (desktop 1440x900 + mobile 390x844),
// collect console/page errors. Run AFTER local anki_server (:40001 seeded ktwu/devpw)
// + vite dev (:5174 proxying /api) are up.
//   node tests/e2e/phaseC_audit.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:5174";
const USER = process.env.U || "ktwu";
const PASS = process.env.P || "devpw";
const OUT = process.env.OUT || "../tmp/phaseC-shots";
mkdirSync(OUT, { recursive: true });

const DESK = { width: 1440, height: 900 };
const MOB = { width: 390, height: 844 };

// pages: [slug, path, needsAuth]
const PAGES = [
  ["01-login", "/login", false],
  ["02-dashboard", "/", true],
  ["03-study", "__study__", true], // resolved to /study/<deckId-with-due>
  ["04-browse", "/browse", true],
  ["05-notes", "/notes/new", true],
  ["06-stats", "/stats", true],
  ["07-settings", "/settings", true],
];

const benign = (m) =>
  /\/api\/auth\/me\b.*401/.test(m) ||
  /Failed to load resource.*401.*\/api\/auth\/me/.test(m) ||
  /the server responded with a status of 401.*auth\/me/.test(m);

function attachErrs(page, bag) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (!benign(t)) bag.push(`console.error: ${t}`);
    }
  });
  page.on("pageerror", (e) => bag.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (u.includes("/api/auth/me")) return;
    bag.push(`requestfailed: ${r.method()} ${u} — ${r.failure()?.errorText}`);
  });
}

async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"], input[type="text"]', USER).catch(() => {});
  // robust: find first text/email-ish input, then password
  const inputs = await page.$$("input");
  if (inputs.length >= 2) {
    await inputs[0].fill(USER);
    await inputs[1].fill(PASS);
  }
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"], button:has-text("sign in"), button:has-text("Sign in")').catch(() => {}),
  ]);
  await page.waitForTimeout(800);
  await page.close();
}

async function findStudyDeck(ctx) {
  // hit /api/decks via the page context (carries cookies)
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const decks = await page.evaluate(async () => {
    const r = await fetch("/api/decks");
    return r.ok ? (await r.json()).decks : [];
  });
  await page.close();
  const flat = [];
  const walk = (ns) => ns.forEach((n) => { flat.push(n); if (n.children) walk(n.children); });
  walk(decks || []);
  const due = flat.find((d) => (d.new_count || 0) + (d.learn_count || 0) + (d.review_count || 0) > 0 && !d.children?.length)
    || flat.find((d) => (d.new_count || 0) + (d.learn_count || 0) + (d.review_count || 0) > 0)
    || flat[0];
  return due ? `/study/${due.id}` : "/study/1";
}

async function shoot(ctx, slug, path, vp, suffix) {
  const page = await ctx.newPage();
  await page.setViewportSize(vp);
  const errs = [];
  attachErrs(page, errs);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch((e) => errs.push(`goto: ${e.message}`));
  await page.waitForTimeout(1200);
  // for study, try to reveal the answer so the back renders too — separate shot
  await page.screenshot({ path: `${OUT}/${slug}-${suffix}.png`, fullPage: false });
  // full-page too (catches overflow)
  await page.screenshot({ path: `${OUT}/${slug}-${suffix}-full.png`, fullPage: true });
  await page.close();
  return errs;
}

const report = {};

const browser = await chromium.launch();
try {
  // logged-out shots first (login)
  {
    const ctx = await browser.newContext();
    report["01-login/desktop"] = await shoot(ctx, "01-login", "/login", DESK, "desktop");
    report["01-login/mobile"] = await shoot(ctx, "01-login", "/login", MOB, "mobile");
    await ctx.close();
  }
  // authed
  const ctx = await browser.newContext();
  await login(ctx);
  const studyPath = await findStudyDeck(ctx);
  console.log("study deck path:", studyPath);
  for (const [slug, path, needsAuth] of PAGES) {
    if (slug === "01-login") continue;
    const real = path === "__study__" ? studyPath : path;
    report[`${slug}/desktop`] = await shoot(ctx, slug, real, DESK, "desktop");
    report[`${slug}/mobile`] = await shoot(ctx, slug, real, MOB, "mobile");
  }
  // study with answer revealed (desktop)
  {
    const page = await ctx.newPage();
    await page.setViewportSize(DESK);
    const errs = [];
    attachErrs(page, errs);
    await page.goto(`${BASE}${studyPath}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.click('[data-testid="reveal-btn"], button:has-text("show answer"), button:has-text("SHOW ANSWER")').catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/03-study-desktop-revealed.png` });
    report["03-study/desktop-revealed"] = errs;
    await page.close();
  }
  await ctx.close();
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/_errors.json`, JSON.stringify(report, null, 2));
const bad = Object.entries(report).filter(([, v]) => v.length);
if (bad.length) {
  console.log("\n=== PAGES WITH ERRORS ===");
  for (const [k, v] of bad) console.log(k, "\n  " + v.join("\n  "));
} else {
  console.log("\nAll pages: 0 unexpected errors.");
}
console.log(`\nShots in ${OUT}`);
