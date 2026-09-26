/**
 * MutationObserver characterData 分类回归测试 — x.com「Show more」展开文字不翻译 bug（#98）
 *
 * Bug: pageTranslator.js 的 observer 回调对 `mutation.type === "characterData"`
 * 无条件 return（PR #16 为防反馈环引入）。站点原地改写既有文本节点
 * （React nodeValue 赋值 = characterData 突变，如 x.com 点击 Show more 展开长推文）
 * 因此永远进不了翻译管道 → 展开后的文字保持原文，不被翻译。
 *
 * 修复：按「值比对」分类 characterData 突变：
 *   - 当前 data === 扩展最近写入值（markTextWrite 登记）→ 自写，跳过（防反馈环）
 *   - 其它 → 站点写，加入 hostUpdatedTextNodes → 相关 piece 标记重译 / 重新入管道
 *
 * 本文件锁定：
 *   1. 站点原地更新 → 被拾取（修复前：无条件跳过 → 本测试 RED）
 *   2. 扩展自写（markTextWrite）→ 不拾取（反馈环防护不回归）
 *   3. <translated> 内部文本 → 不拾取
 *   4. 相同值重写（oldValue === data）→ 不拾取
 *   5. 已翻译 piece 的节点被站点更新 → isTranslated 复位，重新进入翻译管道
 */

import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";

