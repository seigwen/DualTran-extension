/**
 * Tests for the floating button's two-state toggle behavior.
 *
 * New simplified model:
 *   - Two states: "未翻译" (original) ↔ "已要求翻译" (translated)
 *   - Both buttons toggle: click in original → translate; click in translated → restore
 *   - No intermediate "loading" state on buttons
 *   - No showGoogleOnly / stopAiAutoTranslate — simple restore instead
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  configValues,
  configChangeCallbacks,
  pageTranslatorCallbacks,
  pageTranslatorMock,
  platformState,
  setMock,
} = vi.hoisted(() => ({
  configValues: {
    targetLanguage: "fr",
    pageTranslatorService: "google",
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    showFloatingBtn: "yes",
    floatingBtnPosition: null,
    darkMode: "no",
  },
  configChangeCallbacks: [],
  pageTranslatorCallbacks: {
    onPageLanguageStateChange: [],
  },
  pageTranslatorMock: {
    translatePage: vi.fn(),
    translatePageAi: vi.fn(() => true),
    restorePage: vi.fn(),
    onPageLanguageStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageLanguageStateChange.push(callback);
    }),
  },
  platformState: {
    isMobile: false,
  },
  setMock: vi.fn((key, value) => {
    configValues[key] = value;
  }),
}));

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
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: (lang) => lang,
    codeToLanguage: (lang) => lang,
    isRtlLanguage: () => false,
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
  backgroundTranslateSingleText: vi.fn(),
  aiTranslateText: vi.fn(),
}));

function emitPageLanguageStateChange(value) {
  pageTranslatorCallbacks.onPageLanguageStateChange.forEach((cb) => cb(value));
}

async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("floatingBtn — two-state toggle behavior", () => {
  let attachShadowSpy;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    pageTranslatorCallbacks.onPageLanguageStateChange.length = 0;
    configValues.targetLanguage = "fr";
    configValues.pageTranslatorService = "google";
    configValues.alwaysTranslateSites = [];
    configValues.neverTranslateSites = [];
    configValues.neverTranslateLangs = [];
    configValues.showFloatingBtn = "yes";
    configValues.floatingBtnPosition = null;
    configValues.darkMode = "no";

    setMock.mockClear();
    pageTranslatorMock.translatePage.mockReset();
    pageTranslatorMock.translatePageAi.mockReset();
    pageTranslatorMock.translatePageAi.mockReturnValue(true);
    pageTranslatorMock.restorePage.mockReset();
    pageTranslatorMock.onPageLanguageStateChange.mockClear();

    document.body.innerHTML = "";
    document.head.innerHTML = "";

    attachShadowSpy = vi
      .spyOn(HTMLElement.prototype, "attachShadow")
      .mockImplementation(function (init) {
        return Element.prototype.attachShadow.call(this, { ...init, mode: "open" });
      });

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn((payload, callback) => {
          if (typeof callback === "function") {
            callback(payload?.action === "getTabHostName" ? "example.com" : undefined);
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
      Promise.resolve({ text: () => Promise.resolve("") })
    );
    globalThis.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function loadModule() {
    const module = await import("../../src/contentScript/floatingBtn.js");
    await flushMicrotasks();
    return module.default;
  }

  function getGoogleButton() {
    return document.body.querySelector("div.notranslate")?.shadowRoot?.getElementById("btnGoogle");
  }

  function getAiButton() {
    return document.body.querySelector("div.notranslate")?.shadowRoot?.getElementById("btnAi");
  }

  // ──────────────────────────────────────────────────────────────
  // Behavior 1: Google → Google (restore)
  // ──────────────────────────────────────────────────────────────

  it("behavior 1: Google → Google restores original", async () => {
    await loadModule();

    // Click Google: start Google translation
    getGoogleButton().click();
    expect(pageTranslatorMock.translatePage).toHaveBeenCalledOnce();

    // Simulate translation done
    emitPageLanguageStateChange("translated");

    // Click Google again: should restore
    getGoogleButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────────────────────
  // Behavior 2: Google → AI (restore, not add-on-top)
  // ──────────────────────────────────────────────────────────────

  it("behavior 2: Google → AI restores original (simple toggle)", async () => {
    await loadModule();

    // Click Google: start translation
    getGoogleButton().click();
    expect(pageTranslatorMock.translatePage).toHaveBeenCalledOnce();

    // Simulate translation done
    emitPageLanguageStateChange("translated");

    // Click AI: should restore (toggle off)
    getAiButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.translatePageAi).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────
  // Behavior 3: AI → AI (restore)
  // ──────────────────────────────────────────────────────────────

  it("behavior 3: AI → AI restores original", async () => {
    await loadModule();

    // Click AI: start concurrent Google+AI
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();

    // Simulate translation done
    emitPageLanguageStateChange("translated");

    // Click AI again: should restore
    getAiButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────────────────────
  // Behavior 4: AI → Google (restore, not showGoogleOnly)
  // ──────────────────────────────────────────────────────────────

  it("behavior 4: AI → Google restores original (simple toggle)", async () => {
    await loadModule();

    // Click AI: start concurrent Google+AI
    getAiButton().click();
    emitPageLanguageStateChange("translated");

    // Click Google: should restore (toggle off)
    getGoogleButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────────────────────
  // State reset: pageLanguageState → original resets both buttons
  // ──────────────────────────────────────────────────────────────

  it("resetting pageLanguageState to original resets both buttons to idle", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        if (this.id === "btnGoogle" || this.id === "btnAi") return 100;
        return 0;
      },
    });
    await loadModule();

    emitPageLanguageStateChange("translated");
    expect(getGoogleButton().textContent).toBe("Google ✓");
    expect(getAiButton().textContent).toBe("AI ✓");

    emitPageLanguageStateChange("original");
    expect(getGoogleButton().textContent).toBe("Google");
    expect(getAiButton().textContent).toBe("AI");
  });

  // ──────────────────────────────────────────────────────────────
  // Full cycle: AI → Google → AI → AI (restore)
  // ──────────────────────────────────────────────────────────────

  it("full cycle: AI → translate done → Google (restore) → AI → translate done → AI (restore)", async () => {
    await loadModule();

    // 1. Click AI → translatePageAi
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledTimes(1);
    emitPageLanguageStateChange("translated");

    // 2. Click Google → restore (toggle off)
    getGoogleButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();

    // 3. Page restored → pageLanguageState back to original
    emitPageLanguageStateChange("original");

    // 4. Click AI → translatePageAi again
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    emitPageLanguageStateChange("translated");

    // 5. Click AI → restore (toggle off)
    pageTranslatorMock.restorePage.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
  });
});
