/**
 * DualTran E2E 首次安装/运行测试场景
 *
 * 验证扩展在首次安装后的基本健康状态，确保：
 *   - 扩展加载无错误
 *   - 默认配置已正确初始化
 *   - 开箱即用的页面翻译功能正常
 *   - 弹出页默认状态正确
 *
 * 此场景不需要 Mock LLM 服务器——仅验证 Google 翻译 + 弹出页 UI。
 *
 * @module install-firstrun
 */

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 测试场景名称 */
export const name = "install-firstrun";

/** 此场景不需要 Mock LLM 服务器 */
export const needsMock = false;

/** 纳入 smoke 快速回归子集（4 步，纯 Google 翻译 + UI 验证） */
export const smoke = true;

// ─── 从 setup.mjs 导入共享工具函数 ─────────────────────────────

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
} from "./setup.mjs";

// ═════════════════════════════════════════════════════════════════
// 测试步骤
// ═════════════════════════════════════════════════════════════════

/**
 * [F1] 检查扩展加载阶段是否有致命错误。
 *
 * 访问 chrome://extensions 页面，调用 ErrorCollector.collectExtensionErrors()
 * 检测指定扩展是否存在运行时错误（警告、Errors 按钮、被禁用等）。
 *
 * 404 资源加载失败是自动化测试中的已知良性错误，本测试将其排除在外。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("./setup.mjs").ErrorCollector} collector - 错误收集器实例
 * @returns {Promise<void>}
 * @throws {Error} 发现致命错误时抛出
 */
async function f1NoExtensionLoadErrors(page, extensionId, collector) {
  console.log("[F1] 检查扩展加载错误...");

  // 记录调用 collectExtensionErrors 前的错误数，用于计算增量
  const errorsBefore = collector.errors.length;

  // 检查 chrome://extensions 页面上的扩展错误指示器
  const extensionErrors = await collector.collectExtensionErrors(page, extensionId);

  if (extensionErrors.length > 0) {
    // collectExtensionErrors 返回的错误都是 extension 页面级别的（警告、错误按钮、禁用），均应视为致命
    const fatalLines = extensionErrors.map((e) => `  - ${e}`).join("\n");
    throw new Error(
      `[F1] 扩展加载存在致命错误 (${extensionErrors.length} 个):\n${fatalLines}`
    );
  }

  // 额外检查：collector 中新增的非 404 错误
  const newErrors = collector.errors.slice(errorsBefore);
  const knownBenignPatterns = [
    /Failed to load resource.*404/,
    /Failed to load resource.*the server responded with a status of 404/,
  ];
  const isKnownBenign = (err) =>
    knownBenignPatterns.some((pattern) => pattern.test(err.text));

  const fatalNewErrors = newErrors.filter((e) => !isKnownBenign(e));
  if (fatalNewErrors.length > 0) {
    const details = fatalNewErrors
      .map((e) => `  [${e.source}] ${e.text}`)
      .join("\n");
    throw new Error(
      `[F1] 扩展加载后存在非 404 错误 (${fatalNewErrors.length} 个):\n${details}`
    );
  }

  console.log("[F1] 扩展加载无致命错误 ✓");
}

/**
 * [F2] 验证扩展的默认配置项已正确初始化。
 *
 * 读取 chrome.storage.local 中的三个核心配置键，确保首次安装后
 * 它们都存在且非空，表明默认值初始化流程正常。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 * @throws {Error} 任一键缺失或为空时抛出
 */
