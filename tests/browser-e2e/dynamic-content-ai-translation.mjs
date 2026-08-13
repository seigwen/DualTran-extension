/**
 * DualTran E2E — 动态加载内容 AI 翻译回归测试
 *
 * 验证修复：在具有"滚动页面时动态加载内容"特征的网页（如 x.com 信息流）上，
 * 用户点击 AI 按钮后，不仅初始内容被 AI 翻译，后续动态加载的新内容
 * 也会被自动 AI 翻译。
 *
 * Bug 描述：
 *   aiTranslateDynamically 每轮翻译完成后将 shouldForceAiAfterPageTranslation
 *   重置为 false，导致下一轮 _shouldSkipAiTranslation 返回 true（跳过）。
 *   x.com 首页向下翻页出现的新文本仅被 Google 翻译，不会被 AI 翻译。
 *
 *   修复后 shouldForce 持续保持 true，直到 restorePage() 或
 *   stopAiAutoTranslate() 时才重置。
 *
 * 测试页面：
 *   dynamic-content.html — 包含 4 个静态段落 + window.injectDynamicContent()
 *   API，模拟动态加载内容的网页。
 *
 * 测试步骤：
 *   1. 配置扩展（autoImproveByAI=no，需要用户点击 AI 按钮触发）
 *   2. 导航到 dynamic-content.html
 *   3. 点击 AI 按钮 → Google 翻译 + AI 翻译初始内容
 *   4. 验证初始内容被 AI 翻译
 *   5. 通过 injectDynamicContent() 注入新内容（模拟向下翻页）
 *   6. 验证新内容也被 Google 翻译
 *   7. 核心断言：验证新内容也被 AI 翻译（不应被跳过）
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
} from "./setup.mjs";

export const name = "dynamic-content-ai-translation";
export const needsMock = true;
export const smoke = false;

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 通过 Service Worker 配置扩展参数，使 AI 翻译指向 Mock LLM 服务器。
 * 关键：autoImproveByAI=no，AI 翻译只能通过用户点击 AI 按钮触发（shouldForce 路径）。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {Object} mockServerConfig - Mock 服务器配置
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
      autoImproveByAI: "no",
      aiImproveForLongerThan: 0,
      showFloatingBtn: "yes",
      translateDynamicallyCreatedContent: "yes",
    });
  }, openRouterApiBase);
  console.log("  Extension configured: autoImproveByAI=no, provider=openrouter, mock API base set");

  // 访问选项页触发 twpConfig.onChanged 观察者
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
  await page.waitForTimeout(500);
}

/**
 * 等待 AI 翻译完成（Mock 服务器响应文本出现在 DOM 的 <translated> 节点中）。
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
 * 获取当前页面翻译状态快照。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} expectedAiSnippet - Mock 响应文本标记
 * @returns {Promise<{totalTranslated: number, aiProcessedCount: number}>}
 */
async function getTranslationState(page, expectedAiSnippet) {
  return page.evaluate((snippet) => {
    const translatedNodes = document.querySelectorAll("translated");
    let aiProcessedCount = 0;
    translatedNodes.forEach((node) => {
      if ((node.textContent || "").includes(snippet)) {
        aiProcessedCount++;
      }
    });
    return {
      totalTranslated: translatedNodes.length,
      aiProcessedCount,
    };
  }, expectedAiSnippet);
}

/**
 * 点击悬浮按钮组中的 AI 按钮（在 shadow DOM 内）。
 *
 * 依赖 setup.mjs 中 attachShadow({mode:"closed"}) → "open" 的猴子补丁。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @returns {Promise<boolean>} 点击是否成功
 */
async function clickAiButton(page) {
  return page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    if (!host || !host.shadowRoot) return false;
    const btnAi = host.shadowRoot.getElementById("btnAi");
    if (!btnAi) return false;
    btnAi.click();
    return true;
  });
}

/**
 * 等待 AI 按钮进入指定状态（loading / success / error / idle）。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} expectedState - 期望状态："loading"|"success"|"error"|"idle"
 * @param {number} timeoutMs - 超时毫秒数
 */
