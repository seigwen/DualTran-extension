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
 *   node scripts/real-site-verify.mjs                  # full scenario library (CI set)
 *   node scripts/real-site-verify.mjs --include-local    # + local-only scenarios (x.com)
 *   node scripts/real-site-verify.mjs --scenario=<name>  # one scenario (local names ok)
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
 * translation text. The translation-reality gate (plan 34) measures
 * QUANTITY + script (nonEmpty floor, CJK ratio) via
 * tests/shared/translation-quality.mjs — still no specific-text checks.
 *
 * Exit codes (plan 34): 0 = PASSED; 1 = FAILED; 2 = SKIPPED-ENV
 * (Google gtx endpoint throttled — detected by the preflight or by
 * failure attribution; a SKIP is never green and never a red).
 *
 * Workflows: .github/workflows/canary.yml (weekly + dispatch, auto-issue
 * on failure) and .github/workflows/release.yml (release gate).
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LOCAL_SCENARIOS, SCENARIOS, SELF_TEST_PATH_MAP } from "./canary-scenarios.mjs";
import {
  HOST_SELECTORS,
  classifyHostStateInPage,
  injectHostStateInPage,
  hostSelectorFor,
} from "../tests/shared/host-state.mjs";
import {
  DEFAULT_QUALITY,
  collectTranslationQualityInPage,
  evaluateQualityGate,
} from "../tests/shared/translation-quality.mjs";

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
const INCLUDE_LOCAL = args.includes("--include-local"); // add local-only scenarios (x.com) to a library run

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
    // Pinned viewport (plan 34 §三.C): the #78 position scenarios assert
    // on-screen clamping — reproducible only with a fixed viewport
    // (same 1280×720 @ DSF=1 pin as the E2E suite, issue #67).
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

async function getServiceWorker(context, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 1_000 }).catch(() => null);
    }
    if (serviceWorker?.url()) return serviceWorker;
  }
  throw new Error("Could not find extension service worker");
}

async function findExtensionId(context, timeoutMs = 30_000) {
  return new URL((await getServiceWorker(context, timeoutMs)).url()).host;
}

// ─── Google-endpoint probe (plan 34 §三.B) ─────────────────────────

const GTX_PROBE_URL =
  "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=canary-preflight";

/**
 * Same-stack gtx probe: fetch from the extension service worker — the exact
 * fetch path the extension's Google translation uses. A bare curl from the
 * same machine proved unreliable (plan 34 §二.4), so the probe mirrors the
 * real consumer.
 *
 * @returns {Promise<number|string>} HTTP status, or "error:<detail>".
 */
async function probeGtx(context) {
  try {
    const sw = await getServiceWorker(context, 10_000);
    return await sw.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        return res.status;
      } catch (e) {
        return `error:${String(e).slice(0, 60)}`;
      }
    }, GTX_PROBE_URL);
  } catch (e) {
    return `error:${String(e).slice(0, 60)}`;
  }
}

function isGtxUsable(status) {
  return status === 200;
}

/**
 * Preflight: two probes 5s apart; any usable status → the run proceeds.
 * Both unusable → the whole run is not attributable (SKIP-ENV, exit 2).
 */
async function runGtxPreflight(context) {
  const first = await probeGtx(context);
  if (isGtxUsable(first)) return { ok: true, first, second: null };
  log(`gtx preflight attempt 1 unusable (${first}) — retrying in 5s`);
  await new Promise((r) => setTimeout(r, 5_000));
  const second = await probeGtx(context);
  return { ok: isGtxUsable(second), first, second };
}

/**
 * Seed the translation target language for the whole run (plan 34 §三.A).
 * An unseeded profile resolves to `en` → the extension outputs the English
 * source back (en→en identity) — the second measured false-green hole.
 */
async function seedTargetLanguage(context) {
  const sw = await getServiceWorker(context);
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      targetLanguage: "zh-CN",
      targetLanguageTextTranslation: "zh-CN",
      targetLanguages: ["zh-CN", "en", "es"],
    });
  });
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

/**
 * Wait until translation output PLATEAUS, then return the quality metrics
 * (plan 34 §三.A). Plateau = three consecutive samples (1200ms apart) with
 * the same nonEmpty count. All-zero samples never plateau — a slow first
 * batch must not be misread as "done"; the caller's gate + attribution
 * handle the all-zero case. On timeout the LAST sample is returned (no
 * throw): the gate decides pass/fail, attribution decides SKIP vs FAIL.
 */
