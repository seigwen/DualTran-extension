import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  configValues,
  configChangeCallbacks,
  platformState,
  pageTranslatorCallbacks,
  backgroundTranslateSingleTextMock,
  aiTranslateTextMock,
  aiTranslateWordMock,
  wordsCountMock,
  toastFactoryMock,
  showToastMock,
  pageTranslatorMock,
  setTargetLanguageTextTranslationMock,
} = vi.hoisted(() => ({
  configValues: {
    textTranslatorService: "google",
    targetLanguages: ["en", "es", "de"],
    targetLanguageTextTranslation: "de",
    sitesToTranslateWhenHovering: ["example.com"],
    langsToTranslateWhenHovering: [],
    translateTextOverMouseWhenPressTwice: "no",
    translateTag_pre: "no",
    darkMode: "no",
    translatedColor: undefined,
    aiTranslatedColor: undefined,
  },
  configChangeCallbacks: [],
  platformState: {
    isMobile: false,
  },
  pageTranslatorCallbacks: {
    onGetOriginalTabLanguage: [],
    onPageLanguageStateChange: [],
  },
  backgroundTranslateSingleTextMock: vi.fn(),
  aiTranslateTextMock: vi.fn(),
  aiTranslateWordMock: vi.fn(),
  wordsCountMock: vi.fn(() => 5),
  toastFactoryMock: vi.fn(),
  showToastMock: vi.fn(),
  pageTranslatorMock: {
    translatePage: vi.fn(),
    restorePage: vi.fn(),
    onPageLanguageStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageLanguageStateChange.push(callback);
    }),
    onGetOriginalTabLanguage: vi.fn((callback) => {
      pageTranslatorCallbacks.onGetOriginalTabLanguage.push(callback);
    }),
  },
  setTargetLanguageTextTranslationMock: vi.fn((value) => {
    configValues.targetLanguageTextTranslation = value;
  }),
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: vi.fn((key, value) => {
      configValues[key] = value;
    }),
    setTargetLanguageTextTranslation: setTargetLanguageTextTranslationMock,
    onReady: vi.fn((callback) => {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }),
    onChanged: vi.fn((callback) => {
      configChangeCallbacks.push(callback);
    }),
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: (lang) => lang,
    codeToLanguage: (lang) => ({ en: "English", es: "Spanish", de: "German", fr: "French", it: "Italian", pt: "Portuguese" }[lang] || lang),
    isRtlLanguage: (lang) => ["ar", "he"].includes(lang),
    getLanguageList: () => ({ en: "English", es: "Spanish", de: "German", fr: "French", it: "Italian", pt: "Portuguese" }),
  },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({
  default: {
    isMobile: {
      get any() {
        return platformState.isMobile;
      },
    },
  },
}));

vi.mock("../../src/contentScript/pageTranslator.js", () => ({
  pageTranslator: pageTranslatorMock,
  backgroundTranslateSingleText: (...args) => backgroundTranslateSingleTextMock(...args),
  aiTranslateText: (...args) => aiTranslateTextMock(...args),
}));

// Plan 37 / Q-H1: the hover panel routes single-word AI runs through the
// selection panel's word path. Mocked here so both routes are observable.
vi.mock("../../src/contentScript/translateSelected.js", () => ({
  aiTranslateWord: (...args) => aiTranslateWordMock(...args),
}));

vi.mock("../../src/util/globalWordsCount.js", () => ({
  default: (...args) => wordsCountMock(...args),
  wordsCount: (...args) => wordsCountMock(...args),
}));

vi.mock("toastify-js", () => ({
  default: (...args) => toastFactoryMock(...args),
}));

function emitConfigChange(name, value) {
  configValues[name] = value;
  configChangeCallbacks.forEach((callback) => callback(name, value));
}

function emitPageLanguageStateChange(value) {
  pageTranslatorCallbacks.onPageLanguageStateChange.forEach((callback) => callback(value));
}

function emitOriginalTabLanguage(value) {
  pageTranslatorCallbacks.onGetOriginalTabLanguage.forEach((callback) => callback(value));
}

