/**
 * real-site-verify.mjs — real-site canary executor (S5, issue #57).
 *
 * Turns the real-site verification tool into a routine signal source:
 *   - scenario library (scripts/canary-scenarios.mjs) drives the runs;
 *   - every settled step asserts the tri-state host classification
 *     (healthy ∧ count===1) via the shared primitives in
 *     tests/shared/host-state.mjs — the same classifier the E2E suite uses;
 *   - failures keep going (all scenarios run to completion) and the
 *     process exits 1 with per-scenario diagnostics for the workflow.
 *
 * Modes:
 *   node scripts/real-site-verify.mjs                  # full scenario library
 *   node scripts/real-site-verify.mjs --scenario=<name>  # one scenario
 *   node scripts/real-site-verify.mjs --list           # list scenarios
 *   node scripts/real-site-verify.mjs --url=<url>      # ad-hoc single-URL journey
 *   node scripts/real-site-verify.mjs --self-test      # hermetic: local spa mock pages
 *
 * The ad-hoc `--url=` mode preserves the original single-URL journey
 * (translate → SPA link → back, plus singleton self-heal + duplicate
 * convergence injections) — the PR-checklist usage is unchanged.
 *
 * `--self-test` rewrites scenario step URLs by pathname against
 * SELF_TEST_PATH_MAP onto the local mock pages (extra/e2e/, served
 * here). Unmapped scenarios are SKIPPED — never silently re-pointed at
 * the real site (the self-test contract is hermetic). The 800ms fetch
 * delay injection is kept: a local mock server responds instantly,
 * which makes timer-based recovery look reliable and masks the exact
 * class of bug this tool exists to catch.
 *
 * Assertions are deliberately LOOSE (host lifecycle + "page is still
 * translated") — real site structure changes; never assert specific
 * translation text.
 *
 * Workflows: .github/workflows/canary.yml (weekly + dispatch, auto-issue
 * on failure) and .github/workflows/release.yml (release gate).
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SCENARIOS, SELF_TEST_PATH_MAP } from "./canary-scenarios.mjs";
import {
  HOST_SELECTORS,
  classifyHostStateInPage,
  injectHostStateInPage,
  hostSelectorFor,
} from "../tests/shared/host-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXTENSION_PATH = path.join(ROOT, "dist", "chrome");
const E2E_DIR = path.join(ROOT, "extra", "e2e");

// ─── CLI ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith("--url="));
const scenarioArg = args.find((a) => a.startsWith("--scenario="));
const SELF_TEST = args.includes("--self-test");
const HEADFUL = args.includes("--headful"); // parsed for CLI compatibility; the tool always runs a real window (xvfb on CI)
const LIST = args.includes("--list");

function log(msg) {
  console.log(`[real-site-verify] ${msg}`);
}

// ─── Local static server (self-test) ────────────────────────────────
// Serves extra/e2e/ — the spa mock pages with the same Turbo
// body-replacement + snapshot semantics as the E2E suite (verified
// against real github.com on 2026-09-10 / 2026-09-14).
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

// ─── Browser ────────────────────────────────────────────────────────

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
      window.fetch = async (...fetchArgs) => {
        await new Promise((r) => setTimeout(r, 800));
        return origFetch(...fetchArgs);
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

// ─── Node-side wrappers over the shared browser primitives ──────────
// Thin readers/asserts for the executor. The full assertion library
// (assertHostState/waitForHostState) lives in tests/browser-e2e/setup.mjs
// for the E2E suite; the canary only needs read + poll + fail.

async function readHostState(page, component) {
  return page.evaluate(classifyHostStateInPage, hostSelectorFor(component));
}

/**
 * Poll until the host is healthy with exactly one replica, or throw with
 * the last observed classification. 25s default matches the calibrated
 * healthyWait from the bug-8 diagnosis scripts.
 *
 * Tolerates transient evaluate failures (a navigation/reload destroys the
 * execution context mid-poll — e.g. the extension's first-load auto-reload
 * on a fresh profile) and keeps polling; the timeout is the real arbiter.
 */
