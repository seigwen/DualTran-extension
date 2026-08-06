/**
 * DualTran E2E 翻译测试场景
 *
 * 包含 13 个测试步骤函数和 run(scope) 入口，
 * 均从 tests/browser-e2e.mjs 中原样复制（零逻辑修改）。
 *
 * mockServerConfig 通过显式参数传递给 4 个步骤函数。
 * 错误收集（recordError、attachPageErrorCollector）通过模块级 proxy 变量
 * 桥接到 scope.collector，以保持原函数体零修改。
 *
 * @module translation
 */

// ═══════════════════════════════════════════════════════════════
// 导出元数据
// ═══════════════════════════════════════════════════════════════

/** 测试场景名称 */
export const name = "translation";

/** 是否需要 Mock LLM 服务器 */
export const needsMock = true;

/** 不纳入 smoke 子集（13 步，含 AI 翻译完整管线，耗时较长） */
export const smoke = false;

// ═══════════════════════════════════════════════════════════════
// 从 setup.mjs 导入共享工具函数（已在 Task 1-3 提取）
// ═══════════════════════════════════════════════════════════════

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  dumpDiagnosticLogs,
  waitForOptionsSelectReady,
  setOptionsSelectValueAndWait,
  waitForPageStorageValue,
} from "./setup.mjs";

// ─── 模块级闭包代理变量 ──────────────────────────────────────
// 在 run(scope) 中赋值，供模块作用域函数引用。
// 必须用 let，因为 module-scope 函数看不到 run() 内部的局部 const。
let attachPageErrorCollector;
let recordError;

// ─── E2E 测试步骤 ────────────────────────────────────────────

/**
 * [1/13] 配置扩展参数。
 *
 * 通过 Service Worker 的 chrome.storage.local.set() 直接写入配置值。
 * 这比操作选项页 DOM 更可靠（某些 DOM 元素可能不存在）。
 *
 * 配置内容：
 *   - 目标语言设为法语（fr）
 *   - AI 提供商设为 OpenRouter（使用 mock 服务器地址）
 *   - 启用 AI 自动改进翻译（autoImproveByAI = "yes"）
 *   - AI 改进长度阈值设为 0（所有文本都触发 AI 改进）
 *
 * 最后访问选项页以触发 twpConfig 的 storage change 观察者。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 */
async function configureExtension(page, extensionId, serviceWorker, mockServerConfig) {
  const openRouterApiBase = mockServerConfig.openRouterApiBase;
  // 通过 Service Worker 上下文直接写入 chrome.storage.local
  await serviceWorker.evaluate(async (apiBase) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",                        // 翻译目标语言
      targetLanguageTextTranslation: "fr",         // 选中文本翻译的目标语言
      targetLanguages: ["fr", "en", "es"],         // 目标语言列表
      aiProvider: "openrouter",                    // AI 提供商
      apiKeyOpenRouter: "mock-openrouter-key",     // OpenRouter API 密钥（mock 用）
      openRouterApiBase: apiBase,                  // OpenRouter API 基础 URL（指向 mock 服务器）
      openRouterModel: "openai/gpt-4o-mini",       // 使用的 AI 模型
      autoImproveByAI: "yes",                      // 启用 AI 自动改进
      aiImproveForLongerThan: 0,                   // 0 = 所有文本都触发 AI 改进
    });
  }, openRouterApiBase);

  // 验证配置已正确写入
  const storedConfig = await serviceWorker.evaluate(async () => {
    return await chrome.storage.local.get([
      "targetLanguage",
      "aiProvider",
      "apiKeyOpenRouter",
      "openRouterApiBase",
      "autoImproveByAI",
    ]);
  });
  console.log("  Extension config set via chrome.storage.local:", JSON.stringify(storedConfig));

  // 访问选项页触发 twpConfig 观察者（它们监听 storage.onChanged 事件）
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
  await page.waitForTimeout(500); // 等待观察者处理完成
}

/**
 * [2/13] 验证弹出页（popup）基本渲染。
 *
 * 检查弹出页是否正确渲染了目标语言选择组。
 * 如果语言选项少于 4 个，说明弹出页的初始化逻辑存在问题。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 */
async function verifyPopup(page, extensionId) {
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
  await page.waitForSelector("#selectTargetLanguage"); // 等待目标语言下拉框渲染
  // 等待 popup.js 异步填充选项
  await page.waitForFunction(() => {
    const sel = document.getElementById("selectTargetLanguage");
    return sel && sel.options.length >= 4;
  }, null, { timeout: 15000 });
  const optionCount = await page.locator("#selectTargetLanguage option").count();
  if (optionCount < 4) {
    throw new Error(`Popup did not render target language select correctly. Option count=${optionCount}`);
  }
}

/**
 * [3/13] 验证整页 Google 翻译。
 *
 * 流程：
 *   1. 导航到测试页面
 *   2. 等待内容脚本注入和翻译器就绪
 *   3. 发送 translatePage 命令
 *   4. 等待 <translated> 元素出现（Google 翻译会将译文包裹在此标签中）
 *   5. 检查翻译节点数量是否 > 0
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} testPageUrl - 测试页面 URL
 */
async function verifyWholePageTranslation(page, serviceWorker, testPageUrl) {
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  // 触发 Google 翻译
  await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
  // 等待 <translated> 元素出现
  await page.waitForFunction(() => {
    const translatedNodes = Array.from(document.querySelectorAll("translated"));
    return translatedNodes.length > 0;
  }, null, { timeout: 15000 });

  // 收集翻译结果统计
  const translationState = await page.evaluate(() => ({
    translatedCount: document.querySelectorAll("translated").length,
    pageText: document.body.innerText,
  }));

  if (!translationState.translatedCount) {
    throw new Error(`Whole-page translation did not insert any <translated> nodes. Page text: ${translationState.pageText}`);
  }
}

/**
 * [4/13] 验证选中文本翻译。
 *
 * 流程：
 *   1. 导航到测试页面
 *   2. 通过 JS 选中 #selection-target 元素的文本
 *   3. 模拟 mouseup 事件（触发扩展的文本选中检测）
 *   4. 发送 TranslateSelectedText 命令
 *   5. 等待 div.notranslate 元素增加（选中文本翻译的宿主元素）
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} testPageUrl - 测试页面 URL
 */
