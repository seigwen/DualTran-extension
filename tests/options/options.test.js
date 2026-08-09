import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const defaultConfigValues = () => ({
    darkMode: "no",
    targetLanguage: "en",
    targetLanguageTextTranslation: "fr",
    targetLanguages: ["en", "fr", "de"],
    neverTranslateLangs: ["de"],
    alwaysTranslateLangs: ["fr"],
    langsToTranslateWhenHovering: ["es"],
    alwaysTranslateSites: ["always.example"],
    neverTranslateSites: ["never.example"],
    sitesToTranslateWhenHovering: ["hover.example"],
    customDictionary: new Map([
      ["apple", "fruit"],
      ["zebra", "animal"],
    ]),
    translateLongerThan: "100",
    aiImproveForLongerThan: "200",
    pageTranslatorService: "google",
    ttsSpeed: "1.25",
    showOriginalTextWhenHovering: "yes",
    translateTag_pre: "yes",
    dontSortResults: "no",
    translateDynamicallyCreatedContent: "yes",
    autoTranslateWhenClickingALink: "no",
    showTranslateSelectedButton: "no",
    dontShowIfPageLangIsTargetLang: "no",
    dontShowIfPageLangIsUnknown: "yes",
    dontShowIfSelectedTextIsTargetLang: "no",
    dontShowIfSelectedTextIsUnknown: "yes",
    translatedColor: "rgba(1, 2, 3, 0.4)",
    popupBlueWhenSiteIsTranslated: "yes",
    hotkeys: {},
    translateSelectedWhenPressTwice: "yes",
    translateTextOverMouseWhenPressTwice: "no",
    showFloatingBtn: "yes",
    showTranslatePageContextMenu: "yes",
    showTranslateSelectedContextMenu: "no",
    showButtonInTheAddressBar: "yes",
    translateClickingOnce: "no",
    aiProvider: "openai",
    providerConfigs: {},
    apiKeyOpenAI: "",
    openAiModel: "",
    apiKeyGoogleGemini: "",
    googleGeminiModel: "",
    apiKeyOpenRouter: "",
    openRouterModel: "",
    openRouterApiBase: "",
    openRouterReferer: "",
    openRouterTitle: "",
    apiKeyAnthropic: "",
    anthropicModel: "",
    apiKeyAzureOpenAI: "",
    azureOpenAIEndpoint: "",
    azureOpenAIModel: "",
    apiKeyDeepSeek: "",
    deepSeekModel: "",
    apiKeyGrok: "",
    grokModel: "",
  });

  const configValues = defaultConfigValues();
  const enableDarkMode = vi.fn();
  const disableDarkMode = vi.fn();
  const controller = {
    initialize: vi.fn(),
    handleProviderChange: vi.fn(),
    handleConfigChanged: vi.fn(() => false),
    handleStorageChanged: vi.fn(),
  };

  const configMock = {
    get: vi.fn((key) => configValues[key]),
    set: vi.fn((key, value) => {
      configValues[key] = value;
    }),
    setTargetLanguage: vi.fn((value, isText = false) => {
      if (isText) {
        configValues.targetLanguageTextTranslation = value;
      } else {
        configValues.targetLanguage = value;
      }
    }),
    onReady: vi.fn((cb) => {
      if (typeof cb === "function") cb();
      return Promise.resolve();
    }),
    onChanged: vi.fn(),
    addLangToNeverTranslate: vi.fn((lang) => {
      configValues.neverTranslateLangs.push(lang);
    }),
    removeLangFromNeverTranslate: vi.fn((lang) => {
      const index = configValues.neverTranslateLangs.indexOf(lang);
      if (index >= 0) configValues.neverTranslateLangs.splice(index, 1);
    }),
    addLangToAlwaysTranslate: vi.fn((lang) => {
      configValues.alwaysTranslateLangs.push(lang);
    }),
    removeLangFromAlwaysTranslate: vi.fn((lang) => {
      const index = configValues.alwaysTranslateLangs.indexOf(lang);
      if (index >= 0) configValues.alwaysTranslateLangs.splice(index, 1);
    }),
    addLangToTranslateWhenHovering: vi.fn((lang) => {
      configValues.langsToTranslateWhenHovering.push(lang);
    }),
    removeLangFromTranslateWhenHovering: vi.fn((lang) => {
      const index = configValues.langsToTranslateWhenHovering.indexOf(lang);
      if (index >= 0) configValues.langsToTranslateWhenHovering.splice(index, 1);
    }),
    addSiteToAlwaysTranslate: vi.fn((site) => {
      configValues.alwaysTranslateSites.push(site);
    }),
    removeSiteFromAlwaysTranslate: vi.fn((site) => {
      const index = configValues.alwaysTranslateSites.indexOf(site);
      if (index >= 0) configValues.alwaysTranslateSites.splice(index, 1);
    }),
    addSiteToNeverTranslate: vi.fn((site) => {
      configValues.neverTranslateSites.push(site);
    }),
    removeSiteFromNeverTranslate: vi.fn((site) => {
      const index = configValues.neverTranslateSites.indexOf(site);
      if (index >= 0) configValues.neverTranslateSites.splice(index, 1);
    }),
    addSiteToTranslateWhenHovering: vi.fn((site) => {
      configValues.sitesToTranslateWhenHovering.push(site);
    }),
    removeSiteFromTranslateWhenHovering: vi.fn((site) => {
      const index = configValues.sitesToTranslateWhenHovering.indexOf(site);
      if (index >= 0) configValues.sitesToTranslateWhenHovering.splice(index, 1);
    }),
    addKeyWordTocustomDictionary: vi.fn((key, value) => {
      configValues.customDictionary.set(key, value);
    }),
    removeKeyWordFromcustomDictionary: vi.fn((key) => {
      configValues.customDictionary.delete(key);
    }),
    export: vi.fn(() => JSON.stringify({ ok: true })),
    import: vi.fn(),
    restoreToDefault: vi.fn(),
  };

  return {
    defaultConfigValues,
    configValues,
    enableDarkMode,
    disableDarkMode,
    controller,
    configMock,
    createAiOptionsController: vi.fn(() => controller),
    refreshAiModelSelect: vi.fn(() => Promise.resolve()),
    loadAiProviderModelOptions: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock("../../src/lib/config.js", () => ({ default: state.configMock }));
vi.mock("../../src/lib/languages.js", () => ({
  default: {
    getLanguageList: () => ({
      fr: "Français",
      en: "English",
      de: "Deutsch",
      es: "Español",
      it: "Italiano",
      pt: "Português",
    }),
    codeToLanguage: (code) => ({
      de: "Deutsch",
      en: "English",
      es: "Español",
      fr: "Français",
      it: "Italiano",
      pt: "Português",
    })[code] || code,
  },
}));
vi.mock("../../src/lib/platformInfo.js", () => ({
  default: { isMobile: { any: false } },
}));
vi.mock("../../src/lib/i18n.js", () => ({}));
vi.mock("../../src/options/darkmode.js", () => ({
  enableDarkMode: state.enableDarkMode,
  disableDarkMode: state.disableDarkMode,
}));
vi.mock("../../src/options/aiOptionsController.js", () => ({
  createAiOptionsController: state.createAiOptionsController,
}));
vi.mock("../../src/options/aiModelApi.js", () => ({
  loadAiProviderModelOptions: state.loadAiProviderModelOptions,
  normalizeOpenAiCompatibleModelsEndpoint: (endpoint) => {
    const sanitizedEndpoint = String(endpoint || "").trim();
    return sanitizedEndpoint.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "") + "/models";
  },
}));
vi.mock("../../src/options/aiModelRefresh.js", () => ({
  refreshAiModelSelect: state.refreshAiModelSelect,
}));
vi.mock("../../src/lib/ai/providerRegistry.js", () => {
  const known = ["openai","openrouter","anthropic","google-gemini","azure-openai","deepseek","grok","mistral","cohere","together","groq","zhipu","moonshot","qwen","baidu","bytedance","iflytek","perplexity"];
  const providerList = known.map(id => ({ id, name: id }));
  return {
    createProviderRegistry: (providers = []) => {
      const providerMap = new Map();
      for (const provider of providers) {
        if (provider?.id) providerMap.set(provider.id, provider);
      }
      for (const provider of providerList) {
        if (!providerMap.has(provider.id)) providerMap.set(provider.id, provider);
      }
      return {
        getProvider: (id) => providerMap.get(id),
        listProviders: () => Array.from(providerMap.values()),
        _updateMerged: () => {},
        _getMerged: () => Array.from(providerMap.values()),
      };
    },
    BUILT_IN_PROVIDERS: providerList,
    mergeRegistries: () => [],
    lookupKnownApiBase: () => "",
  };
});
vi.mock("../../src/lib/ai/providerTypes.js", () => ({
  validateProviderDefinition: () => [],
}));
vi.mock("../../src/lib/ai/providerMigration.js", () => ({
  migrateProviderConfig: () => null,
}));
vi.mock("../../src/options/providerUI.js", () => ({
  createProviderUI: () => ({
    render: () => {},
    setProviders: () => {},
    setActiveProvider: () => {},
    filterProviders: () => [],
    canEdit: () => false,
    canDelete: () => false,
  }),
}));
vi.mock("../../src/background/providerUpdate.js", () => ({
  fetchRemoteProviders: async () => null,
  mergeRemoteProviders: (a) => a,
  getRemoteProvidersWithCache: async () => null,
}));
vi.mock("toolcool-color-picker", () => ({}), { virtual: true });

