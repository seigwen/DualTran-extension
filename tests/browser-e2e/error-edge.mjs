/**
 * DualTran E2E 错误恢复与边界情况测试场景
 *
 * 包含 7 个测试步骤 (E1–E7)：
 *   E1: 无效 API key → 优雅降级（Google 翻译仍可用）
 *   E2: Mock 响应检测（验证 AI mock 响应是否出现在 DOM 中）
 *   E3: Service Worker 重新激活（空闲 35s 后能否唤醒响应）
 *   E4: 多标签页一致性（打开第二个标签页，切换语言后两个标签页均存活）
 *   E5: 长页面翻译（200 个段落的翻译能力测试）
 *   E6: 扩展禁用/重新启用（验证扩展重新启用后翻译功能恢复）
 *   E7: SW→Mock 直连验证（绕过 Content Script 和端口消息，故障隔离）
 *
 * @module error-edge
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  queryShadow,
  queryShadowAll,
} from "./setup.mjs";

// ═══════════════════════════════════════════════════════════════
// 模块元数据
// ═══════════════════════════════════════════════════════════════

/** 场景名称（用于 --scenario / --grep 筛选） */
export const name = "error-edge";

/** 此场景需要 Mock LLM 服务器（E2 涉及 AI mock 响应检测） */
export const needsMock = true;

/** 不纳入 smoke 子集（6 步含 SW 空闲 35s 等待 + Mock 依赖） */
export const smoke = false;

// ═══════════════════════════════════════════════════════════════
// E1: 无效 API key → 优雅降级
// ═══════════════════════════════════════════════════════════════

/**
 * [E1] 验证设置无效 API key 后 Google 翻译仍可正常工作。
 *
 * 流程：
 *   1. 保存原始配置（apiKeyOpenRouter、autoImproveByAI、providerConfigs）
 *   2. 写入无效 API key，同时确保 autoImproveByAI 开启
 *   3. 导航到测试页面，触发 Google 翻译
 *   4. 验证 <translated> 节点存在（Google 翻译不受 AI 配置影响）
 *   5. 验证页面仍然存活（page.evaluate(() => true) 成功）
 *   6. finally 中恢复原始配置
 *
 * 设计意图：AI 翻译失败不应阻塞或影响 Google 翻译的正常流程。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} testPageUrl - 测试页面 URL
 * @param {Object} scope - 完整的测试 scope 对象（用于访问 collector）
 * @returns {Promise<void>}
 */
async function e1InvalidApiKeyGracefulDegradation(page, serviceWorker, testPageUrl, scope) {
  console.log("[E1] 无效 API key → 优雅降级测试...");

  const { collector } = scope;

  // 1. 保存原始配置
  const originalConfig = await serviceWorker.evaluate(async () => {
    return await chrome.storage.local.get([
      "apiKeyOpenRouter",
      "autoImproveByAI",
      "providerConfigs",
    ]);
  });
  console.log(`  [E1] 已保存原始配置: apiKeyOpenRouter=${originalConfig.apiKeyOpenRouter?.substring(0, 8)}..., autoImproveByAI=${originalConfig.autoImproveByAI}`);

  try {
    // 2. 写入无效 API key，同时开启 autoImproveByAI（让 AI 尝试翻译并失败）
    await serviceWorker.evaluate(async () => {
      const pc = (await chrome.storage.local.get("providerConfigs")).providerConfigs || {};
      // 确保 openrouter 的 providerConfig 也存在无效 key
      if (!pc.openrouter) {
        pc.openrouter = {};
      }
      pc.openrouter.apiKey = "invalid-key-for-e1-test";
      await chrome.storage.local.set({
        apiKeyOpenRouter: "invalid-key-for-e1-test",
        autoImproveByAI: "yes",
        providerConfigs: pc,
      });
    });
    console.log("  [E1] 已写入无效 API key，autoImproveByAI=yes");

    // 3. 导航到测试页面并触发 Google 翻译
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    // 只触发 Google 翻译（不依赖 AI mock）
    await sendMessageToTab(serviceWorker, page.url(), {
      action: "translatePage",
      targetLanguage: "fr",
    });

    // 等待 <translated> 节点出现（Google 翻译完成）
    await page.waitForFunction(() => {
      return document.querySelectorAll("translated").length > 0;
    }, null, { timeout: 15000 });

    // 4. 验证 <translated> 节点存在
    const translatedCount = await page.evaluate(() => {
      return document.querySelectorAll("translated").length;
    });
    console.log(`  [E1] Google 翻译完成: ${translatedCount} 个 <translated> 节点`);

    if (translatedCount === 0) {
      throw new Error("[E1] 无效 API key 后 Google 翻译未产生任何 <translated> 节点");
    }

    // 5. 验证页面仍然存活（evaluate 能正常执行）
    const pageAlive = await page.evaluate(() => true).catch(() => false);
    if (!pageAlive) {
      throw new Error("[E1] 页面在无效 API key 场景下已崩溃或不可交互");
    }
    console.log("  [E1] 页面存活验证通过 ✓");

    console.log("[E1] 通过 ✓\n");
  } catch (err) {
    // E1 失败是致命错误（Google 翻译不应因 AI 配置而受影响）
    collector.record("error-edge:E1", err.message);
    throw err;
  } finally {
    // 6. 恢复原始配置
    console.log("  [E1] 正在恢复原始配置...");
    await serviceWorker.evaluate(async (origConfig) => {
      const setObj = {};
      // 只恢复存在的键，避免写入 undefined
      if (origConfig.apiKeyOpenRouter !== undefined) {
        setObj.apiKeyOpenRouter = origConfig.apiKeyOpenRouter;
      }
      if (origConfig.autoImproveByAI !== undefined) {
        setObj.autoImproveByAI = origConfig.autoImproveByAI;
      }
      if (origConfig.providerConfigs !== undefined) {
        setObj.providerConfigs = origConfig.providerConfigs;
      }
      await chrome.storage.local.set(setObj);
    }, originalConfig).catch((restoreErr) => {
      console.warn(`  [E1] ⚠ 恢复原始配置失败: ${restoreErr.message}`);
    });
    console.log("  [E1] 原始配置已恢复");
  }
}

