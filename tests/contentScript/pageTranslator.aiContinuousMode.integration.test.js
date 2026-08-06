/**
 * pageTranslator AI 持续翻译模式集成测试
 *
 * 验证修复后的行为：用户点击 AI 按钮后，动态加载的新内容（如 x.com 信息流）
 * 也会被自动 AI 翻译，而非仅在首轮后被跳过。
 *
 * Bug 描述：
 *   aiTranslateDynamically 每轮翻译完成后将 shouldForceAiAfterPageTranslation
 *   重置为 false，导致下一轮 _shouldSkipAiTranslation 返回 true（跳过）。
 *   修复后 shouldForce 持续保持 true，直到 restorePage() 或 stopAiAutoTranslate()。
 */

import { beforeEach, describe, expect, it, vi, beforeAll, afterAll } from "vitest";

const { getProxiesForTranslationMock, getAllProxiesMock, translateWithAIMock, configValues } = vi.hoisted(() => ({
  getProxiesForTranslationMock: vi.fn(() => []),
  getAllProxiesMock: vi.fn(() => []),
  translateWithAIMock: vi.fn(),
  configValues: {
    autoImproveByAI: "no",
    aiProvider: "openai",
    providerConfigs: {},
    targetLanguage: "fr",
    aiTranslatedColor: "rgb(1, 2, 3)",
    enableAiTranslationCache: "no",
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    alwaysTranslateLangs: [],
    targetLanguageTextTranslation: "",
  },
}));

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
    codeToLanguageNameInEnglish: vi.fn((c) => c),
    fixTLanguageCode: vi.fn((c) => c),
  },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({ default: {} }));
vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: { enable: vi.fn(), disable: vi.fn(), enabledObserverSubscribe: vi.fn(), isEnabled: false },
}));
vi.mock("../../src/contentScript/fetchSSE.js", () => ({
  translateWithAI: translateWithAIMock,
}));
vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
  notifyAiStreamParseError: vi.fn(),
  parseOpenAiStyleStreamMessage: vi.fn(() => ({ type: "done" })),
  parseTaggedPageTranslationProgress: vi.fn(() => ({ done: true })),
}));
vi.mock("../../src/contentScript/aiUiState.js", () => ({
  applyAiErrorState: vi.fn(),
  applyAiSuccessState: vi.fn(),
  applyAiTranslatingState: vi.fn(),
  ERROR_CROSS_COLOR: "#ff0000",
  formatAiTranslationError: vi.fn((e) => e?.message || "error"),
  renderAiErrorIndicator: vi.fn(),
}));
vi.mock("../../src/contentScript/i18n.js", () => ({}));
vi.mock("toastify-js", () => ({ default: vi.fn(() => ({ showToast: vi.fn() })) }));
vi.mock("gpt-tokenizer", () => ({ encode: vi.fn(() => []) }));
vi.mock("../../src/contentScript/singletonBtnGroup.js", () => ({
  registerBlock: vi.fn(),
  createSingletonButtonGroup: vi.fn(),
  destroySingletonButtonGroup: vi.fn(),
  attachHoverDelegation: vi.fn(),
  setCallbacks: vi.fn(),
  getProxiesForTranslation: getProxiesForTranslationMock,
  getAllProxies: getAllProxiesMock,
  getBlockState: vi.fn(() => null),
}));
vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({ getProvider: () => null, listProviders: () => [] }),
  BUILT_IN_PROVIDERS: [],
}));

/**
 * 创建模拟的 AI 翻译代理对象（符合 singletonBtnGroup BtnAiProxy 形状）
 * 确保 aiTranslateText 内部的 btnAi.btnAiTxtNode 等属性访问不会抛出异常。
 */
function makeMockAiProxy(sourceString) {
  const span1 = { textContent: "" };
  const span2 = { textContent: "" };
  const state = {
    sourceString,
    translatedTextNode: null,
    _translationId: null,
    _aiStatus: undefined,
    btnAiTxtNode: span1,
    tooltip: span2,
    _classList: {
      contains: () => false,
      add: () => {},
      remove: () => {},
    },
    _style: {},
    _setAttribute: () => {},
    googleBtnState: "success",
    nodesToClear: [],
  };

  Object.defineProperties(state, {
    translationId: {
      get() { return this._translationId; },
      set(v) { this._translationId = v; },
    },
    aiStatus: {
      get() { return this._aiStatus; },
      set(v) { this._aiStatus = v; },
    },
  });

  return {
    _st: () => state,
    get sourceString() { return state.sourceString; },
    get translatedTextNode() { return state.translatedTextNode; },
    get translationId() { return state.translationId; },
    set translationId(v) { state.translationId = v; },
    get translationStatus() { return state.aiStatus; },
    set translationStatus(v) { state.aiStatus = v; },
    get btnAiTxtNode() { return state.btnAiTxtNode; },
    get tooltip() { return state.tooltip; },
    get classList() { return state._classList; },
    get style() { return state._style; },
    setAttribute: state._setAttribute,
    get ownerDocument() { return document; },
  };
}

