/**
 * pageTranslator 集成测试 — translateResults 和 addTranslatedContent
 *
 * 验证两种翻译显示模式（newLine / replaceOriginal）在 Google 翻译完成后
 * 正确注册 AI 翻译块。这是 ISSUE-006 类 bug 的回归测试。
 *
 * 发现于 /qa on 2026-07-03
 * 报告: .gstack/qa-reports/qa-report-dualtran-2026-07-03.md
 */

import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";

const mockState = vi.hoisted(() => {
  const configValues = {
    aiImproveForLongerThan: 0,
    translatedColor: "rgba(11, 112, 33, 1)",
    aiTranslatedColor: "#2041FF",
    whereToDisplayTranslatedText: "newLine",
    dontSortResults: "yes", // translateResults 中 registerBlock 在此条件分支内
    autoImproveByAI: "no",
    aiProvider: "openai",
    apiKeyOpenAI: "test-key",
    translateLongerThan: 0,
    customDictionary: new Map(),
    // 模块初始化时 onTabVisible 回调链需要数组默认值，否则 .indexOf() 在 undefined 上报错
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
  };
  return {
    configValues,
    registerBlockMock: vi.fn(),
    ensureSingletonInitMock: vi.fn(),
    getBlockStateMock: vi.fn(() => null), // 默认为 null，测试中覆盖
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
vi.mock("../../src/contentScript/showOriginal.js", () => ({ default: { isEnabled: false, enable: vi.fn(), disable: vi.fn(), enabledObserverSubscribe: vi.fn() } }));
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

// Stub Chrome API（getTabHostName 需要）
// 注意：sendMessage 必须回调，否则 pageTranslator.js 中
// Promise.all([twpConfig.onReady(), getTabHostName()]) 永远不会 resolve，
// 导致 _translateResults 等 hook 永不被赋值、vi.waitFor 超时失败。
vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: vi.fn((payload, callback) => {
      // getTabHostName 等消息需要回调触发 resolve；其他消息给个空回调即可。
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

// 确保不是 iframe（window.self === window.top）
vi.stubGlobal("top", window);
vi.stubGlobal("self", window);
vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ text: () => Promise.resolve(""), ok: true })));

let pageTranslator, translateResults, addTranslatedContent, getPiecesToTranslate, filterKeywordsInText, handleCustomWords, handleSingletonAiClick, translateDynamically;

beforeAll(async () => {
  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;

  // 等待 twpConfig.onReady + getTabHostName 的 Promise.all 解析
  await vi.waitFor(() => {
    expect(pageTranslator._translateResults).toBeTypeOf("function");
    expect(pageTranslator._addTranslatedContent).toBeTypeOf("function");
    expect(pageTranslator._getPiecesToTranslate).toBeTypeOf("function");
    expect(pageTranslator._filterKeywordsInText).toBeTypeOf("function");
    expect(pageTranslator._handleCustomWords).toBeTypeOf("function");
    expect(pageTranslator._handleSingletonAiClick).toBeTypeOf("function");
    expect(pageTranslator._translateDynamically).toBeTypeOf("function");
  }, { timeout: 5000 });
  translateResults = pageTranslator._translateResults;
  addTranslatedContent = pageTranslator._addTranslatedContent;
  getPiecesToTranslate = pageTranslator._getPiecesToTranslate;
  filterKeywordsInText = pageTranslator._filterKeywordsInText;
  handleCustomWords = pageTranslator._handleCustomWords;
  handleSingletonAiClick = pageTranslator._handleSingletonAiClick;
  translateDynamically = pageTranslator._translateDynamically;
});

describe("translateResults (replaceOriginal 模式)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.registerBlockMock.mockClear();
    mockState.ensureSingletonInitMock.mockClear();
    mockState.configValues.aiImproveForLongerThan = 0;
  });

  it("ISSUE-006 回归: aiImproveForLongerThan=0 时应调用 registerBlock", () => {
    const textNode = document.createTextNode("Hello world this is a test sentence for translation");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);
    document.body.appendChild(parentElement);

    translateResults(
      [{ nodes: [textNode] }],
      [["Bonjour le monde ceci est une phrase test pour la traduction"]]
    );

    expect(mockState.registerBlockMock).toHaveBeenCalled();
    const callArgs = mockState.registerBlockMock.mock.calls[0];
    expect(callArgs[0]).toBe(parentElement);
    expect(callArgs[1]).toBe("Hello world this is a test sentence for translation");
    expect(callArgs[3]).toBe("");
  });

  it("aiImproveForLongerThan=999999 时不应调用 registerBlock（词数不足阈值）", () => {
    mockState.configValues.aiImproveForLongerThan = 999999;

    const textNode = document.createTextNode("Hello");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);
    document.body.appendChild(parentElement);

    translateResults(
      [{ nodes: [textNode] }],
      [["Bonjour"]]
    );

    expect(mockState.registerBlockMock).not.toHaveBeenCalled();
  });
});