const mockState = vi.hoisted(() => {
  const configValues = {
    aiImproveForLongerThan: 0,
    translatedColor: "",
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
// mock-fidelity-allow: this suite tests observer characterData classification, not arrival parsing (pinned by hoverBtn* + crossLevelInteraction matrix)
vi.mock("../../src/contentScript/fetchSSE.js", () => ({ translateWithAI: vi.fn() }));
// mock-fidelity-allow: same as fetchSSE — arrival parsing is not this file's subject (observer classification tests)
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
    applyAiTranslatingState: vi.fn(),
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

let pageTranslator;
let handleObserverMutations;
let getHostUpdatedTextNodes;
let updatePiecesToTranslateWithNewNodes;
let getPiecesToTranslateArray;
let markTextWrite;

beforeAll(async () => {
  const mod = await import("../../src/contentScript/pageTranslator.js");
  const writesMod = await import("../../src/contentScript/extensionTextWrites.js");
  pageTranslator = mod.pageTranslator;
  await vi.waitFor(() => {
    expect(pageTranslator._handleObserverMutations).toBeTypeOf("function");
    expect(pageTranslator._updatePiecesToTranslateWithNewNodes).toBeTypeOf("function");
    expect(pageTranslator._getPiecesToTranslateArray).toBeTypeOf("function");
  }, { timeout: 5000 });
  handleObserverMutations = pageTranslator._handleObserverMutations;
  getHostUpdatedTextNodes = pageTranslator._getHostUpdatedTextNodes;
  updatePiecesToTranslateWithNewNodes = pageTranslator._updatePiecesToTranslateWithNewNodes;
  getPiecesToTranslateArray = pageTranslator._getPiecesToTranslateArray;
  markTextWrite = writesMod.markTextWrite;
});

/** Build a synthetic characterData MutationRecord. */
function charDataRecord(textNode, oldValue) {
  return {
    type: "characterData",
    target: textNode,
    addedNodes: [],
    removedNodes: [],
    oldValue,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  // Reset the pieces array between tests (shared module state).
  getPiecesToTranslateArray().length = 0;
});

describe("#98 站点原地改写文本节点（characterData）必须被拾取", () => {
  it("站点改写文本节点 → 进入 hostUpdatedTextNodes（修复前被无条件跳过）", () => {
    const p = document.createElement("p");
    const textNode = document.createTextNode("truncated preview text");
    p.appendChild(textNode);
    document.body.appendChild(p);

    // Site writes the expanded text in place (React nodeValue assignment)
    const oldValue = textNode.data;
    textNode.data = "truncated preview text plus the expanded remainder";

    handleObserverMutations([charDataRecord(textNode, oldValue)]);

    expect(getHostUpdatedTextNodes().has(textNode)).toBe(true);
  });

  it("扩展自写（markTextWrite 登记过）→ 不进入 hostUpdatedTextNodes", () => {
    const p = document.createElement("p");
    const textNode = document.createTextNode("original");
    p.appendChild(textNode);
    document.body.appendChild(p);

    // Extension writes a translation into the page text node (replaceOriginal path)
    textNode.textContent = "traduction";
    markTextWrite(textNode);

    handleObserverMutations([charDataRecord(textNode, "original")]);

    expect(getHostUpdatedTextNodes().has(textNode)).toBe(false);
  });

  it("自写之后站点再写不同值 → 仍被拾取（值比对语义，非成员资格）", () => {
    const p = document.createElement("p");
    const textNode = document.createTextNode("source");
    p.appendChild(textNode);
    document.body.appendChild(p);

    // 1. Extension write
    textNode.textContent = "traduction";
    markTextWrite(textNode);

    // 2. Site overwrites with something else (expanded text)
    const oldValue = textNode.data;
    textNode.data = "source plus expanded remainder";
    handleObserverMutations([charDataRecord(textNode, oldValue)]);

    expect(getHostUpdatedTextNodes().has(textNode)).toBe(true);
  });

  it("<translated> 内部的文本变化 → 不拾取（反馈环防护）", () => {
    const translated = document.createElement("translated");
    const span = document.createElement("span");
    span.className = "dualtran-google";
    const textNode = document.createTextNode("译文");
    span.appendChild(textNode);
    translated.appendChild(span);
    document.body.appendChild(translated);

    textNode.data = "新译文";
    handleObserverMutations([charDataRecord(textNode, "译文")]);

    expect(getHostUpdatedTextNodes().has(textNode)).toBe(false);
  });

  it("相同值重写（oldValue === data）→ 不拾取（no-op 重渲染不触发重译）", () => {
    const p = document.createElement("p");
    const textNode = document.createTextNode("same value");
    p.appendChild(textNode);
    document.body.appendChild(p);

    handleObserverMutations([charDataRecord(textNode, "same value")]);

    expect(getHostUpdatedTextNodes().has(textNode)).toBe(false);
  });
});

describe("#98 站点更新触发已翻译 piece 重译", () => {
  it("已翻译 piece 的节点被站点更新 → 重新发出翻译请求，且请求文本含展开后的新文本", () => {
    const p = document.createElement("p");
    const textNode = document.createTextNode("preview");
    p.appendChild(textNode);
    document.body.appendChild(p);

    // Simulate a translated piece that references this node
    const pieces = getPiecesToTranslateArray();
    const piece = { nodes: [textNode], isTranslated: true };
    pieces.push(piece);

    // Capture translateHTML request payloads
    const sentPayloads = [];
    const originalSend = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage.mockImplementation((payload, callback) => {
      if (payload?.action === "translateHTML") {
        sentPayloads.push(payload);
      }
      if (typeof callback === "function") callback(undefined);
    });

    try {
      // Site expands the text in place
      const oldValue = textNode.data;
      textNode.data = "preview plus expanded remainder";
      handleObserverMutations([charDataRecord(textNode, oldValue)]);

      updatePiecesToTranslateWithNewNodes();

      // The update tick consumed the record
      expect(getHostUpdatedTextNodes().size).toBe(0);

      // A translation request was issued and its payload carries the EXPANDED text
      expect(sentPayloads.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(sentPayloads);
      expect(serialized).toContain("expanded remainder");
    } finally {
      chrome.runtime.sendMessage.mockImplementation(originalSend.getMockImplementation());
    }
  });

  it("无 piece 引用的站点更新 → 节点重新扫描进入管道", () => {
    const p = document.createElement("p");
    const textNode = document.createTextNode("");
    p.appendChild(textNode);
    document.body.appendChild(p);

    // Site fills the previously-empty text node (lazy reveal)
    const oldValue = textNode.data;
    textNode.data = "newly revealed long text content for translation";
    handleObserverMutations([charDataRecord(textNode, oldValue)]);

    updatePiecesToTranslateWithNewNodes();

    const pieces = getPiecesToTranslateArray();
    const referenced = pieces.some((ptt) =>
      ptt.nodes && ptt.nodes.some((n) => n === textNode)
    );
    expect(referenced).toBe(true);
  });

  it("notranslate 区域内的站点更新 → 不进入管道", () => {
    const div = document.createElement("div");
    div.className = "notranslate";
    const textNode = document.createTextNode("preview");
    div.appendChild(textNode);
    document.body.appendChild(div);

    const oldValue = textNode.data;
    textNode.data = "preview expanded";
    handleObserverMutations([charDataRecord(textNode, oldValue)]);

    updatePiecesToTranslateWithNewNodes();

    const pieces = getPiecesToTranslateArray();
    const referenced = pieces.some((ptt) =>
      ptt.nodes && ptt.nodes.some((n) => n === textNode)
    );
    expect(referenced).toBe(false);
  });
});
