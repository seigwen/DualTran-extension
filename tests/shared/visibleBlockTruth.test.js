/**
 * Visible-block-truth oracle unit tests (issue #72).
 *
 * The oracle is the L2 ("what does the user actually see") assertion layer
 * introduced after the #70 escape analysis. These cells pin the reader's
 * semantics for both display modes plus the tri-consistency invariant,
 * including the exact #70 desync shape (state says ai, user sees Google).
 */

import { describe, expect, it } from "vitest";
import { readVisibleBlockTruth, checkVisibleMatchesState } from "./visible-block-truth.mjs";

/** newLine dual-span block: <translated> with google + ai spans. */
function newLineBlock({ googleDisplay = "block", aiDisplay = "none", aiText = "AI译文" } = {}) {
  const translatedEl = document.createElement("translated");
  const googleSpan = document.createElement("span");
  googleSpan.className = "dualtran-google";
  googleSpan.textContent = "Google译文";
  googleSpan.style.display = googleDisplay;
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-ai";
  aiSpan.textContent = aiText;
  aiSpan.style.display = aiDisplay;
  translatedEl.append(googleSpan, aiSpan);
  document.body.appendChild(translatedEl);
  return { translatedEl, googleSpan, aiSpan };
}

/** replaceOriginal block: container text nodes + AI span. */
function replaceOriginalBlock({ aiText = "", originalText = "Hello world" } = {}) {
  const p = document.createElement("p");
  p.appendChild(document.createTextNode(originalText));
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-aitranslatedtext-replacemode";
  aiSpan.textContent = aiText;
  p.appendChild(aiSpan);
  document.body.appendChild(p);
  return { p, aiSpan };
}

describe("readVisibleBlockTruth — newLine", () => {
  it("google visible, ai hidden → visibleMode google, text is the Google text", () => {
    const { translatedEl } = newLineBlock();
    const truth = readVisibleBlockTruth(translatedEl);
    expect(truth.visibleMode).toBe("google");
    expect(truth.visibleText).toBe("Google译文");
    expect(truth.googleVisible).toBe(true);
    expect(truth.aiVisible).toBe(false);
  });

  it("ai visible, google hidden → visibleMode ai", () => {
    const { translatedEl } = newLineBlock({ googleDisplay: "none", aiDisplay: "block" });
    const truth = readVisibleBlockTruth(translatedEl);
    expect(truth.visibleMode).toBe("ai");
    expect(truth.visibleText).toBe("AI译文");
  });

  it("both spans hidden (restored) → original is what the user sees", () => {
    const { translatedEl } = newLineBlock({ googleDisplay: "none", aiDisplay: "none" });
    const truth = readVisibleBlockTruth(translatedEl, { originalText: "Hello world" });
    expect(truth.visibleMode).toBe("original");
    expect(truth.visibleSpans).toEqual([]);
  });

  it("hidden via a display:none container → original shows (restore mechanism)", () => {
    const { translatedEl } = newLineBlock();
    translatedEl.style.display = "none";
    const truth = readVisibleBlockTruth(translatedEl, { originalText: "Hello world" });
    expect(truth.visibleMode).toBe("original");
    expect(truth.googleVisible).toBe(false);
  });

  it("detached container → nothing visible", () => {
    const { translatedEl } = newLineBlock();
    translatedEl.remove();
    const truth = readVisibleBlockTruth(translatedEl, { originalText: "Hello world" });
    expect(truth.visibleMode).toBe("none");
  });

  it("empty ai text is never reported as visible AI", () => {
    const { translatedEl, aiSpan } = newLineBlock({ aiDisplay: "block", aiText: "" });
    aiSpan.textContent = "";
    const truth = readVisibleBlockTruth(translatedEl);
    expect(truth.visibleMode).toBe("google");
    expect(truth.aiVisible).toBe(false);
  });
});

describe("readVisibleBlockTruth — replaceOriginal", () => {
  it("original text visible, no AI text → visibleMode original", () => {
    const { p } = replaceOriginalBlock();
    const truth = readVisibleBlockTruth(p);
    expect(truth.visibleMode).toBe("original");
    expect(truth.visibleText).toBe("Hello world");
  });

  it("Google text in nodes, no AI text → visibleMode google when original supplied", () => {
    const { p } = replaceOriginalBlock({ originalText: "Google译文" });
    const truth = readVisibleBlockTruth(p, { originalText: "Hello world" });
    expect(truth.visibleMode).toBe("google");
    expect(truth.visibleText).toBe("Google译文");
    expect(truth.googleVisible).toBe(false);
  });

  it("original text in nodes with original supplied → visibleMode original", () => {
    const { p } = replaceOriginalBlock({ originalText: "Hello world" });
    const truth = readVisibleBlockTruth(p, { originalText: "Hello world" });
    expect(truth.visibleMode).toBe("original");
  });

  it("AI span carries text → visibleMode ai", () => {
    const { p } = replaceOriginalBlock({ originalText: "", aiText: "AI译文" });
    const truth = readVisibleBlockTruth(p);
    expect(truth.visibleMode).toBe("ai");
    expect(truth.visibleText).toBe("AI译文");
  });
});

describe("checkVisibleMatchesState — tri-consistency invariant", () => {
  it("#70 desync shape: state says ai while the user still sees google → FAIL", () => {
    const { translatedEl } = newLineBlock();
    const result = checkVisibleMatchesState(translatedEl, { displayMode: "ai" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/state=ai but the block visibly shows google/);
    expect(result.truth.visibleText).toBe("Google译文");
  });

  it("state ai and ai actually visible → PASS", () => {
    const { translatedEl } = newLineBlock({ googleDisplay: "none", aiDisplay: "block" });
    expect(checkVisibleMatchesState(translatedEl, { displayMode: "ai" }).ok).toBe(true);
  });

  it("state google and google visible → PASS", () => {
    const { translatedEl } = newLineBlock();
    expect(checkVisibleMatchesState(translatedEl, { displayMode: "google" }).ok).toBe(true);
  });

  it("state original and the translation hidden (restored block) → PASS", () => {
    const { translatedEl } = newLineBlock({ googleDisplay: "none", aiDisplay: "none" });
    expect(
      checkVisibleMatchesState(translatedEl, { displayMode: "original" }, { originalText: "Hello world" }).ok
    ).toBe(true);
  });

  it("state original but a translation is still visible → FAIL", () => {
    const { translatedEl } = newLineBlock();
    const result = checkVisibleMatchesState(translatedEl, { displayMode: "original" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/state=original but google translation is visible/);
  });

  it("state missing → FAIL (cannot certify)", () => {
    const { translatedEl } = newLineBlock();
    const result = checkVisibleMatchesState(translatedEl, {});
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no displayMode/);
  });

  it("replaceOriginal: state ai, AI text visible → PASS", () => {
    const { p } = replaceOriginalBlock({ originalText: "", aiText: "AI译文" });
    expect(checkVisibleMatchesState(p, { displayMode: "ai" }).ok).toBe(true);
  });

  it("replaceOriginal: state google, Google text in nodes → PASS", () => {
    const { p } = replaceOriginalBlock({ originalText: "Google译文" });
    const result = checkVisibleMatchesState(p, { displayMode: "google" }, { originalText: "Hello world" });
    expect(result.ok).toBe(true);
  });
});
