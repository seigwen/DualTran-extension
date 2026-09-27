/**
 * Block-level direct-click indicators (integration) — plan 30 / PR-A.
 *
 * The hover group's G / A buttons are direct-select: clicking them starts a
 * block-scoped request. Until now that request had ZERO page-side feedback —
 * the only signal was the button's own "translating..." label, which plan 30
 * removes (buttons express intent; actual state lives on the page). This suite
 * pins the page-side indicators for the direct-click path:
 *
 *  - direct G → green google spinner at the block, cleared on arrival
 *  - direct A → purple AI spinner — ARRIVAL-bound (#90 discipline: it must
 *    survive the dispatch return and clear when the block's text arrives)
 *  - failure → ⚠ icon carrying the REAL error message
 *  - silent death → guard timer clears a never-settling spinner
 *  - O (restore) invalidates an in-flight request → its spinner goes at once
 *  - both display modes (newLine / replaceOriginal) and both channels of the
 *    concurrent (original-display) path are covered
 *
 * RED-first: on the pre-change executor every spinner assertion fails — the
 * direct-click path never calls setBlockTranslationIndicator.
 */

import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
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
// mock-fidelity-allow: transport is stubbed (zero network); the arrival parser runs for real and the stream-arrival semantics of this path are pinned by the arrival cells below
vi.mock("../../src/contentScript/fetchSSE.js", () => ({ translateWithAI: vi.fn() }));
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

// Chrome stub. The Google single-text callback is HOLDABLE: tests capture the
// callback and settle it manually to observe the in-flight window.
let heldGoogleCallback = null;
const defaultSendMessageImpl = (payload, callback) => {
  if (typeof callback === "function") {
    if (payload?.action === "getTabHostName") {
      callback("example.com");
    } else if (payload?.action === "translateSingleText") {
      if (heldGoogleCallback === null) {
        callback("Google译文");
      } else {
        heldGoogleCallback = callback; // hold — test settles it manually
      }
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

beforeEach(() => {
  document.body.innerHTML = "";
  sendMessageSpy.mockClear();
  sendMessageSpy.mockImplementation(defaultSendMessageImpl);
  heldGoogleCallback = null;
  aiCache.length = 0; // no in-memory cache → the real (mocked-transport) network path
  translateWithAIMock.mockReset();
  mockState.configValues.whereToDisplayTranslatedText = "newLine";
});

afterEach(() => {
  vi.useRealTimers();
});

// ── DOM builders (real registerBlock shapes) ────────────────────────────────

/** newLine block with NO stored Google text → a G click must fetch (network). */
function createNewLineBlockNoStoredGoogle() {
  const p = document.createElement("p");
  p.appendChild(document.createTextNode("Hello world"));
  const translatedEl = document.createElement("translated");
  translatedEl.style.display = "none";
  const googleSpan = document.createElement("span");
  googleSpan.className = "dualtran-google";
  googleSpan.textContent = "";
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-ai";
  aiSpan.textContent = "";
  aiSpan.style.display = "none";
  translatedEl.appendChild(googleSpan);
  translatedEl.appendChild(aiSpan);
  p.appendChild(translatedEl);
  document.body.appendChild(p);
  registerBlock(translatedEl, "Hello world", googleSpan, "", null, { googleSpan, aiSpan });
  return { p, translatedEl, googleSpan, aiSpan };
}

/** newLine block showing Google (stored text) — the common A-click starting point. */
function createNewLineBlockWithGoogle() {
  const p = document.createElement("p");
  p.appendChild(document.createTextNode("Hello world"));
  const translatedEl = document.createElement("translated");
  translatedEl.style.display = "block";
  const googleSpan = document.createElement("span");
  googleSpan.className = "dualtran-google";
  googleSpan.textContent = "Google译文";
  googleSpan.style.display = "block";
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-ai";
  aiSpan.textContent = "";
  aiSpan.style.display = "none";
  translatedEl.appendChild(googleSpan);
  translatedEl.appendChild(aiSpan);
  p.appendChild(translatedEl);
  document.body.appendChild(p);
  registerBlock(translatedEl, "Hello world", googleSpan, "Google译文", null, { googleSpan, aiSpan });
  return { p, translatedEl, googleSpan, aiSpan };
}

/** replaceOriginal block with no stored Google text (for the direct-G fetch path). */
function createReplaceOriginalBlockNoStoredGoogle() {
  const p = document.createElement("p");
  const textNode = document.createTextNode("Hello world");
  p.appendChild(textNode);
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-aitranslatedtext-replacemode";
  aiSpan.textContent = "";
  p.appendChild(aiSpan);
  document.body.appendChild(p);
  registerBlock(p, "Hello world", aiSpan, "", [textNode]);
  return { p, textNode, aiSpan };
}

// ── Indicator probes ────────────────────────────────────────────────────────

/** The spinner anchored BEFORE a node (newLine anchor). */
function spinnerBefore(node, type) {
  let sibling = node.previousSibling;
  while (sibling) {
    if (sibling.nodeType === 1 && sibling.classList?.contains("dualtran-block-spinner") && sibling.dataset.type === type) {
      return sibling;
    }
    sibling = sibling.previousSibling;
  }
  return null;
}

/** The spinner anchored INSIDE a node (replaceOriginal anchor). */
function spinnerInside(node, type) {
  const children = node.children || [];
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].classList?.contains("dualtran-block-spinner") && children[i].dataset.type === type) {
      return children[i];
    }
  }
  return null;
}

