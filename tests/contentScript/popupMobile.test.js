import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  configValues,
  configChangeCallbacks,
  configReadyCallbacks,
  pageTranslatorCallbacks,
  pageTranslatorMock,
} = vi.hoisted(() => ({
  configValues: {
    targetLanguage: "fr",
    pageTranslatorService: "google",
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    showPopupMobile: "yes",
    darkMode: "no",
    showTranslateSelectedButton: "no",
  },
  configChangeCallbacks: [],
  configReadyCallbacks: [],
  pageTranslatorCallbacks: {
    onPageLanguageStateChange: [],
    onGetOriginalTabLanguage: [],
  },
  pageTranslatorMock: {
    translatePage: vi.fn(),
    restorePage: vi.fn(),
    swapTranslationService: vi.fn(),
    onPageLanguageStateChange: vi.fn((cb) =>
      pageTranslatorCallbacks.onPageLanguageStateChange.push(cb)
    ),
    onGetOriginalTabLanguage: vi.fn((cb) =>
      pageTranslatorCallbacks.onGetOriginalTabLanguage.push(cb)
    ),
  },
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: vi.fn((key, value) => {
      configValues[key] = value;
    }),
    setTargetLanguage: vi.fn(),
    addSiteToNeverTranslate: vi.fn(),
    addLangToNeverTranslate: vi.fn(),
    onReady: vi.fn((cb) => {
      if (typeof cb === "function") configReadyCallbacks.push(cb);
      return Promise.resolve();
    }),
    onChanged: vi.fn((cb) => configChangeCallbacks.push(cb)),
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    getLanguageList: vi.fn(() => ({
      en: "English",
      fr: "French",
      de: "German",
    })),
    fixTLanguageCode: vi.fn((code) => code || null),
  },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({
  default: {
    isMobile: { any: true },
  },
}));

vi.mock("../../src/contentScript/pageTranslator.js", () => ({
  pageTranslator: pageTranslatorMock,
}));

describe("popupMobile", () => {
  let sendMessageCallback;

  beforeEach(() => {
    vi.resetModules();

    document.body.innerHTML = "";

    configChangeCallbacks.length = 0;
    configReadyCallbacks.length = 0;
    pageTranslatorCallbacks.onPageLanguageStateChange.length = 0;
    pageTranslatorCallbacks.onGetOriginalTabLanguage.length = 0;

    Object.assign(configValues, {
      targetLanguage: "fr",
      pageTranslatorService: "google",
      alwaysTranslateSites: [],
      neverTranslateSites: [],
      neverTranslateLangs: [],
      showPopupMobile: "yes",
      darkMode: "no",
      showTranslateSelectedButton: "no",
    });

    sendMessageCallback = null;

    globalThis.chrome = {
      runtime: {
        getURL: vi.fn((p) => `chrome-extension://test${p}`),
        sendMessage: vi.fn((msg, cb) => {
          if (cb) cb("example.com");
          if (sendMessageCallback) sendMessageCallback(msg, cb);
        }),
        onMessage: {
          addListener: vi.fn(),
        },
      },
      i18n: {
        getMessage: vi.fn((key) => key),
        translateDocument: vi.fn(),
      },
    };

    globalThis.matchMedia = vi.fn(() => ({
      matches: false,
    }));

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  async function loadAndReady() {
    await import("../../src/contentScript/popupMobile.js");
    for (const cb of configReadyCallbacks) cb();
    await vi.dynamicImportSettled?.() ?? Promise.resolve();
  }

  it("creates shadow DOM popup on mobile", async () => {
    configValues.alwaysTranslateSites = ["example.com"];

    await loadAndReady();

    const popupDiv = document.querySelector("div.notranslate");
    expect(popupDiv).toBeTruthy();
  });

  it("does not create popup when showPopupMobile is 'no' and no forceShow", async () => {
    configValues.showPopupMobile = "no";
    configValues.alwaysTranslateSites = [];

    await loadAndReady();

    // 使用 vi.waitFor 替代固定 setTimeout(r, 10)，避免 CI 环境下时序不确定导致的 flaky
    await vi.waitFor(() => {
      const popups = document.querySelectorAll("div.notranslate");
      expect(popups.length).toBe(0);
    }, { timeout: 1000 });
  });

  it("responds to config change for alwaysTranslateSites", async () => {
    await loadAndReady();

    expect(configChangeCallbacks.length).toBeGreaterThan(0);

    const cb = configChangeCallbacks[0];
    cb("alwaysTranslateSites", ["example.com"]);

    await vi.waitFor(() => {
      const popupDivs = document.querySelectorAll("div.notranslate");
      // 修复: >= 0 永远为 true，改为 > 0 以验证 config 变更确实产生了 popup
      expect(popupDivs.length).toBeGreaterThan(0);
    });
  });

  it("registers onPageLanguageStateChange callback", async () => {
    await loadAndReady();
    expect(
      pageTranslatorCallbacks.onPageLanguageStateChange.length
    ).toBeGreaterThan(0);
  });

  it("registers onGetOriginalTabLanguage callback", async () => {
    await loadAndReady();
    expect(
      pageTranslatorCallbacks.onGetOriginalTabLanguage.length
    ).toBeGreaterThan(0);
  });
});