async function waitForAiButtonState(page, expectedState, timeoutMs = 30_000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const state = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btn = host?.shadowRoot?.getElementById("btnAi");
      if (!btn) return "not-found";
      const text = (btn.textContent || "").trim();
      if (text.includes("…")) return "loading";
      if (text.includes("✓")) return "success";
      if (text.includes("✗")) return "error";
      if (text === "AI") return "idle";
      return "unknown";
    });
    if (state === expectedState) {
      console.log(`  AI button state: ${expectedState}`);
      return;
    }
    await page.waitForTimeout(500);
  }
  const finalState = await page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    const btn = host?.shadowRoot?.getElementById("btnAi");
    return btn ? btn.textContent : "btn-not-found";
  });
  throw new Error(`AI button state did not become "${expectedState}" within ${timeoutMs}ms. Final text: "${finalState}"`);
}

/**
 * 等待指定数量的 <translated> 节点出现在 DOM 中。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {number} minCount - 最少需要出现的节点数
 * @param {number} timeoutMs - 超时毫秒数
 */
async function waitForTranslatedNodeCount(page, minCount, timeoutMs = 20_000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const count = await page.evaluate(() => {
      return document.querySelectorAll("translated").length;
    });
    if (count >= minCount) {
      console.log(`  Translated nodes: ${count} (expected >= ${minCount})`);
      return count;
    }
    await page.waitForTimeout(500);
  }
  const finalCount = await page.evaluate(() => document.querySelectorAll("translated").length);
  throw new Error(`Expected >= ${minCount} translated nodes, but got ${finalCount} after ${timeoutMs}ms`);
}


// ═══════════════════════════════════════════════════════════════
// 场景入口
// ═══════════════════════════════════════════════════════════════

/**
 * E2E 测试入口。
 *
 * @param {Object} scope - setup.mjs 提供的 scope 对象
 */
export async function run(scope) {
  const { page, extensionId, serviceWorker, dynamicContentPageUrl, mockServerConfig, collector } = scope;
  const expectedAiSnippet = mockServerConfig.expectedAiSnippet;

  console.log("┌──────────────────────────────────────────────────┐");
  console.log("│  dynamic-content-ai-translation                │");
  console.log(`│  Mock snippet: "${expectedAiSnippet}"`);
  console.log("└──────────────────────────────────────────────────┘");

  // 绑定错误收集器
  collector.attachPage(page, "dynamic-content");
  collector.attachServiceWorker(serviceWorker);

  // ── 步骤 1：配置扩展 ──
  console.log("\n[Step 1] Configure extension");
  await configureExtensionForAi(page, extensionId, serviceWorker, mockServerConfig);

  // ── 步骤 2：导航到动态内容测试页面 ──
  console.log("\n[Step 2] Navigate to dynamic-content.html");
  await page.goto(dynamicContentPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // 等待悬浮按钮组渲染
  await page.waitForFunction(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    return host && host.shadowRoot && host.shadowRoot.getElementById("btnAi");
  }, null, { timeout: 10_000 });
  console.log("  Floating button group rendered");

  // ── 步骤 3：点击 AI 按钮触发翻译 ──
  console.log("\n[Step 3] Click AI button → triggers Google + AI translation");
  const clickOk = await clickAiButton(page);
  if (!clickOk) throw new Error("Failed to click AI button (shadow DOM not accessible)");

  // AI 按钮应进入 loading 状态
  await waitForAiButtonState(page, "loading", 5_000);
  console.log("  AI button entered loading state");

  // ── 步骤 4：等待初始内容的 AI 翻译完成 ──
  console.log("\n[Step 4] Wait for initial AI translation to complete");
  const initialAiResult = await waitForAiTranslation(page, expectedAiSnippet, 60_000);

  // AI 按钮应进入 success 状态
  await waitForAiButtonState(page, "success", 5_000);

  const initialState = await getTranslationState(page, expectedAiSnippet);
  console.log(`  Initial state: ${initialState.totalTranslated} translated, ${initialState.aiProcessedCount} AI-processed`);

  // ── 步骤 5：注入新的动态内容（模拟向下翻页/滚动加载）──
  console.log("\n[Step 5] Inject dynamic content (simulate infinite scroll)");
  const INJECT_COUNT = 3;
  const dynamicTexts = [
    "This is the first dynamically loaded paragraph. It appeared after the user scrolled down the page.",
    "The second paragraph contains different text that was loaded on demand, just like a social media feed.",
    "This third dynamic paragraph should also be picked up by both Google and AI translation engines.",
  ];
  const initialTotalTranslated = initialState.totalTranslated;

  await page.evaluate((texts) => {
    for (const text of texts) {
      window.injectDynamicContent(text);
    }
    // translateDynamically 只翻译可见屏幕内的元素——把动态容器滚动进视口中央，
    // 否则注入的内容在视口之外永远不会被 Google/AI 翻译。
    const container = document.getElementById("dynamic-container");
    container?.scrollIntoView({ block: "center" });
  }, dynamicTexts);
  console.log(`  Injected ${INJECT_COUNT} dynamic paragraphs (container scrolled into view)`);

  // ── 步骤 6：等待 Google 翻译处理新内容 ──
  console.log("\n[Step 6] Wait for Google translation of dynamic content");
  const expectedMinTranslated = initialTotalTranslated + INJECT_COUNT;
  await waitForTranslatedNodeCount(page, expectedMinTranslated, 20_000);
  console.log(`  Google translated the new dynamic content`);

  // ── 步骤 7：核心回归断言 — 等待并验证 AI 翻译处理了新内容 ──
  console.log("\n[Step 7] Wait for AI translation of dynamic content (REGRESSION CHECK)");
  const dynamicAiResult = await waitForAiTranslationAfterDynamicInjection(
    page, expectedAiSnippet, initialState.aiProcessedCount, initialState.totalTranslated, 60_000
  );

  const finalState = await getTranslationState(page, expectedAiSnippet);
  console.log(`  Final state: ${finalState.totalTranslated} translated, ${finalState.aiProcessedCount} AI-processed`);

  // ── 核心断言 ──
  if (finalState.aiProcessedCount <= initialState.aiProcessedCount) {
    throw new Error(
      `REGRESSION DETECTED: AI translation did NOT process new dynamic content.\n` +
      `  Initial AI count: ${initialState.aiProcessedCount}\n` +
      `  Final AI count:   ${finalState.aiProcessedCount}\n` +
      `  Expected:         > ${initialState.aiProcessedCount}\n` +
      `  This means dynamically loaded content was NOT AI translated.\n` +
      `  Root cause: shouldForceAiAfterPageTranslation was likely reset to false in aiTranslateDynamically.`
    );
  }
  console.log(`\n  PASS: AI translation processed ${finalState.aiProcessedCount - initialState.aiProcessedCount} new nodes from dynamic content`);
}