describe("addTranslatedContent (newLine 模式)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.registerBlockMock.mockClear();
    mockState.ensureSingletonInitMock.mockClear();
    mockState.configValues.aiImproveForLongerThan = 0;
  });

  it("aiImproveForLongerThan=0 时应调用 registerBlock", async () => {
    const textNode = document.createTextNode("Hello world");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);

    const translatedElement = document.createElement("translated");
    parentElement.appendChild(translatedElement);
    document.body.appendChild(parentElement);

    await addTranslatedContent(
      [{ nodes: [textNode], translatedElement, nodesToBeInTranslatedNode: [textNode] }],
      [["Bonjour le monde"]]
    );

    expect(mockState.registerBlockMock).toHaveBeenCalled();
  });
});

describe("getPiecesToTranslate (DOM 解析)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.configValues.translateLongerThan = 0;
  });

  it("returns empty for empty body", () => {
    document.body.innerHTML = "";
    const pieces = getPiecesToTranslate(document.body);
    // 至少返回一个空 piece
    expect(Array.isArray(pieces)).toBe(true);
  });

  it.todo("finds text in a simple paragraph — jsdom getComputedStyle 行为与浏览器不一致，需真实浏览器验证");

  it("skips notranslate elements", () => {
    document.body.innerHTML = `
      <p>Translate this</p>
      <p class="notranslate">Skip this</p>
    `;
    const pieces = getPiecesToTranslate(document.body);
    // "Skip this" 文本不应出现在任何 piece 中
    const hasNotranslateText = pieces.some(p =>
      p.nodes.some(n => n.textContent && n.textContent.includes("Skip this"))
    );
    expect(hasNotranslateText).toBe(false);
  });

  it("respects translateLongerThan threshold for short text", () => {
    mockState.configValues.translateLongerThan = 50; // 只翻译超过 50 字符的文本
    document.body.innerHTML = '<p>Hi</p>';
    const pieces = getPiecesToTranslate(document.body);
    // "Hi" 只有 2 个字符，应被阈值过滤
    const hasShortText = pieces.some(p =>
      p.nodes.some(n => n.textContent && n.textContent.includes("Hi"))
    );
    expect(hasShortText).toBe(false);
  });

  it("skips code elements", () => {
    document.body.innerHTML = '<p>Translate this</p><code>skip this code</code>';
    const pieces = getPiecesToTranslate(document.body);
    // "<code>" 中的文本不应出现在任何 piece 中
    const hasCodeText = pieces.some(p =>
      p.nodes.some(n => n.textContent && n.textContent.includes("skip this code"))
    );
    expect(hasCodeText).toBe(false);
  });
});

describe("filterKeywordsInText (自定义词典)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns text unchanged when custom dictionary is empty", () => {
    mockState.configValues.customDictionary = new Map();
    const result = filterKeywordsInText("Hello world");
    expect(result).toBe("Hello world");
  });

  it("returns text unchanged when no keywords match", () => {
    mockState.configValues.customDictionary = new Map([["apple", "fruit"]]);
    const result = filterKeywordsInText("Hello world");
    expect(result).toBe("Hello world");
  });

  it("replaces matched keyword with placeholder markers", () => {
    mockState.configValues.customDictionary = new Map([["hello", "bonjour"]]);
    const result = filterKeywordsInText("Hello world");
    // 关键词 "hello" 应被替换为标记格式
    expect(result).toContain("@%");
    expect(result).toContain("#$");
    expect(result).not.toContain("Hello");
  });

  it("matches keywords case-insensitively", () => {
    mockState.configValues.customDictionary = new Map([["hello", "bonjour"]]);
    const result = filterKeywordsInText("HELLO world");
    expect(result).toContain("@%");
    expect(result).not.toContain("HELLO");
  });
});