async function verifySelectedTextEntry(page, serviceWorker, testPageUrl) {
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await page.waitForTimeout(1500); // 等待内容脚本完全初始化
  // 记录翻译前的 notranslate 元素数量
  const beforeCount = await page.locator("div.notranslate").count();
  // 在页面中选中目标文本
  await page.evaluate(() => {
    const element = document.getElementById("selection-target");
    if (!element) throw new Error("selection-target not found");
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element); // 选中整个元素的文本
    selection.addRange(range);
    // 模拟鼠标抬起事件，触发扩展的选中文本检测逻辑
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200, clientY: 260 }));
  });
  // 发送选中文本翻译命令
  await sendMessageToTab(serviceWorker, page.url(), { action: "TranslateSelectedText" });
  // 等待翻译结果容器出现
  await page.waitForFunction(
    (count) => document.querySelectorAll("div.notranslate").length > count,
    beforeCount,
    { timeout: 10000 }
  );

  const afterCount = await page.locator("div.notranslate").count();
  if (afterCount <= beforeCount) {
    throw new Error("Selected-text translation entry did not create any translation host elements");
  }
}

// ─── Google 翻译验证（富内容页面） ───────────────────────────

/**
 * [6/13] 在富内容验证页面上测试 Google 翻译。
 *
 * 与 verifyWholePageTranslation 的区别：
 *   - 使用更复杂的验证页面（含表格、列表、多段落）
 *   - 检查特定区域是否被翻译（#p-intro、#table-beans、#list-brewing）
 *   - 验证翻译节点的文本内容不为空
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} verifyPageUrl - 富内容验证页面 URL
 */
async function verifyGoogleTranslation(page, serviceWorker, verifyPageUrl) {
  console.log("  Testing Google Translate on verification page...");
  const detach = attachPageErrorCollector(page, "google-translate-verify");

  try {
    await page.goto(verifyPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    // 触发 Google 翻译（默认 pageTranslatorService 是 "google"）
    await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });

    // 等待 <translated> 节点出现
    await page.waitForFunction(() => {
      return document.querySelectorAll("translated").length > 0;
    }, null, { timeout: 30000 });

    // 收集详细的翻译结果统计
    const result = await page.evaluate(() => {
      const translatedNodes = document.querySelectorAll("translated");
      const details = [];
      // 采集前 10 个翻译节点的信息用于调试
      translatedNodes.forEach((node, i) => {
        if (i < 10) {
          details.push({
            parentTag: node.parentElement?.tagName || "unknown",
            textLength: (node.textContent || "").length,
            textPreview: (node.textContent || "").substring(0, 80),
          });
        }
      });
      return {
        translatedCount: translatedNodes.length,
        details,
        introHasTranslation: !!document.querySelector("#p-intro translated"),     // 介绍段落是否被翻译
        tableTranslated: document.querySelectorAll("#table-beans translated").length, // 表格中翻译节点数
        listTranslated: document.querySelectorAll("#list-brewing translated").length, // 列表中翻译节点数
      };
    });

    console.log(`  Google Translate result: ${result.translatedCount} <translated> nodes`);
    console.log(`    Intro paragraph translated: ${result.introHasTranslation}`);
    console.log(`    Table cells translated: ${result.tableTranslated}`);
    console.log(`    List items translated: ${result.listTranslated}`);

    if (result.translatedCount === 0) {
      throw new Error("Google Translate produced zero <translated> nodes on the verification page");
    }

    // 检查是否有空翻译节点（说明 Google 翻译返回了空文本）
    if (result.details.some((d) => d.textLength === 0)) {
      recordError("google-translate", "Some <translated> nodes have empty text content");
    }
  } finally {
    detach(); // 取消错误监听
  }
}

// ─── AI 翻译验证（Mock LLM 服务器） ─────────────────────────

/**
 * [7/13] 验证 AI 翻译的完整端到端流程。
 *
 * 这是最复杂的测试步骤，验证以下完整链路：
 *   内容脚本 → sseClient → Service Worker (aiProxy) → Mock LLM 服务器
 *   → 流式响应 → 解析 <译泽> 块 → 应用到 DOM
 *
 * 测试流程：
 *   1. 导航到验证页面
 *   2. 先触发 Google 翻译（生成 <translated> 节点和 AI 按钮）
 *   3. 等待 AI 自动改进（autoImproveByAI = "yes"）通过 Mock 服务器处理
 *   4. 通过 DOM 可观测信号检测 AI 翻译进度：
 *      - .dualtran-ai-success-check（✓ 成功指示器）
 *      - .dualtran-ai-error-cross（✗ 错误指示器）
 *      - 按钮文本（"queuing"、"translating..."）
 *      - Mock 响应文本是否出现在 DOM 中
 *   5. 额外测试：选中文本的 AI 翻译
 *
 * 重要：内容脚本运行在隔离世界（ISOLATED WORLD），自定义 JS 属性
 * （如 btn.translationStatus）从主世界的 page.evaluate() 中不可见。
 * 必须通过 DOM 属性（class、textContent、title）来判断状态。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} verifyPageUrl - 富内容验证页面 URL
 */
