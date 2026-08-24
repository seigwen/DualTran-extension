/**
 * Tests for the floating button's three-state behavior (Original / Google / AI).
 *
 * Model (Q28 behavior table):
 *   - Exactly one button highlighted at all times
 *   - Click always switches highlight; no-op only means no translation action
 *   - Intervention flag: after user clicks, highlight is click-driven;
 *     before, content-driven (auto-translate → Google highlight)
 *   - No loading state on buttons (per-block indicators show progress)
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
    whereToDisplayTranslatedText: "newLine",
  },
  configChangeCallbacks: [],
  pageTranslatorCallbacks: {
    onPageLanguageStateChange: [],
    onPageRenderStateChange: [],
    onAiRenderStateChange: [],
  },
  pageTranslatorMock: {
    translatePage: vi.fn(),
    translatePageAi: vi.fn(() => true),
    restorePage: vi.fn(),
    showGoogleOnly: vi.fn(),
    showAiOnly: vi.fn(),
    stopAiAutoTranslate: vi.fn(),
    setAiModeActive: vi.fn(),
    hasAiResults: vi.fn(() => false),
    onPageLanguageStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageLanguageStateChange.push(callback);
    }),
    onPageRenderStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageRenderStateChange.push(callback);
    }),
    onAiRenderStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onAiRenderStateChange.push(callback);
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

describe("floatingBtn — three-state behavior", () => {
  let attachShadowSpy;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    pageTranslatorCallbacks.onPageLanguageStateChange.length = 0;
    pageTranslatorCallbacks.onPageRenderStateChange.length = 0;
    pageTranslatorCallbacks.onAiRenderStateChange.length = 0;
    configValues.targetLanguage = "fr";
    configValues.pageTranslatorService = "google";
    configValues.alwaysTranslateSites = [];
    configValues.neverTranslateSites = [];
    configValues.neverTranslateLangs = [];
    configValues.showFloatingBtn = "yes";
    configValues.floatingBtnPosition = null;
    configValues.darkMode = "no";
    configValues.whereToDisplayTranslatedText = "newLine";

    setMock.mockClear();
    pageTranslatorMock.translatePage.mockReset();
    pageTranslatorMock.translatePageAi.mockReset();
    pageTranslatorMock.translatePageAi.mockReturnValue(true);
    pageTranslatorMock.restorePage.mockReset();
    pageTranslatorMock.showGoogleOnly.mockReset();
    pageTranslatorMock.showAiOnly.mockReset();
    pageTranslatorMock.stopAiAutoTranslate.mockReset();
    pageTranslatorMock.setAiModeActive.mockReset();
    pageTranslatorMock.hasAiResults.mockReset();
    pageTranslatorMock.hasAiResults.mockReturnValue(false);
    pageTranslatorMock.onPageLanguageStateChange.mockClear();
    pageTranslatorMock.onPageRenderStateChange.mockClear();
    pageTranslatorMock.onAiRenderStateChange.mockClear();

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
  function getOriginalButton() {
    return getHost()?.shadowRoot?.getElementById("btnOriginal");
  }
  function getGoogleButton() {
    return getHost()?.shadowRoot?.getElementById("btnGoogle");
  }
  function getAiButton() {
    return getHost()?.shadowRoot?.getElementById("btnAi");
  }
  function isHighlighted(btn) {
    return btn?.classList.contains("dualtran-floating-btn-active") ?? false;
  }

  // ──────────────────────────────────────────────
  // Initial state
  // ──────────────────────────────────────────────

  it("initial state: three buttons exist, Original highlighted", async () => {
    await loadModule();
    expect(getOriginalButton()).toBeTruthy();
    expect(getGoogleButton()).toBeTruthy();
    expect(getAiButton()).toBeTruthy();
    expect(isHighlighted(getOriginalButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
    expect(isHighlighted(getAiButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 2: page original → Google click
  // ──────────────────────────────────────────────

  it("scenario 2: page original + Google click → translatePage + Google highlighted", async () => {
    await loadModule();
    getGoogleButton().click();
    expect(pageTranslatorMock.translatePage).toHaveBeenCalledOnce();
    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getOriginalButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 4: page original → AI click (has key)
  // ──────────────────────────────────────────────

  it("scenario 4: page original + AI click → translatePageAi + AI highlighted", async () => {
    await loadModule();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(isHighlighted(getAiButton())).toBe(true);
    expect(isHighlighted(getOriginalButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 3: page original → AI click (no key)
  // ──────────────────────────────────────────────

  it("scenario 3: page original + AI click (no key) → prompt, AI highlighted, no translation", async () => {
    pageTranslatorMock.translatePageAi.mockReturnValue(false);
    await loadModule();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(isHighlighted(getAiButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 6: Google displayed + Google highlighted → Google click noop
  // ──────────────────────────────────────────────

  it("scenario 6: Google displayed + Google click → noop (no restore, no re-translate)", async () => {
    await loadModule();
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    pageTranslatorMock.translatePage.mockClear();
    pageTranslatorMock.restorePage.mockClear();
    getGoogleButton().click();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
    expect(isHighlighted(getGoogleButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 7: Google displayed + Google highlighted → AI click
  // ──────────────────────────────────────────────

  it("scenario 7: Google displayed + AI click → translatePageAi (Google not re-called)", async () => {
    await loadModule();
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    pageTranslatorMock.translatePage.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
    expect(isHighlighted(getAiButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 12/13: Original click restores
  // ──────────────────────────────────────────────

  it("scenario 12: AI displayed + Original click → restorePage + Original highlighted", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("success");
    getOriginalButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
    expect(isHighlighted(getOriginalButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 11: AI displayed + Google click → showGoogleOnly, no requests
  // ──────────────────────────────────────────────

  it("scenario 11: AI displayed + Google click → showGoogleOnly + Google highlighted", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("success");
    pageTranslatorMock.translatePage.mockClear();
    getGoogleButton().click();
    expect(pageTranslatorMock.showGoogleOnly).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
    expect(isHighlighted(getGoogleButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 16: auto-translate (no intervention) → Google highlighted
  // ──────────────────────────────────────────────

  it("scenario 16: auto-translate without intervention → Google highlighted (content-driven)", async () => {
    await loadModule();
    emitPageLanguageStateChange("translated");
    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getOriginalButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 14: intervention + auto-translate event → highlight unchanged
  // ──────────────────────────────────────────────

  it("scenario 14: after AI click, pageLanguageState translated → AI stays highlighted (click priority)", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    expect(isHighlighted(getAiButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 8: AI in-flight + AI click → noop
  // ──────────────────────────────────────────────

  it("scenario 8: AI in-flight + AI click → noop (no duplicate request)", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("loading");
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).not.toHaveBeenCalled();
    expect(isHighlighted(getAiButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 9: AI failed + AI click → retry
  // ──────────────────────────────────────────────

  it("scenario 9: AI failed blocks + AI click → retry (translatePageAi called again)", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("error");
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────
  // Scenario 10: AI displayed + AI click → noop
  // ──────────────────────────────────────────────

  it("scenario 10: AI displayed + AI click → noop", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("success");
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).not.toHaveBeenCalled();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // Scenario 5: page original + AI highlighted + AI click → translatePageAi
  // ──────────────────────────────────────────────

  it("scenario 5: page original + AI highlighted (no-key then key configured) + AI click → translatePageAi", async () => {
    pageTranslatorMock.translatePageAi.mockReturnValue(false);
    await loadModule();
    getAiButton().click(); // no-key click: AI highlighted, no translation
    expect(isHighlighted(getAiButton())).toBe(true);
    pageTranslatorMock.translatePageAi.mockReturnValue(true);
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click(); // now has key: should start AI translation
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────
  // Scenario 10a: Google displayed + newLine + AI result available + AI click → showAiOnly
  // ──────────────────────────────────────────────

  it("scenario 10a: Google displayed + AI result available (newLine) + AI click → showAiOnly, zero requests", async () => {
    pageTranslatorMock.hasAiResults.mockReturnValue(true);
    await loadModule();
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).not.toHaveBeenCalled();
    expect(isHighlighted(getAiButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 15: AI in-flight + Original click → restorePage
  // ──────────────────────────────────────────────

  it("scenario 15: AI in-flight + Original click → restorePage + Original highlighted", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("loading");
    getOriginalButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
    expect(isHighlighted(getOriginalButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 19: external restore (pageLanguageState → original) resets highlight
  // ──────────────────────────────────────────────

  it("scenario 19: pageLanguageState → original resets highlight to Original", async () => {
    await loadModule();
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    emitPageLanguageStateChange("original");
    expect(isHighlighted(getOriginalButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
  });
});
