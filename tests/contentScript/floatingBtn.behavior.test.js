/**
 * Tests for the floating button's 4 behavior patterns and bug detection.
 *
 * Expected behaviors (right-side floating button):
 *   1. Google → Google: restore original
 *   2. Google → AI: add AI on top of Google (AI replaces Google text when ready)
 *   3. AI → AI: restore original
 *   4. AI → Google: show Google only (clear AI) → AI again: add AI on top
 *
 * Bug 1 (replaceOriginal mode): behavior 4, clicking Google does NOT clear AI
 *   because showGoogleOnly() only toggles googleSpan/aiSpan display, but in
 *   replaceOriginal mode AI text is written directly into translatedTextNode.
 *
 * Bug 2 (newLine mode): after behavior 4, clicking AI again does NOT trigger
 *   AI translation because translatePageAi() is not called or fails silently.
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
    onPageRenderStateChange: [],
    onAiRenderStateChange: [],
    onGetOriginalTabLanguage: [],
  },
  pageTranslatorMock: {
    translatePage: vi.fn(),
    translatePageAi: vi.fn(() => true),
    restorePage: vi.fn(),
    stopAiAutoTranslate: vi.fn(),
    showGoogleOnly: vi.fn(),
    onPageLanguageStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageLanguageStateChange.push(callback);
    }),
    onPageRenderStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageRenderStateChange.push(callback);
    }),
    onAiRenderStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onAiRenderStateChange.push(callback);
    }),
    onGetOriginalTabLanguage: vi.fn((callback) => {
      pageTranslatorCallbacks.onGetOriginalTabLanguage.push(callback);
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

function emitPageRenderStateChange(value) {
  pageTranslatorCallbacks.onPageRenderStateChange.forEach((cb) => cb(value));
}

function emitAiRenderStateChange(value) {
  pageTranslatorCallbacks.onAiRenderStateChange.forEach((cb) => cb(value));
}

async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("floatingBtn — right-side button behavior patterns", () => {
  let attachShadowSpy;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    pageTranslatorCallbacks.onPageLanguageStateChange.length = 0;
    pageTranslatorCallbacks.onPageRenderStateChange.length = 0;
    pageTranslatorCallbacks.onAiRenderStateChange.length = 0;
    pageTranslatorCallbacks.onGetOriginalTabLanguage.length = 0;
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
    pageTranslatorMock.stopAiAutoTranslate.mockReset();
    pageTranslatorMock.showGoogleOnly.mockReset();
    pageTranslatorMock.onPageLanguageStateChange.mockClear();
    pageTranslatorMock.onPageRenderStateChange.mockClear();
    pageTranslatorMock.onAiRenderStateChange.mockClear();
    pageTranslatorMock.onGetOriginalTabLanguage.mockClear();

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

  function getHost() {
    return document.body.querySelector("div.notranslate");
  }

  function getGoogleButton() {
    return getHost()?.shadowRoot?.getElementById("btnGoogle");
  }

  function getAiButton() {
    return getHost()?.shadowRoot?.getElementById("btnAi");
  }

  // Helper: simulate a full AI+Google concurrent translation cycle
  // After this, pageLanguageState=translated, googleRenderState=success, aiRenderState=success
  function simulateAiConcurrentDone() {
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("loading");
    emitAiRenderStateChange("loading");
    emitPageRenderStateChange("success");
    emitAiRenderStateChange("success");
  }

  // Helper: simulate Google-only translation done
  function simulateGoogleOnlyDone() {
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("success");
    // AI stays idle
  }

  // ──────────────────────────────────────────────────────────────
  // Behavior 1: Google → Google (restore)
  // ──────────────────────────────────────────────────────────────

  it("behavior 1: Google → Google restores original", async () => {
    await loadModule();

    // Click Google: start Google translation
    getGoogleButton().click();
    expect(pageTranslatorMock.translatePage).toHaveBeenCalledOnce();

    // Simulate Google translation done
    simulateGoogleOnlyDone();

    // Click Google again: should restore
    getGoogleButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────────────────────
  // Behavior 2: Google → AI (add AI on top)
  // ──────────────────────────────────────────────────────────────

  it("behavior 2: Google → AI adds AI on top of existing Google translation", async () => {
    await loadModule();

    // Click Google: start Google translation
    getGoogleButton().click();
    expect(pageTranslatorMock.translatePage).toHaveBeenCalledOnce();

    // Simulate Google done
    simulateGoogleOnlyDone();

    // Click AI: should add AI on top (not restore)
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────
  // Behavior 3: AI → AI (restore)
  // ──────────────────────────────────────────────────────────────

  it("behavior 3: AI → AI restores original", async () => {
    await loadModule();

    // Click AI: start concurrent Google+AI
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();

    // Simulate concurrent done
    simulateAiConcurrentDone();

    // Click AI again: should restore
    getAiButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────────────────────
  // Behavior 4: AI → Google (show Google only, clear AI)
  // ──────────────────────────────────────────────────────────────

  it("behavior 4: AI → Google shows Google only and clears AI state", async () => {
    await loadModule();

    // Click AI: start concurrent Google+AI
    getAiButton().click();
    simulateAiConcurrentDone();

    // Click Google: should switch to Google-only view
    getGoogleButton().click();

    // Must call showGoogleOnly to hide AI spans and show Google spans
    expect(pageTranslatorMock.showGoogleOnly).toHaveBeenCalledOnce();
    // Must stop AI auto-translate mode
    expect(pageTranslatorMock.stopAiAutoTranslate).toHaveBeenCalledOnce();
    // Must NOT restore the page
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();

    // After this, the internal state should be:
    //   googleRenderState = "success"
    //   aiRenderState = "idle"
    // Verify by checking button text updates
    emitPageRenderStateChange("success"); // re-emit to ensure sync
    emitAiRenderStateChange("idle");
  });

  // ──────────────────────────────────────────────────────────────
  // Behavior 4+AI: AI → Google → AI (add AI on top of Google)
  // This is the key test that catches Bug 2.
  // After behavior 4, clicking AI should trigger translatePageAi().
  // ──────────────────────────────────────────────────────────────

  it("behavior 4+AI: after AI→Google (show Google only), clicking AI again adds AI translation", async () => {
    await loadModule();

    // Step 1: Click AI → concurrent Google+AI
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledTimes(1);
    simulateAiConcurrentDone();

    // Step 2: Click Google → show Google only (clear AI)
    getGoogleButton().click();
    expect(pageTranslatorMock.showGoogleOnly).toHaveBeenCalledOnce();

    // Simulate the state change callbacks that showGoogleOnly should trigger:
    // pageLanguageState stays "translated", aiRenderState becomes "idle"
    emitAiRenderStateChange("idle");
    // googleRenderState stays "success"

    // Step 3: Click AI again → should add AI on top (NOT restore, NOT do nothing)
    pageTranslatorMock.translatePageAi.mockClear();
    pageTranslatorMock.restorePage.mockClear();

    getAiButton().click();

    // BUG 2 DETECTION: If translatePageAi is NOT called, the bug exists.
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────
  // Behavior 4: verify showGoogleOnly is called (existing test enhanced)
  // This test also verifies the Google button doesn't call restorePage
  // when switching from AI to Google-only view.
  // ──────────────────────────────────────────────────────────────

  it("behavior 4: clicking Google after AI+Google concurrent calls showGoogleOnly, not restorePage", async () => {
    await loadModule();

    // Set up state: AI+Google both success, page is translated
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("success");
    emitAiRenderStateChange("success");

    // Click Google
    getGoogleButton().click();

    expect(pageTranslatorMock.showGoogleOnly).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.stopAiAutoTranslate).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
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

    simulateAiConcurrentDone();
    expect(getGoogleButton().textContent).toBe("Google ✓");
    expect(getAiButton().textContent).toBe("AI ✓");

    emitPageLanguageStateChange("original");
    expect(getGoogleButton().textContent).toBe("Google");
    expect(getAiButton().textContent).toBe("AI");
  });

  // ──────────────────────────────────────────────────────────────
  // translatePageAi returns false (no API key) → state should revert
  // ──────────────────────────────────────────────────────────────

  it("reverts button state when translatePageAi returns false (no API key)", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        if (this.id === "btnGoogle" || this.id === "btnAi") return 100;
        return 0;
      },
    });
    pageTranslatorMock.translatePageAi.mockReturnValue(false);
    await loadModule();

    // Original state → click AI
    getAiButton().click();

    // Buttons should revert to idle since translatePageAi returned false
    expect(getAiButton().textContent).toBe("AI");
    expect(getGoogleButton().textContent).toBe("Google");
  });

  // ──────────────────────────────────────────────────────────────
  // Full cycle: AI → Google → AI → AI (restore)
  // Tests the complete behavior 4 + subsequent AI toggle
  // ──────────────────────────────────────────────────────────────

  it("full cycle: AI → Google → AI → AI restores original", async () => {
    await loadModule();

    // 1. Click AI → concurrent
    getAiButton().click();
    simulateAiConcurrentDone();

    // 2. Click Google → show Google only
    getGoogleButton().click();
    emitAiRenderStateChange("idle");

    // 3. Click AI → add AI
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();

    // Simulate AI done again
    emitAiRenderStateChange("success");

    // 4. Click AI → restore
    pageTranslatorMock.restorePage.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
  });
});