async function waitForTranslationQuality(page, timeoutMs = 45_000) {
  const start = Date.now();
  let last = { count: 0, nonEmpty: 0, cjk: 0 };
  let prevNonEmpty = -1;
  let stable = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await page.evaluate(collectTranslationQualityInPage);
      if (last.nonEmpty > 0 && last.nonEmpty === prevNonEmpty) {
        stable++;
        if (stable >= 2) return last; // 3 equal samples: baseline + 2
      } else {
        stable = 0;
      }
      prevNonEmpty = last.nonEmpty;
    } catch {
      // transient context destruction — keep polling
    }
    await page.waitForTimeout(1_200);
  }
  return last;
}

/**
 * Translation-reality assertion (plan 34 §三.A): wait for the plateau, then
 * apply the quality gate (nonEmpty floor ∧ CJK ratio). Replaces the old
 * "any translated node exists" check that had two measured false-green
 * holes (429 window: nodes created, text empty; en→en: English counted).
 * Throws with full metrics + thresholds — the caller's attribution maps a
 * throttled-endpoint failure to SKIP-ENV.
 */
async function assertTranslationReality(page, qualityOverrides) {
  const metrics = await waitForTranslationQuality(page, 45_000);
  const gate = evaluateQualityGate(metrics, qualityOverrides);
  if (!gate.ok) {
    const minCjk = qualityOverrides?.minCjkRatio ?? DEFAULT_QUALITY.minCjkRatio;
    throw new Error(
      `translation-reality gate failed — metrics=${JSON.stringify(metrics)}; ` +
        `need nonEmpty ≥ ${gate.minNonEmpty} ∧ cjk/nonEmpty ≥ ${Math.round(minCjk * 100)}% ` +
        `(got nonEmpty=${metrics.nonEmpty}, cjkRatio=${(gate.cjkRatio * 100).toFixed(1)}%)`
    );
  }
  return `${metrics.nonEmpty}/${metrics.count} non-empty, ${(gate.cjkRatio * 100).toFixed(0)}% CJK`;
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

async function stepTranslate(page, scenario) {
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

  const quality = await assertTranslationReality(page, scenario?.quality);
  await waitHealthy(page);
  return `translated (${quality})`;
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

/**
 * Assert translation is still REAL after navigation (plan 34 §三.A — the
 * original user symptom class: Turbo navigation kills the observer and the
 * text silently reverts). Same gate as `translate`.
 */
async function stepAssertTranslated(page, scenario) {
  const quality = await assertTranslationReality(page, scenario?.quality);
  return `still translated: ${quality}`;
}

/**
 * Write an off-screen saved floating position into extension storage
 * BEFORE the page loads (plan 34 §三.C, issue #78 lock). Seeding via the
 * extension's own storage is the same mechanism the user's drag persists
 * through; the probe validated it on all three sites (100% visible after
 * clamping).
 */
async function stepSeedPosition(step, context) {
  const sw = await getServiceWorker(context, 15_000);
  const pos = { left: step.left, top: step.top };
  await sw.evaluate(
    (p) => chrome.storage.local.set({ floatingBtnPosition: { left: p.left, top: p.top } }),
    pos
  );
  return `seeded floatingBtnPosition ${JSON.stringify(pos)}`;
}

/**
 * Assert the floating layer actually intersects the viewport (#78 user
 * symptom: "按钮组完全不显示" — a saved off-screen position restored without
 * clamping). Requires intersects ∧ visiblePct ≥ 50; NOT fullyInside: the
 * #78 second finding showed the historical 38px bottom overflow at
 * vis≈73% is a normal state. Polls briefly so a late layout pass cannot
 * produce a false red.
 */
async function stepAssertFloatingVisible(page) {
  const read = () =>
    page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      if (!host) return { state: "absent" };
      const root = host.shadowRoot;
      const container = root?.getElementById("floatingBtnContainer") || root?.firstElementChild;
      if (!container) return { state: "no-container" };
      const r = container.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const inter = ix * iy;
      const area = Math.max(1, r.width * r.height);
      return {
        state: "ok",
        rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        visiblePct: Math.round((inter / area) * 100),
        intersects: inter > 0,
      };
    });

  let vis = await read();
  const deadline = Date.now() + 6_000;
  while (vis.state === "ok" && (!vis.intersects || vis.visiblePct < 50) && Date.now() < deadline) {
    await page.waitForTimeout(250);
    vis = await read();
  }
  if (vis.state !== "ok") {
    throw new Error(`floating layer not present for the visibility assertion (${vis.state}) — #78`);
  }
  if (!vis.intersects || vis.visiblePct < 50) {
    throw new Error(
      `floating layer not visible — ${JSON.stringify(vis)} (need intersects ∧ visiblePct ≥ 50; ` +
        `#78: an off-screen saved position must clamp back into the viewport)`
    );
  }
  return `visible ${vis.visiblePct}% (rect ${vis.rect.l},${vis.rect.t} ${vis.rect.w}×${vis.rect.h})`;
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

/**
 * Rewrite step URLs for --self-test; returns null when the scenario has no
 * mapping (→ SKIP-DATA). Mapping keys: `host + pathname` first, bare
 * pathname as a compatible fallback (plan 34 §三.C).
 *
 * Position scenarios (seed-position step) are deliberately NOT self-test
 * mapped: their assertion is the real-site clamp behavior under a real
 * layout — on the instant mock page it would be a trivially-green
 * duplicate of the E2E S4 coverage, so the self-test keeps them out.
 *
 * Self-test calibration for the translation-reality gate: the mock pages
 * are tiny by design (spa-source.html carries ~5 translatable blocks), so
 * the production floor (≥ 10) can never be met hermetically. The floor is
 * relaxed to 1 — the RATIO and CJK guards still apply, and a throttled
 * endpoint (all-empty) still fails the gate → attribution → SKIP-ENV.
 * Scenario-level `quality` overrides win over this calibration.
 */
const SELF_TEST_QUALITY = { minNonEmptyFloor: 1 };

function rewriteScenarioForSelfTest(scenario, baseUrl) {
  if (scenario.steps.some((s) => s.type === "seed-position")) return null;
  const steps = [];
  for (const step of scenario.steps) {
    if (step.url) {
      const u = new URL(step.url);
      const mapped = SELF_TEST_PATH_MAP[`${u.host}${u.pathname}`] || SELF_TEST_PATH_MAP[u.pathname];
      if (!mapped) return null;
      steps.push({ ...step, url: `${baseUrl}/${mapped}` });
    } else {
      steps.push({ ...step });
    }
  }
  return { ...scenario, steps, quality: { ...SELF_TEST_QUALITY, ...(scenario.quality || {}) } };
}

function selfTestSkipReason(scenario) {
  return scenario.steps.some((s) => s.type === "seed-position")
    ? "position scenarios are real-site only (self-test stays hermetic)"
    : "no self-test mapping";
}

async function executeStep(page, step, scenario, context) {
  switch (step.type) {
    case "goto":
      return stepGoto(page, step);
    case "translate":
      return stepTranslate(page, scenario);
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
      return stepAssertTranslated(page, scenario);
    case "seed-position":
      return stepSeedPosition(step, context);
    case "assert-floating-visible":
      return stepAssertFloatingVisible(page);
    case "inject-shell-hover":
      return stepInjectShellHover(page);
    case "inject-duplicate-hover":
      return stepInjectDuplicateHover(page);
    default:
      throw new Error(`unknown step type "${step.type}"`);
  }
}

const STEP_TIMEOUT_MS = 120_000;

async function runScenario(page, scenario, consoleTail, context) {
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
        executeStep(page, step, scenario, context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`step timed out after ${STEP_TIMEOUT_MS / 1000}s`)), STEP_TIMEOUT_MS)
        ),
      ]);
      const stepLine = `    step ${i + 1} (${step.type}${step.url ? ` ${new URL(step.url).pathname}` : ""}${step.rounds ? ` x${step.rounds}` : ""}) — ${((Date.now() - stepStart) / 1000).toFixed(1)}s — OK${detail ? ` (${detail})` : ""}`;
      timeline.push(stepLine);
      // Print step details (incl. translation-quality metrics) on PASS too —
      // the run log is the audit trail for "clean data" evidence (plan 34 §4.3).
      log(stepLine.trim());
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

