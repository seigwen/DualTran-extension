/**
 * 共享测试服务器管理模块
 *
 * 统一 Mock LLM 服务器和静态测试页面服务器的启动/关闭逻辑，
 * 供 Playwright E2E（browser-e2e/setup.mjs）和 MCP E2E（mcp-e2e/start-test-servers.js）复用。
 *
 * @module test-server-manager
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// ─── 常量 ───────────────────────────────────────────────────────

/** 当前文件的目录路径（ESM 中 __dirname 不可用，需通过 fileURLToPath 计算） */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录 */
const projectRoot = path.resolve(__dirname, "../..");

/** 默认 aimock 服务器端口 */
const DEFAULT_AIMOCK_PORT = 8788;

/** E2E 测试页面目录 */
const E2E_PAGES_DIR = path.join(projectRoot, "extra", "e2e");

// ─── 默认测试页面映射表 ─────────────────────────────────────────

/**
 * 读取所有 E2E 测试页面 HTML 文件并构建路径→内容的映射表。
 *
 * 包含 9 个页面：
 *   - test-page.html（基础测试页面）
 *   - translation-verify-page.html（富内容验证页面）
 *   - long-page.html（长页面，200 个动态段落）
 *   - dynamic-content.html（动态内容页面）
 *   - translation-verify-page-fr.html（法语版验证页面）
 *   - link-source.html（链接源页面）
 *   - link-target.html（链接目标页面）
 *   - spa-source.html（SPA 源页面，模拟 Turbo Drive 导航）
 *   - spa-target.html（SPA 目标页面，模拟 Turbo Drive 导航）
 *
 * @returns {Promise<Map<string, string>>} 路径→HTML 内容的映射表
 */
async function loadDefaultPages() {
  /** 默认测试页面文件名列表 */
  const pageFiles = [
    "test-page.html",
    "translation-verify-page.html",
    "long-page.html",
    "dynamic-content.html",
    "translation-verify-page-fr.html",
    "link-source.html",
    "link-target.html",
    "spa-source.html",
    "spa-target.html",
  ];

  const pages = new Map();
  for (const file of pageFiles) {
    const filePath = path.join(E2E_PAGES_DIR, file);
    try {
      const html = await fs.readFile(filePath, "utf8");
      pages.set(`/${file}`, html);
    } catch (err) {
      console.warn(`[test-server-manager] 跳过不存在的页面文件: ${file} — ${err.message}`);
    }
  }
  // 根路径 "/" 映射到 test-page.html
  if (pages.has("/test-page.html")) {
    pages.set("/", pages.get("/test-page.html"));
  }
  return pages;
}

// ═════════════════════════════════════════════════════════════════
// Mock LLM 服务器管理
// ═════════════════════════════════════════════════════════════════

/**
 * 启动 aimock LLM 服务器（基于 @copilotkit/aimock）。
 *
 * 该函数封装了 mock-llm-server-aimock.js 的启动 + 健康检查流程。
 * 服务器以子进程方式运行，stdout/stderr 管道到当前进程。
 *
 * @param {number} [port=8788] - 服务器监听端口
 * @returns {Promise<{ process: import("child_process").ChildProcess, url: string, healthUrl: string }>}
 * @throws {Error} 服务器启动超时或健康检查失败时抛出
 */
