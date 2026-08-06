import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  configValues,
  configChangeCallbacks,
  setMock,
  setTargetLanguageTextTranslationMock,
  runtimeSendMessageMock,
} = vi.hoisted(() => {
  const configValues = {
    targetLanguages: ["fr", "de", "es"],
    targetLanguageTextTranslation: "fr",
    textTranslatorService: "google",
    enableDeepL: "no",
    darkMode: "no",
  };
  const configChangeCallbacks = [];
  const setMock = vi.fn((key, value) => {
    configValues[key] = value;
  });
  const setTargetLanguageTextTranslationMock = vi.fn((value) => {
    configValues.targetLanguageTextTranslation = value;
  });
  const runtimeSendMessageMock = vi.fn((payload, callback) => {
    if (payload.action === "translateSingleText") {
      callback?.(`translated:${payload.translationService}:${payload.targetLanguage}:${payload.source}`);
      return;
    }
    callback?.();
  });

  return {
    configValues,
    configChangeCallbacks,
    setMock,
    setTargetLanguageTextTranslationMock,
    runtimeSendMessageMock,
  };
});

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: setMock,
    onReady: vi.fn((callback) => {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }),
    onChanged: vi.fn((callback) => {
      configChangeCallbacks.push(callback);
    }),
    setTargetLanguageTextTranslation: setTargetLanguageTextTranslationMock,
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: (lang) => lang,
    codeToLanguage: (lang) => ({ fr: "French", de: "German", es: "Spanish", ar: "Arabic" }[lang] || lang),
    isRtlLanguage: (lang) => lang === "ar",
  },
}));

vi.mock("../../src/lib/i18n.js", () => ({}));

