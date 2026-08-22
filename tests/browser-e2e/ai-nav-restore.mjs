/**
 * DualTran E2E — SPA 导航回退后 AI 翻译状态恢复回归测试
 *
 * 验证修复：在使用 Turbo/PJAX 的站点上，用户 AI 翻译页面后
 * 导航到另一个页面，然后点击回退按钮，原页面的 AI 翻译
 * 应自动恢复（而不仅仅是 Google 翻译）。
 *
 * Bug 描述：
 *   GitHub 使用 Turbo Drive + turbo-cache-control=no-cache，
 *   回退时页面内容从服务器重新获取（原始 HTML）。
 *   Mutation Observer 能自动恢复 Google 翻译（有缓存），
 *   但 AI 翻译不会自动触发——因为 shouldForceAiAfterPageTranslation
 *   已被上次翻译完成后重置为 false。
 *
 * 与 navigation-recovery.mjs 的区别：
 *   navigation-recovery.mjs 测试浮动按钮 UI 的恢复（DOM 元素存在性）。
 *   本文件测试 AI 译文内容的恢复（Mock LLM 响应文本重新出现在 DOM 中）。
 *
 * 测试页面：
 *   spa-source.html / spa-target.html — 模拟 Turbo Drive 行为：
 *   拦截链接点击 → fetch 获取目标页面 → 替换 <body> → pushState。
 *   回退时 popstate → fetch 原页面 → 替换 <body>（全新原始 HTML）。
 *   Content script 不重新注入，JS 上下文保持不变。
 *
 * 修复文件：
 *   src/contentScript/pageTranslator.js
 *     - saveAiAppliedFlag / checkAiAppliedFlag / removeAiAppliedFlag
 *     - handlePopState (恢复 shouldForceAiAfterPageTranslation)
 *     - handlePageShow (非 bfcache 分支恢复)
 *     - onTabVisible (needAutoTranslateFromSession 强制 translatePage)
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
} from "./setup.mjs";

export const name = "ai-nav-restore";
export const needsMock = true;
export const smoke = false;

/**
 * 通过 Service Worker 配置扩展参数，使 AI 翻译指向 Mock LLM 服务器。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {Object} mockServerConfig - Mock 服务器配置
 */
async function configureExtensionForAi(serviceWorker, mockServerConfig) {
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
      autoImproveByAI: "yes",
      aiImproveForLongerThan: 0,
      showFloatingBtn: "yes",
    });
  }, openRouterApiBase);
  console.log("  Extension configured: autoImproveByAI=yes, provider=openrouter, mock API base set");
}

/**
 * 等待 AI 翻译完成（Mock 服务器响应文本出现在 DOM 中）。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} expectedAiSnippet - Mock 响应文本标记（如 "🌐[aimock]"）
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Promise<{aiProcessedCount: number, totalTranslated: number}>}
 */