async function verifyAiTranslation(page, serviceWorker, verifyPageUrl, mockServerConfig) {
  console.log("  Testing AI translation (OpenRouter mock) on verification page...");
  const detach = attachPageErrorCollector(page, "ai-translate-verify");

  // ── 诊断日志收集 ──
  // 收集 AI 翻译过程中的所有 console 输出（不仅是 error），用于故障诊断

  /** 内容脚本的所有 console 日志 */
  const aiConsoleLogs = [];
  const onAiConsole = (msg) => {
    const text = msg.text();
    aiConsoleLogs.push(`[${msg.type()}] ${text}`);
  };
  page.on("console", onAiConsole);

  /** Service Worker 的 console 日志（aiProxy 诊断） */
  const swConsoleLogs = [];
  const onSwConsole = (msg) => {
    swConsoleLogs.push(`[sw:${msg.type()}] ${msg.text()}`);
  };
  serviceWorker.on("console", onSwConsole);

  // ── 对话框自动关闭 ──
  // 内容脚本在 API key 缺失时会调用 window.prompt()，
  // 如果配置未及时传播，prompt 会阻塞 Playwright 导致崩溃。
  // 自动关闭所有对话框并记录日志。
  /** 被拦截的对话框日志 */
  const dialogLogs = [];
  const onDialog = async (dialog) => {
    dialogLogs.push(`dialog:${dialog.type()} message="${dialog.message()}"`);
    console.log(`  [dialog intercepted] type=${dialog.type()}, message=${dialog.message()}`);
    await dialog.dismiss().catch(() => {}); // 自动关闭对话框
  };
  page.on("dialog", onDialog);

  // ── 页面崩溃监控 ──
  let pageCrashed = false;
  const onCrash = () => {
    pageCrashed = true;
    console.log("  [CRASH] Page has crashed!");
  };
  page.on("crash", onCrash);

  try {
    await page.goto(verifyPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    // 验证 Service Worker 中的配置值是否可读
    const configCheck = await serviceWorker.evaluate(async () => {
      const storage = await chrome.storage.local.get([
        "autoImproveByAI", "aiProvider", "apiKeyOpenRouter", "openRouterApiBase",
        "openRouterModel",
      ]);
      return storage;
    });
    console.log("  Config check from service worker:", JSON.stringify(configCheck));

    // 先触发 Google 翻译，生成 <translated> 节点（AI 按钮附着在这些节点上）
    await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });

    // 等待 Google 翻译完成
    await page.waitForFunction(() => {
      return document.querySelectorAll("translated").length > 0;
    }, null, { timeout: 30000 });

    // 记录 Google 翻译后的状态
    const postGoogleState = await page.evaluate(() => ({
      translatedCount: document.querySelectorAll("translated").length,
      singletonHost: !!document.getElementById("dualtran-singleton-btn-host"),
    }));
    console.log(`  Post-Google-Translate: ${postGoogleState.translatedCount} translated nodes, singleton host: ${postGoogleState.singletonHost}`);

    // ── AI 自动改进轮询 ──
    // autoImproveByAI = "yes" 时，扩展通过 aiTranslateDynamically() 每 2500ms 轮询一次。
    // Mock 服务器返回确定性的响应文本。
    // 最多等待 45 秒让 AI 翻译完成。
    console.log("  Waiting for AI auto-improve to process paragraphs via mock server...");

    let aiResult;
    const aiPollStart = Date.now();
    const aiTimeout = 45_000;  // AI 翻译最大等待时间
    let pollIteration = 0;
    while (Date.now() - aiPollStart < aiTimeout) {
      // 检查页面是否崩溃
      if (pageCrashed) {
        console.log("  Page crashed during AI translation wait. Dumping diagnostics...");
        break;
      }

      try {
        // 在页面上下文中采集 AI 翻译状态
        aiResult = await page.evaluate((expectedAiSnippet) => {
          const bodyText = document.body.innerText;
          const hasMockResponse = bodyText.includes(expectedAiSnippet);

          const translatedNodes = document.querySelectorAll("translated");
          let aiProcessedCount = 0;
          translatedNodes.forEach((node) => {
            if ((node.textContent || "").includes(expectedAiSnippet)) {
              aiProcessedCount++;
            }
          });

          // Check singleton button group for AI rendering state
          const singletonHost = document.getElementById("dualtran-singleton-btn-host");
          let singleAiSuccess = false;
          let singleAiError = false;
          if (singletonHost && singletonHost.shadowRoot) {
            const aiBtn = singletonHost.shadowRoot.querySelector(".dualtran-ai-btn");
            if (aiBtn) {
              singleAiSuccess = !!aiBtn.querySelector(".dualtran-ai-success-check");
              singleAiError = !!aiBtn.querySelector(".dualtran-ai-error-cross");
            }
          }

          return {
            hasSingleton: !!singletonHost,
            hasMockResponse,
            aiProcessedCount,
            totalTranslated: translatedNodes.length,
            singleAiSuccess,
            singleAiError,
          };
        }, mockServerConfig.expectedAiSnippet);
      } catch (pollError) {
        // page.evaluate 失败——浏览器或页面可能已关闭或崩溃
        console.log(`  Poll failed: ${pollError.message}`);
        console.log("  Dumping collected console logs before crash...");
        dumpDiagnosticLogs(aiConsoleLogs, swConsoleLogs, dialogLogs);
        throw new Error(`Browser/page crashed during AI translation polling: ${pollError.message}`);
      }

      // 每 5 次轮询输出一次进度
      pollIteration++;
      if (pollIteration % 5 === 0) {
        console.log(`    poll #${pollIteration}: mockInDOM=${aiResult.hasMockResponse} aiProcessed=${aiResult.aiProcessedCount} total=${aiResult.totalTranslated} singletonSuccess=${aiResult.singleAiSuccess} singletonError=${aiResult.singleAiError}`);
      }

      // 退出条件：DOM 中出现了 mock 响应文本，或单例显示成功/错误
      if (aiResult.hasMockResponse || aiResult.aiProcessedCount > 0) {
        break;
      }
      if (aiResult.hasSingleton && (aiResult.singleAiSuccess || aiResult.singleAiError)) {
        break;
      }

      try {
        await page.waitForTimeout(1000); // 1 秒后重试
      } catch (waitError) {
        console.log(`  waitForTimeout failed: ${waitError.message}`);
        dumpDiagnosticLogs(aiConsoleLogs, swConsoleLogs, dialogLogs);
        throw new Error(`Browser/page crashed during AI translation wait: ${waitError.message}`);
      }
    }

    // 页面崩溃处理
    if (pageCrashed) {
      dumpDiagnosticLogs(aiConsoleLogs, swConsoleLogs, dialogLogs);
      throw new Error("Page crashed during AI translation. See diagnostics above.");
    }

    // 输出 AI 翻译结果统计
    console.log("  AI translation result:");
    console.log(`    Singleton host: ${aiResult.hasSingleton}`);
    console.log(`    Mock response text detected: ${aiResult.hasMockResponse}`);
    console.log(`    AI-processed <translated> nodes: ${aiResult.aiProcessedCount}`);
    console.log(`    Total <translated> nodes: ${aiResult.totalTranslated}`);
    console.log(`    Singleton AI: success=${aiResult.singleAiSuccess} error=${aiResult.singleAiError}`);

    // 输出拦截到的对话框日志
    if (dialogLogs.length > 0) {
      console.log(`  Dialogs intercepted: ${dialogLogs.length}`);
      dialogLogs.forEach(d => console.log(`    ${d}`));
    }

    // ── 结果判定 ──
    if (aiResult.hasMockResponse || aiResult.aiProcessedCount > 0) {
      console.log("  AI translation end-to-end flow verified with mock server.");
    } else if (aiResult.singleAiSuccess) {
      // 按钮显示成功但 DOM 中没有找到 mock 文本——响应文本可能被转换了
      console.log("  Singleton AI button shows success indicators. Checking if translation text was applied...");
    } else if (aiResult.singleAiError) {
      // 单例按钮显示错误
      dumpDiagnosticLogs(aiConsoleLogs, swConsoleLogs, dialogLogs);
      throw new Error("AI auto-improve failed: singleton AI button shows error. Mock server may not be reachable.");
    } else if (aiResult.hasSingleton && aiResult.totalTranslated > 0) {
      // 单例存在但没有被处理——配置或 API key 可能有问题
      dumpDiagnosticLogs(aiConsoleLogs, swConsoleLogs, dialogLogs);
      throw new Error("AI auto-improve timed out: buttons exist but none were processed. Check autoImproveByAI config and provider key gate.");
    } else if (!aiResult.hasSingleton) {
      // 没有单例按钮 host——页面可能没有足够的可翻译内容
      throw new Error("No AI buttons rendered on the verification page. The page may not have enough translatable content.");
    }

    // ── 逐节点验证：检查每个 <translated> 节点是否包含 🌐[aimock] 标记 ──
    if (aiResult.hasMockResponse || aiResult.aiProcessedCount > 0) {
      const nodeVerification = await page.evaluate((snippet) => {
        const nodes = document.querySelectorAll("translated");
        let passCount = 0;
        let failCount = 0;
        const failures = [];
        nodes.forEach((node, i) => {
          const text = (node.textContent || "").trim();
          if (text.includes(snippet)) {
            passCount++;
          } else {
            failCount++;
            if (failures.length < 5) {
              failures.push({ index: i, preview: text.substring(0, 80) });
            }
          }
        });
        return { total: nodes.length, passCount, failCount, failures };
      }, mockServerConfig.expectedAiSnippet);

      console.log(`  Per-node verification: ${nodeVerification.passCount}/${nodeVerification.total} nodes contain ${mockServerConfig.expectedAiSnippet}`);
      if (nodeVerification.failures.length > 0) {
        console.log("  Sample failures:", JSON.stringify(nodeVerification.failures));
      }

      const passRate = nodeVerification.total > 0 ? nodeVerification.passCount / nodeVerification.total : 0;
      if (passRate < 0.5) {
        throw new Error(`Per-node verification failed: only ${nodeVerification.passCount}/${nodeVerification.total} nodes (${(passRate * 100).toFixed(0)}%) contain mock marker. Need >=50%.`);
      }
    }

    // ── 选中文本的 AI 翻译测试 ──
    console.log("  Testing selected-text AI translation...");
    const beforeNotranslate = await page.locator("div.notranslate").count();

    // 选中目标文本
    await page.evaluate(() => {
      const element = document.getElementById("selection-target");
      if (!element) throw new Error("selection-target not found");
      const selection = window.getSelection();
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200, clientY: 260 }));
    });

    // 触发选中文本翻译
    await sendMessageToTab(serviceWorker, page.url(), { action: "TranslateSelectedText" });

    // 等待翻译结果容器出现
    await page.waitForFunction(
      (count) => document.querySelectorAll("div.notranslate").length > count,
      beforeNotranslate,
      { timeout: 15000 }
    );

    const afterNotranslate = await page.locator("div.notranslate").count();
    if (afterNotranslate > beforeNotranslate) {
      console.log("  Selected-text translation on verification page succeeded.");
    }

    // 等待 AI 改进处理选中文本的翻译
    await page.waitForTimeout(3000);

    // 检查选中文本的翻译面板中是否包含 mock 响应文本
    const selectedAiResult = await page.evaluate((expectedAiSnippet) => {
      const panels = document.querySelectorAll("div.notranslate");
      let mockTextFound = false;
      panels.forEach((panel) => {
        if ((panel.textContent || "").includes(expectedAiSnippet)) {
          mockTextFound = true;
        }
      });
      return { panelCount: panels.length, mockTextFound };
    }, mockServerConfig.expectedAiSnippet);

    console.log(`  Selected-text AI result: panels=${selectedAiResult.panelCount}, mockText=${selectedAiResult.mockTextFound}`);
  } finally {
    // 清理所有事件监听器
    page.off("console", onAiConsole);
    page.off("dialog", onDialog);
    page.off("crash", onCrash);
    serviceWorker.off("console", onSwConsole);
    detach();
  }
}