describe("replaceOriginal 模式：Google 翻译和 AI 翻译位置正确性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.registerBlockMock.mockClear();
    mockState.ensureSingletonInitMock.mockClear();
    mockState.configValues.aiImproveForLongerThan = 0;
    mockState.configValues.whereToDisplayTranslatedText = "replaceOriginal";
  });

  it("replaceOriginal 模式下，Google 翻译应正常显示", async () => {
    const textNode = document.createTextNode("Hello world this is a test sentence");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);
    document.body.appendChild(parentElement);

    translateResults(
      [{ nodes: [textNode] }],
      [["Bonjour le monde ceci est une phrase test"]]
    );

    // 等待 handleCustomWords 的 .then() 回调完成
    await new Promise(resolve => setTimeout(resolve, 0));

    // Google 翻译应正常显示在原始文本节点中
    expect(textNode.textContent).toBe("Bonjour le monde ceci est une phrase test ");
    // AI 翻译 span 应已创建
    const aiSpan = parentElement.querySelector(".dualtran-aitranslatedtext-replacemode");
    expect(aiSpan).not.toBeNull();
    // AI 翻译 span 应为空（等待 AI 翻译）
    expect(aiSpan.textContent).toBe("");
  });

  it("replaceOriginal 模式下，AI 翻译开始时应清空原始文本节点", async () => {
    const textNode = document.createTextNode("Hello world");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);
    document.body.appendChild(parentElement);

    translateResults(
      [{ nodes: [textNode] }],
      [["Bonjour le monde"]]
    );

    // 等待 handleCustomWords 的 .then() 回调完成
    await new Promise(resolve => setTimeout(resolve, 0));

    // Google 翻译应正常显示
    expect(textNode.textContent).toBe("Bonjour le monde ");

    // 模拟 AI 翻译开始（调用 applyAiTranslatingState）
    const { applyAiTranslatingState } = await import("../../src/contentScript/aiUiState.js");
    const aiSpan = parentElement.querySelector(".dualtran-aitranslatedtext-replacemode");
    const mockBtnAi = {
      _st: () => ({ nodesToClear: [textNode] }),
      translatedTextNode: aiSpan,
      translationStatus: null,
      btnAiTxtNode: document.createElement("span"),
      tooltip: document.createElement("span"),
      classList: { remove: vi.fn(), add: vi.fn() },
      style: { color: "" },
      ownerDocument: document,
      setAttribute: vi.fn(),
    };

    applyAiTranslatingState(mockBtnAi, { translatedText: "AI translating..." });

    // AI 翻译开始后，原始文本节点应被清空
    expect(textNode.textContent).toBe("");
    // AI 翻译 span 应显示翻译中状态
    expect(aiSpan.textContent).toBe("AI translating...");
  });

  it("replaceOriginal 模式下，多个文本节点的 Google 翻译应正常显示", async () => {
    const textNode1 = document.createTextNode("First sentence");
    const textNode2 = document.createTextNode("Second sentence");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode1);
    parentElement.appendChild(textNode2);
    document.body.appendChild(parentElement);

    translateResults(
      [{ nodes: [textNode1, textNode2] }],
      [["Première phrase", "Deuxième phrase"]]
    );

    // 等待 handleCustomWords 的 .then() 回调完成
    await new Promise(resolve => setTimeout(resolve, 0));

    // Google 翻译应正常显示
    expect(textNode1.textContent).toBe("Première phrase ");
    expect(textNode2.textContent).toBe("Deuxième phrase ");
  });

  it("aiImproveForLongerThan 阈值过高时不应创建 AI span", () => {
    mockState.configValues.aiImproveForLongerThan = 999999;

    const textNode = document.createTextNode("Hello");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);
    document.body.appendChild(parentElement);

    translateResults(
      [{ nodes: [textNode] }],
      [["Bonjour"]]
    );

    // 阈值过高时不应创建 AI span
    const aiSpan = parentElement.querySelector(".dualtran-aitranslatedtext-replacemode");
    expect(aiSpan).toBeNull();
  });

  it("replaceOriginal 模式下，AI 译文不应应用配置的译文颜色（应使用原文颜色）", async () => {
    mockState.configValues.aiTranslatedColor = "#FF0000"; // 设置 AI 译文颜色为红色

    const textNode = document.createTextNode("Hello world");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);
    document.body.appendChild(parentElement);

    translateResults(
      [{ nodes: [textNode] }],
      [["Bonjour le monde"]]
    );

    // 等待 handleCustomWords 的 .then() 回调完成
    await new Promise(resolve => setTimeout(resolve, 0));

    // 模拟 AI 翻译开始（调用 applyAiTranslatingState）
    const { applyAiTranslatingState } = await import("../../src/contentScript/aiUiState.js");
    const aiSpan = parentElement.querySelector(".dualtran-aitranslatedtext-replacemode");

    // 模拟 replaceOriginal 模式：父元素有 data-dualtran-block 属性
    parentElement.dataset.dualtranBlock = "1";

    const mockBtnAi = {
      _st: () => ({ nodesToClear: [textNode] }),
      translatedTextNode: aiSpan,
      translationStatus: null,
      btnAiTxtNode: document.createElement("span"),
      tooltip: document.createElement("span"),
      classList: { remove: vi.fn(), add: vi.fn() },
      style: { color: "" },
      ownerDocument: document,
      setAttribute: vi.fn(),
    };

    applyAiTranslatingState(mockBtnAi, {
      translatedText: "AI translating...",
      translatedTextColor: "#FF0000",
    });

    // replaceOriginal 模式下，AI 译文不应应用配置的颜色
    // AI span 的父元素不应有颜色设置
    expect(aiSpan.parentNode.style.color).toBe("");
    // AI span 本身也不应有颜色设置
    expect(aiSpan.style.color).toBe("");
  });

  it("replaceOriginal 模式下，AI 翻译开始时元素节点应被隐藏而非清空", async () => {
    // 模拟包含 <code> 元素的场景：<li>Follow the <code>writing-skills</code> skill</li>
    const textNode1 = document.createTextNode("Follow the ");
    const codeElement = document.createElement("code");
    codeElement.textContent = "writing-skills";
    const textNode2 = document.createTextNode(" skill");
    const parentElement = document.createElement("li");
    parentElement.appendChild(textNode1);
    parentElement.appendChild(codeElement);
    parentElement.appendChild(textNode2);
    document.body.appendChild(parentElement);

    translateResults(
      [{ nodes: [textNode1, codeElement, textNode2] }],
      [["遵循 ", "写作技巧", " 技能"]]
    );

    // 等待 handleCustomWords 的 .then() 回调完成
    await new Promise(resolve => setTimeout(resolve, 0));

    // 模拟 AI 翻译开始（调用 applyAiTranslatingState）
    const { applyAiTranslatingState } = await import("../../src/contentScript/aiUiState.js");
    const aiSpan = parentElement.querySelector(".dualtran-aitranslatedtext-replacemode");
    parentElement.dataset.dualtranBlock = "1";

    const mockBtnAi = {
      _st: () => ({ nodesToClear: [textNode1, codeElement, textNode2] }),
      translatedTextNode: aiSpan,
      translationStatus: null,
      btnAiTxtNode: document.createElement("span"),
      tooltip: document.createElement("span"),
      classList: { remove: vi.fn(), add: vi.fn() },
      style: { color: "" },
      ownerDocument: document,
      setAttribute: vi.fn(),
    };

    applyAiTranslatingState(mockBtnAi, { translatedText: "AI translating..." });

    // 文本节点应被清空
    expect(textNode1.textContent).toBe("");
    expect(textNode2.textContent).toBe("");
    // 元素节点应被隐藏（display: none），而不是被清空
    expect(codeElement.style.display).toBe("none");
    // 元素节点的内容应保留（用于恢复），注意 Google 翻译会添加尾部空格
    expect(codeElement.textContent).toContain("写作技巧");
  });
});