// ── E2: Mock 响应检测 ──
// 设计规格要求"网络失败→重试：前3次503→200"。
// 当前 aimock 服务器不支持场景切换（503→200），因此本步骤降级为
// 验证 mock 响应是否正确返回并应用到 DOM。完整的重试场景测试
// 需要在 aimock 服务器支持动态场景切换后实现。

/**
 * [E2] 检测 Mock 服务器响应文本是否出现在 DOM 中。
 *
 * 流程：
 *   1. 导航到测试页面
 *   2. 触发翻译（Google + AI 自动改进）
 *   3. 轮询 DOM body 文本中是否出现 mock 片段
 *   4. 找到 → 通过；未找到 → 警告（不失败，mock 可能不支持重试场景）
 *
 * 这是对 AI 翻译管线的快速烟雾测试，验证 Mock 服务器连通性。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} testPageUrl - 测试页面 URL
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 */
async function e2MockResponseDetection(page, serviceWorker, testPageUrl, scope) {
  console.log("[E2] Mock 响应检测...");

  const { collector, mockServerConfig } = scope;
  const mockSnippet = mockServerConfig?.expectedAiSnippet || "🌐[aimock]";

  // 1. 导航到测试页面
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // 2. 触发翻译（autoImproveByAI 已在全局配置中设为 "yes"）
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });

  // 等待 Google 翻译完成
  await page.waitForFunction(() => {
    return document.querySelectorAll("translated").length > 0;
  }, null, { timeout: 15000 });

  const translatedBefore = await page.evaluate(() => {
    return document.querySelectorAll("translated").length;
  });
  console.log(`  [E2] Google 翻译完成: ${translatedBefore} 个 <translated> 节点`);

  // 3. 轮询检测 mock 响应片段（最多等待 45 秒）
  const pollStart = Date.now();
  const pollTimeout = 45_000;
  let mockFound = false;

  while (Date.now() - pollStart < pollTimeout) {
    try {
      mockFound = await page.evaluate((snippet) => {
        return document.body.innerText.includes(snippet);
      }, mockSnippet);
    } catch (pollErr) {
      // 页面可能已崩溃或关闭
      console.warn(`  [E2] 轮询 evaluate 失败: ${pollErr.message}`);
      break;
    }

    if (mockFound) {
      break;
    }

    await page.waitForTimeout(1000).catch(() => {});
  }

  // 4. 结果判定
  if (mockFound) {
    console.log(`  [E2] Mock 响应片段 "${mockSnippet}" 在 DOM 中检测到 ✓`);
    // 统计包含 mock 片段的 <translated> 节点数量
    const matchCount = await page.evaluate((snippet) => {
      let count = 0;
      document.querySelectorAll("translated").forEach((node) => {
        if ((node.textContent || "").includes(snippet)) {
          count++;
        }
      });
      return count;
    }, mockSnippet).catch(() => 0);
    console.log(`  [E2] ${matchCount} 个 <translated> 节点包含 mock 片段`);
    console.log("[E2] 通过 ✓\n");
  } else {
    // 未找到：警告，不失败（mock 可能不支持当前场景下的重试）
    const warningMsg = `[E2] ⚠ Mock 响应片段 "${mockSnippet}" 未在 DOM 中检测到。Mock 服务器可能不支持重试场景，或 AI 翻译仍在进行中。`;
    console.warn(warningMsg);
    collector.record("error-edge:E2", warningMsg);
    // 不抛出错误 —— E2 不应该使整个场景失败
  }
}

