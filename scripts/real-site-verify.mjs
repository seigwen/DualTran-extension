/**
 * real-site-verify.mjs — semi-automated real-site verification tool.
 *
 * M4 of the bug-7 retrospective (issue #34). The fix flow (test → fix →
 * E2E → PR) had no real-site verification step — the root cause of bug 7
 * (Turbo Drive replaces the <body> ELEMENT on back-nav) was only
 * discoverable in a real browser; the E2E mock pages masked it.
 *
 * This tool loads the built extension (dist/chrome/) in a real Chromium,
 * opens the user-reported URL, and executes the symptom path:
 *
 *   translate (Google) → navigate (SPA link) → back → assert:
 *     1. floating button group exists
 *     2. highlight is consistent with the page state
 *     3. page is still translated after back-nav (dynamic translation
 *        observer survived the body replacement)
 *
 * Assertions are deliberately LOOSE (button exists + highlight
 * consistency + translated content present) — real site structure
 * changes; never assert specific translation text.
 *
 * Usage:
 *   npm run build   # first — the tool loads dist/chrome/
 *   node scripts/real-site-verify.mjs [--url https://...] [--headful]
 *
 * NOT wired into CI (manual trigger). PR checklist mandates it for
 * SPA/navigation/DOM-lifecycle fixes.
 *
 * Self-test: run with --self-test to verify the tool works against the
 * local spa mock pages (no real site needed).
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXTENSION_PATH = path.join(ROOT, "dist", "chrome");
const E2E_DIR = path.join(ROOT, "extra", "e2e");

const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith("--url="));
const TARGET_URL = urlArg ? urlArg.slice("--url=".length) : "https://github.com/obra/superpowers/projects";
const SELF_TEST = args.includes("--self-test");
const HEADFUL = args.includes("--headful");

// Local static server for self-test (serves extra/e2e/ — the spa mock
// pages with the same Turbo body-replacement behavior as the E2E suite,
// verified against real github.com on 2026-09-10).
async function startSelfTestServer() {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split("?")[0];
    const file = path.join(E2E_DIR, urlPath === "/" ? "spa-source.html" : urlPath);
    if (fs.existsSync(file) && file.startsWith(E2E_DIR)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(file));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function log(msg) {
  console.log(`[real-site-verify] ${msg}`);
}

async function launch() {
  // Chrome extensions MUST run in non-headless mode (headless Chromium
  // does not start extension service workers). Use xvfb-run on CI-less
  // environments: xvfb-run -a node scripts/real-site-verify.mjs
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
    ],
  });
  // Force closed shadow roots open so page.evaluate can read the
  // floating button group's shadow DOM (same patch as the E2E suite).
  await context.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return orig.call(this, { ...init, mode: "open" });
    };
  });

  // Self-test mode: simulate real network latency on the mock page's
  // navigation fetches. Real Turbo Drive fetches are async (network), so
  // the popstate 200ms timer fires BEFORE the body is replaced — the
  // rebuilt host is attached to the old body and dies with it. A local
  // mock server responds instantly, which makes the 200ms timer appear
  // reliable — masking the exact bug this tool exists to catch.
  if (SELF_TEST) {
    await context.addInitScript(() => {
      const origFetch = window.fetch;
      window.fetch = async (...args) => {
        await new Promise((r) => setTimeout(r, 800));
        return origFetch(...args);
      };
    });
  }
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

async function findExtensionId(context, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 1_000 }).catch(() => null);
    }
    if (serviceWorker?.url()) {
      return new URL(serviceWorker.url()).host;
    }
  }
  throw new Error("Could not find extension service worker");
}

async function main() {
  let selfTestServer = null;
  const target = SELF_TEST ? (selfTestServer = await startSelfTestServer(), selfTestServer.baseUrl + "/spa-source.html") : TARGET_URL;
  log(`target: ${target}${SELF_TEST ? " (self-test mode)" : ""}`);

  const { context, page } = await launch();
  try {
    const extensionId = await findExtensionId(context);
    log(`extension id: ${extensionId}`);

    // 1. Open the target page
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000); // let content scripts initialize

    // 2. Click the Google button (translate the page)
    const googleClicked = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btn = host?.shadowRoot?.getElementById("btnGoogle");
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!googleClicked) {
      throw new Error("Floating button group not found on initial page load");
    }
    log("Google button clicked");

    // 3. Wait for translation to appear (loose: some <translated> or
    //    .dualtran-result-container exists)
    await page.waitForFunction(
      () =>
        document.querySelectorAll("translated").length > 0 ||
        document.querySelectorAll(".dualtran-result-container").length > 0,
      null,
      { timeout: 30_000 }
    );
    log("Page translated");

    // 4. Navigate via SPA link (if present) — else skip to back-nav
    const linkClicked = await page.evaluate(() => {
      const link = document.querySelector("a[href]");
      if (!link) return false;
      link.click();
      return true;
    });
    if (linkClicked) {
      log("SPA link clicked, waiting for navigation...");
      await page.waitForTimeout(4000);
    } else {
      log("No SPA link found — using history.pushState fallback");
      await page.evaluate(() => history.pushState({}, "", location.href + "#nav"));
      await page.waitForTimeout(1000);
    }

    // 5. Go back
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(4000); // Turbo fetch + body replacement + observer rebuild
    log("Back navigation done");

    // 6. Assert: floating button group exists
    const hostExists = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      return !!host && !!host.shadowRoot?.getElementById("btnGoogle");
    });
    if (!hostExists) {
      throw new Error("FAIL: floating button group missing after back-nav (observer died?)");
    }
    log("Floating button group present after back-nav");

    // 7. Assert: page still translated (dynamic translation observer survived)
    const translatedCount = await page.evaluate(
      () =>
        document.querySelectorAll("translated").length +
        document.querySelectorAll(".dualtran-result-container").length
    );
    if (translatedCount === 0) {
      throw new Error("FAIL: page not translated after back-nav (dynamic translation observer died?)");
    }
    log(`Page still translated after back-nav (${translatedCount} translated elements)`);

    // 8. Assert: highlight consistent with page state (loose: translated
    //    page must have Google or AI highlighted, not Original)
    const highlight = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const root = host?.shadowRoot || null;
      const read = (id) => !!root?.getElementById(id)?.classList.contains("dualtran-floating-btn-active");
      return { original: read("btnOriginal"), google: read("btnGoogle"), ai: read("btnAi") };
    });
    const actual = highlight.ai ? "ai" : highlight.google ? "google" : "original";
    if (actual === "original") {
      throw new Error("FAIL: highlight is Original but page is translated (state inconsistency)");
    }
    log(`Highlight consistent with page state (${actual})`);

    log("✅ REAL-SITE VERIFY PASSED");
    process.exit(0);
  } catch (e) {
    log(`❌ REAL-SITE VERIFY FAILED: ${e.message}`);
    process.exit(1);
  } finally {
    await context.close().catch(() => {});
    if (selfTestServer) selfTestServer.close();
  }
}

main();
