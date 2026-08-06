import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const expectedExportKeys = [
  "timeStamp",
  "version",
  "openAiUserType",
  "autoImproveByAI",
  "aiImproveForLongerThan",
  "apiKeyOpenAI",
  "openAiModel",
  "apiKeyAnthropic",
  "anthropicModel",
  "apiKeyGoogleGemini",
  "googleGeminiModel",
  "apiKeyAzureOpenAI",
  "azureOpenAIModel",
  "azureOpenAIEndpoint",
  "apiKeyDeepSeek",
  "deepSeekModel",
  "apiKeyGrok",
  "grokModel",
  "aiProvider",
  "apiKeyOpenRouter",
  "openRouterModel",
  "openRouterApiBase",
  "openRouterReferer",
  "openRouterTitle",
  "translatedColor",
  "translateLongerThan",
  "whereToDisplayTranslatedText",
  "pageTranslatorService",
  "textTranslatorService",
  "ttsSpeed",
  "enableDeepL",
  "targetLanguage",
  "targetLanguageTextTranslation",
  "targetLanguages",
  "alwaysTranslateSites",
  "neverTranslateSites",
  "sitesToTranslateWhenHovering",
  "langsToTranslateWhenHovering",
  "alwaysTranslateLangs",
  "neverTranslateLangs",
  "customDictionary",
  "showTranslatePageContextMenu",
  "showTranslateSelectedContextMenu",
  "showButtonInTheAddressBar",
  "showOriginalTextWhenHovering",
  "showTranslateSelectedButton",
  "showPopupMobile",
  "showFloatingBtn",
  "useOldPopup",
  "darkMode",
  "popupBlueWhenSiteIsTranslated",
  "showReleaseNotes",
  "dontShowIfPageLangIsTargetLang",
  "dontShowIfPageLangIsUnknown",
  "dontShowIfSelectedTextIsTargetLang",
  "dontShowIfSelectedTextIsUnknown",
  "hotkeys",
  "expandPanelTranslateSelectedText",
  "translateTag_pre",
  "dontSortResults",
  "translateDynamicallyCreatedContent",
  "autoTranslateWhenClickingALink",
  "translateSelectedWhenPressTwice",
  "translateTextOverMouseWhenPressTwice",
  "translateClickingOnce",
  "floatingBtnPosition",
  "floatingBtnWidth",
  "aiTranslatedColor",
  // Custom endpoint config keys
  "openAiApiBase",
  "anthropicApiBase",
  "googleGeminiApiBase",
  "deepSeekApiBase",
  "grokApiBase",
];

const { mockState, normalizeLanguageCode } = vi.hoisted(() => ({
  mockState: {
    storageData: {},
    acceptedLanguages: ["en"],
    commandResults: [],
    manifest: { version: "1.2.3", commands: {} },
    pendingCommandsCallback: null,
    storageGetMock: vi.fn(),
    storageSetMock: vi.fn(),
    addStorageListenerMock: vi.fn(),
    getAcceptLanguagesMock: vi.fn(),
    commandsGetAllMock: vi.fn(),
    getManifestMock: vi.fn(),
    reloadMock: vi.fn(),
    capturedStorageListener: null,
  },
  normalizeLanguageCode: (lang) => {
    if (!lang) return lang;
    const map = {
      "en-US": "en",
      "en-GB": "en",
      "pt-BR": "pt",
      "pt-PT": "pt",
      "fr-CA": "fr",
    };
    if (lang === "invalid") return null;
    return map[lang] ?? lang;
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: vi.fn((lang) => normalizeLanguageCode(lang)),
    codeToLanguage: vi.fn((lang) => ({
      en: "English",
      es: "Spanish",
      de: "German",
      fr: "French",
      pt: "Portuguese",
    }[normalizeLanguageCode(lang)] || lang)),
    otherConfigs: {},
  },
}));

function resetMockState() {
  mockState.storageData = {};
  mockState.acceptedLanguages = ["en"];
  mockState.commandResults = [];
  mockState.manifest = { version: "1.2.3", commands: {} };
  mockState.pendingCommandsCallback = null;
  mockState.capturedStorageListener = null;

  mockState.storageGetMock.mockReset().mockImplementation((keys, callback) => {
    callback(structuredClone(mockState.storageData));
  });
  mockState.storageSetMock.mockReset().mockImplementation((value, callback) => {
    Object.assign(mockState.storageData, structuredClone(value));
    if (typeof callback === "function") callback();
  });
  mockState.addStorageListenerMock.mockReset().mockImplementation((listener) => {
    mockState.capturedStorageListener = listener;
  });
  mockState.getAcceptLanguagesMock.mockReset().mockImplementation((callback) => {
    callback([...mockState.acceptedLanguages]);
  });
  mockState.commandsGetAllMock.mockReset().mockImplementation((callback) => {
    callback([...mockState.commandResults]);
  });
  mockState.getManifestMock.mockReset().mockImplementation(() => mockState.manifest);
  mockState.reloadMock.mockReset();
}

