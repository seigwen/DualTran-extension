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

  // #94: 哨兵色/前置配置写入前的初始值（场景收尾恢复，防止泄漏进后续场景）
  const initialTranslatedColor = await readStorage(serviceWorker, "translatedColor");
  const initialAiTranslatedColor = await readStorage(serviceWorker, "aiTranslatedColor");
  const initialShowOriginal = await readStorage(serviceWorker, "showOriginalTextWhenHovering");

  // ═══════════════════════════════════════════════════════════════
  // Step 1: 配置 replaceOriginal 模式
  // ═══════════════════════════════════════════════════════════════
  console.log("[replace-original] Step 1: Configuring replaceOriginal mode...");

  const apiBase = mockServerConfig?.openRouterApiBase || "http://localhost:8788";
  // #94: 哨兵色——replaceOriginal 模式的负向检查必须与具体色值无关：场景内显式写入
  // 哨兵色，断言译文 computed 色 ≠ 哨兵色（旧检查硬编码「旧默认绿 11,112,33」，
  // 默认色改蓝后永不命中 = 静默失明）。showOriginal 置 yes：encapsulateTextNode
  // 的 <font> 是该模式下 applyTranslatedColorToNode 唯一可染色目标，关闭则负向
  // 检查对该缺陷恒不可见（假绿）。
  const GOOGLE_SENTINEL = "#ff00ff";
  const AI_SENTINEL = "#00ff00";
  await serviceWorker.evaluate(async (config) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguages: ["fr", "en", "es"],
      whereToDisplayTranslatedText: "replaceOriginal",
      translateDynamicallyCreatedContent: "yes",
      translatedColor: config.googleSentinel,
      aiTranslatedColor: config.aiSentinel,
      showOriginalTextWhenHovering: "yes",
      // AI 配置（用于 Step 4）
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: config.apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      aiImproveForLongerThan: 0,
    });
  }, { apiBase, googleSentinel: GOOGLE_SENTINEL, aiSentinel: AI_SENTINEL });

  // 验证配置写入成功（哨兵色未生效 = 负向检查失效，硬失败）
  const storedMode = await readStorage(serviceWorker, "whereToDisplayTranslatedText");
  if (storedMode !== "replaceOriginal") {
    throw new Error(`[replace-original] Config not set. Expected "replaceOriginal", got "${storedMode}"`);
  }
  const storedSentinel = await readStorage(serviceWorker, "translatedColor");
  if (storedSentinel !== GOOGLE_SENTINEL) {
    throw new Error(`[replace-original] 哨兵色未写入（translatedColor=${storedSentinel}）——负向检查前提被破坏`);
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

  const colorViolations = [];

  // 译文颜色规则（#94 哨兵版）：replaceOriginal 模式 → 译文颜色为原文颜色
  // （不得应用"谷歌译文颜色"/"AI 译文颜色"）。检查与具体色值无关：
  // 场景已写入哨兵色，任何译文 computed 色 == 哨兵色即违规。
  // 旧实现硬编码「旧默认绿 11,112,33」——默认色改为色板蓝后该检查永不命中（静默失明）。
  const colorState = await page.evaluate(() => {
    const sentinelRgb = "rgb(255, 0, 255)"; // #ff00ff
    const containers = Array.from(document.querySelectorAll(".dualtran-result-container"));
    const colored = [];
    for (const c of containers) {
      // 容器自身 + 其后代（encapsulateTextNode 的 <font> 在容器内）
      for (const el of [c, ...c.querySelectorAll("*")]) {
        if (getComputedStyle(el).color === sentinelRgb) {
          colored.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(/\s+/)[0] : ""}`);
        }
      }
    }
    return {
      hasContainer: containers.length > 0,
      sentinelLeaks: colored.slice(0, 5),
      sentinelLeakCount: colored.length,
      bodyTextSample: (document.body.innerText || "").substring(0, 60),
    };
  });
  console.log(`[replace-original] Step 2 color check: container=${colorState.hasContainer}, sentinelLeaks=${colorState.sentinelLeakCount}`);
  if (!colorState.hasContainer) {
    throw new Error("[replace-original] Step 2: 未找到 .dualtran-result-container——颜色负向检查前提被破坏");
  }
  if (colorState.sentinelLeakCount > 0) {
    colorViolations.push(
      `Step 2 Google 侧：replaceOriginal 模式下译文不应应用"谷歌译文颜色"（translatedColor），实际泄漏哨兵色 ${colorState.sentinelLeaks.join(", ")}`
    );
  }

  // #94 AI 侧负向检查（模式对称性）：AI 译文同样不得应用"AI 译文颜色"哨兵。
  // Step 4 已产生 AI 内容后由同一哨兵断言覆盖（见下方 aiSentinel 检查）。

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

    // #94 AI 侧负向检查：AI 译文（哨兵 = #00ff00）同样不得在 replaceOriginal 模式下
    // 被染色（applyAiTranslatedTextColor 的 data-dualtran-block 守卫，模式对称性）。
    const aiColorLeak = await page.evaluate(() => {
      const sentinelRgb = "rgb(0, 255, 0)"; // #00ff00
      const spans = Array.from(document.querySelectorAll(".dualtran-aitranslatedtext-replacemode"));
      const leaked = spans.filter((s) => getComputedStyle(s).color === sentinelRgb);
      return { total: spans.length, leaked: leaked.length };
    });
    if (aiColorLeak.total === 0) {
      throw new Error("[replace-original] Step 4: 未找到 AI 译文 span——AI 侧颜色负向检查前提被破坏");
    }
    if (aiColorLeak.leaked > 0) {
      colorViolations.push(
        `Step 4 AI 侧：AI 译文不应应用"AI 译文颜色"（aiTranslatedColor），实际 ${aiColorLeak.leaked}/${aiColorLeak.total} 个 AI span 泄漏哨兵色`
      );
    } else {
      console.log(`[replace-original] Step 4: AI 侧哨兵检查通过（${aiColorLeak.total} spans, 0 泄漏）✓`);
    }

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

  // #94: 场景收尾——哨兵色/前置配置恢复为场景开始前的值（防泄漏进后续场景）。
  // storage 原位恢复：初始为 null（键不存在）→ 移除；否则写回原值。
  for (const [key, original] of [
    ["translatedColor", initialTranslatedColor],
    ["aiTranslatedColor", initialAiTranslatedColor],
    ["showOriginalTextWhenHovering", initialShowOriginal],
  ]) {
    if (original === null || original === undefined) {
      await serviceWorker.evaluate(async (k) => {
        await chrome.storage.local.remove(k);
      }, key);
    } else {
      await writeStorage(serviceWorker, key, original);
    }
  }

  // #94 汇总抛出（两侧检查全部完成后）——收尾恢复已执行再抛出，确保清理必定发生。
  if (colorViolations.length > 0) {
    throw new Error(
      `[replace-original] #94 译文颜色违规（${colorViolations.length} 项）：\n  - ` + colorViolations.join("\n  - ")
    );
  }

  console.log("[replace-original] All steps completed ✓");
}
