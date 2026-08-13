/**
 * Regression tests for applyShowGoogleOnlyState.
 *
 * Bug scenario (user-reported, replaceOriginal mode):
 *  1. "译文显示位置" = "用译文替换原文" (replaceOriginal)
 *  2. Click AI → Google+AI concurrent translation
 *  3. AI finishes: text nodes are CLEARED by applyAiSuccessState, AI text
 *     written into translatedTextNode
 *  4. Click Google → expect: Google translation shown again
 *  5. Actual: BOTH AI text and original text disappear (blank page section)
 *
 * Root cause: showGoogleOnly() cleared the AI translatedTextNode but did NOT
 * restore the Google translation into the text nodes (which AI had cleared).
 * The Google translation is stored in nodesToRestore[].translatedText.
 *
 * This test exercises the REAL per-block logic that pageTranslator.showGoogleOnly
 * delegates to (applyShowGoogleOnlyState in aiUiState.js) — the same seam the
 * bug occurs at.
 */

import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { applyShowGoogleOnlyState } from "../../src/contentScript/aiUiState.js";

function createReplaceOriginalBlock() {
  const dom = new JSDOM('<div><p>Original text 1</p></div>');
  const document = dom.window.document;
  const p = document.querySelector("p");

  // Text node that Google translation replaces (dontSortResults=true path)
  const textNode = document.createTextNode("Original text 1");
  p.appendChild(textNode);

  // AI translatedTextNode span (created in translateResults)
  const translatedTextNode = document.createElement("span");
  translatedTextNode.className = "dualtran-aitranslatedtext-replacemode";
  p.appendChild(translatedTextNode);

  return { document, p, textNode, translatedTextNode };
}

function createNewLineBlock() {
  const dom = new JSDOM('<div><p>Original text 1</p></div>');
  const document = dom.window.document;
  const p = document.querySelector("p");

  const translatedEl = document.createElement("translated");
  const googleSpan = document.createElement("span");
  googleSpan.className = "dualtran-google";
  googleSpan.textContent = "Google translation 1";
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-ai";
  aiSpan.textContent = "AI translation 1";
  aiSpan.style.display = "block";
  translatedEl.appendChild(googleSpan);
  translatedEl.appendChild(aiSpan);
  p.appendChild(translatedEl);

  return { document, p, translatedEl, googleSpan, aiSpan };
}

function createMockBtnAi({ nodesToClear = null, translatedTextNode = null, googleSpan = null, aiSpan = null } = {}) {
  const dom = new JSDOM("");
  const doc = dom.window.document;
  const state = {
    sourceString: "Original text 1",
    translatedTextNode: translatedTextNode || googleSpan,
    googleTranslatedText: "Google translation 1",
    nodesToClear,
    translationId: "i12345678",
    aiStatus: "translated",
    googleSpan,
    aiSpan,
  };
  return {
    _st: () => state,
    state,
    translatedTextNode: state.translatedTextNode,
    googleSpan,
    aiSpan,
    nodesToClear,
    googleTranslatedText: state.googleTranslatedText,
    get translationStatus() { return state.aiStatus; },
    set translationStatus(v) { state.aiStatus = v; },
    get translationId() { return state.translationId; },
    set translationId(v) { state.translationId = v; },
    ownerDocument: doc,
    btnAiTxtNode: doc.createElement("span"),
    tooltip: doc.createElement("span"),
    classList: { contains: () => false, add: vi.fn(), remove: vi.fn() },
    style: {},
    setAttribute: vi.fn(),
    getAttribute: () => null,
  };
}

