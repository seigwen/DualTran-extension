/**
 * Block-level AI indicator lifecycle (integration).
 *
 * The user report: clicking the "AI" button shows NO loading indicator on the
 * page's paragraphs, while clicking "Google" shows one. Root cause (measured
 * with a slow mock): the purple spinner WAS inserted (t=6ms) and removed again
 * 42ms later (t=48ms) — before any AI text arrived (t=2068ms). The AI path's
 * cleanup was bound to `aiTranslateText`'s return, which happens at DISPATCH
 * time (the stream arrives via callbacks), unlike the Google path whose await
 * resolves on arrival.
 *
 * This suite drives the REAL `aiTranslateDynamically` loop with REAL registerBlock
 * blocks and a transport mock that never settles unless the test says so:
 *
 *  - after the dispatch returns, the spinner is STILL there (old code: gone → red)
 *  - an arriving block clears its own spinner while its siblings keep theirs
 *  - a failing block shows the error icon with the REAL error message
 *  - both display modes (newLine / replaceOriginal) are covered
 *  - the anchor sits inline at the read text, not on a line below the block
 *
 * `translateWithAI` is mocked (no network); the arrival parser is the real one,
 * so the streaming path stays observable (#72 mock-fidelity).
 */

import { beforeEach, describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { registerBlock, getBlockState, createSingletonButtonGroup } from "../../src/contentScript/singletonBtnGroup.js";
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
// mock-fidelity-allow: transport is stubbed (zero network); arrival parsing runs for real, and the arrival-path semantics are pinned by hoverBtnStreamArrival + the matrix
vi.mock("../../src/contentScript/fetchSSE.js", () => ({ translateWithAI: vi.fn() }));
// Real parser — the streaming arrivals in this suite need genuine <译泽> extraction.
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

let pageTranslator, aiCache;

beforeAll(async () => {
  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;
  aiCache = mod.aiCache;
  await vi.waitFor(() => {
    expect(pageTranslator._aiTranslateDynamically).toBeTypeOf("function");
  }, { timeout: 5000 });
});

beforeEach(() => {
  document.body.innerHTML = "";
  sendMessageSpy.mockClear();
  sendMessageSpy.mockImplementation(defaultSendMessageImpl);
  aiCache.length = 0; // no in-memory cache → force the real network path
  translateWithAIMock.mockReset();
  mockState.configValues.whereToDisplayTranslatedText = "newLine";
});

afterEach(() => {
  vi.useRealTimers();
});

// ── DOM builders (real registerBlock shapes) ────────────────────────────────

/** newLine mode: <p>原文 + <translated>[googleSpan, aiSpan] as production builds it. */
function createNewLineBlock(source, googleText = "Google译文") {
  const p = document.createElement("p");
  p.appendChild(document.createTextNode(source));
  const translatedEl = document.createElement("translated");
  translatedEl.style.display = "block";
  const googleSpan = document.createElement("span");
  googleSpan.className = "dualtran-google";
  googleSpan.textContent = googleText;
  googleSpan.style.display = "block";
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-ai";
  aiSpan.textContent = "";
  aiSpan.style.display = "none";
  translatedEl.appendChild(googleSpan);
  translatedEl.appendChild(aiSpan);
  p.appendChild(translatedEl);
  document.body.appendChild(p);
  registerBlock(translatedEl, source, googleSpan, googleText, null, { googleSpan, aiSpan });
  return { p, translatedEl, googleSpan, aiSpan };
}

/** replaceOriginal mode: block element + .dualtran-aitranslatedtext-replacemode span. */
function createReplaceOriginalBlock(source) {
  const p = document.createElement("p");
  const textNode = document.createTextNode(source);
  p.appendChild(textNode);
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-aitranslatedtext-replacemode";
  aiSpan.textContent = "";
  p.appendChild(aiSpan);
  document.body.appendChild(p);
  registerBlock(p, source, aiSpan, "", [textNode]);
  return { p, textNode, aiSpan };
}

// ── Indicator probes ────────────────────────────────────────────────────────

/** Count the AI spinners anchored BEFORE a node (newLine anchor). */
function spinnerBefore(node) {
  let sibling = node.previousSibling;
  while (sibling) {
    if (sibling.nodeType === 1 && sibling.classList?.contains("dualtran-block-spinner") && sibling.dataset.type === "ai") {
      return sibling;
    }
    sibling = sibling.previousSibling;
  }
  return null;
}

/** Count the AI spinners anchored INSIDE a node (replaceOriginal anchor). */
function spinnerInside(node) {
  const children = node.children || [];
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].classList?.contains("dualtran-block-spinner") && children[i].dataset.type === "ai") {
      return children[i];
    }
  }
  return null;
}

function indicatorInside(node) {
  const children = node.children || [];
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].classList?.contains("dualtran-block-indicator") && children[i].dataset.type === "ai") {
      return children[i];
    }
  }
  return null;
}

function indicatorBefore(node) {
  let sibling = node.previousSibling;
  while (sibling) {
    if (sibling.nodeType === 1 && sibling.classList?.contains("dualtran-block-indicator") && sibling.dataset.type === "ai") {
      return sibling;
    }
    sibling = sibling.previousSibling;
  }
  return null;
}

/** Drive one streaming chunk that completes the block with the given id. */
function emitTranslationChunk(translationId, text) {
  const chunk = `<译泽 id="${translationId}">${text}</译泽>`;
  translateWithAIMock.mockImplementationOnce((content, onMessage) => {
    onMessage(JSON.stringify({ choices: [{ delta: { content: chunk } }] }));
  });
}

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

