/**
 * Google failure must not disable AI translation (diagnosing-bugs loop).
 *
 * Real-world report: when Google Translate is banned/rate-limited, the Google
 * pass yields empty translations. The page then registers NO AI blocks in
 * newLine mode (registration is gated on the Google word count), so the AI
 * loop finds nothing to translate — the user sees "AI translation also fails"
 * even though the AI provider is healthy.
 *
 * This suite uses the REAL pageTranslator + REAL singletonBtnGroup block
 * registry (only the AI transport is mocked) and drives the exact production
 * seam: addTranslatedContent (Google arrival) → getProxiesForTranslation (AI
 * dispatch).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { applyAiSuccessState } from "../../src/contentScript/aiUiState.js";
import { getAllProxies, getBlockState } from "../../src/contentScript/singletonBtnGroup.js";

const { configValues, translateWithAIMock, sendMessageMock } = vi.hoisted(() => ({
  configValues: {
    aiImproveForLongerThan: 0,
    translatedColor: "#1d4ed8",
    aiTranslatedColor: "#7c3aed",
    whereToDisplayTranslatedText: "newLine",
    dontSortResults: "yes",
    aiProvider: "openai",
    apiKeyOpenAI: "test-key",
    providerConfigs: {},
    enableAiTranslationCache: "no",
    translateLongerThan: 0,
    targetLanguage: "fr",
    targetLanguageTextTranslation: "fr",
    customDictionary: new Map(),
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    alwaysTranslateLangs: [],
    alwaysTranslateLangsAI: [],
  },
  translateWithAIMock: vi.fn(),
  sendMessageMock: vi.fn(),
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
    fixTLanguageCode: (c) => c,
    codeToLanguageNameInEnglish: (c) => c,
    getAlternativeService: (lang, service) => service,
    otherConfigs: {},
  },
}));
vi.mock("../../src/lib/platformInfo.js", () => ({ default: {} }));
vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: {
    get isEnabled() { return false; },
    enable: vi.fn(),
    disable: vi.fn(),
    add: vi.fn(),
    enabledObserverSubscribe: vi.fn(),
  },
}));
// mock-fidelity-allow: AI transport is the dispatch target of this suite; the real block registry + pageTranslator are under test
vi.mock("../../src/contentScript/fetchSSE.js", () => ({
  translateWithAI: (...args) => translateWithAIMock(...args),
}));
// mock-fidelity-allow: this suite observes block registration/dispatch, not stream parsing; arrival parsing is pinned by hoverBtnStreamArrival + the cross-level matrix
vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(() => ({ kind: "done" })),
  parseTaggedPageTranslationProgress: vi.fn(() => null),
  notifyAiStreamParseError: vi.fn(),
}));
vi.mock("toastify-js", () => ({ default: () => ({ showToast: vi.fn() }) }));
vi.mock("gpt-tokenizer", () => ({ encode: (t) => Array.from(t || "") }));
vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({
    getProvider: (id) => ({ id, name: id }),
    listProviders: () => [],
  }),
  BUILT_IN_PROVIDERS: [],
}));

function installDom() {
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://example.com/article",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.top = dom.window;
  globalThis.self = dom.window;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  globalThis.chrome = {
    runtime: {
      id: "test-id",
      getURL: (p) => p,
      sendMessage: sendMessageMock.mockImplementation((payload, callback) => {
        if (typeof callback === "function") {
          callback(payload?.action === "getTabHostName" ? "example.com" : undefined);
        }
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { query: vi.fn(() => Promise.resolve([{ url: "https://example.com" }])) },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    i18n: { getMessage: vi.fn((k) => k) },
  };
}

let pageTranslator;

beforeAll(async () => {
  installDom();
  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;
  await vi.waitFor(() => {
    expect(pageTranslator._addTranslatedContent).toBeTypeOf("function");
    expect(pageTranslator._aiTranslateDynamically).toBeTypeOf("function");
  }, { timeout: 5000 });
});

afterAll(() => {
  try { pageTranslator?.stopAiAutoTranslate?.(); } catch (_) {}
});

beforeEach(() => {
  translateWithAIMock.mockClear();
  sendMessageMock.mockClear();
  document.body.innerHTML = "";
});

function makeParagraph(sourceText) {
  const p = document.createElement("p");
  const textNode = document.createTextNode(sourceText);
  p.appendChild(textNode);
  const translatedElement = document.createElement("translated");
  translatedElement.style.display = "none";
  p.appendChild(translatedElement);
  document.body.appendChild(p);
  return {
    piece: { nodes: [textNode], translatedElement, nodesToBeInTranslatedNode: [textNode] },
    textNode,
    translatedElement,
  };
}

describe("Google empty result must not disable AI translation", () => {
  it("control: a normal Google result keeps the source-registered block and AI dispatches", async () => {
    const { piece } = makeParagraph("Control paragraph with normal google output");
    pageTranslator._registerSourceBlocks([piece]);
    await pageTranslator._addTranslatedContent([piece], [["Paragraphe de controle"]]);

    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();

    expect(translateWithAIMock).toHaveBeenCalled();
    const content = translateWithAIMock.mock.calls[0][0];
    expect(content).toContain("Control paragraph with normal google output");
  });

  it("banned: an empty Google result never removes the block, and AI still dispatches", async () => {
    const { piece, translatedElement } = makeParagraph("Banned paragraph that google refused to translate");
    pageTranslator._registerSourceBlocks([piece]);
    // A banned Google endpoint resolves with empty strings (serviceBase catches
    // the HTTP error and returns "" per block) — not with null/throw.
    await pageTranslator._addTranslatedContent([piece], [[""]]);

    const st = getBlockState(translatedElement);
    expect(st).not.toBeNull();
    expect(st.googleTranslatedText).toBe("");

    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();

    expect(translateWithAIMock).toHaveBeenCalled();
    const content = translateWithAIMock.mock.calls[0][0];
    expect(content).toContain("Banned paragraph that google refused to translate");
  });

  it("AI arrives before Google: the late Google result updates only its channel and never steals the AI display", async () => {
    const { piece, translatedElement } = makeParagraph("AI first paragraph that google was slow to translate");
    pageTranslator._registerSourceBlocks([piece]);

    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();
    expect(translateWithAIMock).toHaveBeenCalled();

    // Real arrival writer on the real registry proxy (no mocked state).
    const proxies = getAllProxies();
    expect(proxies.length).toBe(1);
    applyAiSuccessState(proxies[0], { translatedText: "AI arrives first" });

    await pageTranslator._addTranslatedContent([piece], [["Google arrives later"]]);

    const st = getBlockState(translatedElement);
    expect(st.aiStatus).toBe("translated");
    expect(st.aiSpan.textContent).toBe("AI arrives first");
    expect(st.googleSpan.textContent).toBe("Google arrives later");
    expect(st.displayMode).toBe("ai");
    expect(st.googleBtnState).toBe("success");
  });

  it("mode symmetry: replaceOriginal registers on the SOURCE text, so an empty Google result still dispatches AI", async () => {
    const textNode = document.createTextNode("Replace original paragraph that google refused");
    const p = document.createElement("p");
    p.appendChild(textNode);
    document.body.appendChild(p);

    pageTranslator._translateResults([{ nodes: [textNode] }], [[""]]);

    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();

    expect(translateWithAIMock).toHaveBeenCalled();
    const content = translateWithAIMock.mock.calls[0][0];
    expect(content).toContain("Replace original paragraph that google refused");
  });
});