async function waitHealthy(page, component = "floating", timeoutMs = 25_000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await readHostState(page, component);
      if (last.state === "healthy" && last.count === 1) return last;
    } catch (e) {
      last = { transient: String(e.message || e).slice(0, 120) };
    }
    await page.waitForTimeout(150);
  }
  throw new Error(
    `host "${component}" not healthy ∧ count===1 within ${timeoutMs}ms — last: ${JSON.stringify(last)}`
  );
}

/** Wait until the page shows any translation output (loose: newLine OR replaceOriginal). */
async function waitForTranslated(page, timeoutMs = 30_000) {
  const start = Date.now();
  let count = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      count = await page.evaluate(
        () =>
          document.querySelectorAll("translated").length +
          document.querySelectorAll(".dualtran-result-container").length
      );
      if (count > 0) return count;
    } catch {
      // transient context destruction — keep polling
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`no translated content appeared within ${timeoutMs}ms`);
}

/** Wait until location.pathname equals the expected path (guards against reading the old page's host). */
async function waitForPath(page, url, timeoutMs = 30_000) {
  const expected = new URL(url).pathname;
  await page.waitForFunction((p) => location.pathname === p, expected, { timeout: timeoutMs });
}

async function waitForPathChange(page, previousPath, timeoutMs = 15_000) {
  await page.waitForFunction((p) => location.pathname !== p, previousPath, { timeout: timeoutMs });
}

// ─── Step implementations ───────────────────────────────────────────

/**
 * Navigate to a target page. Preference order (validated in the bug-8
 * diagnosis on real github.com): in-page SPA link click > Turbo.visit >
 * full page.goto. The first two keep the SPA/Turbo navigation semantics
 * (snapshot caching on leave, restore on back/forward) — a plain goto
 * would bypass the Turbo code path entirely.
 */
async function navigateTo(page, url) {
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0))); // flush pending microtasks
  const via = await page
    .evaluate((u) => {
      const targetPath = new URL(u).pathname;
      const link = [...document.querySelectorAll("a[href]")].find((a) => {
        const raw = a.getAttribute("href");
        if (!raw || raw.startsWith("#")) return false;
        try {
          return new URL(raw, location.href).pathname === targetPath;
        } catch {
          return false;
        }
      });
      if (link) {
        link.click();
        return "link";
      }
      if (window.Turbo?.visit) {
        window.Turbo.visit(targetPath);
        return "turbo.visit";
      }
      return "none";
    }, url)
    .catch(() => "none");

  if (via === "none") {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    return "goto";
  }
  return via;
}

/**
 * Wait until the page has settled: no navigation event for `quietMs`.
 *
 * Why this exists (S5 probe finding): on a fresh extension install the
 * page receives an automatic reload during the first ~1s while the
 * background service worker runs its onInstalled effects (and content
 * scripts initialize). A goto that only waits for URL + host can click
 * inside that reload window — Playwright then reports "Execution context
 * was destroyed" and the translation is lost. Waiting for a quiet window
 * absorbs the reload deterministically; a fixed sleep would too, but
 * wastes time on warm pages and can still race on a slow machine.
 */
async function waitForPageStable(page, quietMs = 1200, timeoutMs = 30_000) {
  const start = Date.now();
  let lastNavAt = Date.now();
  const onNav = () => {
    lastNavAt = Date.now();
  };
  page.on("framenavigated", onNav);
  try {
    while (Date.now() - start < timeoutMs) {
      if (Date.now() - lastNavAt >= quietMs) return;
      await page.waitForTimeout(200);
    }
    throw new Error(`page did not stabilize (no quiet window of ${quietMs}ms) within ${timeoutMs}ms`);
  } finally {
    page.off("framenavigated", onNav);
  }
}

async function stepGoto(page, step) {
  const via = await navigateTo(page, step.url);
  await waitForPath(page, step.url, 30_000);
  await waitForPageStable(page);
  await waitHealthy(page);
  return `via ${via}`;
}