/**
 * [10/13] 验证弹出页语言选择→触发翻译的完整交互流程。
 *
 * 流程：
 *   1. 打开弹出页，点击第一个目标语言选项
 *   2. 等待弹出页将语言选择持久化到 chrome.storage.local
 *   3. 导航到测试页面
 *   4. 用弹出页保存的目标语言触发翻译
 *   5. 验证 <translated> 节点出现
 *
 * 注意：在 Playwright 中弹出页作为完整页面打开，
 * 其 chrome.tabs.sendMessage 会发送到弹出页本身（而非测试页面）。
 * 因此我们只依赖弹出页持久化语言选择，翻译由步骤 4 显式触发。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} testPageUrl - 测试页面 URL
 */
async function verifyPopupTranslateInteraction(page, extensionId, serviceWorker, testPageUrl) {
  const detach = attachPageErrorCollector(page, "popup-translate-interaction");

  try {
    // 1. 打开弹出页并点击语言选项
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
    await page.waitForSelector("#selectTargetLanguage");
    // 选择下拉框中的第二个选项（第一个通常是 "original"）
    const options = await page.locator("#selectTargetLanguage option").all();
    if (options.length > 1) {
      const secondValue = await options[1].getAttribute("value");
      await page.selectOption("#selectTargetLanguage", secondValue);
    }
    await page.waitForTimeout(500); // 等待 twpConfig 持久化语言选择

    // 验证弹出页是否成功写入了语言配置
    const savedLang = await serviceWorker.evaluate(async () => {
      const data = await chrome.storage.local.get("targetLanguage");
      return data.targetLanguage;
    });
    console.log(`  Popup saved targetLanguage: ${savedLang}`);

    // 2. 导航到测试页面，等待内容脚本和翻译器就绪
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    // 3. 用弹出页保存的语言显式触发翻译
    await sendMessageToTab(serviceWorker, page.url(), {
      action: "translatePage",
      targetLanguage: savedLang || "fr",
    });

    // 等待翻译结果
    await page.waitForFunction(() => {
      return document.querySelectorAll("translated").length > 0;
    }, null, { timeout: 15000 });

    const translatedCount = await page.locator("translated").count();
    if (translatedCount < 1) {
      throw new Error("Popup language selection did not trigger translation on the current page");
    }
    console.log(`  Popup translate interaction: ${translatedCount} <translated> nodes.`);
  } finally {
    detach();
  }
}