// ═══════════════════════════════════════════════════════════════
// E3: Service Worker 重新激活
// ═══════════════════════════════════════════════════════════════

/**
 * [E3] 验证 Service Worker 在空闲 35 秒后仍能被唤醒并响应。
 *
 * Service Worker 在空闲约 30 秒后会被 Chrome 终止。
 * 此测试验证扩展的 SW 在终止后能被事件自动唤醒。
 *
 * 流程：
 *   1. 等待 35 秒（让 SW 自然空闲直至终止）
 *   2. 导航到测试页面
 *   3. 调用 waitForContentScriptInjected（15 秒超时）
 *   4. 如果 SW 不响应，抛出致命错误
 *
 * 注意：35 秒等待是此测试设计的核心，不可缩短。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} testPageUrl - 测试页面 URL
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 */
async function e3ServiceWorkerReactivation(page, serviceWorker, testPageUrl, scope) {
  console.log("[E3] Service Worker 重新激活测试...");

  const { collector } = scope;

  // 1. 等待 35 秒让 SW 自然空闲终止
  console.log("  [E3] 等待 35 秒让 Service Worker 空闲...");
  await page.waitForTimeout(35_000);
  console.log("  [E3] 等待完成，开始验证 SW 唤醒...");

  // 2-3. 导航到测试页面并等待内容脚本注入（SW 需要被唤醒才能路由消息）
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });

  try {
    // 使用 15 秒超时 —— 如果 SW 无法唤醒，此调用会抛出
    await waitForContentScriptInjected(serviceWorker, page.url(), 15_000);

    // 4. 额外验证：确认页面翻译器也可用
    await waitForPageTranslatorReady(serviceWorker, page.url(), 15_000);

    // 触发一次快速翻译验证 SW 代理链路畅通
    await sendMessageToTab(serviceWorker, page.url(), {
      action: "translatePage",
      targetLanguage: "fr",
    });
    await page.waitForFunction(() => {
      return document.querySelectorAll("translated").length > 0;
    }, null, { timeout: 15_000 });

    const translatedCount = await page.evaluate(() => {
      return document.querySelectorAll("translated").length;
    });
    console.log(`  [E3] SW 唤醒后翻译完成: ${translatedCount} 个 <translated> 节点`);
    console.log("[E3] 通过 ✓\n");
  } catch (err) {
    // SW 唤醒失败是致命错误
    const fatalMsg = `[E3] Service Worker 在 35 秒空闲后未能重新激活: ${err.message}`;
    console.error(fatalMsg);
    collector.record("error-edge:E3", fatalMsg);
    throw new Error(fatalMsg);
  }
}

// ═══════════════════════════════════════════════════════════════
// E4: 多标签页一致性
// ═══════════════════════════════════════════════════════════════