/** The indicator (any state) anchored BEFORE a node. */
function indicatorBefore(node, type) {
  let sibling = node.previousSibling;
  while (sibling) {
    if (sibling.nodeType === 1 && sibling.classList?.contains("dualtran-block-indicator") && sibling.dataset.type === type) {
      return sibling;
    }
    sibling = sibling.previousSibling;
  }
  return null;
}

/** The indicator (any state) anchored INSIDE a node. */
function indicatorInside(node, type) {
  const children = node.children || [];
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].classList?.contains("dualtran-block-indicator") && children[i].dataset.type === type) {
      return children[i];
    }
  }
  return null;
}

/** Hold the next Google single-text callback and return a resolver for it. */
function holdNextGoogleCallback() {
  heldGoogleCallback = () => {}; // marker: next callback is captured, not called
  return (text) => {
    const cb = heldGoogleCallback;
    heldGoogleCallback = null;
    cb(text);
  };
}

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

// ════════════════════════════════════════════════════════════════════════════

describe("direct G click — page-side google spinner (newLine)", () => {
  it("spinner appears during flight and clears on arrival", async () => {
    createSingletonButtonGroup();
    const { translatedEl, googleSpan } = createNewLineBlockNoStoredGoogle();

    // O first: displayMode=original with no stored text → G becomes a fetch.
    await handleBtn("original", translatedEl);

    const releaseGoogle = holdNextGoogleCallback();
    const pending = handleBtn("google", translatedEl);
    await flushAsync();

    // RED on the old executor: no spinner anywhere (zero feedback).
    const spinner = spinnerBefore(translatedEl, "google");
    expect(spinner).not.toBeNull();
    expect(spinner.dataset.state).toBe("loading");

    releaseGoogle("Google译文");
    await pending;
    await flushAsync();

    expect(spinnerBefore(translatedEl, "google")).toBeNull();
    expect(googleSpan.textContent).toBe("Google译文");
    expect(translatedEl.style.display).toBe("block");
  });

  it("failure resolves to the ⚠ indicator, not a stuck spinner", async () => {
    createSingletonButtonGroup();
    const { translatedEl } = createNewLineBlockNoStoredGoogle();
    await handleBtn("original", translatedEl);

    // The background responds with undefined → the promise rejects → error path.
    const releaseGoogle = holdNextGoogleCallback();
    const pending = handleBtn("google", translatedEl);
    await flushAsync();
    expect(spinnerBefore(translatedEl, "google")).not.toBeNull();

    releaseGoogle(undefined);
    await pending;
    await flushAsync();

    expect(spinnerBefore(translatedEl, "google")).toBeNull();
    const indicator = indicatorBefore(translatedEl, "google");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-error")).toBe(true);
  });

  it("noop click (already showing Google) starts no indicator", async () => {
    createSingletonButtonGroup();
    const { translatedEl } = createNewLineBlockWithGoogle();

    await handleBtn("google", translatedEl);
    await flushAsync();

    expect(indicatorBefore(translatedEl, "google")).toBeNull();
  });
});

describe("direct G click — spinner anchor in replaceOriginal mode", () => {
  it("spinner is appended inside the block, cleared on arrival", async () => {
    mockState.configValues.whereToDisplayTranslatedText = "replaceOriginal";
    createSingletonButtonGroup();
    const { p, textNode } = createReplaceOriginalBlockNoStoredGoogle();

    await handleBtn("original", p);

    const releaseGoogle = holdNextGoogleCallback();
    const pending = handleBtn("google", p);
    await flushAsync();

    const spinner = spinnerInside(p, "google");
    expect(spinner).not.toBeNull();
    expect(spinner.parentNode).toBe(p);

    releaseGoogle("Google译文");
    await pending;
    await flushAsync();

    expect(indicatorInside(p, "google")).toBeNull();
    expect(textNode.textContent).toBe("Google译文");
  });
});

