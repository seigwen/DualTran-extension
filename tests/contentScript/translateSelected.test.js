import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const {
  configValues,
  translateWithAIMock,
  toastFactoryMock,
  showToastMock,
  sendMessageMock,
  aiCacheMock,
  abortControllersMock,
} = vi.hoisted(() => ({
  configValues: {
    targetLanguage: "fr",
    targetLanguageTextTranslation: "de",
    aiTranslatedColor: "rgb(4, 5, 6)",
  },
  translateWithAIMock: vi.fn(),
  toastFactoryMock: vi.fn(),
  showToastMock: vi.fn(),
  sendMessageMock: vi.fn(),
  aiCacheMock: [],
  abortControllersMock: [],
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: vi.fn((key, value) => {
      configValues[key] = value;
    }),
    onReady: () => new Promise(() => {}),
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    codeToLanguageNameInEnglish: (code) => ({ fr: "French", de: "German", en: "English" }[code] || code),
    otherConfigs: {},
  },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({
  default: {},
}));

vi.mock("../../src/util/detectTextLanguage.js", () => ({
  default: vi.fn(async () => ({ lang: "en" })),
}));

vi.mock("../../src/util/globalWordsCount.js", () => ({
  default: vi.fn(() => 0),
}));

vi.mock("../../src/contentScript/pageTranslator.js", () => ({
  backgroundTranslateSingleText: vi.fn(),
  pageTranslator: {},
  aiTranslateText: vi.fn(),
  aiCache: aiCacheMock,
  abortControllers: abortControllersMock,
}));

// mock-fidelity-allow: selected-text panel flows use their own transport double; page-block arrival paths (the #70 area) are pinned by matrix + hoverBtn*
vi.mock("../../src/contentScript/fetchSSE.js", () => ({
  translateWithAI: (...args) => translateWithAIMock(...args),
}));

vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({
    getProvider: () => undefined,
    listProviders: () => [],
    _updateMerged: () => {},
    _getMerged: () => [],
  }),
  BUILT_IN_PROVIDERS: [],
  mergeRegistries: () => [],
}));

vi.mock("../../src/lib/ai/providerTypes.js", () => ({
  validateProviderDefinition: () => [],
}));

vi.mock("toastify-js", () => ({
  default: (...args) => toastFactoryMock(...args),
}));

function createButton(document, options = {}) {
  const button = document.createElement("button");
  button.className = options.className || "dualtran-hide";
  button.btnAiTxtNode = document.createElement("span");
  button.tooltip = document.createElement("span");
  button.translatedTextNode = document.createElement("span");
  button.translatedTextNode.className = "dualtran-loading";
  button.sourceString = options.sourceString || "hello world";
  button.append(button.btnAiTxtNode, button.tooltip, button.translatedTextNode);
  document.body.appendChild(button);
  return button;
}