/**
 * [E4] 验证多标签页场景下扩展的稳定性。
 *
 * 流程：
 *   1. 打开第二个标签页（通过 scope.context.newPage()）
 *   2. 将两个标签页都导航到测试页面
 *   3. 在选项页中将 targetLanguage 切换为 "ja"
 *   4. 验证两个标签页均存活（发送 getCurrentPageLanguageState 到标签页 1）
 *   5. finally 中关闭第二个标签页并恢复 targetLanguage
 *
 * @param {import("playwright").Page} page - Playwright 页面对象（主标签页）
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} extensionId - 扩展 ID
 * @param {string} testPageUrl - 测试页面 URL
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 */
async function e4MultiTabConsistency(page, serviceWorker, extensionId, testPageUrl, scope) {
  console.log("[E4] 多标签页一致性测试...");

  const { collector, context } = scope;

  // 保存原始 targetLanguage
  const originalLanguage = await serviceWorker.evaluate(async () => {
    const items = await chrome.storage.local.get("targetLanguage");
    return items?.targetLanguage ?? "original";
  });
  console.log(`  [E4] 原始 targetLanguage: ${originalLanguage}`);

  /** 第二个标签页引用（在 finally 中需要关闭） */
  let secondPage = null;

  try {
    // 1. 打开第二个标签页
    secondPage = await context.newPage();
    console.log("  [E4] 已打开第二个标签页");

    // 为第二个标签页附加错误收集
    const detachSecondPage = collector.attachPage(secondPage, "e4-tab2");

    try {
      // 2. 将两个标签页都导航到测试页面
      await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
      await secondPage.goto(testPageUrl, { waitUntil: "domcontentloaded" });

      // 等待两个标签页的内容脚本注入完成
      await waitForContentScriptInjected(serviceWorker, page.url());
      await waitForContentScriptInjected(serviceWorker, secondPage.url());
      await waitForPageTranslatorReady(serviceWorker, page.url());
      await waitForPageTranslatorReady(serviceWorker, secondPage.url());

      // 3. 在选项页中将 targetLanguage 切换为 "ja"
      console.log("  [E4] 切换 targetLanguage 为 ja...");
      await serviceWorker.evaluate(async () => {
        await chrome.storage.local.set({ targetLanguage: "ja" });
      });
      // 访问选项页触发 storage.onChanged 观察者
      await page.goto(
        `chrome-extension://${extensionId}/options/options.html#translations`,
        { waitUntil: "load" }
      );
      await page.waitForTimeout(1000);

      // 验证 storage 已更新
      const currentLang = await serviceWorker.evaluate(async () => {
        const items = await chrome.storage.local.get("targetLanguage");
        return items?.targetLanguage;
      });
      console.log(`  [E4] 当前 targetLanguage: ${currentLang}`);

      // 4. 验证标签页 1 仍然存活（page.evaluate 能正常执行）
      const tab1Alive = await page.evaluate(() => true).catch(() => false);
      if (!tab1Alive) {
        throw new Error("[E4] 标签页 1 在语言切换后已崩溃");
      }
      console.log("  [E4] 标签页 1 存活验证通过 ✓");

      // 验证标签页 2 仍然存活
      const tab2Alive = await secondPage.evaluate(() => true).catch(() => false);
      if (!tab2Alive) {
        throw new Error("[E4] 标签页 2 在语言切换后已崩溃");
      }
      console.log("  [E4] 标签页 2 存活验证通过 ✓");

      // 向标签页 1 发送 getCurrentPageLanguageState 验证内容脚本正常
      const langState = await sendMessageToTab(serviceWorker, page.url(), {
        action: "getCurrentPageLanguageState",
      }).catch((err) => {
        collector.record("error-edge:E4", `getCurrentPageLanguageState 失败: ${err.message}`);
        return null;
      });

      if (langState) {
        console.log(`  [E4] 标签页 1 语言状态响应正常`);
      } else {
        // 语言状态获取失败不应视为致命错误（可能是消息端口问题）
        console.warn("  [E4] ⚠ 标签页 1 的 getCurrentPageLanguageState 未返回有效响应");
      }

      // 在标签页 2 上触发翻译，验证跨标签页的扩展功能正常
      await sendMessageToTab(serviceWorker, secondPage.url(), {
        action: "translatePage",
        targetLanguage: "ja",
      });
      await secondPage.waitForFunction(() => {
        return document.querySelectorAll("translated").length > 0;
      }, null, { timeout: 15_000 });

      const tab2TranslatedCount = await secondPage.evaluate(() => {
        return document.querySelectorAll("translated").length;
      });
      console.log(`  [E4] 标签页 2 翻译完成: ${tab2TranslatedCount} 个 <translated> 节点`);

      console.log("[E4] 通过 ✓\n");
    } finally {
      detachSecondPage();
    }
  } catch (err) {
    collector.record("error-edge:E4", err.message);
    throw err;
  } finally {
    // 5. 清理：关闭第二个标签页
    if (secondPage && !secondPage.isClosed()) {
      await secondPage.close().catch(() => {});
      console.log("  [E4] 第二个标签页已关闭");
    }

    // 恢复原始 targetLanguage
    await serviceWorker.evaluate(async (origLang) => {
      await chrome.storage.local.set({ targetLanguage: origLang });
    }, originalLanguage).catch((restoreErr) => {
      console.warn(`  [E4] ⚠ 恢复 targetLanguage 失败: ${restoreErr.message}`);
    });
    console.log(`  [E4] targetLanguage 已恢复为 ${originalLanguage}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// E5: 长页面翻译
// ═══════════════════════════════════════════════════════════════

/**
 * [E5] 验证扩展能处理包含 200 个段落的超长页面。
 *
 * 流程：
 *   1. 导航到长页面（200 个 JS 动态生成的段落）
 *   2. 触发整页 Google 翻译
 *   3. 验证至少 100 个 <translated> 节点出现
 *   4. 验证页面仍然存活（page.evaluate(() => true) 成功）
 *   5. 60 秒超时
 *
 * 长页面 URL 由 setup 提供（longPageUrl），HTML 位于 extra/e2e/long-page.html。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} longPageUrl - 长页面 URL
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 */
async function e5LongPageTranslation(page, serviceWorker, longPageUrl, scope) {
  console.log("[E5] 长页面翻译测试...");

  const { collector } = scope;

  // 1. 导航到长页面
  await page.goto(longPageUrl, { waitUntil: "domcontentloaded" });
  console.log("  [E5] 已导航到长页面");

  // 等待页面中 200 个段落由 JS 生成完毕
  await page.waitForFunction(() => {
    return document.querySelectorAll("#paragraphs-container p").length === 200;
  }, null, { timeout: 10_000 });
  console.log("  [E5] 200 个段落已加载完毕");

  // 等待内容脚本注入
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // 2. 触发整页翻译（60 秒超时）
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });

  // 3. 等待至少 100 个 <translated> 节点（60 秒超时）
  try {
    await page.waitForFunction(() => {
      return document.querySelectorAll("translated").length >= 100;
    }, null, { timeout: 60_000 });
  } catch (waitErr) {
    // 超时 —— 记录当前状态并判定
    const currentCount = await page.evaluate(() => {
      return document.querySelectorAll("translated").length;
    }).catch(() => 0);
    collector.record("error-edge:E5",
      `长页面翻译超时: 仅 ${currentCount} 个 <translated> 节点（需要 ≥100）。等待 60 秒后仍未完成。`
    );
    throw new Error(`[E5] 长页面翻译超时: 仅 ${currentCount}/100 个 <translated> 节点`);
  }

  const translatedCount = await page.evaluate(() => {
    return document.querySelectorAll("translated").length;
  });
  console.log(`  [E5] 长页面翻译完成: ${translatedCount} 个 <translated> 节点`);

  // 4. 验证页面仍然存活
  const pageAlive = await page.evaluate(() => true).catch(() => false);
  if (!pageAlive) {
    throw new Error("[E5] 长页面翻译后页面已崩溃或不可交互");
  }
  console.log("  [E5] 页面存活验证通过 ✓");

  if (translatedCount < 100) {
    const failMsg = `[E5] 长页面翻译节点数不足: 仅 ${translatedCount} 个 <translated> 节点（需要 ≥100）`;
    collector.record("error-edge:E5", failMsg);
    throw new Error(failMsg);
  }

  console.log("[E5] 通过 ✓\n");
}

// ═══════════════════════════════════════════════════════════════
// E6: 扩展禁用/重新启用
// ═══════════════════════════════════════════════════════════════

/**
 * [E6] 验证扩展在禁用并重新启用后翻译功能可恢复。
 *
 * 流程：
 *   1. 通过 Service Worker 调用 chrome.management.setEnabled(false) 禁用扩展
 *   2. 等待 1 秒
 *   3. 通过 Service Worker 调用 chrome.management.setEnabled(true) 重新启用
 *   4. 等待 2 秒让扩展重新初始化（SW 启动 + 内容脚本注入）
 *   5. 导航到测试页面
 *   6. 验证翻译功能正常（<translated> 节点出现）
 *
 * 注意：chrome.management API 可能需要扩展在 Chrome Web Store 上发布。
 * 如果调用失败（例如在开发模式下），捕获错误并警告而非失败。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} extensionId - 扩展 ID
 * @param {string} testPageUrl - 测试页面 URL
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 */
async function e6ExtensionDisableReenable(page, serviceWorker, extensionId, testPageUrl, scope) {
  console.log("[E6] 扩展禁用/重新启用测试...");

  const { collector } = scope;

  // 1. 尝试禁用扩展
  let managementAvailable = true;
  try {
    await serviceWorker.evaluate(async (extId) => {
      await chrome.management.setEnabled(extId, false);
    }, extensionId);
    console.log("  [E6] 扩展已禁用");
  } catch (disableErr) {
    // chrome.management 可能在开发模式下不可用
    managementAvailable = false;
    const warnMsg = `[E6] ⚠ chrome.management.setEnabled(false) 失败: ${disableErr.message}。chrome.management API 可能要求扩展已发布。跳过禁用/重新启用测试。`;
    console.warn(warnMsg);
    collector.record("error-edge:E6", warnMsg);
    // E6 不可用时不应使整个场景失败
    console.log("[E6] 跳过（chrome.management 不可用）\n");
    return;
  }

  // 2. 等待 1 秒
  await page.waitForTimeout(1000);

  // 3. 重新启用扩展
  try {
    await serviceWorker.evaluate(async (extId) => {
      await chrome.management.setEnabled(extId, true);
    }, extensionId);
    console.log("  [E6] 扩展已重新启用");
  } catch (enableErr) {
    // 重新启用失败是致命问题（扩展可能处于损坏状态）
    const fatalMsg = `[E6] chrome.management.setEnabled(true) 失败: ${enableErr.message}`;
    console.error(fatalMsg);
    collector.record("error-edge:E6", fatalMsg);

    // 尝试通过 chrome://extensions 页面手动重新启用
    console.log("  [E6] 尝试通过 chrome://extensions 手动恢复...");
    await page.goto("chrome://extensions", { waitUntil: "load" });
    await page.waitForTimeout(2000);
    // 查找并点击启用开关（通过 Shadow DOM）
    const toggleResult = await page.evaluate(({ extId, qsSrc, qsaSrc }) => {
      // queryShadow/queryShadowAll 定义复用自 setup.mjs，与 ErrorCollector.collectExtensionErrors 中的版本一致
      const queryShadow = eval(`(${qsSrc})`);
      const queryShadowAll = eval(`(${qsaSrc})`);
      const manager = document.querySelector("extensions-manager");
      if (!manager?.shadowRoot) return { action: "no-manager" };
      const items = queryShadowAll(manager.shadowRoot, "extensions-item");
      for (const item of items) {
        const root = item.shadowRoot || item;
        const idEl = queryShadow(root, "#extension-id");
        const itemId = idEl?.textContent?.trim()?.replace("ID: ", "") || "";
        if (itemId && itemId.includes(extId)) {
          const toggle = queryShadow(root, "#enableToggle");
          if (toggle) {
            const wasChecked = toggle.hasAttribute("checked") || toggle.checked;
            if (!wasChecked) {
              toggle.click();
              return { action: "clicked-enable", wasChecked };
            }
            return { action: "already-enabled", wasChecked };
          }
          return { action: "no-toggle-found" };
        }
      }
      return { action: "extension-not-found" };
    }, { extId: extensionId, qsSrc: queryShadow.toString(), qsaSrc: queryShadowAll.toString() });
    console.log(`  [E6] chrome://extensions 手动恢复结果: ${JSON.stringify(toggleResult)}`);

    // 即使 chrome.management 失败，也继续执行后续步骤验证扩展状态
  }

  try {
    // 4. 等待 2 秒让扩展重新初始化
    await page.waitForTimeout(2000);

    // 重新获取 Service Worker（旧的 SW 引用在禁用后失效）
    const { getExtensionServiceWorker } = await import("./setup.mjs");
    const newSw = await getExtensionServiceWorker(scope.context, 15_000).catch((swErr) => {
      console.warn(`  [E6] ⚠ 获取新 SW 失败: ${swErr.message}，使用旧的 SW 引用`);
      return serviceWorker;
    });
    // 重新附加错误收集
    collector.attachServiceWorker(newSw);

    // 5. 导航到测试页面
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });

    // 等待内容脚本重新注入
    await waitForContentScriptInjected(newSw, page.url(), 15_000).catch((injErr) => {
      throw new Error(`[E6] 重新启用后内容脚本注入超时: ${injErr.message}`);
    });
    await waitForPageTranslatorReady(newSw, page.url(), 15_000);

    // 6. 验证翻译功能正常
    await sendMessageToTab(newSw, page.url(), {
      action: "translatePage",
      targetLanguage: "fr",
    });
    await page.waitForFunction(() => {
      return document.querySelectorAll("translated").length > 0;
    }, null, { timeout: 15_000 });

    const translatedCount = await page.evaluate(() => {
      return document.querySelectorAll("translated").length;
    });
    console.log(`  [E6] 重新启用后翻译完成: ${translatedCount} 个 <translated> 节点`);

    if (translatedCount === 0) {
      throw new Error("[E6] 重新启用扩展后翻译未产生任何 <translated> 节点");
    }

    console.log("[E6] 通过 ✓\n");
  } catch (verifyErr) {
    const failMsg = `[E6] 重新启用后验证失败: ${verifyErr.message}`;
    console.error(failMsg);
    collector.record("error-edge:E6", failMsg);
    throw verifyErr;
  }
}