/**
 * [11/13] 验证选项页设置的持久化能力。
 *
 * 流程：
 *   1. 打开选项页的"翻译"标签
 *   2. 找到 #translateDynamicallyCreatedContent 下拉框
 *   3. 将值从 "yes" 切换到 "no"（或反过来）
 *   4. 刷新页面
 *   5. 验证刷新后值是否保持为修改后的值
 *   6. 清理：恢复原始值
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 */
async function verifyOptionsPagePersistence(page, extensionId, serviceWorker) {
  const detach = attachPageErrorCollector(page, "options-persistence");

  const selectId = "translateDynamicallyCreatedContent"; // 测试目标：动态内容翻译开关
  const selector = `select#${selectId}`;
  const initialValue = "no";
  const nextValue = "yes";
  const originalStoredValue = await serviceWorker.evaluate(async (key) => {
    const items = await chrome.storage.local.get(key);
    return items?.[key] ?? null;
  }, selectId);

  try {
    await serviceWorker.evaluate(async ({ key, value }) => {
      await chrome.storage.local.set({ [key]: value });
    }, { key: selectId, value: initialValue });

    await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
    await page.waitForSelector(selector);
    await waitForOptionsSelectReady(page, selectId);

    await page.waitForFunction(({ id, expected }) => {
      const select = document.getElementById(id);
      return select instanceof HTMLSelectElement && select.value === expected;
    }, { id: selectId, expected: initialValue }, { timeout: 10000 });

    await page.evaluate(() => {
      if (window.__dualtranStorageSetProbeInstalled) {
        window.__dualtranStorageSetCalls.length = 0;
        return;
      }

      const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
      const setCalls = [];
      chrome.storage.local.set = (...args) => {
        setCalls.push(args);
        return originalSet(...args);
      };
      window.__dualtranStorageSetCalls = setCalls;
      window.__dualtranStorageSetProbeInstalled = true;
    });

    try {
      // 修改下拉框值并触发 change 事件
      await setOptionsSelectValueAndWait(page, selectId, nextValue);
      try {
        await waitForPageStorageValue(page, selectId, nextValue);
      } catch (storageWaitError) {
        const diagnostics = await page.evaluate(async (key) => {
          const select = document.getElementById(key);
          const items = await chrome.storage.local.get(key);
          return {
            selectValue: select instanceof HTMLSelectElement ? select.value : null,
            hasOnChange: select instanceof HTMLSelectElement ? typeof select.onchange === "function" : false,
            onChangeSource: select instanceof HTMLSelectElement && typeof select.onchange === "function"
              ? String(select.onchange).slice(0, 300)
              : null,
            pageStorage: items?.[key] ?? null,
            setCalls: Array.isArray(window.__dualtranStorageSetCalls)
              ? window.__dualtranStorageSetCalls.slice(-5)
              : [],
          };
        }, selectId).catch(() => null);
        throw new Error(`Waiting page storage for ${selectId} failed: ${storageWaitError.message}. Diagnostics=${JSON.stringify(diagnostics)}`);
      }

      // 刷新页面
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector(selector);
      await waitForOptionsSelectReady(page, selectId);

      // 直接从当前 options 页验证 storage 与 UI 是否一致，避免把 worker 生命周期噪声误判为持久化失败。
      const persistedStorageValue = await page.evaluate(async (key) => {
        const items = await chrome.storage.local.get(key);
        return items?.[key] ?? null;
      }, selectId);
      const persistedUiValue = await page.locator(selector).inputValue();
      if (persistedStorageValue !== nextValue) {
        throw new Error(`${selectId} did not persist after reload. Expected ${nextValue}, got storage=${persistedStorageValue}, ui=${persistedUiValue}`);
      }
    } finally {
      // 清理：恢复原始值（无论测试是否通过）
      if (originalStoredValue === null) {
        await serviceWorker.evaluate(async (key) => {
          await chrome.storage.local.remove(key);
        }, selectId);
      } else {
        await serviceWorker.evaluate(async ({ key, value }) => {
          await chrome.storage.local.set({ [key]: value });
        }, { key: selectId, value: originalStoredValue });
      }

      // 重新加载页面以应用恢复后的值
      if (!page.isClosed()) {
        await page.reload({ waitUntil: "load" }).catch(() => {});
        await page.waitForSelector(selector).catch(() => {});
        await waitForOptionsSelectReady(page, selectId).catch(() => {});
      }
    }
  } finally {
    detach();
  }
}