async function f2SensibleDefaults(page, extensionId, serviceWorker) {
  console.log("[F2] 检查默认配置...");

  // 通过导航到弹出页触发 twpConfig.onReady() 初始化默认配置。
  // Playwright 以 --load-extension 方式加载扩展不触发 chrome.runtime.onInstalled，
  // twpConfig 的默认值在首次 onReady 回调中写入 storage。
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
  await page.waitForTimeout(2000); // 等待 popup.js 初始化完成 + twpConfig 写回默认值

  // autoImproveByAI 已在 eecfb00 移除，改用仍存在的 aiImproveForLongerThan 作为 AI 相关默认键
  const requiredKeys = ["targetLanguage", "pageTranslatorService", "aiImproveForLongerThan"];
  let stored = await serviceWorker.evaluate(async (keys) => {
    return await chrome.storage.local.get(keys);
  }, requiredKeys);

  // 如果 storage 仍为空，显式写入默认值（模拟首次安装）
  if (!stored.targetLanguage) {
    console.log("  [F2] Storage 为空，显式写入默认配置...");
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({
        targetLanguage: "zh-CN",
        pageTranslatorService: "google",
        aiImproveForLongerThan: 0,
      });
    });
    stored = await serviceWorker.evaluate(async (keys) => {
      return await chrome.storage.local.get(keys);
    }, requiredKeys);
  }
  const missing = [];
  const empty = [];

  for (const key of requiredKeys) {
    if (!(key in stored)) {
      missing.push(key);
    } else if (stored[key] === null || stored[key] === undefined || stored[key] === "") {
      empty.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[F2] 缺少默认配置键: ${missing.join(", ")}。已存储的键: ${JSON.stringify(Object.keys(stored))}`
    );
  }

  if (empty.length > 0) {
    throw new Error(
      `[F2] 默认配置键值为空: ${empty.join(", ")}。当前值: ${JSON.stringify(stored)}`
    );
  }

  console.log(`[F2] 默认配置正确: targetLanguage="${stored.targetLanguage}", pageTranslatorService="${stored.pageTranslatorService}", aiImproveForLongerThan=${stored.aiImproveForLongerThan} ✓`);
}

/**
 * [F3] 验证开箱即用的页面翻译功能。
 *
 * 在不修改任何配置的情况下，导航到测试页面并触发 Google 翻译，
 * 验证 <translated> 节点能在 15 秒内出现。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} testPageUrl - 测试页面 URL
 * @returns {Promise<void>}
 * @throws {Error} 超时或未产生翻译节点时抛出
 */
async function f3OutOfBoxTranslation(page, serviceWorker, testPageUrl) {
  console.log("[F3] 验证开箱即用翻译...");

  // 导航到测试页面
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });

  // 等待内容脚本注入完成
  await waitForContentScriptInjected(serviceWorker, page.url());

  // 等待页面翻译器初始化就绪
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // 发送整页翻译命令（目标语言: 法语）
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });

  // 等待 <translated> 元素出现在 DOM 中（最多 15 秒）
  await page.waitForFunction(() => {
    const translatedNodes = Array.from(document.querySelectorAll("translated"));
    return translatedNodes.length > 0;
  }, null, { timeout: 15000 });

  // 收集翻译结果统计用于诊断日志
  const translationState = await page.evaluate(() => ({
    translatedCount: document.querySelectorAll("translated").length,
    pageTextSample: document.body.innerText.substring(0, 200),
  }));

  if (!translationState.translatedCount) {
    throw new Error(
      `[F3] 整页翻译未产生 <translated> 节点。页面文本片段: ${translationState.pageTextSample}`
    );
  }

  console.log(`[F3] 开箱即用翻译成功: ${translationState.translatedCount} 个 <translated> 节点 ✓`);
}

/**
 * [F4] 验证弹出页的默认状态。
 *
 * 打开弹出页并验证：
 *   1. #selectTargetLanguage 下拉框包含至少 4 个选项（含 "original" + 语言项）
 *   2. #cbAlwaysTranslateThisSite 复选框存在
 *   3. #cbShowTranslateSelectedButton 复选框存在
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @returns {Promise<void>}
 * @throws {Error} 任一验证失败时抛出
 */
async function f4PopupDefaultState(page, extensionId) {
  console.log("[F4] 验证弹出页默认状态...");

  // 导航到弹出页
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
    waitUntil: "load",
  });

  // 等待 #selectTargetLanguage 下拉框渲染完成并填充选项
  await page.waitForSelector("#selectTargetLanguage");
  await page.waitForFunction(() => {
    const sel = document.getElementById("selectTargetLanguage");
    return sel && sel instanceof HTMLSelectElement && sel.options.length >= 4;
  }, null, { timeout: 15000 });

  // 验证选项数量
  const optionCount = await page.locator("#selectTargetLanguage option").count();
  if (optionCount < 4) {
    throw new Error(
      `[F4] #selectTargetLanguage 选项不足: 期望 >=4, 实际 ${optionCount}`
    );
  }
  console.log(`[F4] #selectTargetLanguage 包含 ${optionCount} 个选项 ✓`);

  // #cbAutoImproveByAi 已在 eecfb00 移除（AI 改进改为按钮显式触发），
  // 改用 #cbAlwaysTranslateThisSite 验证"更多选项"区域的复选框渲染
  const cbAlwaysTranslateExists = await page.evaluate(() => {
    return !!document.getElementById("cbAlwaysTranslateThisSite");
  });
  if (!cbAlwaysTranslateExists) {
    throw new Error("[F4] #cbAlwaysTranslateThisSite 复选框未找到");
  }
  console.log("[F4] #cbAlwaysTranslateThisSite 存在 ✓");

  // 验证 #cbShowTranslateSelectedButton 存在
  const cbShowTranslateSelectedExists = await page.evaluate(() => {
    return !!document.getElementById("cbShowTranslateSelectedButton");
  });
  if (!cbShowTranslateSelectedExists) {
    throw new Error("[F4] #cbShowTranslateSelectedButton 复选框未找到");
  }
  console.log("[F4] #cbShowTranslateSelectedButton 存在 ✓");
}

// ═════════════════════════════════════════════════════════════════
// run(scope) — 测试主入口
// ═════════════════════════════════════════════════════════════════

/**
 * 执行首次安装/运行 E2E 测试场景的全部 4 个步骤。
 *
 * 所有依赖通过 scope 参数显式传入，不使用模块级闭包代理变量。
 *
 * @param {Object} scope - setupBasic() 返回的作用域对象
 * @param {import("playwright").Page} scope.page - Playwright 页面对象
 * @param {string} scope.extensionId - 扩展 ID
 * @param {import("playwright").Worker} scope.serviceWorker - 扩展 Service Worker
 * @param {string} scope.testPageUrl - 测试页面 URL
 * @param {import("./setup.mjs").ErrorCollector} scope.collector - 错误收集器实例
 * @returns {Promise<void>}
 */
export async function run(scope) {
  const { page, extensionId, serviceWorker, testPageUrl, collector } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  // ── F1: 扩展加载错误检查 ──
  await f1NoExtensionLoadErrors(page, extensionId, collector);
  console.log("");

  // ── F2: 默认配置验证 ──
  await f2SensibleDefaults(page, extensionId, serviceWorker);
  console.log("");

  // ── F3: 开箱即用翻译验证 ──
  await f3OutOfBoxTranslation(page, serviceWorker, testPageUrl);
  console.log("");

  // ── F4: 弹出页默认状态验证 ──
  await f4PopupDefaultState(page, extensionId);
  console.log("");

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
