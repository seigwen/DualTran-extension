import { describe, expect, it, vi, beforeAll } from "vitest";

// 使用 vi.hoisted 确保 mock 状态在 vi.mock 工厂之前创建
const { configValues } = vi.hoisted(() => ({
  configValues: {},
}));

// Mock pageTranslator.js 的所有传递依赖，确保模块加载不会触发真实的 chrome API 调用
// platformInfo.js 和 showOriginal.js 必须在 vi.mock 中处理，因为它们有顶层 chrome 引用
vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: vi.fn((key) => configValues[key]),
    set: vi.fn((key, value) => { configValues[key] = value; }),
    onReady: vi.fn(() => Promise.resolve()),
    onChanged: vi.fn(),
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    otherConfigs: {},
    codeToLanguageNameInEnglish: vi.fn((c) => c),
    fixTLanguageCode: vi.fn((c) => c),
  },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({
  default: {},
}));

vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: {
    enable: vi.fn(),
    disable: vi.fn(),
    add: vi.fn(),
    removeAll: vi.fn(),
    enabledObserverSubscribe: vi.fn(),
    isEnabled: true,
  },
}));

vi.mock("../../src/contentScript/fetchSSE.js", () => ({
  translateWithAI: vi.fn(),
}));

vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
  notifyAiStreamParseError: vi.fn(),
  parseOpenAiStyleStreamMessage: vi.fn(),
  parseTaggedPageTranslationProgress: vi.fn(),
}));

vi.mock("../../src/contentScript/aiUiState.js", () => ({
  applyAiErrorState: vi.fn(),
  applyAiSuccessState: vi.fn(),
  applyAiTranslatingState: vi.fn(),
  ERROR_CROSS_COLOR: "#ff0000",
  formatAiTranslationError: vi.fn(() => ""),
  renderAiErrorIndicator: vi.fn(),
  renderAiSuccessIndicator: vi.fn(),
}));

vi.mock("../../src/contentScript/i18n.js", () => ({
  getFloatingButtonAiTooltipText: vi.fn(() => ""),
  getFloatingButtonGoogleTooltipText: vi.fn(() => ""),
}));

vi.mock("toastify-js", () => ({
  default: vi.fn(() => ({ showToast: vi.fn() })),
}));

vi.mock("gpt-tokenizer", () => ({
  encode: vi.fn((text) => Array.from(String(text || ""))),
}));

vi.mock("../../src/util/globalWordsCount.js", () => ({
  wordsCount: vi.fn(() => 0),
}));

vi.mock("../../src/contentScript/singletonBtnGroup.js", () => ({
  registerBlock: vi.fn(),
  createSingletonButtonGroup: vi.fn(),
  destroySingletonButtonGroup: vi.fn(),
  attachHoverDelegation: vi.fn(),
  setCallbacks: vi.fn(),
  getProxiesForTranslation: vi.fn(() => []),
  getAllProxies: vi.fn(() => []),
  updateSingletonUI: vi.fn(),
  getBlockState: vi.fn(),
}));

vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({ getProvider: () => null, listProviders: () => [] }),
  BUILT_IN_PROVIDERS: [],
}));

vi.mock("../../src/lib/ai/providerTypes.js", () => ({
  validateProviderDefinition: () => [],
}));

// pageTranslator.js 的顶层代码 Promise.all([twpConfig.onReady(), getTabHostName()])
// 需要 chrome.runtime.sendMessage。用 stubGlobal 在动态 import 之前设置，避免未处理的 rejection。
// twpConfig.onReady mock 返回 Promise.resolve()（不调用回调），getTabHostName 需要 chrome。