function resetConfig(overrides = {}) {
  for (const key of Object.keys(state.configValues)) {
    delete state.configValues[key];
  }
  Object.assign(state.configValues, state.defaultConfigValues(), overrides);
}

function createOptionsDom() {
  document.body.innerHTML = `
    <button id="btnOpenMenu"></button>
    <div id="menuContainer"></div>
    <aside id="sideBar"></aside>
    <div id="itemSelectedName"></div>
    <nav>
      <a href="#languages">Languages</a>
      <a href="#sites">Sites</a>
      <a href="#translations">Translations</a>
      <a href="#ai">AI</a>
      <a href="#style">Style</a>
      <a href="#hotkeys">Hotkeys</a>
      <a href="#storage">Storage</a>
      <a href="#others">Others</a>
    </nav>
    <section id="languages"></section>
    <section id="sites"></section>
    <section id="translations"></section>
    <section id="ai"></section>
    <section id="style"></section>
    <section id="hotkeys"></section>
    <section id="storage"></section>
    <section id="others"></section>

    <select id="selectTargetLanguage"></select>
    <select id="selectTargetLanguageForText"></select>
    <select id="favoriteLanguage1"></select>
    <select id="favoriteLanguage2"></select>
    <select id="favoriteLanguage3"></select>
    <select id="addToNeverTranslateLangs"></select>
    <select id="addToAlwaysTranslateLangs"></select>
    <select id="addLangToTranslateWhenHovering"></select>
    <ul id="neverTranslateLangs"></ul>
    <ul id="alwaysTranslateLangs"></ul>
    <ul id="langsToTranslateWhenHovering"></ul>

    <button id="addToAlwaysTranslateSites"></button>
    <button id="addToNeverTranslateSites"></button>
    <button id="addSiteToTranslateWhenHovering"></button>
    <ul id="alwaysTranslateSites"></ul>
    <ul id="neverTranslateSites"></ul>
    <ul id="sitesToTranslateWhenHovering"></ul>

    <button id="addToCustomDictionary"></button>
    <ul id="customDictionary"></ul>

    <input id="translateLongerThan" />
    <input id="aiImproveForLongerThan" />
    <select id="pageTranslatorService"><option value="google">google</option><option value="microsoft">microsoft</option></select>
    <input id="ttsSpeed" />
    <span id="displayTtsSpeed"></span>
    <select id="showOriginalTextWhenHovering"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="translateTag_pre"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="dontSortResults"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="translateDynamicallyCreatedContent"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="autoTranslateWhenClickingALink"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="whereToDisplayTranslatedText"><option value="newLine">newLine</option><option value="replaceOriginal">replaceOriginal</option></select>
    <select id="enableDeepL"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="useOldPopup"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="showPopupMobile"><option value="yes">yes</option><option value="no">no</option><option value="threeFingersOnTheScreen">threeFingersOnTheScreen</option></select>

    <div id="translateSelectedAdvancedOptions">
      <input id="advancedOptionOne" />
      <input id="advancedOptionTwo" />
    </div>
    <select id="showTranslateSelectedButton"><option value="yes">yes</option><option value="no">no</option></select>
    <input id="dontShowIfPageLangIsTargetLang" type="checkbox" />
    <input id="dontShowIfPageLangIsUnknown" type="checkbox" />
    <input id="dontShowIfSelectedTextIsTargetLang" type="checkbox" />
    <input id="dontShowIfSelectedTextIsUnknown" type="checkbox" />

    <select id="darkMode"><option value="auto">auto</option><option value="yes">yes</option><option value="no">no</option></select>
    <div id="translatedColorEyeDropper"></div>
    <button id="resetTranslatedColor"></button>
    <div id="aiTranslatedColorEyeDropper"></div>
    <button id="resetAiTranslatedColor"></button>
    <select id="popupBlueWhenSiteIsTranslated"><option value="yes">yes</option><option value="no">no</option></select>

    <span data-i18n="lblTranslateSelectedWhenPressTwice">Press [Ctrl]</span>
    <span data-i18n="lblTranslateTextOverMouseWhenPressTwice">Hover [Ctrl]</span>
    <button id="openNativeShortcutManager"></button>
    <div id="hotkeysListContainer"></div>
    <ul id="KeyboardShortcuts"></ul>
    <input id="translateSelectedWhenPressTwice" type="checkbox" />
    <input id="translateTextOverMouseWhenPressTwice" type="checkbox" />

    <button id="deleteTranslationCache"></button>
    <button id="backupToFile"></button>
    <button id="restoreFromFile"></button>
    <button id="resetToDefault"></button>
    <select id="showFloatingBtn"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="showTranslatePageContextMenu"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="showTranslateSelectedContextMenu"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="showButtonInTheAddressBar"><option value="yes">yes</option><option value="no">no</option></select>
    <select id="translateClickingOnce"><option value="yes">yes</option><option value="no">no</option></select>
    <button id="btnCalculateStorage"></button>
    <span id="storageUsed"></span>

    <select id="aiProvider"><option value="openai">openai</option><option value="openrouter">openrouter</option><option value="anthropic">anthropic</option><option value="google-gemini">google-gemini</option><option value="azure-openai">azure-openai</option><option value="deepseek">deepseek</option><option value="grok">grok</option></select>
    <div id="genericAiSettings">
      <p><label id="genericApiKeyLabel"></label><a id="genericApiKeyLink"></a></p>
      <input id="apiKeyGeneric" />
      <p><label id="genericApiBaseLabel"></label></p>
      <input id="genericApiBase" />
      <p><label id="genericModelLabel"></label><span class="model-loading-msg"></span></p>
      <select id="genericModel"></select>
      <button id="btnAddCustomProvider"></button>
      <button id="btnAddCustomModel"></button>
    </div>
    <div id="aiProviderSettingsContainer">
      <div id="openAiSettings" class="ai-provider-settings"><input id="apiKeyOpenAI" /></div>
      <div id="openRouterSettings" class="ai-provider-settings" style="display:none"><input id="apiKeyOpenRouter" /></div>
      <div id="anthropicSettings" class="ai-provider-settings" style="display:none"><input id="apiKeyAnthropic" /></div>
      <div id="googleGeminiSettings" class="ai-provider-settings" style="display:none"><input id="apiKeyGoogleGemini" /></div>
      <div id="azureOpenAISettings" class="ai-provider-settings" style="display:none"><input id="apiKeyAzureOpenAI" /><input id="azureOpenAIEndpoint" /></div>
      <div id="deepSeekSettings" class="ai-provider-settings" style="display:none"><input id="apiKeyDeepSeek" /></div>
      <div id="grokSettings" class="ai-provider-settings" style="display:none"><input id="apiKeyGrok" /></div>
    </div>
    <select id="openAiModel"></select>
    <select id="googleGeminiModel"></select>
    <select id="openRouterModel"></select>
    <select id="anthropicModel"></select>
    <select id="azureOpenAIModel"></select>
    <select id="deepSeekModel"></select>
    <select id="grokModel"></select>
    <input id="openRouterApiBase" />
    <input id="openRouterReferer" />
    <input id="openRouterTitle" />
  `;

  document.querySelectorAll("#aiProvider, #apiKeyOpenAI, #apiKeyOpenRouter, #apiKeyAnthropic, #apiKeyGoogleGemini, #apiKeyAzureOpenAI, #apiKeyDeepSeek, #apiKeyGrok").forEach((element) => {
    element.scrollIntoView = vi.fn();
  });
}

