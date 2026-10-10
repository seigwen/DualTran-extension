/**
 * DualTran E2E i18n 国际化测试场景
 *
 * 验证选项页在不同 locale 下的 i18n 行为：
 *   I1: 中文 locale → 验证中文文本渲染
 *   I2: 英文 locale → 验证英文文本渲染
 *   I3: 不存在的 locale → 验证 fallback 到英文
 *
 * 技术方案：
 *   Chrome 的 UI 语言由 --lang 启动参数控制，
 *   chrome.i18n.getMessage() 根据该值选择 _locales/{lang}/messages.json。
 *   使用 runWithIsolatedExtensionContext 的 locale 选项实现。
 *
 * @module i18n-behavior
 */

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 测试场景名称 */
export const name = "i18n-behavior";

/** 此场景不需要 Mock LLM 服务器 */
export const needsMock = false;

/** 不纳入 smoke 子集（需要特定 Chrome 启动参数） */
export const smoke = false;

// ─── 从 setup.mjs 导入共享工具函数 ─────────────────────────────

import {
  runWithIsolatedExtensionContext,
} from "./setup.mjs";

// ─── 期望值常量 ──────────────────────────────────────────────────

/**
 * 各 locale 下期望的 i18n 文本。
 * 这些值直接来自 _locales/{lang}/messages.json。
 */
const EXPECTED_TEXTS = {
  "zh-CN": {
    lblSettings: "设置",
    lblAiProvider: "AI 提供商",
  },
  "en": {
    lblSettings: "Settings",
    lblAiProvider: "AI provider",
  },
};

/**
 * AI 面板的动态文案期望值（#155）——直接来自各 locale 的 messages.json：
 * provider 面板四个 label（`$PROVIDER_NAME$` 占位符替换后）、API-key 帮助链接、
 * 两个「+」按钮的 tooltip。en 断言兼防 $PROVIDER_NAME$ 字面泄漏。
 */
const EXPECTED_AI_PANEL = {
  "zh-CN": {
    apiKeyLabel: "OpenAI API 密钥",
    apiKeyLink: "如何获取 OpenAI API 密钥？",
    modelLabel: "OpenAI 模型",
    reasoningLabel: "OpenAI 推理深度",
    addProviderTitle: "添加列表中不存在的自定义提供商",
    addModelTitle: "添加自定义模型",
  },
  "en": {
    apiKeyLabel: "OpenAI API Key",
    apiKeyLink: "How to get OpenAI API Key?",
    modelLabel: "OpenAI Model",
    reasoningLabel: "OpenAI Reasoning Depth",
    addProviderTitle: "Add a custom provider not in the list",
    addModelTitle: "Add a custom model",
  },
};

/**
 * 等待 AI 面板的动态 label 离开静态初始值（provider 面板就绪）。
 * 初始静态文案为 "Model"；_updatePanelLabels 运行后被替换为
 * "{Provider} Model"（如 "OpenAI 模型"）——以此作为就绪信号。
 */
async function waitForAiPanelReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById("genericModelLabel");
    return !!el && !!el.textContent && el.textContent !== "Model";
  }, null, { timeout: 15000 });
}

/** 读取 AI 面板的 i18n 可见面（四个 label + 帮助链接 + 两个 tooltip）。 */
async function readAiPanelTexts(page) {
  return page.evaluate(() => ({
    apiKeyLabel: document.getElementById("genericApiKeyLabel")?.textContent ?? null,
    apiKeyLink: document.getElementById("genericApiKeyLink")?.textContent ?? null,
    modelLabel: document.getElementById("genericModelLabel")?.textContent ?? null,
    reasoningLabel: document.getElementById("genericReasoningDepthLabel")?.textContent ?? null,
    addProviderTitle: document.getElementById("btnAddCustomProvider")?.title ?? null,
    addModelTitle: document.getElementById("btnAddCustomModel")?.title ?? null,
  }));
}

/**
 * 断言 AI 面板动态文案与期望集合完全一致（逐字段报错）。
 * @param {Object} actual
 * @param {Object} expected
 * @param {string} stepPrefix - 报错前缀（如 "[I1]"）
 */
function assertAiPanelTexts(actual, expected, stepPrefix) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[field];
    if (actualValue !== expectedValue) {
      throw new Error(
        `${stepPrefix} AI 面板 ${field} 应为 "${expectedValue}"，实际为 "${actualValue}"`
      );
    }
    console.log(`  ${stepPrefix} AI 面板 ${field} = "${actualValue}" ✓`);
  }
}

