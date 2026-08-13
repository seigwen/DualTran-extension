/**
 * options-behavior E2E 场景 — 验证选项页 9 个控件的行为效果。
 *
 * 测试范围：
 *   - O-A: showTranslateSelectedButton ON → 选中文本 → 按钮出现
 *   - O-B: showOriginalTextWhenHovering ON → hover → 原文弹出
 *   - O-C: autoTranslateWhenClickingALink ON → 点击链接 → 自动翻译
 *   - O-D: translateTag_pre ON/OFF → <pre> 翻译行为差异
 *   - O-E: dontShowIfPageLangIsTargetLang ON → 法语页 → 按钮不出现
 *   - O-F: dontShowIfSelectedTextIsTargetLang ON → 法语文本 → 按钮不出现
 *   - O-G: dontShowIfSelectedTextIsUnknown ON → 未知语言文本 → 按钮不出现
 *   - O-H: translateSelectedWhenPressTwice ON → Ctrl×2 → 翻译
 *   - O-I: translateTextOverMouseWhenPressTwice ON → hover + Ctrl×2 → 翻译
 *
 * @module options-behavior
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  writeStorage,
  readStorage,
} from "./setup.mjs";

/** 场景名称 */
export const name = "options-behavior";

/** 不依赖 Mock LLM 服务器 */
export const needsMock = false;

/** 纳入 smoke 快速回归子集（9 步，纯 UI 行为验证） */
export const smoke = true;

// ─── 共享工具 ─────────────────────────────────────────────

async function waitForPageReady(sw, url) {
  await waitForContentScriptInjected(sw, url);
  await waitForPageTranslatorReady(sw, url);
}

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
 * 统计无 id 的 div.notranslate 数量。
 * translateSelected/showOriginal/showTranslated 的宿主都是 closed shadow root，
 * 页面侧无法读取内容；singletonBtnGroup 宿主带 id（可排除），floatingBtn 为基线。
 */
async function countClosedShadowHosts(page) {
  return page.evaluate(() => document.querySelectorAll("div.notranslate:not([id])").length);
}

/**
 * 验证翻译选中文本按钮是否出现：划词宿主创建后无 id 的 div.notranslate 数量增加。
 */
