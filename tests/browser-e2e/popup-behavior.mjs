/**
 * popup-behavior E2E 场景 — 验证弹出页 4 个控件的行为效果。
 *
 * 测试范围：
 *   - P-A: showTranslateSelectedButton ON → 选中文本 → 按钮出现
 *   - P-B: showOriginalTextWhenHovering ON → hover 译文 → 原文弹出
 *   - P-C: sitesToTranslateWhenHovering → hover → 翻译弹出
 *   - P-D: langsToTranslateWhenHovering → hover → 翻译弹出
 *
 * @module popup-behavior
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  writeStorage,
} from "./setup.mjs";

/** 场景名称 */
export const name = "popup-behavior";

/** 不依赖 Mock LLM 服务器 */
export const needsMock = false;

/** 纳入 smoke 快速回归子集（4 步，纯 UI 行为验证） */
export const smoke = true;

// ─── 共享工具 ─────────────────────────────────────────────

/**
 * 等待 content script 注入和翻译器完全就绪。
 * @param {import("playwright").Worker} sw
 * @param {string} url
 * @returns {Promise<void>}
 */
async function waitForPageReady(sw, url) {
  await waitForContentScriptInjected(sw, url);
  await waitForPageTranslatorReady(sw, url);
}

/**
 * 选中测试页中的 #selection-target 元素并触发 mouseup 事件。
 * 用于触发 translateSelected.js 的 onMouseup → onUp 流程。
 * @param {import("playwright").Page} page
 * @returns {Promise<void>}
 */
async function selectTextAndMouseUp(page) {
  await page.evaluate(() => {
    const element = document.getElementById("selection-target");
    if (!element) throw new Error("selection-target not found");
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 200, clientY: 260 }));
  });
}

/**
 * 验证翻译选中文本按钮是否出现。
 *
 * translateSelected.js 的宿主 div 使用 closed shadow root（mode: "closed"），
 * 页面侧无法读取 host.shadowRoot。改用可观测信号：划词宿主创建后，
 * 无 id 的 div.notranslate 数量会增加（singletonBtnGroup 宿主带 id 会被排除，
 * floatingBtn 宿主为常量基线）。
 *
 * @param {import("playwright").Page} page
 * @returns {Promise<boolean>}
 */
async function verifyTranslateButtonVisible(page, baselineCount) {
  const appeared = await page
    .waitForFunction(
      (before) =>
        document.querySelectorAll("div.notranslate:not([id])").length > before,
      baselineCount,
      { timeout: 5000 }
    )
    .then(() => true)
    .catch(() => false);
  return appeared;
}

/** 统计无 id 的 div.notranslate 数量（closed shadow 宿主基线）。 */
async function countClosedShadowHosts(page) {
  return page.evaluate(() => document.querySelectorAll("div.notranslate:not([id])").length);
}

/**
 * 触发整页翻译（含 Google Translate 重试）。
 * @param {import("playwright").Page} page
 * @param {import("playwright").Worker} serviceWorker
 * @param {string} testPageUrl
 * @returns {Promise<boolean>} 翻译是否成功
 */
async function triggerPageTranslation(page, serviceWorker, testPageUrl) {
  let translatedFound = false;
  for (let attempt = 0; attempt < 2 && !translatedFound; attempt++) {
    if (attempt > 0) console.log(`  翻译重试 (${attempt + 1}/2)...`);
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForPageReady(serviceWorker, page.url());
    await sendMessageToTab(serviceWorker, page.url(), {
      action: "translatePage",
      targetLanguage: "fr",
    });
    try {
      await page.waitForFunction(
        () => document.querySelectorAll("translated").length > 0,
        null,
        { timeout: 30000 }
      );
      translatedFound = true;
    } catch {
      // 继续重试
    }
  }
  return translatedFound;
}

// ─── 测试步骤 ─────────────────────────────────────────────

/**
 * [P-A] 勾选"显示翻译选中文本按钮" → 选中文本 → 按钮出现
 */
async function paShowButtonOnSelect(page, serviceWorker, testPageUrl) {
  console.log("[P-A] showTranslateSelectedButton ON 行为测试...");

  // 设置
  await writeStorage(serviceWorker, "showTranslateSelectedButton", "yes");

  // 触发
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  const baseline = await countClosedShadowHosts(page);
  await selectTextAndMouseUp(page);
  await page.waitForTimeout(400); // > 150ms setTimeout + buffer

  // 验证（closed shadow root 无法直接读取，用宿主计数增量）
  const visible = await verifyTranslateButtonVisible(page, baseline);
  if (!visible) {
    throw new Error("[P-A] 选中文本后翻译按钮未出现");
  }
  console.log("[P-A] 通过 ✓\n");
}

/**
 * [P-B] 勾选"hover 时显示原文" → hover 译文 → 原文弹出
 */