/**
 * 等待新注入的动态内容被 AI 翻译。
 * 与 waitForAiTranslation 的区别：此函数要求 AI 处理节点数必须超过注入前的数量。
 *
 * @param {import("playwright").Page} page
 * @param {string} expectedAiSnippet
 * @param {number} initialAiCount - 注入前的 AI 处理节点数
 * @param {number} initialTotalTranslated - 注入前的总翻译节点数
 * @param {number} timeoutMs
 * @returns {Promise<{aiProcessedCount: number, totalTranslated: number}>}
 */
async function waitForAiTranslationAfterDynamicInjection(
  page, expectedAiSnippet, initialAiCount, initialTotalTranslated, timeoutMs = 60_000
) {
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
      };
    }, expectedAiSnippet);

    pollIteration++;
    if (pollIteration % 3 === 0) {
      console.log(`    Dynamic AI poll #${pollIteration}: aiProcessed=${result.aiProcessedCount}/${result.totalTranslated} (initial=${initialAiCount})`);
    }

    // 核心条件：AI 处理节点数必须超过注入前的数量
    if (result.aiProcessedCount > initialAiCount) {
      console.log(`  Dynamic content AI translation detected: ${result.aiProcessedCount - initialAiCount} new AI-processed nodes`);
      return result;
    }

    await page.waitForTimeout(1000);
  }

  const finalState = await page.evaluate((snippet) => {
    const nodes = document.querySelectorAll("translated");
    let aiCount = 0;
    nodes.forEach(n => { if ((n.textContent || "").includes(snippet)) aiCount++; });
    return { total: nodes.length, aiProcessed: aiCount };
  }, expectedAiSnippet);

  throw new Error(
    `AI translation of dynamic content timed out after ${timeoutMs}ms.\n` +
    `  Initial state: ${initialAiCount} AI / ${initialTotalTranslated} translated\n` +
    `  Final state:   ${finalState.aiProcessed} AI / ${finalState.total} translated\n` +
    `  Mock snippet:  "${expectedAiSnippet}"\n` +
    `  This indicates a regression: shouldForceAiAfterPageTranslation was likely reset in aiTranslateDynamically.`
  );
}