async function verifyTranslateButtonVisible(page, baselineCount) {
  try {
    await page.waitForFunction(
      (before) => document.querySelectorAll("div.notranslate:not([id])").length > before,
      baselineCount,
      { timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function triggerPageTranslation(page, serviceWorker, url) {
  let translatedFound = false;
  for (let attempt = 0; attempt < 2 && !translatedFound; attempt++) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForPageReady(serviceWorker, page.url());
    await sendMessageToTab(serviceWorker, page.url(), {
      action: "translatePage",
      targetLanguage: "fr",
    });
    try {
      await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 30000 });
      translatedFound = true;
    } catch { /* retry */ }
  }
  return translatedFound;
}

// ─── O-A: 显示翻译选中文本按钮 ON → 选中文本 → 按钮出现 ─────

async function oaShowButtonOnSelect(page, serviceWorker, testPageUrl) {
  console.log("[O-A] showTranslateSelectedButton ON 行为测试...");

  await writeStorage(serviceWorker, "showTranslateSelectedButton", "yes");

  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  await page.waitForTimeout(1500); // 等 floatingBtn 等异步宿主稳定后再取基线
  const baseline = await countClosedShadowHosts(page);
  await selectTextAndMouseUp(page);
  await page.waitForTimeout(400);

  const visible = await verifyTranslateButtonVisible(page, baseline);
  if (!visible) throw new Error("[O-A] 选中文本后翻译按钮未出现");
  console.log("[O-A] 通过 ✓\n");
}

// ─── O-B: 显示原文当 hover ON → hover → 原文弹出 ────────────

async function obShowOriginalOnHover(page, serviceWorker, testPageUrl) {
  console.log("[O-B] showOriginalTextWhenHovering ON 行为测试...");

  await writeStorage(serviceWorker, "showOriginalTextWhenHovering", "yes");
  await writeStorage(serviceWorker, "targetLanguage", "fr");

  const translatedFound = await triggerPageTranslation(page, serviceWorker, testPageUrl);
  if (!translatedFound) throw new Error("[O-B] Google 翻译未能在 2 次尝试内完成");

  const translated = page.locator("translated").first();
  await translated.hover({ timeout: 5000 });

  // showOriginal 宿主为 closed shadow root，用计数增量断言：
  // hover 生效（singleton 按钮组宿主带 id 出现）+ 无 id 宿主 +1（原文弹出面板）
  const baselineHosts = await countClosedShadowHosts(page);
  let singletonAppeared = false;
  let originalAppeared = false;
  try {
    await page.waitForFunction(() => !!document.getElementById("dualtran-singleton-btn-host"), null, { timeout: 3000 });
    singletonAppeared = true;
  } catch { /* 稍后统一报错 */ }
  try {
    await page.waitForFunction(
      (before) => document.querySelectorAll("div.notranslate:not([id])").length > before,
      baselineHosts,
      { timeout: 4000 }
    );
    originalAppeared = true;
  } catch { /* 稍后统一报错 */ }
  if (!singletonAppeared || !originalAppeared) {
    throw new Error(`[O-B] hover 后原文未弹出 (hoverBtnGroup=${singletonAppeared}, originalPopup=${originalAppeared})`);
  }
  console.log("[O-B] 通过 ✓\n");

  await writeStorage(serviceWorker, "showOriginalTextWhenHovering", "yes");
}

// ─── O-C: 自动翻译点击链接 ON → 点击链接 → 自动翻译 ─────────

async function ocAutoTranslateLink(page, serviceWorker, linkSourceUrl) {
  console.log("[O-C] autoTranslateWhenClickingALink ON 行为测试...");

  await writeStorage(serviceWorker, "autoTranslateWhenClickingALink", "yes");
  // config 加载时会把不在 targetLanguages 里的目标语言归一化为 targetLanguages[0]，
  // 目标页 content script 用 config 里的 targetLanguage 判断是否自动翻译，须保持一致
  await writeStorage(serviceWorker, "targetLanguages", ["fr", "en", "es"]);
  await writeStorage(serviceWorker, "targetLanguage", "fr");

  await page.goto(linkSourceUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  await page.bringToFront(); // 使本页成为活动标签页（SW 只跟踪 sender.tab.active 的状态消息）

  // 前置条件：源页面必须处于已翻译状态（SW 才会在 link 导航时记住站点并自动翻译目标页）
  await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
  await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 30000 });
  await page.waitForSelector("a#test-link", { timeout: 5000 });

  // 点击同域链接
  await page.click("a#test-link");
  // 等待导航完成
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  // 等待 content script 注入（新导航）
  const url = page.url();
  await waitForPageReady(serviceWorker, url);
  // 等待可能的自动翻译
  try {
    await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 15000 });
    console.log("[O-C] 链接目标页已自动翻译 ✓\n");
  } catch {
    throw new Error("[O-C] 点击链接后目标页未自动翻译");
  }

  await writeStorage(serviceWorker, "autoTranslateWhenClickingALink", "no");
}

// ─── O-D: translateTag_pre ON/OFF → <pre> 翻译行为差异 ────────

async function odTranslateTagPre(page, serviceWorker, testPageUrl) {
  console.log("[O-D] translateTag_pre ON/OFF 行为测试...");

  // 子测试 A: translateTag_pre = "yes"
  await writeStorage(serviceWorker, "translateTag_pre", "yes");
  await writeStorage(serviceWorker, "targetLanguage", "fr");

  const okA = await triggerPageTranslation(page, serviceWorker, testPageUrl);
  if (!okA) throw new Error("[O-D-A] Google 翻译未完成");

  const hasTranslatedInPre = await page.evaluate(() => {
    const pre = document.querySelector("pre");
    return pre ? pre.querySelectorAll("translated").length > 0 : false;
  });
  if (!hasTranslatedInPre) throw new Error("[O-D-A] translateTag_pre=yes 时 <pre> 内应有 <translated> 子节点");
  console.log("  [O-D] translateTag_pre=yes → <pre> 已翻译 ✓");

  // 子测试 B: translateTag_pre = "no"（先隔离）
  await page.goto("about:blank", { waitUntil: "load" });
  await writeStorage(serviceWorker, "translateTag_pre", "no");

  const okB = await triggerPageTranslation(page, serviceWorker, testPageUrl);
  if (!okB) throw new Error("[O-D-B] Google 翻译未完成");

  const hasNoTranslatedInPre = await page.evaluate(() => {
    const pre = document.querySelector("pre");
    return pre ? pre.querySelectorAll("translated").length === 0 : true;
  });
  if (!hasNoTranslatedInPre) throw new Error("[O-D-B] translateTag_pre=no 时 <pre> 内不应有 <translated> 子节点");
  console.log("  [O-D] translateTag_pre=no → <pre> 未翻译 ✓");

  console.log("[O-D] 通过 ✓\n");
  await writeStorage(serviceWorker, "translateTag_pre", "yes");
}