async function pbShowOriginalOnHover(page, serviceWorker, testPageUrl) {
  console.log("[P-B] showOriginalTextWhenHovering ON 行为测试...");

  // 设置
  await writeStorage(serviceWorker, "showOriginalTextWhenHovering", "yes");
  await writeStorage(serviceWorker, "targetLanguage", "fr");

  // 触发（含 Google Translate 重试）
  const translatedFound = await triggerPageTranslation(page, serviceWorker, testPageUrl);
  if (!translatedFound) {
    throw new Error("[P-B] Google 翻译未能在 2 次尝试内完成");
  }

  // 触发 hover 到第一个 translated 元素（真实鼠标事件）
  const translated = page.locator("translated").first();
  await translated.hover({ timeout: 5000 });

  // 验证原文弹出：
  // showOriginal.js 的宿主同样是 closed shadow root，无法从页面侧读取内容。
  // 可观测信号：
  //   1) singletonBtnGroup 宿主（#dualtran-singleton-btn-host）出现，说明 hover 生效
  //   2) 无 id 的 div.notranslate 数量 +1（= showOriginal 弹出面板宿主，
  //      延迟 1500ms 后出现；floatingBtn 宿主为基线）
  const baselineHosts = await countClosedShadowHosts(page);
  let singletonAppeared = false;
  let originalAppeared = false;
  try {
    await page.waitForFunction(
      () => !!document.getElementById("dualtran-singleton-btn-host"),
      null,
      { timeout: 3000 }
    );
    singletonAppeared = true;
  } catch {
    /* hover 按钮组未出现，稍后统一报错 */
  }
  try {
    await page.waitForFunction(
      (before) =>
        document.querySelectorAll("div.notranslate:not([id])").length > before,
      baselineHosts,
      { timeout: 4000 }
    );
    originalAppeared = true;
  } catch {
    /* 原文面板未出现，稍后统一报错 */
  }
  if (!singletonAppeared || !originalAppeared) {
    throw new Error(
      `[P-B] hover 后原文未弹出 (hoverBtnGroup=${singletonAppeared}, originalPopup=${originalAppeared})`
    );
  }
  console.log("[P-B] 通过 ✓\n");

  // 清理
  await writeStorage(serviceWorker, "showOriginalTextWhenHovering", "yes");
}

/**
 * [P-C] 勾选"hover 此站点时显示翻译" → hover 触发翻译
 */
async function pcHoverSiteTranslation(page, serviceWorker, testPageUrl) {
  console.log("[P-C] sitesToTranslateWhenHovering 行为测试...");

  const hostname = new URL(testPageUrl).hostname;

  // 设置
  await writeStorage(serviceWorker, "sitesToTranslateWhenHovering", [hostname]);

  // 触发
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  // hover 到页面正文段落（test-page.html 的段落 id 为 paragraph-1）
  const baselineHosts = await countClosedShadowHosts(page);
  await page.hover("p#paragraph-1", { timeout: 5000 });

  // 验证（showTranslated.js 宿主为 closed shadow root，用计数增量断言）
  let translatedPopup = false;
  try {
    await page.waitForFunction(
      (before) =>
        document.querySelectorAll("div.notranslate:not([id])").length > before,
      baselineHosts,
      { timeout: 6000 }
    );
    translatedPopup = true;
  } catch {
    /* 稍后统一报错 */
  }
  if (!translatedPopup) {
    throw new Error("[P-C] hover 后翻译弹窗未出现");
  }
  console.log("[P-C] 通过 ✓\n");

  // 清理
  await writeStorage(serviceWorker, "sitesToTranslateWhenHovering", []);
}

/**
 * [P-D] 勾选"hover 此语言站点时显示翻译" → hover 触发翻译
 */
async function pdHoverLangTranslation(page, serviceWorker, testPageUrl) {
  console.log("[P-D] langsToTranslateWhenHovering 行为测试...");

  // 设置
  await writeStorage(serviceWorker, "langsToTranslateWhenHovering", ["en"]);

  // 触发
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  const baselineHosts = await countClosedShadowHosts(page);
  await page.hover("p#paragraph-1", { timeout: 5000 });

  // 验证（showTranslated.js 宿主为 closed shadow root，用计数增量断言）
  let translatedPopup = false;
  try {
    await page.waitForFunction(
      (before) =>
        document.querySelectorAll("div.notranslate:not([id])").length > before,
      baselineHosts,
      { timeout: 6000 }
    );
    translatedPopup = true;
  } catch {
    /* 稍后统一报错 */
  }
  if (!translatedPopup) {
    throw new Error("[P-D] hover 后翻译弹窗未出现");
  }
  console.log("[P-D] 通过 ✓\n");

  // 清理
  await writeStorage(serviceWorker, "langsToTranslateWhenHovering", []);
}

// ─── 主入口 ───────────────────────────────────────────────

export async function run(scope) {
  const { page, extensionId, serviceWorker, testPageUrl, collector } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  const stepErrors = [];

  async function runStep(stepName, fn) {
    try {
      // 隔离：每个测试前清空 DOM
      await page.goto("about:blank", { waitUntil: "load" });
      await fn();
    } catch (err) {
      stepErrors.push({ step: stepName, error: err });
      console.error(`  [${stepName}] 失败: ${err.message}`);
      if (err.stack) console.error(`  [${stepName}] 堆栈: ${err.stack}`);
    }
  }

  // 检查扩展错误
  console.log("[P0] 检查 chrome://extensions 扩展加载错误...");
  await collector.collectExtensionErrors(page, extensionId);

  await runStep("P-A", () => paShowButtonOnSelect(page, serviceWorker, testPageUrl));
  await runStep("P-B", () => pbShowOriginalOnHover(page, serviceWorker, testPageUrl));
  await runStep("P-C", () => pcHoverSiteTranslation(page, serviceWorker, testPageUrl));
  await runStep("P-D", () => pdHoverLangTranslation(page, serviceWorker, testPageUrl));

  // 汇总
  console.log(`\n=== 场景 "${name}" 执行完毕 ===`);
  console.log(`总步骤数: 4, 失败: ${stepErrors.length}`);

  if (stepErrors.length > 0) {
    for (const { step, error } of stepErrors) {
      collector.record(`popup-behavior:${step}`, error.message);
    }
    throw new Error(
      `场景 "${name}" 有 ${stepErrors.length} 个步骤失败: ${stepErrors.map((e) => e.step).join(", ")}`
    );
  }

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