async function stepTranslate(page) {
  // Click the Google button. Defensive retry: if a navigation/reload (the
  // extension's first-load auto-reload) destroys the execution context
  // between our stability wait and the click, ride it out and retry.
  let clickedOk = false;
  for (let attempt = 1; attempt <= 3 && !clickedOk; attempt++) {
    try {
      await waitForPageStable(page);
      const clicked = await page.evaluate(() => {
        const host = document.getElementById("dualtran-floating-btn-host");
        const btn = host?.shadowRoot?.getElementById("btnGoogle");
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!clicked) throw new Error("floating button group not found on page (cannot translate)");
      clickedOk = true;
    } catch (e) {
      if (/Execution context was destroyed|Target closed/i.test(e.message) && attempt < 3) {
        continue; // page navigated mid-click — wait and retry
      }
      throw e;
    }
  }

  await waitForTranslated(page, 30_000);
  await waitHealthy(page);
  return "translated";
}

async function stepBack(page) {
  const before = await page.evaluate(() => location.pathname);
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await waitForPathChange(page, before, 15_000);
  await waitHealthy(page);
  return `→ ${await page.evaluate(() => location.pathname)}`;
}

async function stepForward(page) {
  const before = await page.evaluate(() => location.pathname);
  await page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await waitForPathChange(page, before, 15_000);
  await waitHealthy(page);
  return `→ ${await page.evaluate(() => location.pathname)}`;
}

async function stepAssertTranslated(page) {
  const count = await page.evaluate(
    () =>
      document.querySelectorAll("translated").length +
      document.querySelectorAll(".dualtran-result-container").length
  );
  if (count === 0) {
    throw new Error("page not translated after navigation (dynamic translation observer died?)");
  }
  return `${count} translated elements`;
}

/**
 * Inject a Turbo snapshot shell on the singleton host and poke the hover
 * route: the hover path is the singleton's only recovery entry point in
 * degraded states and must rebuild a functional host (issue #40).
 * Ported from the original ad-hoc journey step 9.
 */
async function stepInjectShellHover(page) {
  // The singleton host is created during addTranslatedContent's async
  // batch — poll briefly so a millisecond-scale creation gap is not
  // reported as a failure.
  const hostDeadline = Date.now() + 10_000;
  while (Date.now() < hostDeadline) {
    const present = await page.evaluate((id) => !!document.getElementById(id), HOST_SELECTORS.singleton);
    if (present) break;
    await page.waitForTimeout(200);
  }

  const inject = await page.evaluate((id) => {
    const host = document.getElementById(id);
    if (!host) return { skipped: true, reason: "no singleton host (was the page translated?)" };
    // Same semantics as Turbo PageSnapshot.clone(): shadow root is NOT cloned.
    const shell = host.cloneNode(true);
    host.replaceWith(shell);
    // Prefer [data-dualtran-block] (registered in both display modes) —
    // bare <translated> can be a display:none artifact (#65 target fidelity).
    const target = document.querySelector("[data-dualtran-block]") || document.querySelector("translated");
    if (!target) return { skipped: true, reason: "no translated block to hover" };
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return { skipped: false };
  }, HOST_SELECTORS.singleton);

  if (inject.skipped) throw new Error(`shell injection not possible: ${inject.reason}`);

  try {
    await waitHealthy(page, "singleton", 3_000);
  } catch {
    const state = await readHostState(page, "singleton");
    throw new Error(
      `singleton hover path did not self-heal an injected snapshot shell — ${JSON.stringify(state)} ` +
        `(hover must rebuild when the host is detached or shadow-less, issue #40)`
    );
  }
  return "self-healed";
}

/**
 * Append a shadow-less cloneNode copy of the singleton host
 * (healthy-first flavor) and poke the hover path: the predicate requires
 * EXACTLY ONE host, so the duplicate must trigger a rebuild that
 * converges back to a single functional host (issue #43).
 * Ported from the original ad-hoc journey step 9b.
 */
async function stepInjectDuplicateHover(page) {
  const dup = await page.evaluate((id) => {
    const host = document.getElementById(id);
    if (!host) return { skipped: true, reason: "no singleton host (was the page translated?)" };
    const copy = host.cloneNode(true);
    document.body.appendChild(copy);
    // Count BEFORE poking the hover path — the rebuild (when it happens)
    // is synchronous inside the mouseover dispatch.
    const before = document.querySelectorAll(`#${id}`).length;
    // Prefer [data-dualtran-block] (registered in both display modes) —
    // bare <translated> can be a display:none artifact (#65 target fidelity).
    const target = document.querySelector("[data-dualtran-block]") || document.querySelector("translated");
    if (!target) return { skipped: true, reason: "no translated block to hover" };
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return { skipped: false, before };
  }, HOST_SELECTORS.singleton);

  if (dup.skipped) throw new Error(`duplicate injection not possible: ${dup.reason}`);

  let converged = false;
  const start = Date.now();
  while (Date.now() - start < 3_000) {
    const state = await readHostState(page, "singleton");
    if (state.count === 1 && state.state === "healthy" && state.hasButtons) {
      converged = true;
      break;
    }
    await page.waitForTimeout(150);
  }
  if (!converged) {
    const state = await readHostState(page, "singleton");
    throw new Error(
      `singleton did not converge to a single functional host after duplicate injection — ${JSON.stringify(state)} ` +
        `(predicate must require exactly one host, issue #43; before=${dup.before})`
    );
  }
  return `converged (before=${dup.before})`;
}

// ─── Scenario execution ─────────────────────────────────────────────

/** Rewrite step URLs for --self-test; returns null when any URL is unmapped (→ SKIP). */
function rewriteScenarioForSelfTest(scenario, baseUrl) {
  const steps = [];
  for (const step of scenario.steps) {
    if (step.url) {
      const pathname = new URL(step.url).pathname;
      const mapped = SELF_TEST_PATH_MAP[pathname];
      if (!mapped) return null;
      steps.push({ ...step, url: `${baseUrl}/${mapped}` });
    } else {
      steps.push({ ...step });
    }
  }
  return { ...scenario, steps };
}

async function executeStep(page, step) {
  switch (step.type) {
    case "goto":
      return stepGoto(page, step);
    case "translate":
      return stepTranslate(page);
    case "back":
      return stepBack(page);
    case "forward":
      return stepForward(page);
    case "roundtrip": {
      const rounds = step.rounds || 1;
      for (let i = 1; i <= rounds; i++) {
        await stepBack(page);
        await stepForward(page);
      }
      return `${rounds} round(s)`;
    }
    case "assert-translated":
      return stepAssertTranslated(page);
    case "inject-shell-hover":
      return stepInjectShellHover(page);
    case "inject-duplicate-hover":
      return stepInjectDuplicateHover(page);
    default:
      throw new Error(`unknown step type "${step.type}"`);
  }
}

const STEP_TIMEOUT_MS = 120_000;

async function runScenario(page, scenario, consoleTail) {
  const timeline = [];
  const startedAt = Date.now();

  // Scenario isolation: reset to a blank page before starting so the
  // previous scenario's history/DOM cannot leak in (E2E convention).
  await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepStart = Date.now();
    try {
      const detail = await Promise.race([
        executeStep(page, step),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`step timed out after ${STEP_TIMEOUT_MS / 1000}s`)), STEP_TIMEOUT_MS)
        ),
      ]);
      timeline.push(`    step ${i + 1} (${step.type}${step.url ? ` ${new URL(step.url).pathname}` : ""}${step.rounds ? ` x${step.rounds}` : ""}) — ${((Date.now() - stepStart) / 1000).toFixed(1)}s — OK${detail ? ` (${detail})` : ""}`);
    } catch (e) {
      const state = await page
        .evaluate(classifyHostStateInPage, HOST_SELECTORS.floating)
        .catch(() => null);
      const url = await page.evaluate(() => location.pathname).catch(() => "?");
      timeline.push(`    step ${i + 1} (${step.type}${step.url ? ` ${new URL(step.url).pathname}` : ""}${step.rounds ? ` x${step.rounds}` : ""}) — ${((Date.now() - stepStart) / 1000).toFixed(1)}s — FAILED`);
      throw new Error(
        `step ${i + 1} (${step.type}${step.url ? ` ${new URL(step.url).pathname}` : ""}) failed: ${e.message}\n` +
          `  url: ${url}\n` +
          `  floating classification: ${JSON.stringify(state)}\n` +
          `  step timeline:\n${timeline.join("\n")}\n` +
          `  extension console tail (last 30):\n${consoleTail.slice(-30).map((l) => `    ${l}`).join("\n")}`
      );
    }
  }
  return ((Date.now() - startedAt) / 1000).toFixed(0);
}

