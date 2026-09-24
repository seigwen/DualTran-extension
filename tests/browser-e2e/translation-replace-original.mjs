/**
 * DualTran E2E: replaceOriginal 模式翻译测试
 *
 * 验证「用译文替换原文」模式下翻译流程的正确性和稳定性：
 * 1. 配置 replaceOriginal 模式 + Google 翻译 → 无重复元素
 * 2. Soak 测试（5 秒等待）→ 元素数量稳定
 * 3. AI 翻译 → 无重复元素 + soak 稳定
 *
 * 这是对 translation.mjs（newLine 模式）的模式对称覆盖。
 * 参见 issue #17: 测试体系系统性改进。
 *
 * @module translation-replace-original
 */

import {
  setupFull,
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  writeStorage,
  readStorage,
  assertReplaceOriginalNoDuplicates,
} from "./setup.mjs";

export const name = "translation-replace-original";

/** 需要 Mock LLM 服务器（AI 翻译步骤） */
export const needsMock = true;

/** 不纳入 smoke 子集 */
export const smoke = false;

// ─── 辅助函数 ────────────────────────────────────────────────

/**
 * 计数 replaceOriginal 模式下的翻译元素数量。
 * - AI span: .dualtran-aitranslatedtext-replacemode
 * - 被替换的文本节点: .dualtran-result-container 内的 <font> 元素
 */
async function countReplaceOriginalElements(page) {
  return page.evaluate(() => {
    const aiSpans = document.querySelectorAll(".dualtran-aitranslatedtext-replacemode");
    const containers = document.querySelectorAll(".dualtran-result-container");
    return {
      aiSpans: aiSpans.length,
      containers: containers.length,
    };
  });
}

