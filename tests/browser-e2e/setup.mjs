/**
 * DualTran E2E 测试共享基础设施
 *
 * 提供 ErrorCollector 类和共享工具函数，供各个测试场景文件导入使用。
 * 所有函数均从 tests/browser-e2e.mjs 中提取，保持原始逻辑不变。
 *
 * @module setup
 */

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

// 导入共享测试服务器管理模块
import {
  startAimockServer as _startAimockServer,
  startStaticServer as _startStaticServer,
  stopAimockServer as _stopAimockServer,
  stopStaticServer as _stopStaticServer,
} from "../shared/test-server-manager.mjs";

// ─── 路径常量 ────────────────────────────────────────────────

/** 项目根目录（运行脚本时的工作目录） */
const projectRoot = process.cwd();

/** 构建后的扩展目录，Playwright 将加载此目录作为 Chrome 扩展 */
const extensionPath = path.join(projectRoot, "dist", "chrome");

/**
 * 准备 E2E 使用的扩展目录：
 * 把 dist/chrome 拷贝到临时目录，并把 webNavigation 从 optional_permissions
 * 提升为核心 permissions。webNavigation 是"自动翻译点击链接"功能的可选权限，
 * 生产环境由用户在弹窗里授权（原生权限气泡无法在 E2E 中点击）；
 * 测试环境直接预授权，保证 O-C 场景可验证完整链路。产品 manifest 不改动。
 *
 * @returns {Promise<string>} 准备好的扩展目录路径
 */