// ═════════════════════════════════════════════════════════════════
// I1: 中文 locale → 验证中文文本渲染
// ═════════════════════════════════════════════════════════════════

/**
 * [I1] 使用 --lang=zh-CN 启动隔离浏览器上下文，验证选项页渲染中文 i18n 文本。
 *
 * chrome.i18n.translateDocument() 在页面加载时遍历 [data-i18n] 元素，
 * 用 chrome.i18n.getMessage(key) 替换 textContent。
 *
 * @param {Object} scope - 完整的测试 scope 对象（用于错误收集器）
 * @returns {Promise<void>}
 * @throws {Error} 中文文本未正确渲染时抛出
 */
async function i1ChineseLocale(scope) {
  console.log("[I1] 中文 locale i18n 验证...");

  await runWithIsolatedExtensionContext(async ({ page, extensionId }) => {
    // 导航到选项页 AI 区块（#155：AI 面板动态文案必须在真实 locale 下正确渲染）
    await page.goto(`chrome-extension://${extensionId}/options/options.html#ai`, { waitUntil: "load" });

    // 等待 i18n.translateDocument() 执行完成
    // translateDocument 在 i18n.js 加载时自动执行（typeof chrome.tabs !== "undefined" 时）
    await page.waitForTimeout(2000);

    // 读取 [data-i18n="lblSettings"] 的 textContent
    const settingsText = await page.evaluate(() => {
      const el = document.querySelector('[data-i18n="lblSettings"]');
      return el ? el.textContent : null;
    });

    // 读取 [data-i18n="lblAiProvider"] 的 textContent
    const aiProviderText = await page.evaluate(() => {
      const el = document.querySelector('[data-i18n="lblAiProvider"]');
      return el ? el.textContent : null;
    });

    console.log(`  [I1] lblSettings = "${settingsText}" (期望: "${EXPECTED_TEXTS["zh-CN"].lblSettings}")`);
    console.log(`  [I1] lblAiProvider = "${aiProviderText}" (期望: "${EXPECTED_TEXTS["zh-CN"].lblAiProvider}")`);

    // 验证中文文本
    if (settingsText !== EXPECTED_TEXTS["zh-CN"].lblSettings) {
      throw new Error(
        `[I1] lblSettings 应为 "${EXPECTED_TEXTS["zh-CN"].lblSettings}"，实际为 "${settingsText}"`
      );
    }
    console.log(`  [I1] lblSettings 中文正确 ✓`);

    if (aiProviderText !== EXPECTED_TEXTS["zh-CN"].lblAiProvider) {
      throw new Error(
        `[I1] lblAiProvider 应为 "${EXPECTED_TEXTS["zh-CN"].lblAiProvider}"，实际为 "${aiProviderText}"`
      );
    }
    console.log(`  [I1] lblAiProvider 中文正确 ✓`);

    // #155：AI 面板动态文案（$PROVIDER_NAME$ 替换后的 label / 帮助链接 / tooltip）
    await waitForAiPanelReady(page);
    const aiPanelTexts = await readAiPanelTexts(page);
    assertAiPanelTexts(aiPanelTexts, EXPECTED_AI_PANEL["zh-CN"], "[I1]");
  }, scope.collector, { locale: "zh-CN" });

  console.log("[I1] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// I2: 英文 locale → 验证英文文本渲染
// ═════════════════════════════════════════════════════════════════

/**
 * [I2] 使用 --lang=en 启动隔离浏览器上下文，验证选项页渲染英文 i18n 文本。
 *
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 * @throws {Error} 英文文本未正确渲染时抛出
 */
async function i2EnglishLocale(scope) {
  console.log("[I2] 英文 locale i18n 验证...");

  await runWithIsolatedExtensionContext(async ({ page, extensionId }) => {
    // 导航到选项页 AI 区块
    await page.goto(`chrome-extension://${extensionId}/options/options.html#ai`, { waitUntil: "load" });

    // 等待 i18n 初始化
    await page.waitForTimeout(2000);

    // 读取 i18n 文本
    const settingsText = await page.evaluate(() => {
      const el = document.querySelector('[data-i18n="lblSettings"]');
      return el ? el.textContent : null;
    });

    const aiProviderText = await page.evaluate(() => {
      const el = document.querySelector('[data-i18n="lblAiProvider"]');
      return el ? el.textContent : null;
    });

    console.log(`  [I2] lblSettings = "${settingsText}" (期望: "${EXPECTED_TEXTS.en.lblSettings}")`);
    console.log(`  [I2] lblAiProvider = "${aiProviderText}" (期望: "${EXPECTED_TEXTS.en.lblAiProvider}")`);

    // 验证英文文本
    if (settingsText !== EXPECTED_TEXTS.en.lblSettings) {
      throw new Error(
        `[I2] lblSettings 应为 "${EXPECTED_TEXTS.en.lblSettings}"，实际为 "${settingsText}"`
      );
    }
    console.log(`  [I2] lblSettings 英文正确 ✓`);

    if (aiProviderText !== EXPECTED_TEXTS.en.lblAiProvider) {
      throw new Error(
        `[I2] lblAiProvider 应为 "${EXPECTED_TEXTS.en.lblAiProvider}"，实际为 "${aiProviderText}"`
      );
    }
    console.log(`  [I2] lblAiProvider 英文正确 ✓`);

    // #155：en 断言兼防 $PROVIDER_NAME$ 字面泄漏（相等断言天然覆盖）
    await waitForAiPanelReady(page);
    const aiPanelTexts = await readAiPanelTexts(page);
    assertAiPanelTexts(aiPanelTexts, EXPECTED_AI_PANEL.en, "[I2]");
  }, scope.collector, { locale: "en" });

  console.log("[I2] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// I3: 不存在的 locale → fallback 到英文
// ═════════════════════════════════════════════════════════════════

/**
 * [I3] 使用不存在的 locale（xx-XX）启动浏览器，验证 Chrome 回退到英文。
 *
 * Chrome 的 i18n fallback 行为：
 *   1. 查找 _locales/xx-XX/ → 不存在
 *   2. 查找 _locales/xx/ → 不存在
 *   3. 回退到 _locales/en/（manifest.json 中的默认 locale）
 *
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 * @throws {Error} fallback 文本不正确时抛出
 */
async function i3FallbackLocale(scope) {
  console.log("[I3] 不存在的 locale → fallback 验证...");

  await runWithIsolatedExtensionContext(async ({ page, extensionId }) => {
    // 导航到选项页
    await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });

    // 等待 i18n 初始化
    await page.waitForTimeout(2000);

    // 读取 i18n 文本
    const settingsText = await page.evaluate(() => {
      const el = document.querySelector('[data-i18n="lblSettings"]');
      return el ? el.textContent : null;
    });

    const aiProviderText = await page.evaluate(() => {
      const el = document.querySelector('[data-i18n="lblAiProvider"]');
      return el ? el.textContent : null;
    });

    console.log(`  [I3] lblSettings = "${settingsText}" (期望 fallback: "${EXPECTED_TEXTS.en.lblSettings}")`);
    console.log(`  [I3] lblAiProvider = "${aiProviderText}" (期望 fallback: "${EXPECTED_TEXTS.en.lblAiProvider}")`);

    // 验证回退到英文
    if (settingsText !== EXPECTED_TEXTS.en.lblSettings) {
      throw new Error(
        `[I3] lblSettings 应 fallback 为 "${EXPECTED_TEXTS.en.lblSettings}"，实际为 "${settingsText}"`
      );
    }
    console.log(`  [I3] lblSettings fallback 到英文正确 ✓`);

    if (aiProviderText !== EXPECTED_TEXTS.en.lblAiProvider) {
      throw new Error(
        `[I3] lblAiProvider 应 fallback 为 "${EXPECTED_TEXTS.en.lblAiProvider}"，实际为 "${aiProviderText}"`
      );
    }
    console.log(`  [I3] lblAiProvider fallback 到英文正确 ✓`);

    // #155：不存在的 locale 下 AI 面板动态文案同样回退到英文
    await waitForAiPanelReady(page);
    const aiPanelTexts = await readAiPanelTexts(page);
    assertAiPanelTexts(aiPanelTexts, EXPECTED_AI_PANEL.en, "[I3]");
  }, scope.collector, { locale: "xx-XX" });

  console.log("[I3] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// run(scope) — 测试主入口
// ═════════════════════════════════════════════════════════════════

/**
 * 执行 i18n 国际化 E2E 测试场景的全部 3 个步骤。
 *
 * 每个步骤使用独立的隔离浏览器上下文（不同的 --lang 参数），
 * 确保各 locale 测试之间互不干扰。
 *
 * @param {Object} scope - setupBasic() 返回的作用域对象
 * @param {import("./setup.mjs").ErrorCollector} scope.collector - 错误收集器实例
 * @returns {Promise<void>}
 */
export async function run(scope) {
  const { collector } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  // ── I1: 中文 locale ──
  await i1ChineseLocale(scope);

  // ── I2: 英文 locale ──
  await i2EnglishLocale(scope);

  // ── I3: 不存在的 locale → fallback ──
  await i3FallbackLocale(scope);

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
