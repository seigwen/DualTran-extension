/**
 * MutationObserver 过滤回归测试 — AI 翻译重复译文 bug
 *
 * Bug: AI 翻译写入 aiSpan.textContent 时，MutationObserver 将新 text node
 * （parentNode 是 aiSpan，不是 <translated>）加入 newNodes → getPiecesToTranslate
 * 创建新 piece → translateDynamically() 再次翻译 → 产生重复 <translated> 元素。
 *
 * 根因: MutationObserver 回调只检查 immediate parent 是否是 <translated>，
 * 没有检查祖先链。
 *
 * 修复: 用 isDescendantOfTranslated(node) 替代单层 parent 检查。
 */

import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";

const mockState = vi.hoisted(() => {
  const configValues = {
    aiImproveForLongerThan: 0,
    translatedColor: "rgba(11, 112, 33, 1)",
    aiTranslatedColor: "#2041FF",
    whereToDisplayTranslatedText: "newLine",
    dontSortResults: "yes",
    autoImproveByAI: "no",
    aiProvider: "openai",
    apiKeyOpenAI: "test-key",
    translateLongerThan: 0,
    customDictionary: new Map(),
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    translateDynamicallyCreatedContent: "yes",
  };
  return {
    configValues,
    registerBlockMock: vi.fn(),
    ensureSingletonInitMock: vi.fn(),
    getBlockStateMock: vi.fn(() => null),
    showOriginalIsEnabled: false,
    showOriginalAddMock: vi.fn(),
  };
});

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: vi.fn((key) => mockState.configValues[key]),
    set: vi.fn((key, value) => { mockState.configValues[key] = value; }),
    onReady: vi.fn(() => Promise.resolve()),
    onChanged: vi.fn(),
    ready: true,
  },
}));

vi.mock("../../src/lib/languages.js", () => ({ default: { fixTLanguageCode: (c) => c } }));
vi.mock("../../src/lib/platformInfo.js", () => ({ default: { isMobile: { any: false } } }));
vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: {
    get isEnabled() { return mockState.showOriginalIsEnabled; },
    add: mockState.showOriginalAddMock,
    enable: vi.fn(),
    disable: vi.fn(),
    enabledObserverSubscribe: vi.fn(),
  },
}));
vi.mock("../../src/contentScript/fetchSSE.js", () => ({ translateWithAI: vi.fn() }));
vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(() => ({ type: "done" })),
  parseTaggedPageTranslationProgress: vi.fn(() => ({ done: true })),
  notifyAiStreamParseError: vi.fn(),
}));
vi.mock("../../src/contentScript/aiUiState.js", async () => {
  const actual = await vi.importActual("../../src/contentScript/aiUiState.js");
  return {
    ...actual,
    applyAiErrorState: vi.fn(),
    applyAiSuccessState: vi.fn(),
    applyAiTranslatingState: actual.applyAiTranslatingState,
    ERROR_CROSS_COLOR: "red",
    formatAiTranslationError: vi.fn((e) => e?.message || "error"),
    renderAiErrorIndicator: vi.fn(),
  };
});
vi.mock("../../src/contentScript/i18n.js", () => ({}));
vi.mock("toastify-js", () => ({ default: vi.fn(() => ({ showToast: vi.fn() })) }));
vi.mock("gpt-tokenizer", () => ({ encode: vi.fn(() => []) }));
vi.mock("../../src/util/globalWordsCount.js", () => ({ wordsCount: (t) => t.split(/\s+/).filter(Boolean).length }));
vi.mock("../../src/contentScript/singletonBtnGroup.js", () => ({
  registerBlock: mockState.registerBlockMock,
  createSingletonButtonGroup: vi.fn(),
  destroySingletonButtonGroup: vi.fn(),
  attachHoverDelegation: vi.fn(),
  setCallbacks: vi.fn(),
  getProxiesForTranslation: vi.fn(() => []),
  getAllProxies: vi.fn(() => []),
  updateSingletonUI: vi.fn(),
  getBlockState: mockState.getBlockStateMock,
  ensureSingletonInit: mockState.ensureSingletonInitMock,
}));
vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({ getProvider: () => null }),
  BUILT_IN_PROVIDERS: [],
}));
vi.mock("../../src/lib/ai/providerTypes.js", () => ({}));
vi.mock("../../src/lib/ai/providerModelPreview.js", () => ({}));

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: vi.fn((payload, callback) => {
      if (typeof callback === "function") {
        if (payload?.action === "getTabHostName") {
          callback("example.com");
        } else {
          callback(undefined);
        }
      }
    }),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    getURL: vi.fn((p) => p),
    id: "test-id",
  },
  tabs: { query: vi.fn(() => Promise.resolve([{ url: "https://example.com" }])) },
  storage: {
    local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  i18n: { getMessage: vi.fn((k) => k) },
});