export async function startAimockServer(port = DEFAULT_AIMOCK_PORT) {
  const startScript = path.join(projectRoot, "tests", "mock-server", "mock-llm-server-aimock.js");
  const url = `http://127.0.0.1:${port}`;
  const healthUrl = `${url}/health`;

  // 以子进程方式启动 mock 服务器
  const child = spawn("node", [startScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AIMOCK_LLM_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // 管道子进程输出到主进程
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  // 等待服务器健康检查通过
  await waitForServerHealthy(healthUrl, 15000);

  return { process: child, url, healthUrl };
}

/**
 * 停止 aimock LLM 服务器。
 *
 * 先尝试 SIGTERM 优雅退出，超时后 SIGKILL 强制终止。
 *
 * @param {import("child_process").ChildProcess} serverProcess - 服务器子进程
 * @returns {Promise<void>}
 */
export async function stopAimockServer(serverProcess) {
  if (!serverProcess) return;

  // 尝试调用 aimock 的 stopAimockLlmServer（如果可访问）
  try {
    const { stopAimockLlmServer } = await import(
      path.join(projectRoot, "tests", "mock-server", "mock-llm-server-aimock.js")
    );
    await stopAimockLlmServer(serverProcess).catch(() => {});
  } catch (_) {
    // 模块导入失败，直接 kill
  }

  if (serverProcess.killed) return;

  // SIGTERM 优雅退出
  serverProcess.kill("SIGTERM");

  // 等待 3 秒，如果进程仍存活则 SIGKILL
  await new Promise((resolve) => setTimeout(resolve, 3000));
  if (!serverProcess.killed) {
    serverProcess.kill("SIGKILL");
  }
}

// ═════════════════════════════════════════════════════════════════
// 静态页面服务器管理
// ═════════════════════════════════════════════════════════════════

/**
 * 启动静态 HTTP 服务器，托管测试页面。
 *
 * @param {Map<string, string>} [pages] - 路径→HTML 内容映射表，默认加载全部 7 个测试页面
 * @returns {Promise<{ server: http.Server, baseUrl: string }>}
 */
export async function startStaticServer(pages) {
  // 如果未提供页面映射表，加载默认页面
  const pageMap = pages || await loadDefaultPages();

  const server = http.createServer((req, res) => {
    const html = pageMap.get(req.url);
    if (html) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  // 监听随机端口
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

/**
 * 停止静态页面服务器。
 *
 * @param {http.Server} server - HTTP 服务器实例
 * @returns {Promise<void>}
 */
export async function stopStaticServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

// ═════════════════════════════════════════════════════════════════
// 一键启动完整环境
// ═════════════════════════════════════════════════════════════════

/**
 * 一键启动完整的测试环境（Mock LLM + 静态页面）。
 *
 * @param {{ withMock?: boolean, mockPort?: number, pages?: Map<string, string> }} [options={}]
 * @returns {Promise<{ mockUrl?: string, staticUrl: string, cleanup: () => Promise<void> }>}
 */
export async function startTestEnvironment(options = {}) {
  const { withMock = true, mockPort = DEFAULT_AIMOCK_PORT, pages } = options;

  /** 清理函数列表（按逆序执行） */
  const cleanups = [];

  try {
    let mockUrl = undefined;

    // 启动 Mock LLM 服务器（如果需要）
    if (withMock) {
      const mock = await startAimockServer(mockPort);
      mockUrl = mock.url;
      cleanups.push(() => stopAimockServer(mock.process));
    }

    // 启动静态页面服务器
    const staticServer = await startStaticServer(pages);
    const staticUrl = staticServer.baseUrl;
    cleanups.push(() => stopStaticServer(staticServer.server));

    // 返回环境信息和统一清理函数
    return {
      mockUrl,
      staticUrl,
      cleanup: async () => {
        // 逆序执行清理
        for (const fn of cleanups.reverse()) {
          try {
            await fn();
          } catch (err) {
            console.warn("[test-server-manager] 清理过程中出错:", err.message);
          }
        }
      },
    };
  } catch (err) {
    // 启动失败时清理已启动的资源
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch (_) {}
    }
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════
// 辅助函数
// ═════════════════════════════════════════════════════════════════

/**
 * 轮询等待 HTTP 服务器健康检查通过。
 *
 * @param {string} healthUrl - 健康检查 URL
 * @param {number} [timeoutMs=15000] - 超时毫秒数
 * @returns {Promise<void>}
 * @throws {Error} 超时未就绪时抛出
 */
async function waitForServerHealthy(healthUrl, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const resp = await fetch(healthUrl);
      if (resp.ok) return;
    } catch (_) {
      // 服务器尚未就绪，继续轮询
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for server: ${healthUrl}`);
}