async function flushMicrotasks(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("showTranslated", () => {
  let attachShadowSpy;
  let windowAddEventListenerSpy;
  let documentAddEventListenerSpy;
  let windowListeners;
  let documentListeners;
  let originalWindowAddEventListener;
  let originalWindowRemoveEventListener;
  let originalDocumentAddEventListener;
  let originalDocumentRemoveEventListener;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    pageTranslatorCallbacks.onGetOriginalTabLanguage.length = 0;
    pageTranslatorCallbacks.onPageLanguageStateChange.length = 0;
    platformState.isMobile = false;

    configValues.textTranslatorService = "google";
    configValues.targetLanguages = ["en", "es", "de"];
    configValues.targetLanguageTextTranslation = "de";
    configValues.sitesToTranslateWhenHovering = ["example.com"];
    configValues.langsToTranslateWhenHovering = [];
    configValues.translateTextOverMouseWhenPressTwice = "no";
    configValues.translateTag_pre = "no";
    configValues.darkMode = "no";
    configValues.translatedColor = undefined;
    configValues.aiTranslatedColor = undefined;

    backgroundTranslateSingleTextMock.mockReset();
    backgroundTranslateSingleTextMock.mockResolvedValue("translated result");
    aiTranslateTextMock.mockReset();
    aiTranslateWordMock.mockReset();
    wordsCountMock.mockReset();
    wordsCountMock.mockReturnValue(5);
    toastFactoryMock.mockReset();
    showToastMock.mockReset();
    toastFactoryMock.mockReturnValue({ showToast: showToastMock });
    setTargetLanguageTextTranslationMock.mockClear();
    pageTranslatorMock.translatePage.mockReset();
    pageTranslatorMock.restorePage.mockReset();
    pageTranslatorMock.onPageLanguageStateChange.mockClear();
    pageTranslatorMock.onGetOriginalTabLanguage.mockClear();

    document.body.innerHTML = "";
    document.head.innerHTML = "";

    windowListeners = [];
    documentListeners = [];
    originalWindowAddEventListener = window.addEventListener.bind(window);
    originalWindowRemoveEventListener = window.removeEventListener.bind(window);
    originalDocumentAddEventListener = document.addEventListener.bind(document);
    originalDocumentRemoveEventListener = document.removeEventListener.bind(document);

    attachShadowSpy = vi
      .spyOn(HTMLElement.prototype, "attachShadow")
      .mockImplementation(function attachShadow(init) {
        return Element.prototype.attachShadow.call(this, { ...init, mode: "open" });
      });

    windowAddEventListenerSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, listener, options) => {
        windowListeners.push([type, listener, options]);
        return originalWindowAddEventListener(type, listener, options);
      });
    documentAddEventListenerSpy = vi
      .spyOn(document, "addEventListener")
      .mockImplementation((type, listener, options) => {
        documentListeners.push([type, listener, options]);
        return originalDocumentAddEventListener(type, listener, options);
      });

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn((payload, callback) => {
          if (typeof callback === "function") {
            if (payload?.action === "getTabHostName") {
              callback("example.com");
            } else {
              callback();
            }
          }
        }),
        getURL: vi.fn((path) => path),
      },
      i18n: {
        getMessage: vi.fn((key) => key),
        translateDocument: vi.fn(),
      },
    };

    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        text: () => Promise.resolve("#eDivResult { color: black; }"),
      })
    );
    globalThis.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    window.isTranslatingSelected = false;
  });

  afterEach(() => {
    windowListeners.forEach(([type, listener, options]) => {
      originalWindowRemoveEventListener(type, listener, options);
    });
    documentListeners.forEach(([type, listener, options]) => {
      originalDocumentRemoveEventListener(type, listener, options);
    });
    vi.restoreAllMocks(); // restore prototype-level mocks (e.g. HTMLElement.prototype.attachShadow)
    vi.useRealTimers();
  });

  async function loadModule() {
    const module = await import("../../src/contentScript/showTranslated.js");
    await flushMicrotasks();
    return module.default;
  }

  function getOverlayHost() {
    return document.body.querySelector("div.notranslate");
  }

  function shadowRootOrFail() {
    const host = getOverlayHost();
    if (!host || !host.shadowRoot) {
      throw new Error("hover panel host is not in the document");
    }
    return host.shadowRoot;
  }

  async function openTooltip(target) {
    target.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 60,
        clientY: 70,
      })
    );
    await vi.advanceTimersByTimeAsync(1250);
    await flushMicrotasks();
    return getOverlayHost();
  }

  function createHoverTarget(value = "Hello world") {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    document.body.appendChild(input);
    return input;
  }

  it("imports and exports the showTranslated object", async () => {
    const showTranslated = await loadModule();
    // The API is filled asynchronously inside the twpConfig.onReady callback,
    // so assert module load only; the object must be non-null.
    expect(showTranslated).toBeTypeOf("object");
    expect(showTranslated).not.toBeNull();
  });

  it("returns early on mobile without hover listeners", async () => {
    platformState.isMobile = true;
    await loadModule();

    expect(windowAddEventListenerSpy).not.toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(windowAddEventListenerSpy).not.toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(pageTranslatorMock.onPageLanguageStateChange).not.toHaveBeenCalled();
  });

  it("updates translator service and target language from config changes", async () => {
    await loadModule();
    emitConfigChange("textTranslatorService", "deepl");
    emitConfigChange("targetLanguageTextTranslation", "it");

    const input = createHoverTarget("Hello world");

    await openTooltip(input);

    expect(backgroundTranslateSingleTextMock).toHaveBeenCalledWith(
      "google",
      "it",
      "Hello world"
    );
  });

  it("updates target language buttons from config changes on the next tooltip", async () => {
    await loadModule();

    const input = createHoverTarget("Hello world");

    await openTooltip(input);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushMicrotasks();

    emitConfigChange("targetLanguages", ["fr", "it", "pt"]);

    const secondInput = createHoverTarget("Hello world again");

    await openTooltip(secondInput);

    const buttons = [...getOverlayHost().shadowRoot.querySelectorAll("#setTargetLanguage li")].slice(0, 3);
    // Plan 37 / Q2: buttons show language display names, same as the selection panel.
    expect(buttons.map((button) => button.textContent)).toEqual(["French", "Italian", "Portuguese"]);
    expect(buttons.map((button) => button.getAttribute("title"))).toEqual([
      "French",
      "Italian",
      "Portuguese",
    ]);
  });

  it("updates translateTag_pre handling when the config changes", async () => {
    await loadModule();
    backgroundTranslateSingleTextMock.mockClear();

    const container = document.createElement("div");
    const pre = document.createElement("pre");
    pre.textContent = "code sample";
    container.appendChild(pre);
    Object.defineProperty(container, "innerText", {
      configurable: true,
      value: "code sample",
    });
    document.body.appendChild(container);

    await openTooltip(container);
    expect(backgroundTranslateSingleTextMock).toHaveBeenCalledOnce();

    backgroundTranslateSingleTextMock.mockClear();
    emitConfigChange("translateTag_pre", "yes");

    await openTooltip(container);
    expect(backgroundTranslateSingleTextMock).not.toHaveBeenCalled();
  });

  it("registers mousemove and mousedown listeners when hover translation is enabled", async () => {
    await loadModule();

    expect(windowAddEventListenerSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(windowAddEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
  });

  it("destroys the tooltip when clicking outside of it", async () => {
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);
    expect(getOverlayHost()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushMicrotasks();

    expect(getOverlayHost()).toBeNull();
  });

  it("calls backgroundTranslateSingleText with the active service and language", async () => {
    await loadModule();
    const input = createHoverTarget("Translate me");

    await openTooltip(input);

    expect(backgroundTranslateSingleTextMock).toHaveBeenCalledWith(
      "google",
      "de",
      "Translate me"
    );
  });

  it("target language buttons set the language and retranslate with the active engine", async () => {
    await loadModule();
    const input = createHoverTarget("Click me");

    await openTooltip(input);
    const shadowRoot = getOverlayHost().shadowRoot;

    // Default intent = google: a language click retranslates via google.
    shadowRoot.querySelector('#setTargetLanguage li[value="es"]').click();
    await flushMicrotasks();
    expect(setTargetLanguageTextTranslationMock).toHaveBeenCalledWith("es");
    expect(backgroundTranslateSingleTextMock).toHaveBeenLastCalledWith(
      "google",
      "es",
      "Click me"
    );

    // AI intent active: a language click retranslates through the AI path
    // (same routing as the selection panel's translateNewInput).
    shadowRoot.getElementById("sOpenAI").click();
    await flushMicrotasks();
    expect(aiTranslateTextMock).toHaveBeenCalledTimes(1);

    shadowRoot.querySelector('#setTargetLanguage li[value="de"]').click();
    await flushMicrotasks();
    expect(setTargetLanguageTextTranslationMock).toHaveBeenCalledWith("de");
    expect(aiTranslateTextMock).toHaveBeenCalledTimes(2);

    // The Google button switches intent back and retranslates via google.
    shadowRoot.getElementById("sGoogle").click();
    await flushMicrotasks();
    expect(backgroundTranslateSingleTextMock).toHaveBeenLastCalledWith(
      "google",
      "de",
      "Click me"
    );
  });

  it("adds dark mode styles when darkMode is yes", async () => {
    configValues.darkMode = "yes";
    await loadModule();
    const input = createHoverTarget("Dark mode");

    await openTooltip(input);

    // Plan 37: the dark scheme ships through the shared backdropFilterElement
    // contract with the panelShared constants (same as the selection panel).
    const el = getOverlayHost().shadowRoot.getElementById("backdropFilterElement");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("rgba(40, 40, 40, 0.92)");
  });

  it("applies the light scheme block when darkMode is no", async () => {
    configValues.darkMode = "no";
    await loadModule();
    const input = createHoverTarget("Light mode");

    await openTooltip(input);

    const el = getOverlayHost().shadowRoot.getElementById("backdropFilterElement");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("rgba(248, 248, 248, 0.98)");
  });

  it("honors automatic dark mode and page state callbacks", async () => {
    configValues.darkMode = "auto";
    configValues.sitesToTranslateWhenHovering = [];
    globalThis.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    await loadModule();
    emitOriginalTabLanguage("fr");
    emitPageLanguageStateChange("translated");

    const input = createHoverTarget("Auto dark");

    input.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 70 })
    );
    await vi.advanceTimersByTimeAsync(1250);
    await flushMicrotasks();
    expect(getOverlayHost()).toBeNull();

    emitPageLanguageStateChange("original");
    emitConfigChange("langsToTranslateWhenHovering", ["fr"]);
    await openTooltip(input);

    const el = getOverlayHost().shadowRoot.getElementById("backdropFilterElement");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("rgba(40, 40, 40, 0.92)");
  });

  // ──────────────────────────────────────────────────────────────────────
  // Plan 37: hover panel alignment with the selection panel (skin + states)
  // ──────────────────────────────────────────────────────────────────────

  it("renders the aligned panel template: title bar, copy button, '+' dropdown", async () => {
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);

    const shadowRoot = shadowRootOrFail();
    expect(shadowRoot.getElementById("drag").textContent.trim()).toBe("DualTran");
    expect(shadowRoot.getElementById("transTextContainer")).not.toBeNull();
    expect(shadowRoot.getElementById("eSelTextTrans")).not.toBeNull();
    expect(shadowRoot.getElementById("listenTranslated")).not.toBeNull();
    expect(shadowRoot.getElementById("copy")).not.toBeNull();
    expect(shadowRoot.getElementById("btnMoreTargetLang")).not.toBeNull();
    expect(shadowRoot.getElementById("selectMoreTargetLang")).not.toBeNull();
    // The old id vocabulary is gone (renamed to the shared panel vocabulary).
    expect(shadowRoot.getElementById("eTextTranslated")).toBeNull();
    expect(shadowRoot.getElementById("listen")).toBeNull();
  });

  it("shows the panel with the shared loading surface the moment translation starts", async () => {
    // Never-resolving request: the panel must already be visible while it waits.
    backgroundTranslateSingleTextMock.mockImplementation(() => new Promise(() => {}));
    const { setPanelTranslationLoadingState, clearPanelTranslationLoadingState } =
      await import("../../src/contentScript/panelShared.js");
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);

    const shadowRoot = shadowRootOrFail();
    const trans = shadowRoot.getElementById("eSelTextTrans");
    expect(trans.classList.contains("dualtran-loading")).toBe(true);
    expect(trans.querySelector(".dualtran-loading-spinner")).not.toBeNull();
    expect(trans.querySelector(".dualtran-loading-label")).not.toBeNull();

    // Structural single-source: the panel's loading markup is byte-identical to
    // what the shared renderer produces on a scratch node (same classes, same
    // structure) — and clearing restores the empty state.
    const scratch = document.createElement("div");
    setPanelTranslationLoadingState(scratch);
    expect(scratch.classList.contains("dualtran-loading")).toBe(true);
    expect(scratch.children.length).toBe(trans.children.length);
    expect(scratch.children[0].className).toBe("dualtran-loading-spinner");
    expect(scratch.children[1].className).toBe("dualtran-loading-label");
    clearPanelTranslationLoadingState(scratch);
    expect(scratch.classList.contains("dualtran-loading")).toBe(false);
    expect(scratch.innerHTML).toBe("");
  });

  it("paints the Google arrival with the configured translatedColor", async () => {
    configValues.translatedColor = "#123456";
    backgroundTranslateSingleTextMock.mockResolvedValue("translated result");
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);

    const trans = shadowRootOrFail().getElementById("eSelTextTrans");
    expect(trans.textContent).toBe("translated result");
    expect(trans.style.color).toBe("rgb(18, 52, 86)");
  });

  it("applies the shared intent palette to the engine buttons", async () => {
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);

    const shadowRoot = shadowRootOrFail();
    const google = shadowRoot.getElementById("sGoogle");
    const ai = shadowRoot.getElementById("sOpenAI");
    expect(google.style.background).toBe("rgb(29, 78, 216)");
    expect(google.classList.contains("dualtran-btn-active")).toBe(true);
    expect(ai.style.background).toBe("rgb(245, 243, 255)");
    expect(ai.classList.contains("dualtran-btn-active")).toBe(false);

    ai.click();
    await flushMicrotasks();

    expect(ai.style.background).toBe("rgb(124, 58, 237)");
    expect(ai.classList.contains("dualtran-btn-active")).toBe(true);
    expect(google.style.background).toBe("rgb(239, 246, 255)");
    expect(google.classList.contains("dualtran-btn-active")).toBe(false);
  });

  it("keeps the AI label constant with zero decoration through the whole run", async () => {
    const aiUi = await import("../../src/contentScript/aiUiState.js");
    aiTranslateTextMock.mockImplementation(async ([proxy]) => {
      aiUi.applyAiTranslatingState(proxy, { translatedText: "bon", translatedTextColor: "#654321" });
      aiUi.applyAiSuccessState(proxy, {
        translatedText: "bonjour",
        translatedTextColor: "#654321",
        titleText: "AI translated successfully!",
      });
    });
    configValues.aiTranslatedColor = "#654321";
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);
    const shadowRoot = shadowRootOrFail();
    const ai = shadowRoot.getElementById("sOpenAI");
    const label = shadowRoot.getElementById("btnAiTxtNode");

    ai.click();
    await flushMicrotasks();

    expect(aiTranslateTextMock).toHaveBeenCalledOnce();
    const proxy = aiTranslateTextMock.mock.calls[0][0][0];
    expect(proxy.classList.contains("dualtran-ai-selected-btn")).toBe(true);
    expect(proxy.translatedTextNode).toBe(shadowRoot.getElementById("eSelTextTrans"));

    // Decoration absorbed: the visible button stays a plain "AI" with the
    // intent palette colors and no state spans.
    expect(label.textContent).toBe("AI");
    expect(label.children.length).toBe(0);
    expect(ai.classList.contains("dualtran-ai-success")).toBe(false);
    expect(ai.classList.contains("dualtran-ai-error")).toBe(false);
    expect(ai.classList.contains("dualtran-ai-loading")).toBe(false);
    expect(ai.style.background).toBe("rgb(124, 58, 237)");
    // Translation face passes through.
    expect(shadowRoot.getElementById("eSelTextTrans").textContent).toBe("bonjour");
    expect(shadowRoot.getElementById("eSelTextTrans").style.color).toBe("rgb(101, 67, 33)");
  });

  it("renders AI failures inside the box with the error color and a toast", async () => {
    const aiUi = await import("../../src/contentScript/aiUiState.js");
    aiTranslateTextMock.mockImplementation(async ([proxy]) => {
      aiUi.applyAiErrorState(proxy, { errorText: "AI translation error: boom", titleText: null });
    });
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);
    const shadowRoot = shadowRootOrFail();

    shadowRoot.getElementById("sOpenAI").click();
    await flushMicrotasks();

    const trans = shadowRoot.getElementById("eSelTextTrans");
    expect(trans.textContent).toBe("AI translation error: boom");
    expect(trans.style.color).toBe("rgb(220, 38, 38)");
    expect(getOverlayHost()).not.toBeNull();
  });

  it("keeps the panel alive on Google failure, with the error text in the box", async () => {
    backgroundTranslateSingleTextMock.mockRejectedValue(new Error("boom"));
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);

    const shadowRoot = shadowRootOrFail();
    const trans = shadowRoot.getElementById("eSelTextTrans");
    expect(trans.textContent).toBe("errorTranslationFailed");
    expect(trans.style.color).toBe("rgb(220, 38, 38)");
    expect(showToastMock).toHaveBeenCalledOnce();
  });

  it("keeps the panel alive on Google timeout, with the timeout text in the box", async () => {
    backgroundTranslateSingleTextMock.mockImplementation(() => new Promise(() => {}));
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);
    await vi.advanceTimersByTimeAsync(10000);
    await flushMicrotasks();

    const shadowRoot = shadowRootOrFail();
    const trans = shadowRoot.getElementById("eSelTextTrans");
    expect(trans.textContent).toBe("errorTranslationTimeout");
    expect(trans.style.color).toBe("rgb(220, 38, 38)");
  });

  it("repaints the translated color on engine switches (no cross-engine leak)", async () => {
    const aiUi = await import("../../src/contentScript/aiUiState.js");
    configValues.translatedColor = "#123456";
    configValues.aiTranslatedColor = "#654321";
    aiTranslateTextMock.mockImplementation(async ([proxy]) => {
      aiUi.applyAiSuccessState(proxy, { translatedText: "bonjour", translatedTextColor: "#654321" });
    });
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);
    const shadowRoot = shadowRootOrFail();
    const trans = shadowRoot.getElementById("eSelTextTrans");
    expect(trans.style.color).toBe("rgb(18, 52, 86)");

    shadowRoot.getElementById("sOpenAI").click();
    await flushMicrotasks();
    expect(trans.style.color).toBe("rgb(101, 67, 33)");

    shadowRoot.getElementById("sGoogle").click();
    await flushMicrotasks();
    expect(trans.style.color).toBe("rgb(18, 52, 86)");
    expect(trans.textContent).toBe("translated result");
  });

  it("copies the translation on click with a green flash", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);
    const shadowRoot = shadowRootOrFail();
    const copy = shadowRoot.getElementById("copy");

    copy.click();
    await flushMicrotasks();

    expect(writeText).toHaveBeenCalledWith("translated result");
    expect(copy.style.backgroundColor).toBe("rgba(0, 255, 0, 0.4)");
  });

  it("promotes a language picked from the '+' dropdown and retranslates", async () => {
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);
    const shadowRoot = shadowRootOrFail();
    const selectMore = shadowRoot.getElementById("selectMoreTargetLang");

    selectMore.value = "it";
    selectMore.dispatchEvent(new Event("change"));
    await flushMicrotasks();

    expect(configValues.targetLanguages).toEqual(["it", "en", "es"]);
    expect(setTargetLanguageTextTranslationMock).toHaveBeenCalledWith("it");
    expect(backgroundTranslateSingleTextMock).toHaveBeenLastCalledWith(
      "google",
      "it",
      "Hello world"
    );
    expect(selectMore.style.display).toBe("none");
  });

  it("shares the dark-mode CSS constants from panelShared", async () => {
    configValues.darkMode = "yes";
    const { PANEL_DARK_MODE_CSS_DARK, PANEL_DARK_MODE_CSS_LIGHT, PANEL_LOADING_CSS } =
      await import("../../src/contentScript/panelShared.js");
    await loadModule();
    const input = createHoverTarget("Hello world");

    await openTooltip(input);

    const root = getOverlayHost().shadowRoot;
    const el = root.getElementById("backdropFilterElement");
    expect(el.textContent).toBe(PANEL_DARK_MODE_CSS_DARK);

    // The light constant is the exact counterpart (no third block can drift in).
    expect(PANEL_DARK_MODE_CSS_LIGHT).not.toBe(PANEL_DARK_MODE_CSS_DARK);
    expect(PANEL_DARK_MODE_CSS_LIGHT).toContain("rgba(248, 248, 248, 0.98)");

    // Layout/loading CSS ships from the shared constant too: the panel carries a
    // style block byte-identical to PANEL_LOADING_CSS.
    const styleBlocks = Array.from(root.querySelectorAll("style"));
    expect(styleBlocks.some((s) => s.textContent === PANEL_LOADING_CSS)).toBe(true);
  });

  it("routes single-word AI requests through the word path (dictionary)", async () => {
    wordsCountMock.mockReturnValue(1);
    await loadModule();
    const input = createHoverTarget("Hello");

    await openTooltip(input);
    const shadowRoot = shadowRootOrFail();

    shadowRoot.getElementById("sOpenAI").click();
    await flushMicrotasks();

    expect(aiTranslateWordMock).toHaveBeenCalledOnce();
    expect(aiTranslateTextMock).not.toHaveBeenCalled();
    const proxy = aiTranslateWordMock.mock.calls[0][0][0];
    expect(proxy.classList.contains("dualtran-ai-selected-btn")).toBe(true);

    // Multi-word source routes through the text path instead.
    aiTranslateWordMock.mockClear();
    wordsCountMock.mockReturnValue(3);
    const longInput = createHoverTarget("Hello whole world");
    await openTooltip(longInput);
    shadowRootOrFail().getElementById("sOpenAI").click();
    await flushMicrotasks();

    expect(aiTranslateTextMock).toHaveBeenCalledOnce();
    expect(aiTranslateWordMock).not.toHaveBeenCalled();
  });
});