describe("translateSelected aiTranslateWord", () => {
  beforeEach(() => {
    vi.resetModules();
    translateWithAIMock.mockReset();
    toastFactoryMock.mockReset();
    showToastMock.mockReset();
    sendMessageMock.mockReset();
    aiCacheMock.length = 0;
    abortControllersMock.length = 0;
    configValues.targetLanguage = "fr";
    configValues.targetLanguageTextTranslation = "de";
    configValues.aiTranslatedColor = "rgb(4, 5, 6)";
    toastFactoryMock.mockReturnValue({
      showToast: showToastMock,
    });

    const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
      url: "https://example.com/article",
    });

    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: dom.window.navigator,
    });
    globalThis.alert = vi.fn();
    globalThis.prompt = vi.fn();
    globalThis.confirm = vi.fn(() => false);
    globalThis.chrome = {
      runtime: {
        sendMessage: sendMessageMock.mockImplementation((payload, callback) => {
          if (typeof callback === "function") {
            if (payload?.action === "getTabHostName") {
              callback("example.com");
            } else {
              callback();
            }
          }
        }),
      },
      i18n: {
        getMessage: vi.fn(() => ""),
      },
    };
  });

  const parseErrorPrefix = "AI translation error: response parsing failed:";

  it("marks the selected-text button as translationError and shows a toast on parse failure", async () => {
    translateWithAIMock.mockImplementation((content, onMessage) => {
      onMessage("{bad json");
    });

    const { aiTranslateWord } = await import("../../src/contentScript/translateSelected.js");
    const button = createButton(document, { sourceString: "selected text" });

    await aiTranslateWord([button]);

    expect(translateWithAIMock).toHaveBeenCalledOnce();
    expect(translateWithAIMock.mock.calls[0][6]).toBe("de");
    expect(button.translationStatus).toBe("translationError");
    expect(button.translatedTextNode.textContent).toContain(parseErrorPrefix);
    expect(button.tooltip.textContent).toContain(parseErrorPrefix);
  });

  it("streams selected-text AI output, then marks success without writing the aiCache", async () => {
    let streamCallbacks;
    translateWithAIMock.mockImplementation((content, onMessage, onError, onFinished) => {
      streamCallbacks = { content, onMessage, onError, onFinished };
    });

    const { aiTranslateWord } = await import("../../src/contentScript/translateSelected.js");
    const button = createButton(document, { sourceString: "hello world" });

    await aiTranslateWord([button]);

    expect(button.translationStatus).toBe("queuing");
    expect(translateWithAIMock).toHaveBeenCalledWith(
      "hello world",
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(AbortSignal),
      true,
      "de"
    );

    streamCallbacks.onMessage(
      JSON.stringify({
        choices: [{ delta: { content: "bon" }, finish_reason: null }],
      })
    );

    expect(button.translationStatus).toBe("translating");
    expect(button.translatedTextNode.textContent).toBe("bon");
    expect(button.translatedTextNode.style.color).toBe("rgb(4, 5, 6)");

    streamCallbacks.onMessage(
      JSON.stringify({
        choices: [{ delta: { content: "jour" }, finish_reason: null }],
      })
    );
    streamCallbacks.onFinished();

    expect(button.translationStatus).toBe("translated");
    expect(button.translatedTextNode.textContent).toBe("bonjour");
    expect(button.tooltip.textContent).toBe("AI translated successfully!");
    // Word-path cache decoupling (plan 33): a completed word run must NOT write
    // the shared aiCache — a dictionary-style result would otherwise be served
    // as a plain translation by the page / hover text paths.
    expect(aiCacheMock).toEqual([]);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recordNewRequestToOpenAI", result: "successful" })
    );
  });

  it("does not mark success or write cache when onFinished runs after a parse failure", async () => {
    let streamCallbacks;
    translateWithAIMock.mockImplementation((content, onMessage, onError, onFinished) => {
      streamCallbacks = { content, onMessage, onError, onFinished };
    });

    const { aiTranslateWord } = await import("../../src/contentScript/translateSelected.js");
    const button = createButton(document, { sourceString: "selected text" });

    await aiTranslateWord([button]);

    streamCallbacks.onMessage("{bad json");
    streamCallbacks.onFinished();

    expect(button.translationStatus).toBe("translationError");
    expect(button.tooltip.textContent).toContain(parseErrorPrefix);
    expect(aiCacheMock).toEqual([]);
  });

  it("short-circuits empty selected text without issuing an AI request", async () => {
    const { aiTranslateWord } = await import("../../src/contentScript/translateSelected.js");
    const button = createButton(document, { sourceString: "   " });

    await aiTranslateWord([button]);

    expect(translateWithAIMock).not.toHaveBeenCalled();
    expect(button.translationStatus).toBeUndefined();
    expect(aiCacheMock).toEqual([]);
  });

  it("ignores a matching aiCache entry — a single word always issues a live request", async () => {
    // Word-path cache decoupling (plan 33): the word path must never read the
    // shared aiCache. A cached plain translation would mask the dictionary-style
    // detail the user is asking for, so this "contaminated" entry must be ignored
    // (and, on completion, neither consumed nor modified — the pool stays as-is).
    aiCacheMock.push({
      original: "hello",
      targetLanguage: "de",
      translated: "stale cached translation",
    });

    let streamCallbacks;
    translateWithAIMock.mockImplementation((content, onMessage, onError, onFinished) => {
      streamCallbacks = { content, onMessage, onError, onFinished };
    });

    const { aiTranslateWord } = await import("../../src/contentScript/translateSelected.js");
    const button = createButton(document, { sourceString: "hello" });

    await aiTranslateWord([button]);

    expect(translateWithAIMock).toHaveBeenCalledOnce();
    expect(translateWithAIMock.mock.calls[0][0]).toBe("hello");
    expect(translateWithAIMock.mock.calls[0][6]).toBe("de");

    streamCallbacks.onMessage(
      JSON.stringify({
        choices: [{ delta: { content: "bon" }, finish_reason: null }],
      })
    );
    streamCallbacks.onMessage(
      JSON.stringify({
        choices: [{ delta: { content: "jour" }, finish_reason: null }],
      })
    );
    streamCallbacks.onFinished();

    expect(button.translationStatus).toBe("translated");
    expect(button.translatedTextNode.textContent).toBe("bonjour");
    // The pre-existing entry is untouched — nothing read, nothing written.
    expect(aiCacheMock).toEqual([
      {
        original: "hello",
        targetLanguage: "de",
        translated: "stale cached translation",
      },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────
// Plan 31 / #106: panel translation color + intent-only engine buttons
// ────────────────────────────────────────────────────────────────

function installPanelTestGlobals() {
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://example.com/article",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  globalThis.chrome = {
    runtime: { sendMessage: sendMessageMock.mockImplementation(() => {}) },
    i18n: { getMessage: vi.fn(() => "") },
  };
  return dom.window.document;
}

describe("translateSelected panel translation color (applyPanelTranslatedColor)", () => {
  beforeEach(() => {
    vi.resetModules();
    configValues.targetLanguage = "fr";
    configValues.targetLanguageTextTranslation = "de";
    configValues.translatedColor = undefined;
    configValues.aiTranslatedColor = "rgb(4, 5, 6)";
    installPanelTestGlobals();
  });

  it("applies the configured translatedColor to google arrivals", async () => {
    configValues.translatedColor = "#123456";
    const { applyPanelTranslatedColor } = await import("../../src/contentScript/translateSelected.js");
    const node = document.createElement("div");

    applyPanelTranslatedColor(node, "google");

    expect(node.style.color).toBe("rgb(18, 52, 86)");
  });

  it("applies the configured aiTranslatedColor to AI arrivals", async () => {
    configValues.aiTranslatedColor = "#654321";
    const { applyPanelTranslatedColor } = await import("../../src/contentScript/translateSelected.js");
    const node = document.createElement("div");

    applyPanelTranslatedColor(node, "ai");

    expect(node.style.color).toBe("rgb(101, 67, 33)");
  });

  it("resets before applying — an AI color never lingers on a google arrival (cross-engine leak cell)", async () => {
    configValues.translatedColor = "#123456";
    configValues.aiTranslatedColor = "#654321";
    const { applyPanelTranslatedColor } = await import("../../src/contentScript/translateSelected.js");
    const node = document.createElement("div");
    node.style.color = "#654321"; // stale AI paint, exactly as the observed leak left it

    applyPanelTranslatedColor(node, "google");

    expect(node.style.color).toBe("rgb(18, 52, 86)");
  });

  it("treats empty config values as 'no custom color' — reset only, no paint", async () => {
    configValues.translatedColor = "";
    const { applyPanelTranslatedColor } = await import("../../src/contentScript/translateSelected.js");
    const node = document.createElement("div");
    node.style.color = "#654321";

    applyPanelTranslatedColor(node, "google");

    expect(node.style.color).toBe("");
  });

  it("paints failure text with the shared error color", async () => {
    const { applyPanelTranslatedColor } = await import("../../src/contentScript/translateSelected.js");
    const node = document.createElement("div");

    applyPanelTranslatedColor(node, "error");

    expect(node.style.color).toBe("rgb(220, 38, 38)");
  });

  it("a reset-only call (no kind) clears the inline color", async () => {
    const { applyPanelTranslatedColor } = await import("../../src/contentScript/translateSelected.js");
    const node = document.createElement("div");
    node.style.color = "#654321";

    applyPanelTranslatedColor(node);

    expect(node.style.color).toBe("");
  });
});

describe("translateSelected panel intent buttons (palette + label + absorption)", () => {
  beforeEach(() => {
    vi.resetModules();
    configValues.targetLanguage = "fr";
    configValues.targetLanguageTextTranslation = "de";
    configValues.themeColor = undefined;
    configValues.aiTranslatedColor = "#654321";
    translateWithAIMock.mockReset();
    aiCacheMock.length = 0;
    abortControllersMock.length = 0;
    toastFactoryMock.mockReset();
    toastFactoryMock.mockReturnValue({
      showToast: showToastMock,
    });
    installPanelTestGlobals();
  });

  it("locks PANEL_BTN_COLORS to the floating-group palette verbatim (no drift between surfaces)", async () => {
    const { PANEL_BTN_COLORS } = await import("../../src/contentScript/translateSelected.js");
    const { BTN_COLORS } = await import("../../src/contentScript/singletonBtnGroup.js");

    // Cross-surface parity (plan 31 requirement 2): the panel palette must BE
    // the hover-group palette — drift on either side fails this cell.
    expect(PANEL_BTN_COLORS.google).toEqual(BTN_COLORS.google);
    expect(PANEL_BTN_COLORS.ai).toEqual(BTN_COLORS.ai);
    // Literal lock — the actual hex values (#65/#94 discipline).
    expect(PANEL_BTN_COLORS.google.active).toEqual({ color: "#ffffff", background: "#1d4ed8", borderColor: "#1d4ed8" });
    expect(PANEL_BTN_COLORS.google.inactive).toEqual({ color: "#1d4ed8", background: "#eff6ff", borderColor: "#bfdbfe" });
    expect(PANEL_BTN_COLORS.ai.active).toEqual({ color: "#ffffff", background: "#7c3aed", borderColor: "#7c3aed" });
    expect(PANEL_BTN_COLORS.ai.inactive).toEqual({ color: "#7c3aed", background: "#f5f3ff", borderColor: "#ddd6fe" });
  });

  it("lights the intent button and clears the other — click semantics are highlight-only", async () => {
    const { applyPanelButtonPalette } = await import("../../src/contentScript/translateSelected.js");
    const google = document.createElement("li");
    const ai = document.createElement("li");

    applyPanelButtonPalette(google, ai, "google");
    expect(google.style.color).toBe("rgb(255, 255, 255)");
    expect(google.style.background).toBe("rgb(29, 78, 216)");
    expect(google.style.borderColor).toBe("#1d4ed8");
    expect(google.classList.contains("dualtran-btn-active")).toBe(true);
    expect(ai.style.color).toBe("rgb(124, 58, 237)");
    expect(ai.style.background).toBe("rgb(245, 243, 255)");
    expect(ai.style.borderColor).toBe("#ddd6fe");
    expect(ai.classList.contains("dualtran-btn-active")).toBe(false);

    applyPanelButtonPalette(google, ai, "ai");
    expect(ai.style.color).toBe("rgb(255, 255, 255)");
    expect(ai.style.background).toBe("rgb(124, 58, 237)");
    expect(ai.style.borderColor).toBe("#7c3aed");
    expect(ai.classList.contains("dualtran-btn-active")).toBe(true);
    expect(google.style.color).toBe("rgb(29, 78, 216)");
    expect(google.style.background).toBe("rgb(239, 246, 255)");
    expect(google.style.borderColor).toBe("#bfdbfe");
    expect(google.classList.contains("dualtran-btn-active")).toBe(false);
  });

  it("createPanelAiProxy absorbs every decoration write — the visible button never changes", async () => {
    const { createPanelAiProxy } = await import("../../src/contentScript/translateSelected.js");
    const {
      applyAiTranslatingState,
      applyAiSuccessState,
      applyAiErrorState,
      renderAiErrorIndicator,
    } = await import("../../src/contentScript/aiUiState.js");

    // The visible panel button, as the panel builds it.
    const button = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = "AI";
    button.appendChild(label);
    document.body.appendChild(button);
    const translated = document.createElement("span");

    const proxy = createPanelAiProxy({ sourceString: "hello world", translatedTextNode: translated });

    // Drive the engine's UI writers over the proxy — label / tooltip /
    // classes / style / title must all land on detached dummies.
    applyAiTranslatingState(proxy, { translatedText: "bon", translatedTextColor: "#654321" });
    expect(translated.textContent).toBe("bon");

    applyAiSuccessState(proxy, {
      translatedText: "bonjour",
      translatedTextColor: "#654321",
      tooltipText: "AI translated successfully!",
      titleText: "AI translated successfully!",
    });
    expect(translated.textContent).toBe("bonjour");

    applyAiErrorState(proxy, { errorText: "AI translation error: boom", titleText: null });
    renderAiErrorIndicator(proxy);

    // Translation face passes through to the real translated-text element.
    expect(translated.textContent).toBe("AI translation error: boom");
    // Decoration face is absorbed — the visible button stayed a plain "AI".
    expect(label.textContent).toBe("AI");
    expect(label.children.length).toBe(0);
    expect(button.style.color).toBe("");
    expect(button.classList.contains("dualtran-ai-success")).toBe(false);
    expect(button.classList.contains("dualtran-ai-error")).toBe(false);
    expect(button.classList.contains("dualtran-ai-loading")).toBe(false);
    expect(button.hasAttribute("title")).toBe(false);
  });

  it("proxy classList carries the selected-panel marker (engine routing contract)", async () => {
    const { createPanelAiProxy } = await import("../../src/contentScript/translateSelected.js");
    const proxy = createPanelAiProxy({ sourceString: "x", translatedTextNode: document.createElement("span") });

    expect(proxy.classList.contains("dualtran-ai-selected-btn")).toBe(true);
    expect(proxy.classList.contains("dualtran-ai-loading")).toBe(false);
    expect(proxy.aiSpan).toBeUndefined();
    expect(typeof proxy._st).toBe("undefined");
  });

  it("word-path flow through the proxy: label stays 'AI' while the stream lands in the translated box", async () => {
    const { createPanelAiProxy, aiTranslateWord } = await import("../../src/contentScript/translateSelected.js");

    const button = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = "AI";
    button.appendChild(label);
    document.body.appendChild(button);
    const translated = document.createElement("span");

    const proxy = createPanelAiProxy({ sourceString: "hello world", translatedTextNode: translated });

    let streamCallbacks;
    translateWithAIMock.mockImplementation((content, onMessage, onError, onFinished) => {
      streamCallbacks = { content, onMessage, onError, onFinished };
    });

    await aiTranslateWord([proxy]);
    expect(label.textContent).toBe("AI"); // "queuing" label write absorbed

    streamCallbacks.onMessage(
      JSON.stringify({ choices: [{ delta: { content: "bon" }, finish_reason: null }] })
    );
    expect(label.textContent).toBe("AI"); // "translating..." label write absorbed
    expect(translated.textContent).toBe("bon"); // streamed text lands in the translated box

    streamCallbacks.onFinished();
    expect(label.textContent).toBe("AI");
    expect(button.style.color).toBe(""); // "darkgreen" button-color write absorbed
    expect(translated.style.color).toBe("rgb(101, 67, 33)"); // configured AI color on the box
  });

  it("word-path failure paints the box text with the error color and keeps the label", async () => {
    const { createPanelAiProxy, aiTranslateWord } = await import("../../src/contentScript/translateSelected.js");

    const button = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = "AI";
    button.appendChild(label);
    document.body.appendChild(button);
    const translated = document.createElement("span");

    const proxy = createPanelAiProxy({ sourceString: "hello world", translatedTextNode: translated });

    let streamCallbacks;
    translateWithAIMock.mockImplementation((content, onMessage, onError, onFinished) => {
      streamCallbacks = { content, onMessage, onError, onFinished };
    });

    await aiTranslateWord([proxy]);
    streamCallbacks.onError({ error: { message: "boom" } });

    expect(translated.textContent).toContain("AI translation error");
    expect(translated.style.color).toBe("rgb(220, 38, 38)");
    expect(label.textContent).toBe("AI");
    expect(label.children.length).toBe(0);
    expect(button.style.color).toBe("");
  });
});

// ── Implementation-point map (plan 33 word-path cache decoupling) ──
// aiTranslateWord (translateSelected.js) — the word path never reads aiCache
//   (the "ignores a matching aiCache entry" cell drives a live request despite a
//   matching entry) and never writes it (the "marks success without writing the
//   aiCache" cell asserts the pool stays empty after a completed run).
// aiCache (pageTranslator.js) — the shared in-page cache: the word path's
//   completed run leaves it byte-identical (both cells assert the pool state).