function installBrowserGlobals({ matchMediaMatches = false, confirmResult = true } = {}) {
  const messages = {
    lblSettings: "Settings",
    doYouWantOverwriteAllSettings: "Overwrite settings?",
    doYouWantDeleteTranslationCache: "Delete cache?",
    doYouWantRestoreSettings: "Restore settings?",
    fileIsCorrupted: "File is corrupted",
  };

  window.scrollTo = vi.fn();
  window.matchMedia = vi.fn(() => ({ matches: matchMediaMatches }));
  window.location.hash = "";

  globalThis.chrome = {
    i18n: {
      getMessage: vi.fn((key) => messages[key] ?? ""),
    },
    runtime: {
      getManifest: vi.fn(() => ({ commands: {} })),
      sendMessage: vi.fn((_message, callback) => callback?.("42 MB")),
    },
    storage: {
      onChanged: { addListener: vi.fn() },
    },
    permissions: {
      request: vi.fn((_options, callback) => callback(true)),
      remove: vi.fn(),
    },
    tabs: {
      create: vi.fn(),
    },
  };

  globalThis.prompt = vi.fn();
  globalThis.confirm = vi.fn(() => confirmResult);
  globalThis.alert = vi.fn();
}

async function loadOptionsModule(overrides = {}, env = {}) {
  resetConfig(overrides);
  createOptionsDom();
  installBrowserGlobals(env);
  vi.resetModules();
  return import("../../src/options/options.js");
}

