import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  configValues,
  configChangeCallbacks,
  platformState,
  pageTranslatorCallbacks,
  backgroundTranslateSingleTextMock,
  aiTranslateTextMock,
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

    backgroundTranslateSingleTextMock.mockReset();
    backgroundTranslateSingleTextMock.mockResolvedValue("translated result");
    aiTranslateTextMock.mockReset();
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
    vi.restoreAllMocks(); // 恢复原型级 mock（如 HTMLElement.prototype.attachShadow）
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

  // 修复: 原测试仅验证类型，替换为验证模块可加载且为非空对象
  it("imports and exports the showTranslated object", async () => {
    const showTranslated = await loadModule();
    // showTranslated 的 API 在 twpConfig.onReady 回调中异步填充，
    // 因此无法直接验证具体属性。但至少应确认模块加载成功且返回非空对象。
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

    const input = document.createElement("input");
    input.type = "text";
    input.value = "Hello world";
    document.body.appendChild(input);

    await openTooltip(input);

    expect(backgroundTranslateSingleTextMock).toHaveBeenCalledWith(
      "google",
      "it",
      "Hello world"
    );
  });

  it("updates target language buttons from config changes on the next tooltip", async () => {
    await loadModule();

    const input = document.createElement("input");
    input.type = "text";
    input.value = "Hello world";
    document.body.appendChild(input);

    await openTooltip(input);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushMicrotasks();

    emitConfigChange("targetLanguages", ["fr", "it", "pt"]);

    const secondInput = document.createElement("input");
    secondInput.type = "text";
    secondInput.value = "Hello world again";
    document.body.appendChild(secondInput);

    await openTooltip(secondInput);

    const buttons = [...getOverlayHost().shadowRoot.querySelectorAll("#setTargetLanguage li")];
    expect(buttons.map((button) => button.textContent)).toEqual(["fr", "it", "pt"]);
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
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Hello world";
    document.body.appendChild(input);

    await openTooltip(input);
    expect(getOverlayHost()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushMicrotasks();

    expect(getOverlayHost()).toBeNull();
  });

  it("calls backgroundTranslateSingleText with the active service and language", async () => {
    await loadModule();
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Translate me";
    document.body.appendChild(input);

    await openTooltip(input);

    expect(backgroundTranslateSingleTextMock).toHaveBeenCalledWith(
      "google",
      "de",
      "Translate me"
    );
  });

  it("target language and translator buttons update config and retranslate", async () => {
    await loadModule();
    emitConfigChange("textTranslatorService", "bing");
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Click me";
    document.body.appendChild(input);

    await openTooltip(input);
    const shadowRoot = getOverlayHost().shadowRoot;

    shadowRoot.querySelector('#setTargetLanguage li[value="es"]').click();
    await flushMicrotasks();
    expect(setTargetLanguageTextTranslationMock).toHaveBeenCalledWith("es");
    expect(backgroundTranslateSingleTextMock).toHaveBeenLastCalledWith(
      "bing",
      "es",
      "Click me"
    );

    shadowRoot.getElementById("sGoogle").click();
    await flushMicrotasks();
    expect(backgroundTranslateSingleTextMock).toHaveBeenLastCalledWith(
      "google",
      "es",
      "Click me"
    );
  });

  it("adds dark mode styles when darkMode is yes", async () => {
    configValues.darkMode = "yes";
    await loadModule();
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Dark mode";
    document.body.appendChild(input);

    await openTooltip(input);

    expect(getOverlayHost().shadowRoot.getElementById("darkModeElement")).not.toBeNull();
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

    const input = document.createElement("input");
    input.type = "text";
    input.value = "Auto dark";
    document.body.appendChild(input);

    input.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 70 })
    );
    await vi.advanceTimersByTimeAsync(1250);
    await flushMicrotasks();
    expect(getOverlayHost()).toBeNull();

    emitPageLanguageStateChange("original");
    emitConfigChange("langsToTranslateWhenHovering", ["fr"]);
    await openTooltip(input);

    expect(getOverlayHost().shadowRoot.getElementById("darkModeElement")).not.toBeNull();
  });
});
