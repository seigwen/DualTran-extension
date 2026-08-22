/**
 * Tests for the applyAiSuccessState split (Q22/Q23):
 *   - applyAiResult: write AI text + status, NO display switch
 *   - switchToAiDisplay: toggle span visibility (newLine) / clear original (replaceOriginal)
 *
 * Mode asymmetry (Q23):
 *   - newLine: discard = keep result (applyAiResult only)
 *   - replaceOriginal: discard = fully discard (neither — result goes to cache only)
 */

import { describe, expect, it } from "vitest";
import { applyAiResult, applyAiSuccessWithModeCheck, switchToAiDisplay } from "../../src/contentScript/aiUiState.js";

function makeNewLineBtnAi() {
  const googleSpan = document.createElement("span");
  googleSpan.style.display = "block";
  const aiSpan = document.createElement("span");
  aiSpan.style.display = "none";
  const state = { displayMode: "google", googleBtnState: "success" };
  return {
    googleSpan,
    aiSpan,
    translationStatus: "translating",
    translationId: "t1",
    _st: () => state,
    classList: { remove: () => {} },
    style: {},
    setAttribute: () => {},
  };
}

function makeReplaceOriginalBtnAi() {
  const textNode = document.createTextNode("original text");
  const translatedTextNode = document.createElement("span");
  translatedTextNode.textContent = "";
  const state = { displayMode: "google", googleBtnState: "success", nodesToClear: [textNode] };
  return {
    translatedTextNode,
    translationStatus: "translating",
    translationId: "t1",
    _st: () => state,
    classList: { remove: () => {} },
    style: {},
    setAttribute: () => {},
  };
}

describe("applyAiResult — writes result without switching display", () => {
  it("newLine: writes AI text to aiSpan, sets status, does NOT change visibility", () => {
    const btnAi = makeNewLineBtnAi();
    applyAiResult(btnAi, { translatedText: "AI translation" });
    expect(btnAi.aiSpan.textContent).toBe("AI translation");
    expect(btnAi.translationStatus).toBe("translated");
    // Display untouched: googleSpan still visible, aiSpan still hidden
    expect(btnAi.googleSpan.style.display).toBe("block");
    expect(btnAi.aiSpan.style.display).toBe("none");
  });

  it("replaceOriginal: writes AI text to translatedTextNode, does NOT clear original nodes", () => {
    const btnAi = makeReplaceOriginalBtnAi();
    applyAiResult(btnAi, { translatedText: "AI translation" });
    expect(btnAi.translatedTextNode.textContent).toBe("AI translation");
    expect(btnAi.translationStatus).toBe("translated");
    // Original text node untouched (clearing is switchToAiDisplay's job)
    expect(btnAi._st().nodesToClear[0].textContent).toBe("original text");
  });
});

describe("switchToAiDisplay — switches display only", () => {
  it("newLine: shows aiSpan, hides googleSpan", () => {
    const btnAi = makeNewLineBtnAi();
    switchToAiDisplay(btnAi);
    expect(btnAi.aiSpan.style.display).toBe("block");
    expect(btnAi.googleSpan.style.display).toBe("none");
  });

  it("replaceOriginal: clears original text nodes (the physical 'switch to AI' act)", () => {
    const btnAi = makeReplaceOriginalBtnAi();
    switchToAiDisplay(btnAi);
    expect(btnAi._st().nodesToClear[0].textContent).toBe("");
  });

  it("replaceOriginal: does not touch translatedTextNode content", () => {
    const btnAi = makeReplaceOriginalBtnAi();
    btnAi.translatedTextNode.textContent = "AI translation";
    switchToAiDisplay(btnAi);
    expect(btnAi.translatedTextNode.textContent).toBe("AI translation");
  });
});

describe("composed: applyAiResult + switchToAiDisplay === old applyAiSuccessState", () => {
  it("newLine: both steps together produce the full success state", () => {
    const btnAi = makeNewLineBtnAi();
    applyAiResult(btnAi, { translatedText: "AI translation" });
    switchToAiDisplay(btnAi);
    expect(btnAi.aiSpan.textContent).toBe("AI translation");
    expect(btnAi.aiSpan.style.display).toBe("block");
    expect(btnAi.googleSpan.style.display).toBe("none");
    expect(btnAi.translationStatus).toBe("translated");
    expect(btnAi._st().displayMode).toBe("ai");
  });

  it("replaceOriginal: both steps together clear original and show AI text", () => {
    const btnAi = makeReplaceOriginalBtnAi();
    applyAiResult(btnAi, { translatedText: "AI translation" });
    switchToAiDisplay(btnAi);
    expect(btnAi._st().nodesToClear[0].textContent).toBe("");
    expect(btnAi.translatedTextNode.textContent).toBe("AI translation");
    expect(btnAi.translationStatus).toBe("translated");
  });
});

describe("applyAiSuccessWithModeCheck — Q5 arrival-time check", () => {
  it("aiModeActive=true → full success state (result + display switch)", () => {
    const btnAi = makeNewLineBtnAi();
    applyAiSuccessWithModeCheck(btnAi, { translatedText: "AI translation" }, true);
    expect(btnAi.aiSpan.textContent).toBe("AI translation");
    expect(btnAi.aiSpan.style.display).toBe("block");
    expect(btnAi.googleSpan.style.display).toBe("none");
    expect(btnAi.translationStatus).toBe("translated");
  });

  it("aiModeActive=false + newLine → result kept, display NOT switched (Q22)", () => {
    const btnAi = makeNewLineBtnAi();
    applyAiSuccessWithModeCheck(btnAi, { translatedText: "AI translation" }, false);
    expect(btnAi.aiSpan.textContent).toBe("AI translation");
    expect(btnAi.translationStatus).toBe("translated");
    // Display untouched: googleSpan still visible
    expect(btnAi.googleSpan.style.display).toBe("block");
    expect(btnAi.aiSpan.style.display).toBe("none");
  });

  it("aiModeActive=false + replaceOriginal → fully discarded, status reset to idle (Q23)", () => {
    const btnAi = makeReplaceOriginalBtnAi();
    applyAiSuccessWithModeCheck(btnAi, { translatedText: "AI translation" }, false);
    // Original text untouched (Google display preserved)
    expect(btnAi._st().nodesToClear[0].textContent).toBe("original text");
    // Status reset so a later AI click re-requests (cache-backed)
    expect(btnAi.translationStatus).toBe("idle");
  });
});