async function runLibrary(page, consoleLogs, selfTestBaseUrl) {
  const scenarios = [];

  for (const s of SCENARIOS) {
    if (selfTestBaseUrl) {
      const rewritten = rewriteScenarioForSelfTest(s, selfTestBaseUrl);
      if (!rewritten) {
        scenarios.push({ scenario: s, skip: "no self-test mapping" });
        continue;
      }
      scenarios.push({ scenario: rewritten, skip: null });
    } else {
      scenarios.push({ scenario: s, skip: null });
    }
  }

  const results = [];
  const consoleTail = () => consoleLogs.slice(-30);

  for (const { scenario, skip } of scenarios) {
    if (skip) {
      log(`[SKIP] ${scenario.name} (${skip})`);
      results.push({ name: scenario.name, status: "SKIP" });
      continue;
    }
    log(`── scenario: ${scenario.name} (${scenario.source})`);
    try {
      const duration = await runScenario(page, scenario, consoleTail());
      log(`[PASS] ${scenario.name} (${duration}s)`);
      results.push({ name: scenario.name, status: "PASS", duration });
    } catch (e) {
      log(`[FAIL] ${scenario.name} (${e.message})`);
      results.push({ name: scenario.name, status: "FAIL", error: e.message });
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  log(`=== CANARY SUMMARY: ${passed.length}/${results.length} passed${failed.length ? `, ${failed.length} FAILED` : ""} ===`);
  for (const r of results) {
    log(`  [${r.status}] ${r.name}${r.duration ? ` (${r.duration}s)` : ""}`);
  }
  return failed.length === 0;
}

// ─── Ad-hoc single-URL mode (original journey, --url=) ──────────────

async function runAdHocJourney(page, target) {
  const consoleLogs = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/dualtran|floatingBtn|singleton|host|popstate|restore/i.test(t) && t.length < 300) consoleLogs.push(t);
  });

  log(`target: ${target}${SELF_TEST ? " (self-test mode)" : ""}`);

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

  // 3. Wait for translation to appear
  await waitForTranslated(page, 30_000);
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

  // 6. Assert: floating button group exists (tri-state: healthy)
  const floating = await readHostState(page, "floating");
  if (floating.state !== "healthy" || !floating.hasButtons) {
    throw new Error(`floating button group not healthy after back-nav — ${JSON.stringify(floating)} (observer died?)`);
  }
  log("Floating button group present after back-nav");

  // 7. Assert: page still translated (dynamic translation observer survived)
  const translatedCount = await stepAssertTranslated(page);
  log(`Page still translated after back-nav (${translatedCount})`);

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
    throw new Error("highlight is Original but page is translated (state inconsistency)");
  }
  log(`Highlight consistent with page state (${actual})`);

  // 9. Singleton hover self-heal (issue #40) — SKIP-tolerant (original semantics).
  try {
    const detail = await stepInjectShellHover(page);
    log(`Singleton host self-healed via hover (no snapshot shell) — ${detail}`);
  } catch (e) {
    if (/not possible/.test(e.message)) {
      log(`Singleton hover self-heal: SKIPPED (${e.message})`);
    } else {
      throw e;
    }
  }

  // 9b. Duplicate convergence (issue #43) — SKIP-tolerant (original semantics).
  try {
    const detail = await stepInjectDuplicateHover(page);
    log(`Singleton converged to a single functional host (duplicate removed) — ${detail}`);
  } catch (e) {
    if (/not possible/.test(e.message)) {
      log(`Duplicate convergence: SKIPPED (${e.message})`);
    } else {
      throw e;
    }
  }

  log("✅ REAL-SITE VERIFY PASSED");
}