async function waitForAiTranslation(page, expectedAiSnippet, timeoutMs = 45_000) {
  const startTime = Date.now();
  let pollIteration = 0;

  while (Date.now() - startTime < timeoutMs) {
    const result = await page.evaluate((snippet) => {
      const translatedNodes = document.querySelectorAll("translated");
      let aiProcessedCount = 0;
      translatedNodes.forEach((node) => {
        if ((node.textContent || "").includes(snippet)) {
          aiProcessedCount++;
        }
      });
      return {
        aiProcessedCount,
        totalTranslated: translatedNodes.length,
        hasMockResponse: document.body.innerText.includes(snippet),
      };
    }, expectedAiSnippet);

    pollIteration++;
    if (pollIteration % 5 === 0) {
      console.log(`    AI poll #${pollIteration}: aiProcessed=${result.aiProcessedCount}/${result.totalTranslated}, mockInDOM=${result.hasMockResponse}`);
    }

    if (result.hasMockResponse || result.aiProcessedCount > 0) {
      console.log(`  AI translation detected: ${result.aiProcessedCount}/${result.totalTranslated} nodes contain "${expectedAiSnippet}"`);
      return result;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`AI translation timed out after ${timeoutMs}ms. Mock snippet "${expectedAiSnippet}" not found in DOM.`);
}

/**
 * 检查页面翻译状态。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @returns {Promise<{translatedCount: number, hasMockResponse: boolean, aiProcessedCount: number, sessionStorageFlag: string|null, currentUrl: string}>}
 */
async function checkTranslationState(page) {
  return page.evaluate(() => {
    const translatedNodes = document.querySelectorAll("translated");
    let aiProcessedCount = 0;
    const snippet = "🌐[aimock]";
    translatedNodes.forEach((node) => {
      if ((node.textContent || "").includes(snippet)) {
        aiProcessedCount++;
      }
    });

    // 读取 sessionStorage 标记
    let sessionStorageFlag = null;
    try {
      const key = "dualtran:aiApplied:" + location.origin + location.pathname;
      sessionStorageFlag = sessionStorage.getItem(key);
    } catch (_) {}

    return {
      translatedCount: translatedNodes.length,
      hasMockResponse: document.body.innerText.includes(snippet),
      aiProcessedCount,
      sessionStorageFlag,
      currentUrl: location.href,
    };
  });
}

/**
 * 场景 1：SPA 导航 — AI 翻译 → SPA 导航到目标页 → 浏览器回退 → AI 翻译应自动恢复
 *
 * 这是核心回归测试，完整模拟用户报告的 bug 场景。
 * 使用模拟 Turbo Drive 的 spa-source.html / spa-target.html 页面：
 *   - 点击链接时 SPA 脚本拦截导航，fetch 目标页面，替换 body，pushState
 *   - 回退时 popstate 触发，SPA 脚本 fetch 原页面，替换 body（全新原始 HTML）
 *   - Content script 不重新注入（与真实 SPA 框架行为一致）
 */
async function verifyAiRestoreAfterSpaBackNav(page, serviceWorker, spaSourceUrl, spaTargetUrl, mockServerConfig) {
  console.log("[ai-nav-restore] Scene 1: SPA AI translate → SPA navigate → back → AI translation restored");

  const expectedAiSnippet = mockServerConfig.expectedAiSnippet;

  // ── 步骤 1：打开 SPA 源页面 ──
  console.log("  Step 1: Navigate to SPA source page");
  await page.goto(spaSourceUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // ── 步骤 2：触发翻译（Google + AI）──
  console.log("  Step 2: Trigger translation (Google + AI)");
  await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });

  // 等待 Google 翻译完成
  await page.waitForFunction(
    () => document.querySelectorAll("translated").length > 0,
    null,
    { timeout: 15_000 }
  );
  console.log("  Google translation completed.");

  // autoImproveByAI 已在 eecfb00 移除：AI 翻译由用户点击 AI 按钮触发。
  // 三态模型：Google 翻译完成后 pageLanguageState="translated"，
  // 点击 AI 按钮 = 直接发起 AI 翻译（Google 已翻译过，不重复调）。
  // 一次点击即可，无需先恢复原文。
  await page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    host?.shadowRoot?.getElementById("btnAi")?.click();
  });
  console.log("  #btnAi clicked, waiting for AI translation...");

  // 等待 AI 翻译完成
  await waitForAiTranslation(page, expectedAiSnippet);

  // ── 步骤 3：验证翻译状态和 sessionStorage 标记 ──
  console.log("  Step 3: Verify translation state and sessionStorage flag");
  const stateAfterTranslate = await checkTranslationState(page);
  console.log(`  After translate: translatedCount=${stateAfterTranslate.translatedCount}, aiProcessed=${stateAfterTranslate.aiProcessedCount}, sessionStorageFlag=${stateAfterTranslate.sessionStorageFlag}`);

  if (stateAfterTranslate.translatedCount === 0) {
    throw new Error("No <translated> nodes found after translation on SPA source page");
  }
  if (stateAfterTranslate.aiProcessedCount === 0 && !stateAfterTranslate.hasMockResponse) {
    throw new Error("AI translation did not produce any mock response on SPA source page");
  }

  // ── 步骤 4：SPA 导航到目标页面（点击链接，SPA 脚本拦截）──
  console.log("  Step 4: SPA navigate to target page (click link, SPA intercepts)");
  await page.click("#test-link");

  // 等待 SPA 导航完成（URL 变化 + body 内容替换）
  await page.waitForFunction(
    () => location.pathname.includes("spa-target.html"),
    null,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(1000); // 等待 body 替换完成

  const pageBUrl = page.url();
  if (!pageBUrl.includes("spa-target.html")) {
    throw new Error(`SPA navigation to target page failed. Current URL: ${pageBUrl}`);
  }
  console.log(`  SPA target page loaded: ${pageBUrl}`);

  // 验证 body 内容已被替换（应该是全新的原始 HTML，无翻译）
  const stateOnTarget = await checkTranslationState(page);
  console.log(`  On target page: translatedCount=${stateOnTarget.translatedCount}`);
  if (stateOnTarget.translatedCount > 0) {
    console.log("  Note: Target page has translated nodes (possibly from auto-translate).");
  }

  // ── 步骤 5：点击浏览器回退按钮 ──
  console.log("  Step 5: Click browser back button (triggers popstate → SPA fetch + body replace)");
  await page.goBack();

  // 等待 SPA popstate 处理完成（fetch + body 替换）
  // popstate 处理器会 fetch spa-source.html 并替换 body
  await page.waitForFunction(
    () => location.pathname.includes("spa-source.html"),
    null,
    { timeout: 10_000 }
  );
  // 等待 body 内容被 SPA popstate 处理器替换为全新的原始 HTML
  await page.waitForTimeout(1500);
  console.log(`  Back to source page: ${page.url()}`);

  // ── 步骤 6：验证 DOM 已被替换为原始 HTML（无翻译）──
  console.log("  Step 6: Verify DOM was replaced with fresh HTML (no translation)");
  const stateAfterBack = await checkTranslationState(page);
  console.log(`  After back nav (before auto-restore): translatedCount=${stateAfterBack.translatedCount}, sessionStorageFlag=${stateAfterBack.sessionStorageFlag}`);

  // 此时 DOM 应该是全新的原始 HTML（SPA popstate 刚替换了 body）
  // 但 Mutation Observer 可能已经开始翻译 Google 译文了
  // 关键验证：sessionStorage 标记应仍然存在
  if (stateAfterBack.sessionStorageFlag !== "true") {
    console.log("  WARNING: sessionStorage flag not found after back nav. This may indicate the flag was not saved or was cleared.");
  }

  // ── 步骤 7：等待翻译自动恢复 ──
  console.log("  Step 7: Wait for translation to auto-restore after SPA back navigation");

  // 等待 <translated> 元素重新出现（Google 翻译通过 Mutation Observer 恢复）
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("translated").length > 0,
      null,
      { timeout: 30_000 }
    );
  } catch (_) {
    const stateNoTrans = await checkTranslationState(page);
    throw new Error(
      `Translation NOT restored after SPA back navigation. ` +
      `translatedCount=${stateNoTrans.translatedCount}, url=${stateNoTrans.currentUrl}, ` +
      `sessionStorageFlag=${stateNoTrans.sessionStorageFlag}`
    );
  }

  console.log("  Google translation restored after SPA back nav.");

  // 等待 AI 翻译恢复（Mock 响应文本重新出现在 DOM 中）
  // AI 翻译恢复依赖 shouldForceAiAfterPageTranslation 被 popstate 恢复
  // 然后 aiTranslateDynamically 定时器触发翻译（命中缓存或通过 Mock 服务器）
  try {
    await waitForAiTranslation(page, expectedAiSnippet, 60_000);
  } catch (err) {
    // AI 翻译恢复失败——这是 bug 的确切表现
    const finalState = await checkTranslationState(page);
    throw new Error(
      `AI translation NOT restored after SPA back navigation. ` +
      `translatedCount=${finalState.translatedCount}, ` +
      `aiProcessed=${finalState.aiProcessedCount}, ` +
      `sessionStorageFlag=${finalState.sessionStorageFlag}. ` +
      `Google translation restored but AI translation is missing. ` +
      `This is the exact bug: shouldForceAiAfterPageTranslation was not restored. ` +
      `Original error: ${err.message}`
    );
  }

  // ── 步骤 8：验证最终翻译状态 ──
  console.log("  Step 8: Verify final translation state");
  const finalState = await checkTranslationState(page);
  console.log(`  Final state: translatedCount=${finalState.translatedCount}, aiProcessed=${finalState.aiProcessedCount}, sessionStorageFlag=${finalState.sessionStorageFlag}`);

  if (finalState.translatedCount === 0) {
    throw new Error("Translation lost after SPA back navigation (no <translated> nodes)");
  }
  if (finalState.aiProcessedCount === 0 && !finalState.hasMockResponse) {
    throw new Error(
      "AI translation NOT restored after SPA back navigation. " +
      "Google translation restored but AI translation is missing. " +
      "This is the exact bug: shouldForceAiAfterPageTranslation was not restored."
    );
  }

  console.log("  AI translation successfully restored after SPA back navigation.");
}

