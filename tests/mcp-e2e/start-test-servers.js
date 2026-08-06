/**
 * MCP E2E 测试辅助脚本 — 启动 mock LLM 服务器和静态测试页面服务器。
 *
 * 用法：
 * 由 Claude Code 通过 Bash run_in_background 启动服务器：node tests/mcp-e2e/start-test-servers.js；
 * 然后参考 ..\..\.claude\skills\run-e2e-mcp.md 进行测试。
 *
 * 启动后输出 JSON 到 stdout：
 *   { "mockUrl": "http://127.0.0.1:8788", "staticUrl": "http://127.0.0.1:XXXXX" }
 *
 * 通过 SIGTERM 优雅退出。
 *
 * 本文件现在委托给 tests/shared/test-server-manager.mjs 共享模块，
 * 与 Playwright E2E（browser-e2e/setup.mjs）复用同一套服务器管理逻辑。
 */
const { startTestEnvironment } = require("../shared/test-server-manager.mjs");

const MOCK_PORT = 8788;

async function main() {
  // 启动完整测试环境（Mock LLM + 静态页面服务器）
  const env = await startTestEnvironment({
    withMock: true,
    mockPort: MOCK_PORT,
  });

  // 输出 JSON 到 stdout，供 Claude Code 解析
  console.log(JSON.stringify({
    mockUrl: env.mockUrl,
    staticUrl: env.staticUrl,
  }));

  // 优雅退出
  const cleanup = async () => {
    console.log("Shutting down test servers...");
    await env.cleanup();
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

main().catch((err) => {
  console.error("Failed to start test servers:", err);
  process.exit(1);
});