// ─── Main ───────────────────────────────────────────────────────────

function printScenarioList() {
  log(`scenario library (${SCENARIOS.length} scenarios):`);
  for (const s of SCENARIOS) {
    console.log(`  ${s.name}\n    source: ${s.source}\n    ${s.description}\n    steps: ${s.steps.map((st) => st.type).join(" → ")}`);
  }
  console.log("");
  log(`usage:`);
  console.log(`  node scripts/real-site-verify.mjs                    # run all scenarios`);
  console.log(`  node scripts/real-site-verify.mjs --scenario=<name>  # run one scenario`);
  console.log(`  node scripts/real-site-verify.mjs --url=<url>        # ad-hoc single-URL journey`);
  console.log(`  node scripts/real-site-verify.mjs --self-test        # hermetic (local mock pages)`);
}

async function main() {
  if (LIST) {
    printScenarioList();
    process.exit(0);
  }

  const scenarioName = scenarioArg ? scenarioArg.slice("--scenario=".length) : null;
  const adHocUrl = urlArg ? urlArg.slice("--url=".length) : null;

  if (scenarioName && adHocUrl) {
    log("--url= and --scenario= are mutually exclusive");
    process.exit(1);
  }
  if (scenarioName && !SCENARIOS.some((s) => s.name === scenarioName)) {
    log(`unknown scenario "${scenarioName}" — use --list to see available scenarios`);
    process.exit(1);
  }

  // Self-test server (single instance shared by all modes).
  let selfTestServer = null;
  let selfTestBaseUrl = null;
  if (SELF_TEST) {
    selfTestServer = await startSelfTestServer();
    selfTestBaseUrl = selfTestServer.baseUrl;
  }
  const adHocTarget = selfTestBaseUrl ? `${selfTestBaseUrl}/spa-source.html` : adHocUrl || "https://github.com/obra/superpowers/projects";

  const { context, page } = await launch();
  try {
    const extensionId = await findExtensionId(context);
    log(`extension id: ${extensionId}`);

    const consoleLogs = [];
    page.on("console", (m) => {
      const t = m.text();
      if (/dualtran|floatingBtn|singleton|host|popstate|restore/i.test(t) && t.length < 300) consoleLogs.push(t);
    });

    if (adHocUrl) {
      // Ad-hoc single-URL journey (original tool behavior).
      log(`target: ${adHocTarget}${SELF_TEST ? " (self-test mode)" : ""}`);
      await runAdHocJourney(page, adHocTarget);
      process.exit(0);
    }

    if (scenarioName) {
      // Single scenario from the library.
      const scenario = SCENARIOS.find((s) => s.name === scenarioName);
      let runnable = scenario;
      if (SELF_TEST) {
        runnable = rewriteScenarioForSelfTest(scenario, selfTestBaseUrl);
        if (!runnable) {
          log(`[SKIP] ${scenario.name} (no self-test mapping)`);
          process.exit(0);
        }
      }
      log(`── scenario: ${scenario.name} (${scenario.source})`);
      try {
        const duration = await runScenario(page, runnable, consoleLogs.slice(-30));
        log(`[PASS] ${scenario.name} (${duration}s)`);
        log("✅ CANARY PASSED");
        process.exit(0);
      } catch (e) {
        log(`[FAIL] ${scenario.name} (${e.message})`);
        log("❌ CANARY FAILED");
        process.exit(1);
      }
    }

    // No args (or --self-test only): full scenario library.
    const ok = await runLibrary(page, consoleLogs, selfTestBaseUrl);
    log(ok ? "✅ CANARY PASSED" : "❌ CANARY FAILED");
    process.exit(ok ? 0 : 1);
  } catch (e) {
    log(`❌ REAL-SITE VERIFY FAILED: ${e.message}`);
    process.exit(1);
  } finally {
    await context.close().catch(() => {});
    if (selfTestServer) selfTestServer.server.close();
  }
}

main();
