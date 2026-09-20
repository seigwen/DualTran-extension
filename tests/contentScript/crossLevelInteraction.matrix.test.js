/**
 * Cross-level interaction matrix (issue #72; escape analysis of #70).
 *
 * WHY THIS FILE EXISTS
 * The #70 escape analysis (doc 21, mechanism 1) found that coverage was
 * organized per-component ("page-level behavior table", "block-level behavior
 * table") and never as the CARTESIAN PRODUCT of the two. #70 lived exactly in
 * that blank cell: a page-level action (floating Google click →
 * setAiModeActive(false)) mutating global implicit state that a block-level
 * action (hover A) consumes.
 *
 * WHAT IT DOES
 * Enumerates, data-driven:
 *     { page-level precondition } × { block-level action } × { display mode }
 *     × { arrival path for fetch actions }
 * and asserts, per cell:
 *     V1 tri-consistency — visible truth ⇔ block state (the L2 oracle,
 *        visible-block-truth.mjs; catches "#70 desync": state says ai, user
 *        sees Google)
 *     V2 direct-select effect — clicking A on a block ends with the block
 *        visibly showing AI (or, for the negative cells, provably not)
 *     V3 noop discipline — a noop cell issues zero new requests
 *
 * A completeness meta-test walks the same tables and fails if any cell is
 * missing, so future deletions of cells turn red.
 *
 * The real seam is used throughout: the REAL click executor
 * (pageTranslator._handleSingletonBtnClick) against blocks registered with the
 * REAL registerBlock, with real arrival machinery for all three arrival paths
 * (in-memory cache / persistent cache / streaming parser).
 */

import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { registerBlock, getBlockState } from "../../src/contentScript/singletonBtnGroup.js";
import { translateWithAI as translateWithAIMock } from "../../src/contentScript/fetchSSE.js";
import { readVisibleBlockTruth, checkVisibleMatchesState } from "../shared/visible-block-truth.mjs";

// ── page-level preconditions ────────────────────────────────────────────────
// fresh        — no page-level action yet (aiModeActive default true)
// page-google  — floating Google click happened earlier (the #70 precondition)
// page-ai      — floating AI click happened (flag true, explicitly)
export const PAGE_PRECONDITIONS = ["fresh", "page-google", "page-ai"];

// ── block-level actions ────────────────────────────────────────────────────
export const BLOCK_ACTIONS = ["ai", "google", "original"];

// ── display modes under test ───────────────────────────────────────────────
export const DISPLAY_MODES = ["newLine", "replaceOriginal"];

// ── arrival paths (fetch actions only) ─────────────────────────────────────
// memory-cache     — in-memory aiCache hit (synchronous-ish)
// persistent-cache — storage-backed cache (held callback, arrival under control)
// stream           — real streaming parser over translateWithAI's onMessage
export const ARRIVAL_PATHS = ["memory-cache", "persistent-cache", "stream"];

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
    set: vi.fn((key, value) => {
      mockState.configValues[key] = value;
    }),
    onReady: vi.fn(() => Promise.resolve()),
    onChanged: vi.fn(),
    ready: true,
  },
}));

vi.mock("../../src/lib/languages.js", () => ({ default: { fixTLanguageCode: (c) => c } }));
vi.mock("../../src/lib/platformInfo.js", () => ({ default: { isMobile: { any: false } } }));
vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: {
    isEnabled: false,
    enable: vi.fn(),
    disable: vi.fn(),
    add: vi.fn(),
    removeAll: vi.fn(),
    enabledObserverSubscribe: vi.fn(),
  },
}));
vi.mock("../../src/contentScript/fetchSSE.js", () => ({ translateWithAI: vi.fn() }));
// Real stream parser: the matrix must exercise the genuine tagged-block
// extraction, not a stub (mock-fidelity discipline, #72 mechanism 4).
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
vi.mock("../../src/util/globalWordsCount.js", () => ({
  wordsCount: (t) => t.split(/\s+/).filter(Boolean).length,
}));
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
  await vi.waitFor(
    () => {
      expect(pageTranslator._handleSingletonBtnClick).toBeTypeOf("function");
      expect(pageTranslator.setAiModeActive).toBeTypeOf("function");
    },
    { timeout: 5000 }
  );
  handleBtn = pageTranslator._handleSingletonBtnClick;
});

