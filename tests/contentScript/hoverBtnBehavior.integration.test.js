/**
 * Hover button group behavior regression tests (integration).
 *
 * Drives the REAL single-entry click executor
 * (pageTranslator._handleSingletonBtnClick) against blocks registered with
 * the REAL singletonBtnGroup registerBlock — the same seam the click
 * handlers run at in production.
 *
 * #65 direct-select semantics (doc 19 / NQ1): click = "show that mode".
 * The Original button owns restore; clicking the already-displayed mode is
 * a noop; a request in flight is a noop (never re-send a running/completed
 * request); G on a restored block re-shows the stored Google text locally
 * (network only when nothing is stored).
 *
 * Expected per-block behaviors:
 *  1. O → restore original → G → local replay of stored Google (no network)
 *  2. G → Google-only → AI → add AI on top, hide Google, show AI
 *  3. AI → Google+AI concurrent → A noop → O → restore original
 *  4. AI → Google+AI → G → Google only → AI → show AI again
 *
 * Root cause found while building this loop: the handlers are defined at
 * module top level but reference `nodesToRestore` / `currentTargetLanguage`
 * which are scoped inside the Promise.all(...).then() callback — clicks
 * threw ReferenceError which the surrounding try/catch silently swallowed
 * ("no response"). These tests pin that bug down.
 */

import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { registerBlock, getBlockState, createSingletonButtonGroup } from "../../src/contentScript/singletonBtnGroup.js";

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
// Real stream parser (#72 mock-fidelity): #70 escaped partly because this
// harness stubbed the parser, making the stream path unobservable. The parser
// is now passed through from the real module; the cache-hit cells below never
// invoke it, and the stream path has its own harness
// (hoverBtnStreamArrival.integration.test.js).
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

// Chrome stub — records translateSingleText calls, responds with a translation.
// `defaultSendMessageImpl` is re-installed before every test; the late-write
// suite temporarily swaps in a "hold the callback" implementation.
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
    expect(pageTranslator.setAiModeActive).toBeTypeOf("function");
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
  sendMessageSpy.mockImplementation(defaultSendMessageImpl);
  // Pre-populate in-memory AI cache so AI clicks resolve instantly via cache-hit path
  aiCache.length = 0;
  aiCache.push({ original: "Hello world", targetLanguage: "zh-CN", translated: "AI译文" });
});

describe("Behavior 1 — O → restore original → G → local replay (no network) (#65 direct-select)", () => {
  it("newLine: O restores original, G re-shows stored Google locally without network", async () => {
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();

    // Click O: showing Google → restore original
    await handleBtn("original", translatedEl);
    expect(translatedEl.style.display).toBe("none");
    const state1 = getBlockState(translatedEl);
    expect(state1.displayMode).toBe("original");
    expect(state1.aiStatus).toBe("userPinned");

    // Click G: local replay of the stored Google text — zero network calls
    sendMessageSpy.mockClear();
    await handleBtn("google", translatedEl);
    expect(translatedEl.style.display).toBe("block");
    expect(googleSpan.textContent).toBe("Google译文");
    expect(googleSpan.style.display).toBe("block");
    expect(aiSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("google");
    expect(
      sendMessageSpy.mock.calls.filter(([p]) => p?.action === "translateSingleText")
    ).toHaveLength(0);
  });

  it("replaceOriginal: O restores original text, G re-shows stored Google locally without network", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    // Click O: showing Google → restore original
    await handleBtn("original", p);
    expect(textNode.textContent).toBe("Hello world");
    expect(aiSpan.textContent).toBe("");
    expect(getBlockState(p).displayMode).toBe("original");

    // Click G: local replay of stored Google (nodesToRestore[].translatedText)
    sendMessageSpy.mockClear();
    await handleBtn("google", p);
    expect(textNode.textContent).toBe("Google译文");
    expect(getBlockState(p).displayMode).toBe("google");
    expect(
      sendMessageSpy.mock.calls.filter(([p2]) => p2?.action === "translateSingleText")
    ).toHaveLength(0);
  });
});