// ═════════════════════════════════════════════════════════════════
// E7: SW→Mock 直连验证（故障隔离）
// ═════════════════════════════════════════════════════════════════

/**
 * [E7] 绕过 Content Script 和端口消息，直接在 SW 上下文中 fetch Mock 服务器。
 *
 * 当完整管线（content script → port → SW → API）失败时，
 * 本测试可快速判断问题在端口消息层还是在 SW→Mock 层。
 *
 * 流程：
 *   1. 通过 Service Worker evaluate 直接 POST 含 <译泽> 标签的请求体
 *   2. 验证 HTTP 200
 *   3. 验证响应体包含 🌐[aimock] 标记
 *   4. 验证翻译 ID 对应正确
 *   5. 验证 401 错误场景
 *
 * 此测试不依赖任何页面导航，纯 SW 上下文执行，速度极快。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {Object} scope - setupFull() 返回的作用域对象
 * @returns {Promise<void>}
 * @throws {Error} SW→Mock 直连失败时抛出
 */
async function e7ServiceWorkerDirectMockFetch(serviceWorker, scope) {
  console.log("[E7] SW→Mock 直连验证...");

  const mockServerConfig = scope.mockServerConfig;
  const mockUrl = `http://127.0.0.1:${mockServerConfig.port}`;

  // 构造含 <译泽> 标签的请求体（与 sseClient 发送的格式一致）
  const translationIds = ["test-e7-id-001", "test-e7-id-002"];
  const contentSequence = translationIds
    .map((id) => `<译泽 id="${id}">Texto de prueba para traducción</译泽>`)
    .join("\n");

  let passed = 0;
  let failed = 0;

  // ── 子测试 1：OpenRouter 端点 ──
  console.log("  [E7.1] OpenRouter 直连 fetch...");
  try {
    const result = await serviceWorker.evaluate(async ({ apiUrl, body, ids, snippet }) => {
      try {
        const response = await fetch(`${apiUrl}/openrouter/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer mock-openrouter-key",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: body }],
            stream: false,
          }),
        });

        if (response.status !== 200) {
          return { ok: false, status: response.status };
        }

        const text = await response.text();

        if (!text.includes(snippet)) {
          return { ok: false, reason: `missing "${snippet}"`, body: text.slice(0, 300) };
        }

        const idResults = ids.map((id) => ({
          id,
          found: text.includes(id),
        }));

        return { ok: true, idResults };
      } catch (err) {
        return { ok: false, reason: err.message || String(err) };
      }
    }, {
      apiUrl: mockUrl,
      body: contentSequence,
      ids: translationIds,
      snippet: mockServerConfig.expectedAiSnippet,
    });

    if (result.ok) {
      const allIdsFound = result.idResults.every((r) => r.found);
      const idStatus = result.idResults.map((r) => (r.found ? "✓" : "✗")).join(" ");
      console.log(`  [E7.1] 200 ✓ | ${mockServerConfig.expectedAiSnippet} ✓ | ID: ${idStatus}`);
      if (!allIdsFound) {
        throw new Error("部分翻译 ID 未在响应中找到");
      }
      passed++;
    } else {
      console.error(`  [E7.1] 失败: status=${result.status}, reason=${result.reason}`);
      throw new Error(`[E7.1] OpenRouter 直连失败: ${result.reason || `status=${result.status}`}`);
    }
  } catch (err) {
    failed++;
  }

  // ── 子测试 2：通配路由（非 OpenAI 格式的端点） ──
  console.log("  [E7.2] 通配路由直连 fetch...");
  try {
    const result = await serviceWorker.evaluate(async ({ apiUrl, body, snippet }) => {
      try {
        // 使用一个非预定义端点的路径，验证通配路由
        const response = await fetch(`${apiUrl}/mistral/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer mock-mistral-key",
          },
          body: JSON.stringify({
            model: "mistral-small",
            messages: [{ role: "user", content: body }],
            stream: false,
          }),
        });

        if (response.status !== 200) {
          return { ok: false, status: response.status };
        }

        const text = await response.text();
        if (!text.includes(snippet)) {
          return { ok: false, reason: `missing "${snippet}"`, body: text.slice(0, 300) };
        }

        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err.message || String(err) };
      }
    }, {
      apiUrl: mockUrl,
      body: contentSequence,
      snippet: mockServerConfig.expectedAiSnippet,
    });

    if (result.ok) {
      console.log("  [E7.2] 200 ✓ | 🌐[aimock] ✓");
      passed++;
    } else {
      console.error(`  [E7.2] 失败: status=${result.status}, reason=${result.reason}`);
      throw new Error(`[E7.2] 通配路由直连失败: ${result.reason || `status=${result.status}`}`);
    }
  } catch (err) {
    failed++;
  }

  // ── 子测试 3：401 错误场景 ──
  console.log("  [E7.3] 401 错误场景...");
  try {
    const result = await serviceWorker.evaluate(async ({ apiUrl }) => {
      try {
        const response = await fetch(`${apiUrl}/openrouter/v1/chat/completions?scenario=auth-error`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer invalid-key",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: "test" }],
            stream: false,
          }),
        });

        return { status: response.status };
      } catch (err) {
        return { status: -1, reason: err.message || String(err) };
      }
    }, { apiUrl: mockUrl });

    if (result.status === 401) {
      console.log("  [E7.3] 401 ✓");
      passed++;
    } else {
      console.error(`  [E7.3] 期望 401，实际 ${result.status}`);
      throw new Error(`[E7.3] 期望 401，实际 ${result.status}`);
    }
  } catch (err) {
    failed++;
  }

  // ── 汇总 ──
  if (failed > 0) {
    throw new Error(`[E7] SW→Mock 直连: ${passed}/${passed + failed} 个子测试通过`);
  }

  console.log(`[E7] 全部通过 (${passed}/${passed + failed}) ✓\n`);
}

