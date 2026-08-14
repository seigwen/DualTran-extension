import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  AI_ERROR_CROSS_CLASS,
  AI_SUCCESS_CHECK_CLASS,
  ERROR_CROSS_COLOR,
  SUCCESS_CHECK_COLOR,
  applyAiErrorState,
  applyAiSuccessState,
  applyAiTranslatingState,
  applyGoogleIdle,
  applyGoogleSuccess,
  applyGoogleTranslating,
  formatAiTranslationError,
  renderAiErrorIndicator,
  renderAiSuccessIndicator,
  resetBlockState,
} from "../../src/contentScript/aiUiState.js";

function createButton() {
  const document = new JSDOM('<button class="dualtran-hide"><span class="label"></span><span class="tooltip"></span><span class="translated dualtran-loading"></span></button>').window.document;
  const button = document.querySelector("button");
  button.btnAiTxtNode = button.querySelector(".label");
  button.tooltip = button.querySelector(".tooltip");
  button.translatedTextNode = button.querySelector(".translated");
  return button;
}

describe("aiUiState", () => {
  it("renders a success indicator with the shared class and color", () => {
    const button = createButton();

    renderAiSuccessIndicator(button);

    expect(button.btnAiTxtNode.textContent).toContain("AI");
    const indicator = button.btnAiTxtNode.querySelector("span");
    expect(indicator).not.toBeNull();
    expect(indicator.className).toBe(AI_SUCCESS_CHECK_CLASS);
    expect(indicator.style.color).toBe("rgb(22, 163, 74)");
  });

  it("renders an error indicator with the shared class and color", () => {
    const button = createButton();

    renderAiErrorIndicator(button);

    const indicator = button.btnAiTxtNode.querySelector("span");
    expect(indicator).not.toBeNull();
    expect(indicator.className).toBe(AI_ERROR_CROSS_CLASS);
    expect(indicator.style.color).toBe("rgb(220, 38, 38)");
  });

  it("formats timeout, structured, and unknown AI errors consistently", () => {
    expect(formatAiTranslationError({ error: { type: "timeout" } })).toBe(
      "AI translation error: server response timeout"
    );
    expect(formatAiTranslationError({ error: { code: 429, message: "Rate limit" } })).toBe(
      "AI translation error: 429 - Rate limit"
    );
    expect(formatAiTranslationError({ error: { message: "Only message" } })).toBe(
      "AI translation error: Only message"
    );
    expect(formatAiTranslationError({ error: { foo: "bar" } })).toBe(
      'AI translation error: {"foo":"bar"}'
    );
    expect(formatAiTranslationError(null)).toBe("AI translation error: unknown error");
  });

  it("applies translating state to the button and translated text node", () => {
    const button = createButton();

    applyAiTranslatingState(button, {
      translatedText: "bonjour",
    });

    expect(button.translationStatus).toBe("translating");
    expect(button.translatedTextNode.textContent).toBe("bonjour");
    expect(button.translatedTextNode.classList.contains("dualtran-loading")).toBe(false);
    expect(button.btnAiTxtNode.textContent).toBe("translating...");
    expect(button.tooltip.textContent).toBe("translating...");
  });

  it("applies success state and updates tooltip/title consistently", () => {
    const button = createButton();

    applyAiSuccessState(button, {
      translatedText: "salut",
      tooltipText: "AI translated successfully!",
      titleText: "AI translated successfully!",
    });

    expect(button.translationStatus).toBe("translated");
    expect(button.classList.contains("dualtran-hide")).toBe(false);
    expect(button.translatedTextNode.textContent).toBe("salut");
    expect(button.tooltip.textContent).toBe("AI translated successfully!");
    expect(button.getAttribute("title")).toBe("AI translated successfully!");
    expect(button.btnAiTxtNode.querySelector("span")?.className).toBe(AI_SUCCESS_CHECK_CLASS);
  });

  it("applies error state and can skip title while updating translated text", () => {
    const button = createButton();

    applyAiErrorState(button, {
      errorText: "AI translation error: rate limited",
      titleText: null,
    });

    expect(button.translationStatus).toBe("translationError");
    expect(button.classList.contains("dualtran-hide")).toBe(false);
    expect(button.translatedTextNode.textContent).toBe("AI translation error: rate limited");
    expect(button.tooltip.textContent).toBe("AI translation error: rate limited");
    expect(button.getAttribute("title")).toBe(null);
    expect(button.btnAiTxtNode.querySelector("span")?.className).toBe(AI_ERROR_CROSS_CLASS);
  });
});

describe("block state transitions (pure functions)", () => {
  it("resetBlockState resets displayMode, googleBtnState, aiStatus, translationId", () => {
    const state = {
      displayMode: "ai",
      googleBtnState: "success",
      aiStatus: "success",
      translationId: "abc123",
    };

    resetBlockState(state);

    expect(state.displayMode).toBe("original");
    expect(state.googleBtnState).toBe("idle");
    expect(state.aiStatus).toBe("userPinned");
    expect(state.translationId).toBe("");
  });

  it("resetBlockState is idempotent — resetting an already-original block is a no-op", () => {
    const state = {
      displayMode: "original",
      googleBtnState: "idle",
      aiStatus: "userPinned",
      translationId: "",
    };

    resetBlockState(state);

    expect(state.displayMode).toBe("original");
    expect(state.googleBtnState).toBe("idle");
    expect(state.aiStatus).toBe("userPinned");
    expect(state.translationId).toBe("");
  });

  it("applyGoogleSuccess sets displayMode and googleBtnState", () => {
    const state = {
      displayMode: "original",
      googleBtnState: "idle",
    };

    applyGoogleSuccess(state);

    expect(state.displayMode).toBe("google");
    expect(state.googleBtnState).toBe("success");
  });

  it("applyGoogleSuccess works when called from translating state", () => {
    const state = {
      displayMode: "original",
      googleBtnState: "translating",
    };

    applyGoogleSuccess(state);

    expect(state.displayMode).toBe("google");
    expect(state.googleBtnState).toBe("success");
  });

  it("applyGoogleTranslating sets googleBtnState to translating", () => {
    const state = {
      displayMode: "original",
      googleBtnState: "idle",
    };

    applyGoogleTranslating(state);

    expect(state.googleBtnState).toBe("translating");
    // displayMode should NOT change
    expect(state.displayMode).toBe("original");
  });

  it("applyGoogleIdle sets googleBtnState to idle without changing displayMode", () => {
    const state = {
      displayMode: "google",
      googleBtnState: "translating",
    };

    applyGoogleIdle(state);

    expect(state.googleBtnState).toBe("idle");
    // displayMode should NOT change
    expect(state.displayMode).toBe("google");
  });
});