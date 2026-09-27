/**
 * 内容更新通道补充回归测试（#98 复发复盘，plan #29）
 *
 * SSOT（tests/shared/content-update-channels.mjs）引用本文件覆盖三个通道：
 *
 *   1. **childlist-replace** — 站点移除截断节点、插入携带全文的新节点
 *      （x.com x-web 客户端实况；也见 #98 探针矩阵 scenario C）。
 *      与 characterdata-rewrite 的区别：节点身份变了，所以「值比对分类」
 *      管不到它——必须由通用 newNodes 路径拾取。
 *
 *   2. **container-textcontent-rewrite** — 站点用 `element.textContent =`
 *      重写整个容器（旧文本节点销毁 + 新文本节点插入）。突变形状与
 *      单 span replace 不同（一次 childList 批次内 remove+add）。
 *
 *   3. **css-only-reveal** — 文本始终在 DOM 中，仅 CSS 显隐（无突变）。
 *      这是**负向对照格**：扫描器不跳隐藏文本，所以初始翻译即已覆盖；
 *      该通道的存在意义是证明「其它通道的通过不是因为套件对什么都变红」。
 *
 * 本文件同时锁定 #98 的第二根因回归锁：容器过滤改判据（.dualtran-result-container
 * 不再整体豁免；改按 isDualTranGeneratedNode 判定）。见 mutationObserver.characterData.test.js
 * 的同主题组。
 */

import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_TRANSLATOR_SRC = join(__dirname, "..", "..", "src", "contentScript", "pageTranslator.js");
const E2E_CONFORMANCE_SRC = join(__dirname, "..", "browser-e2e", "content-update-conformance.mjs");

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
// mock-fidelity-allow: this suite tests the observer/childList pipeline, not arrival parsing
vi.mock("../../src/contentScript/fetchSSE.js", () => ({ translateWithAI: vi.fn() }));
// mock-fidelity-allow: same as fetchSSE — arrival parsing is not this file's subject
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
let getPiecesToTranslate;

beforeAll(async () => {
  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;
  await vi.waitFor(() => {
    expect(pageTranslator._handleObserverMutations).toBeTypeOf("function");
    expect(pageTranslator._updatePiecesToTranslateWithNewNodes).toBeTypeOf("function");
    expect(pageTranslator._getPiecesToTranslateArray).toBeTypeOf("function");
    expect(pageTranslator._getPiecesToTranslate).toBeTypeOf("function");
  }, { timeout: 5000 });
  handleObserverMutations = pageTranslator._handleObserverMutations;
  getHostUpdatedTextNodes = pageTranslator._getHostUpdatedTextNodes;
  updatePiecesToTranslateWithNewNodes = pageTranslator._updatePiecesToTranslateWithNewNodes;
  getPiecesToTranslateArray = pageTranslator._getPiecesToTranslateArray;
  getPiecesToTranslate = pageTranslator._getPiecesToTranslate;
});

/** Build a synthetic childList MutationRecord. */
function childListRecord(target, { addedNodes = [], removedNodes = [] } = {}) {
  return {
    type: "childList",
    target,
    addedNodes,
    removedNodes,
    oldValue: null,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  getPiecesToTranslateArray().length = 0;
});