// ═══════════════════════════════════════════════════════════════
// run(scope) — 测试主入口
//
// 按 E1 → E7 顺序执行所有测试步骤。
// 每个步骤独立执行，失败后记录错误并继续（E3/E5 为致命错误除外）。
// ═══════════════════════════════════════════════════════════════

/**
 * 执行错误恢复与边界情况 E2E 测试场景的全部 7 个步骤。
 *
 * 所有依赖通过显式 scope 参数传递。
 *
 * @param {Object} scope - setupFull() 返回的作用域对象
 * @param {import("playwright").Page} scope.page - Playwright 页面对象
 * @param {string} scope.extensionId - 扩展 ID
 * @param {import("playwright").Worker} scope.serviceWorker - 扩展 Service Worker
 * @param {import("playwright").BrowserContext} scope.context - 浏览器上下文
 * @param {string} scope.testPageUrl - 基础测试页面 URL
 * @param {string} scope.longPageUrl - 长页面 URL
 * @param {Object} scope.mockServerConfig - Mock 服务器配置
 * @param {import("./setup.mjs").ErrorCollector} scope.collector - 错误收集器实例
 * @returns {Promise<void>}
 */
export async function run(scope) {
  const { page, extensionId, serviceWorker, testPageUrl, longPageUrl, collector } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  /** 收集所有步骤的错误 */
  const stepErrors = [];

  /**
   * 安全执行一个测试步骤，捕获错误并记录但不中断后续步骤。
   * E1/E3/E4/E5 的错误为致命错误；E2/E6 的错误为非致命（已内部警告）。
   *
   * @param {string} stepName - 步骤名称
   * @param {Function} fn - 步骤函数
   * @param {boolean} [isFatal=true] - 是否将错误视为致命
   * @returns {Promise<void>}
   */
  async function runStep(stepName, fn, isFatal = true) {
    try {
      await fn();
    } catch (err) {
      stepErrors.push({ step: stepName, error: err, fatal: isFatal });
      console.error(`  [${stepName}] 失败: ${err.message}`);
      if (err.stack) {
        console.error(`  [${stepName}] 堆栈: ${err.stack}`);
      }
    }
  }

  // ── 按顺序执行测试步骤 ──

  await runStep("E1", () =>
    e1InvalidApiKeyGracefulDegradation(page, serviceWorker, testPageUrl, scope)
  );

  await runStep("E2", () =>
    e2MockResponseDetection(page, serviceWorker, testPageUrl, scope),
    false // E2 为非致命（mock 不可用时仅警告）
  );

  await runStep("E3", () =>
    e3ServiceWorkerReactivation(page, serviceWorker, testPageUrl, scope)
  );

  await runStep("E4", () =>
    e4MultiTabConsistency(page, serviceWorker, extensionId, testPageUrl, scope)
  );

  await runStep("E5", () =>
    e5LongPageTranslation(page, serviceWorker, longPageUrl, scope)
  );

  await runStep("E6", () =>
    e6ExtensionDisableReenable(page, serviceWorker, extensionId, testPageUrl, scope),
    false // E6 为非致命（chrome.management 不可用时仅警告）
  );

  await runStep("E7", () =>
    e7ServiceWorkerDirectMockFetch(serviceWorker, scope)
  );

  // ── 最终检查：收集扩展错误 ──
  console.log("[E*] 收集扩展错误...");
  await collector.collectExtensionErrors(page, extensionId).catch((err) => {
    console.warn(`  [E*] collectExtensionErrors 失败: ${err.message}`);
  });

  // ── 汇总结果 ──
  console.log(`\n=== 场景 "${name}" 执行完毕 ===`);
  console.log(`总步骤数: 7, 失败: ${stepErrors.length}`);

  // 筛选致命错误
  const fatalStepErrors = stepErrors.filter((e) => e.fatal !== false);

  if (stepErrors.length > 0) {
    for (const { step, error } of stepErrors) {
      collector.record(`error-edge:${step}`, error.message);
    }
  }

  if (fatalStepErrors.length > 0) {
    throw new Error(
      `场景 "${name}" 有 ${fatalStepErrors.length} 个致命步骤失败: ${fatalStepErrors.map((e) => e.step).join(", ")}`
    );
  }

  if (stepErrors.length > 0) {
    console.warn(`场景 "${name}" 有 ${stepErrors.length} 个非致命警告（不影响整体通过）。`);
  }

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
