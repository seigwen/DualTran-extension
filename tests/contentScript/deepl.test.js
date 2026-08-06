import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("deepl content script", () => {
  let messageListeners;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    messageListeners = [];

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb) => messageListeners.push(cb)),
        },
        sendMessage: vi.fn(),
      },
    };

    Object.defineProperty(globalThis, "location", {
      value: { hash: "", hostname: "www.deepl.com" },
      writable: true,
      configurable: true,
    });

    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setupDOM({ sourceValue = "", targetValue = "", targetLang = "en" } = {}) {
    const sourceTextarea = { value: sourceValue, dispatchEvent: vi.fn() };
    const targetTextarea = { value: targetValue, lang: targetLang };

    globalThis.document.querySelector = vi.fn((selector) => {
      if (selector === "textarea[dl-test=translator-source-input]")
        return sourceTextarea;
      if (selector === "textarea[dl-test=translator-target-input]")
        return targetTextarea;
      if (selector.includes("translator-target-lang-btn"))
        return { click: vi.fn() };
      if (selector.includes("translator-lang-option-"))
        return { click: vi.fn() };
      return null;
    });

    return { sourceTextarea, targetTextarea };
  }

  async function loadModule() {
    await import("../../src/contentScript/deepl.js");
  }

  it("registers a message listener", async () => {
    setupDOM();
    await loadModule();
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });

  it("returns true from listener to keep channel open", async () => {
    setupDOM();
    await loadModule();
    const result = messageListeners[0](
      { action: "translateTextWithDeepL", text: "test", targetLanguage: "de" },
      {},
      vi.fn()
    );
    expect(result).toBe(true);
  });

  it("resolves with cached result when same text and target language match", async () => {
    const { sourceTextarea, targetTextarea } = setupDOM({
      sourceValue: "Hello",
      targetValue: "Bonjour",
      targetLang: "fr",
    });

    await loadModule();

    const sendResponse = vi.fn();
    messageListeners[0](
      { action: "translateTextWithDeepL", text: "Hello", targetLanguage: "fr" },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(sendResponse).toHaveBeenCalledWith("Bonjour");
  });

  it("resolves via timeout when target value appears", async () => {
    const { targetTextarea } = setupDOM();

    await loadModule();

    const sendResponse = vi.fn();
    messageListeners[0](
      { action: "translateTextWithDeepL", text: "Hello", targetLanguage: "fr" },
      {},
      sendResponse
    );

    targetTextarea.value = "Translated!";
    await vi.advanceTimersByTimeAsync(200);

    expect(sendResponse).toHaveBeenCalledWith("Translated!");
  });

  it("resolves after timeout when no translation result available", async () => {
    setupDOM();

    // vitest fake timers don't advance performance.now(); mock it so deepl.js timeout (2400ms) fires
    let perfTime = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      perfTime += 200;
      return perfTime;
    });

    await loadModule();

    const sendResponse = vi.fn();
    messageListeners[0](
      { action: "translateTextWithDeepL", text: "Hello", targetLanguage: "de" },
      {},
      sendResponse
    );

    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(100);
      if (sendResponse.mock.calls.length > 0) break;
    }

    expect(sendResponse).toHaveBeenCalled();
  });

  it("parses hash on load and sends first translation result", async () => {
    globalThis.location.hash = "#!fr!#Hello%20World";
    const { targetTextarea } = setupDOM();

    targetTextarea.value = "Bonjour le monde";

    let perfTime = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      perfTime += 200;
      return perfTime;
    });

    await loadModule();

    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(100);
      if (chrome.runtime.sendMessage.mock.calls.length > 0) break;
    }

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: "DeepL_firstTranslationResult",
      result: "Bonjour le monde",
    });
  });

  it("clears location hash after parsing", async () => {
    globalThis.location.hash = "#!de!#Test";
    setupDOM();

    await loadModule();

    expect(globalThis.location.hash).toBe("");
  });
});
