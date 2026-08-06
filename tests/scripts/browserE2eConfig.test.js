import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBrowserE2eArgs, resolveMockModeConfig } from "../browser-e2e/browser-e2e-config.mjs";

describe("browser E2E config", () => {
  const projectRoot = "C:/repo/project";

  it("defaults to aimock mode (legacy mock-llm-server.js removed)", () => {
    const config = resolveMockModeConfig({ projectRoot, mockMode: undefined });

    expect(config.mode).toBe("aimock");
    expect(config.port).toBe(8788);
    expect(config.healthUrl).toBe("http://127.0.0.1:8788/health");
    expect(config.startScript).toBe(path.join(projectRoot, "tests", "mock-server", "mock-llm-server-aimock.js"));
    expect(config.env).toEqual({ AIMOCK_LLM_PORT: "8788" });
    expect(config.openRouterApiBase).toBe("http://127.0.0.1:8788/openrouter/v1");
    expect(config.expectedAiSnippet).toBe("🌐[aimock]");
    // 验证 providerConfigs 包含三个提供商
    expect(config.providerConfigs).toBeDefined();
    expect(Object.keys(config.providerConfigs)).toEqual(["openrouter", "anthropic", "gemini"]);
    expect(config.providerConfigs.anthropic.aiProvider).toBe("anthropic");
    expect(config.providerConfigs.gemini.aiProvider).toBe("google-gemini");
  });

  it("always returns aimock config regardless of mockMode parameter", () => {
    const config = resolveMockModeConfig({ projectRoot, mockMode: "aimock" });

    expect(config.mode).toBe("aimock");
    expect(config.port).toBe(8788);
    expect(config.startScript).toBe(path.join(projectRoot, "tests", "mock-server", "mock-llm-server-aimock.js"));
    expect(config.openRouterApiBase).toBe("http://127.0.0.1:8788/openrouter/v1");
    expect(config.expectedAiSnippet).toBe("🌐[aimock]");
    expect(config.providerConfigs).toBeDefined();
  });

  it("parses mock mode from CLI args", () => {
    expect(parseBrowserE2eArgs(["--mock-mode=aimock"])).toEqual({ mockMode: "aimock" });
    expect(parseBrowserE2eArgs([])).toEqual({});
  });
});