describe("popup-translate-text", () => {
  function renderDom() {
    document.head.innerHTML = "";
    document.body.innerHTML = `
      <div id="eOrigText" contenteditable="true"></div>
      <div id="eOrigTextDiv"></div>
      <div id="eTextTranslated"></div>
      <div id="sGoogle"></div>
      <div id="sYandex"></div>
      <div id="sBing"></div>
      <div id="sDeepL"></div>
      <div id="copy"></div>
      <div id="listen"><svg></svg></div>
      <ul id="setTargetLanguage"><li></li><li></li><li></li></ul>
    `;
  }

  function emitConfigChange(name, value) {
    configValues[name] = value;
    configChangeCallbacks.forEach((callback) => callback(name, value));
  }

  async function flushMicrotasks(times = 4) {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  }

  async function loadModule() {
    await import("../../src/popup/popup-translate-text.js");
    await flushMicrotasks();
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    configValues.targetLanguages = ["fr", "de", "es"];
    configValues.targetLanguageTextTranslation = "fr";
    configValues.textTranslatorService = "google";
    configValues.enableDeepL = "no";
    configValues.darkMode = "no";

    runtimeSendMessageMock.mockImplementation((payload, callback) => {
      if (payload.action === "translateSingleText") {
        callback?.(`translated:${payload.translationService}:${payload.targetLanguage}:${payload.source}`);
        return;
      }
      callback?.();
    });

    renderDom();
    history.replaceState({}, "", "/popup-translate-text.html");
    globalThis.matchMedia = vi.fn(() => ({ matches: false }));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    });

    globalThis.chrome = {
      runtime: {
        sendMessage: runtimeSendMessageMock,
      },
      i18n: {
        getMessage: vi.fn((key) => ({ btnListen: "Listen", btnStopListening: "Stop listening" }[key] || key)),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.chrome;
  });

  it("marks the configured translation service as selected on load", async () => {
    configValues.textTranslatorService = "bing";

    await loadModule();

    expect(document.getElementById("sBing").classList.contains("selected")).toBe(true);
  });

  it("renders target language buttons from the configured target languages", async () => {
    await loadModule();

    const buttons = [...document.querySelectorAll("#setTargetLanguage li")];

    expect(buttons.map((button) => button.textContent)).toEqual(["fr", "de", "es"]);
    expect(buttons.map((button) => button.getAttribute("title"))).toEqual([
      "French",
      "German",
      "Spanish",
    ]);
    expect(buttons[0].classList.contains("selected")).toBe(true);
  });

  it("clicking Google selects it, stores the service, and translates", async () => {
    configValues.textTranslatorService = "yandex";
    await loadModule();
    document.getElementById("eOrigText").textContent = "hello";

    document.getElementById("sGoogle").click();
    await flushMicrotasks();

    expect(setMock).toHaveBeenCalledWith("textTranslatorService", "google");
    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "translateSingleText",
        translationService: "google",
        targetLanguage: "fr",
        source: "hello",
      }),
      expect.any(Function)
    );
    expect(document.getElementById("sGoogle").classList.contains("selected")).toBe(true);
  });

  it("clicking DeepL selects it, stores the service, and translates", async () => {
    configValues.enableDeepL = "yes";
    await loadModule();
    document.getElementById("eOrigText").textContent = "hello";

    document.getElementById("sDeepL").click();
    await flushMicrotasks();

    expect(setMock).toHaveBeenCalledWith("textTranslatorService", "deepl");
    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ translationService: "deepl" }),
      expect.any(Function)
    );
    expect(document.getElementById("sDeepL").classList.contains("selected")).toBe(true);
  });

  it("clicking a target language stores it and translates with that language", async () => {
    await loadModule();
    document.getElementById("eOrigText").textContent = "hello";
    const secondLanguage = document.querySelectorAll("#setTargetLanguage li")[1];

    secondLanguage.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    expect(setTargetLanguageTextTranslationMock).toHaveBeenCalledWith("de");
    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        translationService: "google",
        targetLanguage: "de",
        source: "hello",
      }),
      expect.any(Function)
    );
    expect(secondLanguage.classList.contains("selected")).toBe(true);
  });

  it("copies the translated text to the clipboard and flashes the copy button", async () => {
    await loadModule();
    document.getElementById("eTextTranslated").textContent = "bonjour";

    document.getElementById("copy").click();
    await flushMicrotasks();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("bonjour");
    expect(document.getElementById("copy").style.backgroundColor).toBe("rgba(0, 255, 0, 0.4)");

    vi.advanceTimersByTime(500);

    expect(document.getElementById("copy").style.backgroundColor).toBe("rgba(0, 0, 0, 0.4)");
  });

  it("clicking listen sends a text-to-speech message", async () => {
    let ttsCallback;
    runtimeSendMessageMock.mockImplementation((payload, callback) => {
      if (payload.action === "translateSingleText") {
        callback?.(`translated:${payload.translationService}:${payload.targetLanguage}:${payload.source}`);
        return;
      }
      if (payload.action === "textToSpeech") {
        ttsCallback = callback;
      }
    });

    await loadModule();
    document.getElementById("eTextTranslated").textContent = "bonjour";

    document.getElementById("listen").click();

    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      {
        action: "textToSpeech",
        text: "bonjour",
        targetLanguage: "fr",
      },
      expect.any(Function)
    );
    expect(document.getElementById("listen").classList.contains("selected")).toBe(true);
    expect(document.getElementById("listen").getAttribute("title")).toBe("Stop listening");

    ttsCallback();

    expect(document.getElementById("listen").classList.contains("selected")).toBe(false);
    expect(document.getElementById("listen").getAttribute("title")).toBe("Listen");
  });

  it("clicking listen again while audio is playing sends stopAudio", async () => {
    runtimeSendMessageMock.mockImplementation((payload, callback) => {
      if (payload.action === "translateSingleText") {
        callback?.(`translated:${payload.translationService}:${payload.targetLanguage}:${payload.source}`);
      }
    });

    await loadModule();
    document.getElementById("eTextTranslated").textContent = "bonjour";

    runtimeSendMessageMock.mockImplementation((payload, callback) => {
      if (payload.action === "translateSingleText") {
        callback?.(`translated:${payload.translationService}:${payload.targetLanguage}:${payload.source}`);
        return;
      }
      if (payload.action === "textToSpeech") {
        return;
      }
      callback?.();
    });

    const listen = document.getElementById("listen");
    listen.click();
    listen.click();

    expect(runtimeSendMessageMock).toHaveBeenCalledWith({ action: "stopAudio" });
    expect(listen.classList.contains("selected")).toBe(false);
  });

  it("debounces translation input by 800ms", async () => {
    await loadModule();
    const original = document.getElementById("eOrigText");
    original.textContent = "hello";

    original.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(799);
    await flushMicrotasks();

    expect(runtimeSendMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "translateSingleText" }),
      expect.any(Function)
    );

    vi.advanceTimersByTime(1);
    await flushMicrotasks();

    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "translateSingleText",
        translationService: "google",
        targetLanguage: "fr",
        source: "hello",
      }),
      expect.any(Function)
    );
  });

  it("shows DeepL when enableDeepL is yes", async () => {
    configValues.enableDeepL = "yes";

    await loadModule();

    expect(document.getElementById("sDeepL").hasAttribute("hidden")).toBe(false);
  });

  it("hides DeepL when enableDeepL is no", async () => {
    configValues.enableDeepL = "no";

    await loadModule();

    expect(document.getElementById("sDeepL").hasAttribute("hidden")).toBe(true);
  });

  it("reacts to enableDeepL config changes after load", async () => {
    configValues.enableDeepL = "no";
    await loadModule();

    emitConfigChange("enableDeepL", "yes");
    expect(document.getElementById("sDeepL").hasAttribute("hidden")).toBe(false);

    emitConfigChange("enableDeepL", "no");
    expect(document.getElementById("sDeepL").hasAttribute("hidden")).toBe(true);
  });

  it("uses rtl direction for rtl target languages", async () => {
    configValues.targetLanguages = ["ar", "de", "es"];
    configValues.targetLanguageTextTranslation = "ar";

    await loadModule();
    document.getElementById("eOrigText").textContent = "hello";

    document.querySelector("#setTargetLanguage li").click();
    await flushMicrotasks();

    expect(document.getElementById("eTextTranslated").getAttribute("dir")).toBe("rtl");
  });

  it("uses ltr direction for non-rtl target languages", async () => {
    await loadModule();
    document.getElementById("eOrigText").textContent = "hello";

    document.getElementById("sGoogle").click();
    await flushMicrotasks();

    expect(document.getElementById("eTextTranslated").getAttribute("dir")).toBe("ltr");
  });

  it("reads text from the hash, moves the caret, and translates automatically", async () => {
    history.replaceState({}, "", "/popup-translate-text.html#text=hello%20world");

    await loadModule();

    expect(document.getElementById("eOrigText").textContent).toBe("hello world");
    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "translateSingleText",
        source: "hello world",
      }),
      expect.any(Function)
    );
    expect(document.activeElement).toBe(document.getElementById("eOrigText"));
  });

  it("adds light mode styles when dark mode is disabled", async () => {
    configValues.darkMode = "no";

    await loadModule();

    expect(document.getElementById("lightModeElement")).not.toBeNull();
    expect(document.querySelector("#listen svg").getAttribute("style")).toContain("rgb(0, 0, 0)");
  });

  it("uses system light mode when dark mode is auto and the system prefers light", async () => {
    configValues.darkMode = "auto";
    globalThis.matchMedia = vi.fn(() => ({ matches: false }));

    await loadModule();

    expect(document.getElementById("lightModeElement")).not.toBeNull();
  });

  it("does not add light mode styles when dark mode is enabled", async () => {
    configValues.darkMode = "yes";

    await loadModule();

    expect(document.getElementById("lightModeElement")).toBeNull();
  });
});