// ════════════════════════════════════════════════════════════════════════════

describe("AI block indicator lifecycle — dispatch vs arrival", () => {
  it("newLine: spinner survives the dispatch return; cleared only when the block's text arrives", async () => {
    createSingletonButtonGroup();
    const a = createNewLineBlock("Hello world");
    const b = createNewLineBlock("Another paragraph");
    pageTranslator._setForceAiTranslation(true);

    // Transport that holds the stream open — nothing arrives during this test
    // until we explicitly emit a chunk.
    translateWithAIMock.mockImplementation(() => {});

    await pageTranslator._aiTranslateDynamically();
    await flushAsync();

    // RED on the old code: both spinners were already removed at dispatch time.
    expect(spinnerBefore(a.translatedEl)).not.toBeNull();
    expect(spinnerBefore(b.translatedEl)).not.toBeNull();

    // Block A's text arrives → A's spinner goes away, B's must stay.
    const { translationId } = getBlockState(a.translatedEl);
    expect(typeof translationId).toBe("string");
    expect(translationId.length).toBeGreaterThan(0);

    const calls = translateWithAIMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const onMessage = calls[0][1];
    onMessage(JSON.stringify({ choices: [{ delta: { content: `<译泽 id="${translationId}">AI译文A</译泽>` } }] }));
    await flushAsync();

    expect(spinnerBefore(a.translatedEl)).toBeNull();
    expect(spinnerBefore(b.translatedEl)).not.toBeNull();

    // Block B's text arrives → its spinner goes away too.
    const bId = getBlockState(b.translatedEl).translationId;
    onMessage(JSON.stringify({ choices: [{ delta: { content: `<译泽 id="${bId}">AI译文B</译泽>` } }] }));
    await flushAsync();

    expect(spinnerBefore(b.translatedEl)).toBeNull();
    expect(a.aiSpan.textContent).toBe("AI译文A");
    expect(b.aiSpan.textContent).toBe("AI译文B");
  });

  it("replaceOriginal: same lifecycle, spinner appended inside the block", async () => {
    mockState.configValues.whereToDisplayTranslatedText = "replaceOriginal";
    createSingletonButtonGroup();
    const a = createReplaceOriginalBlock("Hello world");
    const b = createReplaceOriginalBlock("Another paragraph");
    pageTranslator._setForceAiTranslation(true);

    translateWithAIMock.mockImplementation(() => {});

    await pageTranslator._aiTranslateDynamically();
    await flushAsync();

    expect(spinnerInside(a.p)).not.toBeNull();
    expect(spinnerInside(b.p)).not.toBeNull();

    const calls = translateWithAIMock.mock.calls;
    const onMessage = calls[0][1];
    const aId = getBlockState(a.p).translationId;
    onMessage(JSON.stringify({ choices: [{ delta: { content: `<译泽 id="${aId}">AI译文A</译泽>` } }] }));
    await flushAsync();

    expect(indicatorInside(a.p)).toBeNull();
    expect(spinnerInside(b.p)).not.toBeNull();

    const bId = getBlockState(b.p).translationId;
    onMessage(JSON.stringify({ choices: [{ delta: { content: `<译泽 id="${bId}">AI译文B</译泽>` } }] }));
    await flushAsync();

    expect(indicatorInside(b.p)).toBeNull();
    expect(a.aiSpan.textContent).toBe("AI译文A");
  });

  it("never-stranded: a dead stream is cleaned up by the guard timer", async () => {
    vi.useFakeTimers();
    createSingletonButtonGroup();
    const a = createNewLineBlock("Hello world");
    pageTranslator._setForceAiTranslation(true);

    // Transport that never calls back — simulates a silently killed worker.
    translateWithAIMock.mockImplementation(() => {});

    await pageTranslator._aiTranslateDynamically();
    expect(spinnerBefore(a.translatedEl)).not.toBeNull();

    // Guard fires long after the transport's own 60s inactivity timeout.
    vi.advanceTimersByTime(181_000);

    expect(spinnerBefore(a.translatedEl)).toBeNull();
  });

  it("anchor parity: spinner is inline (not a standalone line below the block)", async () => {
    createSingletonButtonGroup();
    const a = createNewLineBlock("Hello world");
    pageTranslator._setForceAiTranslation(true);
    translateWithAIMock.mockImplementation(() => {});

    await pageTranslator._aiTranslateDynamically();
    await flushAsync();

    const spinner = spinnerBefore(a.translatedEl);
    expect(spinner).not.toBeNull();
    // newLine: anchored before <translated>, i.e. inside the <p> right after the source text
    expect(spinner.parentNode).toBe(a.p);
    expect(spinner.nextSibling).toBe(a.translatedEl);
    // and NOT on its own line after the block
    expect(a.p.nextSibling).not.toBe(spinner);
  });

  it("error block shows the error icon with the REAL error message from the block state", async () => {
    createSingletonButtonGroup();
    const a = createNewLineBlock("Hello world");
    pageTranslator._setForceAiTranslation(true);

    // The transport fails; the error path writes st.errorMessage.
    translateWithAIMock.mockImplementation((content, onMessage, onError) => {
      onError({ error: { message: "provider 503", type: "server_error" } });
    });

    await pageTranslator._aiTranslateDynamically();
    await flushAsync();

    const indicator = indicatorBefore(a.translatedEl);
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-error")).toBe(true);
    // The old code read a non-existent `proxy._lastErrorMessage` → tooltip was
    // always the generic fallback. The real message must survive.
    expect(indicator.title).toContain("provider 503");
    expect(spinnerBefore(a.translatedEl)).toBeNull();
  });
});