/**
 * [12/13] 验证暗黑模式切换。
 *
 * 流程：
 *   1. 打开选项页的"样式"标签
 *   2. 将暗黑模式设为 "yes"
 *   3. 验证 #darkModeElement 存在且 sessionStorage 值为 "yes"
 *   4. 将暗黑模式设为 "no"
 *   5. 验证 #darkModeElement 不存在且 sessionStorage 值为 "no"
 *   6. 恢复为 "auto"
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 */
async function verifyDarkModeToggle(page, extensionId) {
  const detach = attachPageErrorCollector(page, "dark-mode-toggle");

  try {
    await page.goto(`chrome-extension://${extensionId}/options/options.html#style`, { waitUntil: "load" });
    await page.waitForSelector("select#darkMode");
    await waitForOptionsSelectReady(page, "darkMode");

    /**
     * 获取当前暗黑模式状态。
     * 从 DOM 和 sessionStorage 两个维度判断暗黑模式是否生效。
     */
    const getDarkModeState = async () => {
      return page.evaluate(() => {
        const darkModeElement = document.getElementById("darkModeElement");
        const backgroundColor = getComputedStyle(document.body).backgroundColor;
        const sessionValue = sessionStorage.getItem("darkModeIsEnabled");
        return {
          hasDarkModeElement: !!darkModeElement,  // 暗黑模式 CSS 注入元素
          backgroundColor,
          sessionValue,                           // sessionStorage 中的值
        };
      });
    };

    // 启用暗黑模式
    await setOptionsSelectValueAndWait(page, "darkMode", "yes");
    await page.waitForFunction(() => {
      return sessionStorage.getItem("darkModeIsEnabled") === "yes" && !!document.getElementById("darkModeElement");
    }, null, { timeout: 10000 });

    const darkEnabledState = await getDarkModeState();
    if (!darkEnabledState.hasDarkModeElement || darkEnabledState.sessionValue !== "yes") {
      throw new Error(`Dark mode was not applied after selecting yes. State=${JSON.stringify(darkEnabledState)}`);
    }

    // 禁用暗黑模式
    await setOptionsSelectValueAndWait(page, "darkMode", "no");
    await page.waitForFunction(() => {
      return sessionStorage.getItem("darkModeIsEnabled") === "no" && !document.getElementById("darkModeElement");
    }, null, { timeout: 10000 });

    const darkDisabledState = await getDarkModeState();
    if (darkDisabledState.hasDarkModeElement || darkDisabledState.sessionValue !== "no") {
      throw new Error(`Dark mode was not removed after selecting no. State=${JSON.stringify(darkDisabledState)}`);
    }

    // 恢复为自动模式
    await setOptionsSelectValueAndWait(page, "darkMode", "auto");
  } finally {
    detach();
  }
}

/**
 * [13/13] 验证错误恢复能力。
 *
 * 测试扩展在遇到翻译服务错误时不会崩溃。
 * 将 pageTranslatorService 切换到 "yandex"（一个无效/不可用的服务），
 * 触发翻译，等待 5 秒，然后验证：
 *   - 页面没有崩溃
 *   - 没有产生致命错误（crash/fatal/disposed 等）
 *
 * 测试后恢复 pageTranslatorService 为 "google"。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} testPageUrl - 测试页面 URL
 * @param {Object} scope - setupFull() 返回的作用域对象（用于访问 scope.collector.errors）
 */
async function verifyErrorRecovery(page, serviceWorker, testPageUrl, scope) {
  const detach = attachPageErrorCollector(page, "error-recovery");

  try {
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    // 监控页面崩溃
    let pageCrashed = false;
    const onCrash = () => {
      pageCrashed = true;
    };
    page.on("crash", onCrash);

    try {
      // 切换到无效的翻译服务
      await serviceWorker.evaluate(async () => {
        await chrome.storage.local.set({ pageTranslatorService: "yandex" });
      });
      await page.waitForTimeout(500);

      // 触发翻译（预期会失败，但不应崩溃）
      await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
      await page.waitForTimeout(5000); // 等待足够长的时间让错误暴露

      // 验证页面没有崩溃
      if (pageCrashed) {
        throw new Error("Page crashed after translation failure scenario was triggered");
      }

      // 验证页面仍然可交互（evaluate 能正常执行）
      await page.evaluate(() => document.body.innerText.length);

      // 检查是否有致命错误（crash/fatal/disposed 等关键词）
      const fatalRecoveryErrors = scope.collector.errors.filter((err) =>
        (err.source === "page-error:error-recovery" || err.source === "page-console:error-recovery") &&
        /crash|fatal|cannot access a disposed|target page, context or browser has been closed/i.test(err.text)
      );

      if (fatalRecoveryErrors.length > 0) {
        throw new Error(`Error recovery scenario produced fatal errors: ${fatalRecoveryErrors.map((err) => err.text).join(" | ")}`);
      }
    } finally {
      page.off("crash", onCrash);
      // 恢复翻译服务为 Google
      await serviceWorker.evaluate(async () => {
        await chrome.storage.local.set({ pageTranslatorService: "google" });
      });
    }
  } finally {
    detach();
  }
}

// ─── 悬浮按钮组测试 ─────────────────────────────────────────

/**
 * [8/13] 验证悬浮按钮组（#btnGoogle + #btnAi）的四个场景：
 *   场景 1: 按钮可见性
 *   场景 2: 点击触发翻译
 *   场景 3: AI 按钮状态流转（含错误场景）
 *   场景 4: Google/AI 译文切换（临时关闭 autoImproveByAI）
 */