// ─── E2E 测试步骤 ────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, mockServerConfig } = scope;

  // ═══════════════════════════════════════════════════════════════
  // Step 1: 配置 replaceOriginal 模式
  // ═══════════════════════════════════════════════════════════════
  console.log("[replace-original] Step 1: Configuring replaceOriginal mode...");

  const apiBase = mockServerConfig?.openRouterApiBase || "http://localhost:8788";
  await serviceWorker.evaluate(async (config) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguages: ["fr", "en", "es"],
      whereToDisplayTranslatedText: "replaceOriginal",
      translateDynamicallyCreatedContent: "yes",
      // AI 配置（用于 Step 4）
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: config.apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      aiImproveForLongerThan: 0,
    });
  }, { apiBase });

  // 验证配置写入成功
  const storedMode = await readStorage(serviceWorker, "whereToDisplayTranslatedText");
  if (storedMode !== "replaceOriginal") {
    throw new Error(`[replace-original] Config not set. Expected "replaceOriginal", got "${storedMode}"`);
  }
  console.log("[replace-original] Step 1: Config set ✓");

  // ═══════════════════════════════════════════════════════════════
  // Step 2: Google 翻译 + 验证无重复
  // ═══════════════════════════════════════════════════════════════
  console.log("[replace-original] Step 2: Google translation in replaceOriginal mode...");

  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // 触发 Google 翻译
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });

  // 等待翻译完成（检测 .dualtran-result-container 出现）
  await page.waitForFunction(() => {
    return document.querySelectorAll(".dualtran-result-container").length > 0;
  }, null, { timeout: 30000 });

  await page.waitForTimeout(1000);

  // 断言无重复元素
  const googleCount = await assertReplaceOriginalNoDuplicates(page);
  console.log(`[replace-original] Step 2: ${googleCount} AI spans, no duplicates ✓`);

  // 译文颜色规则：replaceOriginal 模式 → 译文颜色为原文颜色（不得应用"谷歌译文颜色"）
  const colorState = await page.evaluate(() => {
    const container = document.querySelector(".dualtran-result-container");
    const el = container || document.querySelector("p");
    return {
      hasContainer: !!container,
      containerColor: container ? getComputedStyle(container).color : null,
      bodyTextSample: (document.body.innerText || "").substring(0, 60),
    };
  });
  console.log(`[replace-original] Step 2 color check: container=${colorState.hasContainer}, color=${colorState.containerColor}`);
  // 若容器存在且 computed color 是"谷歌译文颜色"绿色（rgba(11,112,33)），则违反译文颜色规则
  if (colorState.hasContainer) {
    const rgb = colorState.containerColor || "";
    const isDefaultGreen = rgb.includes("11, 112, 33") || rgb.includes("11,112,33");
    if (isDefaultGreen) {
      throw new Error(
        "[replace-original] 译文颜色规则被违反：replaceOriginal 模式下 Google 译文不应应用\"谷歌译文颜色\"（translatedColor），实际颜色为 " + rgb
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Step 3: Soak 测试（5 秒）— 捕获 serial feedback loop
  // ═══════════════════════════════════════════════════════════════
  console.log("[replace-original] Step 3: Soak test (5 seconds)...");

  const beforeSoak = await countReplaceOriginalElements(page);
  await page.waitForTimeout(5000);
  const afterSoak = await countReplaceOriginalElements(page);

  if (afterSoak.aiSpans !== beforeSoak.aiSpans) {
    throw new Error(
      `[replace-original] Soak test FAILED: AI spans changed from ${beforeSoak.aiSpans} to ${afterSoak.aiSpans} after 5s. ` +
      `Feedback loop detected!`
    );
  }
  if (afterSoak.containers !== beforeSoak.containers) {
    throw new Error(
      `[replace-original] Soak test FAILED: containers changed from ${beforeSoak.containers} to ${afterSoak.containers} after 5s.`
    );
  }

  // 再次断言无重复（belt-and-suspenders）
  await assertReplaceOriginalNoDuplicates(page);
  console.log(`[replace-original] Step 3: Soak passed — ${afterSoak.aiSpans} AI spans, ${afterSoak.containers} containers stable ✓`);

  // ═══════════════════════════════════════════════════════════════
  // Step 4: AI 翻译 + 无重复验证
  // ═══════════════════════════════════════════════════════════════
  console.log("[replace-original] Step 4: Triggering AI translation via #btnAi...");

  // issue #88 改写：旧的 "dualtran-ai-translate-on-load" sessionStorage 标记在
  // src/ 中没有任何读取方（ghost trigger）——AI 翻译只能由 #btnAi 触发。
  // probe 实证（真实 Chrome 151）：Google 翻译完成后点击 shadow DOM 中的
  // #btnAi，500ms 内即产生 AI 内容。

  // 重新加载页面（干净起点）
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // 触发 Google 翻译（AI 按钮附着在翻译结果上）
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });

  // 等待 Google 翻译完成
  await page.waitForFunction(() => {
    return document.querySelectorAll(".dualtran-result-container").length > 0;
  }, null, { timeout: 30000 });

  // 等待悬浮按钮组就绪并点击 #btnAi（真实触发路径）
  await page.waitForFunction(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    return !!host?.shadowRoot?.getElementById("btnAi");
  }, null, { timeout: 10000 });
  const btnAiClicked = await page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    const btnAi = host?.shadowRoot?.getElementById("btnAi");
    if (!btnAi) return false;
    btnAi.click();
    return true;
  });
  if (!btnAiClicked) {
    throw new Error("[replace-original] Step 4: 未找到 #btnAi（悬浮按钮宿主未渲染）");
  }

  // 等待 AI 翻译完成（最多 30 秒）
  let aiCompleted = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const aiState = await page.evaluate(() => {
      const spans = document.querySelectorAll(".dualtran-aitranslatedtext-replacemode");
      if (spans.length === 0) return "none";
      // 检查是否有 AI 翻译内容（非空 span）
      let hasAiContent = false;
      spans.forEach(s => {
        if (s.textContent.trim().length > 0) hasAiContent = true;
      });
      return hasAiContent ? "done" : "pending";
    });
    if (aiState === "done") {
      aiCompleted = true;
      console.log(`[replace-original] Step 4: AI translation appeared after ${(i + 1) * 500}ms`);
      break;
    }
  }

  if (!aiCompleted) {
    // #btnAi 点击后 30s 无 AI 内容 = AI 翻译管线缺陷，硬失败
    // （issue #88：症状不能当跳过前提——旧实现在此处静默吞掉断言）
    throw new Error("[replace-original] Step 4: 点击 #btnAi 后 30s 内未产生 AI 翻译内容");
  } else {
    // 断言无重复
    const aiCount = await assertReplaceOriginalNoDuplicates(page);
    console.log(`[replace-original] Step 4: ${aiCount} AI spans after AI translation, no duplicates ✓`);

    // Soak 测试（3 秒）
    const beforeAiSoak = await countReplaceOriginalElements(page);
    await page.waitForTimeout(3000);
    const afterAiSoak = await countReplaceOriginalElements(page);

    if (afterAiSoak.aiSpans !== beforeAiSoak.aiSpans) {
      throw new Error(
        `[replace-original] AI soak test FAILED: AI spans changed from ${beforeAiSoak.aiSpans} to ${afterAiSoak.aiSpans} after 3s.`
      );
    }

    await assertReplaceOriginalNoDuplicates(page);
    console.log(`[replace-original] Step 4: AI soak passed — ${afterAiSoak.aiSpans} AI spans stable ✓`);
  }

  console.log("[replace-original] All steps completed ✓");
}