/**
 * 场景 2：无 AI 翻译的页面 SPA 回退后不应自动触发 AI 翻译
 *
 * 如果用户从未在此页面使用过 AI 翻译，SPA 回退后不应自动触发 AI 翻译。
 * 这验证了 sessionStorage 标记机制的"只恢复之前翻译过的页面"逻辑。
 */
async function verifyNoAutoTranslateWithoutFlag(page, serviceWorker, spaSourceUrl, spaTargetUrl) {
  console.log("[ai-nav-restore] Scene 2: No AI flag → SPA back nav should NOT auto-translate AI");

  // 导航到 SPA 源页面（不触发翻译）
  console.log("  Step 1: Navigate to SPA source page without translating");
  await page.goto(spaSourceUrl, { waitUntil: "domcontentloaded" });
  // Scene 1 在同 tab 的 sessionStorage 里留下了 AI flag（同 origin 同路径），
  // 本场景验证的是"从未使用过 AI 翻译"的页面，先清空 sessionStorage
  await page.evaluate(() => sessionStorage.clear());
  await waitForContentScriptInjected(serviceWorker, page.url());
  await page.waitForTimeout(500);

  // 确保没有 sessionStorage 标记
  const flagBefore = await page.evaluate(() => {
    try {
      const key = "dualtran:aiApplied:" + location.origin + location.pathname;
      return sessionStorage.getItem(key);
    } catch (_) { return "error"; }
  });
  console.log(`  sessionStorage flag before: ${flagBefore}`);

  // SPA 导航到目标页面
  console.log("  Step 2: SPA navigate to target page");
  await page.click("#test-link");
  await page.waitForFunction(
    () => location.pathname.includes("spa-target.html"),
    null,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(500);

  // 回退到源页面
  console.log("  Step 3: Back to source page (SPA popstate)");
  await page.goBack();
  await page.waitForFunction(
    () => location.pathname.includes("spa-source.html"),
    null,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(3000);

  // 验证没有 AI 翻译
  const state = await checkTranslationState(page);
  console.log(`  After SPA back nav: translatedCount=${state.translatedCount}, aiProcessed=${state.aiProcessedCount}, sessionStorageFlag=${state.sessionStorageFlag}`);

  if (state.aiProcessedCount > 0) {
    throw new Error(
      `AI translation was triggered on page without AI flag. ` +
      `aiProcessedCount=${state.aiProcessedCount}. ` +
      `This means sessionStorage flag mechanism incorrectly triggered AI translation.`
    );
  }

  console.log("  No AI translation triggered — correct behavior for page without AI flag.");
}

/**
 * 主运行入口
 * @param {Object} scope — setup 框架传入的作用域对象
 */
export async function run(scope) {
  const { page, serviceWorker, spaSourceUrl, spaTargetUrl, mockServerConfig, collector } = scope;

  console.log("\n═══════════════════════════════════════");
  console.log("  AI Navigation Restore E2E Tests (SPA)");
  console.log("═══════════════════════════════════════\n");

  // 检查扩展错误
  await collector.collectExtensionErrors(page, scope.extensionId);

  // 配置扩展
  await configureExtensionForAi(serviceWorker, mockServerConfig);
  await page.waitForTimeout(500);

  try {
    // 场景 1: SPA AI 翻译 → SPA 导航 → 回退 → AI 翻译恢复
    await verifyAiRestoreAfterSpaBackNav(page, serviceWorker, spaSourceUrl, spaTargetUrl, mockServerConfig);

    // 场景 2: 无 AI 标记的页面 SPA 回退后不应自动触发 AI 翻译
    await verifyNoAutoTranslateWithoutFlag(page, serviceWorker, spaSourceUrl, spaTargetUrl);

    console.log("\n  All AI navigation restore tests passed.\n");
  } catch (err) {
    console.error(`\n  AI NAV RESTORE TEST FAILED: ${err.message}\n`);
    throw err;
  }
}