let pageTranslator;

beforeAll(async () => {
  vi.stubGlobal("top", window);
  vi.stubGlobal("self", window);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ text: () => Promise.resolve(""), ok: true })));
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn((payload, callback) => {
        if (typeof callback === "function") {
          const result = payload?.action === "getTabHostName" ? "example.com" : undefined;
          callback(result);
        }
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
    },
    i18n: { getMessage: vi.fn((k) => k) },
  });

  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;

  await vi.waitFor(() => {
    expect(pageTranslator._aiTranslateDynamically).toBeTypeOf("function");
  }, { timeout: 5000 });
});

describe("aiTranslateDynamically — AI 持续翻译模式", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProxiesForTranslationMock.mockReset();
    getAllProxiesMock.mockReset();
    translateWithAIMock.mockReset();

    configValues.autoImproveByAI = "no";
    configValues.aiProvider = "openai";
    configValues.providerConfigs = {};
    configValues.targetLanguage = "fr";
    configValues.enableAiTranslationCache = "no";
    configValues.targetLanguageTextTranslation = "";
  });

  it("skipCheck 通过时 aiTranslateDynamically 调用 getProxiesForTranslation", async () => {
    configValues.providerConfigs = { openai: { apiKey: "test-key" } };
    pageTranslator._setForceAiTranslation(true);
    getProxiesForTranslationMock.mockReturnValue([makeMockAiProxy("hello")]);
    getAllProxiesMock.mockReturnValue([{}]);

    await pageTranslator._aiTranslateDynamically();

    expect(getProxiesForTranslationMock).toHaveBeenCalled();
  });

  it("skipCheck 不通过时 aiTranslateDynamically 不调用 getProxiesForTranslation", async () => {
    configValues.providerConfigs = {};
    pageTranslator._setForceAiTranslation(false);

    await pageTranslator._aiTranslateDynamically();

    expect(getProxiesForTranslationMock).not.toHaveBeenCalled();
  });

  it("首轮翻译后 shouldForce 保持不变 — 第二轮动态内容也会被翻译", async () => {
    // 核心回归测试：验证 shouldForceAiAfterPageTranslation 没有在首轮后被重置
    configValues.providerConfigs = { openai: { apiKey: "test-key" } };
    pageTranslator._setForceAiTranslation(true);

    let callCount = 0;
    getProxiesForTranslationMock.mockImplementation(() => {
      callCount++;
      return [makeMockAiProxy(`content-round-${callCount}`)];
    });
    getAllProxiesMock.mockImplementation(() => [{ translationStatus: "idle" }]);

    await pageTranslator._aiTranslateDynamically();
    await pageTranslator._aiTranslateDynamically();
    await pageTranslator._aiTranslateDynamically();

    // 三轮都应调用 getProxiesForTranslation（均通过 skip 检查）
    expect(getProxiesForTranslationMock).toHaveBeenCalledTimes(3);
  });

  it("stopAiAutoTranslate 重置 shouldForce 后动态内容被跳过", async () => {
    configValues.providerConfigs = { openai: { apiKey: "test-key" } };
    pageTranslator._setForceAiTranslation(true);

    getProxiesForTranslationMock.mockReturnValue([makeMockAiProxy("hello")]);
    getAllProxiesMock.mockReturnValue([{}]);
    await pageTranslator._aiTranslateDynamically();
    expect(getProxiesForTranslationMock).toHaveBeenCalledTimes(1);

    pageTranslator.stopAiAutoTranslate();

    vi.clearAllMocks();
    getProxiesForTranslationMock.mockReturnValue([makeMockAiProxy("new content")]);
    getAllProxiesMock.mockReturnValue([{}]);

    await pageTranslator._aiTranslateDynamically();
    expect(getProxiesForTranslationMock).not.toHaveBeenCalled();
  });

  it("完整流程: translatePageAi 之后多轮翻译均生效, stopAiAutoTranslate 后停止", async () => {
    configValues.providerConfigs = { openai: { apiKey: "test-key" } };
    pageTranslator._setForceAiTranslation(true);

    let round = 0;
    getProxiesForTranslationMock.mockImplementation(() => {
      round++;
      return [makeMockAiProxy(`dynamic-content-${round}`)];
    });
    getAllProxiesMock.mockImplementation(() => [{}]);

    await pageTranslator._aiTranslateDynamically();
    await pageTranslator._aiTranslateDynamically();
    expect(getProxiesForTranslationMock).toHaveBeenCalledTimes(2);

    pageTranslator.stopAiAutoTranslate();

    vi.clearAllMocks();
    getProxiesForTranslationMock.mockReturnValue([makeMockAiProxy("should-be-skipped")]);
    getAllProxiesMock.mockReturnValue([{}]);
    await pageTranslator._aiTranslateDynamically();
    expect(getProxiesForTranslationMock).not.toHaveBeenCalled();
  });
});
