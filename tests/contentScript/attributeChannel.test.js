/**
 * Attribute 内容更新通道测试 — #98 复发复盘的前瞻缺口（channel: attribute-rewrite / attribute-add）
 *
 * 背景：x.com「Show more」家族（#7 / #98）的共同用户可见形态是
 * 「翻译后出现的内容不翻译」。文本节点有四个已覆盖通道；**属性**是同一家族的
 * 第五类载体——站点在翻译后改写既有元素的可翻译属性（placeholder / alt /
 * title / value），或在翻译后注入带可翻译属性的新元素。
 *
 * 修复前现状（本次侦察确认）：observer 无 `attributes` 观察；`getAttributesToTranslate`
 * 只在 translatePage 初始扫描调用一次 → 两者的更新永远不会被翻译。
 *
 * 本文件锁定（先 RED 后 GREEN）：
 *   1. observer 选项声明了 attributes + attributeFilter（结构性前提）
 *   2. 站点改写既有元素属性 → 进入 hostUpdatedAttributes
 *   3. 扩展自写（markAttributeWrite）→ 不拾取（反馈环防护）
 *   4. 自写之后站点再写不同值 → 仍被拾取（值比对语义）
 *   5. 相同值重写（oldValue === 当前值）→ 不拾取
 *   6. notranslate / contentEditable 区域 → 不拾取
 *   7. 消费端：已跟踪的 (element, attr) 被站点改写 → isTranslated 复位重译
 *   8. 消费端：未跟踪的属性更新 → 进入 attributesToTranslate（原值 = 站点当前值）
 *   9. 新元素（attribute-add）：newNodes 消费时补采其可翻译属性
 *  10. translateAttributes 自写后 → observer 视为自写不重译（反馈环闭环）
 *  11. freshness guard：请求在飞期间站点再写 → 本条结果丢弃并复位（有界收敛）
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
// mock-fidelity-allow: attribute-channel suite — arrival parsing is not its subject (pinned by hoverBtn* + crossLevelInteraction matrix)
vi.mock("../../src/contentScript/fetchSSE.js", () => ({ translateWithAI: vi.fn() }));
// mock-fidelity-allow: same as fetchSSE — observer/attribute classification is this file's subject
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
let getHostUpdatedAttributes;
let updatePiecesToTranslateWithNewNodes;
let getAttributesToTranslateArray;
let getAttributesToTranslate;
let translateAttributes;
let markAttributeWrite;
let isExtensionWrittenAttribute;

beforeAll(async () => {
  const mod = await import("../../src/contentScript/pageTranslator.js");
  const writesMod = await import("../../src/contentScript/extensionAttributeWrites.js");
  pageTranslator = mod.pageTranslator;
  await vi.waitFor(() => {
    expect(pageTranslator._handleObserverMutations).toBeTypeOf("function");
    expect(pageTranslator._updatePiecesToTranslateWithNewNodes).toBeTypeOf("function");
    expect(pageTranslator._getHostUpdatedAttributes).toBeTypeOf("function");
  }, { timeout: 5000 });
  handleObserverMutations = pageTranslator._handleObserverMutations;
  getHostUpdatedAttributes = pageTranslator._getHostUpdatedAttributes;
  updatePiecesToTranslateWithNewNodes = pageTranslator._updatePiecesToTranslateWithNewNodes;
  getAttributesToTranslateArray = pageTranslator._getAttributesToTranslateArray;
  getAttributesToTranslate = pageTranslator._getAttributesToTranslate;
  translateAttributes = pageTranslator._translateAttributes;
  markAttributeWrite = writesMod.markAttributeWrite;
  isExtensionWrittenAttribute = writesMod.isExtensionWrittenAttribute;
});

/** Build a synthetic attribute MutationRecord. */
function attrRecord(el, attributeName, oldValue) {
  return {
    type: "attributes",
    target: el,
    attributeName,
    oldValue,
    addedNodes: [],
    removedNodes: [],
  };
}

