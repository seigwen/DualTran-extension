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

  it("streams selected-text AI output, then marks success and stores the cache entry", async () => {
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
    expect(aiCacheMock).toEqual([
      {
        original: "hello world",
        targetLanguage: "de",
        translated: "bonjour",
      },
    ]);
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

  it("reuses selected-text aiCache entries without issuing another AI request", async () => {
    aiCacheMock.push({
      original: "cached text",
      targetLanguage: "de",
      translated: "zwischengespeichert",
    });

    const { aiTranslateWord } = await import("../../src/contentScript/translateSelected.js");
    const button = createButton(document, { sourceString: "cached text" });

    await aiTranslateWord([button]);

    expect(translateWithAIMock).not.toHaveBeenCalled();
    expect(button.translationStatus).toBe("translated");
    expect(button.translatedTextNode.textContent).toBe("zwischengespeichert");
    expect(button.translatedTextNode.style.color).toBe("rgb(4, 5, 6)");
    expect(button.tooltip.textContent).toBe("AI translated successfully!");
  });
});