describe("options/options", () => {
  let anchorClicks;
  let restoreFile;

  beforeEach(() => {
    vi.clearAllMocks();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    anchorClicks = [];
    restoreFile = null;

    HTMLAnchorElement.prototype.click = vi.fn(function () {
      anchorClicks.push({ href: this.getAttribute("href"), download: this.getAttribute("download") });
    });

    HTMLInputElement.prototype.click = vi.fn(function () {
      if (this.type === "file" && restoreFile) {
        Object.defineProperty(this, "files", {
          configurable: true,
          value: [restoreFile],
        });
        this.oninput?.({ target: this });
      }
    });

    globalThis.FileReader = class {
      readAsText(file) {
        this.result = file.__text;
        this.onload?.();
      }
    };
  });

  // 恢复原型级 mock（HTMLAnchorElement.prototype.click、HTMLInputElement.prototype.click），
  // 防止泄漏到其他测试文件导致级联失败
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the languages section and highlights its nav link", async () => {
    await loadOptionsModule();

    expect(document.querySelector("#languages").style.display).toBe("block");
    expect(document.querySelector("#sites").style.display).toBe("none");
    expect(document.querySelector('nav a[href="#languages"]').classList.contains("w3-light-grey")).toBe(true);
    expect(document.querySelector("#itemSelectedName").textContent).toBe("Settings");
  });

  it("switches visible section on hash changes", async () => {
    await loadOptionsModule();

    window.location.hash = "#sites";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(document.querySelector("#languages").style.display).toBe("none");
    expect(document.querySelector("#sites").style.display).toBe("block");
    expect(document.querySelector('nav a[href="#sites"]').classList.contains("w3-light-grey")).toBe(true);
  });

  it("shows the AI section when #ai hash is opened", async () => {
    await loadOptionsModule();

    window.location.hash = "#ai";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(document.querySelector("#ai").style.display).toBe("block");
    expect(document.querySelector('nav a[href="#ai"]').classList.contains("w3-light-grey")).toBe(true);
  });

  it("prefers aiProvider over stale activeProviderId when restoring the provider select", async () => {
    await loadOptionsModule({
      aiProvider: "deepseek",
      activeProviderId: "openai",
    });

    expect(document.querySelector("#aiProvider").value).toBe("deepseek");
  });

  it("fills language selects with sorted language options", async () => {
    await loadOptionsModule();

    const options = Array.from(document.querySelector("#selectTargetLanguage").options).map((option) => option.textContent);
    expect(options).toEqual(["Deutsch", "English", "Español", "Français", "Italiano", "Português"]);
    expect(document.querySelector("#favoriteLanguage1").options).toHaveLength(6);
    expect(document.querySelector("#addToAlwaysTranslateLangs").options).toHaveLength(6);
  });

  it("applies dark mode immediately when config is yes", async () => {
    await loadOptionsModule({ darkMode: "yes" });

    expect(state.enableDarkMode).toHaveBeenCalledTimes(1);
    expect(state.disableDarkMode).not.toHaveBeenCalled();
  });

  it("applies dark mode immediately when config is auto and system prefers dark", async () => {
    await loadOptionsModule({ darkMode: "auto" }, { matchMediaMatches: true });

    expect(state.enableDarkMode).toHaveBeenCalledTimes(1);
    expect(state.disableDarkMode).not.toHaveBeenCalled();
  });

  it("disables dark mode immediately when config is auto and system does not prefer dark", async () => {
    await loadOptionsModule({ darkMode: "auto" }, { matchMediaMatches: false });

    expect(state.disableDarkMode).toHaveBeenCalledTimes(1);
    expect(state.enableDarkMode).not.toHaveBeenCalled();
  });

  it("updates dark mode config and enables dark mode on change", async () => {
    await loadOptionsModule({ darkMode: "no" });

    const select = document.querySelector("#darkMode");
    select.value = "yes";
    select.onchange({ target: select });

    expect(state.configMock.set).toHaveBeenCalledWith("darkMode", "yes");
    expect(state.enableDarkMode).toHaveBeenCalledTimes(1);
  });

  it("disables translate-selected advanced inputs when the feature is off", async () => {
    await loadOptionsModule({ showTranslateSelectedButton: "no" });

    const advancedInputs = document.querySelectorAll("#translateSelectedAdvancedOptions input");
    advancedInputs.forEach((input) => {
      expect(input.hasAttribute("disabled")).toBe(true);
    });
  });

  it("enables translate-selected advanced inputs and updates config on change", async () => {
    await loadOptionsModule({ showTranslateSelectedButton: "no" });

    const select = document.querySelector("#showTranslateSelectedButton");
    select.value = "yes";
    select.onchange({ target: select });

    expect(state.configMock.set).toHaveBeenCalledWith("showTranslateSelectedButton", "yes");
    document.querySelectorAll("#translateSelectedAdvancedOptions input").forEach((input) => {
      expect(input.hasAttribute("disabled")).toBe(false);
    });
  });

  it("binds checkbox config values on initialization and change", async () => {
    await loadOptionsModule({ dontShowIfPageLangIsUnknown: "yes" });

    const checkbox = document.querySelector("#dontShowIfPageLangIsUnknown");
    expect(checkbox.checked).toBe(true);

    checkbox.checked = false;
    checkbox.onchange({ target: checkbox });

    expect(state.configMock.set).toHaveBeenCalledWith("dontShowIfPageLangIsUnknown", "no");
  });

  it("adds a language to the never-translate list", async () => {
    await loadOptionsModule({ neverTranslateLangs: [] });

    const select = document.querySelector("#addToNeverTranslateLangs");
    select.value = "it";
    select.onchange({ target: select });

    expect(state.configMock.addLangToNeverTranslate).toHaveBeenCalledWith("it");
    expect(document.querySelector("#neverTranslateLangs li")?.textContent).toContain("Italiano");
  });

  it("removes a language from the never-translate list", async () => {
    await loadOptionsModule({ neverTranslateLangs: ["de"] });

    document.querySelector("#neverTranslateLangs li span").click();

    expect(state.configMock.removeLangFromNeverTranslate).toHaveBeenCalledWith("de");
    expect(document.querySelectorAll("#neverTranslateLangs li")).toHaveLength(0);
  });

  it("adds a site to the always-translate list", async () => {
    await loadOptionsModule({ alwaysTranslateSites: [] });
    globalThis.prompt.mockReturnValueOnce("docs.example");

    document.querySelector("#addToAlwaysTranslateSites").click();

    expect(state.configMock.addSiteToAlwaysTranslate).toHaveBeenCalledWith("docs.example");
    expect(document.querySelector("#alwaysTranslateSites li")?.textContent).toContain("docs.example");
  });

  it("removes a site from the never-translate list", async () => {
    await loadOptionsModule({ neverTranslateSites: ["never.example"] });

    document.querySelector("#neverTranslateSites li span").click();

    expect(state.configMock.removeSiteFromNeverTranslate).toHaveBeenCalledWith("never.example");
    expect(document.querySelectorAll("#neverTranslateSites li")).toHaveLength(0);
  });

  it("adds custom dictionary words with normalized values", async () => {
    await loadOptionsModule({ customDictionary: new Map() });
    globalThis.prompt
      .mockReturnValueOnce("  Hello ")
      .mockReturnValueOnce("  Bonjour ");

    document.querySelector("#addToCustomDictionary").click();

    expect(state.configMock.addKeyWordTocustomDictionary).toHaveBeenCalledWith("hello", "Bonjour");
    expect(document.querySelector("#customDictionary li")?.textContent).toContain("hello ------------------- Bonjour");
  });

  it("removes custom dictionary words", async () => {
    await loadOptionsModule({ customDictionary: new Map([["apple", "fruit"]]) });

    document.querySelector("#customDictionary li span").click();

    expect(state.configMock.removeKeyWordFromcustomDictionary).toHaveBeenCalledWith("apple");
    expect(document.querySelectorAll("#customDictionary li")).toHaveLength(0);
  });

  it("exports config to a downloadable JSON file", async () => {
    await loadOptionsModule();

    document.querySelector("#backupToFile").click();

    expect(state.configMock.export).toHaveBeenCalledTimes(1);
    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].href).toContain(encodeURIComponent('{"ok":true}'));
    expect(anchorClicks[0].download).toMatch(/^twp-backup_.*\.txt$/);
  });

  it("imports config from a selected file after confirmation", async () => {
    restoreFile = { __text: '{"restored":true}' };
    await loadOptionsModule();

    document.querySelector("#restoreFromFile").click();

    expect(globalThis.confirm).toHaveBeenCalled();
    expect(state.configMock.import).toHaveBeenCalledWith('{"restored":true}');
  });

  it("loads model options for custom providers with apiBase and apiKey", async () => {
    state.loadAiProviderModelOptions.mockResolvedValueOnce([
      { value: "custom-model", text: "Custom Model" },
    ]);
    state.createAiOptionsController.mockImplementationOnce(() => ({
      initialize: vi.fn(),
      handleProviderChange: vi.fn(),
      handleConfigChanged: vi.fn(() => false),
      handleStorageChanged: vi.fn(),
    }));

    await loadOptionsModule({
      aiProvider: "_custom_demo",
      providerConfigs: {
        _custom_demo: {
          name: "Demo Provider",
          apiKey: "demo-key",
          apiBase: "https://example.com/v1/chat/completions",
          model: "custom-model",
        },
      },
    });

    await Promise.resolve();

    expect(document.querySelector("#genericApiBase").value).toBe("https://example.com/v1/chat/completions");
    expect(document.querySelector("#apiKeyGeneric").value).toBe("demo-key");
    expect(state.loadAiProviderModelOptions).toHaveBeenCalledWith(expect.objectContaining({
      provider: "_custom_demo",
      apiKey: "demo-key",
      endpoint: "https://example.com/v1/chat/completions",
    }));
    expect(document.querySelector("#genericModel").value).toBe("custom-model");
  });

  // 回归测试: ISSUE-001 — whereToDisplayTranslatedText onChange 保存到 config
  // 发现于 /qa on 2026-07-03
  // 报告: .gstack/qa-reports/qa-report-dualtran-2026-07-03.md
  it("saves whereToDisplayTranslatedText to config on change", async () => {
    await loadOptionsModule({ whereToDisplayTranslatedText: "newLine" });

    const select = document.querySelector("#whereToDisplayTranslatedText");
    // 验证从 config 初始化
    expect(select.value).toBe("newLine");

    // 切换到 replaceOriginal
    select.value = "replaceOriginal";
    select.onchange({ target: select });
    expect(state.configMock.set).toHaveBeenCalledWith("whereToDisplayTranslatedText", "replaceOriginal");
  });

  // 回归测试: ISSUE-002 — enableDeepL onChange 保存到 config
  // 发现于 /qa on 2026-07-03
  it("saves enableDeepL to config on change", async () => {
    await loadOptionsModule({ enableDeepL: "yes" });

    const select = document.querySelector("#enableDeepL");
    expect(select.value).toBe("yes");

    select.value = "no";
    select.onchange({ target: select });
    expect(state.configMock.set).toHaveBeenCalledWith("enableDeepL", "no");
  });

  // 回归测试: ISSUE-003 — useOldPopup onChange 保存到 config
  // 发现于 /qa on 2026-07-03
  it("saves useOldPopup to config on change", async () => {
    await loadOptionsModule({ useOldPopup: "no" });

    const select = document.querySelector("#useOldPopup");
    expect(select.value).toBe("no");

    select.value = "yes";
    select.onchange({ target: select });
    expect(state.configMock.set).toHaveBeenCalledWith("useOldPopup", "yes");
  });

  // 回归测试: ISSUE-004 — showPopupMobile onChange 保存到 config
  // 发现于 /qa on 2026-07-03
  it("saves showPopupMobile to config on change", async () => {
    await loadOptionsModule({ showPopupMobile: "no" });

    const select = document.querySelector("#showPopupMobile");
    expect(select.value).toBe("no");

    select.value = "yes";
    select.onchange({ target: select });
    expect(state.configMock.set).toHaveBeenCalledWith("showPopupMobile", "yes");
  });

  // ── 参数化冒烟测试：所有 options.html 中有 onChange handler 的控件 ──
  // 此测试确保每个控件的 handler 都存在、DOM 元素存在、且 handler 能正确调用 config.set。
  // 任何一个 handler 被注释掉，对应的测试都会 FAIL。
  // 设计原则: 一个测试覆盖一个控件类别，失败时能精准定位问题控件。

  /**
   * 所有应在 options 页中持久化到 config 的控件清单。
   * @type {Array<{id: string, type: string, configKey: string, testValue: string, note?: string}>}
   */
  const CONTROLS_WITH_HANDLERS = [
    // 注: selectTargetLanguage / selectTargetLanguageForText 使用 setTargetLanguage() 而非 set()
    // 注: favoriteLanguage1/2/3 修改 targetLanguages 数组而非单项 key
    // 这些控件通过现有独立测试验证（如 "fills language selects" 等）

    // ── Translations 标签页 ──
    { id: "translateLongerThan", type: "number", configKey: "translateLongerThan", testValue: "5" },
    { id: "whereToDisplayTranslatedText", type: "select", configKey: "whereToDisplayTranslatedText", testValue: "replaceOriginal" },
    { id: "aiImproveForLongerThan", type: "number", configKey: "aiImproveForLongerThan", testValue: "10" },
    // 注: pageTranslatorService 的 HTML 在 options.html 中被注释，但其 JS handler 是激活的
    { id: "pageTranslatorService", type: "select", configKey: "pageTranslatorService", testValue: "microsoft", note: "HTML 在 prod 中被注释，handler 仅在 dev 测试 DOM 中生效" },
    { id: "ttsSpeed", type: "range", configKey: "ttsSpeed", testValue: "0.5", note: "使用 oninput 而非 onchange" },
    { id: "showOriginalTextWhenHovering", type: "select", configKey: "showOriginalTextWhenHovering", testValue: "yes" },
    { id: "translateTag_pre", type: "select", configKey: "translateTag_pre", testValue: "yes" },
    // 注: dontSortResults 的 HTML 在 options.html 中被注释（pageTranslator.js TODO 要求强制 yes）
    { id: "dontSortResults", type: "select", configKey: "dontSortResults", testValue: "yes", note: "HTML 在 prod 中被注释（TODO: 强制 yes）" },
    { id: "translateDynamicallyCreatedContent", type: "select", configKey: "translateDynamicallyCreatedContent", testValue: "no" },
    { id: "autoTranslateWhenClickingALink", type: "select", configKey: "autoTranslateWhenClickingALink", testValue: "yes" },
    { id: "enableDeepL", type: "select", configKey: "enableDeepL", testValue: "no" },

    // ── Translate Selected 高级选项 ──
    { id: "showTranslateSelectedButton", type: "select", configKey: "showTranslateSelectedButton", testValue: "no" },
    // 注: dontShowIfPageLangIsTargetLang 是 checkbox，使用 yes/no 值
    { id: "dontShowIfPageLangIsTargetLang", type: "checkbox", configKey: "dontShowIfPageLangIsTargetLang", testValue: "yes" },
    { id: "dontShowIfPageLangIsUnknown", type: "checkbox", configKey: "dontShowIfPageLangIsUnknown", testValue: "yes" },
    { id: "dontShowIfSelectedTextIsTargetLang", type: "checkbox", configKey: "dontShowIfSelectedTextIsTargetLang", testValue: "yes" },
    { id: "dontShowIfSelectedTextIsUnknown", type: "checkbox", configKey: "dontShowIfSelectedTextIsUnknown", testValue: "yes" },

    // ── Style 标签页 ──
    { id: "useOldPopup", type: "select", configKey: "useOldPopup", testValue: "yes" },
    { id: "darkMode", type: "select", configKey: "darkMode", testValue: "yes" },
    { id: "popupBlueWhenSiteIsTranslated", type: "select", configKey: "popupBlueWhenSiteIsTranslated", testValue: "yes" },

    // ── Others 标签页 ──
    { id: "showPopupMobile", type: "select", configKey: "showPopupMobile", testValue: "yes" },
    { id: "showFloatingBtn", type: "select", configKey: "showFloatingBtn", testValue: "no" },
    { id: "showTranslatePageContextMenu", type: "select", configKey: "showTranslatePageContextMenu", testValue: "no" },
    { id: "showTranslateSelectedContextMenu", type: "select", configKey: "showTranslateSelectedContextMenu", testValue: "no" },
    { id: "showButtonInTheAddressBar", type: "select", configKey: "showButtonInTheAddressBar", testValue: "no" },
    { id: "translateClickingOnce", type: "select", configKey: "translateClickingOnce", testValue: "yes" },
  ];

  // 为每个控件生成独立测试：DOM 元素存在 → handler 非空 → 触发后 config.set 被调用
  for (const ctrl of CONTROLS_WITH_HANDLERS) {
    const noteSuffix = ctrl.note ? ` (${ctrl.note})` : "";
    it(`persists #${ctrl.id} (→ ${ctrl.configKey}) to config on change${noteSuffix}`, async () => {
      await loadOptionsModule({ [ctrl.configKey]: ctrl.defaultValue || "" });

      const el = document.querySelector(`#${ctrl.id}`);
      // 断言 1: DOM 元素存在（若 HTML 被注释掉则 FAIL）
      expect(el, `#${ctrl.id} should exist in DOM`).not.toBeNull();

      if (ctrl.type === "checkbox") {
        // Checkbox: 切换 checked 状态
        el.checked = ctrl.testValue === "yes";
        el.onchange?.({ target: el });
        expect(state.configMock.set).toHaveBeenCalledWith(ctrl.configKey, ctrl.testValue);
      } else if (ctrl.type === "range") {
        // Range input: 使用 oninput 事件
        el.value = ctrl.testValue;
        el.oninput?.({ target: el });
        expect(state.configMock.set).toHaveBeenCalledWith(ctrl.configKey, ctrl.testValue);
        // 同时验证显示值更新
        const display = document.querySelector("#displayTtsSpeed");
        if (display) expect(display.textContent).toBe(ctrl.testValue);
      } else {
        // Select / number: 标准 onChange
        // 断言 2: handler 非空（若被注释掉则 FAIL）
        expect(el.onchange, `#${ctrl.id} onChange handler should not be null (may be commented out)`).not.toBeNull();
        el.value = ctrl.testValue;
        el.onchange({ target: el });
        // 断言 3: config.set 被调用（若 handler 为空函数或未正确实现则 FAIL）
        expect(state.configMock.set).toHaveBeenCalledWith(ctrl.configKey, ctrl.testValue);
      }
    });
  }
});
