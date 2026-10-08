/**
 * DualTran E2E — 「总是使用 AI 翻译此网站」零点击自动 AI 翻译（issue #145）
 *
 * 验证 onTabVisible 的引擎选择：
 *   命中 alwaysTranslateSitesAI（+ mock provider key）→ 页面加载后无需任何
 *   点击，Google + AI 并发翻译自动启动；命中 Google 列表时不启动 AI。
 *
 * 步骤：
 *   1. 配置扩展（targetLanguage=fr, provider=openrouter→mock, key 已设，
 *      whereToDisplayTranslatedText=newLine, showFloatingBtn=yes）
 *   2. 种子 alwaysTranslateSitesAI=[host]（静态页 host），全新加载 test-page.html
 *   3. 零点击等待：AI 译文（aimock sentinel）出现在 <translated> 节点内
 *   4. 断言浮动按钮组高亮 ai + assertUiStateMatchesEngine（意图链自动接入）
 *   5. 负向对照：改为 alwaysTranslateSites=[host]（Google 列表）→ 重新加载 →
 *      同一观察窗内不得出现任何 AI 译文（防「Google 单边泄漏进 AI」）
 *   6. 收尾自清理（#108 纪律）：复位 storage + sessionStorage，全新加载断言干净页
 *
 * 自清理：本场景写入的自动翻译列表键与 AI 标记必须清干净——否则后续场景
 * 的全新加载会被自动翻译污染（setup.mjs resetScenarioState 已复位四个
 * always/never 键；本场景额外复位两个 AI 键并硬断言干净基线）。
 *
 * mode-symmetry-allow: 该场景的维度是「页面加载引擎选择」，不是显示模式；
 * 模式矩阵由 content-update-conformance.mjs 行为级遍历覆盖
 * （#98 复发复盘，2026-09-27）。
 *
 * @module auto-ai-translation
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  writeStorage,
  readStorage,
  assertUiStateMatchesEngine,
} from "./setup.mjs";

export const name = "auto-ai-translation";

/** 需要 Mock LLM 服务器（AI 翻译走 mock provider） */
export const needsMock = true;

/** 不纳入 smoke 子集（含 AI 完整管线，耗时较长） */
export const smoke = false;

// ─────────────────────────────────────────────────────────────────

/**
 * 通过 Service Worker 配置扩展。
 * @param {import("playwright").Page} page
 * @param {string} extensionId
 * @param {import("playwright").Worker} serviceWorker
 * @param {Object} mockServerConfig
 */
async function configureExtensionForAi(page, extensionId, serviceWorker, mockServerConfig) {
  const openRouterApiBase = mockServerConfig.openRouterApiBase;
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
      whereToDisplayTranslatedText: "newLine",
      showFloatingBtn: "yes",
      translateDynamicallyCreatedContent: "yes",
    });
  }, openRouterApiBase);

  // 访问选项页触发 twpConfig.onChanged 观察者
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
  await page.waitForTimeout(500);
}

/**
 * 统计页面中 AI 译文的到达情况（sentinel 出现在 <translated> 内）。
 * @param {import("playwright").Page} page
 * @param {string} snippet
 */
async function countAiArrivals(page, snippet) {
  return page.evaluate((s) => {
    const nodes = document.querySelectorAll("translated");
    let aiProcessed = 0;
    nodes.forEach((n) => {
      if ((n.textContent || "").includes(s)) aiProcessed += 1;
    });
    return { total: nodes.length, aiProcessed };
  }, snippet);
}

/**
 * 等待「零点击」条件下 AI 译文出现。
 * @param {import("playwright").Page} page
 * @param {string} snippet
 * @param {number} timeoutMs
 */
async function waitForZeroClickAiTranslation(page, snippet, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await countAiArrivals(page, snippet);
    if (r.aiProcessed > 0) {
      return r;
    }
    await page.waitForTimeout(1000);
  }
  const final = await countAiArrivals(page, snippet);
  throw new Error(
    `[auto-ai] 零点击 AI 翻译未出现（timeout ${timeoutMs}ms, translated=${final.total}, aiProcessed=${final.aiProcessed}）`
  );
}

/**
 * 断言零点击后浮动按钮组高亮为 ai（意图链自动接入）。
 * @param {import("playwright").Page} page
 * @param {number} timeoutMs
 */
async function waitForAiHighlight(page, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const active = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btnAi = host?.shadowRoot?.getElementById("btnAi");
      return !!btnAi?.classList.contains("dualtran-floating-btn-active");
    });
    if (active) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`[auto-ai] AI 按钮高亮未在 ${timeoutMs}ms 内出现（零点击自动 AI 翻译的意图链未接入）`);
}

/**
 * 收尾自清理 + 干净页硬断言（#108 纪律）。
 * @param {import("playwright").Page} page
 * @param {import("playwright").Worker} serviceWorker
 * @param {string} testPageUrl
 * @param {Object} scope
 */