function installChromeMock() {
  globalThis.chrome = {
    storage: {
      local: {
        get: mockState.storageGetMock,
        set: mockState.storageSetMock,
      },
      onChanged: {
        addListener: mockState.addStorageListenerMock,
      },
    },
    i18n: {
      getAcceptLanguages: mockState.getAcceptLanguagesMock,
    },
    commands: {
      getAll: mockState.commandsGetAllMock,
    },
    runtime: {
      getManifest: mockState.getManifestMock,
      reload: mockState.reloadMock,
    },
  };
}

async function importConfigModule() {
  const module = await import("../../src/lib/config.js");
  return module.default;
}

async function loadReadyConfig() {
  const twpConfig = await importConfigModule();
  await twpConfig.onReady();
  return twpConfig;
}

function storagePayloads() {
  return mockState.storageSetMock.mock.calls.map(([value]) => value);
}

describe("twpConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    resetMockState();
    installChromeMock();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete globalThis.browser;
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.browser;
    vi.useRealTimers();
  });

  it("loads config from storage.local and resolves onReady", async () => {
    mockState.storageData = {
      alwaysTranslateSites: ["stored.example"],
      customDictionary: { hello: "bonjour" },
      targetLanguages: ["de", "fr", "es"],
      targetLanguage: "fr",
      targetLanguageTextTranslation: "de",
    };

    const twpConfig = await importConfigModule();
    const readySpy = vi.fn();

    await twpConfig.onReady(readySpy);

    expect(mockState.getAcceptLanguagesMock).toHaveBeenCalledOnce();
    expect(mockState.storageGetMock).toHaveBeenCalledWith(null, expect.any(Function));
    expect(readySpy).toHaveBeenCalledOnce();
    expect(twpConfig.get("alwaysTranslateSites")).toEqual(["stored.example"]);
    expect(twpConfig.get("customDictionary")).toBeInstanceOf(Map);
    expect([...twpConfig.get("customDictionary").entries()]).toEqual([["hello", "bonjour"]]);
  });

  it("returns the initialized default targetLanguage via get", async () => {
    const twpConfig = await loadReadyConfig();

    expect(twpConfig.get("targetLanguage")).toBe("en");
    expect(twpConfig.get("targetLanguageTextTranslation")).toBe("en");
  });

  it("waits for async readiness before firing onReady callbacks", async () => {
    mockState.commandsGetAllMock.mockReset().mockImplementation((callback) => {
      mockState.pendingCommandsCallback = callback;
    });

    const twpConfig = await importConfigModule();
    const readySpy = vi.fn();
    const readyPromise = twpConfig.onReady(readySpy);

    expect(readySpy).not.toHaveBeenCalled();

    mockState.pendingCommandsCallback([{ name: "open-popup", shortcut: "Alt+T" }]);
    await readyPromise;

    expect(readySpy).toHaveBeenCalledOnce();
    expect(twpConfig.get("hotkeys")).toEqual({ "open-popup": "Alt+T" });
  });

  it("fires onReady callbacks immediately after config is ready", async () => {
    const twpConfig = await loadReadyConfig();
    const readySpy = vi.fn();

    await twpConfig.onReady(readySpy);

    expect(readySpy).toHaveBeenCalledOnce();
  });

  it("set stores values in chrome.storage.local", async () => {
    const twpConfig = await loadReadyConfig();
    mockState.storageSetMock.mockClear();

    twpConfig.set("targetLanguage", "de");

    expect(twpConfig.get("targetLanguage")).toBe("de");
    expect(mockState.storageSetMock).toHaveBeenCalledOnce();
    expect(mockState.storageSetMock).toHaveBeenCalledWith({ targetLanguage: "de" });
  });

  it("notifies onChanged observers when set is invoked", async () => {
    const twpConfig = await loadReadyConfig();
    const observer = vi.fn();
    twpConfig.onChanged(observer);

    twpConfig.set("showReleaseNotes", "yes");

    expect(observer).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledWith("showReleaseNotes", "yes");
  });

  it("updates in-memory config and observers for external storage changes", async () => {
    const twpConfig = await loadReadyConfig();
    const observer = vi.fn();
    twpConfig.onChanged(observer);

    mockState.capturedStorageListener(
      {
        targetLanguage: { newValue: "de" },
        alwaysTranslateSites: { newValue: ["external.example"] },
      },
      "local"
    );

    expect(twpConfig.get("targetLanguage")).toBe("de");
    expect(twpConfig.get("alwaysTranslateSites")).toEqual(["external.example"]);
    expect(observer).toHaveBeenNthCalledWith(1, "targetLanguage", "de");
    expect(observer).toHaveBeenNthCalledWith(2, "alwaysTranslateSites", ["external.example"]);
  });

  it("exports every config key with version and timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-02T03:04:05.000Z"));
    mockState.storageData = {
      customDictionary: { hello: "bonjour" },
      targetLanguages: ["fr", "en", "es"],
      targetLanguage: "fr",
      targetLanguageTextTranslation: "en",
    };
    const twpConfig = await loadReadyConfig();

    const exported = JSON.parse(twpConfig.export());

    const exportedKeys = Object.keys(exported).sort();
    // Verify all expected keys are present (new keys may be added over time)
    for (const key of expectedExportKeys) {
      expect(exportedKeys).toContain(key);
    }
    expect(exported.timeStamp).toBe(new Date("2025-01-02T03:04:05.000Z").getTime());
    expect(exported.version).toBe("1.2.3");
    expect(exported.customDictionary).toEqual({ hello: "bonjour" });
  });

  it("imports provided config keys, converts map-like values, and reloads", async () => {
    const twpConfig = await loadReadyConfig();
    mockState.storageSetMock.mockClear();

    twpConfig.import(
      JSON.stringify({
        targetLanguage: "de",
        alwaysTranslateSites: ["imported.example"],
        customDictionary: { world: "welt" },
      })
    );

    expect(storagePayloads()).toEqual([
      { targetLanguage: "de" },
      { alwaysTranslateSites: ["imported.example"] },
      { customDictionary: { world: "welt" } },
    ]);
    expect(twpConfig.get("targetLanguage")).toBe("de");
    expect([...twpConfig.get("customDictionary").entries()]).toEqual([["world", "welt"]]);
    expect(mockState.reloadMock).toHaveBeenCalledOnce();
  });

  it("restores defaults and reloads the extension", async () => {
    const twpConfig = await loadReadyConfig();
    twpConfig.set("targetLanguage", "de");
    twpConfig.set("alwaysTranslateSites", ["custom.example"]);
    mockState.storageSetMock.mockClear();
    mockState.reloadMock.mockClear();

    twpConfig.restoreToDefault();

    expect(twpConfig.get("targetLanguage")).toBeNull();
    expect(twpConfig.get("targetLanguages")).toEqual([]);
    expect(twpConfig.get("alwaysTranslateSites")).toEqual([]);
    expect(twpConfig.get("customDictionary")).toBeInstanceOf(Map);
    expect(twpConfig.get("customDictionary").size).toBe(0);
    expect(storagePayloads()).toContainEqual({ targetLanguage: null });
    expect(storagePayloads()).toContainEqual({ targetLanguages: [] });
    expect(mockState.reloadMock).toHaveBeenCalledOnce();
  });

  it("adds unique sites to translate-when-hovering", async () => {
    const twpConfig = await loadReadyConfig();

    twpConfig.addSiteToTranslateWhenHovering("hover.example");
    twpConfig.addSiteToTranslateWhenHovering("hover.example");

    expect(twpConfig.get("sitesToTranslateWhenHovering")).toEqual(["hover.example"]);
  });

  it("removes sites from translate-when-hovering", async () => {
    mockState.storageData = { sitesToTranslateWhenHovering: ["hover.example"] };
    const twpConfig = await loadReadyConfig();

    twpConfig.removeSiteFromTranslateWhenHovering("hover.example");

    expect(twpConfig.get("sitesToTranslateWhenHovering")).toEqual([]);
  });

  it("adds unique languages to translate-when-hovering", async () => {
    const twpConfig = await loadReadyConfig();

    twpConfig.addLangToTranslateWhenHovering("fr");
    twpConfig.addLangToTranslateWhenHovering("fr");

    expect(twpConfig.get("langsToTranslateWhenHovering")).toEqual(["fr"]);
  });

  it("removes languages from translate-when-hovering", async () => {
    mockState.storageData = { langsToTranslateWhenHovering: ["fr"] };
    const twpConfig = await loadReadyConfig();

    twpConfig.removeLangFromTranslateWhenHovering("fr");

    expect(twpConfig.get("langsToTranslateWhenHovering")).toEqual([]);
  });

  it("adds sites to always-translate and removes them from never-translate", async () => {
    mockState.storageData = { neverTranslateSites: ["example.com"] };
    const twpConfig = await loadReadyConfig();

    twpConfig.addSiteToAlwaysTranslate("example.com");

    expect(twpConfig.get("alwaysTranslateSites")).toEqual(["example.com"]);
    expect(twpConfig.get("neverTranslateSites")).toEqual([]);
  });

  it("removes sites from always-translate", async () => {
    mockState.storageData = { alwaysTranslateSites: ["example.com"] };
    const twpConfig = await loadReadyConfig();

    twpConfig.removeSiteFromAlwaysTranslate("example.com");

    expect(twpConfig.get("alwaysTranslateSites")).toEqual([]);
  });

  it("adds sites to never-translate and removes conflicting site lists", async () => {
    mockState.storageData = {
      alwaysTranslateSites: ["example.com"],
      sitesToTranslateWhenHovering: ["example.com"],
    };
    const twpConfig = await loadReadyConfig();

    twpConfig.addSiteToNeverTranslate("example.com");

    expect(twpConfig.get("neverTranslateSites")).toEqual(["example.com"]);
    expect(twpConfig.get("alwaysTranslateSites")).toEqual([]);
    expect(twpConfig.get("sitesToTranslateWhenHovering")).toEqual([]);
  });

  it("adds keywords to the custom dictionary without overwriting existing entries", async () => {
    mockState.storageData = { customDictionary: { hello: "bonjour" } };
    const twpConfig = await loadReadyConfig();
    mockState.storageSetMock.mockClear();

    twpConfig.addKeyWordTocustomDictionary("hello", "salut");
    twpConfig.addKeyWordTocustomDictionary("world", "monde");

    expect([...twpConfig.get("customDictionary").entries()]).toEqual([
      ["hello", "bonjour"],
      ["world", "monde"],
    ]);
    expect(storagePayloads()).toEqual([{ customDictionary: { hello: "bonjour", world: "monde" } }]);
  });

  it("removes sites from never-translate", async () => {
    mockState.storageData = { neverTranslateSites: ["example.com"] };
    const twpConfig = await loadReadyConfig();

    twpConfig.removeSiteFromNeverTranslate("example.com");

    expect(twpConfig.get("neverTranslateSites")).toEqual([]);
  });

  it("removes keywords from the custom dictionary", async () => {
    mockState.storageData = { customDictionary: { hello: "bonjour", world: "monde" } };
    const twpConfig = await loadReadyConfig();

    twpConfig.removeKeyWordFromcustomDictionary("hello");

    expect([...twpConfig.get("customDictionary").entries()]).toEqual([["world", "monde"]]);
    expect(storagePayloads().at(-1)).toEqual({ customDictionary: { world: "monde" } });
  });

  it("adds languages to always-translate and removes conflicts", async () => {
    mockState.storageData = {
      neverTranslateLangs: ["fr"],
      neverTranslateSites: ["example.com"],
    };
    const twpConfig = await loadReadyConfig();

    twpConfig.addLangToAlwaysTranslate("fr", "example.com");

    expect(twpConfig.get("alwaysTranslateLangs")).toEqual(["fr"]);
    expect(twpConfig.get("neverTranslateLangs")).toEqual([]);
    expect(twpConfig.get("neverTranslateSites")).toEqual([]);
  });

  it("removes languages from always-translate", async () => {
    mockState.storageData = { alwaysTranslateLangs: ["fr"] };
    const twpConfig = await loadReadyConfig();

    twpConfig.removeLangFromAlwaysTranslate("fr");

    expect(twpConfig.get("alwaysTranslateLangs")).toEqual([]);
  });

  it("adds languages to never-translate and removes conflicting rules", async () => {
    mockState.storageData = {
      alwaysTranslateLangs: ["fr"],
      langsToTranslateWhenHovering: ["fr"],
      alwaysTranslateSites: ["example.com"],
    };
    const twpConfig = await loadReadyConfig();

    twpConfig.addLangToNeverTranslate("fr", "example.com");

    expect(twpConfig.get("neverTranslateLangs")).toEqual(["fr"]);
    expect(twpConfig.get("alwaysTranslateLangs")).toEqual([]);
    expect(twpConfig.get("langsToTranslateWhenHovering")).toEqual([]);
    expect(twpConfig.get("alwaysTranslateSites")).toEqual([]);
  });

  it("removes languages from never-translate", async () => {
    mockState.storageData = { neverTranslateLangs: ["fr"] };
    const twpConfig = await loadReadyConfig();

    twpConfig.removeLangFromNeverTranslate("fr");

    expect(twpConfig.get("neverTranslateLangs")).toEqual([]);
  });

  it("setTargetLanguage updates page target without reordering existing targetLanguages", async () => {
    mockState.storageData = {
      targetLanguages: ["en", "es", "de"],
      targetLanguage: "en",
      targetLanguageTextTranslation: "en",
    };
    const twpConfig = await loadReadyConfig();

    twpConfig.setTargetLanguage("de");

    expect(twpConfig.get("targetLanguage")).toBe("de");
    expect(twpConfig.get("targetLanguages")).toEqual(["en", "es", "de"]);
    expect(twpConfig.get("targetLanguageTextTranslation")).toBe("en");
  });

  it("setTargetLanguage adds a missing language to the front of targetLanguages", async () => {
    mockState.storageData = {
      targetLanguages: ["en", "es", "de"],
      targetLanguage: "en",
      targetLanguageTextTranslation: "en",
    };
    const twpConfig = await loadReadyConfig();

    twpConfig.setTargetLanguage("fr");

    expect(twpConfig.get("targetLanguage")).toBe("fr");
    expect(twpConfig.get("targetLanguages")).toEqual(["fr", "en", "es"]);
  });

  it("setTargetLanguage updates both page and text targets when forTextToo is true", async () => {
    mockState.storageData = {
      targetLanguages: ["en", "es", "de"],
      targetLanguage: "en",
      targetLanguageTextTranslation: "es",
    };
    const twpConfig = await loadReadyConfig();

    twpConfig.setTargetLanguage("fr", true);

    expect(twpConfig.get("targetLanguage")).toBe("fr");
    expect(twpConfig.get("targetLanguageTextTranslation")).toBe("fr");
    expect(twpConfig.get("targetLanguages")).toEqual(["fr", "en", "es"]);
  });

  it("setTargetLanguage ignores invalid language codes", async () => {
    const twpConfig = await loadReadyConfig();
    const before = structuredClone(twpConfig.get("targetLanguages"));

    twpConfig.setTargetLanguage("invalid");

    expect(twpConfig.get("targetLanguage")).toBe("en");
    expect(twpConfig.get("targetLanguages")).toEqual(before);
  });

  it("setTargetLanguageTextTranslation updates only the text translation target", async () => {
    mockState.storageData = {
      targetLanguages: ["en", "es", "de"],
      targetLanguage: "en",
      targetLanguageTextTranslation: "en",
    };
    const twpConfig = await loadReadyConfig();

    twpConfig.setTargetLanguageTextTranslation("de");

    expect(twpConfig.get("targetLanguage")).toBe("en");
    expect(twpConfig.get("targetLanguageTextTranslation")).toBe("de");
  });

  it("restores object-backed map fields to Map instances on load", async () => {
    mockState.storageData = { customDictionary: { hello: "hola" } };
    const twpConfig = await loadReadyConfig();

    expect(twpConfig.get("customDictionary")).toBeInstanceOf(Map);
    expect([...twpConfig.get("customDictionary").entries()]).toEqual([["hello", "hola"]]);
  });

  it("fills targetLanguages from accepted languages and defaults up to three entries", async () => {
    mockState.acceptedLanguages = ["pt-BR", "fr", "en-US"];
    mockState.storageData = { targetLanguages: [] };
    const twpConfig = await loadReadyConfig();

    expect(twpConfig.get("targetLanguages")).toEqual(["pt", "fr", "en"]);
    expect(twpConfig.get("targetLanguage")).toBe("pt");
    expect(twpConfig.get("targetLanguageTextTranslation")).toBe("pt");
  });

  it("replaces malformed targetLanguages entries with defaults during load", async () => {
    mockState.storageData = { targetLanguages: [undefined, "fr"] };
    const twpConfig = await loadReadyConfig();

    expect(twpConfig.get("targetLanguages")).toEqual(["en", "es", "de"]);
    expect(storagePayloads()).toContainEqual({ targetLanguages: ["en", "es", "de"] });
  });
});
