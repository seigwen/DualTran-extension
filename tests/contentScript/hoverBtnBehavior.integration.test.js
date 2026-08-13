/**
 * Hover button group behavior regression tests (integration).
 *
 * Drives the REAL handleSingletonGoogleClick / handleSingletonAiClick
 * (pageTranslator._handleSingletonGoogleClick / _handleSingletonAiClick)
 * against blocks registered with the REAL singletonBtnGroup registerBlock —
 * the same seam the click handlers run at in production.
 *
 * Expected per-block behaviors:
 *  1. G → Google-only translate → G → restore original
 *  2. G → Google-only → AI → add AI on top, hide Google, show AI
 *  3. AI → Google+AI concurrent → AI → restore original
 *  4. AI → Google+AI → G → Google only → AI → show AI again
 *
 * Root cause found while building this loop: the handlers are defined at
 * module top level but reference `nodesToRestore` / `currentTargetLanguage`
 * which are scoped inside the Promise.all(...).then() callback — clicks
 * threw ReferenceError which the surrounding try/catch silently swallowed
 * ("no response"). These tests pin that bug down.
 */

import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { registerBlock, getBlockState } from "../../src/contentScript/singletonBtnGroup.js";

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
vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(() => ({ type: "done" })),
  parseTaggedPageTranslationProgress: vi.fn(() => ({ done: true })),
  notifyAiStreamParseError: vi.fn(),
}));
vi.mock("../../src/contentScript/i18n.js", () => ({}));
vi.mock("toastify-js", () => ({ default: vi.fn(() => ({ showToast: vi.fn() })) }));
vi.mock("gpt-tokenizer", () => ({ encode: vi.fn(() => []) }));
vi.mock("../../src/util/globalWordsCount.js", () => ({ wordsCount: (t) => t.split(/\s+/).filter(Boolean).length }));
vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({ getProvider: () => null }),
  BUILT_IN_PROVIDERS: [],
}));
vi.mock("../../src/lib/ai/providerTypes.js", () => ({}));
vi.mock("../../src/lib/ai/providerModelPreview.js", () => ({}));

// Chrome stub — records translateSingleText calls, responds with a translation
const sendMessageSpy = vi.fn((payload, callback) => {
  if (typeof callback === "function") {
    if (payload?.action === "getTabHostName") {
      callback("example.com");
    } else if (payload?.action === "translateSingleText") {
      callback("Google译文");
    } else {
      callback(undefined);
    }
  }
});
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

let pageTranslator, aiCache, handleG, handleAI;

beforeAll(async () => {
  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;
  aiCache = mod.aiCache;
  await vi.waitFor(() => {
    expect(pageTranslator._handleSingletonGoogleClick).toBeTypeOf("function");
    expect(pageTranslator._handleSingletonAiClick).toBeTypeOf("function");
    expect(pageTranslator._setNodesToRestoreForTest).toBeTypeOf("function");
  }, { timeout: 5000 });
  handleG = pageTranslator._handleSingletonGoogleClick;
  handleAI = pageTranslator._handleSingletonAiClick;
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

beforeEach(() => {
  document.body.innerHTML = "";
  sendMessageSpy.mockClear();
  // Pre-populate in-memory AI cache so AI clicks resolve instantly via cache-hit path
  aiCache.length = 0;
  aiCache.push({ original: "Hello world", targetLanguage: "zh-CN", translated: "AI译文" });
});

describe("Behavior 1 — G → Google-only translate → G → restore original", () => {
  it("newLine: G click restores original, second G re-translates", async () => {
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();

    // Click G: showing Google → restore original
    await handleG(translatedEl);
    expect(translatedEl.style.display).toBe("none");
    const state1 = getBlockState(translatedEl);
    expect(state1.displayMode).toBe("original");
    expect(state1.aiStatus).toBe("idle");

    // Click G again: translate Google-only → show Google
    await handleG(translatedEl);
    expect(translatedEl.style.display).toBe("block");
    expect(googleSpan.textContent).toBe("Google译文");
    expect(googleSpan.style.display).toBe("block");
    expect(aiSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("google");
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "translateSingleText", translationService: "google" }),
      expect.any(Function)
    );
  });

  it("replaceOriginal: G restores original text, second G re-translates into nodes", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    // Click G: showing Google → restore original
    await handleG(p);
    expect(textNode.textContent).toBe("Hello world");
    expect(aiSpan.textContent).toBe("");
    expect(getBlockState(p).displayMode).toBe("original");

    // Click G again: Google-only translate → write into text nodes
    await handleG(p);
    expect(textNode.textContent).toBe("Google译文");
    expect(getBlockState(p).displayMode).toBe("google");
  });
});

describe("Behavior 2 — G → Google-only → AI adds AI on top", () => {
  it("newLine: AI click hides googleSpan, shows aiSpan with AI text", async () => {
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();

    await handleAI(translatedEl);
    expect(aiSpan.textContent).toBe("AI译文");
    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
    expect(getBlockState(translatedEl).aiStatus).toBe("translated");
  });

  it("replaceOriginal: AI clears text nodes and writes AI span", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    await handleAI(p);
    expect(textNode.textContent).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
    expect(getBlockState(p).aiStatus).toBe("translated");
  });
});

describe("Behavior 3 — AI → Google+AI concurrent → AI → restore original", () => {
  it("replaceOriginal: AI on original block runs Google concurrently, then second AI restores", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    // First restore to original
    await handleG(p);
    expect(getBlockState(p).displayMode).toBe("original");
    expect(textNode.textContent).toBe("Hello world");

    // Click AI: Google+AI concurrent → final display AI
    await handleAI(p);
    await flushAsync();
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "translateSingleText" }),
      expect.any(Function)
    );
    expect(textNode.textContent).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
    // Google translation result stored for later G click
    expect(getBlockState(p).googleTranslatedText).toBe("Google译文");

    // Click AI again → restore original
    await handleAI(p);
    expect(textNode.textContent).toBe("Hello world");
    expect(aiSpan.textContent).toBe("");
    expect(getBlockState(p).displayMode).toBe("original");
    expect(getBlockState(p).aiStatus).toBe("idle");
  });
});

describe("Behavior 4 — AI → Google+AI → G → Google only → AI → show AI again", () => {
  it("newLine: full cycle switches displays without re-translating", async () => {
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();

    // AI → AI shown
    await handleAI(translatedEl);
    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");

    // G → Google only
    await handleG(translatedEl);
    expect(googleSpan.style.display).toBe("block");
    expect(aiSpan.style.display).toBe("none");
    const st = getBlockState(translatedEl);
    expect(st.displayMode).toBe("google");

    // AI again → show AI (cache keeps the text)
    await handleAI(translatedEl);
    expect(aiSpan.style.display).toBe("block");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
  });

  it("replaceOriginal: G shows Google text from stored result, AI re-shows AI span", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    // AI (from Google display) → AI shown
    await handleAI(p);
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");

    // G → Google only: nodes get Google text (from nodesToRestore), AI span hidden
    await handleG(p);
    expect(textNode.textContent).toBe("Google译文");
    expect(aiSpan.style.display).toBe("none");
    expect(getBlockState(p).displayMode).toBe("google");

    // AI again → AI span shown again, nodes cleared
    await handleAI(p);
    expect(aiSpan.style.display).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(textNode.textContent).toBe("");
    expect(getBlockState(p).displayMode).toBe("ai");
  });
});