describe("Behavior 2 — G → Google-only → AI adds AI on top", () => {
  it("newLine: AI click hides googleSpan, shows aiSpan with AI text", async () => {
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();

    await handleBtn("ai", translatedEl);
    expect(aiSpan.textContent).toBe("AI译文");
    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
    expect(getBlockState(translatedEl).aiStatus).toBe("translated");
  });

  it("replaceOriginal: AI clears text nodes and writes AI span", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    await handleBtn("ai", p);
    expect(textNode.textContent).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
    expect(getBlockState(p).aiStatus).toBe("translated");
  });
});

describe("Behavior 3 — AI → Google+AI concurrent → A noop → O restores (#65 direct-select)", () => {
  it("replaceOriginal: AI on original block runs Google concurrently, then A is a noop and O restores", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    // First restore to original
    await handleBtn("original", p);
    expect(getBlockState(p).displayMode).toBe("original");
    expect(textNode.textContent).toBe("Hello world");

    // Click AI: Google+AI concurrent → final display AI
    await handleBtn("ai", p);
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

    // Click A again: already showing AI → noop (direct-select)
    sendMessageSpy.mockClear();
    await handleBtn("ai", p);
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
    expect(
      sendMessageSpy.mock.calls.filter(([p2]) => p2?.action === "translateSingleText")
    ).toHaveLength(0);

    // Click O: restore original (restore responsibility lives on O)
    await handleBtn("original", p);
    expect(textNode.textContent).toBe("Hello world");
    expect(aiSpan.textContent).toBe("");
    expect(getBlockState(p).displayMode).toBe("original");
    expect(getBlockState(p).aiStatus).toBe("userPinned");
  });
});

describe("Behavior 4 — AI → Google+AI → G → Google only → AI → show AI again", () => {
  it("newLine: full cycle switches displays without re-translating", async () => {
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();

    // AI → AI shown
    await handleBtn("ai", translatedEl);
    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");

    // G → Google only
    await handleBtn("google", translatedEl);
    expect(googleSpan.style.display).toBe("block");
    expect(aiSpan.style.display).toBe("none");
    const st = getBlockState(translatedEl);
    expect(st.displayMode).toBe("google");

    // AI again → show AI (cache keeps the text)
    await handleBtn("ai", translatedEl);
    expect(aiSpan.style.display).toBe("block");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
  });

  it("replaceOriginal: G shows Google text from stored result, AI re-shows AI span", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    // AI (from Google display) → AI shown
    await handleBtn("ai", p);
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");

    // G → Google only: nodes get Google text (from nodesToRestore), AI span hidden
    await handleBtn("google", p);
    expect(textNode.textContent).toBe("Google译文");
    expect(aiSpan.style.display).toBe("none");
    expect(getBlockState(p).displayMode).toBe("google");

    // AI again → AI span shown again, nodes cleared
    await handleBtn("ai", p);
    expect(aiSpan.style.display).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(textNode.textContent).toBe("");
    expect(getBlockState(p).displayMode).toBe("ai");
  });
});

