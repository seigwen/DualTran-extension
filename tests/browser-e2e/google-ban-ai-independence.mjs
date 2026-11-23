/**
 * DualTran E2E — Google ban (HTTP 429) must not disable AI translation.
 *
 * Real-world report: when Google Translate marks the client as automated bulk
 * traffic and starts failing, the Google pass resolves with empty strings.
 * In newLine mode the AI block used to be registered ONLY when the Google
 * output had words — so the AI loop found zero blocks ("no blocks to
 * translate") and the user concluded "AI translation also fails", although the
 * AI provider was healthy.
 *
 * This scenario locks the real path:
 *   1. Configure an AI provider against the aimock server.
 *   2. For every display mode: load the verify page, inject three unique probe
 *      paragraphs (cache-proof), then make EVERY translate.googleapis.com
 *      request return HTTP 429 from the service worker.
 *   3. Trigger Google page translation → all Google results are empty.
 *   4. Assert the probe blocks are still registered (the fix's lock) and that
 *      clicking the floating AI button lands AI text inside them.
 *   5. Remove the fetch patch (self-cleanup).
 *
 * Pre-fix RED: the newLine leg waits for `[data-dualtran-block]` and times out
 * (0 blocks registered). replaceOriginal is the green control — it always
 * registered on the source text.
 *
 * @module google-ban-ai-independence
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  assertNoDuplicateTranslationElements,
  forEachDisplayMode,
} from "./setup.mjs";

export const name = "google-ban-ai-independence";

/** Needs the mock LLM server (AI translation is the observed channel). */
export const needsMock = true;

/** Not in the smoke subset (full AI pipeline + both display modes). */
export const smoke = false;

const PROBE_COUNT = 3;

/**
 * Wait for the SW's one-time provider migration. Without this, a storage write
 * can be clobbered by `migrateProviderConfig` (observed: aiProvider reset to
 * "" mid-run, making the AI click show providerRequiredError instead of
 * exercising this scenario).
 */
async function waitForProviderMigration(serviceWorker) {
  await serviceWorker.evaluate(async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const stored = await chrome.storage.local.get("registryMigrated");
      if (stored.registryMigrated === "true") return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("provider migration did not finish");
  });
}

/**
 * Point the extension at the aimock provider.
 */
async function configureExtension(page, extensionId, serviceWorker, mockServerConfig) {
  await serviceWorker.evaluate(async (apiBase) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguageTextTranslation: "fr",
      targetLanguages: ["fr", "en", "es"],
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      aiImproveForLongerThan: 0,
      showFloatingBtn: "yes",
      translateDynamicallyCreatedContent: "yes",
    });
  }, mockServerConfig.openRouterApiBase);
  // Trigger twpConfig observers so the storage write is applied everywhere.
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
  await page.waitForTimeout(500);
}

/**
 * Install the Google ban: every gtx request returns HTTP 429.
 * Returns the hit counter accessor cleanup.
 */
async function installGoogleBan(serviceWorker) {
  await serviceWorker.evaluate(() => {
    if (!globalThis.__googleBanOriginalFetch) {
      globalThis.__googleBanOriginalFetch = globalThis.fetch;
    }
    globalThis.__googleBanHits = 0;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input?.url || "");
      if (url.includes("translate.googleapis.com")) {
        globalThis.__googleBanHits += 1;
        return new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
      }
      return globalThis.__googleBanOriginalFetch.call(globalThis, input, init);
    };
  });
}

async function removeGoogleBan(serviceWorker) {
  await serviceWorker.evaluate(() => {
    if (globalThis.__googleBanOriginalFetch) {
      globalThis.fetch = globalThis.__googleBanOriginalFetch;
      delete globalThis.__googleBanOriginalFetch;
    }
  });
}

/**
 * Wait until the Google pass settles (no pending batches). Since plan 118/P1
 * registers blocks at the source scan, the block-existence wait alone no
 * longer implies the Google arrivals finished — the empty-output assertion
 * must observe the settled pass.
 */