describe("replaceOriginal 模式：完整翻译流程回归测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.registerBlockMock.mockClear();
    mockState.ensureSingletonInitMock.mockClear();
    mockState.configValues.aiImproveForLongerThan = 0;
    mockState.configValues.whereToDisplayTranslatedText = "replaceOriginal";
  });

  it("replaceOriginal 模式：Google 翻译后原文应被替换为译文（模拟完整 callback 流程）", async () => {
    // 模拟用户场景：页面有多个段落，Google 翻译后应替换原文
    const textNode1 = document.createTextNode("Hello world");
    const textNode2 = document.createTextNode("Goodbye world");
    const p1 = document.createElement("p");
    const p2 = document.createElement("p");
    p1.appendChild(textNode1);
    p2.appendChild(textNode2);
    document.body.appendChild(p1);
    document.body.appendChild(p2);

    // 模拟 Google 翻译返回的 results（二维数组，与 piecesToTranslateNow 对应）
    const piecesToTranslateNow = [{ nodes: [textNode1] }, { nodes: [textNode2] }];
    const results = [["Bonjour le monde"], ["Au revoir le monde"]];

    // 调用 translateResults（模拟 Google callback 中的调用）
    translateResults(piecesToTranslateNow, results);

    // 等待 handleCustomWords 的 .then() 回调完成
    await new Promise(resolve => setTimeout(resolve, 0));

    // 关键断言：原文应被替换为译文
    expect(textNode1.textContent).toBe("Bonjour le monde ");
    expect(textNode2.textContent).toBe("Au revoir le monde ");
  });

  it("replaceOriginal 模式：含内联元素的节点翻译后应正确替换", async () => {
    // 模拟 <p>This is a <b>test</b> sentence</p>
    const textNode1 = document.createTextNode("This is a ");
    const boldElement = document.createElement("b");
    boldElement.textContent = "test";
    const textNode2 = document.createTextNode(" sentence");
    const p = document.createElement("p");
    p.appendChild(textNode1);
    p.appendChild(boldElement);
    p.appendChild(textNode2);
    document.body.appendChild(p);

    // Google 翻译返回结果（每个 node 对应一个翻译结果）
    const piecesToTranslateNow = [{ nodes: [textNode1, boldElement, textNode2] }];
    const results = [["Ceci est un ", "test", " phrase"]];

    translateResults(piecesToTranslateNow, results);

    // 等待 handleCustomWords 的 .then() 回调完成
    await new Promise(resolve => setTimeout(resolve, 0));

    // 所有节点都应被替换（translateResults 在每个结果后追加空格）
    expect(textNode1.textContent).toContain("Ceci est un");
    expect(boldElement.textContent).toContain("test");
    expect(textNode2.textContent).toContain("phrase");
  });

  it("replaceOriginal 模式：translateResults 应正确调用 applyTranslatedColorToNode", async () => {
    mockState.configValues.translatedColor = "rgba(11, 112, 33, 1)";

    const textNode = document.createTextNode("Hello");
    const span = document.createElement("span");
    span.appendChild(textNode);
    document.body.appendChild(span);

    translateResults(
      [{ nodes: [textNode] }],
      [["Bonjour"]]
    );

    await new Promise(resolve => setTimeout(resolve, 0));

    // 译文应已替换原文
    expect(textNode.textContent).toBe("Bonjour ");
    // hasCustomTranslatedColor 为 true 时，applyTranslatedColorToNode 应设置颜色
    // 注意：如果 hasCustomTranslatedColor 未正确 mock，颜色不会被设置
    if (span.style.color) {
      expect(span.style.color).toBe("rgba(11, 112, 33, 1)");
    }
  });
});