/** Build a synthetic childList MutationRecord (added nodes). */
function childListRecord(addedNodes) {
  return {
    type: "childList",
    target: document.body,
    addedNodes,
    removedNodes: [],
    oldValue: null,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  // Reset the shared arrays between tests (shared module state).
  getAttributesToTranslateArray().length = 0;
  pageTranslator._getPiecesToTranslateArray().length = 0;
  pageTranslator._getNewNodes().length = 0;
});

describe("attribute 通道：observer 分类（修复前 observer 根本没有 attributes 观察）", () => {
  it("站点改写既有元素属性 → 进入 hostUpdatedAttributes", () => {
    const input = document.createElement("input");
    input.setAttribute("placeholder", "Search topics");
    document.body.appendChild(input);

    const oldValue = input.getAttribute("placeholder");
    input.setAttribute("placeholder", "Search topics and replies");

    handleObserverMutations([attrRecord(input, "placeholder", oldValue)]);

    const map = getHostUpdatedAttributes();
    expect(map.has(input)).toBe(true);
    expect([...map.get(input)]).toContain("placeholder");
  });

  it("扩展自写（markAttributeWrite 登记过）→ 不进入 hostUpdatedAttributes", () => {
    const input = document.createElement("input");
    input.setAttribute("placeholder", "Rechercher");
    markAttributeWrite(input, "placeholder");
    document.body.appendChild(input);

    handleObserverMutations([attrRecord(input, "placeholder", "Search topics")]);

    expect(getHostUpdatedAttributes().has(input)).toBe(false);
  });

  it("自写之后站点再写不同值 → 仍被拾取（值比对语义，非成员资格）", () => {
    const input = document.createElement("input");
    input.setAttribute("placeholder", "Search topics");
    document.body.appendChild(input);

    // 1. Extension write
    input.setAttribute("placeholder", "Rechercher des sujets");
    markAttributeWrite(input, "placeholder");

    // 2. Site overwrites with a different value
    const oldValue = input.getAttribute("placeholder");
    input.setAttribute("placeholder", "Search topics and replies");
    handleObserverMutations([attrRecord(input, "placeholder", oldValue)]);

    expect(getHostUpdatedAttributes().has(input)).toBe(true);
  });

  it("相同值重写（oldValue === 当前值）→ 不拾取（no-op 重渲染不触发重译）", () => {
    const input = document.createElement("input");
    input.setAttribute("placeholder", "stable value");
    document.body.appendChild(input);

    handleObserverMutations([attrRecord(input, "placeholder", "stable value")]);

    expect(getHostUpdatedAttributes().has(input)).toBe(false);
  });

  it("notranslate 区域内的属性更新 → 不拾取", () => {
    const wrap = document.createElement("div");
    wrap.className = "notranslate";
    const input = document.createElement("input");
    input.setAttribute("placeholder", "keep me");
    wrap.appendChild(input);
    document.body.appendChild(wrap);

    const oldValue = "a";
    input.setAttribute("placeholder", "keep me");
    handleObserverMutations([attrRecord(input, "placeholder", oldValue)]);

    expect(getHostUpdatedAttributes().has(input)).toBe(false);
  });

  it("contentEditable 元素内的属性更新 → 不拾取", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const input = document.createElement("input");
    input.setAttribute("title", "rich text tool");
    editor.appendChild(input);
    document.body.appendChild(editor);
    // jsdom does not derive isContentEditable from the attribute, so set it directly
    Object.defineProperty(input, "isContentEditable", { value: true, configurable: true });

    handleObserverMutations([attrRecord(input, "title", "old rich text tool")]);

    expect(getHostUpdatedAttributes().has(input)).toBe(false);
  });

  it("extensionAttributeWrites 注册表：markAttributeWrite 后同值为自写，写不同值后不自写", () => {
    const input = document.createElement("input");
    input.setAttribute("placeholder", "Search");
    markAttributeWrite(input, "placeholder");
    expect(isExtensionWrittenAttribute(input, "placeholder")).toBe(true);

    input.setAttribute("placeholder", "Search everywhere");
    expect(isExtensionWrittenAttribute(input, "placeholder")).toBe(false);
  });
});