async function waitForGoogleSettled(serviceWorker, tabUrl, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await sendMessageToTab(serviceWorker, tabUrl, { action: "getFloatingUiState" });
    if (last && last.googleInFlight === false) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Google pass did not settle within ${timeoutMs}ms: ${JSON.stringify(last)}`);
}

/**
 * Insert unique probe paragraphs (Google cache is shared across scenarios —
 * fixed text would be served from cache and never hit the 429 patch).
 */
async function insertProbes(page, token) {
  await page.evaluate(({ token, count }) => {
    const host = document.querySelector("main") || document.body;
    const wrap = document.createElement("div");
    wrap.id = "ban-probe-wrap";
    for (let i = 1; i <= count; i++) {
      const p = document.createElement("p");
      p.className = "ban-probe";
      p.textContent =
        `Google ban probe ${token} paragraph ${i}. ` +
        `This sentence is unique to this run so the translation cache cannot answer it, ` +
        `and the service worker refuses every Google request with a rate limit error.`;
      wrap.appendChild(p);
    }
    host.prepend(wrap);
  }, { token, count: PROBE_COUNT });
}

/**
 * Run a scenario step for one display mode.
 */
async function runMode(scope, mode, token) {
  const { page, serviceWorker, verifyPageUrl, mockServerConfig, collector } = scope;
  const snippet = mockServerConfig.expectedAiSnippet;

  await page.goto(verifyPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await insertProbes(page, token);

  await installGoogleBan(serviceWorker);
  try {
    await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });

    // The fix's lock: probe blocks must register even though every Google
    // result is empty. Pre-fix newLine registers 0 and this wait times out.
    await page.waitForFunction(
      (count) => {
        const wrap = document.getElementById("ban-probe-wrap");
        return !!wrap && wrap.querySelectorAll("[data-dualtran-block]").length >= count;
      },
      PROBE_COUNT,
      { timeout: 20000 }
    );

    // ...and wait for the Google pass to actually settle before asserting its
    // output (source registration happens before any engine arrives).
    await waitForGoogleSettled(serviceWorker, page.url(), 20000);

    const banHits = await serviceWorker.evaluate(() => globalThis.__googleBanHits || 0);
    if (!(banHits > 0)) {
      throw new Error(`[${mode}] Google ban was never exercised (0 requests hit the 429 patch)`);
    }

    // Google really produced nothing for the probes.
    const probeState = await page.evaluate(() => {
      const wrap = document.getElementById("ban-probe-wrap");
      const blocks = [...wrap.querySelectorAll("[data-dualtran-block]")];
      const googleTexts = blocks.map((b) => {
        const span = b.querySelector(".dualtran-google");
        return span ? (span.textContent || "").trim() : "";
      });
      return {
        blockCount: blocks.length,
        nonEmptyGoogle: googleTexts.filter(Boolean).length,
      };
    });
    if (probeState.nonEmptyGoogle !== 0) {
      throw new Error(`[${mode}] expected empty Google text for every probe, got ${probeState.nonEmptyGoogle}/${probeState.blockCount}`);
    }

    // Click the page-level AI button.
    const clicked = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btn = host?.shadowRoot?.getElementById("btnAi");
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) throw new Error(`[${mode}] floating AI button not found`);

    // The AI text must land inside the probe wrapper (newLine: <translated>
    // sibling/child; replaceOriginal: the p itself).
    await page.waitForFunction(
      (snippetText) => {
        const wrap = document.getElementById("ban-probe-wrap");
        return !!wrap && (wrap.textContent || "").includes(snippetText);
      },
      snippet,
      { timeout: 45000 }
    );

    const aiProbeCount = await page.evaluate((snippetText) => {
      const wrap = document.getElementById("ban-probe-wrap");
      const blocks = [...wrap.querySelectorAll("[data-dualtran-block]")];
      return blocks.filter((b) => (b.textContent || "").includes(snippetText)).length;
    }, snippet);
    if (!(aiProbeCount >= PROBE_COUNT)) {
      throw new Error(`[${mode}] AI text reached ${aiProbeCount}/${PROBE_COUNT} probes`);
    }

    // Translation invariants: no duplicate output element per block.
    await assertNoDuplicateTranslationElements(page);
    console.log(`  [${mode}] PASS — ${PROBE_COUNT} probes registered and AI-translated with Google 429-banned (${banHits} banned requests)`);
  } catch (err) {
    collector.record(`google-ban-ai:${mode}`, err.message);
    throw err;
  } finally {
    await removeGoogleBan(serviceWorker).catch(() => {});
  }
}

/**
 * Scenario entry.
 * @param {Object} scope
 */
export async function run(scope) {
  const { page, extensionId, serviceWorker, mockServerConfig } = scope;
  await waitForProviderMigration(serviceWorker);
  await configureExtension(page, extensionId, serviceWorker, mockServerConfig);

  const runToken = `t${Date.now().toString(36)}`;
  await forEachDisplayMode(scope, async (mode, index) => {
    await runMode(scope, mode, `${runToken}-${index}`);
  });
}