async function cleanupAndAssertClean(page, serviceWorker, testPageUrl, scope) {
  // 复位本场景写入的全部自动翻译列表键
  await writeStorage(serviceWorker, "alwaysTranslateSitesAI", []);
  await writeStorage(serviceWorker, "alwaysTranslateLangsAI", []);
  await writeStorage(serviceWorker, "alwaysTranslateSites", []);
  await writeStorage(serviceWorker, "alwaysTranslateLangs", []);
  await writeStorage(serviceWorker, "neverTranslateSites", []);
  await writeStorage(serviceWorker, "neverTranslateLangs", []);

  // 清 sessionStorage（含 AI 标记），全新加载后硬断言干净基线
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await page.waitForTimeout(1500);

  const dirty = await page.evaluate(() => ({
    translated: document.querySelectorAll("translated").length,
    aiSpans: [...document.querySelectorAll(".dualtran-ai")].filter((el) => (el.textContent || "").trim()).length,
    aiMarkers: Object.keys(sessionStorage).filter((k) => k.startsWith("dualtran:")).length,
  }));
  if (dirty.translated > 0 || dirty.aiSpans > 0 || dirty.aiMarkers > 0) {
    throw new Error(
      `[auto-ai] 收尾隔离违规——干净加载不得带翻译残留: ${JSON.stringify(dirty)}`
    );
  }
}

export async function run(scope) {
  const { page, extensionId, serviceWorker, testPageUrl, mockServerConfig, collector } = scope;
  const expectedAiSnippet = mockServerConfig.expectedAiSnippet;
  const host = new URL(testPageUrl).hostname;

  console.log("┌──────────────────────────────────────────────────┐");
  console.log("│  auto-ai-translation（issue #145 零点击 AI 自动翻译）│");
  console.log(`│  Host: ${host}  Mock snippet: "${expectedAiSnippet}"`);
  console.log("└──────────────────────────────────────────────────┘");

  collector.attachPage(page, "auto-ai");
  collector.attachServiceWorker(serviceWorker);

  try {
    // ── 步骤 1：配置扩展 ──
    console.log("\n[Step 1] Configure extension (mock provider + fr target)");
    await configureExtensionForAi(page, extensionId, serviceWorker, mockServerConfig);

    // ── 步骤 2：种子 AI 列表 + 全新加载（零点击）──
    console.log(`\n[Step 2] Seed alwaysTranslateSitesAI=[${host}] → fresh load, ZERO clicks`);
    await writeStorage(serviceWorker, "alwaysTranslateSitesAI", [host]);
    await writeStorage(serviceWorker, "alwaysTranslateSites", []);

    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    // ── 步骤 3：零点击等待 AI 译文 ──
    console.log("\n[Step 3] Wait for AI translation WITHOUT any click (core regression check)");
    const arrivals = await waitForZeroClickAiTranslation(page, expectedAiSnippet, 60_000);
    console.log(`  AI translated ${arrivals.aiProcessed}/${arrivals.total} nodes with ZERO clicks`);

    // 翻译不变量（tests/CLAUDE.md 规则 2：翻译操作后必须断言）
    const dup = await page.evaluate(() => {
      const all = document.querySelectorAll("translated");
      const parents = new Map();
      all.forEach((t) => {
        const p = t.parentElement;
        parents.set(p, (parents.get(p) || 0) + 1);
      });
      return [...parents.values()].filter((c) => c > 1).length;
    });
    if (dup > 0) throw new Error(`[auto-ai] duplicate <translated> per parent: ${dup}`);

    // ── 步骤 4：意图链一致性（高亮 ai + SSOT 断言）──
    console.log("\n[Step 4] Assert floating button highlight=ai + UI/engine consistency");
    await waitForAiHighlight(page, 15_000);
    await assertUiStateMatchesEngine(page, serviceWorker, { expectTranslated: true });
    console.log("  highlight=ai + assertUiStateMatchesEngine ✓");

    // ── 步骤 5：负向对照——Google 列表不得启动 AI ──
    console.log("\n[Step 5] Negative control: Google list only → fresh load → NO AI translation");
    await page.evaluate(() => sessionStorage.clear());
    await writeStorage(serviceWorker, "alwaysTranslateSitesAI", []);
    await writeStorage(serviceWorker, "alwaysTranslateSites", [host]);

    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());
    // 观察窗：给 AI 管线充足时间「若错误启动的话」暴露
    await page.waitForTimeout(8000);
    const negative = await countAiArrivals(page, expectedAiSnippet);
    if (negative.aiProcessed > 0) {
      throw new Error(
        `[auto-ai] 负向对照失败：Google 列表加载后出现了 AI 译文（${negative.aiProcessed} 个节点）——AI 路径被错误触发`
      );
    }
    console.log(`  Google-only load: 0 AI translations (translated=${negative.total}) ✓`);
  } finally {
    // ── 步骤 6：收尾自清理 + 干净页硬断言 ──
    console.log("\n[Step 6] Cleanup + clean-page hard assertion (#108 discipline)");
    await cleanupAndAssertClean(page, serviceWorker, testPageUrl, scope).catch((e) => {
      console.warn(`[auto-ai] cleanup failed: ${e.message}`);
      throw e;
    });
  }

  console.log(`\n=== 场景 "${name}" 全部通过 ===\n`);
}