// ── Implementation-point map (plan 37 hover-panel alignment) ──
// The hover panel (showTranslated.js) and the selection panel (translateSelected.js)
// render through one set of shared implementation points (panelShared.js); only the
// trigger/lifecycle stay hover-specific.
//
// panelShared.js — the shared surface:
//   PANEL_BTN_COLORS — the engine-button palette SSOT. Locked verbatim to the
//     floating group's colors; the hover panel's intent palette cell reads it
//     through applyPanelButtonPalette (clicking AI flips both buttons).
//   PANEL_EMPTY_COLORS — the "empty config = no paint" value set; applyPanelTranslatedColor
//     resets first so a switch can never leave the other engine's color behind.
//   applyPanelTranslatedColor — the single point that paints the translated text;
//     cells: "paints the Google arrival with the configured translatedColor" +
//     "repaints the translated color on engine switches (no cross-engine leak)".
//   applyPanelButtonPalette — the only boundary effect of an engine click
//     (intent flip + palette); cell: "applies the shared intent palette to the engine buttons".
//   createPanelAiProxy — absorbs every decoration the engine writes (labels stay
//     constant, zero ✓/✕ spans); cell: "keeps the AI label constant with zero
//     decoration through the whole run" (asserts proxy.translatedTextNode identity).
//   setPanelTranslationLoadingState — the shared loading renderer (spinner +
//     label); cell: "shows the panel with the shared loading surface the moment
//     translation starts" (also asserts the scratch-node contract).
//   clearPanelTranslationLoadingState — the paired teardown (empty innerHTML);
//     same cell asserts the cleared state.
//   PANEL_LOADING_CSS — the layout/loading style block; cell: "shares the
//     dark-mode CSS constants from panelShared" (style block byte-identical).
//   PANEL_DARK_MODE_CSS_DARK / PANEL_DARK_MODE_CSS_LIGHT — the dark/light scheme
//     blocks injected into #backdropFilterElement; same cell locks both constants.
//
// showTranslated.js (hover side) — the hover-specific wiring:
//   setPanelTranslationLoadingState call sites — the panel shows the shared
//     loading face the moment a run starts (never waits for arrival).
//   aiTranslateWord / wordsCount — Q-H1 word routing: a single-word hover routes
//     through the dictionary path exactly like the selection panel; cell:
//     "routes single-word AI requests through the word path (dictionary)".
//   targetLanguageTextTranslation — the panel's own selected target language
//     (page's targetLanguage must not leak in); cells: "'+' dropdown" + config-change cells.
//
// Guarded absences (the hover panel must NOT write these):
//   saveAiAppliedFlag — a hover AI success must not mark the page as AI-translated.
//     Chain: the hover panel hands AI runs to the engine through a proxy carrying
//     dualtran-ai-selected-btn (asserted here: proxy.classList.contains("dualtran-ai-selected-btn")
//     in the label-constant and word-routing cells), and pageTranslator.js skips
//     saveAiAppliedFlag when isSelectedPanel (asserted in pageTranslator.test.js
//     "划词翻译成功后不应保存页面级 sessionStorage 标记"). The hover module itself
//     carries no saveAiAppliedFlag call site — this map records the negative contract.
