import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const defaultConfigValues = () => ({
    darkMode: "no",
    targetLanguage: "en",
    targetLanguageTextTranslation: "fr",
    targetLanguages: ["en", "fr", "de"],
    neverTranslateLangs: ["de"],
    alwaysTranslateLangs: ["fr"],
    alwaysTranslateLangsAI: [],
    langsToTranslateWhenHovering: ["es"],
    alwaysTranslateSites: ["always.example"],
    alwaysTranslateSitesAI: [],
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
    addLangToAlwaysTranslateAI: vi.fn((lang) => {
      configValues.alwaysTranslateLangsAI.push(lang);
    }),
    removeLangFromAlwaysTranslateAI: vi.fn((lang) => {
      const index = configValues.alwaysTranslateLangsAI.indexOf(lang);
      if (index >= 0) configValues.alwaysTranslateLangsAI.splice(index, 1);
    }),
    addSiteToAlwaysTranslateAI: vi.fn((site) => {
      configValues.alwaysTranslateSitesAI.push(site);
    }),
    removeSiteFromAlwaysTranslateAI: vi.fn((site) => {
      const index = configValues.alwaysTranslateSitesAI.indexOf(site);
      if (index >= 0) configValues.alwaysTranslateSitesAI.splice(index, 1);
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
  // Display names mirror BUILT_IN_PROVIDERS: the AI panel renders labels from
  // def.name — a mock with `name: id` silently drifted from production (#155).
  const displayNames = {
    openai: "OpenAI",
    openrouter: "OpenRouter",
    anthropic: "Anthropic",
    "google-gemini": "Google Gemini",
    "azure-openai": "Azure OpenAI",
    deepseek: "DeepSeek",
    grok: "xAI (Grok)",
    mistral: "Mistral AI",
    cohere: "Cohere",
    together: "Together AI",
    groq: "Groq",
    zhipu: "智谱AI (Zhipu/GLM)",
    moonshot: "月之暗面 (Moonshot/Kimi)",
    qwen: "阿里通义千问 (Qwen/DashScope)",
    baidu: "百度文心 (Baidu/ERNIE)",
    bytedance: "字节豆包 (ByteDance/Doubao)",
    iflytek: "讯飞星火 (iFlytek Spark)",
    perplexity: "Perplexity",
  };
  const providerList = known.map(id => ({
    id,
    name: displayNames[id] || id,
    // OpenAI carries the help link in production — the label tests assert it.
    ...(id === "openai" ? { apiKeyUrl: "https://platform.openai.com/api-keys" } : {}),
  }));
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
    // 内部 ID → models.dev ID（与生产实现同语义：只映射已知别名）
    resolveModelsDevId: (id) => ({ "google-gemini": "google", grok: "xai", zhipu: "zhipuai", moonshot: "moonshotai", together: "togetherai", qwen: "alibaba-cn", "azure-openai": "azure" }[id] || id),
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
      <a href="#feedback">Report a problem</a>
    </nav>
    <section id="languages"></section>
    <section id="sites"></section>
    <section id="translations"></section>
    <section id="ai"></section>
    <section id="style"></section>
    <section id="hotkeys"></section>
    <section id="storage"></section>
    <section id="others"></section>
    <section id="feedback">
      <button id="btnOpenIssueForm">Open GitHub issue form</button>
      <button id="btnCopyDiagnostics">Copy diagnostic info</button>
      <a id="feedbackEmailLink" href="mailto:seigwen@gmail.com">seigwen@gmail.com</a>
      <a id="feedbackStoreLink" href="https://chromewebstore.google.com/detail/ihbcniigknaeillehompenjaacaocpnp/support" target="_blank" rel="noopener">support</a>
    </section>

    <select id="selectTargetLanguage"></select>
    <select id="selectTargetLanguageForText"></select>
    <select id="favoriteLanguage1"></select>
    <select id="favoriteLanguage2"></select>
    <select id="favoriteLanguage3"></select>
    <select id="addToNeverTranslateLangs"></select>
    <select id="addToAlwaysTranslateLangs"></select>
    <select id="addToAlwaysTranslateLangsAI"></select>
    <select id="addLangToTranslateWhenHovering"></select>
    <ul id="neverTranslateLangs"></ul>
    <ul id="alwaysTranslateLangs"></ul>
    <ul id="alwaysTranslateLangsAI"></ul>
    <ul id="langsToTranslateWhenHovering"></ul>

    <button id="addToAlwaysTranslateSites"></button>
    <button id="addToAlwaysTranslateSitesAI"></button>
    <button id="addToNeverTranslateSites"></button>
    <button id="addSiteToTranslateWhenHovering"></button>
    <ul id="alwaysTranslateSites"></ul>
    <ul id="alwaysTranslateSitesAI"></ul>
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
      <p><label id="genericReasoningDepthLabel"></label></p>
      <select id="genericReasoningDepth"><option value="">Default</option></select>
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

// 平台形态账本：storage.onChanged 的订阅 spy（负向断言用）。
let storageOnChangedAddListenerSpy;

function installBrowserGlobals({
  matchMediaMatches = false,
  confirmResult = true,
  commandsGetAllResults = null,
  manifestCommands = {},
  browserGlobal,
  omitStorageOnChanged = false,
  commandsUpdateInChrome = false,
  modelsDevProviders = null,
  messageOverrides = {},
} = {}) {
  const messages = {
    lblSettings: "Settings",
    lblActivateTheExtension: "Activate the extension",
    doYouWantOverwriteAllSettings: "Overwrite settings?",
    doYouWantDeleteTranslationCache: "Delete cache?",
    doYouWantRestoreSettings: "Restore settings?",
    fileIsCorrupted: "File is corrupted",
    // Feedback section (plan 35): the copy button swaps its label to this
    msgFeedbackCopied: "Copied",
    ...messageOverrides,
  };

  window.scrollTo = vi.fn();
  window.matchMedia = vi.fn(() => ({ matches: matchMediaMatches }));
  window.location.hash = "";

  // 平台形态：storage.onChanged 的订阅点（options.js:1079 / 2211）。
  // omitStorageOnChanged=true 模拟「命名空间存在但无 onChanged」的降级形态；
  // spy 始终创建，便于负向断言「未订阅」。
  storageOnChangedAddListenerSpy = vi.fn();

  globalThis.chrome = {
    i18n: {
      // Mirror chrome.i18n's placeholder substitution for the $PROVIDER_NAME$
      // family (plan 45): options.js passes the provider display name as $1.
      getMessage: vi.fn((key, substitutions) => {
        const message = messages[key] ?? "";
        if (!message || substitutions === undefined) return message;
        const values = Array.isArray(substitutions) ? substitutions : [substitutions];
        return message.replace(/\$PROVIDER_NAME\$/g, String(values[0] ?? ""));
      }),
    },
    // Chrome 148+ shape: the `commands` namespace exists (getAll) but has no
    // `update`; Firefox shape: `update` is a callable function.
    commands: commandsGetAllResults === null ? undefined : {
      getAll: vi.fn((cb) => cb(commandsGetAllResults)),
      ...(commandsUpdateInChrome ? { update: vi.fn() } : {}),
    },
    runtime: {
      getManifest: vi.fn(() => ({ commands: manifestCommands, version: "2.1.30" })),
      sendMessage: vi.fn((_message, callback) => callback?.("42 MB")),
    },
    storage: {
      ...(omitStorageOnChanged ? {} : { onChanged: { addListener: storageOnChangedAddListenerSpy } }),
      // Storage reads used by the AI panel:
      //   - "modelsdev:providers"       → models.dev provider/model declaration cache
      //   - "previewModels:v4:<prov>"   → per-provider model list cache (a cache HIT
      //     here keeps loadPreviewModels from starting a real models.dev fetch,
      //     which would never settle in jsdom and would leave the model select
      //     (and the reasoning-depth rebuild it drives) un-populated)
      // Supports both the promise form and the callback form used by options.js.
      local: {
        get: vi.fn((key, cb) => {
          let value;
          if (key === "modelsdev:providers") {
            value = modelsDevProviders === null ? undefined : { [key]: { data: modelsDevProviders } };
          } else if (typeof key === "string" && key.startsWith("previewModels:v4:")) {
            value = { [key]: { models: [{ value: "m", text: "m" }], ts: Date.now() } };
          }
          if (typeof cb === "function") { cb(value); return undefined; }
          return Promise.resolve(value);
        }),
      },
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

  // Platform-shape simulation: Chrome 148+ provides a `browser` alias namespace
  // (without commands.update); Firefox provides `browser.commands.update`.
  if (browserGlobal !== undefined) {
    globalThis.browser = browserGlobal;
  }
}

/** Firefox platform shape: `browser` global with a callable commands.update (issue #85). */
function firefoxBrowserStub() {
  return { commands: { update: vi.fn(), getAll: vi.fn() } };
}

async function loadOptionsModule(overrides = {}, env = {}) {
  resetConfig(overrides);
  createOptionsDom();
  // Optional: drop specific elements after the shared DOM is built, so a test
  // can exercise the missing-element path ($ → debugLog → null proxy, plan 39).
  for (const id of env.omitElementIds || []) {
    document.getElementById(id)?.remove();
  }
  delete globalThis.browser;
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
    delete globalThis.browser;
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

  // ── AI always-translate lists (issue #145) ──────────────────────────

  it("adds a language to the always-translate-AI list", async () => {
    await loadOptionsModule({ alwaysTranslateLangsAI: [] });

    const select = document.querySelector("#addToAlwaysTranslateLangsAI");
    select.value = "it";
    select.onchange({ target: select });

    expect(state.configMock.addLangToAlwaysTranslateAI).toHaveBeenCalledWith("it");
    expect(document.querySelector("#alwaysTranslateLangsAI li")?.textContent).toContain("Italiano");
  });

  it("renders the always-translate-AI language list from config and removes on click", async () => {
    await loadOptionsModule({ alwaysTranslateLangsAI: ["en"] });

    expect(document.querySelector("#alwaysTranslateLangsAI li")?.textContent).toContain("English");

    document.querySelector("#alwaysTranslateLangsAI li span").click();

    expect(state.configMock.removeLangFromAlwaysTranslateAI).toHaveBeenCalledWith("en");
    expect(document.querySelectorAll("#alwaysTranslateLangsAI li")).toHaveLength(0);
  });

  it("adds a site to the always-translate-AI list", async () => {
    await loadOptionsModule({ alwaysTranslateSitesAI: [] });
    globalThis.prompt.mockReturnValueOnce("ai.example");

    document.querySelector("#addToAlwaysTranslateSitesAI").click();

    expect(state.configMock.addSiteToAlwaysTranslateAI).toHaveBeenCalledWith("ai.example");
    expect(document.querySelector("#alwaysTranslateSitesAI li")?.textContent).toContain("ai.example");
  });

  it("renders the always-translate-AI site list from config and removes on click", async () => {
    await loadOptionsModule({ alwaysTranslateSitesAI: ["ai.example"] });

    expect(document.querySelector("#alwaysTranslateSitesAI li")?.textContent).toContain("ai.example");

    document.querySelector("#alwaysTranslateSitesAI li span").click();

    expect(state.configMock.removeSiteFromAlwaysTranslateAI).toHaveBeenCalledWith("ai.example");
    expect(document.querySelectorAll("#alwaysTranslateSitesAI li")).toHaveLength(0);
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

  // ── 快捷键列表：保留命令 label 兜底 + 平台形态门禁（issue #85）──
  // 背景：Chrome 148 起同时提供 `browser` 命名空间，旧的 `typeof browser !== "undefined"`
  // 探测在 Chromium 上恒真 → 列表/按钮显隐反转 + 保留命令 _execute_action 空 label。

  it("renders a fallback label for a reserved command with an empty description", async () => {
    await loadOptionsModule({}, {
      commandsGetAllResults: [{ name: "_execute_action", description: "", shortcut: "" }],
      browserGlobal: firefoxBrowserStub(),
    });

    const row = document.getElementById("_execute_action");
    expect(row).not.toBeNull();
    expect(row.querySelector(":scope > div").textContent.trim()).toBe("Activate the extension");
  });

  it("keeps the legacy MV2 reserved command name covered by the fallback label", async () => {
    await loadOptionsModule({}, {
      commandsGetAllResults: [{ name: "_execute_browser_action", description: "", shortcut: "" }],
      browserGlobal: firefoxBrowserStub(),
    });

    const row = document.getElementById("_execute_browser_action");
    expect(row).not.toBeNull();
    expect(row.querySelector(":scope > div").textContent.trim()).toBe("Activate the extension");
  });

  it("treats the Chrome 148+ browser alias namespace as Chromium (native manager shown, list hidden)", async () => {
    await loadOptionsModule({}, {
      commandsGetAllResults: [{ name: "_execute_action", description: "", shortcut: "" }],
      // Chrome 148+: `browser` exists as an alias of `chrome`, but there is no commands.update
      browserGlobal: { i18n: {}, commands: { getAll: () => {} } },
    });

    expect(document.querySelector("#hotkeysListContainer").style.display).toBe("none");
    expect(document.querySelector("#openNativeShortcutManager").style.display).toBe("block");
    expect(document.querySelectorAll("#KeyboardShortcuts .shortcut-row")).toHaveLength(0);
  });

  it("still uses the in-page shortcut editor on Firefox (commands.update available)", async () => {
    await loadOptionsModule({ hotkeys: { "hotkey-toggle-translation": "Alt+T" } }, {
      commandsGetAllResults: [
        { name: "_execute_action", description: "", shortcut: "" },
        { name: "hotkey-toggle-translation", description: "Switch", shortcut: "Alt+T" },
      ],
      manifestCommands: { "hotkey-toggle-translation": { suggested_key: { default: "Alt+T" } } },
      browserGlobal: firefoxBrowserStub(),
    });

    expect(document.querySelector("#hotkeysListContainer").style.display).toBe("block");
    expect(document.querySelector("#openNativeShortcutManager").style.display).toBe("none");

    const rows = document.querySelectorAll("#KeyboardShortcuts .shortcut-row");
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(row.querySelector(":scope > div").textContent.trim()).not.toBe("");
    });
    expect(document.getElementById("hotkey-toggle-translation").querySelector('[name="input"]').value).toBe("Alt+T");
  });

  // ── 平台形态矩阵：storage.onChanged 订阅点（P1, issue #88）──
  // options.js 有两处 `typeof chrome.storage.onChanged` 探测（1079 主面板同步、
  // 2211 models.dev 缓存刷新）。形态矩阵要求两个方向都有测试格：
  // ① 形态存在 → 订阅发生；② 形态缺失（storage 命名空间在但不含 onChanged）→ 不订阅、不崩溃。

  it("subscribes to chrome.storage.onChanged when the platform provides it", async () => {
    await loadOptionsModule();

    expect(storageOnChangedAddListenerSpy).toHaveBeenCalled();
  });

  it("skips storage.onChanged subscription without crashing when the platform lacks it", async () => {
    await expect(
      loadOptionsModule({}, { omitStorageOnChanged: true })
    ).resolves.toBeDefined();

    expect(storageOnChangedAddListenerSpy).not.toHaveBeenCalled();
  });

  it("pushes a captured in-page shortcut to browser.commands.update on Firefox", async () => {
    const browserGlobal = firefoxBrowserStub();
    await loadOptionsModule({ hotkeys: {} }, {
      commandsGetAllResults: [
        { name: "hotkey-toggle-translation", description: "Switch", shortcut: "" },
      ],
      manifestCommands: { "hotkey-toggle-translation": { suggested_key: { default: "Alt+T" } } },
      browserGlobal,
    });

    const input = document.getElementById("hotkey-toggle-translation").querySelector('[name="input"]');
    input.onkeydown({
      key: "T",
      code: "KeyT",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    });

    expect(browserGlobal.commands.update).toHaveBeenCalledWith({
      name: "hotkey-toggle-translation",
      shortcut: "Ctrl+T",
    });
    expect(state.configMock.get("hotkeys")["hotkey-toggle-translation"]).toBe("Ctrl+T");
  });

  it("never calls browser.commands.update on the Chrome 148+ shape (no update capability)", async () => {
    const browserGlobal = { commands: { getAll: vi.fn() } };
    await loadOptionsModule({ hotkeys: {} }, {
      commandsGetAllResults: [
        { name: "hotkey-toggle-translation", description: "Switch", shortcut: "" },
      ],
      browserGlobal,
    });

    // Chromium 语义：列表隐藏、原生管理器入口可见（与上一格形成形态对照）
    expect(document.querySelector("#hotkeysListContainer").style.display).toBe("none");
    expect(document.querySelector("#openNativeShortcutManager").style.display).toBe("block");
    expect(browserGlobal.commands.update).toBeUndefined();
  });

  it("takes the in-page editor branch when chrome.commands.update exists without a browser namespace", async () => {
    // 形态枚举：`browser` 完全缺失、但 `chrome.commands.update` 可调用（无别名命名空间的
    // Gecko 系 / 支持 update 的 Chromium 衍生构建）→ 第二个分支必须被选中，而非落到
    // 「不支持」默认分支把编辑器隐藏。
    await loadOptionsModule({ hotkeys: { "hotkey-toggle-translation": "Alt+T" } }, {
      commandsGetAllResults: [
        { name: "hotkey-toggle-translation", description: "Switch", shortcut: "Alt+T" },
      ],
      commandsUpdateInChrome: true,
    });

    expect(document.querySelector("#hotkeysListContainer").style.display).toBe("block");
    expect(document.querySelector("#openNativeShortcutManager").style.display).toBe("none");
    expect(document.querySelectorAll("#KeyboardShortcuts .shortcut-row")).toHaveLength(1);
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

      // assertion-strength-allow: 数据驱动分支测试（每种控件类型有独立断言）
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

  // ── 推理深度控件（plan 32）──────────────────────────────────────────────
  // 控件形态：下拉框；选项由「当前 provider + 当前 model」的 models.dev 声明
  // 动态生成；存量值在换模型后不丢；选择落到 providerConfigs[provider]。

  /** 构造一个 models.dev 缓存片段：provider 级别带 npm，model 级别带 reasoning_options。 */
  function modelsDevCache({ providerId = "openai", npm, models = {} }) {
    return { [providerId]: { npm, models } };
  }

  /**
   * 等待推理深度下拉框完成一次异步重建。
   * `_rebuildReasoningDepthOptions` 在 storage 读取完成后才写 DOM（Promise/microtask），
   * 直接同步断言会读到初始的空 select。这里刷新宏任务让回调落地。
   */
  async function flushAsyncWork() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("renders the reasoning depth control with a Default option and dynamic provider label", async () => {
    await loadOptionsModule();

    const select = document.querySelector("#genericReasoningDepth");
    expect(select, "#genericReasoningDepth should exist in the DOM").not.toBeNull();
    expect(Array.from(select.options).map((o) => o.value)).toContain("");

    // 动态标签：与另外三个标签同一机制
    const label = document.querySelector("#genericReasoningDepthLabel");
    expect(label).not.toBeNull();
    expect(label.textContent).toMatch(/Reasoning Depth/);
  });

  it("keeps a stored reasoning depth when the freshly built option list does not offer it", async () => {
    // 存量值 "xhigh"：当前 models.dev 缓存里没有该模型声明 → 选项只有 Default，
    // 但存量值必须保留一个同名 option，否则用户在换模型时静默丢失设置。
    await loadOptionsModule(
      { providerConfigs: { openai: { apiKey: "k", model: "m", reasoningDepth: "xhigh" } } },
      { modelsDevProviders: modelsDevCache({ npm: "@ai-sdk/openai", models: {} }) }
    );
    await flushAsyncWork();

    const select = document.querySelector("#genericReasoningDepth");
    expect(select).not.toBeNull();
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("xhigh");
    // 并被选中（用户的存量设置不能因为换模型而静默失效）
    expect(select.value).toBe("xhigh");
  });

  it("persists the reasoning depth into providerConfigs for the active provider", async () => {
    await loadOptionsModule(
      { providerConfigs: { openai: { apiKey: "k", model: "m" } } },
      {
        modelsDevProviders: modelsDevCache({
          npm: "@ai-sdk/openai",
          models: { m: { reasoning_options: [{ type: "effort", values: ["low", "high"] }] } },
        }),
      }
    );
    await flushAsyncWork();

    const select = document.querySelector("#genericReasoningDepth");
    expect(select).not.toBeNull();
    // 选项已按声明生成（Default + low + high）
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "low", "high"]);

    // 直接驱动 change 事件路径（控件用 addEventListener 绑定）
    select.value = "high";
    select.dispatchEvent(new window.Event("change"));

    // 断言落盘：providerConfigs[provider].reasoningDepth
    const setCalls = state.configMock.set.mock.calls.filter(([key]) => key === "providerConfigs");
    expect(setCalls.length).toBeGreaterThan(0);
    const lastValue = setCalls.at(-1)[1];
    const activeProvider = state.configValues.aiProvider || "openai";
    expect(lastValue[activeProvider].reasoningDepth).toBe("high");
  });

  it("does not crash when the platform has no chrome.storage.local (degraded shape)", async () => {
    // 覆盖降级形态：storage 命名空间存在但没有 local → 只渲染 Default，不抛错
    await loadOptionsModule({}, { omitStorageOnChanged: true });

    const select = document.querySelector("#genericReasoningDepth");
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map((o) => o.value)).toEqual([""]);
  });

  // ── AI 面板文案 i18n（plan 45）─────────────────────────────────────────
  // 契约：AI 部分所有动态可见文案必须经 _locales 键渲染；provider 动态名
  // 通过 $PROVIDER_NAME$ 占位符（$1）替换；键缺失时保持英文回退（行为面零改动）。

  it("renders the four provider-panel labels with the provider name through i18n", async () => {
    await loadOptionsModule({}, {
      messageOverrides: {
        lblProviderApiKey: "$PROVIDER_NAME$ API 密钥",
        lblProviderApiEndpoint: "$PROVIDER_NAME$ API 端点 URL",
        lblProviderModel: "$PROVIDER_NAME$ 模型",
        lblProviderReasoningDepth: "$PROVIDER_NAME$ 推理深度",
      },
    });

    // RED under the old hardcoded English; GREEN once the labels flow through
    // chrome.i18n.getMessage(key, [providerName]).
    expect(document.querySelector("#genericApiKeyLabel").textContent).toBe("OpenAI API 密钥");
    expect(document.querySelector("#genericApiBaseLabel").textContent).toBe("OpenAI API 端点 URL");
    expect(document.querySelector("#genericModelLabel").textContent).toBe("OpenAI 模型");
    expect(document.querySelector("#genericReasoningDepthLabel").textContent).toBe("OpenAI 推理深度");
  });

  it("keeps the English fallback for the panel labels when their keys are missing", async () => {
    // 回退形态（键缺失时不得渲染空串/原始占位符）：mock 无对应键 → i18nOrDefault 兜底
    await loadOptionsModule();

    expect(document.querySelector("#genericApiKeyLabel").textContent).toBe("OpenAI API Key");
    expect(document.querySelector("#genericApiBaseLabel").textContent).toBe("OpenAI API Endpoint URL");
    expect(document.querySelector("#genericModelLabel").textContent).toBe("OpenAI Model");
    expect(document.querySelector("#genericReasoningDepthLabel").textContent).toBe("OpenAI Reasoning Depth");
  });

  it("localizes the API-key help link text through i18n (href unchanged)", async () => {
    await loadOptionsModule({}, {
      messageOverrides: { lblHowToGetProviderApiKey: "如何获取 $PROVIDER_NAME$ API 密钥？" },
    });

    const link = document.querySelector("#genericApiKeyLink");
    expect(link.textContent).toBe("如何获取 OpenAI API 密钥？");
    // 行为面零改动：href 与可见性仍来自 provider 定义
    expect(link.href).toBe("https://platform.openai.com/api-keys");
    expect(link.style.display).not.toBe("none");
  });

  it("localizes the provider-dropdown loading span through i18n", async () => {
    await loadOptionsModule({}, { messageOverrides: { msgLoadingModels: "加载中..." } });

    // 动态创建的 span 是 #aiProvider 的兄弟节点（body 直下），静态 HTML 的
    // .model-loading-msg 在测试 DOM 中位于 <p> 内——用 body 直下限定选它。
    const spans = Array.from(document.querySelectorAll("body > .model-loading-msg"));
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe("加载中...");
  });

  it("localizes the custom-provider name and endpoint prompts through i18n", async () => {
    await loadOptionsModule({}, {
      messageOverrides: {
        msgEnterProviderName: "请输入提供商名称：",
        msgEnterProviderApiBase: "请输入 API 端点 URL（可选，点击确定跳过）：",
      },
    });

    globalThis.prompt.mockReturnValueOnce("My Provider").mockReturnValueOnce("");
    document.querySelector("#btnAddCustomProvider").click();

    const promptTexts = globalThis.prompt.mock.calls.map((call) => call[0]);
    expect(promptTexts).toEqual([
      "请输入提供商名称：",
      "请输入 API 端点 URL（可选，点击确定跳过）：",
    ]);
  });

  it("localizes the custom-model prompt through i18n", async () => {
    await loadOptionsModule({}, { messageOverrides: { msgEnterModelName: "请输入模型名称/ID：" } });

    globalThis.prompt.mockReturnValueOnce("my-model");
    document.querySelector("#btnAddCustomModel").click();

    expect(globalThis.prompt).toHaveBeenCalledWith("请输入模型名称/ID：");
  });

  it("localizes the reasoning-depth option labels through the translate hook", async () => {
    await loadOptionsModule(
      { providerConfigs: { openai: { apiKey: "k", model: "m" } } },
      {
        modelsDevProviders: modelsDevCache({
          npm: "@ai-sdk/openai",
          models: { m: { reasoning_options: [{ type: "effort", values: ["low", "high"] }] } },
        }),
        messageOverrides: {
          msgDefault: "默认",
          msgReasoningDepthLow: "低",
          msgReasoningDepthHigh: "高",
        },
      }
    );
    await flushAsyncWork();

    const select = document.querySelector("#genericReasoningDepth");
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["默认", "低", "高"]);
  });
});

// ══════════════════════════════════════════════════════════════
// Feedback section (plan 35 — user feedback channel)
//
// 契约：options 新增「反馈问题」区块（nav 第 9 项 #feedback）：
//   ① 区块存在且随 hash 切换（与其他 8 个 tab 同一套开关机制）
//   ② 「打开 GitHub 反馈表单」按钮 → tabs.create(prefilled URL)
//      —— 静态路径只预填 version/browser/os，不预填 service（无法可靠判定）
//   ③ 「复制诊断信息」按钮 → clipboard.writeText(诊断块) + 文案切「已复制」
//   ④ mailto 链接初始化时带版本主题 + 诊断正文
// 红线：诊断块/URL 不得含 API key / API base（哨兵断言）
// ══════════════════════════════════════════════════════════════

describe("options/options — feedback section (plan 35)", () => {
  const UA_CHROME_LINUX =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
  const GOLDEN_STATIC_URL =
    "https://github.com/seigwen/DualTran-extension/issues/new?template=bug_report.yml&extension-version=2.1.30&browser=Chrome&os=Linux";
  let originalNavigatorDescriptor;

  async function flushMicrotasks(times = 8) {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    document.head.innerHTML = "";
    document.body.innerHTML = "";

    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: UA_CHROME_LINUX,
        language: "en-US",
        clipboard: { writeText: vi.fn(() => Promise.resolve()) },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
    delete globalThis.browser;
  });

  it("registers the #feedback section with its four controls", async () => {
    await loadOptionsModule();

    expect(document.querySelector("#feedback")).not.toBeNull();
    expect(document.querySelector("#btnOpenIssueForm")).not.toBeNull();
    expect(document.querySelector("#btnCopyDiagnostics")).not.toBeNull();
    expect(document.querySelector("#feedbackEmailLink")).not.toBeNull();
    expect(document.querySelector("#feedbackStoreLink")).not.toBeNull();
    expect(document.querySelector('nav a[href="#feedback"]')).not.toBeNull();
  });

  it("switches to #feedback on hash change and hides it under other tabs", async () => {
    await loadOptionsModule();

    // 初始化后（hash 默认 languages）：#feedback 必须被隐藏（属于 tab 集合）
    expect(document.querySelector("#feedback").style.display).toBe("none");

    window.location.hash = "#feedback";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(document.querySelector("#feedback").style.display).toBe("block");
    expect(document.querySelector("#languages").style.display).toBe("none");
    expect(
      document.querySelector('nav a[href="#feedback"]').classList.contains("w3-light-grey")
    ).toBe(true);
  });

  it("opens the prefilled GitHub issue form from the button (no service guess on the static path)", async () => {
    await loadOptionsModule();

    document.querySelector("#btnOpenIssueForm").click();

    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: GOLDEN_STATIC_URL });
    expect(GOLDEN_STATIC_URL).not.toContain("service=");
  });

  it("copies the diagnostics block and flashes the copied label (no secrets inside)", async () => {
    await loadOptionsModule({
      targetLanguage: "zh-CN",
      aiProvider: "openrouter",
      openRouterApiBase: "https://SENTINEL_BASE.example/v1",
      providerConfigs: {
        openrouter: { apiKey: "SENTINEL_KEY_123", apiBase: "https://SENTINEL_BASE.example/v1" },
      },
    });

    const button = document.querySelector("#btnCopyDiagnostics");
    const originalLabel = button.textContent;

    button.click();
    await flushMicrotasks();

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const text = navigator.clipboard.writeText.mock.calls[0][0];
    expect(text).toContain("DualTran: 2.1.30");
    expect(text).toContain("Browser: Chrome");
    expect(text).toContain("OS: Linux");
    expect(text).toContain("Page translation: Google");
    expect(text).toContain("AI translation: OpenRouter");
    expect(text).toContain("Target language: zh-CN");
    // 红线负向：种入的假 key/base 标记不得出现在诊断输出
    expect(text).not.toContain("SENTINEL");

    // 文案临时切换为「已复制」
    expect(button.textContent).not.toBe(originalLabel);
    expect(button.textContent).toBe("Copied");
  });

  it("prefills the feedback email link with a versioned subject and the diagnostics body", async () => {
    await loadOptionsModule({ targetLanguage: "zh-CN" });

    const href = document.querySelector("#feedbackEmailLink").getAttribute("href");
    expect(href.startsWith("mailto:seigwen@gmail.com?")).toBe(true);
    expect(href).toContain("subject=%5BDualTran%20v2.1.30%5D");
    const body = decodeURIComponent(href.split("&body=")[1] || "");
    expect(body).toContain("DualTran: 2.1.30");
    expect(body).toContain("Target language: zh-CN");
  });

  it("missing element: $ routes the miss through the deletable debugLog sink (plan 39 / issue #131)", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    // Omitted after the shared DOM is built — the module-eval $() lookups for
    // this element must then report the miss through the sink and fall through
    // to the null-safe proxy (the .value/.onchange assignments below would throw
    // if $ returned undefined instead).
    await loadOptionsModule({}, { omitElementIds: ["apiKeyAnthropic"] });

    expect(debugSpy).toHaveBeenCalledWith(
      "[options.js] Element not found for selector:",
      "#apiKeyAnthropic"
    );
  });

  it("negative: a present element never produces a missing-element debug line", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    await loadOptionsModule();

    const anthropicMisses = debugSpy.mock.calls.filter(
      ([label, selector]) =>
        label === "[options.js] Element not found for selector:" && selector === "#apiKeyAnthropic"
    );
    expect(anthropicMisses).toEqual([]);
  });
});

// ── Implementation-point map (CLAUDE.md rule: 生产产物控制台静默规则, plan 39 / #131) ──
// debugLog (options.js) — the module-level fixed-arity sink for $() misses,
//   declared above every call site so module-eval misses reach it (a later
//   declaration would be a temporal-dead-zone ReferenceError on the real
//   options page). Pinned by the missing-element cell above and the
//   present-element negative; artifact level by
//   tests/manifest/buildArtifactGuards.test.js N1.
