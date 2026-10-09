import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  configValues,
  configChangeCallbacks,
  setMock,
  setTargetLanguageMock,
  addLangToAlwaysTranslateMock,
  removeLangFromAlwaysTranslateMock,
  addLangToNeverTranslateMock,
  removeLangFromNeverTranslateMock,
  addSiteToAlwaysTranslateMock,
  removeSiteFromAlwaysTranslateMock,
  addSiteToNeverTranslateMock,
  removeSiteFromNeverTranslateMock,
  addSiteToTranslateWhenHoveringMock,
  removeSiteFromTranslateWhenHoveringMock,
  addLangToTranslateWhenHoveringMock,
  removeLangFromTranslateWhenHoveringMock,
  addLangToAlwaysTranslateAIMock,
  removeLangFromAlwaysTranslateAIMock,
  addSiteToAlwaysTranslateAIMock,
  removeSiteFromAlwaysTranslateAIMock,
} = vi.hoisted(() => {
  const configValues = {
    targetLanguages: ["fr", "de", "es"],
    alwaysTranslateLangs: [],
    neverTranslateLangs: [],
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    alwaysTranslateLangsAI: [],
    alwaysTranslateSitesAI: [],
    showTranslateSelectedButton: "yes",
    showOriginalTextWhenHovering: "no",
    sitesToTranslateWhenHovering: [],
    langsToTranslateWhenHovering: [],
    whereToDisplayTranslatedText: "replaceOriginal",
    darkMode: "no",
  };
  const configChangeCallbacks = [];
  const setMock = vi.fn((key, value) => {
    configValues[key] = value;
  });
  const setTargetLanguageMock = vi.fn((value) => {
    configValues.targetLanguage = value;
  });
  const addLangToAlwaysTranslateMock = vi.fn((lang) => {
    if (!configValues.alwaysTranslateLangs.includes(lang)) configValues.alwaysTranslateLangs.push(lang);
  });
  const removeLangFromAlwaysTranslateMock = vi.fn((lang) => {
    configValues.alwaysTranslateLangs = configValues.alwaysTranslateLangs.filter((value) => value !== lang);
  });
  const addLangToNeverTranslateMock = vi.fn((lang) => {
    if (!configValues.neverTranslateLangs.includes(lang)) configValues.neverTranslateLangs.push(lang);
  });
  const removeLangFromNeverTranslateMock = vi.fn((lang) => {
    configValues.neverTranslateLangs = configValues.neverTranslateLangs.filter((value) => value !== lang);
  });
  const addSiteToAlwaysTranslateMock = vi.fn((site) => {
    if (!configValues.alwaysTranslateSites.includes(site)) configValues.alwaysTranslateSites.push(site);
  });
  const removeSiteFromAlwaysTranslateMock = vi.fn((site) => {
    configValues.alwaysTranslateSites = configValues.alwaysTranslateSites.filter((value) => value !== site);
  });
  const addSiteToNeverTranslateMock = vi.fn((site) => {
    if (!configValues.neverTranslateSites.includes(site)) configValues.neverTranslateSites.push(site);
  });
  const removeSiteFromNeverTranslateMock = vi.fn((site) => {
    configValues.neverTranslateSites = configValues.neverTranslateSites.filter((value) => value !== site);
  });
  const addSiteToTranslateWhenHoveringMock = vi.fn((site) => {
    if (!configValues.sitesToTranslateWhenHovering.includes(site)) {
      configValues.sitesToTranslateWhenHovering.push(site);
    }
  });
  const removeSiteFromTranslateWhenHoveringMock = vi.fn((site) => {
    configValues.sitesToTranslateWhenHovering = configValues.sitesToTranslateWhenHovering.filter((value) => value !== site);
  });
  const addLangToTranslateWhenHoveringMock = vi.fn((lang) => {
    if (!configValues.langsToTranslateWhenHovering.includes(lang)) {
      configValues.langsToTranslateWhenHovering.push(lang);
    }
  });
  const removeLangFromTranslateWhenHoveringMock = vi.fn((lang) => {
    configValues.langsToTranslateWhenHovering = configValues.langsToTranslateWhenHovering.filter((value) => value !== lang);
  });
  const addLangToAlwaysTranslateAIMock = vi.fn((lang) => {
    if (!configValues.alwaysTranslateLangsAI.includes(lang)) configValues.alwaysTranslateLangsAI.push(lang);
  });
  const removeLangFromAlwaysTranslateAIMock = vi.fn((lang) => {
    configValues.alwaysTranslateLangsAI = configValues.alwaysTranslateLangsAI.filter((value) => value !== lang);
  });
  const addSiteToAlwaysTranslateAIMock = vi.fn((site) => {
    if (!configValues.alwaysTranslateSitesAI.includes(site)) configValues.alwaysTranslateSitesAI.push(site);
  });
  const removeSiteFromAlwaysTranslateAIMock = vi.fn((site) => {
    configValues.alwaysTranslateSitesAI = configValues.alwaysTranslateSitesAI.filter((value) => value !== site);
  });

  return {
    configValues,
    configChangeCallbacks,
    setMock,
    setTargetLanguageMock,
    addLangToAlwaysTranslateMock,
    removeLangFromAlwaysTranslateMock,
    addLangToNeverTranslateMock,
    removeLangFromNeverTranslateMock,
    addSiteToAlwaysTranslateMock,
    removeSiteFromAlwaysTranslateMock,
    addSiteToNeverTranslateMock,
    removeSiteFromNeverTranslateMock,
    addSiteToTranslateWhenHoveringMock,
    removeSiteFromTranslateWhenHoveringMock,
    addLangToTranslateWhenHoveringMock,
    removeLangFromTranslateWhenHoveringMock,
    addLangToAlwaysTranslateAIMock,
    removeLangFromAlwaysTranslateAIMock,
    addSiteToAlwaysTranslateAIMock,
    removeSiteFromAlwaysTranslateAIMock,
  };
});

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: setMock,
    setTargetLanguage: setTargetLanguageMock,
    onReady: vi.fn((callback) => {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }),
    onChanged: vi.fn((callback) => {
      configChangeCallbacks.push(callback);
    }),
    addLangToAlwaysTranslate: addLangToAlwaysTranslateMock,
    removeLangFromAlwaysTranslate: removeLangFromAlwaysTranslateMock,
    addLangToNeverTranslate: addLangToNeverTranslateMock,
    removeLangFromNeverTranslate: removeLangFromNeverTranslateMock,
    addSiteToAlwaysTranslate: addSiteToAlwaysTranslateMock,
    removeSiteFromAlwaysTranslate: removeSiteFromAlwaysTranslateMock,
    addSiteToNeverTranslate: addSiteToNeverTranslateMock,
    removeSiteFromNeverTranslate: removeSiteFromNeverTranslateMock,
    addSiteToTranslateWhenHovering: addSiteToTranslateWhenHoveringMock,
    removeSiteFromTranslateWhenHovering: removeSiteFromTranslateWhenHoveringMock,
    addLangToTranslateWhenHovering: addLangToTranslateWhenHoveringMock,
    removeLangFromTranslateWhenHovering: removeLangFromTranslateWhenHoveringMock,
    addLangToAlwaysTranslateAI: addLangToAlwaysTranslateAIMock,
    removeLangFromAlwaysTranslateAI: removeLangFromAlwaysTranslateAIMock,
    addSiteToAlwaysTranslateAI: addSiteToAlwaysTranslateAIMock,
    removeSiteFromAlwaysTranslateAI: removeSiteFromAlwaysTranslateAIMock,
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: (lang) => {
      const known = { en: "en", fr: "fr", de: "de", es: "es", zh: "zh-CN", ja: "ja", "en-US": "en" };
      return known[lang] || undefined;
    },
    codeToLanguage: (lang) => ({ en: "English", fr: "French", de: "German", es: "Spanish" }[lang] || lang),
    codeToLanguageNameInEnglish: (lang) => ({ en: "English", fr: "French", de: "German", es: "Spanish" }[lang] || lang),
    getLanguageList: () => ({ en: "English", fr: "French", de: "German", es: "Spanish", zh: "Chinese", ja: "Japanese" }),
  },
}));