async function runLibrary(page, consoleLogs, selfTestBaseUrl, context, includeLocal) {
  const library = includeLocal ? [...SCENARIOS, ...LOCAL_SCENARIOS] : SCENARIOS;
  const scenarios = [];

  for (const s of library) {
    if (selfTestBaseUrl) {
      const rewritten = rewriteScenarioForSelfTest(s, selfTestBaseUrl);
      if (!rewritten) {
        scenarios.push({ scenario: s, skip: selfTestSkipReason(s) });
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
      log(`[SKIP-DATA] ${scenario.name} (${skip})`);
      results.push({ name: scenario.name, status: "SKIP-DATA" });
      continue;
    }
    log(`── scenario: ${scenario.name} (${scenario.source})`);
    try {
      const duration = await runScenario(page, scenario, consoleTail(), context);
      log(`[PASS] ${scenario.name} (${duration}s)`);
      results.push({ name: scenario.name, status: "PASS", duration });
    } catch (e) {
      // Failure attribution (plan 34 §三.B): re-probe gtx; a throttled
      // endpoint makes the failure unattributable → SKIP-ENV.
      const status = await probeGtx(context);
      if (!isGtxUsable(status)) {
        log(`[SKIP-ENV] ${scenario.name} — Google gtx throttled (status ${status}); failure not attributable`);
        log(`  original failure: ${e.message.split("\n")[0]}`);
        results.push({ name: scenario.name, status: "SKIP-ENV", error: e.message });
        continue;
      }
      log(`[FAIL] ${scenario.name} (${e.message})`);
      results.push({ name: scenario.name, status: "FAIL", error: e.message });
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  const skipped = results.filter((r) => r.status === "SKIP-ENV");
  const dataSkipped = results.filter((r) => r.status === "SKIP-DATA");
  log(
    `=== CANARY SUMMARY: ${passed.length}/${results.length} passed` +
      `${failed.length ? `, ${failed.length} FAILED` : ""}` +
      `${skipped.length ? `, ${skipped.length} SKIP-ENV` : ""}` +
      `${dataSkipped.length ? `, ${dataSkipped.length} SKIP-DATA` : ""} ===`
  );
  for (const r of results) {
    log(`  [${r.status}] ${r.name}${r.duration ? ` (${r.duration}s)` : ""}`);
  }
  return { failed: failed.length, skipped: skipped.length };
}

// ─── Ad-hoc single-URL mode (original journey, --url=) ──────────────

async function runAdHocJourney(page, target, qualityOverride) {
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

  // 3. Wait for translation reality (quality gate; self-test calibration applies)
  const adHocQuality = await assertTranslationReality(page, qualityOverride);
  log(`Page translated (${adHocQuality})`);

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
  const translatedNow = await stepAssertTranslated(page, qualityOverride ? { quality: qualityOverride } : undefined);
  log(`Page still translated after back-nav (${translatedNow})`);

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
  log(`scenario library (${SCENARIOS.length} CI + ${LOCAL_SCENARIOS.length} local):`);
  for (const s of SCENARIOS) {
    console.log(`  ${s.name}\n    source: ${s.source}\n    ${s.description}\n    steps: ${s.steps.map((st) => st.type).join(" → ")}`);
  }
  for (const s of LOCAL_SCENARIOS) {
    console.log(`  ${s.name}  [local — requires --include-local or --scenario=]\n    source: ${s.source}\n    ${s.description}\n    steps: ${s.steps.map((st) => st.type).join(" → ")}`);
  }
  console.log("");
  log(`usage:`);
  console.log(`  node scripts/real-site-verify.mjs                    # run all CI scenarios`);
  console.log(`  node scripts/real-site-verify.mjs --include-local    # + local-only scenarios`);
  console.log(`  node scripts/real-site-verify.mjs --scenario=<name>  # run one scenario (local ok)`);
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
  if (scenarioName && ![...SCENARIOS, ...LOCAL_SCENARIOS].some((s) => s.name === scenarioName)) {
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

    // Deterministic target language + honest attribution preflight
    // (plan 34 §三.A / §三.B).
    await seedTargetLanguage(context);
    if (process.env.CANARY_SIMULATE_THROTTLE) {
      // Calibration-only escape hatch (workflows never set it): fake a 429
      // for gtx INSIDE the extension's own fetch path, so the typed-skip
      // flow (preflight exit 2 / per-scenario attribution) stays
      // deterministically exercisable outside a real throttle window.
      const sw = await getServiceWorker(context);
      await sw.evaluate(() => {
        const orig = self.fetch;
        self.fetch = async (...a) => {
          const u = typeof a[0] === "string" ? a[0] : a[0]?.url || String(a[0]);
          if (u.includes("translate.googleapis.com")) return new Response("", { status: 429 });
          return orig(...a);
        };
      });
      log("CANARY_SIMULATE_THROTTLE: gtx faked as 429 inside the extension fetch path (calibration only)");
    }
    if (process.env.CANARY_SKIP_PREFLIGHT) {
      // Calibration-only escape hatch (workflows never set it): exercises
      // the per-scenario failure attribution while a preflight would
      // mask it earlier.
      log("gtx preflight SKIPPED (CANARY_SKIP_PREFLIGHT — calibration only)");
    } else {
      const preflight = await runGtxPreflight(context);
      if (!preflight.ok) {
        log(`[SKIP-ENV] Google gtx not usable (status ${preflight.first} / ${preflight.second}) — canary skipped`);
        log("⏭️ CANARY SKIPPED-ENV");
        process.exit(2);
      }
      log(`gtx preflight OK (status ${preflight.first})`);
    }

    const consoleLogs = [];
    page.on("console", (m) => {
      const t = m.text();
      if (/dualtran|floatingBtn|singleton|host|popstate|restore/i.test(t) && t.length < 300) consoleLogs.push(t);
    });

    if (adHocUrl) {
      // Ad-hoc single-URL journey (original tool behavior), with the same
      // quality gate + SKIP-ENV attribution as the scenario modes.
      log(`target: ${adHocTarget}${SELF_TEST ? " (self-test mode)" : ""}`);
      try {
        await runAdHocJourney(page, adHocTarget, SELF_TEST ? SELF_TEST_QUALITY : undefined);
        process.exit(0);
      } catch (e) {
        const status = await probeGtx(context);
        if (!isGtxUsable(status)) {
          log(`[SKIP-ENV] ad-hoc journey not attributable — Google gtx throttled (status ${status})`);
          log(`  original failure: ${e.message.split("\n")[0]}`);
          log("⏭️ REAL-SITE VERIFY SKIPPED-ENV");
          process.exit(2);
        }
        throw e; // outer catch: exit 1 with diagnostics
      }
    }

    if (scenarioName) {
      // Single scenario from the library (CI or local — direct naming is
      // allowed without --include-local).
      const scenario = [...SCENARIOS, ...LOCAL_SCENARIOS].find((s) => s.name === scenarioName);
      let runnable = scenario;
      if (SELF_TEST) {
        runnable = rewriteScenarioForSelfTest(scenario, selfTestBaseUrl);
        if (!runnable) {
          log(`[SKIP-DATA] ${scenario.name} (${selfTestSkipReason(scenario)})`);
          process.exit(0);
        }
      }
      log(`── scenario: ${scenario.name} (${scenario.source})`);
      try {
        const duration = await runScenario(page, runnable, consoleLogs.slice(-30), context);
        log(`[PASS] ${scenario.name} (${duration}s)`);
        log("✅ CANARY PASSED");
        process.exit(0);
      } catch (e) {
        // Failure attribution (plan 34 §三.B): a throttled endpoint makes
        // the failure unattributable → SKIP-ENV (exit 2), not FAIL.
        const status = await probeGtx(context);
        if (!isGtxUsable(status)) {
          log(`[SKIP-ENV] ${scenario.name} — Google gtx throttled (status ${status}); failure not attributable`);
          log(`  original failure: ${e.message.split("\n")[0]}`);
          log("⏭️ CANARY SKIPPED-ENV");
          process.exit(2);
        }
        log(`[FAIL] ${scenario.name} (${e.message})`);
        log("❌ CANARY FAILED");
        process.exit(1);
      }
    }

    // No args (or --self-test only): full scenario library.
    const outcome = await runLibrary(page, consoleLogs, selfTestBaseUrl, context, INCLUDE_LOCAL);
    if (outcome.failed > 0) {
      log("❌ CANARY FAILED");
      process.exit(1);
    }
    if (outcome.skipped > 0) {
      log(`⏭️ CANARY SKIPPED-ENV (${outcome.skipped} scenario(s) not attributable — Google gtx throttled)`);
      process.exit(2);
    }
    log("✅ CANARY PASSED");
    process.exit(0);
  } catch (e) {
    log(`❌ REAL-SITE VERIFY FAILED: ${e.message}`);
    process.exit(1);
  } finally {
    await context.close().catch(() => {});
    if (selfTestServer) selfTestServer.server.close();
  }
}

main();
