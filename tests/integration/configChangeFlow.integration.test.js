import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let _moduleLoadSeq = 0; // 确定性 cache-busting（替代 Math.random()）

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_MODULE_URL = pathToFileURL(resolve(__dirname, "../../src/lib/config.js")).href;

const expectedConfigKeys = [
  "openAiUserType",
  "enableAiTranslationCache",
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
  "openAiApiBase",
  "anthropicApiBase",
  "googleGeminiApiBase",
  "deepSeekApiBase",
  "grokApiBase",
];

const mockState = vi.hoisted(() => ({
  acceptedLanguages: ["fr-CA", "de-DE", "es-ES"],
  storageData: {},
  storageSetCalls: [],
  storageChangeListeners: [],
  acceptLanguagesCallbacks: [],
  fixTLanguageCodeMock: vi.fn(),
  getAcceptLanguagesMock: vi.fn(),
  storageGetMock: vi.fn(),
  storageSetMock: vi.fn(),
  storageAddListenerMock: vi.fn(),
  getManifestMock: vi.fn(),
  runtimeReloadMock: vi.fn(),
  commandsGetAllMock: vi.fn(),
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: (...args) => mockState.fixTLanguageCodeMock(...args),
  },
}));

function clone(value) {
  return structuredClone(value);
}