vi.stubGlobal("top", window);
vi.stubGlobal("self", window);
vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ text: () => Promise.resolve(""), ok: true })));

let isDescendantOfTranslated;

beforeAll(async () => {
  const mod = await import("../../src/contentScript/pageTranslator.js");
  await vi.waitFor(() => {
    expect(mod.pageTranslator._isDescendantOfTranslated).toBeTypeOf("function");
  }, { timeout: 5000 });
  isDescendantOfTranslated = mod.pageTranslator._isDescendantOfTranslated;
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isDescendantOfTranslated — 防止 AI 翻译内容被重复翻译", () => {
  it("直接子节点（text node inside <translated>）应返回 true", () => {
    const translated = document.createElement("translated");
    const textNode = document.createTextNode("翻译文本");
    translated.appendChild(textNode);
    document.body.appendChild(translated);

    expect(isDescendantOfTranslated(textNode)).toBe(true);
  });

  it("嵌套子节点（text node inside span inside <translated>）应返回 true", () => {
    const translated = document.createElement("translated");
    const span = document.createElement("span");
    span.className = "dualtran-ai";
    const textNode = document.createTextNode("AI 翻译结果");
    span.appendChild(textNode);
    translated.appendChild(span);
    document.body.appendChild(translated);

    // 这是 bug 的核心场景: text node 的 parentNode 是 span (不是 translated)
    // 旧代码只检查 parentNode，所以漏掉了这种情况
    expect(isDescendantOfTranslated(textNode)).toBe(true);
  });

  it("深层嵌套（text node inside span inside span inside <translated>）应返回 true", () => {
    const translated = document.createElement("translated");
    const outerSpan = document.createElement("span");
    const innerSpan = document.createElement("span");
    const textNode = document.createTextNode("深层嵌套文本");
    innerSpan.appendChild(textNode);
    outerSpan.appendChild(innerSpan);
    translated.appendChild(outerSpan);
    document.body.appendChild(translated);

    expect(isDescendantOfTranslated(textNode)).toBe(true);
  });

  it("非 <translated> 子节点应返回 false", () => {
    const p = document.createElement("p");
    const textNode = document.createTextNode("普通段落文本");
    p.appendChild(textNode);
    document.body.appendChild(p);

    expect(isDescendantOfTranslated(textNode)).toBe(false);
  });

  it("span 内的 text node（不在 <translated> 内）应返回 false", () => {
    const p = document.createElement("p");
    const span = document.createElement("span");
    const textNode = document.createTextNode("行内文本");
    span.appendChild(textNode);
    p.appendChild(span);
    document.body.appendChild(p);

    expect(isDescendantOfTranslated(textNode)).toBe(false);
  });

  it("多个 <translated> 元素时，第二个 <translated> 内的节点应返回 true", () => {
    const t1 = document.createElement("translated");
    const t2 = document.createElement("translated");
    const span = document.createElement("span");
    const textNode = document.createTextNode("第二个翻译块");
    span.appendChild(textNode);
    t2.appendChild(span);
    document.body.appendChild(t1);
    document.body.appendChild(t2);

    expect(isDescendantOfTranslated(textNode)).toBe(true);
  });

  it("googleSpan 和 aiSpan 都在 <translated> 内时，两者都应返回 true", () => {
    const translated = document.createElement("translated");
    const googleSpan = document.createElement("span");
    googleSpan.className = "dualtran-google";
    googleSpan.textContent = "Google 翻译";
    const aiSpan = document.createElement("span");
    aiSpan.className = "dualtran-ai";
    aiSpan.textContent = "AI 翻译";
    translated.appendChild(googleSpan);
    translated.appendChild(aiSpan);
    document.body.appendChild(translated);

    // 两个 span 内的 text node 都应该被检测为 <translated> 的后代
    expect(isDescendantOfTranslated(googleSpan.firstChild)).toBe(true);
    expect(isDescendantOfTranslated(aiSpan.firstChild)).toBe(true);
  });
});

// Note: MutationObserver filter tests for .dualtran-aitranslatedtext-replacemode
// and data-dualtran-encapsulated are not included here because the observer is only
// activated during translatePage() and cannot be tested in isolation.
// The translateResults guard (tested in pageTranslator.integration.test.js) is the
// primary fix. The observer filter is defense-in-depth.