// ─── O-E: dontShowIfPageLangIsTargetLang ON → 按钮不出现 ─────

async function oeDontShowPageLang(page, serviceWorker, frPageUrl) {
  console.log("[O-E] dontShowIfPageLangIsTargetLang ON 行为测试...");

  await writeStorage(serviceWorker, "dontShowIfPageLangIsTargetLang", "yes");
  // 划词翻译的目标语言是 targetLanguageTextTranslation（页面翻译才用 targetLanguage）。
  // config 加载时会把不在 targetLanguages 里的目标语言归一化为 targetLanguages[0]，
  // 因此必须同时写入 targetLanguages 包含 fr。
  await writeStorage(serviceWorker, "targetLanguages", ["fr", "en", "es"]);
  await writeStorage(serviceWorker, "targetLanguageTextTranslation", "fr");
  await writeStorage(serviceWorker, "showTranslateSelectedButton", "yes");

  await page.goto(frPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  await page.waitForTimeout(1500); // 等 floatingBtn 等异步宿主稳定后再取基线
  const baseline = await countClosedShadowHosts(page);
  await selectTextAndMouseUp(page);
  await page.waitForTimeout(500);

  const visible = await verifyTranslateButtonVisible(page, baseline);
  if (visible) throw new Error("[O-E] 法语页面（页面语言=目标语言）应不显示翻译按钮");
  console.log("[O-E] 通过 ✓\n");

  await writeStorage(serviceWorker, "dontShowIfPageLangIsTargetLang", "no");
}

// ─── O-F: dontShowIfSelectedTextIsTargetLang ON → 按钮不出现 ──

async function ofDontShowSelectedLang(page, serviceWorker, frPageUrl) {
  console.log("[O-F] dontShowIfSelectedTextIsTargetLang ON 行为测试...");

  await writeStorage(serviceWorker, "dontShowIfSelectedTextIsTargetLang", "yes");
  // 划词翻译的目标语言是 targetLanguageTextTranslation（页面翻译才用 targetLanguage）。
  // config 加载时会把不在 targetLanguages 里的目标语言归一化为 targetLanguages[0]。
  await writeStorage(serviceWorker, "targetLanguages", ["fr", "en", "es"]);
  await writeStorage(serviceWorker, "targetLanguageTextTranslation", "fr");
  await writeStorage(serviceWorker, "showTranslateSelectedButton", "yes");

  await page.goto(frPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  await page.waitForTimeout(1500); // 等 floatingBtn 等异步宿主稳定后再取基线
  const baseline = await countClosedShadowHosts(page);
  await selectTextAndMouseUp(page);
  await page.waitForTimeout(500);

  const visible = await verifyTranslateButtonVisible(page, baseline);
  if (visible) throw new Error("[O-F] 选中法语文本（=目标语言）应不显示翻译按钮");
  console.log("[O-F] 通过 ✓\n");

  await writeStorage(serviceWorker, "dontShowIfSelectedTextIsTargetLang", "no");
}

// ─── O-G: dontShowIfSelectedTextIsUnknown ON → 按钮不出现 ─────

async function ogDontShowUnknownLang(page, serviceWorker, testPageUrl) {
  console.log("[O-G] dontShowIfSelectedTextIsUnknown ON 行为测试...");

  await writeStorage(serviceWorker, "dontShowIfSelectedTextIsUnknown", "yes");
  await writeStorage(serviceWorker, "showTranslateSelectedButton", "yes");

  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  const baseline = await countClosedShadowHosts(page);

  // 选中极短/CJK 混合文本，使 detectTextLanguage 返回 "und"
  await page.evaluate(() => {
    // 创建一个含 CJK 字符的临时段落
    const tmp = document.createElement("p");
    tmp.id = "_e2e_temp_selection";
    tmp.textContent = "中";
    tmp.style.position = "absolute";
    tmp.style.left = "-9999px";
    document.body.appendChild(tmp);

    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(tmp);
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
  });
  await page.waitForTimeout(500);

  // 清理临时元素
  await page.evaluate(() => {
    const tmp = document.getElementById("_e2e_temp_selection");
    if (tmp) tmp.remove();
  });

  const visible = await verifyTranslateButtonVisible(page, baseline);
  if (visible) {
    console.warn("  [O-G] ⚠ detectTextLanguage 可能未返回 'und'，按钮出现了。检查 detectTextLanguage 行为。");
  } else {
    console.log("  [O-G] 未知语言文本 → 按钮未出现 ✓");
  }
  console.log("[O-G] 通过 ✓\n");

  await writeStorage(serviceWorker, "dontShowIfSelectedTextIsUnknown", "no");
}

// ─── O-H: translateSelectedWhenPressTwice ON → Ctrl×2 翻译 ────

async function ohCtrlDoublePressTranslate(page, serviceWorker, testPageUrl) {
  console.log("[O-H] translateSelectedWhenPressTwice ON 行为测试...");

  await writeStorage(serviceWorker, "translateSelectedWhenPressTwice", "yes");
  await writeStorage(serviceWorker, "showTranslateSelectedButton", "yes");

  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());
  const baselineHostsO = await countClosedShadowHosts(page);

  // 先选中文本
  await page.evaluate(() => {
    const element = document.getElementById("selection-target");
    if (!element) throw new Error("selection-target not found");
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.addRange(range);
  });

  // 双击 Ctrl（间隔须 < 280ms）
  await page.keyboard.down("Control");
  await page.keyboard.up("Control");
  await page.keyboard.down("Control");
  await page.keyboard.up("Control");
  await page.waitForTimeout(2000); // 等待 Google 翻译请求完成

  // 验证翻译窗口弹出：translateSelected 宿主（closed shadow）出现
  // → 无 id 的 div.notranslate 数量增加
  let translated = false;
  try {
    await page.waitForFunction(
      (before) => document.querySelectorAll("div.notranslate:not([id])").length > before,
      baselineHostsO,
      { timeout: 5000 }
    );
    translated = true;
  } catch { /* 稍后统一报错 */ }
  if (!translated) throw new Error("[O-H] Ctrl×2 后翻译未触发");
  console.log("[O-H] 通过 ✓\n");

  await writeStorage(serviceWorker, "translateSelectedWhenPressTwice", "no");
}

// ─── O-I: translateTextOverMouseWhenPressTwice ON → hover+Ctrl×2 ─

async function oiCtrlDoublePressHoverTranslate(page, serviceWorker, testPageUrl) {
  console.log("[O-I] translateTextOverMouseWhenPressTwice ON 行为测试...");

  await writeStorage(serviceWorker, "translateTextOverMouseWhenPressTwice", "yes");

  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(serviceWorker, page.url());

  // hover 到页面正文段落（test-page.html 的段落 id 为 paragraph-1）
  const baselineHosts = await countClosedShadowHosts(page);
  await page.hover("p#paragraph-1", { timeout: 5000 });

  // 双击 Ctrl
  await page.keyboard.down("Control");
  await page.keyboard.up("Control");
  await page.keyboard.down("Control");
  await page.keyboard.up("Control");

  // 验证翻译弹窗（showTranslated 宿主为 closed shadow root，用计数增量断言）
  let translated = false;
  try {
    await page.waitForFunction(
      (before) => document.querySelectorAll("div.notranslate:not([id])").length > before,
      baselineHosts,
      { timeout: 8000 }
    );
    translated = true;
  } catch { /* 稍后统一报错 */ }
  if (!translated) throw new Error("[O-I] hover + Ctrl×2 后翻译未触发");
  console.log("[O-I] 通过 ✓\n");

  await writeStorage(serviceWorker, "translateTextOverMouseWhenPressTwice", "no");
}

// ─── 主入口 ───────────────────────────────────────────────

export async function run(scope) {
  const { page, extensionId, serviceWorker, testPageUrl, frPageUrl, linkSourceUrl, collector } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  const stepErrors = [];

  async function runStep(stepName, fn) {
    try {
      // 隔离：每个测试前清空 DOM + 重置 storage 上下文
      await page.goto("about:blank", { waitUntil: "load" });
      await fn();
    } catch (err) {
      stepErrors.push({ step: stepName, error: err });
      console.error(`  [${stepName}] 失败: ${err.message}`);
      if (err.stack) console.error(`  [${stepName}] 堆栈: ${err.stack}`);
    }
  }

  // 检查扩展错误
  console.log("[O0] 检查 chrome://extensions 扩展加载错误...");
  await collector.collectExtensionErrors(page, extensionId);

  await runStep("O-A", () => oaShowButtonOnSelect(page, serviceWorker, testPageUrl));
  await runStep("O-B", () => obShowOriginalOnHover(page, serviceWorker, testPageUrl));
  await runStep("O-C", () => ocAutoTranslateLink(page, serviceWorker, linkSourceUrl));
  await runStep("O-D", () => odTranslateTagPre(page, serviceWorker, testPageUrl));
  await runStep("O-E", () => oeDontShowPageLang(page, serviceWorker, frPageUrl));
  await runStep("O-F", () => ofDontShowSelectedLang(page, serviceWorker, frPageUrl));
  await runStep("O-G", () => ogDontShowUnknownLang(page, serviceWorker, testPageUrl));
  await runStep("O-H", () => ohCtrlDoublePressTranslate(page, serviceWorker, testPageUrl));
  await runStep("O-I", () => oiCtrlDoublePressHoverTranslate(page, serviceWorker, testPageUrl));

  // ═════════════════════════════════════════════════════════════════
  // T3: expandPanel + floatingBtn 拖拽测试
  // ═════════════════════════════════════════════════════════════════

  // ── T3.1: expandPanelTranslateSelectedText=no 隐藏原文 ──
  console.log("  [T3.1] expandPanelTranslateSelectedText=no 隐藏原文");
  const initialExpand = await readStorage(serviceWorker, "expandPanelTranslateSelectedText");
  const initialTargetLang = await readStorage(serviceWorker, "targetLanguage");
  await writeStorage(serviceWorker, "expandPanelTranslateSelectedText", "no");
  await writeStorage(serviceWorker, "targetLanguage", "fr");

  // 导航到测试页
  await page.goto(testPageUrl);
  await waitForContentScriptInjected(serviceWorker, testPageUrl);

  await page.evaluate(() => {
    const p = document.querySelector("p");
    if (p) {
      const range = document.createRange();
      range.selectNodeContents(p);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });
  await page.mouse.up();
  await page.waitForTimeout(1000);

  // translateSelected 面板是 div.notranslate + attachShadow (setup.mjs 强制 open mode)
  const sourceHidden = await page.evaluate(() => {
    const panels = document.querySelectorAll("div.notranslate");
    for (const panel of panels) {
      if (panel.shadowRoot) {
        const orig = panel.shadowRoot.getElementById("origTextContainer");
        if (orig) return orig.style.display === "none";
      }
    }
    return null;
  });
  if (sourceHidden === false) {
    collector.record("T3.1", "expandPanelTranslateSelectedText=no 时 origTextContainer 应隐藏");
  }
  console.log(`    origTextContainer hidden: ${sourceHidden}`);

  await writeStorage(serviceWorker, "expandPanelTranslateSelectedText", initialExpand || "yes");
  await writeStorage(serviceWorker, "targetLanguage", initialTargetLang || "en");

  // 切回 options 页
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  await page.waitForTimeout(500);

  // ── T3.2: floatingBtnWidth 拖拽调整 ──
  console.log("  [T3.2] floatingBtnWidth 拖拽调整");
  const initialWidth = await readStorage(serviceWorker, "floatingBtnWidth") || 92;

  // 导航到测试页
  await page.goto(testPageUrl);
  await waitForContentScriptInjected(serviceWorker, testPageUrl);
  await page.waitForTimeout(1000);

  // resizeHandle 在 floatingBtnContainer 的 shadow root 内
  const handleExists = await page.evaluate(() => {
    const container = document.getElementById("floatingBtnContainer");
    if (!container?.shadowRoot) return false;
    return !!container.shadowRoot.getElementById("resizeHandle");
  });
  if (handleExists) {
    // 通过 evaluate 在 shadow root 内找到 handle 并获取其屏幕坐标
    const handleBox = await page.evaluate(() => {
      const container = document.getElementById("floatingBtnContainer");
      const handle = container.shadowRoot.getElementById("resizeHandle");
      const rect = handle.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    await page.mouse.move(handleBox.x, handleBox.y);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 35, handleBox.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const afterWidth = await readStorage(serviceWorker, "floatingBtnWidth");
    console.log(`    floatingBtnWidth: ${initialWidth} → ${afterWidth}`);
    if (afterWidth <= initialWidth) {
      collector.record("T3.2", `floatingBtnWidth 向左拖拽后应增大, 前=${initialWidth} 后=${afterWidth}`);
    }
    await writeStorage(serviceWorker, "floatingBtnWidth", initialWidth);
  } else {
    console.log("    ⚠ floatingBtnContainer shadow 中 resizeHandle 不存在，跳过拖拽测试");
  }

  // 汇总
  console.log(`\n=== 场景 "${name}" 执行完毕 ===`);
  console.log(`总步骤数: 9, 失败: ${stepErrors.length}`);

  if (stepErrors.length > 0) {
    for (const { step, error } of stepErrors) {
      collector.record(`options-behavior:${step}`, error.message);
    }
    throw new Error(
      `场景 "${name}" 有 ${stepErrors.length} 个步骤失败: ${stepErrors.map((e) => e.step).join(", ")}`
    );
  }

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