describe("attribute 通道：消费端（翻译后站点改写 → 重新入管道）", () => {
  it("已跟踪的 (element, attr) 被站点改写 → isTranslated 复位（重译）且 original 更新为站点当前值", () => {
    const input = document.createElement("input");
    input.setAttribute("placeholder", "Search topics");
    document.body.appendChild(input);

    const tracked = {
      node: input,
      attrName: "placeholder",
      original: "Search topics",
      isTranslated: true,
    };
    getAttributesToTranslateArray().push(tracked);

    const oldValue = input.getAttribute("placeholder");
    input.setAttribute("placeholder", "Search topics and replies");
    handleObserverMutations([attrRecord(input, "placeholder", oldValue)]);

    updatePiecesToTranslateWithNewNodes();

    expect(tracked.isTranslated).toBe(false);
    expect(tracked.original).toBe("Search topics and replies");
    // hostUpdatedAttributes is consumed on the tick
    expect(getHostUpdatedAttributes().size).toBe(0);
  });

  it("未跟踪的属性更新 → 进入 attributesToTranslate，original = 站点当前值", () => {
    const img = document.createElement("img");
    img.setAttribute("alt", "Product photo");
    document.body.appendChild(img);

    // Not in the tracked array (e.g. the element was not present at first scan)
    pageTranslator._getNewNodes().length = 0;

    const oldValue = img.getAttribute("alt");
    img.setAttribute("alt", "Product photo with the new seasonal packaging");
    handleObserverMutations([attrRecord(img, "alt", oldValue)]);

    updatePiecesToTranslateWithNewNodes();

    const tracked = getAttributesToTranslateArray().find(
      (ati) => ati.node === img && ati.attrName === "alt"
    );
    expect(tracked).toBeDefined();
    expect(tracked.original).toBe("Product photo with the new seasonal packaging");
  });

  it("attribute-add：新元素带着可翻译属性到达 → newNodes 消费时补采", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const input = document.createElement("input");
    input.setAttribute("placeholder", "Type to search members");
    container.appendChild(input);

    pageTranslator._getNewNodes().push(input);
    updatePiecesToTranslateWithNewNodes();

    const tracked = getAttributesToTranslateArray().find(
      (ati) => ati.node === input && ati.attrName === "placeholder"
    );
    expect(tracked).toBeDefined();
    expect(tracked.original).toBe("Type to search members");
  });

  it("translateAttributes 写入后 → observer 视为自写，不重新入管道（反馈环闭环）", () => {
    const input = document.createElement("input");
    input.setAttribute("placeholder", "Search topics");
    document.body.appendChild(input);

    const entry = {
      node: input,
      attrName: "placeholder",
      original: "Search topics",
      isTranslated: false,
    };
    const oldValue = input.getAttribute("placeholder");
    translateAttributes([entry], ["Rechercher des sujets"]);

    expect(input.getAttribute("placeholder")).toBe("Rechercher des sujets");
    expect(entry.isTranslated).toBe(true);

    handleObserverMutations([attrRecord(input, "placeholder", oldValue)]);
    expect(getHostUpdatedAttributes().has(input)).toBe(false);
  });

  it("freshness guard：请求在飞期间站点再写 → 本条结果丢弃并复位（有界收敛）", () => {
    const input = document.createElement("input");
    input.setAttribute("placeholder", "Search topics");
    document.body.appendChild(input);

    const entry = {
      node: input,
      attrName: "placeholder",
      original: "Search topics", // value at request time
      isTranslated: false,
    };

    // Site rewrites while the request is in flight
    input.setAttribute("placeholder", "Search topics and replies");

    translateAttributes([entry], ["Résultat périmé"]);

    // Stale result dropped, entry requeued (bounded: after STALE_DROP_LIMIT accepted)
    expect(input.getAttribute("placeholder")).toBe("Search topics and replies");
    expect(entry.isTranslated).toBe(false);
  });
});