async function verifyFloatingButtons(page, serviceWorker, testPageUrl, mockServerConfig) {
  const detach = attachPageErrorCollector(page, "floating-buttons");

  try {
    // ── 场景 1：按钮可见性 ──
    console.log("  Scene 1: Button visibility...");
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    // 触发 Google 翻译，使悬浮按钮组出现
    await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
    await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 15000 });

    // 验证两个按钮均可见
    const btnVisibility = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const root = host?.shadowRoot || null;
      const btnGoogle = root?.getElementById("btnGoogle") || null;
      const btnAi = root?.getElementById("btnAi") || null;
      const isVisible = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== "none";
      return {
        googleExists: !!btnGoogle,
        aiExists: !!btnAi,
        googleVisible: isVisible(btnGoogle),
        aiVisible: isVisible(btnAi),
      };
    });
    console.log(`    #btnGoogle: exists=${btnVisibility.googleExists}, visible=${btnVisibility.googleVisible}`);
    console.log(`    #btnAi: exists=${btnVisibility.aiExists}, visible=${btnVisibility.aiVisible}`);

    if (!btnVisibility.googleVisible || !btnVisibility.aiVisible) {
      throw new Error(`Floating buttons not visible after Google Translate. Google=${btnVisibility.googleVisible}, AI=${btnVisibility.aiVisible}`);
    }

    // ── 场景 2：点击触发翻译 ──
    console.log("  Scene 2: Button click triggers...");
    // 恢复原文
    await sendMessageToTab(serviceWorker, page.url(), { action: "restorePage" });
    await page.waitForTimeout(1000);

    // 点击 Google 按钮 → 验证触发 Google 翻译
    await page.click("#btnGoogle");
    await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 15000 });
    const googleTriggered = await page.evaluate(() => document.querySelectorAll("translated").length);
    console.log(`    #btnGoogle click: ${googleTriggered} translated nodes`);

    if (googleTriggered === 0) {
      throw new Error("Clicking #btnGoogle did not trigger Google translation");
    }

    // ── 场景 3：AI 按钮状态流转 ──
    console.log("  Scene 3: AI button state transitions...");
    // Google 翻译完成后，autoImproveByAI=yes 会自动触发 AI 翻译
    // 等待 AI 按钮进入终态（成功或错误）
    await page.waitForFunction(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btn = host?.shadowRoot?.getElementById("btnAi") || null;
      if (!btn) return false;
      return !!btn.querySelector(".dualtran-ai-success-check") || !!btn.querySelector(".dualtran-ai-error-cross");
    }, null, { timeout: 30000 }).catch(() => null);

    const aiState = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btn = host?.shadowRoot?.getElementById("btnAi") || null;
      if (!btn) return { exists: false };
      return {
        exists: true,
        text: (btn.textContent || "").trim(),
        hasSuccess: !!btn.querySelector(".dualtran-ai-success-check"),
        hasError: !!btn.querySelector(".dualtran-ai-error-cross"),
      };
    });
    console.log(`    #btnAi state: text="${aiState.text}", success=${aiState.hasSuccess}, error=${aiState.hasError}`);

    // 测试错误场景：临时设置无效 API key
    console.log("  Scene 3b: AI error state with invalid key...");
    await sendMessageToTab(serviceWorker, page.url(), { action: "restorePage" });
    await page.waitForTimeout(500);

    // 保存原始配置
    const origConfig = await serviceWorker.evaluate(async () => {
      return await chrome.storage.local.get(["apiKeyOpenRouter", "providerConfigs"]);
    });

    // 设置无效 key
    await serviceWorker.evaluate(async () => {
      const pc = (await chrome.storage.local.get("providerConfigs")).providerConfigs || {};
      if (pc.openrouter) pc.openrouter.apiKey = "invalid-key-for-error-test";
      await chrome.storage.local.set({ apiKeyOpenRouter: "invalid-key-for-error-test", providerConfigs: pc });
    });
    await page.waitForTimeout(300);

    // 触发翻译 → 等待 AI 错误状态
    await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
    await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 15000 });

    await page.waitForFunction(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btn = host?.shadowRoot?.getElementById("btnAi") || null;
      return btn && !!btn.querySelector(".dualtran-ai-error-cross");
    }, null, { timeout: 30000 }).catch(() => null);

    const errorState = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btn = host?.shadowRoot?.getElementById("btnAi") || null;
      return { hasError: btn ? !!btn.querySelector(".dualtran-ai-error-cross") : false };
    });
    console.log(`    AI error state after invalid key: hasError=${errorState.hasError}`);

    // 恢复原始配置
    await serviceWorker.evaluate(async (config) => {
      await chrome.storage.local.set(config);
    }, origConfig);
    await page.waitForTimeout(300);

    // ── 场景 4：Google/AI 译文切换 ──
    console.log("  Scene 4: Google/AI translation switching...");
    // 临时关闭 autoImproveByAI，确保可以先记录纯 Google 译文
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({ autoImproveByAI: "no" });
    });
    await page.waitForTimeout(300);

    // 恢复页面并触发纯 Google 翻译
    await sendMessageToTab(serviceWorker, page.url(), { action: "restorePage" });
    await page.waitForTimeout(500);
    await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
    await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 15000 });

    // 记录 Google 译文
    const googleText = await page.evaluate(() => {
      const node = document.querySelector("translated");
      return node ? (node.textContent || "").substring(0, 100) : "";
    });
    console.log(`    Google text sample: "${googleText}"`);

    // 重新启用 AI 并等待 AI 翻译完成
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({ autoImproveByAI: "yes" });
    });
    await page.waitForTimeout(300);

    const snippet = mockServerConfig.expectedAiSnippet;
    await page.waitForFunction((s) => {
      return document.body.innerText.includes(s);
    }, snippet, { timeout: 45000 }).catch(() => null);

    const aiText = await page.evaluate(() => {
      const node = document.querySelector("translated");
      return node ? (node.textContent || "").substring(0, 100) : "";
    });
    console.log(`    AI text sample: "${aiText}"`);

    // 验证两种译文不同
    if (googleText && aiText && googleText !== aiText) {
      console.log("    Google and AI translations differ. ✓");
    } else {
      console.log(`    Warning: translations may not differ (google="${googleText}", ai="${aiText}")`);
    }

  } finally {
    // 确保 autoImproveByAI 恢复
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({ autoImproveByAI: "yes" });
    }).catch(() => {});
    detach();
  }
}

// ─── 多提供商 AI 翻译测试 ────────────────────────────────────

/**
 * [9/13] 验证多提供商 AI 翻译（Anthropic + Gemini）。
 * 依次切换 AI 提供商配置，验证每个提供商的 AI 翻译结果都包含 🌐[aimock] 标记。
 */
async function verifyMultiProviderAi(page, serviceWorker, verifyPageUrl, mockServerConfig) {
  const detach = attachPageErrorCollector(page, "multi-provider-ai");
  const configs = mockServerConfig.providerConfigs || {};
  // 跳过 openrouter（已在 step 7 测过）
  const providers = Object.entries(configs).filter(([key]) => key !== "openrouter");

  if (providers.length === 0) {
    console.log("  No additional provider configs defined — skipping multi-provider test.");
    detach();
    return;
  }

  try {
    for (const [providerKey, config] of providers) {
      console.log(`  Testing provider: ${providerKey} (${config.aiProvider})...`);

      // 切换提供商配置
      await serviceWorker.evaluate(async (cfg) => {
        const pc = (await chrome.storage.local.get("providerConfigs")).providerConfigs || {};
        pc[cfg.aiProvider] = { apiKey: cfg.apiKey, apiBase: cfg.apiBase, model: cfg.model };
        await chrome.storage.local.set({
          aiProvider: cfg.aiProvider,
          providerConfigs: pc,
        });
      }, config);
      await page.waitForTimeout(500);

      // 导航到验证页面
      await page.goto(verifyPageUrl, { waitUntil: "domcontentloaded" });
      await waitForContentScriptInjected(serviceWorker, page.url());
      await waitForPageTranslatorReady(serviceWorker, page.url());

      // 触发 Google 翻译
      await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
      await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 30000 });

      // 等待 AI 改进（autoImproveByAI = "yes"）
      const snippet = mockServerConfig.expectedAiSnippet;
      await page.waitForFunction((s) => {
        return document.body.innerText.includes(s);
      }, snippet, { timeout: 45000 }).catch(() => null);

      const result = await page.evaluate((s) => {
        const nodes = document.querySelectorAll("translated");
        let matchCount = 0;
        nodes.forEach((n) => { if ((n.textContent || "").includes(s)) matchCount++; });
        return { total: nodes.length, matchCount };
      }, snippet);

      console.log(`    ${providerKey}: ${result.matchCount}/${result.total} nodes contain ${snippet}`);

      if (result.matchCount === 0) {
        console.log(`    Warning: ${providerKey} AI translation did not produce expected mock text.`);
      }
    }

    // 恢复 OpenRouter 配置
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({ aiProvider: "openrouter" });
    });
  } finally {
    detach();
  }
}