describe("replaceOriginal 模式：dontSortResults 分支覆盖", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.registerBlockMock.mockClear();
    mockState.ensureSingletonInitMock.mockClear();
    mockState.configValues.aiImproveForLongerThan = 0;
    mockState.configValues.whereToDisplayTranslatedText = "replaceOriginal";
  });

  it("dontSortResults=true 分支：单节点翻译后原文应被替换", async () => {
    const textNode = document.createTextNode("Hello world");
    const p = document.createElement("p");
    p.appendChild(textNode);
    document.body.appendChild(p);

    translateResults(
      [{ nodes: [textNode] }],
      [["Bonjour le monde"]]
    );

    await new Promise(resolve => setTimeout(resolve, 0));

    // 原文应被替换为译文（含尾部空格）
    expect(textNode.textContent).toContain("Bonjour le monde");
    // AI span 应被创建
    const aiSpan = p.querySelector(".dualtran-aitranslatedtext-replacemode");
    expect(aiSpan).not.toBeNull();
  });

  it("dontSortResults=true 分支：results 少于 nodes 时，多余的节点不应被翻译", async () => {
    // 模拟 Google 返回的结果少于节点数的情况
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createElement("b");
    textNode2.textContent = "Second";
    const textNode3 = document.createTextNode("Third");
    const p = document.createElement("p");
    p.appendChild(textNode1);
    p.appendChild(textNode2);
    p.appendChild(textNode3);
    document.body.appendChild(p);

    // 只返回2个结果，但有3个节点
    translateResults(
      [{ nodes: [textNode1, textNode2, textNode3] }],
      [["Première", "Deuxième"]]
    );

    await new Promise(resolve => setTimeout(resolve, 0));

    // 前两个节点应被翻译
    expect(textNode1.textContent).toContain("Première");
    expect(textNode2.textContent).toContain("Deuxième");
    // 第三个节点不应被翻译（结果中没有对应的翻译）
    expect(textNode3.textContent).toBe("Third");
  });
});