function flush() {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

function resetMockState() {
  mockState.acceptedLanguages = ["fr-CA", "de-DE", "es-ES"];
  mockState.storageData = {};
  mockState.storageSetCalls.length = 0;
  mockState.storageChangeListeners.length = 0;
  mockState.acceptLanguagesCallbacks.length = 0;
  mockState.fixTLanguageCodeMock.mockReset().mockImplementation((language) => {
    if (!language) return language;
    if (language === "pt-BR") return "pt";
    if (language === "fr-CA") return "fr";
    if (language === "de-DE") return "de";
    if (language === "es-ES") return "es";
    return language;
  });
  mockState.getAcceptLanguagesMock.mockReset().mockImplementation((callback) => {
    callback([...mockState.acceptedLanguages]);
  });
  mockState.storageGetMock.mockReset().mockImplementation((_keys, callback) => {
    callback(clone(mockState.storageData));
  });
  mockState.storageSetMock.mockReset().mockImplementation((value) => {
    mockState.storageSetCalls.push(clone(value));
  });
  mockState.storageAddListenerMock.mockReset().mockImplementation((listener) => {
    mockState.storageChangeListeners.push(listener);
  });
  mockState.getManifestMock.mockReset().mockReturnValue({
    version: "9.9.9",
    commands: {},
  });
  mockState.runtimeReloadMock.mockReset();
  mockState.commandsGetAllMock.mockReset().mockImplementation((callback) => {
    callback([]);
  });
}

function installChromeMock() {
  globalThis.chrome = {
    storage: {
      local: {
        get: mockState.storageGetMock,
        set: mockState.storageSetMock,
      },
      onChanged: {
        addListener: mockState.storageAddListenerMock,
      },
    },
    i18n: {
      getAcceptLanguages: mockState.getAcceptLanguagesMock,
    },
    runtime: {
      getManifest: mockState.getManifestMock,
      reload: mockState.runtimeReloadMock,
    },
    commands: {
      getAll: mockState.commandsGetAllMock,
    },
  };
}

async function importConfigModule() {
  const module = await import(`${CONFIG_MODULE_URL}?t=${Date.now()}-${_moduleLoadSeq++}`);
  return module.default;
}

async function loadReadyConfig() {
  const twpConfig = await importConfigModule();
  await twpConfig.onReady();
  await flush();
  return twpConfig;
}

describe("config change flow integration", () => {
  beforeEach(() => {
    vi.resetModules();
    resetMockState();
    installChromeMock();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete globalThis.browser;
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.browser;
  });

  it("updates in-memory config immediately when set is called", async () => {
    const twpConfig = await loadReadyConfig();

    twpConfig.set("darkMode", "yes");

    expect(twpConfig.get("darkMode")).toBe("yes");
  });

  it("persists customDictionary as a plain object when set is called", async () => {
    const twpConfig = await loadReadyConfig();
    const dictionary = new Map([
      ["hello", "bonjour"],
      ["world", "monde"],
    ]);

    twpConfig.set("customDictionary", dictionary);

    expect(mockState.storageSetMock).toHaveBeenCalledWith({
      customDictionary: {
        hello: "bonjour",
        world: "monde",
      },
    });
    expect(twpConfig.get("customDictionary")).toBe(dictionary);
  });

  it("notifies onChanged observers with the changed key and value", async () => {
    const twpConfig = await loadReadyConfig();
    const observer = vi.fn();

    twpConfig.onChanged(observer);
    twpConfig.set("showReleaseNotes", "yes");

    expect(observer).toHaveBeenCalledWith("showReleaseNotes", "yes");
  });

  it("notifies multiple observers from a single local set call", async () => {
    const twpConfig = await loadReadyConfig();
    const firstObserver = vi.fn();
    const secondObserver = vi.fn();

    twpConfig.onChanged(firstObserver);
    twpConfig.onChanged(secondObserver);
    twpConfig.set("translatedColor", "rgba(255, 0, 0, 1)");

    expect(firstObserver).toHaveBeenCalledWith("translatedColor", "rgba(255, 0, 0, 1)");
    expect(secondObserver).toHaveBeenCalledWith("translatedColor", "rgba(255, 0, 0, 1)");
  });

  it("propagates storage.onChanged updates from another context when the value differs", async () => {
    const twpConfig = await loadReadyConfig();
    const observer = vi.fn();

    twpConfig.onChanged(observer);
    mockState.storageChangeListeners[0]({
      darkMode: {
        newValue: "yes",
      },
    }, "local");
    await flush();

    expect(twpConfig.get("darkMode")).toBe("yes");
    expect(observer).toHaveBeenCalledWith("darkMode", "yes");
  });

  it("deduplicates same-value storage.onChanged updates in the same context", async () => {
    const twpConfig = await loadReadyConfig();
    const observer = vi.fn();

    twpConfig.set("darkMode", "yes");
    observer.mockClear();
    twpConfig.onChanged(observer);

    mockState.storageChangeListeners[0]({
      darkMode: {
        newValue: "yes",
      },
    }, "local");
    await flush();

    expect(observer).not.toHaveBeenCalled();
  });

  it("ignores storage changes from non-local areas", async () => {
    const twpConfig = await loadReadyConfig();
    const observer = vi.fn();

    twpConfig.onChanged(observer);
    mockState.storageChangeListeners[0]({
      darkMode: {
        newValue: "yes",
      },
    }, "sync");
    await flush();

    expect(twpConfig.get("darkMode")).toBe("auto");
    expect(observer).not.toHaveBeenCalled();
  });

  it("fires queued onReady callbacks after async initialization completes", async () => {
    mockState.getAcceptLanguagesMock.mockReset().mockImplementation((callback) => {
      mockState.acceptLanguagesCallbacks.push(callback);
    });

    const twpConfig = await importConfigModule();
    const onReadyObserver = vi.fn();

    twpConfig.onReady(onReadyObserver);
    expect(onReadyObserver).not.toHaveBeenCalled();

    mockState.acceptLanguagesCallbacks[0](["fr-CA", "de-DE", "es-ES"]);
    await twpConfig.onReady();

    expect(onReadyObserver).toHaveBeenCalledOnce();
  });

  it("exports a complete JSON snapshot with metadata and all config keys", async () => {
    const twpConfig = await loadReadyConfig();

    twpConfig.set("showReleaseNotes", "yes");
    const exportedConfig = JSON.parse(twpConfig.export());

    expect(exportedConfig.version).toBe("9.9.9");
    expect(typeof exportedConfig.timeStamp).toBe("number");
    expect(Object.keys(exportedConfig).sort()).toEqual([
      "timeStamp",
      "version",
      ...expectedConfigKeys,
    ].sort());
    expect(exportedConfig.showReleaseNotes).toBe("yes");
  });

  it("imports each provided key through set and reloads the extension", async () => {
    const twpConfig = await loadReadyConfig();
    const setSpy = vi.spyOn(twpConfig, "set");

    twpConfig.import(JSON.stringify({
      darkMode: "yes",
      customDictionary: {
        hello: "bonjour",
      },
      targetLanguage: "fr",
    }));

    expect(setSpy).toHaveBeenCalledWith("darkMode", "yes");
    expect(setSpy).toHaveBeenCalledWith("customDictionary", new Map([["hello", "bonjour"]]));
    expect(setSpy).toHaveBeenCalledWith("targetLanguage", "fr");
    expect(setSpy).toHaveBeenCalledTimes(3);
    expect(mockState.runtimeReloadMock).toHaveBeenCalledOnce();
  });

  it("initializes targetLanguages from accepted browser languages when storage is empty", async () => {
    mockState.acceptedLanguages = ["pt-BR", "fr-CA", "de-DE", "es-ES"];
    const twpConfig = await loadReadyConfig();

    expect(twpConfig.get("targetLanguages")).toEqual(["pt", "fr", "de"]);
    expect(twpConfig.get("targetLanguage")).toBe("pt");
    expect(twpConfig.get("targetLanguageTextTranslation")).toBe("pt");
  });
});
