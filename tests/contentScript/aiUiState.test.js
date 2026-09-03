import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  AI_ERROR_CROSS_CLASS,
  AI_SUCCESS_CHECK_CLASS,
  ERROR_CROSS_COLOR,
  SUCCESS_CHECK_COLOR,
  applyAiErrorState,
  applyAiSuccessState,
  applyAiTranslatedTextColor,
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

describe("译文颜色规则对称性（issue #21 P1-2）", () => {
  // 规则：replaceOriginal 模式 → 译文颜色 = 原文颜色（不得应用配置颜色）
  // 实现点：applyAiTranslatedTextColor（aiUiState.js，data-dualtran-block 检测）
  // 本测试直接锁定该实现点的 replaceOriginal 跳过逻辑。

  function makeReplaceOriginalBtn() {
    const document = new JSDOM(
      '<button><span class="translated"></span></button>'
    ).window.document;
    const btn = document.querySelector("button");
    const translatedTextNode = btn.querySelector(".translated");
    btn.translatedTextNode = translatedTextNode;
    // replaceOriginal 模式：AI span 的祖先带 data-dualtran-block 属性
    const container = document.createElement("div");
    container.dataset.dualtranBlock = "true";
    container.appendChild(btn);
    document.body.appendChild(container);
    return { btn, translatedTextNode };
  }

  function makeNewLineBtn() {
    const document = new JSDOM(
      '<button><span class="translated"></span></button>'
    ).window.document;
    const btn = document.querySelector("button");
    const translatedTextNode = btn.querySelector(".translated");
    btn.translatedTextNode = translatedTextNode;
    btn.aiSpan = document.createElement("span");
    btn.aiSpan.className = "dualtran-ai";
    btn.appendChild(btn.aiSpan);
    return { btn, translatedTextNode };
  }

  it("replaceOriginal 模式：applyAiTranslatedTextColor 不得应用 AI 译文颜色（原文颜色）", () => {
    const { btn, translatedTextNode } = makeReplaceOriginalBtn();

    applyAiTranslatedTextColor(btn, "#FF0000");

    expect(translatedTextNode.style.color).toBe("");
  });

  it("newLine 模式：applyAiTranslatedTextColor 应用 AI 译文颜色到 aiSpan", () => {
    const { btn, translatedTextNode } = makeNewLineBtn();

    applyAiTranslatedTextColor(btn, "#FF0000");

    expect(btn.aiSpan.style.color).toBe("rgb(255, 0, 0)");
    // 原文节点不受影响
    expect(translatedTextNode.style.color).toBe("");
  });

  it("空颜色值：applyAiTranslatedTextColor 直接返回（不染色）", () => {
    const { btn, translatedTextNode } = makeNewLineBtn();

    applyAiTranslatedTextColor(btn, "");

    expect(btn.aiSpan.style.color).toBe("");
    expect(translatedTextNode.style.color).toBe("");
  });
});