let preparedExtensionDirPromise = null;
async function prepareExtensionDir() {
  if (preparedExtensionDirPromise) return preparedExtensionDirPromise;
  preparedExtensionDirPromise = (async () => {
    const srcDir = extensionPath;
    const destDir = await fs.mkdtemp(path.join(os.tmpdir(), "dualtran-ext-e2e-"));
    await fs.cp(srcDir, destDir, { recursive: true });

    const manifestPath = path.join(destDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest.permissions)) manifest.permissions = [];
    if (!manifest.permissions.includes("webNavigation")) {
      manifest.permissions.push("webNavigation");
    }
    manifest.optional_permissions = (manifest.optional_permissions || []).filter(
      (p) => p !== "webNavigation"
    );
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[e2e-harness] 已准备扩展目录（预授权 webNavigation）: ${destDir}`);
    return destDir;
  })();
  return preparedExtensionDirPromise;
}

/** 基础测试页面 HTML 路径（含简单段落、选中文本目标等） */
const testPagePath = path.join(projectRoot, "extra", "e2e", "test-page.html");

/** 富内容验证页面 HTML 路径（含表格、列表、多段落，用于更全面的翻译验证） */
const verifyPagePath = path.join(projectRoot, "extra", "e2e", "translation-verify-page.html");

/** 长页面 HTML 路径（200 个 JS 动态生成的段落，用于大页面翻译测试） */
const longPagePath = path.join(projectRoot, "extra", "e2e", "long-page.html");

/** 动态内容页面 HTML 路径（含静态段落 + runtime 注入容器，用于动态内容翻译测试） */
const dynamicContentPagePath = path.join(projectRoot, "extra", "e2e", "dynamic-content.html");

/** 法语版验证页面路径（用于 dontShowIfPageLangIsTargetLang / dontShowIfSelectedTextIsTargetLang 测试） */
const frPagePath = path.join(projectRoot, "extra", "e2e", "translation-verify-page-fr.html");

/** 链接源页面路径（用于 autoTranslateWhenClickingALink 测试） */
const linkSourcePath = path.join(projectRoot, "extra", "e2e", "link-source.html");

/** 链接目标页面路径（用于 autoTranslateWhenClickingALink 测试） */
const linkTargetPath = path.join(projectRoot, "extra", "e2e", "link-target.html");

/** SPA 源页面路径（模拟 Turbo Drive 导航，用于 AI 翻译回退恢复测试） */
const spaSourcePath = path.join(projectRoot, "extra", "e2e", "spa-source.html");

/** SPA 目标页面路径（模拟 Turbo Drive 导航，用于 AI 翻译回退恢复测试） */
const spaTargetPath = path.join(projectRoot, "extra", "e2e", "spa-target.html");

// ═══════════════════════════════════════════════════════════════
// ErrorCollector 类 — 封装错误收集、附加和汇总
// ═══════════════════════════════════════════════════════════════

/**
 * 错误收集器，封装了整个 E2E 运行过程中的错误收集、页面/SW 附加和汇总报告。
 *
 * 替代了原来 browser-e2e.mjs 中的以下独立函数/变量：
 *   - collectedErrors 数组
 *   - recordError()
 *   - attachPageErrorCollector()
 *   - attachServiceWorkerErrorCollector()
 *   - collectExtensionErrors()（现为方法，内部 recordError 调用改为 this.record()）
 *   - printErrorSummary()
 */
export class ErrorCollector {
  constructor() {
    /**
     * 收集的错误数组。每个条目包含来源标识、错误文本和可选的页面 URL。
     * @type {{ source: string, text: string, url?: string }[]}
     */
    this.errors = [];
  }

  /**
   * 记录一条错误到收集器，并立即输出到 stderr。
   *
   * @param {string} source - 错误来源标识（如 "page-console:main"、"sw-console"、"chrome://extensions"）
   * @param {string} text - 错误文本内容
   * @param {string} [url] - 发生错误时的页面 URL
   */
  record(source, text, url) {
    this.errors.push({ source, text, url });
    console.error(`  [${source}] ${text}${url ? ` (${url})` : ""}`);
  }

  /**
   * 将页面的 console.error 和未捕获异常绑定到错误收集器。
   *
   * 监听两种事件：
   *   - "console" 事件中 type === "error" → 记录为 page-console 错误
   *   - "pageerror" 事件 → 记录为 page-error（未捕获的 JS 异常）
   *
   * @param {import("playwright").Page} page - Playwright 页面对象
   * @param {string} label - 标识标签（如 "main"、"google-translate-verify"），用于区分错误来源
   * @returns {Function} 返回一个 detach 函数，调用后取消监听（在 finally 中调用以防内存泄漏）
   */
  attachPage(page, label) {
    // 监听页面 console 中的 error 级别消息
    const onConsole = (msg) => {
      if (msg.type() === "error") {
        this.record(`page-console:${label}`, msg.text(), page.url());
      }
    };
    // 监听页面未捕获的 JavaScript 异常
    const onPageError = (err) => {
      this.record(`page-error:${label}`, String(err), page.url());
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    // 返回取消监听函数
    return () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    };
  }

  /**
   * 将 Service Worker 的 console.error 绑定到错误收集器。
   * Service Worker 中的错误通常意味着 aiProxy 或扩展后台逻辑出了问题。
   *
   * @param {import("playwright").Worker} sw - Playwright Service Worker 对象
   */
  attachServiceWorker(sw) {
    sw.on("console", (msg) => {
      if (msg.type() === "error") {
        this.record("sw-console", msg.text(), sw.url());
      }
    });
  }

  /**
   * [0/13] [5/13] 检查 chrome://extensions 页面上的扩展错误。
   *
   * chrome://extensions 使用 Shadow DOM（Polymer/Lit 组件），
   * 需要递归穿透 shadow root 才能找到错误指示器。
   *
   * 检查项目：
   *   - 警告文本（.warnings 区域的 span）
   *   - "Errors" 按钮是否可见（表示有运行时错误）
   *   - 扩展是否被禁用（enableToggle 未勾选）
   *
   * 原为 browser-e2e.mjs 中的独立函数 collectExtensionErrors()，
   * 现重构为 ErrorCollector 的方法。内部的 recordError 调用已替换为 this.record()。
   *
   * @param {import("playwright").Page} page - Playwright 页面对象
   * @param {string|null} extensionId - 扩展 ID（null 表示检查所有扩展）
   * @returns {Promise<string[]>} 发现的错误文本数组
   */
  async collectExtensionErrors(page, extensionId) {
    console.log("  Checking chrome://extensions for extension errors...");
    await page.goto("chrome://extensions", { waitUntil: "load" });
    await page.waitForTimeout(1000); // 等待 Polymer 组件渲染完成

    // 在页面上下文中执行 Shadow DOM 穿透查询
    const errors = await page.evaluate((extId) => {
      const results = [];

      /**
       * 递归穿透 shadow root 查找单个元素。
       * chrome://extensions 的 DOM 嵌套了多层 Shadow DOM，
       * 普通 querySelector 无法穿透。
       */
      function queryShadow(root, selector) {
        const found = root.querySelector(selector);
        if (found) return found;
        const allElements = root.querySelectorAll("*");
        for (const el of allElements) {
          if (el.shadowRoot) {
            const result = queryShadow(el.shadowRoot, selector);
            if (result) return result;
          }
        }
        return null;
      }

      /**
       * 递归穿透 shadow root 查找所有匹配元素。
       */
      function queryShadowAll(root, selector) {
        const found = [...root.querySelectorAll(selector)];
        const allElements = root.querySelectorAll("*");
        for (const el of allElements) {
          if (el.shadowRoot) {
            found.push(...queryShadowAll(el.shadowRoot, selector));
          }
        }
        return found;
      }

      // 找到 extensions-manager 根组件
      const manager = document.querySelector("extensions-manager");
      if (!manager?.shadowRoot) {
        return results;
      }

      // 遍历所有扩展卡片
      const items = queryShadowAll(manager.shadowRoot, "extensions-item");
      for (const item of items) {
        const root = item.shadowRoot || item;
        // 提取扩展 ID
        const idEl = queryShadow(root, "#extension-id");
        const itemId = idEl?.textContent?.trim()?.replace("ID: ", "") || item.id || "";

        // 如果指定了目标扩展 ID，跳过其他扩展
        if (extId && itemId && !itemId.includes(extId)) {
          continue;
        }

        // 检查警告区域
        const warningsEl = queryShadow(root, ".warnings");
        if (warningsEl) {
          const spans = warningsEl.querySelectorAll("span");
          for (const span of spans) {
            const text = span.textContent?.trim();
            if (text) {
              results.push(text);
            }
          }
        }

        // 检查 "Errors" 按钮（出现时表示有运行时错误）
        const errorsButton = queryShadow(root, "#errors-button");
        if (errorsButton) {
          results.push("Extension has runtime errors (Errors button visible)");
        }

        // 检查扩展是否因错误被禁用
        const enableToggle = queryShadow(root, "#enableToggle");
        if (enableToggle) {
          const checked = enableToggle.hasAttribute("checked") || enableToggle.checked;
          if (!checked) {
            results.push("Extension is DISABLED on chrome://extensions page");
          }
        }
      }

      return results;
    }, extensionId);

    // 将发现的错误记录到收集器（原 recordError 调用替换为 this.record()）
    if (errors.length > 0) {
      for (const err of errors) {
        this.record("chrome://extensions", err);
      }
    } else {
      console.log("  No extension errors found on chrome://extensions page.");
      // 额外输出调试信息：检查是否有扩展被列出
      const debugInfo = await page.evaluate(() => {
        const manager = document.querySelector("extensions-manager");
        if (!manager?.shadowRoot) return "no-manager";
        const bodyText = document.body.innerText;
        return bodyText.substring(0, 500); // 截取前 500 字符作为调试参考
      });
      console.log("  Extensions page debug snippet:", debugInfo);
    }

    return errors;
  }

  /**
   * 打印 E2E 错误汇总报告。
   *
   * 将收集到的错误分为两类：
   *   1. 可操作错误（actionable）：需要修复的真实问题
   *   2. 已知良性错误（benign）：预期中的 404 等非致命问题
   *
   * 进一步从可操作错误中提取致命错误：
   *   - 来自 chrome://extensions 的错误（扩展加载失败）
   *   - 页面未捕获异常（page-error:*）
   *   - Service Worker console 错误（sw-console）
   *
   * 原为 browser-e2e.mjs 中的 printErrorSummary()，
   * 现使用 this.errors 替代全局 collectedErrors 数组。
   *
   * @returns {Array} 致命错误数组（决定脚本退出码）
   */
  printSummary() {
    // 已知良性错误模式（404 资源加载失败是自动化测试中的正常现象）
    const knownBenignPatterns = [
      /Failed to load resource.*404/,
      /Failed to load resource.*the server responded with a status of 404/,
    ];

    /** 判断错误是否为已知良性错误 */
    const isKnownBenign = (err) =>
      knownBenignPatterns.some((pattern) => pattern.test(err.text));

    const benignErrors = this.errors.filter(isKnownBenign);
    const actionableErrors = this.errors.filter((e) => !isKnownBenign(e));

    console.log("\n========================================");
    console.log("       E2E Error Summary");
    console.log("========================================");
    if (this.errors.length === 0) {
      console.log("No errors collected during the entire E2E run.");
    } else {
      // 输出可操作错误
      if (actionableErrors.length > 0) {
        console.log(`${actionableErrors.length} actionable error(s):\n`);
        for (let i = 0; i < actionableErrors.length; i++) {
          const err = actionableErrors[i];
          console.log(`  ${i + 1}. [${err.source}] ${err.text}`);
          if (err.url) {
            console.log(`     URL: ${err.url}`);
          }
        }
      }
      // 输出已知良性错误
      if (benignErrors.length > 0) {
        console.log(`\n${benignErrors.length} known pre-existing issue(s) (non-fatal):`);
        for (const err of benignErrors) {
          console.log(`  - [${err.source}] ${err.text.substring(0, 120)}`);
        }
      }
    }
    console.log("========================================\n");

    // 提取致命错误（决定脚本是否以非零退出码退出）
    const fatalErrors = actionableErrors.filter((e) =>
      e.source === "chrome://extensions" ||      // 扩展加载错误
      e.source.startsWith("page-error:") ||      // 页面未捕获异常
      e.source === "sw-console"                  // Service Worker 错误
    );

    return fatalErrors;
  }
}

// ═══════════════════════════════════════════════════════════════
// 模块私有 — 旧版错误收集基础设施
//
// 以下函数为 browser-e2e.mjs 中 extract 的原始函数保留向后兼容。
// runWithIsolatedExtensionContext() 内部仍引用 attachServiceWorkerErrorCollector，
// 因此需要保留模块私有的辅助函数。外部代码应使用 ErrorCollector 类。
// ═══════════════════════════════════════════════════════════════

/**
 * 收集的错误数组。每个条目包含来源标识、错误文本和可选的页面 URL。
 * @type {{ source: string, text: string, url?: string }[]}
 */
const _collectedErrors = [];

/**
 * 记录一条错误到收集器，并立即输出到 stderr。
 *
 * @param {string} source - 错误来源标识
 * @param {string} text - 错误文本内容
 * @param {string} [url] - 发生错误时的页面 URL
 */
function _recordError(source, text, url) {
  _collectedErrors.push({ source, text, url });
  console.error(`  [${source}] ${text}${url ? ` (${url})` : ""}`);
}

/**
 * 将 Service Worker 的 console.error 绑定到旧版错误收集器。
 *
 * @param {import("playwright").Worker} sw - Playwright Service Worker 对象
 */
function _attachServiceWorkerErrorCollector(sw) {
  sw.on("console", (msg) => {
    if (msg.type() === "error") {
      _recordError("sw-console", msg.text(), sw.url());
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 共享工具函数
//
// 以下 11 个函数从 tests/browser-e2e.mjs 中复制而来，逻辑未做任何修改。
// ═══════════════════════════════════════════════════════════════

/**
 * 轮询等待 HTTP 服务器就绪。
 * 每 300ms 发起一次 GET 请求，直到收到响应或超时。
 * 用于等待 Mock LLM 服务器启动完成。
 *
 * @param {string} url - 健康检查 URL（如 http://127.0.0.1:8788/health）
 * @param {number} timeoutMs - 超时毫秒数，默认 15 秒
 * @returns {Promise<void>} 服务器就绪时 resolve，超时时 reject
 */
export function waitForServer(url, timeoutMs = 15_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(url, (res) => {
        res.resume(); // 消费响应体，避免内存泄漏
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(poll, 300); // 300ms 后重试
      });
    };
    poll();
  });
}

/**
 * 从 Playwright 浏览器上下文中发现扩展的 ID。
 *
 * Chrome 扩展加载后会注册一个 Service Worker，其 URL 格式为：
 *   chrome-extension://{extensionId}/background/sw.js
 * 从该 URL 的 host 部分提取扩展 ID。
 *
 * @param {import("playwright").BrowserContext} context - Playwright 浏览器上下文
 * @param {number} serviceWorkerTimeoutMs - 等待 Service Worker 出现的超时毫秒数
 * @returns {Promise<string>} 扩展 ID 字符串
 * @throws {Error} 超时未发现 Service Worker
 */
export async function findExtensionId(context, serviceWorkerTimeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < serviceWorkerTimeoutMs) {
    // 尝试获取已存在的 Service Worker
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      // 如果还没有，等待 serviceworker 事件（最多 1 秒）
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 1_000 }).catch(() => null);
    }
    if (serviceWorker?.url()) {
      // 从 Service Worker URL 提取 host（即扩展 ID）
      return new URL(serviceWorker.url()).host;
    }
  }
  throw new Error("Failed to discover extension service worker");
}

/**
 * 获取扩展的 Service Worker 实例。
 * 与 findExtensionId 类似，但返回完整的 Worker 对象（用于后续 evaluate 调用）。
 *
 * @param {import("playwright").BrowserContext} context - Playwright 浏览器上下文
 * @param {number} serviceWorkerTimeoutMs - 等待超时毫秒数
 * @returns {Promise<import("playwright").Worker>} Service Worker 实例
 * @throws {Error} 超时未发现 Service Worker
 */
export async function getExtensionServiceWorker(context, serviceWorkerTimeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < serviceWorkerTimeoutMs) {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 1_000 }).catch(() => null);
    }
    if (serviceWorker) {
      return serviceWorker;
    }
  }
  throw new Error("Failed to discover extension service worker");
}

/**
 * 轮询等待内容脚本注入到指定标签页。
 *
 * 通过 Service Worker 向目标标签页发送 "contentScriptIsInjected" 消息，
 * 如果内容脚本已注入，它会回复 true。
 *
 * 这是必要的等待步骤，因为 Chrome 注入 Content Script 需要时间，
 * 在注入完成前发送翻译命令会导致消息丢失。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} tabUrl - 目标标签页的 URL
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Promise<void>} 内容脚本已注入时 resolve
 * @throws {Error} 超时未注入
 */
export async function waitForContentScriptInjected(serviceWorker, tabUrl, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // 在 Service Worker 上下文中执行：查找目标标签页并发送检测消息
    const isInjected = await serviceWorker.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === targetUrl);
      if (!tab?.id) {
        return false; // 标签页尚未加载
      }
      return await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: "contentScriptIsInjected" }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(false); // 内容脚本尚未注入，sendMessage 会报错
            return;
          }
          resolve(response === true);
        });
      });
    }, tabUrl);

    if (isInjected) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250)); // 250ms 后重试
  }

  throw new Error("Timed out waiting for content script injection");
}

/**
 * 轮询等待页面翻译器（pageTranslator）初始化完成。
 *
 * 发送 "getCurrentPageLanguageState" 消息探测翻译器是否就绪。
 * 翻译器就绪后才能接受翻译命令。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} tabUrl - 目标标签页的 URL
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Promise<any>} 翻译器的语言状态响应
 * @throws {Error} 超时未就绪
 */
export async function waitForPageTranslatorReady(serviceWorker, tabUrl, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await serviceWorker.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === targetUrl);
      if (!tab?.id) {
        return { ready: false };
      }

      return await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: "getCurrentPageLanguageState" }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ready: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve({ ready: true, response });
        });
      });
    }, tabUrl);

    if (result?.ready) {
      return result.response;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for page translator readiness");
}

/**
 * 通过 Service Worker 向指定标签页发送消息。
 *
 * 这是 E2E 测试中触发扩展功能的核心方法。所有翻译命令
 * （translatePage、TranslateSelectedText 等）都通过此函数发送。
 *
 * 特殊处理：如果收到 "The message port closed before a response was received"
 * 错误，将其视为正常情况（某些消息不需要回复），返回 null 而非抛错。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {string} tabUrl - 目标标签页的 URL
 * @param {Object} message - 要发送的消息对象（如 { action: "translatePage", targetLanguage: "fr" }）
 * @returns {Promise<any>} 内容脚本的响应，或 null
 */
export async function sendMessageToTab(serviceWorker, tabUrl, message) {
  return serviceWorker.evaluate(async ({ targetUrl, payload }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === targetUrl);
    if (!tab?.id) {
      throw new Error(`Tab not found for URL: ${targetUrl}`);
    }

    return await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, payload, (response) => {
        if (chrome.runtime.lastError) {
          // "消息端口关闭"是正常的——某些消息不需要回复
          if (chrome.runtime.lastError.message?.includes("The message port closed before a response was received")) {
            resolve(null);
            return;
          }
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response ?? null);
      });
    });
  }, { targetUrl: tabUrl, payload: message });
}

/**
 * 输出诊断日志转储。
 * 在 AI 翻译失败或页面崩溃时调用，帮助定位问题。
 *
 * 输出三类日志：
 *   1. 拦截到的对话框（可能是 API key 缺失导致的 prompt）
 *   2. 内容脚本中与 AI 相关的 console 日志（按关键词过滤）
 *   3. Service Worker 的最后 30 条 console 日志
 *
 * @param {string[]} aiConsoleLogs - 内容脚本的 console 日志数组
 * @param {string[]} swConsoleLogs - Service Worker 的 console 日志数组
 * @param {string[]} dialogLogs - 拦截到的对话框日志数组
 */
export function dumpDiagnosticLogs(aiConsoleLogs, swConsoleLogs, dialogLogs) {
  console.log("\n  === DIAGNOSTIC DUMP ===");

  // 输出对话框日志
  if (dialogLogs.length > 0) {
    console.log(`  Dialogs (${dialogLogs.length}):`);
    dialogLogs.forEach(d => console.log(`    ${d}`));
  }

  // 过滤与 AI 翻译相关的内容脚本日志（按关键词匹配）
  const aiRelatedLogs = aiConsoleLogs.filter(l =>
    l.includes("aiTranslate") || l.includes("autoImprove") ||
    l.includes("btnList") || l.includes("toBeTranslated") ||
    l.includes("openAiUserType") || l.includes("rateLimitCountDown") ||
    l.includes("hasActiveProvider") || l.includes("translateWithAI") ||
    l.includes("aiProvider") || l.includes("mock") ||
    l.includes("fetchSSE") || l.includes("SSE") ||
    l.includes("recordNew") || l.includes("contentSequence") ||
    l.includes("targetTxt") || l.includes("accumulatedText") ||
    l.includes("error") || l.includes("Error") ||
    l.includes("port") || l.includes("abort") ||
    l.includes("config") || l.includes("译泽") ||
    l.includes("11111") || l.includes("33333") || l.includes("4444")
  );
  console.log(`  Content script AI logs (${aiRelatedLogs.length} of ${aiConsoleLogs.length} total):`);
  aiRelatedLogs.slice(0, 80).forEach(l => console.log(`    ${l}`)); // 最多输出 80 条
  // 如果没有匹配的 AI 日志，输出最后 30 条原始日志
  if (aiRelatedLogs.length === 0) {
    console.log("  Last 30 content script console logs:");
    aiConsoleLogs.slice(-30).forEach(l => console.log(`    ${l}`));
  }

  // 输出 Service Worker 日志
  if (swConsoleLogs.length > 0) {
    console.log(`  Service Worker logs (${swConsoleLogs.length}):`);
    swConsoleLogs.slice(-30).forEach(l => console.log(`    ${l}`)); // 最后 30 条
  }

  console.log("  === END DIAGNOSTIC DUMP ===\n");
}

/**
 * 等待选项页中的下拉框完成初始化。
 * 只有当页面脚本已经通过 twpConfig.onReady 绑定事件，并且下拉框值与 storage 中的当前值一致时，
 * 后续的 selectOption 才不会与页面初始化流程竞争。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} selectId - 下拉框元素 id
 * @returns {Promise<void>}
 */
export async function waitForOptionsSelectReady(page, selectId) {
  await page.waitForFunction(async (id) => {
    const select = document.getElementById(id);
    if (!(select instanceof HTMLSelectElement)) {
      return false;
    }

    if (typeof select.onchange !== "function") {
      return false;
    }

    const storedValue = await new Promise((resolve) => {
      chrome.storage.local.get(id, (items) => resolve(items?.[id] ?? null));
    });

    return storedValue === null || select.value === storedValue;
  }, selectId, { timeout: 10000 });
}

/**
 * 修改选项页下拉框，并直接调用页面已经绑定好的 onchange 处理器。
 * 这条路径与现有 options 单测一致，能够避开扩展页里 Playwright 对 select/change
 * 事件触发偶发不稳定的问题。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} selectId - 下拉框元素 id
 * @param {string} nextValue - 目标值
 * @returns {Promise<void>}
 */
export async function setOptionsSelectValueAndWait(page, selectId, nextValue) {
  // options 页的 select 有两种绑定方式：
  // 1) 属性式（$("#x").onchange = ...，如 #darkMode）——可探测就绪状态；
  // 2) 监听器式（addEventListener("change", ...)，如 #genericModel）——无法探测。
  //
  // 属性式绑定的竞态：页面首次加载时 init（twpConfig.onReady）可能延迟数百毫秒，
  // 期间 onchange 未绑定，dispatch 是空操作，随后 init 用配置默认值覆盖 select。
  // 因此先轮询"onchange 已绑定"（上限 3s，实测 init 延迟 ~200ms），绑定后直接
  // 调用处理器；监听器式 select 轮询超时后 dispatch 一次（同旧行为，调用方
  // 需在 set 前确保页面已初始化）。
  const readyDeadline = Date.now() + 3000;
  for (;;) {
    const ready = await page.evaluate((id) => {
      const select = document.getElementById(id);
      return (
        select instanceof HTMLSelectElement &&
        typeof select.onchange === "function"
      );
    }, selectId);
    if (ready || Date.now() > readyDeadline) break;
    await page.waitForTimeout(100);
  }

  await page.evaluate(({ id, expected }) => {
    const select = document.getElementById(id);
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error(`Select element not found: ${id}`);
    }
    select.value = expected;
    if (typeof select.onchange === "function") {
      select.onchange({ target: select });
    } else {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { id: selectId, expected: nextValue });

  await page.waitForFunction(({ id, expected }) => {
    const select = document.getElementById(id);
    return select instanceof HTMLSelectElement && select.value === expected;
  }, { id: selectId, expected: nextValue }, { timeout: 10000 });
}

/**
 * 等待当前 options 页面观察到 storage 中的目标值。
 * 选项页中的 twpConfig.set 会异步写入 `chrome.storage.local`，
 * 因此在刷新页面或断言持久化前，需要等待页面自身也读到相同结果。
 *
 * @param {import("playwright").Page} page - 当前 options 页
 * @param {string} key - storage 键
 * @param {string} expectedValue - 期望值
 * @param {number} timeoutMs - 超时时间
 * @returns {Promise<void>}
 */
export async function waitForPageStorageValue(page, key, expectedValue, timeoutMs = 10000) {
  await page.waitForFunction(async ({ storageKey, expected }) => {
    const items = await chrome.storage.local.get(storageKey);
    return (items?.[storageKey] ?? null) === expected;
  }, { storageKey: key, expected: expectedValue }, { timeout: timeoutMs });
}

/**
 * 在全新的扩展上下文中执行 options 相关测试。
 * 最小复现表明，options 页持久化与暗黑模式在干净上下文中稳定，
 * 而完整 E2E 的前置页面与内容脚本会放大扩展页自身的异步串扰。
 * 这里通过单独的持久化上下文隔离第 11/12 步，保留真实浏览器验证，
 * 同时避免把无关页面状态带入设置页测试。
 *
 * @template T
 * @param {(scope: {
 *   context: import("playwright").BrowserContext,
 *   page: import("playwright").Page,
 *   extensionId: string,
 *   serviceWorker: import("playwright").Worker,
 * }) => Promise<T>} callback - 在隔离上下文中执行的测试逻辑
 * @param {ErrorCollector|null} [collector=null] - 错误收集器实例
 * @param {{ locale?: string }} [options={}] - 额外选项，locale 指定浏览器 UI 语言
 * @returns {Promise<T>}
 */
export async function runWithIsolatedExtensionContext(callback, collector = null, options = {}) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dualtran-options-e2e-"));
  /** 浏览器启动参数 */
  const extDir = await prepareExtensionDir();
  const launchArgs = [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
  ];
  // 如果指定了 locale，添加 --lang 参数（影响 chrome.i18n.getUILanguage()）
  if (options.locale) {
    launchArgs.push(`--lang=${options.locale}`);
  }
  const isolatedContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: launchArgs,
  });

  try {
    const extensionId = await findExtensionId(isolatedContext, 30_000);
    const serviceWorker = await getExtensionServiceWorker(isolatedContext, 30_000);
    if (collector) {
      collector.attachServiceWorker(serviceWorker);
    } else {
      _attachServiceWorkerErrorCollector(serviceWorker);
    }
    const page = isolatedContext.pages()[0] || await isolatedContext.newPage();
    // 等待扩展在全新的浏览器上下文中完成初始化
    await page.waitForTimeout(3000);

    // 关闭安装流程自动打开的扩展页（onInstalled → openPageUrl effect），
    // 然后新建一个 about:blank 页面作为测试页。原因：自动打开的 options 页
    // 在测试写入 storage 之前就已加载，其 in-memory config 是陈旧的，且对
    // #hash 的导航不会触发重新加载——会导致 select 显示旧值、持久化断言误判。
    for (const p of isolatedContext.pages()) {
      if (p !== page) await p.close().catch(() => {});
    }
    if (!page.url().startsWith("about:")) {
      await page.goto("about:blank", { waitUntil: "load" }).catch(() => {});
    }
    const freshPage = await isolatedContext.newPage();
    await page.close().catch(() => {});
    await freshPage.bringToFront().catch(() => {});

    // 将模块私有错误收集器的错误合并到 ErrorCollector
    if (collector && _collectedErrors.length > 0) {
      for (const err of _collectedErrors) {
        collector.record(`isolated:${err.source}`, err.text, err.url);
      }
      _collectedErrors.length = 0;
    }

    return await callback({
      context: isolatedContext,
      page: freshPage,
      extensionId,
      serviceWorker,
    });
  } finally {
    await isolatedContext.close().catch(() => {});
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// 存储工具函数 — chrome.storage.local 读写封装
//
// 通过 Service Worker 上下文操作 chrome.storage.local，
// 供所有场景文件复用。
// ═══════════════════════════════════════════════════════════════

/**
 * 读取 chrome.storage.local 中的一个键（通过 Service Worker 上下文）。
 * @param {import("playwright").Worker} serviceWorker
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function readStorage(serviceWorker, key) {
  return serviceWorker.evaluate(async (k) => {
    const items = await chrome.storage.local.get(k);
    return items?.[k] ?? null;
  }, key);
}

/**
 * 写入 chrome.storage.local 中的一个键（通过 Service Worker 上下文）。
 * @param {import("playwright").Worker} serviceWorker
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function writeStorage(serviceWorker, key, value) {
  await serviceWorker.evaluate(async ({ k, v }) => {
    await chrome.storage.local.set({ [k]: v });
  }, { k: key, v: value });
}

/**
 * 读取 chrome.storage.local 中的多个键（通过 Service Worker 上下文）。
 * @param {import("playwright").Worker} serviceWorker
 * @param {string[]} keys
 * @returns {Promise<Object>}
 */
export async function readStorageMulti(serviceWorker, keys) {
  return serviceWorker.evaluate(async (ks) => {
    return await chrome.storage.local.get(ks);
  }, keys);
}

/**
 * 递归穿透 shadow root 查找单个元素（供外部复用）。
 * chrome://extensions 的 DOM 嵌套了多层 Shadow DOM。
 *
 * @param {Element|ShadowRoot} root - 起始根节点
 * @param {string} selector - CSS 选择器
 * @returns {Element|null} 找到的第一个元素，或 null
 */
export function queryShadow(root, selector) {
  const found = root.querySelector(selector);
  if (found) return found;
  const allElements = root.querySelectorAll("*");
  for (const el of allElements) {
    if (el.shadowRoot) {
      const result = queryShadow(el.shadowRoot, selector);
      if (result) return result;
    }
  }
  return null;
}

/**
 * 递归穿透 shadow root 查找所有匹配元素（供外部复用）。
 *
 * @param {Element|ShadowRoot} root - 起始根节点
 * @param {string} selector - CSS 选择器
 * @returns {Element[]} 找到的所有匹配元素数组
 */
export function queryShadowAll(root, selector) {
  const found = [...root.querySelectorAll(selector)];
  const allElements = root.querySelectorAll("*");
  for (const el of allElements) {
    if (el.shadowRoot) {
      found.push(...queryShadowAll(el.shadowRoot, selector));
    }
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════
// 浏览器启动 / 服务器管理
//
// 提供浏览器启动、静态页面服务器、Mock 服务器及两层 setup 函数。
// ═══════════════════════════════════════════════════════════════

/**
 * 使用 Playwright 启动持久化浏览器上下文并加载扩展。
 *
 * 关键配置：
 *   - --disable-extensions-except 和 --load-extension：加载指定扩展
 *   - --no-first-run：跳过首次运行向导
 *   - headless: false：扩展不支持 headless 模式（Chrome 限制）
 *   - 使用 Playwright 内置的 Chromium（非系统 Chrome），确保 Windows 兼容性
 *
 * @returns {Promise<import("playwright").BrowserContext>} Playwright 浏览器上下文
 */
export async function launchExtensionBrowser() {
  const extDir = await prepareExtensionDir();
  const context = await chromium.launchPersistentContext("", {
    args: [
      `--disable-extensions-except=${extDir}`,  // 仅加载我们的扩展
      `--load-extension=${extDir}`,             // 从准备好的扩展目录加载（预授权 webNavigation）
      "--no-first-run",                                // 跳过 Chrome 首次运行向导
      "--no-default-browser-check",                    // 跳过默认浏览器检查
    ],
    headless: false, // Chrome 扩展必须在非 headless 模式下运行
  });
  // 猴子补丁：将所有页面的 attachShadow({ mode: "closed" }) 强制改为 mode: "open"
  // 以便 Playwright 的 evaluate() 可以访问 shadow DOM 内部内容进行行为验证
  await context.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  return context;
}

/**
 * 启动本地静态 HTTP 服务器，托管 E2E 测试页面。
 *
 * 委托给 tests/shared/test-server-manager.mjs 的 startStaticServer()，
 * 统一与 MCP E2E 的静态服务器逻辑。
 *
 * Playwright 需要通过 HTTP（而非 file://）访问测试页面，
 * 因为 Chrome 扩展的 Content Script 只注入到 http/https 页面。
 *
 * @returns {Promise<{ server: http.Server, baseUrl: string }>} 服务器实例和基础 URL
 */
export async function startStaticTestPageServer() {
  return _startStaticServer();
}

/**
 * 启动 Mock LLM 服务器作为子进程。
 * 根据 mockServerConfig 决定启动哪个脚本（legacy 或 aimock）。
 *
 * 对于 aimock 模式，委托给共享模块的 startAimockServer()。
 * 对于 legacy 模式，保持原有子进程启动逻辑。
 *
 * @param {Object} mockServerConfig - Mock 服务器配置对象
 * @param {string} mockServerConfig.startScript - 启动脚本路径
 * @param {Object} [mockServerConfig.env] - 额外的环境变量
 * @param {number} [mockServerConfig.port] - 服务器端口
 * @returns {Promise<import("node:child_process").ChildProcess>} 子进程对象（最终需要 kill）
 */
export async function startMockServer(mockServerConfig) {
  // aimock 模式使用共享模块
  if (mockServerConfig.mode === "aimock" || mockServerConfig.port === 8788) {
    const result = await _startAimockServer(mockServerConfig.port || 8788);
    return result.process;
  }

  // legacy 模式保持原有逻辑
  const child = spawn("node", [mockServerConfig.startScript], {
    cwd: projectRoot,
    env: {
      ...process.env,            // 继承当前环境变量
      ...mockServerConfig.env,   // 覆盖 mock 专用变量（如端口号）
    },
    stdio: ["ignore", "pipe", "pipe"], // stdin 忽略，stdout/stderr 通过管道捕获
  });
  // 将子进程的输出管道到主进程（便于在终端看到 mock 服务器日志）
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

// ═══════════════════════════════════════════════════════════════
// 两层 setup 函数
//
// setupBasic() — 最小化 setup（无 Mock 服务器），用于不需要 AI 翻译的测试
// setupFull()  — 完整 setup（含 Mock 服务器），用于需要 AI 翻译的测试
// teardown()   — 统一资源清理
// ═══════════════════════════════════════════════════════════════

/**
 * 最小化 E2E 测试环境 setup。
 *
 * 启动静态页面服务器 + 浏览器扩展，不含 Mock LLM 服务器。
 * 适用于仅需 Google 翻译、按钮 UI、选项页等不涉及 AI 翻译的测试场景。
 *
 * @returns {Promise<{
 *   context: import("playwright").BrowserContext,
 *   page: import("playwright").Page,
 *   extensionId: string,
 *   serviceWorker: import("playwright").Worker,
 *   testPageUrl: string,
 *   verifyPageUrl: string,
 *   longPageUrl: string,
 *   dynamicContentPageUrl: string,
 *   staticServer: { server: http.Server, baseUrl: string },
 *   collector: ErrorCollector
 * }>} setup 作用域对象
 */
export async function setupBasic() {
  const collector = new ErrorCollector();
  const staticServer = await startStaticTestPageServer();
  const testPageUrl = `${staticServer.baseUrl}/test-page.html`;
  const verifyPageUrl = `${staticServer.baseUrl}/translation-verify-page.html`;
  const longPageUrl = `${staticServer.baseUrl}/long-page.html`;
  const dynamicContentPageUrl = `${staticServer.baseUrl}/dynamic-content.html`;
  const frPageUrl = `${staticServer.baseUrl}/translation-verify-page-fr.html`;
  const linkSourceUrl = `${staticServer.baseUrl}/link-source.html`;
  const linkTargetUrl = `${staticServer.baseUrl}/link-target.html`;
  const spaSourceUrl = `${staticServer.baseUrl}/spa-source.html`;
  const spaTargetUrl = `${staticServer.baseUrl}/spa-target.html`;
  const context = await launchExtensionBrowser();
  const page = context.pages()[0] || await context.newPage();
  collector.attachPage(page, "main");
  const extensionId = await findExtensionId(context, 30_000);
  const serviceWorker = await getExtensionServiceWorker(context, 30_000);
  collector.attachServiceWorker(serviceWorker);
  return { context, page, extensionId, serviceWorker, testPageUrl, verifyPageUrl, longPageUrl, dynamicContentPageUrl, frPageUrl, linkSourceUrl, linkTargetUrl, spaSourceUrl, spaTargetUrl, staticServer, collector };
}

/**
 * 完整 E2E 测试环境 setup。
 *
 * 启动 Mock LLM 服务器 + 静态页面服务器 + 浏览器扩展。
 * 适用于需要 AI 翻译的完整端到端测试场景。
 *
 * 通过参数或环境变量控制 mock 模式：
 *   - opts.mockMode = "legacy" → 使用传统 mock 服务器（端口 8787）
 *   - opts.mockMode = "aimock" → 使用 aimock 服务器（端口 8788）
 *   - BROWSER_E2E_MOCK_MODE 环境变量作为 fallback
 *
 * @param {{ mockMode?: string }} [opts] - 可选参数
 * @param {string} [opts.mockMode] - mock 模式（"legacy" | "aimock"），优先级高于环境变量
 * @returns {Promise<{
 *   context: import("playwright").BrowserContext,
 *   page: import("playwright").Page,
 *   extensionId: string,
 *   serviceWorker: import("playwright").Worker,
 *   testPageUrl: string,
 *   verifyPageUrl: string,
 *   longPageUrl: string,
 *   dynamicContentPageUrl: string,
 *   staticServer: { server: http.Server, baseUrl: string },
 *   mockServer: import("node:child_process").ChildProcess,
 *   mockServerConfig: Object,
 *   collector: ErrorCollector
 * }>} setup 作用域对象
 */
export async function setupFull(opts = {}) {
  const collector = new ErrorCollector();
  const { resolveMockModeConfig } = await import("./browser-e2e-config.mjs");
  const mockMode = opts.mockMode || process.env.BROWSER_E2E_MOCK_MODE || "aimock";
  const mockServerConfig = resolveMockModeConfig({
    projectRoot,
    mockMode,
  });
  const mockServer = await startMockServer(mockServerConfig);
  console.log(`Using mock mode: ${mockServerConfig.mode}`);
  await waitForServer(mockServerConfig.healthUrl);
  const staticServer = await startStaticTestPageServer();
  const testPageUrl = `${staticServer.baseUrl}/test-page.html`;
  const verifyPageUrl = `${staticServer.baseUrl}/translation-verify-page.html`;
  const longPageUrl = `${staticServer.baseUrl}/long-page.html`;
  const dynamicContentPageUrl = `${staticServer.baseUrl}/dynamic-content.html`;
  const frPageUrl = `${staticServer.baseUrl}/translation-verify-page-fr.html`;
  const linkSourceUrl = `${staticServer.baseUrl}/link-source.html`;
  const linkTargetUrl = `${staticServer.baseUrl}/link-target.html`;
  const spaSourceUrl = `${staticServer.baseUrl}/spa-source.html`;
  const spaTargetUrl = `${staticServer.baseUrl}/spa-target.html`;
  const context = await launchExtensionBrowser();
  const page = context.pages()[0] || await context.newPage();
  collector.attachPage(page, "main");
  const extensionId = await findExtensionId(context, 30_000);
  const serviceWorker = await getExtensionServiceWorker(context, 30_000);
  collector.attachServiceWorker(serviceWorker);
  return { context, page, extensionId, serviceWorker, testPageUrl, verifyPageUrl, longPageUrl, dynamicContentPageUrl, frPageUrl, linkSourceUrl, linkTargetUrl, spaSourceUrl, spaTargetUrl, staticServer, mockServer, mockServerConfig, collector };
}

/**
 * 统一资源清理函数。
 *
 * 依次关闭浏览器上下文、静态页面服务器和 Mock 服务器子进程。
 * 每个清理步骤都有独立的 try/catch，确保一个清理失败不会影响其他清理。
 *
 * @param {Object} scope - setup 函数返回的作用域对象
 * @param {import("playwright").BrowserContext} [scope.context] - 浏览器上下文
 * @param {{ server: http.Server, baseUrl: string }} [scope.staticServer] - 静态页面服务器
 * @param {import("node:child_process").ChildProcess} [scope.mockServer] - Mock 服务器子进程
 */
export async function teardown(scope) {
  if (scope.context) await scope.context.close().catch(() => {});
  if (scope.staticServer?.server) await new Promise((resolve) => scope.staticServer.server.close(resolve));
  if (scope.mockServer) scope.mockServer.kill("SIGTERM");
}
