/**
 * Hover AI click — streaming (network) arrival path (integration).
 *
 * The real user flow after a page-level Google click has no in-memory cache
 * hit: clicking A on a block's hover group issues a fresh AI request whose
 * result arrives through translateWithAI's onMessage stream. This file pins
 * the arrival behavior of that path with the REAL stream parser (the sibling
 * hoverBtnBehavior.integration.test.js mocks aiStreamMessage, so its cells
 * only exercise the non-streaming arrivals).
 *
 * Issue #70: a stale page-level flag (the floating group's Google click latched
 * setAiModeActive(false) earlier) must NOT veto a block-scope direct request.
 * Both modes must switch the block to AI, exactly like the cache-hit path.
 */

import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { registerBlock, getBlockState } from "../../src/contentScript/singletonBtnGroup.js";
import { translateWithAI as translateWithAIMock } from "../../src/contentScript/fetchSSE.js";

const mockState = vi.hoisted(() => {
  const configValues = {
    targetLanguage: "zh-CN",
    aiProvider: "openai",
    apiKeyOpenAI: "test-key",
    enableAiTranslationCache: "no",
    dontSortResults: "yes",
    whereToDisplayTranslatedText: "newLine",
    aiImproveForLongerThan: 0,
    aiTranslatedColor: "#2041FF",
    translatedColor: "rgba(11, 112, 33, 1)",
    customDictionary: new Map(),
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    autoImproveByAI: "no",
    translateLongerThan: 0,
  };
  return { configValues };
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
  default: { isEnabled: false, enable: vi.fn(), disable: vi.fn(), add: vi.fn(), removeAll: vi.fn(), enabledObserverSubscribe: vi.fn() },
}));
vi.mock("../../src/contentScript/fetchSSE.js", () => ({ translateWithAI: vi.fn() }));
// Real parser — the streaming cells need genuine <译泽> block extraction.
vi.mock("../../src/contentScript/aiStreamMessage.js", async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});
vi.mock("../../src/contentScript/i18n.js", () => ({
  getMessageWithFallback: (_k, fallback) => fallback,
  getFloatingButtonOriginalTooltipText: () => "Show original text",
  getFloatingButtonGoogleTooltipText: () => "Show Google translation",
  getFloatingButtonAiTooltipText: () => "Show AI translation",
}));
vi.mock("toastify-js", () => ({ default: vi.fn(() => ({ showToast: vi.fn() })) }));
vi.mock("gpt-tokenizer", () => ({ encode: vi.fn(() => []) }));
vi.mock("../../src/util/globalWordsCount.js", () => ({ wordsCount: (t) => t.split(/\s+/).filter(Boolean).length }));
vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({ getProvider: () => null }),
  BUILT_IN_PROVIDERS: [],
}));
vi.mock("../../src/lib/ai/providerTypes.js", () => ({}));
vi.mock("../../src/lib/ai/providerModelPreview.js", () => ({}));

const defaultSendMessageImpl = (payload, callback) => {
  if (typeof callback === "function") {
    if (payload?.action === "getTabHostName") {
      callback("example.com");
    } else if (payload?.action === "translateSingleText") {
      callback("Google译文");
    } else {
      callback(undefined);
    }
  }
};
const sendMessageSpy = vi.fn(defaultSendMessageImpl);
vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: sendMessageSpy,
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

let pageTranslator, aiCache, handleBtn;

beforeAll(async () => {
  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;
  aiCache = mod.aiCache;
  await vi.waitFor(() => {
    expect(pageTranslator._handleSingletonBtnClick).toBeTypeOf("function");
    expect(pageTranslator._setNodesToRestoreForTest).toBeTypeOf("function");
  }, { timeout: 5000 });
  handleBtn = pageTranslator._handleSingletonBtnClick;
});

/** Real registerBlock in newLine dual-span mode. Initial display: Google. */
function createNewLineBlock({ googleText = "Google译文", aiText = "" } = {}) {
  const p = document.createElement("p");
  p.textContent = "Hello world";
  const translatedEl = document.createElement("translated");
  translatedEl.style.display = "block";
  const googleSpan = document.createElement("span");
  googleSpan.className = "dualtran-google";
  googleSpan.textContent = googleText;
  googleSpan.style.display = "block";
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-ai";
  aiSpan.textContent = aiText;
  aiSpan.style.display = "none";
  translatedEl.appendChild(googleSpan);
  translatedEl.appendChild(aiSpan);
  p.appendChild(translatedEl);
  document.body.appendChild(p);
  registerBlock(translatedEl, "Hello world", googleSpan, googleText, null, { googleSpan, aiSpan });
  return { p, translatedEl, googleSpan, aiSpan };
}

/** Real registerBlock in replaceOriginal mode. Initial display: Google text in nodes. */
function createReplaceOriginalBlock() {
  const p = document.createElement("p");
  const textNode = document.createTextNode("Hello world");
  p.appendChild(textNode);
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-aitranslatedtext-replacemode";
  aiSpan.textContent = "";
  p.appendChild(aiSpan);
  document.body.appendChild(p);
  registerBlock(p, "Hello world", aiSpan, "", [textNode]);
  pageTranslator._setNodesToRestoreForTest([
    { node: textNode, originalText: "Hello world", translatedText: "Google译文" },
  ]);
  return { p, textNode, aiSpan };
}

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

/** Drive a streaming AI response carrying the block's own translationId. */
function streamTranslationFor(contentSequence) {
  const idMatch = contentSequence.match(/<译泽 id="([^"]+)">/);
  if (!idMatch) return null;
  return `<译泽 id="${idMatch[1]}">AI译文</译泽>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
  sendMessageSpy.mockClear();
  sendMessageSpy.mockImplementation(defaultSendMessageImpl);
  aiCache.length = 0; // no in-memory cache → force the real network path
  translateWithAIMock.mockReset();
  translateWithAIMock.mockImplementation((content, onMessage) => {
    const chunk = streamTranslationFor(content);
    if (chunk) onMessage(JSON.stringify({ choices: [{ delta: { content: chunk } }] }));
  });
});

describe("hover AI click — streaming arrival when page-level mode is Google (issue #70)", () => {
  it("newLine: stale page-level flag (set before the request) must not veto the streamed arrival", async () => {
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();
    pageTranslator.setAiModeActive(false); // floating Google click latched this earlier

    await handleBtn("ai", translatedEl);
    await flushAsync();
    await flushAsync();

    expect(aiSpan.textContent).toBe("AI译文");
    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
    expect(getBlockState(translatedEl).aiStatus).toBe("translated");
  });

  it("replaceOriginal: stale page-level flag (set before the request) must not veto the streamed arrival", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();
    textNode.textContent = "Google译文";
    pageTranslator.setAiModeActive(false);

    await handleBtn("ai", p);
    await flushAsync();
    await flushAsync();

    expect(textNode.textContent).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
    expect(getBlockState(p).aiStatus).toBe("translated");
  });

  it("newLine control: page-level AI mode (flag true at request start) switches the display", async () => {
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();
    pageTranslator.setAiModeActive(true);

    await handleBtn("ai", translatedEl);
    await flushAsync();
    await flushAsync();

    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
  });

  it("replaceOriginal control: page-level AI mode (flag true at request start) switches the display", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();
    textNode.textContent = "Google译文";
    pageTranslator.setAiModeActive(true);

    await handleBtn("ai", p);
    await flushAsync();
    await flushAsync();

    expect(textNode.textContent).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
  });
});