// ═══════════════════════════════════════════════════════════════
// run(scope) — 测试主入口
//
// 按原始 main() 的顺序执行 13 个测试步骤。
// mockServerConfig 通过显式参数传递给各步骤函数，
// 错误收集通过 scope.collector 直接访问。
// ═══════════════════════════════════════════════════════════════

/**
 * 执行翻译 E2E 测试场景的全部 13 个步骤。
 *
 * 所有依赖通过显式参数传递，消除模块级闭包代理变量。
 *
 * @param {Object} scope - setupFull() 返回的作用域对象
 * @param {import("playwright").BrowserContext} scope.context - 浏览器上下文
 * @param {import("playwright").Page} scope.page - Playwright 页面对象
 * @param {string} scope.extensionId - 扩展 ID
 * @param {import("playwright").Worker} scope.serviceWorker - 扩展 Service Worker
 * @param {string} scope.testPageUrl - 基础测试页面 URL
 * @param {string} scope.verifyPageUrl - 富内容验证页面 URL
 * @param {Object} scope.mockServerConfig - Mock 服务器配置
 * @param {ErrorCollector} scope.collector - 错误收集器实例
 * @returns {Promise<Array>} 致命错误数组（由 scope.collector.printSummary() 返回）
 */
export async function run(scope) {
  // ── 模块级代理变量赋值 ──
  attachPageErrorCollector = (page, label) => scope.collector.attachPage(page, label);
  recordError = (source, text, url) => scope.collector.record(source, text, url);

  const { page, extensionId, serviceWorker, testPageUrl, verifyPageUrl } = scope;

  // 导入 runWithIsolatedExtensionContext（已在 setup.mjs 中提取）
  const { runWithIsolatedExtensionContext } = await import("./setup.mjs");

  // ── 阶段 0：检查扩展加载错误 ──
  console.log("[0/13] Checking chrome://extensions for extension load errors...");
  // 此时 extensionId 已知，传入检查特定扩展
  const extensionPageErrors = await scope.collector.collectExtensionErrors(page, null);
  console.log("[0/13] Initial extension error check complete.");

  // ── 执行 13 个测试步骤 ──

  console.log("[1/13] Configuring extension...");
  await configureExtension(page, extensionId, serviceWorker, scope.mockServerConfig);
  console.log("[1/13] Extension configured.");

  console.log("[2/13] Verifying popup...");
  await verifyPopup(page, extensionId);
  console.log("[2/13] Popup verified.");

  console.log("[3/13] Verifying whole-page translation...");
  await verifyWholePageTranslation(page, serviceWorker, testPageUrl);
  console.log("[3/13] Whole-page translation verified.");

  console.log("[4/13] Verifying selected-text translation entry...");
  await verifySelectedTextEntry(page, serviceWorker, testPageUrl);
  console.log("[4/13] Selected-text translation verified.");

  console.log("[5/13] Collecting extension errors from chrome://extensions...");
  await scope.collector.collectExtensionErrors(page, extensionId);
  console.log("[5/13] Extension error check complete.");

  console.log("[6/13] Verifying Google Translate on rich verification page...");
  await verifyGoogleTranslation(page, serviceWorker, verifyPageUrl);
  console.log("[6/13] Google Translate verification complete.");

  console.log("[7/13] Verifying AI translation via mock LLM server...");
  await verifyAiTranslation(page, serviceWorker, verifyPageUrl, scope.mockServerConfig);
  console.log("[7/13] AI translation verification complete.");

  console.log("[8/13] Verifying floating button group...");
  await verifyFloatingButtons(page, serviceWorker, testPageUrl, scope.mockServerConfig);
  console.log("[8/13] Floating button verification complete.");

  console.log("[9/13] Verifying multi-provider AI translation...");
  await verifyMultiProviderAi(page, serviceWorker, verifyPageUrl, scope.mockServerConfig);
  console.log("[9/13] Multi-provider AI verification complete.");

  console.log("[10/13] Verifying popup translate interaction...");
  await verifyPopupTranslateInteraction(page, extensionId, serviceWorker, testPageUrl);
  console.log("[10/13] Popup translate interaction verified.");

  console.log("[11/13] Verifying options page persistence...");
  await runWithIsolatedExtensionContext(async ({ page: optionsPage, extensionId: isolatedExtensionId, serviceWorker: isolatedServiceWorker }) => {
    await verifyOptionsPagePersistence(optionsPage, isolatedExtensionId, isolatedServiceWorker);
  }, scope.collector);
  console.log("[11/13] Options page persistence verified.");

  console.log("[12/13] Verifying dark mode toggle...");
  await runWithIsolatedExtensionContext(async ({ page: darkModePage, extensionId: isolatedExtensionId }) => {
    await verifyDarkModeToggle(darkModePage, isolatedExtensionId);
  }, scope.collector);
  console.log("[12/13] Dark mode toggle verified.");

  console.log("[13/13] Verifying error recovery...");
  await verifyErrorRecovery(page, serviceWorker, testPageUrl, scope);
  console.log("[13/13] Error recovery verified.");

  // ── 错误汇总与报告 ──
  const fatalErrors = scope.collector.printSummary();
  if (fatalErrors.length > 0) {
    console.error(`FAIL: ${fatalErrors.length} fatal error(s) detected.`);
  } else {
    console.log("Browser E2E checks passed.");
  }

  return fatalErrors;
}