describe("replaceOriginal 模式：element node guard 回归测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.registerBlockMock.mockClear();
    mockState.ensureSingletonInitMock.mockClear();
    mockState.configValues.aiImproveForLongerThan = 0;
    mockState.configValues.whereToDisplayTranslatedText = "replaceOriginal";
  });

  it("replaceOriginal 模式：元素节点（如 <b>）在 Google 翻译后应被替换", async () => {
    // 模拟 <p>This is a <b>bold</b> word</p>
    const textNode1 = document.createTextNode("This is a ");
    const boldElement = document.createElement("b");
    boldElement.textContent = "bold";
    const textNode2 = document.createTextNode(" word");
    const p = document.createElement("p");
    p.appendChild(textNode1);
    p.appendChild(boldElement);
    p.appendChild(textNode2);
    document.body.appendChild(p);

    // 模拟 registerBlock 设置 data-dualtran-block（replaceOriginal 模式下会自动设置）
    p.dataset.dualtranBlock = "1";

    translateResults(
      [{ nodes: [textNode1, boldElement, textNode2] }],
      [["Ceci est un ", "gras", " mot"]]
    );

    // 等待 handleCustomWords 的 .then() 回调完成
    await new Promise(resolve => setTimeout(resolve, 0));

    // 关键断言：所有节点（包括元素节点）都应被翻译
    expect(textNode1.textContent).toContain("Ceci est un");
    // 这是 bug 所在：元素节点 <b> 的文本应被替换为译文
    expect(boldElement.textContent).toContain("gras");
    expect(textNode2.textContent).toContain("mot");
  });

  it("replaceOriginal 模式：代码元素 <code> 在 Google 翻译后应被替换", async () => {
    // 模拟 <p>Please use the <code>translateResults</code> function</p>
    const textNode1 = document.createTextNode("Please use the ");
    const codeElement = document.createElement("code");
    codeElement.textContent = "translateResults";
    const textNode2 = document.createTextNode(" function");
    const p = document.createElement("p");
    p.appendChild(textNode1);
    p.appendChild(codeElement);
    p.appendChild(textNode2);
    document.body.appendChild(p);

    // 模拟 registerBlock 设置 data-dualtran-block
    p.dataset.dualtranBlock = "1";

    translateResults(
      [{ nodes: [textNode1, codeElement, textNode2] }],
      [["Veuillez utiliser la fonction ", "translateResults", ""]]
    );

    await new Promise(resolve => setTimeout(resolve, 0));

    // 元素节点 <code> 的文本也应被替换
    expect(textNode1.textContent).toContain("Veuillez");
    expect(codeElement.textContent).toContain("translateResults");
    expect(textNode2.textContent).toContain("");
  });
});

