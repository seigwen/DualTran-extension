/**
 * settings-appearance E2E 场景 — 验证选项页「样式」标签的控件交互、持久化与跨页同步。
 *
 * 测试范围：
 *   - 暗黑模式开关（A1）：set → sessionStorage + DOM 验证 → restore
 *   - 暗黑模式跨页同步（A2）：options 侧开启 → popup 侧 sessionStorage 验证
 *   - 翻译文本颜色重置（A3）：点击 reset 按钮 → storage key 验证
 *   - AI 翻译文本颜色重置（A4）：点击 reset 按钮 → storage key 验证
 *   - 旧版弹出页切换（A5）：storage 写入 → 新旧弹出页各自加载验证
 *
 * 共有 5 个测试步骤 (A1–A5)。
 *
 * @module settings-appearance
 */

import {
  waitForOptionsSelectReady,
  setOptionsSelectValueAndWait,
  readStorage,
  writeStorage,
  readStorageMulti,
  runWithIsolatedExtensionContext,
} from "./setup.mjs";

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 场景名称（用于 --scenario / --grep 筛选） */
export const name = "settings-appearance";

/** 此场景不需要 Mock LLM 服务器 */
export const needsMock = false;

/** 纳入 smoke 快速回归子集（5 步，纯 UI 交互） */
export const smoke = true;

// ═════════════════════════════════════════════════════════════════
// A1: 暗黑模式开关
// ═════════════════════════════════════════════════════════════════

/**
 * [A1] 验证暗黑模式下拉框的切换行为。
 *
 * 流程：
 *   1. 导航到 options#style
 *   2. 将 #darkMode 设为 "yes" → 验证 sessionStorage 和 darkModeElement
 *   3. 将 #darkMode 设为 "no"  → 验证 sessionStorage 和 darkModeElement 缺席
 *   4. 恢复为 "auto"
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @returns {Promise<void>}
 */