describe("通道 childlist-replace：站点移除截断节点、插入全文新节点", () => {
  it("新插入的文本节点进入管道（节点身份变化 → 通用 newNodes 路径拾取）", () => {
    const container = document.createElement("div");
    const truncated = document.createElement("span");
    truncated.textContent = "truncated preview";
    container.appendChild(truncated);
    document.body.appendChild(container);

    // Site removes the truncated span, inserts a fresh span carrying the full text
    const fresh = document.createElement("span");
    fresh.textContent = "truncated preview plus the expanded full text of the post";
    container.removeChild(truncated);
    container.appendChild(fresh);

    handleObserverMutations([childListRecord(container, { addedNodes: [fresh], removedNodes: [truncated] })]);
    updatePiecesToTranslateWithNewNodes();

    const pieces = getPiecesToTranslateArray();
    const referenced = pieces.some((ptt) =>
      ptt.nodes && ptt.nodes.some((n) => n === fresh.firstChild)
    );
    expect(referenced).toBe(true);
  });

  it("replace 发生在 .dualtran-result-container 内（replaceOriginal 源容器）→ 新节点仍被拾取", () => {
    // #98 第二根因：旧实现无条件跳过容器后代；replaceOriginal 下该 class 就在
    // 源容器上，于是站点替换被整体吞掉。
    const container = document.createElement("div");
    container.classList.add("dualtran-result-container");
    document.body.appendChild(container);

    const fresh = document.createElement("span");
    fresh.textContent = "expanded after replace inside the source container";
    container.appendChild(fresh);

    handleObserverMutations([childListRecord(container, { addedNodes: [fresh], removedNodes: [] })]);
    updatePiecesToTranslateWithNewNodes();

    const pieces = getPiecesToTranslateArray();
    const referenced = pieces.some((ptt) =>
      ptt.nodes && ptt.nodes.some((n) => n === fresh.firstChild)
    );
    expect(referenced).toBe(true);
  });

  it("负向对照：被移除的节点不进入管道", () => {
    const container = document.createElement("div");
    const removed = document.createElement("span");
    removed.textContent = "this node is being removed";
    container.appendChild(removed);
    document.body.appendChild(container);

    handleObserverMutations([childListRecord(container, { removedNodes: [removed] })]);
    updatePiecesToTranslateWithNewNodes();

    const pieces = getPiecesToTranslateArray();
    const referenced = pieces.some((ptt) =>
      ptt.nodes && ptt.nodes.some((n) => n === removed.firstChild)
    );
    expect(referenced).toBe(false);
  });
});

describe("通道 container-textcontent-rewrite：容器 textContent 整体重写", () => {
  it("旧文本节点被销毁、新文本节点插入 → 新文本进入管道", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "preview";
    document.body.appendChild(paragraph);
    const oldTextNode = paragraph.firstChild;

    // Site rewrites the whole container (destroys old node, inserts new one)
    paragraph.textContent = "preview plus the full expanded body text";
    const newTextNode = paragraph.firstChild;
    expect(newTextNode).not.toBe(oldTextNode);

    handleObserverMutations([
      childListRecord(paragraph, { addedNodes: [newTextNode], removedNodes: [oldTextNode] }),
    ]);
    updatePiecesToTranslateWithNewNodes();

    const pieces = getPiecesToTranslateArray();
    const referenced = pieces.some((ptt) =>
      ptt.nodes && ptt.nodes.some((n) => n === newTextNode)
    );
    expect(referenced).toBe(true);
  });
});

describe("通道 css-only-reveal（负向对照）：纯 CSS 显隐不产生突变", () => {
  // ⚠️ jsdom 限制（与 pageTranslator.integration.test.js 的既有 it.todo 同源）：
  // 扫描器的分块逻辑依赖 getComputedStyle(...).display，jsdom 的层叠/内联样式
  // 求值与真实浏览器不一致 —— 简单段落在 jsdom 下收集不到 piece。因此本通道的
  // **行为断言**（揭示后文本已译 / 无遗漏窗口）属于 E2E 层
  // （content-update-conformance.mjs 的负向对照格）。这里锁定的是 jsdom 可测的
  // 前提，使该通道在 SSOT 中有真实的单元锚点，而不是悬空引用。
  it("前提：扫描器不按 display 过滤文本（隐藏文本与可见文本走同一收集路径）", () => {
    // 负向对照格的成立根据 = 「扫描不跳隐藏文本」。源码里 shouldSkipTranslate 的
    // 判据只有标签名 / notranslate / translate=no / contentEditable 等，没有 display
    // 分支 —— 若未来有人给隐藏文本加 skip 分支，本断言会先红，提示负向对照已失效。
    const src = readFileSync(PAGE_TRANSLATOR_SRC, "utf8");
    const skipBlock = src.slice(
      src.indexOf("let shouldSkipTranslate"),
      src.indexOf("let shouldSkipTranslate") + 800
    );
    expect(skipBlock).not.toMatch(/display\s*===?\s*["']none["']/);
    expect(skipBlock).not.toMatch(/offsetParent|getClientRects/);
  });

  it("前提：通道的 jsdom 行为面由 E2E 负向格承担（SSOT canary/unit 分工记录在案）", () => {
    // 该断言是「已知边界的显式化」：jsdom 无法渲染层叠样式 → 行为断言在 E2E 层。
    // 显式记录防止未来误把本通道当作「有 jsdom 行为覆盖」而撤掉 E2E 格。
    const e2e = readFileSync(E2E_CONFORMANCE_SRC, "utf8");
    expect(e2e).toContain("css-only-reveal");
    expect(e2e).toContain("负向格");
  });
});