describe("Behavior 4b — G after AI resets the singleton AI button to initial state", () => {
  function singletonAiBtn() {
    const host = document.getElementById("dualtran-singleton-btn-host");
    return host ? host.shadowRoot.querySelector(".dualtran-ai-btn") : null;
  }

  it("newLine: AI button shows success after AI, returns to idle after G", async () => {
    createSingletonButtonGroup();
    const { translatedEl } = createNewLineBlock();

    // AI → singleton button renders success (✓)
    await handleBtn("ai", translatedEl);
    const aiBtn = singletonAiBtn();
    expect(aiBtn).not.toBeNull();
    expect(aiBtn.classList.contains("dualtran-ai-success")).toBe(true);
    expect(aiBtn.querySelector(".dualtran-ai-success-check")).not.toBeNull();

    // G → Google-only display AND AI button back to its initial (pre-AI) state
    await handleBtn("google", translatedEl);
    const st = getBlockState(translatedEl);
    expect(st.displayMode).toBe("google");
    expect(st.aiStatus).toBe("userPinned");
    expect(st.translationId).toBe("");
    expect(aiBtn.classList.contains("dualtran-ai-success")).toBe(false);
    expect(aiBtn.classList.contains("dualtran-ai-error")).toBe(false);
    expect(aiBtn.classList.contains("dualtran-ai-loading")).toBe(false);
    expect(aiBtn.querySelector(".dualtran-ai-success-check")).toBeNull();
    expect(aiBtn.querySelector("span").textContent).toBe("AI");
  });

  it("replaceOriginal: AI button shows success after AI, returns to idle after G", async () => {
    createSingletonButtonGroup();
    const { p } = createReplaceOriginalBlock();

    // AI → success
    await handleBtn("ai", p);
    const aiBtn = singletonAiBtn();
    expect(aiBtn).not.toBeNull();
    expect(aiBtn.classList.contains("dualtran-ai-success")).toBe(true);

    // G → Google-only, AI button back to initial state
    await handleBtn("google", p);
    const st = getBlockState(p);
    expect(st.displayMode).toBe("google");
    expect(st.aiStatus).toBe("userPinned");
    expect(st.translationId).toBe("");
    expect(aiBtn.classList.contains("dualtran-ai-success")).toBe(false);
    expect(aiBtn.querySelector(".dualtran-ai-success-check")).toBeNull();
    expect(aiBtn.querySelector("span").textContent).toBe("AI");
  });
});