describe("applyShowGoogleOnlyState — replaceOriginal mode", () => {
  it("restores Google translation into cleared text nodes (user-reported bug)", () => {
    const { textNode, translatedTextNode } = createReplaceOriginalBlock();

    // Simulate state after Google+AI concurrent translation:
    // - Google translated: textNode was "Google translation 1"
    // - AI started: applyAiTranslatingState cleared textNode → ""
    // - AI finished: translatedTextNode = "AI translation 1"
    const nodesToClear = [textNode];
    const nodesToRestore = [
      {
        node: textNode,
        originalText: "Original text 1",
        translatedText: "Google translation 1", // Google translation
      },
    ];

    textNode.textContent = ""; // cleared by AI
    translatedTextNode.textContent = "AI translation 1";

    const btnAi = createMockBtnAi({ nodesToClear, translatedTextNode });

    // Act: user clicks Google button → showGoogleOnly → applyShowGoogleOnlyState
    applyShowGoogleOnlyState(btnAi, nodesToRestore);

    // Assert: text node must show Google translation (NOT original, NOT empty)
    expect(textNode.textContent).toBe("Google translation 1");
    // Assert: AI translatedTextNode cleared
    expect(translatedTextNode.textContent).toBe("");
    // Assert: state reset so AI can re-translate
    expect(btnAi.state.aiStatus).toBe("idle");
    expect(btnAi.state.translationId).toBe("");
  });

  it("keeps Google translation when text node was not cleared (no-op restore)", () => {
    const { textNode, translatedTextNode } = createReplaceOriginalBlock();

    const nodesToClear = [textNode];
    const nodesToRestore = [
      { node: textNode, originalText: "Original text 1", translatedText: "Google translation 1" },
    ];

    // Text node still has Google translation (AI hadn't cleared it)
    textNode.textContent = "Google translation 1";
    translatedTextNode.textContent = "AI translation 1";

    const btnAi = createMockBtnAi({ nodesToClear, translatedTextNode });
    applyShowGoogleOnlyState(btnAi, nodesToRestore);

    expect(textNode.textContent).toBe("Google translation 1");
    expect(translatedTextNode.textContent).toBe("");
  });

  it("does not crash when nodesToRestore has no matching entry", () => {
    const { textNode, translatedTextNode } = createReplaceOriginalBlock();

    const nodesToClear = [textNode];
    textNode.textContent = "";
    translatedTextNode.textContent = "AI translation 1";

    const btnAi = createMockBtnAi({ nodesToClear, translatedTextNode });
    expect(() => applyShowGoogleOnlyState(btnAi, [])).not.toThrow();

    expect(translatedTextNode.textContent).toBe("");
    expect(btnAi.state.aiStatus).toBe("idle");
  });

  it("restores hidden parent elements in replaceOriginal mode", () => {
    const dom = new JSDOM('<div><p>Original</p></div>');
    const document = dom.window.document;
    const p = document.querySelector("p");

    const codeEl = document.createElement("code");
    codeEl.textContent = "code text";
    p.appendChild(codeEl);
    const textNode = document.createTextNode("inner");
    codeEl.appendChild(textNode);

    const translatedTextNode = document.createElement("span");
    translatedTextNode.className = "dualtran-aitranslatedtext-replacemode";
    p.appendChild(translatedTextNode);

    // Simulate AI translation hidden the parent <code>
    codeEl.style.display = "none";
    textNode.textContent = "";
    translatedTextNode.textContent = "AI translation";

    const nodesToClear = [textNode];
    const nodesToRestore = [
      { node: textNode, originalText: "inner", translatedText: "Google text" },
    ];

    const btnAi = createMockBtnAi({ nodesToClear, translatedTextNode });
    applyShowGoogleOnlyState(btnAi, nodesToRestore);

    expect(codeEl.style.display).toBe("");
    expect(textNode.textContent).toBe("Google text");
    expect(translatedTextNode.textContent).toBe("");
  });
});

describe("applyShowGoogleOnlyState — newLine mode (dual-span)", () => {
  it("shows googleSpan and hides aiSpan without touching text nodes", () => {
    const { googleSpan, aiSpan } = createNewLineBlock();

    googleSpan.style.display = "none"; // AI had hidden it
    aiSpan.style.display = "block";

    const btnAi = createMockBtnAi({ googleSpan, aiSpan, nodesToClear: null });
    applyShowGoogleOnlyState(btnAi, []);

    expect(googleSpan.style.display).toBe("block");
    expect(aiSpan.style.display).toBe("none");
    expect(btnAi.state.aiStatus).toBe("idle");
    expect(btnAi.state.translationId).toBe("");
  });
});