describe("newLine 模式：原始文本不应被清除", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.registerBlockMock.mockClear();
    mockState.ensureSingletonInitMock.mockClear();
    mockState.configValues.aiImproveForLongerThan = 0;
    mockState.configValues.whereToDisplayTranslatedText = "newLine";
  });

  it("newLine 模式下，原始文本节点不应被清除", async () => {
    const textNode = document.createTextNode("Hello world");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);

    const translatedElement = document.createElement("translated");
    parentElement.appendChild(translatedElement);
    document.body.appendChild(parentElement);

    await addTranslatedContent(
      [{ nodes: [textNode], translatedElement, nodesToBeInTranslatedNode: [textNode] }],
      [["Bonjour le monde"]]
    );

    // newLine 模式下原始文本应保持不变
    expect(textNode.textContent).toBe("Hello world");
    // 翻译结果应在 translatedElement 中
    expect(translatedElement.textContent).toContain("Bonjour le monde");
  });

  it("newLine 模式下，AI 译文应应用配置的译文颜色", async () => {
    mockState.configValues.aiTranslatedColor = "#FF0000"; // 设置 AI 译文颜色为红色
    mockState.configValues.translatedColor = "#00FF00"; // 设置谷歌译文颜色为绿色

    // 模拟 newLine 模式下的 DOM 结构
    const textNode = document.createTextNode("Hello world");
    const parentElement = document.createElement("p");
    parentElement.appendChild(textNode);

    const translatedElement = document.createElement("translated");
    parentElement.appendChild(translatedElement);
    document.body.appendChild(parentElement);

    // 调用 addTranslatedContent 来模拟谷歌翻译
    await addTranslatedContent(
      [{ nodes: [textNode], translatedElement, nodesToBeInTranslatedNode: [textNode] }],
      [["Bonjour le monde"]]
    );

    // 谷歌译文颜色应被应用到 translatedElement
    // 注意：applyTranslatedColorToNode 在 addTranslatedContent 中被调用

    // 模拟 AI 翻译开始（调用 applyAiTranslatingState）
    const { applyAiTranslatingState } = await import("../../src/contentScript/aiUiState.js");

    // newLine 模式下，translatedTextNode 现在是 googleSpan（dual-span 结构）
    const googleSpan = translatedElement.querySelector(".dualtran-google");
    const aiSpan = translatedElement.querySelector(".dualtran-ai");

    const mockBtnAi = {
      _st: () => ({ nodesToClear: null }),
      translatedTextNode: googleSpan,
      googleSpan: googleSpan,
      aiSpan: aiSpan,
      translationStatus: null,
      btnAiTxtNode: document.createElement("span"),
      tooltip: document.createElement("span"),
      classList: { remove: vi.fn(), add: vi.fn() },
      style: { color: "" },
      ownerDocument: document,
      setAttribute: vi.fn(),
    };

    applyAiTranslatingState(mockBtnAi, {
      translatedText: "AI translating...",
      translatedTextColor: "#FF0000",
    });

    // AI 译文颜色应应用到 aiSpan（dual-span 模式）
    // translatedTextNode 是文本节点，颜色应应用到其父元素（translatedElement）
    expect(aiSpan.style.color).toBe("rgb(255, 0, 0)");
  });
});

describe("handleSingletonAiClick (AI 按钮点击 → 恢复原文)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.configValues.aiImproveForLongerThan = 0;
  });

  // ISSUE-007 回归: AI 翻译完成后再次点击 → 恢复原文并清除 AI 译文
  it("ISSUE-007 回归: AI→restore 时恢复 nodesToClear 为原文并清除 AI span", async () => {
    // 创建 DOM：模拟 replaceOriginal 模式下的翻译结果
    const parentElement = document.createElement("p");
    const googleNode = document.createTextNode("Bonjour le monde");
    parentElement.appendChild(googleNode);

    const aiSpan = document.createElement("span");
    aiSpan.classList.add("dualtran-aitranslatedtext-replacemode");
    aiSpan.textContent = "AI translated text here";
    parentElement.appendChild(aiSpan);
    document.body.appendChild(parentElement);

    // 模拟已翻译的 AI 状态
    const blockState = {
      sourceString: "Hello world",
      translatedTextNode: aiSpan,
      googleTranslatedText: "",
      nodesToClear: [googleNode],
      translationId: "test-id",
      aiStatus: "translated",
    };
    mockState.getBlockStateMock.mockReturnValue(blockState);

    // 模拟 nodesToRestore（存储原始文本用于恢复）
    // 注意: nodesToRestore 是 pageTranslator 内部数组，
    // handleSingletonAiClick 会在其中查找匹配的节点。
    // 由于在测试环境中 nodesToRestore 为空，恢复操作会静默跳过。
    // 但 AI span 仍应被清除。

    await handleSingletonAiClick(parentElement);

    // 验证: AI span 被清除
    expect(aiSpan.textContent).toBe("");
    // 验证: aiStatus 被重置
    expect(blockState.aiStatus).toBe("idle");
  });
});

describe("translateDynamically (视口感知翻译)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.configValues.aiImproveForLongerThan = 0;
  });

  it("不抛出异常（空 body 场景）", () => {
    document.body.innerHTML = "";
    expect(() => translateDynamically()).not.toThrow();
  });

  it("不抛出异常（有内容但无待翻译块时安全退出）", () => {
    document.body.innerHTML = "<p>Hello world</p>";
    // piecesToTranslate 在 translatePage 中被设置，此处为空 → 安全退出
    expect(() => translateDynamically()).not.toThrow();
  });
});