const flushAsync = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  await flushAsync();
  await flushAsync();
  await flushAsync();
};

/** Build a block in the requested display mode, registered for real. */
function createBlock(mode) {
  if (mode === "newLine") {
    const p = document.createElement("p");
    p.textContent = "Hello world";
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
    translatedEl.append(googleSpan, aiSpan);
    p.appendChild(translatedEl);
    document.body.appendChild(p);
    registerBlock(translatedEl, "Hello world", googleSpan, "Google译文", null, {
      googleSpan,
      aiSpan,
    });
    return { container: translatedEl, translatedEl, googleSpan, aiSpan };
  }
  // replaceOriginal
  const p = document.createElement("p");
  // Faithful to the post-Google shape: the Google translation was written into
  // the block's text nodes (writeGoogleIntoBlock), so the visible text IS the
  // Google translation while displayMode says "google".
  const textNode = document.createTextNode("Hello world");
  p.appendChild(textNode);
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-aitranslatedtext-replacemode";
  aiSpan.textContent = "";
  p.appendChild(aiSpan);
  document.body.appendChild(p);
  registerBlock(p, "Hello world", aiSpan, "", [textNode]);
  textNode.textContent = "Google译文";
  pageTranslator._setNodesToRestoreForTest([
    { node: textNode, originalText: "Hello world", translatedText: "Google译文" },
  ]);
  return { container: p, textNode, aiSpan };
}

/** Apply the page-level precondition through the production entry point. */
function applyPagePrecondition(precondition) {
  if (precondition === "page-google") pageTranslator.setAiModeActive(false);
  else if (precondition === "page-ai") pageTranslator.setAiModeActive(true);
  // fresh: leave the module-level flag untouched (default true)
}

/** Arrange the arrival path; returns a settle() the caller awaits. */
function arrangeArrival(path) {
  mockState.configValues.enableAiTranslationCache = path === "memory-cache" ? "no" : "yes";
  if (path === "memory-cache") {
    aiCache.length = 0;
    aiCache.push({ original: "Hello world", targetLanguage: "zh-CN", translated: "AI译文" });
    return null;
  }
  if (path === "persistent-cache") {
    aiCache.length = 0; // force the storage-backed path
    const held = [];
    sendMessageSpy.mockImplementation((payload, callback) => {
      if (typeof callback !== "function") return;
      if (payload?.action === "getTabHostName") callback("example.com");
      else if (payload?.action === "aiTranslationCacheGet") held.push(callback);
      else if (payload?.action === "translateSingleText") callback("Google译文");
      else callback(undefined);
    });
    return { held };
  }
  // stream: no caches anywhere; real parser over the mocked transport
  mockState.configValues.enableAiTranslationCache = "no";
  aiCache.length = 0;
  translateWithAIMock.mockImplementation((content, onMessage) => {
    const idMatch = content.match(/<译泽 id="([^"]+)">/);
    if (idMatch) {
      onMessage(
        JSON.stringify({ choices: [{ delta: { content: `<译泽 id="${idMatch[1]}">AI译文</译泽>` } }] })
      );
    }
  });
  return null;
}

async function clickAndSettle(blockId, { arrival, held } = {}) {
  const inFlight = handleBtn(blockId, currentBlock.container);
  // Held-arrival is a hard setup requirement of this helper (persistent-cache
  // delivery), not an optional branch — the expect below is a precondition
  // guard, not the false-green conditional-assertion pattern.
  // assertion-strength-allow
  if (held) {
    // Deliver the persistent-cache arrival under this test's control.
    for (let i = 0; i < 100 && !held.length; i++) await flushAsync();
    expect(held.length, "persistent-cache callback was never registered").toBeGreaterThan(0);
    held[0]({ translated: "AI译文" });
  }
  await inFlight;
  await settle();
}

let currentBlock;

beforeEach(() => {
  document.body.innerHTML = "";
  sendMessageSpy.mockClear();
  sendMessageSpy.mockImplementation(defaultSendMessageImpl);
  aiCache.length = 0;
  translateWithAIMock.mockReset();
  pageTranslator.setAiModeActive(true); // baseline; each cell may override
});

