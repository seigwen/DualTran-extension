/**
 * xcom-showmore-check.mjs — deep check for issue #98 on a real x.com
 * feed: does the text revealed by a truncated post's "Show more" button
 * receive a translation?
 *
 * This scenario is deliberately NOT in the canary scenario library
 * (plan 34 §三.D): the carrier content is unstable — a fresh anonymous
 * feed only sometimes contains a truncated long post (measured hit rate
 * ≈ 2/5) and x.com re-renders articles, so a library entry would be
 * noise. Run it on demand (locally) when touching the dynamic-content
 * translation path; the canary keeps the stable `xcom-health` scenario.
 *
 * Typed outcomes (aligned with the canary vocabulary):
 *   0  PASS      — a truncated post was found, expanded, and the newly
 *                  revealed text contains translated (CJK) output.
 *   1  FAIL      — the revealed text stayed English (the #98 symptom).
 *   2  SKIP-ENV  — Google gtx endpoint throttled (429); not attributable.
 *   0  SKIP-DATA — no truncated long post on this load (content
 *                  precondition absent — NOT a symptom).
 *
 * Mechanism provenance: promoted from the archived calibration probes
 * (.tmp-xcom-canary-dryrun.mjs / .tmp-xcom-oracle*.mjs,
 * probe-archive-2026-09-29) — click-time re-location of the button (the
 * feed re-renders around the click), CJK-delta on the same article as
 * the reality metric.
 *
 * Run: npm run build && xvfb-run -a node scripts/xcom-showmore-check.mjs
 *
 * source: issue #98 (Show-more text not translated) / plan 34 §三.D.
 */

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXTENSION_PATH = path.join(ROOT, "dist", "chrome");
const TARGET = "https://x.com/elonmusk";

const GTX_PROBE_URL =
  "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=preflight";

function log(msg) {
  console.log(`[xcom-showmore] ${msg}`);
}

async function main() {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
    ],
  });
  // Open closed shadow roots so page.evaluate can reach the floating group.
  await context.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return orig.call(this, { ...init, mode: "open" });
    };
  });

  try {
    await run(context);
  } finally {
    await context.close().catch(() => {});
  }
}