describe("Behavior 4c — G click is not auto-reverted by the AI translate loop", () => {
  function singletonAiBtn() {
    const host = document.getElementById("dualtran-singleton-btn-host");
    return host ? host.shadowRoot.querySelector(".dualtran-ai-btn") : null;
  }

  it("newLine: aiTranslateDynamically skips a block switched to Google-only", async () => {
    createSingletonButtonGroup();
    const { translatedEl, googleSpan, aiSpan } = createNewLineBlock();

    // AI → AI shown
    await handleBtn("ai", translatedEl);
    // G → Google-only + AI button initial
    await handleBtn("google", translatedEl);
    const st = getBlockState(translatedEl);
    expect(st.displayMode).toBe("google");
    expect(st.aiStatus).toBe("userPinned");

    // Simulate the periodic auto-AI loop (page-level AI mode active)
    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();
    await flushAsync();

    // Block must stay Google-only, not be re-translated with AI
    expect(getBlockState(translatedEl).displayMode).toBe("google");
    expect(getBlockState(translatedEl).aiStatus).toBe("userPinned");
    expect(googleSpan.style.display).toBe("block");
    expect(aiSpan.style.display).toBe("none");
    // AI button stays in initial state
    const aiBtn = singletonAiBtn();
    expect(aiBtn.classList.contains("dualtran-ai-success")).toBe(false);
    expect(aiBtn.querySelector(".dualtran-ai-success-check")).toBeNull();
  });

  it("replaceOriginal: aiTranslateDynamically skips a block switched to Google-only", async () => {
    createSingletonButtonGroup();
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();

    // AI → AI shown
    await handleBtn("ai", p);
    // G → Google-only
    await handleBtn("google", p);
    const st = getBlockState(p);
    expect(st.displayMode).toBe("google");
    expect(st.aiStatus).toBe("userPinned");
    expect(textNode.textContent).toBe("Google译文");

    // Auto-AI loop runs — must NOT re-translate this block
    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();
    await flushAsync();

    expect(getBlockState(p).displayMode).toBe("google");
    expect(getBlockState(p).aiStatus).toBe("userPinned");
    expect(textNode.textContent).toBe("Google译文");
    expect(aiSpan.style.display).toBe("none");
    const aiBtn = singletonAiBtn();
    expect(aiBtn.classList.contains("dualtran-ai-success")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// #65 — late-write suppression (requestEpoch, NQ4.3)
//
// The G channel's pre-#65 write-back check was `displayMode === "original"`,
// which cannot distinguish "not yet written" from "the user clicked O to
// restore": clicking O while a Google request was in flight still let the
// late response write back into the restored block. The AI channel had the
// same shape. requestEpoch is the single monotonic field covering both
// channels: captured when a request starts, validated before any write-back;
// restoreBlockOriginal (O) bumps it, invalidating every in-flight response.
// ──────────────────────────────────────────────────────────────

describe("晚写抑制 — requestEpoch (#65)", () => {
  /** Hold translateSingleText callbacks so responses arrive under test control. */
  function holdGoogleCallbacks() {
    const held = [];
    sendMessageSpy.mockImplementation((payload, callback) => {
      if (typeof callback === "function") {
        if (payload?.action === "getTabHostName") {
          callback("example.com");
        } else if (payload?.action === "translateSingleText") {
          held.push(callback);
        } else {
          callback(undefined);
        }
      }
    });
    return held;
  }

  it("G 在飞 → 点 O → 迟到 Google 响应不写回（块保持原文）", async () => {
    const { p, textNode } = createReplaceOriginalBlock();
    await handleBtn("original", p); // → original
    // Force the network path: clear BOTH stored-text sources (block-level
    // googleTranslatedText AND nodesToRestore[].translatedText) — otherwise
    // the resolver correctly returns the local replay (showGoogle).
    getBlockState(p).googleTranslatedText = "";
    pageTranslator._setNodesToRestoreForTest([{ node: textNode, originalText: "Hello world" }]);

    const held = holdGoogleCallbacks();
    const inFlight = handleBtn("google", p); // fetchGoogle — in flight (held; do NOT await)
    expect(held).toHaveLength(1);
    expect(getBlockState(p).googleBtnState).toBe("translating");

    // Click O while the request is in flight → immediate restore + epoch++
    await handleBtn("original", p);
    expect(textNode.textContent).toBe("Hello world");
    expect(getBlockState(p).displayMode).toBe("original");

    // Late response arrives — must be discarded
    held[0]("Google译文");
    await inFlight;
    await flushAsync();

    expect(textNode.textContent).toBe("Hello world");
    expect(getBlockState(p).displayMode).toBe("original");
    expect(getBlockState(p).googleBtnState).toBe("idle");
  });

  it("G+AI 并发在飞 → 点 O → 两通道迟到响应均不写回", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();
    await handleBtn("original", p); // → original
    getBlockState(p).googleTranslatedText = "";

    const held = holdGoogleCallbacks();
    await handleBtn("ai", p); // original path: Google + AI concurrently
    expect(held).toHaveLength(1); // Google held; AI resolved via cache already
    await flushAsync();

    // Click O while both channels are in flight → restore + epoch++
    await handleBtn("original", p);
    expect(textNode.textContent).toBe("Hello world");
    expect(getBlockState(p).displayMode).toBe("original");
    expect(getBlockState(p).aiStatus).toBe("userPinned");

    // Late Google response arrives — must be discarded
    held[0]("Google译文");
    await flushAsync();

    expect(textNode.textContent).toBe("Hello world");
    expect(aiSpan.textContent).toBe("");
    expect(getBlockState(p).displayMode).toBe("original");
    expect(getBlockState(p).aiStatus).toBe("userPinned");
  });
});

// ──────────────────────────────────────────────────────────────
// Arrival gate — hover A after a page-level Google click (issue #70)
//
// User flow: click the floating group's Google button (page-scope display
// switch → setAiModeActive(false)), then click A on a block's hover group.
// The hover click is a block-scope DIRECT request — a page-level switch away
// that happened BEFORE the request started must not veto its arrival. Only a
// switch away DURING the request suppresses it (Q22 keep / Q23 discard).
// ──────────────────────────────────────────────────────────────

describe("Arrival gate — hover A after page-level Google (issue #70)", () => {
  /** Hold aiTranslationCacheGet callbacks so arrivals land under test control. */
  function holdAiCacheCallbacks() {
    const held = [];
    sendMessageSpy.mockImplementation((payload, callback) => {
      if (typeof callback === "function") {
        if (payload?.action === "getTabHostName") {
          callback("example.com");
        } else if (payload?.action === "aiTranslationCacheGet") {
          held.push(callback);
        } else {
          callback(undefined);
        }
      }
    });
    return held;
  }

  /** A selected-text panel button: no aiSpan, no block state (legacy shape). */
  function createPanelButton() {
    const button = document.createElement("button");
    button.className = "dualtran-ai-selected-btn";
    button.btnAiTxtNode = document.createElement("span");
    button.tooltip = document.createElement("span");
    button.translatedTextNode = document.createElement("span");
    button.sourceString = "Hello world";
    button.append(button.btnAiTxtNode, button.tooltip, button.translatedTextNode);
    document.body.appendChild(button);
    return button;
  }

  /** newLine block with the Google translation actually on display. */
  function createDisplayedNewLineBlock() {
    const block = createNewLineBlock();
    block.googleSpan.style.display = "block";
    return block;
  }

  beforeEach(() => {
    mockState.configValues.enableAiTranslationCache = "no";
  });

  afterEach(() => {
    // Restore the page-level flag (module state is shared across tests in this file).
    pageTranslator.setAiModeActive(true);
  });

  it("newLine: stale page-level flag (set before the request) must not veto the arrival", async () => {
    const { translatedEl, googleSpan, aiSpan } = createDisplayedNewLineBlock();
    pageTranslator.setAiModeActive(false); // floating Google click latched this earlier

    await handleBtn("ai", translatedEl);
    await flushAsync();

    expect(aiSpan.textContent).toBe("AI译文");
    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
    expect(getBlockState(translatedEl).aiStatus).toBe("translated");
  });

  it("replaceOriginal: stale page-level flag (set before the request) must not veto the arrival", async () => {
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();
    textNode.textContent = "Google译文";
    pageTranslator.setAiModeActive(false);

    await handleBtn("ai", p);
    await flushAsync();

    expect(textNode.textContent).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
    expect(getBlockState(p).aiStatus).toBe("translated");
  });

  it("newLine: persistent-cache arrival with a stale page-level flag must not be vetoed", async () => {
    mockState.configValues.enableAiTranslationCache = "yes";
    const { translatedEl, googleSpan, aiSpan } = createDisplayedNewLineBlock();
    aiCache.length = 0; // force the persistent-cache path
    pageTranslator.setAiModeActive(false);

    const held = holdAiCacheCallbacks();
    const inFlight = handleBtn("ai", translatedEl);
    expect(held).toHaveLength(1);
    held[0]({ translated: "AI译文" });
    await inFlight;
    await flushAsync();

    expect(aiSpan.textContent).toBe("AI译文");
    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
    expect(getBlockState(translatedEl).aiStatus).toBe("translated");
  });

  it("replaceOriginal: persistent-cache arrival with a stale page-level flag must not be vetoed", async () => {
    mockState.configValues.enableAiTranslationCache = "yes";
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();
    textNode.textContent = "Google译文";
    aiCache.length = 0;
    pageTranslator.setAiModeActive(false);

    const held = holdAiCacheCallbacks();
    const inFlight = handleBtn("ai", p);
    expect(held).toHaveLength(1);
    held[0]({ translated: "AI译文" });
    await inFlight;
    await flushAsync();

    expect(textNode.textContent).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
    expect(getBlockState(p).aiStatus).toBe("translated");
  });

  it("panel requests (selected-text) are not vetoed by a stale page-level flag", async () => {
    const { aiTranslateText } = await import("../../src/contentScript/pageTranslator.js");
    pageTranslator.setAiModeActive(false);
    const button = createPanelButton();

    await aiTranslateText([button], false);

    expect(button.translationStatus).toBe("translated");
    expect(button.translatedTextNode.textContent).toBe("AI译文");
  });

  it("newLine: switching away DURING the request suppresses the arrival; the kept result stays reachable (Q22)", async () => {
    mockState.configValues.enableAiTranslationCache = "yes";
    const { translatedEl, googleSpan, aiSpan } = createDisplayedNewLineBlock();
    aiCache.length = 0;

    const held = holdAiCacheCallbacks();
    const inFlight = handleBtn("ai", translatedEl);
    expect(held).toHaveLength(1);

    // The user clicks the floating group's Google button while the request is in flight.
    pageTranslator.setAiModeActive(false);
    held[0]({ translated: "AI译文" });
    await inFlight;
    await flushAsync();

    // Q22: result kept (text + status), display NOT switched — Google stays visible.
    expect(aiSpan.textContent).toBe("AI译文");
    expect(aiSpan.style.display).toBe("none");
    expect(googleSpan.style.display).toBe("block");
    expect(getBlockState(translatedEl).aiStatus).toBe("translated");
    expect(getBlockState(translatedEl).displayMode).toBe("google");

    // A click again: local re-show of the kept text — zero new requests.
    sendMessageSpy.mockClear();
    await handleBtn("ai", translatedEl);
    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
    expect(
      sendMessageSpy.mock.calls.filter(([payload]) => payload?.action === "aiTranslationCacheGet")
    ).toHaveLength(0);
    expect(
      sendMessageSpy.mock.calls.filter(([payload]) => payload?.action === "translateSingleText")
    ).toHaveLength(0);
  });

  it("replaceOriginal: switching away DURING the request discards the arrival; A again re-requests (cache-backed) (Q23)", async () => {
    mockState.configValues.enableAiTranslationCache = "yes";
    const { p, textNode, aiSpan } = createReplaceOriginalBlock();
    textNode.textContent = "Google译文";
    aiCache.length = 0;

    const held = holdAiCacheCallbacks();
    const inFlight = handleBtn("ai", p);
    expect(held).toHaveLength(1);

    pageTranslator.setAiModeActive(false);
    held[0]({ translated: "AI译文" });
    await inFlight;
    await flushAsync();

    // Q23: fully discarded — Google text untouched, status reset so the block is re-requestable.
    expect(textNode.textContent).toBe("Google译文");
    expect(aiSpan.textContent).toBe("");
    expect(getBlockState(p).aiStatus).toBe("idle");
    expect(getBlockState(p).displayMode).toBe("google");

    // A click again: re-request resolves from the cache (zero network) — shows AI.
    sendMessageSpy.mockClear();
    await handleBtn("ai", p);
    await flushAsync();
    expect(textNode.textContent).toBe("");
    expect(aiSpan.textContent).toBe("AI译文");
    expect(getBlockState(p).displayMode).toBe("ai");
    expect(
      sendMessageSpy.mock.calls.filter(([payload]) => payload?.action === "translateSingleText")
    ).toHaveLength(0);
  });

  it("control: page-level AI mode (flag true at request start) still switches the display", async () => {
    const { translatedEl, googleSpan, aiSpan } = createDisplayedNewLineBlock();
    pageTranslator.setAiModeActive(true);

    await handleBtn("ai", translatedEl);
    await flushAsync();

    expect(aiSpan.style.display).toBe("block");
    expect(googleSpan.style.display).toBe("none");
    expect(getBlockState(translatedEl).displayMode).toBe("ai");
  });

  it("guard: a stale switch-away (epoch captured after it) does not veto the arrival", () => {
    pageTranslator.setAiModeActive(false);
    const capturedEpoch = pageTranslator._getAiModeEpoch();
    expect(pageTranslator._isAiArrivalAllowed(capturedEpoch)).toBe(true);
  });

  it("guard: a switch-away during the request vetoes the arrival (Q22/Q23 edge)", () => {
    pageTranslator.setAiModeActive(true);
    const capturedEpoch = pageTranslator._getAiModeEpoch();
    pageTranslator.setAiModeActive(false);
    expect(pageTranslator._isAiArrivalAllowed(capturedEpoch)).toBe(false);
  });

  it("guard: AI mode still active at arrival always applies", () => {
    pageTranslator.setAiModeActive(true);
    const capturedEpoch = pageTranslator._getAiModeEpoch();
    expect(pageTranslator._isAiArrivalAllowed(capturedEpoch)).toBe(true);
  });
});