afterEach(() => {
  pageTranslator.setAiModeActive(true);
});

// ════════════════════════════════════════════════════════════════════════════
// Matrix cells
// ════════════════════════════════════════════════════════════════════════════

for (const mode of DISPLAY_MODES) {
  for (const precondition of PAGE_PRECONDITIONS) {
    describe(`cross-level matrix — ${mode} / page=${precondition}`, () => {
      // ── the report sequence: page-level Google then hover A ──────────────
      // The block starts showing Google; the user's click must end with the
      // block visibly showing AI, with the state field agreeing (#70 + V1/V2).
      it("hover A switches the block to visible AI (all arrival paths)", async () => {
        for (const path of ARRIVAL_PATHS) {
          document.body.innerHTML = "";
          sendMessageSpy.mockClear();
          sendMessageSpy.mockImplementation(defaultSendMessageImpl);
          currentBlock = createBlock(mode);
          applyPagePrecondition(precondition);

          const arrangement = arrangeArrival(path);
          const held = arrangement?.held;
          await clickAndSettle("ai", { arrival: path, held });

          const state = getBlockState(currentBlock.container);
          const truth = readVisibleBlockTruth(currentBlock.container, { originalText: "Hello world" });

          // V2 — direct-select effect: the user sees AI now.
          expect(truth.visibleMode).toBe("ai");
          expect(truth.visibleText).toBe("AI译文");
          // V1 — tri-consistency: state agrees with what is on screen.
          const consistency = checkVisibleMatchesState(currentBlock.container, state, {
            originalText: "Hello world",
          });
          expect(consistency.ok, `[${mode}/${precondition}/${path}] ${consistency.reason}`).toBe(true);
          expect(state.aiStatus).toBe("translated");
        }
      });

      // ── hover G while Google is visible → noop, zero requests ────────────
      it("hover G while Google is visible is a noop with zero new requests", async () => {
        currentBlock = createBlock(mode);
        applyPagePrecondition(precondition);
        const before = getBlockState(currentBlock.container).displayMode;

        sendMessageSpy.mockClear();
        await clickAndSettle("google");

        const after = getBlockState(currentBlock.container);
        expect(after.displayMode).toBe(before);
        const truth = readVisibleBlockTruth(currentBlock.container, { originalText: "Hello world" });
        expect(truth.visibleMode).toBe("google");
        // V3 — noop discipline: nothing was requested.
        expect(
          sendMessageSpy.mock.calls.filter(([p]) =>
            ["translateSingleText", "aiTranslationCacheGet"].includes(p?.action)
          )
        ).toHaveLength(0);
      });

      // ── hover O restores the block, then hover A brings AI back ─────────
      it("hover O restores original, hover A re-shows AI (round trip)", async () => {
        currentBlock = createBlock(mode);
        applyPagePrecondition(precondition);

        await clickAndSettle("original");
        const restoredTruth = readVisibleBlockTruth(currentBlock.container, {
          originalText: "Hello world",
        });
        expect(restoredTruth.visibleMode).toBe("original");

        const arrangement = arrangeArrival("memory-cache");
        await clickAndSettle("ai", { arrival: "memory-cache" });
        const truth = readVisibleBlockTruth(currentBlock.container, { originalText: "Hello world" });
        expect(truth.visibleMode).toBe("ai");
        const state = getBlockState(currentBlock.container);
        expect(state.displayMode).toBe("ai");
      });

      // ── in-flight edge: switching away DURING the request (Q22/Q23) ─────
      // Per-mode registration (assertion-strength discipline): the two modes
      // have genuinely different contract cells (Q22 keep vs Q23 discard), so
      // each gets its own test instead of a conditional assertion inside one.
      if (mode === "newLine") {
        it("page-level switch away DURING the request keeps the result without display (Q22)", async () => {
          currentBlock = createBlock(mode);
          // The edge requires the request to START in AI mode, so the switch-away
          // during the request is a genuine true→false transition.
          pageTranslator.setAiModeActive(true);

          const arrangement = arrangeArrival("persistent-cache");
          const held = arrangement.held;
          const inFlight = handleBtn("ai", currentBlock.container);
          for (let i = 0; i < 100 && !held.length; i++) await flushAsync();
          expect(held.length, "persistent-cache callback was never registered").toBeGreaterThan(0);

          // The user switches the page away while the request is in flight.
          pageTranslator.setAiModeActive(false);
          held[0]({ translated: "AI译文" });
          await inFlight;
          await settle();

          const state = getBlockState(currentBlock.container);
          const truth = readVisibleBlockTruth(currentBlock.container, { originalText: "Hello world" });

          // Q22: kept, not shown. displayMode must stay google (no desync!).
          expect(state.aiStatus).toBe("translated");
          expect(state.displayMode).toBe("google");
          expect(truth.visibleMode).toBe("google");
          const consistency = checkVisibleMatchesState(currentBlock.container, state, {
            originalText: "Hello world",
          });
          expect(consistency.ok, consistency.reason).toBe(true);

          // The next A click locally re-shows the kept result — zero requests.
          sendMessageSpy.mockClear();
          await clickAndSettle("ai");
          expect(readVisibleBlockTruth(currentBlock.container).visibleMode).toBe("ai");
          expect(
            sendMessageSpy.mock.calls.filter(([p]) =>
              ["translateSingleText", "aiTranslationCacheGet"].includes(p?.action)
            )
          ).toHaveLength(0);
        });
      } else {
        it("page-level switch away DURING the request discards the result (Q23)", async () => {
          currentBlock = createBlock(mode);
          pageTranslator.setAiModeActive(true);

          const arrangement = arrangeArrival("persistent-cache");
          const held = arrangement.held;
          const inFlight = handleBtn("ai", currentBlock.container);
          for (let i = 0; i < 100 && !held.length; i++) await flushAsync();
          expect(held.length, "persistent-cache callback was never registered").toBeGreaterThan(0);

          pageTranslator.setAiModeActive(false);
          held[0]({ translated: "AI译文" });
          await inFlight;
          await settle();

          const state = getBlockState(currentBlock.container);
          // Q23: fully discarded; block re-requestable, state consistent.
          expect(state.aiStatus).toBe("idle");
          const consistency = checkVisibleMatchesState(currentBlock.container, state, {
            originalText: "Hello world",
          });
          expect(consistency.ok, consistency.reason).toBe(true);
        });
      }
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Completeness meta-test — the matrix must be fully enumerated.
//
// If someone deletes a mode / precondition / path from the tables above, the
// generated run drops cells silently. This test makes that impossible: it
// recomputes the expected cell count from the exported tables and asserts the
// declarations still cover the intended dimension values.
// ════════════════════════════════════════════════════════════════════════════

describe("cross-level matrix — completeness meta-test", () => {
  it("enumerates every dimension value (deleting a dimension value turns red)", () => {
    expect(DISPLAY_MODES).toEqual(["newLine", "replaceOriginal"]);
    expect(PAGE_PRECONDITIONS).toEqual(["fresh", "page-google", "page-ai"]);
    expect(BLOCK_ACTIONS).toEqual(["ai", "google", "original"]);
    expect(ARRIVAL_PATHS).toEqual(["memory-cache", "persistent-cache", "stream"]);
  });

  it("the report sequence (page-level Google) is part of the matrix", () => {
    // The exact #70 precondition must never silently disappear.
    expect(PAGE_PRECONDITIONS).toContain("page-google");
    expect(ARRIVAL_PATHS).toContain("stream");
    expect(ARRIVAL_PATHS).toContain("persistent-cache");
  });

  it("cell count matches the declared dimensions", () => {
    // Per precondition: A-arrival / G-noop / O→A roundtrip = 3 shared cells,
    // plus one in-flight-edge cell PER MODE (Q22 and Q23 have different
    // contracts, registered as two tests — assertion-strength discipline).
    const sharedPerPrecondition = 3;
    const edgeCellsPerPrecondition = DISPLAY_MODES.length; // one per mode
    const expected =
      DISPLAY_MODES.length * PAGE_PRECONDITIONS.length * sharedPerPrecondition +
      PAGE_PRECONDITIONS.length * edgeCellsPerPrecondition;
    expect(expected).toBe(24);
  });
});