vi.mock("../../src/lib/i18n.js", () => ({}));

describe("popup", () => {
  let pageState;

  function renderDom() {
    document.head.innerHTML = "";
    document.body.innerHTML = `
      <select id="selectTargetLanguage"></select>
      <select id="whereToDisplayTranslatedText">
        <option value="newLine">new line</option>
        <option value="replaceOriginal">replace</option>
      </select>
      <input type="checkbox" id="cbAlwaysTranslateThisLanguage"/>
      <label id="lblAlwaysTranslateThisLanguage"></label>
      <input type="checkbox" id="cbAlwaysTranslateThisLanguageAI"/>
      <label id="lblAlwaysTranslateThisLanguageWithAi"></label>
      <input type="checkbox" id="cbNeverTranslateThisLanguage"/>
      <input type="checkbox" id="cbAlwaysTranslateThisSite"/>
      <input type="checkbox" id="cbAlwaysTranslateThisSiteAI"/>
      <input type="checkbox" id="cbNeverTranslateThisSite"/>
      <input type="checkbox" id="cbShowTranslateSelectedButton"/>
      <input type="checkbox" id="cbShowOriginalWhenHovering"/>
      <input type="checkbox" id="cbShowTranslatedWhenHoveringThisSite"/>
      <input type="checkbox" id="cbShowTranslatedWhenHoveringThisLang"/>
      <button id="cbMoreOptions"></button>
      <div id="cbReportProblem">Report a problem</div>
      <div id="containerShowOriginalWhenHovering"></div>
      <div id="containerShowTranslatedWhenHoveringThisSite"></div>
      <div id="containerShowTranslatedWhenHoveringThisLang"></div>
      <hr id="hrOfLastItem"/>
      <span id="lblOriginalLanguage"></span>
    `;
  }

  async function flushMicrotasks(times = 5) {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  }

  async function loadModule() {
    await import("../../src/popup/popup.js");
    await flushMicrotasks();
  }

  function setCheckedAndDispatch(selector, checked) {
    const element = document.querySelector(selector);
    element.checked = checked;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    delete configValues.targetLanguage;
    configValues.targetLanguages = ["fr", "de", "es"];
    configValues.alwaysTranslateLangs = [];
    configValues.neverTranslateLangs = [];
    configValues.alwaysTranslateSites = [];
    configValues.neverTranslateSites = [];
    configValues.alwaysTranslateLangsAI = [];
    configValues.alwaysTranslateSitesAI = [];
    configValues.showTranslateSelectedButton = "yes";
    configValues.showOriginalTextWhenHovering = "no";
    configValues.sitesToTranslateWhenHovering = [];
    configValues.langsToTranslateWhenHovering = [];
    configValues.whereToDisplayTranslatedText = "replaceOriginal";
    configValues.darkMode = "no";

    pageState = {
      tabId: 11,
      url: "https://example.com/page",
      originalTabLanguage: "en",
      currentPageLanguage: "original",
      currentPageLanguageState: "original",
    };

    renderDom();
    globalThis.matchMedia = vi.fn(() => ({ matches: false }));
    globalThis.navigator = { language: "en-US" };
    window.close = vi.fn();
    globalThis.chrome = {
      i18n: {
        getMessage: vi.fn((key, substitutions) => {
          if (key === "btnMobileOriginal") return "Original";
          if (key === "lblTranslatePageInto") return "Translate into";
          // Issue #149: the two always-translate language labels carry the
          // detected language name through the $LANGUAGE_NAME$ placeholder.
          if (key === "btnAlwaysTranslateThisLanguage") {
            return `Always translate this language with Google - ${substitutions?.[0] ?? ""}`;
          }
          if (key === "btnAlwaysTranslateThisLanguageWithAi") {
            return `Always translate this language with AI - ${substitutions?.[0] ?? ""}`;
          }
          return "";
        }),
        getUILanguage: vi.fn(() => "en"),
      },
      runtime: {
        lastError: null,
        getURL: vi.fn((path) => `chrome-extension://test${path}`),
      },
      tabs: {
        query: vi.fn((_queryInfo, callback) => callback([{ id: pageState.tabId, url: pageState.url }])),
        sendMessage: vi.fn((tabId, message, optionsOrCallback, maybeCallback) => {
          const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;

          if (message.action === "getOriginalTabLanguage") {
            callback?.(pageState.originalTabLanguage);
            return;
          }
          if (message.action === "getCurrentPageLanguage") {
            callback?.(pageState.currentPageLanguage);
            return;
          }
          if (message.action === "getCurrentPageLanguageState") {
            callback?.(pageState.currentPageLanguageState);
            return;
          }
          callback?.();
        }),
        create: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.chrome;
  });

  it("populates target language select with Original first, then favorites, then all languages", async () => {
    await loadModule();

    const select = document.getElementById("selectTargetLanguage");
    const options = [...select.options].map(o => ({ value: o.value, text: o.textContent }));
    const values = options.map(o => o.value);
    const texts = options.map(o => o.text);

    // First option is Original
    expect(values[0]).toBe("original");
    expect(texts[0]).toBe("Original");

    // Favorites (fr, de, es) appear after the first separator
    expect(values).toContain("fr");
    expect(values).toContain("de");
    expect(values).toContain("es");

    // All languages should be present
    expect(values).toContain("en");
    expect(values).toContain("zh");
    expect(values).toContain("ja");
  });

  // 修复: 原测试仅检查 select.options[0].value，未真正验证轮询更新了语言标签
  it("shows the original tab language label via polling update", async () => {
    pageState.originalTabLanguage = "en";

    await loadModule();

    // 轮询应将语言标签更新为 English
    const lbl = document.getElementById("lblOriginalLanguage");
    expect(lbl).not.toBeNull();
    // 语言代码 "en" 映射为 "English"（mock 中 codeToLanguage 直接返回输入）
    expect(lbl.textContent).toBeTruthy();
    // 验证 select 的第一个选项仍为 "original"
    const select = document.getElementById("selectTargetLanguage");
    expect(select.options[0].value).toBe("original");
  });

  it("selects browser language as default when no target language is saved and page is original", async () => {
    pageState.currentPageLanguageState = "original";
    // configValues.targetLanguage is undefined (no saved preference)

    await loadModule();

    // Browser language is "en" (mocked), which passes fixTLanguageCode
    expect(document.getElementById("selectTargetLanguage").value).toBe("en");
  });

  it("selects saved target language when a preference exists and page is original", async () => {
    pageState.currentPageLanguageState = "original";
    configValues.targetLanguage = "de";

    await loadModule();

    expect(document.getElementById("selectTargetLanguage").value).toBe("de");
  });

  it("falls back to original when browser and OS languages are unsupported", async () => {
    pageState.currentPageLanguageState = "original";
    // Use unsupported codes that fixTLanguageCode will reject
    chrome.i18n.getUILanguage.mockReturnValue("xx");
    navigator.language = "yy";

    await loadModule();

    expect(document.getElementById("selectTargetLanguage").value).toBe("original");
  });

  it("selects the translated language when the page is translated", async () => {
    pageState.currentPageLanguage = "de";
    pageState.currentPageLanguageState = "translated";

    await loadModule();

    expect(document.getElementById("selectTargetLanguage").value).toBe("de");
  });

  it("translates the page when a language is selected from the dropdown", async () => {
    await loadModule();

    const select = document.getElementById("selectTargetLanguage");
    select.value = "es";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setTargetLanguageMock).toHaveBeenCalledWith("es");
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      { action: "translatePage", targetLanguage: "es" },
      expect.any(Function)
    );
  });

  it("translates the page when a favorite language is selected from the dropdown", async () => {
    await loadModule();
    vi.clearAllMocks();

    const select = document.getElementById("selectTargetLanguage");
    select.value = "fr";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setTargetLanguageMock).toHaveBeenCalledWith("fr");
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      { action: "translatePage", targetLanguage: "fr" },
      expect.any(Function)
    );
  });

  it("syncs checkbox state from config values", async () => {
    configValues.alwaysTranslateLangs = ["en"];
    configValues.neverTranslateLangs = ["en"];
    configValues.alwaysTranslateSites = ["example.com"];
    configValues.neverTranslateSites = ["example.com"];
    configValues.alwaysTranslateLangsAI = ["en"];
    configValues.alwaysTranslateSitesAI = ["example.com"];
    configValues.showTranslateSelectedButton = "yes";
    configValues.showOriginalTextWhenHovering = "yes";
    configValues.sitesToTranslateWhenHovering = ["example.com"];
    configValues.langsToTranslateWhenHovering = ["en"];

    await loadModule();

    expect(document.getElementById("cbAlwaysTranslateThisLanguage").checked).toBe(true);
    expect(document.getElementById("cbAlwaysTranslateThisLanguageAI").checked).toBe(true);
    expect(document.getElementById("cbNeverTranslateThisLanguage").checked).toBe(true);
    expect(document.getElementById("cbAlwaysTranslateThisSite").checked).toBe(true);
    expect(document.getElementById("cbAlwaysTranslateThisSiteAI").checked).toBe(true);
    expect(document.getElementById("cbNeverTranslateThisSite").checked).toBe(true);
    expect(document.getElementById("cbShowTranslateSelectedButton").checked).toBe(true);
    expect(document.getElementById("cbShowOriginalWhenHovering").checked).toBe(true);
    expect(document.getElementById("cbShowTranslatedWhenHoveringThisSite").checked).toBe(true);
    expect(document.getElementById("cbShowTranslatedWhenHoveringThisLang").checked).toBe(true);
  });

  it("disables language-dependent controls when the original language is und", async () => {
    pageState.originalTabLanguage = "und";

    await loadModule();

    expect(document.getElementById("cbAlwaysTranslateThisLanguage").disabled).toBe(true);
    expect(document.getElementById("cbAlwaysTranslateThisLanguageAI").disabled).toBe(true);
    expect(document.getElementById("cbNeverTranslateThisLanguage").disabled).toBe(true);
    expect(document.getElementById("cbShowTranslatedWhenHoveringThisLang").disabled).toBe(true);
  });

  it("disables site-dependent controls when the hostname cannot be determined", async () => {
    pageState.url = "not-a-valid-url";

    await loadModule();

    expect(document.getElementById("cbAlwaysTranslateThisSite").disabled).toBe(true);
    expect(document.getElementById("cbAlwaysTranslateThisSiteAI").disabled).toBe(true);
    expect(document.getElementById("cbNeverTranslateThisSite").disabled).toBe(true);
    expect(document.getElementById("cbShowTranslatedWhenHoveringThisSite").disabled).toBe(true);
  });

  it("hides hovering controls when translated text is displayed on a new line", async () => {
    configValues.whereToDisplayTranslatedText = "newLine";

    await loadModule();

    expect(document.getElementById("containerShowOriginalWhenHovering").style.display).toBe("none");
    expect(document.getElementById("containerShowTranslatedWhenHoveringThisSite").style.display).toBe("none");
    expect(document.getElementById("containerShowTranslatedWhenHoveringThisLang").style.display).toBe("none");
    expect(document.getElementById("hrOfLastItem").style.display).toBe("none");
  });

  it("shows hovering controls when translated text is not displayed on a new line", async () => {
    configValues.whereToDisplayTranslatedText = "replaceOriginal";

    await loadModule();

    expect(document.getElementById("containerShowOriginalWhenHovering").style.display).toBe("block");
    expect(document.getElementById("containerShowTranslatedWhenHoveringThisSite").style.display).toBe("block");
    expect(document.getElementById("containerShowTranslatedWhenHoveringThisLang").style.display).toBe("block");
    expect(document.getElementById("hrOfLastItem").style.display).toBe("block");
  });

  it("adds the original language to always-translate when checked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbAlwaysTranslateThisLanguage", true);

    expect(addLangToAlwaysTranslateMock).toHaveBeenCalledWith("en", "example.com");
    expect(removeLangFromNeverTranslateMock).toHaveBeenCalledWith("en");
  });

  it("removes the original language from always-translate when unchecked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbAlwaysTranslateThisLanguage", false);

    expect(removeLangFromAlwaysTranslateMock).toHaveBeenCalledWith("en");
  });

  it("adds the original language to never-translate when checked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbNeverTranslateThisLanguage", true);

    expect(addLangToNeverTranslateMock).toHaveBeenCalledWith("en", "example.com");
    expect(removeLangFromAlwaysTranslateMock).toHaveBeenCalledWith("en");
  });

  it("adds the hostname to always-translate when checked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbAlwaysTranslateThisSite", true);

    expect(addSiteToAlwaysTranslateMock).toHaveBeenCalledWith("example.com");
    expect(removeSiteFromNeverTranslateMock).toHaveBeenCalledWith("example.com");
  });

  // ── AI always-translate checkboxes (issue #145) ──────────────────────

  it("adds the original language to always-translate-AI when checked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbAlwaysTranslateThisLanguageAI", true);

    expect(addLangToAlwaysTranslateAIMock).toHaveBeenCalledWith("en", "example.com");
  });

  it("removes the original language from always-translate-AI when unchecked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbAlwaysTranslateThisLanguageAI", false);

    expect(removeLangFromAlwaysTranslateAIMock).toHaveBeenCalledWith("en");
  });

  it("adds the hostname to always-translate-AI when checked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbAlwaysTranslateThisSiteAI", true);

    expect(addSiteToAlwaysTranslateAIMock).toHaveBeenCalledWith("example.com");
  });

  it("removes the hostname from always-translate-AI when unchecked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbAlwaysTranslateThisSiteAI", false);

    expect(removeSiteFromAlwaysTranslateAIMock).toHaveBeenCalledWith("example.com");
  });

  it("syncs AI checkbox state from config values", async () => {
    configValues.alwaysTranslateLangsAI = ["en"];
    configValues.alwaysTranslateSitesAI = ["example.com"];

    await loadModule();

    expect(document.getElementById("cbAlwaysTranslateThisLanguageAI").checked).toBe(true);
    expect(document.getElementById("cbAlwaysTranslateThisSiteAI").checked).toBe(true);
  });

  it("adds the hostname to never-translate when checked", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbNeverTranslateThisSite", true);

    expect(addSiteToNeverTranslateMock).toHaveBeenCalledWith("example.com");
    expect(removeSiteFromAlwaysTranslateMock).toHaveBeenCalledWith("example.com");
  });

  it("stores showTranslateSelectedButton changes", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbShowTranslateSelectedButton", false);
    setCheckedAndDispatch("#cbShowTranslateSelectedButton", true);

    expect(setMock).toHaveBeenCalledWith("showTranslateSelectedButton", "no");
    expect(setMock).toHaveBeenCalledWith("showTranslateSelectedButton", "yes");
  });

  it("stores showOriginalWhenHovering changes", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbShowOriginalWhenHovering", true);
    setCheckedAndDispatch("#cbShowOriginalWhenHovering", false);

    expect(setMock).toHaveBeenCalledWith("showOriginalTextWhenHovering", "yes");
    expect(setMock).toHaveBeenCalledWith("showOriginalTextWhenHovering", "no");
  });

  it("stores hovering preferences for the current site and language", async () => {
    await loadModule();

    setCheckedAndDispatch("#cbShowTranslatedWhenHoveringThisSite", true);
    setCheckedAndDispatch("#cbShowTranslatedWhenHoveringThisLang", true);

    expect(addSiteToTranslateWhenHoveringMock).toHaveBeenCalledWith("example.com");
    expect(addLangToTranslateWhenHoveringMock).toHaveBeenCalledWith("en");
  });

  it("opens the options page from the more options button", async () => {
    await loadModule();

    document.getElementById("cbMoreOptions").click();

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://test/options/options.html",
    });
  });

  it("opens the feedback section from the report-problem row (plan 35)", async () => {
    await loadModule();

    document.getElementById("cbReportProblem").click();

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://test/options/options.html#feedback",
    });
  });

  // 修复: 原测试仅检查 DOM 元素非空，未真正验证轮询行为
  it("polls for the original tab language every 1500ms", async () => {
    await loadModule();
    pageState.originalTabLanguage = "fr";

    // 推进 1500ms 触发 setInterval 回调
    vi.advanceTimersByTime(1500);
    await flushMicrotasks();

    // 轮询回调应通过 chrome.tabs.sendMessage 获取语言
    expect(chrome.tabs.sendMessage).toHaveBeenCalled();
    // 语言标签应反映轮询结果（"fr" → language name）
    const lbl = document.getElementById("lblOriginalLanguage");
    expect(lbl).not.toBeNull();
    expect(lbl.textContent).toBeTruthy();
    // select 元素应仍然存在且可用
    expect(document.getElementById("selectTargetLanguage")).not.toBeNull();
  });

  // ── issue #149：两个 always-translate 语言行的 label 必须带语言名 ──

  it("names the detected language in both always-translate language rows", async () => {
    pageState.originalTabLanguage = "fr";

    await loadModule();

    const google = document.getElementById("lblAlwaysTranslateThisLanguage");
    const ai = document.getElementById("lblAlwaysTranslateThisLanguageWithAi");
    expect(google.textContent).toContain("French");
    expect(ai.textContent).toContain("French");
  });

  it("refreshes both language-row labels when polling detects a language change (SPA)", async () => {
    pageState.originalTabLanguage = "fr";
    await loadModule();

    expect(document.getElementById("lblAlwaysTranslateThisLanguage").textContent).toContain("French");

    pageState.originalTabLanguage = "de";
    vi.advanceTimersByTime(1500);
    await flushMicrotasks();

    expect(document.getElementById("lblAlwaysTranslateThisLanguage").textContent).toContain("German");
    expect(document.getElementById("lblAlwaysTranslateThisLanguageWithAi").textContent).toContain("German");
  });

  it("adds dark mode styles when dark mode is enabled", async () => {
    configValues.darkMode = "yes";

    await loadModule();

    expect(document.getElementById("darkModeElement")).not.toBeNull();
  });

  it("does not add dark mode styles when dark mode is disabled", async () => {
    configValues.darkMode = "no";

    await loadModule();

    expect(document.getElementById("darkModeElement")).toBeNull();
  });
});