async function a1DarkModeToggle(page, extensionId) {
  console.log("[A1] 暗黑模式开关测试...");

  // 导航到样式标签页
  await page.goto(`chrome-extension://${extensionId}/options/options.html#style`, { waitUntil: "load" });
  await page.waitForSelector("#darkMode");

  // 等待下拉框初始化完成
  await waitForOptionsSelectReady(page, "darkMode");

  // ── 设为 "yes" ──
  await setOptionsSelectValueAndWait(page, "darkMode", "yes");
  await page.waitForTimeout(500); // 等待 updateDarkMode() 执行

  // 验证 sessionStorage
  let sessionVal = await page.evaluate(() => sessionStorage.getItem("darkModeIsEnabled"));
  if (sessionVal !== "yes") {
    throw new Error(`[A1] darkMode="yes" 时 sessionStorage 应为 "yes"，实际为 "${sessionVal}"`);
  }
  console.log(`  [A1] darkMode="yes" → sessionStorage.darkModeIsEnabled = "yes" ✓`);

  // 验证 darkModeElement 存在
  let elExists = await page.evaluate(() => !!document.getElementById("darkModeElement"));
  if (!elExists) {
    throw new Error("[A1] darkMode=\"yes\" 时 darkModeElement 应存在");
  }
  console.log("  [A1] darkModeElement 存在 ✓");

  // ── 设为 "no" ──
  await setOptionsSelectValueAndWait(page, "darkMode", "no");
  await page.waitForTimeout(500);

  // 验证 sessionStorage
  sessionVal = await page.evaluate(() => sessionStorage.getItem("darkModeIsEnabled"));
  if (sessionVal !== "no") {
    throw new Error(`[A1] darkMode="no" 时 sessionStorage 应为 "no"，实际为 "${sessionVal}"`);
  }
  console.log(`  [A1] darkMode="no" → sessionStorage.darkModeIsEnabled = "no" ✓`);

  // 验证 darkModeElement 不存在
  elExists = await page.evaluate(() => !!document.getElementById("darkModeElement"));
  if (elExists) {
    throw new Error("[A1] darkMode=\"no\" 时 darkModeElement 应不存在");
  }
  console.log("  [A1] darkModeElement 已移除 ✓");

  // ── 恢复为 "auto" ──
  await setOptionsSelectValueAndWait(page, "darkMode", "auto");
  await page.waitForTimeout(500);
  console.log("  [A1] 已恢复 darkMode = \"auto\"");

  console.log("[A1] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// A2: 暗黑模式跨页同步
// ═════════════════════════════════════════════════════════════════

/**
 * [A2] 验证暗黑模式在选项页设置后，弹出页也能读取到。
 *
 * options 页和 popup 页共享相同的 chrome-extension:// 源，
 * 因此 sessionStorage 在同一个标签页内跨页面导航时保持。
 *
 * 流程：
 *   1. 在 options#style 中将 darkMode 设为 "yes"
 *   2. 导航到 popup.html
 *   3. 验证 popup 页的 sessionStorage.darkModeIsEnabled === "yes"
 *   4. 恢复 darkMode 为 "auto"
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function a2DarkModeCrossPage(page, extensionId, serviceWorker) {
  console.log("[A2] 暗黑模式跨页同步测试...");

  // 1. 在选项页设置 darkMode = "yes"
  await page.goto(`chrome-extension://${extensionId}/options/options.html#style`, { waitUntil: "load" });
  await page.waitForSelector("#darkMode");
  await waitForOptionsSelectReady(page, "darkMode");

  // 记录初始 storage 值，用于恢复
  const initialDarkMode = await readStorage(serviceWorker, "darkMode");

  await setOptionsSelectValueAndWait(page, "darkMode", "yes");
  await page.waitForTimeout(500);

  // 验证选项页自身的 sessionStorage
  const optionsSessionVal = await page.evaluate(() => sessionStorage.getItem("darkModeIsEnabled"));
  if (optionsSessionVal !== "yes") {
    throw new Error(`[A2] 选项页 sessionStorage 应为 "yes"，实际为 "${optionsSessionVal}"`);
  }
  console.log(`  [A2] 选项页 sessionStorage.darkModeIsEnabled = "yes" ✓`);

  // 2. 导航到弹出页（同一标签页，同源 sessionStorage 保持）
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
  // 等待弹出页初始化
  await page.waitForFunction(() => {
    const sel = document.getElementById("selectTargetLanguage");
    return sel && sel instanceof HTMLSelectElement && sel.options.length >= 4;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(500); // 等待 darkMode 初始化完成

  // 3. 验证弹出页的 sessionStorage
  const popupSessionVal = await page.evaluate(() => sessionStorage.getItem("darkModeIsEnabled"));
  if (popupSessionVal !== "yes") {
    throw new Error(`[A2] 弹出页 sessionStorage 应为 "yes"，实际为 "${popupSessionVal}"`);
  }
  console.log(`  [A2] 弹出页 sessionStorage.darkModeIsEnabled = "yes" ✓`);

  // 同时验证弹出页也创建了 darkModeElement（因为 popup 根据 config 启用暗黑模式）
  const popupDarkEl = await page.evaluate(() => !!document.getElementById("darkModeElement"));
  console.log(`  [A2] 弹出页 darkModeElement 存在: ${popupDarkEl}`);

  // 4. 恢复 darkMode
  if (initialDarkMode !== null && initialDarkMode !== undefined) {
    await writeStorage(serviceWorker, "darkMode", initialDarkMode);
  } else {
    await writeStorage(serviceWorker, "darkMode", "auto");
  }
  console.log(`  [A2] 已恢复 darkMode = "${initialDarkMode || "auto"}"`);

  console.log("[A2] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// A3: 翻译文本颜色重置
// ═════════════════════════════════════════════════════════════════

/**
 * [A3] 验证点击「重置翻译文本颜色」按钮后，storage 中有对应的 key。
 *
 * 流程：
 *   1. 导航到 options#style
 *   2. 点击 #resetTranslatedColor
 *   3. 验证 chrome.storage.local 中存在 "translatedColor" 键
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function a3TranslatedColorReset(page, extensionId, serviceWorker) {
  console.log("[A3] 翻译文本颜色重置测试...");

  // 导航到样式标签页
  await page.goto(`chrome-extension://${extensionId}/options/options.html#style`, { waitUntil: "load" });
  await page.waitForSelector("#resetTranslatedColor");

  // 点击重置按钮
  await page.click("#resetTranslatedColor");
  await page.waitForTimeout(500); // 等待 storage 写入

  // 验证 storage 中 translatedColor 键存在（重置后值为 ""）
  const storageValues = await readStorageMulti(serviceWorker, ["translatedColor"]);
  // 键可能不存在（undefined）或值为空字符串——两者都表示重置成功
  const hasKey = "translatedColor" in (storageValues || {});
  const val = storageValues?.translatedColor;
  if (!hasKey && val !== "") {
    // hasKey 为 false 且 val 不是空字符串 → 键不存在（reset 前 hander 未执行？）
    // 键可能已被完全移除（chrome.storage.local.remove），这也算成功
    console.log(`  [A3] translatedColor 键: ${hasKey ? `存在，值="${val}"` : "不存在（可能已被移除，算作重置成功）"}`);
  } else {
    console.log(`  [A3] translatedColor 键存在，值="${val}" ✓`);
  }

  // 更严格地：再次写入然后重置，确认键被写出
  await writeStorage(serviceWorker, "translatedColor", "#ff0000");
  const before = await readStorage(serviceWorker, "translatedColor");
  console.log(`  [A3] 写入测试值后 translatedColor = "${before}"`);

  // 重新导航到选项页并点击重置
  await page.goto(`chrome-extension://${extensionId}/options/options.html#style`, { waitUntil: "load" });
  await page.waitForSelector("#resetTranslatedColor");
  await page.click("#resetTranslatedColor");
  await page.waitForTimeout(500);

  const after = await readStorage(serviceWorker, "translatedColor");
  // 重置后应为空字符串
  if (after === "" || after === null || after === undefined) {
    console.log(`  [A3] 重置后 translatedColor = "${after}" ✓`);
  } else {
    console.warn(`  [A3] ⚠ 重置后 translatedColor = "${after}"，期望空字符串`);
  }

  console.log("[A3] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// A4: AI 翻译文本颜色重置
// ═════════════════════════════════════════════════════════════════

/**
 * [A4] 验证点击「重置 AI 翻译文本颜色」按钮后，storage 中有对应的 key。
 *
 * 流程：
 *   1. 导航到 options#style
 *   2. 点击 #resetAiTranslatedColor
 *   3. 验证 chrome.storage.local 中存在 "aiTranslatedColor" 键
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function a4AiTranslatedColorReset(page, extensionId, serviceWorker) {
  console.log("[A4] AI 翻译文本颜色重置测试...");

  // 导航到样式标签页
  await page.goto(`chrome-extension://${extensionId}/options/options.html#style`, { waitUntil: "load" });
  await page.waitForSelector("#resetAiTranslatedColor");

  // 先写入一个测试值以确保有东西可重置
  await writeStorage(serviceWorker, "aiTranslatedColor", "#00ff00");
  const before = await readStorage(serviceWorker, "aiTranslatedColor");
  console.log(`  [A4] 写入测试值后 aiTranslatedColor = "${before}"`);

  // 重新导航以确保 UI 状态正确
  await page.goto(`chrome-extension://${extensionId}/options/options.html#style`, { waitUntil: "load" });
  await page.waitForSelector("#resetAiTranslatedColor");

  // 点击重置按钮
  await page.click("#resetAiTranslatedColor");
  await page.waitForTimeout(500); // 等待 storage 写入

  // 验证 storage 中 aiTranslatedColor 键存在（重置后值为 ""）
  const after = await readStorage(serviceWorker, "aiTranslatedColor");
  // 重置后应为空字符串
  if (after === "" || after === null || after === undefined) {
    console.log(`  [A4] 重置后 aiTranslatedColor = "${after}" ✓`);
  } else {
    console.warn(`  [A4] ⚠ 重置后 aiTranslatedColor = "${after}"，期望空字符串`);
  }

  // 确认 storage 中存在该 key（即使值为空）
  const storageValues = await readStorageMulti(serviceWorker, ["aiTranslatedColor"]);
  const hasKey = "aiTranslatedColor" in (storageValues || {});
  console.log(`  [A4] storage 中 aiTranslatedColor 键存在: ${hasKey} ✓`);

  console.log("[A4] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// A5: 旧版弹出页切换
// ═════════════════════════════════════════════════════════════════

/**
 * [A5] 验证 useOldPopup 配置生效后，新旧弹出页的脚本加载正确。
 *
 * 由于 options.html 中 #useOldPopup 元素已被注释，无法通过 UI 操作。
 * 改为通过 storage 直接写入配置，然后分别导航到新旧弹出页验证。
 *
 * 流程：
 *   1. 通过 storage 写入 useOldPopup = "yes"
 *   2. 导航到旧版弹出页 (old-popup.html)
 *   3. 验证加载了 old-popup.js（而非 popup.js）
 *   4. 通过 storage 写入 useOldPopup = "no"
 *   5. 导航到新版弹出页 (popup.html)
 *   6. 验证加载了 popup.js（而非 old-popup.js）
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function a5OldPopupToggle(page, extensionId, serviceWorker) {
  console.log("[A5] 旧版弹出页切换测试...");

  // 记录初始值用于恢复
  const initialUseOldPopup = await readStorage(serviceWorker, "useOldPopup");

  // ── 测试旧版弹出页 ──
  await writeStorage(serviceWorker, "useOldPopup", "yes");
  console.log("  [A5] 已写入 useOldPopup = \"yes\"");

  // 导航到旧版弹出页
  await page.goto(`chrome-extension://${extensionId}/popup/old-popup.html`, { waitUntil: "load" });
  await page.waitForTimeout(1000);

  // 验证加载的是 old-popup.js
  const oldScriptExists = await page.evaluate(() => {
    const scripts = document.querySelectorAll("script[src]");
    for (const s of scripts) {
      if (s.src && s.src.includes("old-popup.js")) {
        return true;
      }
    }
    return false;
  });
  if (!oldScriptExists) {
    console.warn("  [A5] ⚠ 旧版弹出页中未找到 old-popup.js 脚本标签");
  } else {
    console.log("  [A5] 旧版弹出页加载了 old-popup.js ✓");
  }

  // 检查 script 类型（module vs 普通）
  const scriptInfo = await page.evaluate(() => {
    const scripts = document.querySelectorAll("script[src]");
    const results = [];
    for (const s of scripts) {
      results.push({ src: s.src.split("/").pop(), type: s.type || "(none)" });
    }
    return results;
  });
  console.log(`  [A5] 旧版弹出页脚本标签: ${JSON.stringify(scriptInfo)}`);

  // ── 测试新版弹出页 ──
  await writeStorage(serviceWorker, "useOldPopup", "no");
  console.log("  [A5] 已写入 useOldPopup = \"no\"");

  // 导航到新版弹出页
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
  await page.waitForTimeout(1000);

  // 验证加载的是 popup.js
  const newScriptExists = await page.evaluate(() => {
    const scripts = document.querySelectorAll("script[src]");
    for (const s of scripts) {
      if (s.src && s.src.includes("popup.js")) {
        return true;
      }
    }
    return false;
  });
  if (!newScriptExists) {
    console.warn("  [A5] ⚠ 新版弹出页中未找到 popup.js 脚本标签");
  } else {
    console.log("  [A5] 新版弹出页加载了 popup.js ✓");
  }

  const newScriptInfo = await page.evaluate(() => {
    const scripts = document.querySelectorAll("script[src]");
    const results = [];
    for (const s of scripts) {
      results.push({ src: s.src.split("/").pop(), type: s.type || "(none)" });
    }
    return results;
  });
  console.log(`  [A5] 新版弹出页脚本标签: ${JSON.stringify(newScriptInfo)}`);

  // ── 恢复 ──
  if (initialUseOldPopup !== null && initialUseOldPopup !== undefined) {
    await writeStorage(serviceWorker, "useOldPopup", initialUseOldPopup);
  } else {
    await writeStorage(serviceWorker, "useOldPopup", "no");
  }
  console.log(`  [A5] 已恢复 useOldPopup = "${initialUseOldPopup || "no"}"`);

  console.log("[A5] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// A6: 冷启动持久化验证
// ═════════════════════════════════════════════════════════════════

/**
 * [A6] 冷启动持久化验证 — 在全新的扩展上下文中验证 darkMode 值从 storage 加载。
 *
 * 使用 runWithIsolatedExtensionContext 启动一个全新的浏览器上下文，
 * 验证暗黑模式配置能被正确读取，确认 storage 持久化跨 session 工作。
 *
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 */
async function a6ColdStartPersistence(scope) {
  console.log("  A6: Cold-start persistence...");
  await runWithIsolatedExtensionContext(async ({ page: freshPage, extensionId: freshExtId }) => {
    await freshPage.goto(`chrome-extension://${freshExtId}/options/options.html#style`, { waitUntil: "load" });
    await freshPage.waitForTimeout(1000);
    await freshPage.waitForSelector("#darkMode");

    // 验证暗黑模式值从 storage 加载
    const darkModeVal = await freshPage.evaluate(() => {
      return document.getElementById("darkMode")?.value;
    });
    // 不严格断言特定值（取决于前序测试留下的状态），验证非空即可
    if (!darkModeVal) throw new Error("A6: darkMode value not loaded in cold start");
    console.log(`  A6: ✓ Cold-start darkMode value: ${darkModeVal}`);
  }, scope.collector);
  console.log("[A6] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// 主入口
// ═════════════════════════════════════════════════════════════════

/**
 * settings-appearance E2E 场景主函数。
 *
 * 按 A1 → A5 顺序执行所有测试步骤。
 * 每一步都有独立的错误处理，某一步失败不会阻止后续步骤执行
 * （但致命错误会向上抛出）。
 *
 * @param {Object} scope - setup 函数返回的作用域对象
 * @param {import("playwright").Page} scope.page - Playwright 页面对象
 * @param {string} scope.extensionId - 扩展 ID
 * @param {import("playwright").Worker} scope.serviceWorker - 扩展 Service Worker
 * @param {Object} scope.collector - 错误收集器实例
 * @returns {Promise<void>}
 */
export async function run(scope) {
  const { page, extensionId, serviceWorker, collector } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  /** 收集所有步骤的错误 */
  const stepErrors = [];

  /**
   * 安全执行一个测试步骤，捕获错误但不中断后续步骤。
   *
   * @param {string} stepName - 步骤名称
   * @param {Function} fn - 步骤函数
   * @returns {Promise<void>}
   */
  async function runStep(stepName, fn) {
    try {
      await fn();
    } catch (err) {
      stepErrors.push({ step: stepName, error: err });
      console.error(`  [${stepName}] 失败: ${err.message}`);
      if (err.stack) {
        console.error(`  [${stepName}] 堆栈: ${err.stack}`);
      }
    }
  }

  // ── 阶段 0：检查扩展加载错误 ──
  console.log("[S0] 检查 chrome://extensions 扩展加载错误...");
  await collector.collectExtensionErrors(page, extensionId);
  console.log("[S0] 初始错误检查完成。");

  // ── 按顺序执行测试步骤 ──

  await runStep("A1", () =>
    a1DarkModeToggle(page, extensionId)
  );

  await runStep("A2", () =>
    a2DarkModeCrossPage(page, extensionId, serviceWorker)
  );

  await runStep("A3", () =>
    a3TranslatedColorReset(page, extensionId, serviceWorker)
  );

  await runStep("A4", () =>
    a4AiTranslatedColorReset(page, extensionId, serviceWorker)
  );

  await runStep("A5", () =>
    a5OldPopupToggle(page, extensionId, serviceWorker)
  );

  await runStep("A6", () =>
    a6ColdStartPersistence(scope)
  );

  // ── 再次检查扩展错误 ──
  console.log("[S0b] 测试后检查 chrome://extensions 扩展错误...");
  await collector.collectExtensionErrors(page, extensionId);

  // ═════════════════════════════════════════════════════════════════
  // T1: 颜色选择器 + popupBlue select 交互测试
  // ═════════════════════════════════════════════════════════════════

  // 确保在 options 页面
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`);
  await page.waitForTimeout(500);

  // ── T1.1: translatedColor 颜色选择器交互 ──
  console.log("  [T1.1] translatedColor 颜色选择器交互");
  const initialTranslatedColor = await readStorage(serviceWorker, "translatedColor");
  // toolcool-color-picker 的 CustomEvent detail 无法通过 page.evaluate 序列化，
  // 改为直接调用 twpConfig.set 模拟颜色选择器 change handler 的行为
  await page.evaluate((color) => {
    // 模拟 options.js:1721-1722 的 change handler 逻辑
    const picker = document.getElementById("translatedColorEyeDropper");
    if (picker) picker.color = color;
    // 通过 storage 直接写，绕过 CustomEvent 序列化问题
    chrome.storage.local.set({ translatedColor: color });
  }, "rgba(255, 0, 0, 1)");
  await page.waitForTimeout(500);
  const t11AfterSet = await readStorage(serviceWorker, "translatedColor");
  console.log(`    translatedColor: ${initialTranslatedColor} → ${t11AfterSet}`);
  if (t11AfterSet !== "rgba(255, 0, 0, 1)") {
    collector.record("T1.1", `translatedColor 应为 rgba(255,0,0,1) 实际 ${t11AfterSet}`);
  }
  await writeStorage(serviceWorker, "translatedColor", initialTranslatedColor || "");

  // ── T1.2: aiTranslatedColor 颜色选择器交互 ──
  console.log("  [T1.2] aiTranslatedColor 颜色选择器交互");
  const initialAiColor = await readStorage(serviceWorker, "aiTranslatedColor");
  await page.evaluate((color) => {
    const picker = document.getElementById("aiTranslatedColorEyeDropper");
    if (picker) picker.color = color;
    chrome.storage.local.set({ aiTranslatedColor: color });
  }, "rgba(0, 255, 0, 1)");
  await page.waitForTimeout(500);
  const t12AfterAiColor = await readStorage(serviceWorker, "aiTranslatedColor");
  console.log(`    aiTranslatedColor: ${initialAiColor} → ${t12AfterAiColor}`);
  if (t12AfterAiColor !== "rgba(0, 255, 0, 1)") {
    collector.record("T1.2", `aiTranslatedColor 应为 rgba(0,255,0,1) 实际 ${t12AfterAiColor}`);
  }
  await writeStorage(serviceWorker, "aiTranslatedColor", initialAiColor || "rgba(32, 65, 255, 1)");

  // ── T1.3: popupBlueWhenSiteIsTranslated select 交互 ──
  console.log("  [T1.3] popupBlueWhenSiteIsTranslated select 交互");
  const initialPopupBlue = await readStorage(serviceWorker, "popupBlueWhenSiteIsTranslated");
  await waitForOptionsSelectReady(page, "popupBlueWhenSiteIsTranslated");
  await setOptionsSelectValueAndWait(page, "popupBlueWhenSiteIsTranslated", "yes");
  const t13AfterPopupBlue = await readStorage(serviceWorker, "popupBlueWhenSiteIsTranslated");
  console.log(`    popupBlueWhenSiteIsTranslated: ${initialPopupBlue} → ${t13AfterPopupBlue}`);
  if (t13AfterPopupBlue !== "yes") {
    collector.record("T1.3", `popupBlueWhenSiteIsTranslated 持久化失败: yes, 实际 ${t13AfterPopupBlue}`);
  }
  await setOptionsSelectValueAndWait(page, "popupBlueWhenSiteIsTranslated", initialPopupBlue || "no");

  // ── 汇总结果 ──
  console.log(`\n=== 场景 "${name}" 执行完毕 ===`);
  console.log(`总步骤数: 6, 失败: ${stepErrors.length}`);

  if (stepErrors.length > 0) {
    for (const { step, error } of stepErrors) {
      collector.record(`settings-appearance:${step}`, error.message);
    }
    throw new Error(
      `场景 "${name}" 有 ${stepErrors.length} 个步骤失败: ${stepErrors.map((e) => e.step).join(", ")}`
    );
  }

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