async function run(context) {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 30_000 }).catch(() => null);
  if (!sw) {
    log("no extension service worker — is dist/chrome built and loadable?");
    process.exit(1);
  }

  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      targetLanguage: "zh-CN",
      targetLanguageTextTranslation: "zh-CN",
      targetLanguages: ["zh-CN", "en", "es"],
    });
  });

  // gtx preflight (same-stack fetch): a throttled endpoint makes the whole
  // observation unattributable — skip before burning a browser session.
  const preflight = await sw.evaluate(async (url) => {
    try {
      return (await fetch(url)).status;
    } catch (e) {
      return `error:${String(e).slice(0, 60)}`;
    }
  }, GTX_PROBE_URL);
  if (preflight !== 200) {
    log(`[SKIP-ENV] Google gtx not usable (status ${preflight}) — deep check skipped`);
    process.exit(2);
  }

  const page = context.pages()[0] || (await context.newPage());
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));

  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(6_000);
  // Poke the lazy feed so the first articles render fully.
  await page.evaluate(() => window.scrollBy(0, 900));
  await page.waitForTimeout(2_000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2_000);

  // Content precondition: an article carrying a "Show more" control.
  const precondition = await page.evaluate(() => {
    const arts = [...document.querySelectorAll("article")];
    return {
      articles: arts.length,
      showMore: arts.filter((a) =>
        [...a.querySelectorAll('button, [role="button"], span[role="button"]')].some((el) => {
          const t = (el.textContent || "").trim().toLowerCase();
          return (t.includes("show more") || t.includes("显示更多")) && !t.includes("choices");
        })
      ).length,
    };
  });
  log(`feed: ${precondition.articles} articles, ${precondition.showMore} with Show more`);
  if (!precondition.showMore) {
    log("[SKIP-DATA] no truncated long post on this load — content precondition absent (not a symptom)");
    process.exit(0);
  }

  // Translate.
  const clicked = await page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    const btn = host?.shadowRoot?.getElementById("btnGoogle");
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) {
    log("floating button group not found — cannot translate (is the extension loaded?)");
    process.exit(1);
  }
  log("Google translate clicked; settling...");
  await page.waitForTimeout(15_000);

  // Baseline the candidate article (largest one WITH a Show more control).
  const baseline = await page.evaluate(() => {
    const cjkCount = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;
    const isShowMore = (el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (t.includes("show more") || t.includes("显示更多")) && !t.includes("choices");
    };
    let best = null;
    for (const a of document.querySelectorAll("article")) {
      const btn = [...a.querySelectorAll('button, [role="button"], span[role="button"]')].find(isShowMore);
      if (!btn) continue;
      const t = a.innerText || "";
      if (!best || t.length > best.len) best = { len: t.length, cjk: cjkCount(t) };
    }
    return best;
  });
  if (!baseline) {
    log("[SKIP-DATA] the Show-more candidate vanished on re-render (content precondition absent)");
    process.exit(0);
  }
  log(`baseline article: len=${baseline.len} cjk=${baseline.cjk}`);

  // Click at click-time (re-location): the feed re-renders between
  // observations — locating the button in an earlier evaluate and clicking
  // later loses the reference (archived calibration finding).
  const clickState = await page.evaluate(() => {
    const isShowMore = (el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (t.includes("show more") || t.includes("显示更多")) && !t.includes("choices");
    };
    let best = null;
    for (const a of document.querySelectorAll("article")) {
      const btn = [...a.querySelectorAll('button, [role="button"], span[role="button"]')].find(isShowMore);
      if (!btn) continue;
      const t = a.innerText || "";
      if (!best || t.length > best.len) best = { btn, len: t.length };
    }
    if (!best) return { ok: false };
    best.btn.click();
    return { ok: true };
  });
  if (!clickState.ok) {
    log("[SKIP-DATA] Show-more button could not be re-located at click time (feed re-rendered)");
    process.exit(0);
  }
  log("Show more clicked; soaking 60s for the reveal + translation...");

  // Soak: track the longest article's growth + CJK delta.
  let final = null;
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(10_000);
    final = await page.evaluate(() => {
      const cjkCount = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;
      let best = null;
      for (const a of document.querySelectorAll("article")) {
        const t = a.innerText || "";
        if (!best || t.length > best.len) best = { len: t.length, cjk: cjkCount(t) };
      }
      return best;
    });
    log(`@${i * 10}s: len=${final?.len} cjk=${final?.cjk}`);
  }

  const growth = final.len - baseline.len;
  const cjkDelta = final.cjk - baseline.cjk;
  log(`growth: len Δ${growth}, cjk Δ${cjkDelta}`);

  if (growth < 50) {
    log("[SKIP-DATA] no substantial reveal happened (expansion did not materialize) — not attributable to #98");
    process.exit(0);
  }

  if (cjkDelta >= 1) {
    log(`✅ PASS — revealed text received translated output (cjk Δ${cjkDelta} on a ${growth}-char reveal)`);
    process.exit(0);
  }

  // Revealed text but zero CJK growth: #98 territory — attribute first.
  const post = await sw.evaluate(async (url) => {
    try {
      return (await fetch(url)).status;
    } catch (e) {
      return `error:${String(e).slice(0, 60)}`;
    }
  }, GTX_PROBE_URL);
  if (post !== 200) {
    log(`[SKIP-ENV] Google gtx turned unusable mid-check (status ${post}) — reveal translation not attributable`);
    process.exit(2);
  }
  log(`❌ FAIL — ${growth}-char reveal arrived with no translated output (cjk Δ0) while gtx is healthy — issue #98 symptom`);
  if (pageErrors.length) log(`page errors (last 3): ${pageErrors.slice(-3).join(" | ")}`);
  process.exit(1);
}

main();