describe("direct A click — page-side AI spinner is arrival-bound (#90 discipline)", () => {
  it("newLine: spinner survives the dispatch return; cleared when the block's text arrives", async () => {
    createSingletonButtonGroup();
    const { translatedEl, aiSpan } = createNewLineBlockWithGoogle();

    translateWithAIMock.mockImplementation(() => {}); // stream held open

    await handleBtn("ai", translatedEl); // dispatch return — nothing has arrived yet
    await flushAsync();

    // RED on the old executor: no spinner to survive anything.
    expect(spinnerBefore(translatedEl, "ai")).not.toBeNull();

    const onMessage = translateWithAIMock.mock.calls[0][1];
    const { translationId } = getBlockState(translatedEl);
    expect(typeof translationId).toBe("string");
    onMessage(JSON.stringify({ choices: [{ delta: { content: `<译泽 id="${translationId}">AI译文</译泽>` } }] }));
    await flushAsync();

    expect(spinnerBefore(translatedEl, "ai")).toBeNull();
    expect(aiSpan.textContent).toBe("AI译文");
    expect(aiSpan.style.display).toBe("block");
  });

  it("replaceOriginal: spinner appended inside the block, cleared on arrival", async () => {
    mockState.configValues.whereToDisplayTranslatedText = "replaceOriginal";
    createSingletonButtonGroup();
    const { p } = createReplaceOriginalBlockNoStoredGoogle();

    translateWithAIMock.mockImplementation(() => {});
    await handleBtn("ai", p);
    await flushAsync();

    expect(spinnerInside(p, "ai")).not.toBeNull();

    const onMessage = translateWithAIMock.mock.calls[0][1];
    const { translationId } = getBlockState(p);
    onMessage(JSON.stringify({ choices: [{ delta: { content: `<译泽 id="${translationId}">AI译文</译泽>` } }] }));
    await flushAsync();

    expect(indicatorInside(p, "ai")).toBeNull();
  });

  it("failure shows the ⚠ icon with the REAL error message", async () => {
    createSingletonButtonGroup();
    const { translatedEl } = createNewLineBlockWithGoogle();

    translateWithAIMock.mockImplementation((content, onMessage, onError) => {
      onError({ error: { message: "provider 503", type: "server_error" } });
    });

    await handleBtn("ai", translatedEl);
    await flushAsync();

    expect(spinnerBefore(translatedEl, "ai")).toBeNull();
    const indicator = indicatorBefore(translatedEl, "ai");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-error")).toBe(true);
    expect(indicator.title).toContain("provider 503");
  });
});

describe("concurrent path (original display) — both channel spinners, independent cleanup", () => {
  it("O → A on newLine: green + purple spinners; each clears on its own arrival", async () => {
    createSingletonButtonGroup();
    const { translatedEl } = createNewLineBlockWithGoogle();

    // O: restore → displayMode=original → A becomes the concurrent path.
    await handleBtn("original", translatedEl);

    const releaseGoogle = holdNextGoogleCallback();
    translateWithAIMock.mockImplementation(() => {});
    const pending = handleBtn("ai", translatedEl);
    await flushAsync();

    expect(spinnerBefore(translatedEl, "google")).not.toBeNull();
    expect(spinnerBefore(translatedEl, "ai")).not.toBeNull();

    // Google arrives first: only the green spinner goes.
    releaseGoogle("Google译文");
    await flushAsync();
    expect(spinnerBefore(translatedEl, "google")).toBeNull();
    expect(spinnerBefore(translatedEl, "ai")).not.toBeNull();

    // AI arrival clears the purple spinner.
    const onMessage = translateWithAIMock.mock.calls[0][1];
    const { translationId } = getBlockState(translatedEl);
    onMessage(JSON.stringify({ choices: [{ delta: { content: `<译泽 id="${translationId}">AI译文</译泽>` } }] }));
    await flushAsync();
    await flushAsync();

    expect(spinnerBefore(translatedEl, "ai")).toBeNull();
    expect(spinnerBefore(translatedEl, "google")).toBeNull();
  });
});

describe("indicator lifetime guards", () => {
  it("silent death: a never-settling AI stream is cleaned by the guard timer", async () => {
    vi.useFakeTimers();
    createSingletonButtonGroup();
    const { translatedEl } = createNewLineBlockWithGoogle();

    translateWithAIMock.mockImplementation(() => {});
    await handleBtn("ai", translatedEl);
    expect(spinnerBefore(translatedEl, "ai")).not.toBeNull();

    vi.advanceTimersByTime(181_000);

    expect(spinnerBefore(translatedEl, "ai")).toBeNull();
  });

  it("O (restore) invalidates an in-flight AI request and its spinner immediately", async () => {
    createSingletonButtonGroup();
    const { translatedEl } = createNewLineBlockWithGoogle();

    translateWithAIMock.mockImplementation(() => {});
    await handleBtn("ai", translatedEl);
    await flushAsync();
    expect(spinnerBefore(translatedEl, "ai")).not.toBeNull();

    await handleBtn("original", translatedEl);

    // Not after the 180s guard — the request was invalidated (epoch++) and the
    // indicator lifetime is the REQUEST lifetime.
    expect(spinnerBefore(translatedEl, "ai")).toBeNull();
  });
});

// ── Implementation-point map (plan 30 / PR-A) ─────────────────────────────────
// showHoverBlockIndicator / settleHoverBlockIndicator / guard (pageTranslator.js)
//   — the direct-click indicator lifecycle; pinned by every cell above.
// aiBlockIndicatorPosition (pageTranslator.js) — anchor decision shared with the
//   page-level flow; the anchor cells assert "before <translated>" (newLine) and
//   "append to the block" (replaceOriginal).
// settleHoverBlockIndicator via onBlockSettled — arrival-bound cleanup; the
//   "survives the dispatch return" cell is the RED cell that fails if cleanup
//   ever gets re-bound to the dispatch.
// restoreBlock (executor case) — in-flight invalidation clears the indicator at
//   once; the last cell pins the immediate (non-guard) cleanup.