describe("pageTranslator helpers", () => {
  let resolveDontSortResults;
  let shouldTriggerAiImprove;
  let resolveNextAiRenderState;

  beforeAll(async () => {
    // 在动态 import 之前设置 chrome global，避免 getTabHostName 顶层调用失败
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: vi.fn((_, cb) => cb?.({})), set: vi.fn((_, cb) => cb?.()) },
        onChanged: { addListener: vi.fn() },
      },
      i18n: { getAcceptLanguages: vi.fn((cb) => cb?.([])), getMessage: vi.fn((k) => k) },
      runtime: {
        getManifest: vi.fn(() => ({ version: "1.0", commands: {} })),
        id: "test",
        sendMessage: vi.fn((_msg, cb) => cb?.("example.com")),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      commands: { getAll: vi.fn((cb) => cb?.([])) },
    });

    const mod = await import("../../src/contentScript/pageTranslator.js");
    resolveDontSortResults = mod.resolveDontSortResults;
    shouldTriggerAiImprove = mod.shouldTriggerAiImprove;
    resolveNextAiRenderState = mod.resolveNextAiRenderState;
  });

  it("C3: resolveDontSortResults('yes') returns true", () => {
    expect(resolveDontSortResults("yes")).toBe(true);
  });

  it("C3: resolveDontSortResults('no') returns false", () => {
    expect(resolveDontSortResults("no")).toBe(false);
  });

  it("C3: resolveDontSortResults(undefined) returns false", () => {
    expect(resolveDontSortResults(undefined)).toBe(false);
  });

  it("D1: shouldTriggerAiImprove returns true when word count exceeds threshold", () => {
    expect(shouldTriggerAiImprove(50, 10)).toBe(true);
  });

  it("D1: shouldTriggerAiImprove returns false when word count below threshold", () => {
    expect(shouldTriggerAiImprove(5, 10)).toBe(false);
  });

  // 回归测试: ISSUE-006 — threshold=0 应始终触发（与 addTranslatedContent 行为一致）
  // 发现于 /qa on 2026-07-03
  it("D1: shouldTriggerAiImprove returns true when threshold is 0 (always improve)", () => {
    expect(shouldTriggerAiImprove(100, 0)).toBe(true);
    expect(shouldTriggerAiImprove(1, 0)).toBe(true);
  });

  it("D1: shouldTriggerAiImprove returns false when threshold is 0 and wordCount is 0", () => {
    expect(shouldTriggerAiImprove(0, 0)).toBe(false);
  });

  it("D1: shouldTriggerAiImprove returns false when threshold is negative", () => {
    expect(shouldTriggerAiImprove(100, -5)).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────
  // resolveNextAiRenderState — AI 渲染状态决策（含 bfcache 恢复场景）
  // ──────────────────────────────────────────────────────────────

  it("returns 'loading' when blocks are currently translating", () => {
    expect(resolveNextAiRenderState("idle", 3, 5, 10)).toBe("loading");
    expect(resolveNextAiRenderState("success", 1, 0, 5)).toBe("loading");
  });

  it("returns 'success' when all blocks are translated and none pending", () => {
    expect(resolveNextAiRenderState("idle", 0, 0, 5)).toBe("success");
    expect(resolveNextAiRenderState("loading", 0, 0, 3)).toBe("success");
  });

  it("returns null when state is idle and blocks need translation (normal operation)", () => {
    // 正常运行中：有待翻译块，当前状态是 idle，保持 idle（等待 AI 翻译定时器处理）
    expect(resolveNextAiRenderState("idle", 0, 3, 5)).toBeNull();
  });

  it("returns null when state is loading and blocks need translation (waiting to start)", () => {
    // 正常运行中：前次翻译刚结束，新块加入，状态已是 loading，保持
    expect(resolveNextAiRenderState("loading", 0, 2, 5)).toBeNull();
  });

  it("corrects stale 'success' to 'idle' when blocks need translation (bfcache restore)", () => {
    // bfcache 恢复场景：旧块已翻译，新块（动态内容重新加载后由 Google 缓存翻译）
    // 需要 AI 翻译但当前状态是过时的 success（bfcache 保留的）
    expect(resolveNextAiRenderState("success", 0, 3, 8)).toBe("idle");
    // 一个块也未翻译完成的新页面
    expect(resolveNextAiRenderState("success", 0, 5, 5)).toBe("idle");
  });

  it("corrects stale 'error' to 'idle' when blocks need translation (bfcache restore after error)", () => {
    // bfcache 恢复场景：AI 翻译之前出错，且新块需要翻译
    expect(resolveNextAiRenderState("error", 0, 2, 5)).toBe("idle");
  });

  it("returns null for 'idle' with 0 translating and some pending (no change needed)", () => {
    // 所有块都待翻译，状态已是 idle → 不变
    expect(resolveNextAiRenderState("idle", 0, 10, 10)).toBeNull();
  });

  it("returns null when there are no blocks at all", () => {
    // 没有任何翻译块，不应改变状态
    expect(resolveNextAiRenderState("success", 0, 0, 0)).toBeNull();
    expect(resolveNextAiRenderState("idle", 0, 0, 0)).toBeNull();
  });
});
