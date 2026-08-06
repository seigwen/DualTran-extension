/**
 * E2E mock 模式配置
 *
 * 定义两种 mock LLM 服务器模式及其配置参数。
 * 由 run-all.mjs 和 setup.mjs 导入使用。
 *
 * @module browser-e2e-config
 */

import path from "node:path";

/**
 * 解析 --mock-mode= 命令行参数（保留向后兼容，但始终使用 aimock）。
 * @param {string[]} argv - 命令行参数数组
 * @returns {{ mockMode?: string }} 解析后的参数对象
 */
export function parseBrowserE2eArgs(argv = []) {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith("--mock-mode=")) {
      parsed.mockMode = arg.slice("--mock-mode=".length).trim();
    }
  }
  return parsed;
}

/**
 * 根据 mock 模式名称解析完整的配置对象。
 * 始终使用 aimock 服务器（legacy mock-llm-server.js 已移除）。
 * @param {{ projectRoot: string, mockMode?: string }} params - 项目根目录和 mock 模式名称
 * @returns {{ mode: string, port: number, healthUrl: string, startScript: string, env: Object, openRouterApiBase: string, expectedAiSnippet: string, providerConfigs: Object }} 配置对象
 */
export function resolveMockModeConfig({ projectRoot, mockMode }) {
  return {
    mode: "aimock",
    port: 8788,
    healthUrl: "http://127.0.0.1:8788/health",
    startScript: path.join(projectRoot, "tests", "mock-server", "mock-llm-server-aimock.js"),
    env: { AIMOCK_LLM_PORT: "8788" },
    openRouterApiBase: "http://127.0.0.1:8788/openrouter/v1",
    expectedAiSnippet: "🌐[aimock]",
    providerConfigs: {
      openrouter: {
        aiProvider: "openrouter",
        apiKey: "mock-openrouter-key",
        apiBase: "http://127.0.0.1:8788/openrouter/v1",
        model: "openai/gpt-4o-mini",
      },
      anthropic: {
        aiProvider: "anthropic",
        apiKey: "mock-anthropic-key",
        apiBase: "http://127.0.0.1:8788/anthropic",
        model: "claude-3-5-haiku-latest",
      },
      gemini: {
        aiProvider: "google-gemini",
        apiKey: "mock-gemini-key",
        apiBase: "http://127.0.0.1:8788/gemini",
        model: "gemini-2.0-flash",
      },
    },
  };
}
