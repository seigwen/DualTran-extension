  // Helper: Shorthand utility: use $ as alias for document.querySelector (must be defined early before first use of $)
  // Returns the matched DOM element; if not found, returns a null-safe proxy to avoid TypeError on subsequent property access (e.g. .onchange = ...).
  var _rawQS = document.querySelector.bind(document);
  // Cached null-safe proxy object: absorbs all property reads/writes, method calls, and addEventListener operations without throwing.
  // Uses Proxy instead of a dummy DOM element because the referenced IDs involve different element types like <select>, <input>, etc.,
  // and needs to be compatible with various properties like .options, .selectedIndex, .checked, .value, .style, etc.
  var _nullProxy = new Proxy(function () {}, {
    get: function (_target, prop) {
      // Flag property: allows external code to check if (el._isMissingElement) to determine if this is a dummy proxy
      if (prop === "_isMissingElement") return true;
      // Special properties: make truthiness checks and type coercion work correctly
      if (prop === Symbol.toPrimitive || prop === "valueOf") return function () { return 0; };
      if (prop === "toString") return function () { return ""; };
      // .options should return an empty array-like to be compatible with Array.from(select.options || [])
      if (prop === "options") return [];
      // .classList returns an empty DOMTokenList proxy
      if (prop === "classList") return _nullProxy;
      // .style returns itself as proxy (allows chained assignment like .style.display = "none")
      if (prop === "style") return _nullProxy;
      // .length used for options.length etc.
      if (prop === "length") return 0;
      // Numeric properties
      if (prop === "selectedIndex") return -1;
      // Boolean properties
      if (prop === "checked" || prop === "disabled") return false;
      // String properties
      if (prop === "value" || prop === "innerHTML" || prop === "textContent" || prop === "color") return "";
      // Method-like properties return empty functions (addEventListener, appendChild, querySelector, etc.)
      if (prop === "addEventListener" || prop === "removeEventListener" ||
          prop === "appendChild" || prop === "removeChild" ||
          prop === "querySelector" || prop === "querySelectorAll" ||
          prop === "setAttribute" || prop === "removeAttribute" ||
          prop === "getAttribute" || prop === "contains" ||
          prop === "add" || prop === "remove" || prop === "toggle" ||
          prop === "splice" || prop === "forEach" || prop === "map" ||
          prop === "find" || prop === "some" || prop === "filter") {
        return function () { return _nullProxy; };
      }
      // ownerDocument — some code like renderModelOptions uses select.ownerDocument.createElement to create elements
      if (prop === "ownerDocument") return document;
      // dataset
      if (prop === "dataset") return {};
      // Other properties return undefined (no recursive proxying to avoid infinite depth)
      return undefined;
    },
    // Intercept property assignment (e.g. .onchange = fn, .value = "xxx") —
    // on a null proxy this means the target DOM element does not exist, must emit a visible warning.
    set: function (_target, prop, _value) {
      // Event handler property assignment is the most dangerous silent failure: the handler is registered but never fires
      if (typeof prop === "string" && /^on(change|input|click|keyup|keydown|blur|focus)$/.test(prop)) {
        console.warn("[options.js] Cannot assign " + prop + " handler: target element not found in DOM. The handler will never fire.");
      }
      return true;
    },
    apply: function () { return _nullProxy; },  // Return proxy itself when called as a function
  });
  /** @type {typeof document.querySelector} */
  var $ = function $(selector) {
    var el = _rawQS(selector);
    if (el) return el;
    // If element not found, print a warning for debugging, then return the null-safe proxy
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[options.js] Element not found for selector:", selector);
    }
    return _nullProxy;
  };
  // Helper: get i18n text with a default fallback (to avoid empty strings when some locales lack a key)
  // If the passed fallback contains Chinese characters, convert it to English using a set of safe replacement rules.
  // The conversion uses localization-friendly simple mappings/rules covering common error messages and patterns like empty model lists.
  function i18nOrDefault(key, fallback) {
    try {
      const msg = chrome.i18n.getMessage(key);
      if (msg && msg.length) return msg;
    } catch (e) {
      // ignore
    }

    const fb = fallback || "";

    // If the fallback contains Chinese characters, attempt to convert to English (using safe rules, avoiding external translation services)
    if (/[\u4E00-\u9FFF]/.test(fb)) {
      let english = String(fb);

      // First try to match patterns like: "Unable to load <Provider> models (HTTP 123)"
      english = english.replace(/无法加载\s*(.+?)\s*模型/g, 'Unable to load $1 models');
      // Common pattern replacements
      english = english.replace(/无法从API加载/g, 'Unable to load from API');
      english = english.replace(/模型列表为空/g, 'models list is empty');
      // General "模型" -> "models", placed last to avoid overriding the capture rules above
      english = english.replace(/模型/g, 'models');
      english = english.replace(/无法加载/g, 'Unable to load');

      // If the result still contains Chinese characters (no rule matched), fall back to a generic English message for readability
      if (/[\u4E00-\u9FFF]/.test(english)) {
        // Preserve HTTP status codes or other content within parentheses
        const httpMatch = fb.match(/\(HTTP[^)]+\)/i);
        const httpPart = httpMatch ? ` ${httpMatch[0]}` : '';
        return `Unable to load models${httpPart}`;
      }

      return english;
    }

    return fb;
  }

  // Azure OpenAI model dropdown auto-fill
  async function populateAzureOpenAIModels(select, apiKey, endpoint, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    const sanitizedEndpoint = (endpoint || "").trim().replace(/\/$/, "");
    const hasConfig = sanitizedKey && sanitizedEndpoint;
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "azure-openai",
        missingConfigNotice: "",
        loadOptions: hasConfig
          ? () => loadAiProviderModelOptions({
              provider: "azure-openai",
              apiKey: sanitizedKey,
              endpoint: sanitizedEndpoint,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "azure-openai" }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("Unable to load Azure OpenAI models from API:", error);
    }
  }
  // Azure OpenAI model dropdown auto-fill logic
  const azureOpenAIModelSelect = $("#azureOpenAIModel");
  const fallbackAzureOpenAIOptions = azureOpenAIModelSelect
    ? Array.from(azureOpenAIModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedAzureOpenAIModel = twpConfig.get("azureOpenAIModel") || "";
  const apiKeyAzureOpenAIInput = $("#apiKeyAzureOpenAI");
  const storedApiKeyAzureOpenAI = (twpConfig.get("apiKeyAzureOpenAI") || "").trim();
  const azureOpenAIEndpointInput = $("#azureOpenAIEndpoint");
  const storedAzureOpenAIEndpoint = (twpConfig.get("azureOpenAIEndpoint") || "").trim();
  if (apiKeyAzureOpenAIInput) {
    apiKeyAzureOpenAIInput.value = storedApiKeyAzureOpenAI;
    apiKeyAzureOpenAIInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyAzureOpenAIInput.value = newKey;
      twpConfig.set("apiKeyAzureOpenAI", newKey);
      if (azureOpenAIModelSelect) {
        const selectedModel =
          azureOpenAIModelSelect.value || twpConfig.get("azureOpenAIModel") || "";
        populateAzureOpenAIModels(
          azureOpenAIModelSelect,
          newKey,
          azureOpenAIEndpointInput ? azureOpenAIEndpointInput.value : "",
          selectedModel,
          fallbackAzureOpenAIOptions
        );
      }
    };
  }
  if (azureOpenAIEndpointInput) {
    azureOpenAIEndpointInput.value = storedAzureOpenAIEndpoint;
    azureOpenAIEndpointInput.onchange = (e) => {
      const newEndpoint = (e.target.value || "").trim();
      azureOpenAIEndpointInput.value = newEndpoint;
      twpConfig.set("azureOpenAIEndpoint", newEndpoint);
      if (azureOpenAIModelSelect) {
        const selectedModel =
          azureOpenAIModelSelect.value || twpConfig.get("azureOpenAIModel") || "";
        populateAzureOpenAIModels(
          azureOpenAIModelSelect,
          apiKeyAzureOpenAIInput ? apiKeyAzureOpenAIInput.value : "",
          newEndpoint,
          selectedModel,
          fallbackAzureOpenAIOptions
        );
      }
    };
  }
  if (azureOpenAIModelSelect) {
    populateAzureOpenAIModels(
      azureOpenAIModelSelect,
      storedApiKeyAzureOpenAI,
      storedAzureOpenAIEndpoint,
      storedAzureOpenAIModel,
      fallbackAzureOpenAIOptions
    );
    azureOpenAIModelSelect.onchange = (e) => {
      twpConfig.set("azureOpenAIModel", e.target.value);
    };
  }
  // DeepSeek model dropdown auto-fill
  async function populateDeepSeekModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "deepseek",
        missingConfigNotice: "",
        loadOptions: sanitizedKey
          ? () => loadAiProviderModelOptions({
              provider: "deepseek",
              apiKey: sanitizedKey,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "deepseek" }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("Unable to load DeepSeek models from API:", error);
    }
  }
  // DeepSeek model dropdown auto-fill logic
  const deepSeekModelSelect = $("#deepSeekModel");
  const fallbackDeepSeekOptions = deepSeekModelSelect
    ? Array.from(deepSeekModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedDeepSeekModel = twpConfig.get("deepSeekModel") || "";
  const apiKeyDeepSeekInput = $("#apiKeyDeepSeek");
  const storedApiKeyDeepSeek = (twpConfig.get("apiKeyDeepSeek") || "").trim();
  if (apiKeyDeepSeekInput) {
    apiKeyDeepSeekInput.value = storedApiKeyDeepSeek;
    apiKeyDeepSeekInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyDeepSeekInput.value = newKey;
      twpConfig.set("apiKeyDeepSeek", newKey);
      if (deepSeekModelSelect) {
        const selectedModel =
          deepSeekModelSelect.value || twpConfig.get("deepSeekModel") || "";
        populateDeepSeekModels(
          deepSeekModelSelect,
          newKey,
          selectedModel,
          fallbackDeepSeekOptions
        );
      }
    };
  }
  if (deepSeekModelSelect) {
    populateDeepSeekModels(
      deepSeekModelSelect,
      storedApiKeyDeepSeek,
      storedDeepSeekModel,
      fallbackDeepSeekOptions
    );
    deepSeekModelSelect.onchange = (e) => {
      twpConfig.set("deepSeekModel", e.target.value);
    };
  }
  // Grok model dropdown auto-fill
  async function populateGrokModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "grok",
        missingConfigNotice: "",
        loadOptions: sanitizedKey
          ? () => loadAiProviderModelOptions({
              provider: "grok",
              apiKey: sanitizedKey,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "grok" }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("Unable to load Grok models from API:", error);
    }
  }
  // Grok model dropdown auto-fill logic
  const grokModelSelect = $("#grokModel");
  const fallbackGrokOptions = grokModelSelect
    ? Array.from(grokModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedGrokModel = twpConfig.get("grokModel") || "";
  const apiKeyGrokInput = $("#apiKeyGrok");
  const storedApiKeyGrok = (twpConfig.get("apiKeyGrok") || "").trim();
  if (apiKeyGrokInput) {
    apiKeyGrokInput.value = storedApiKeyGrok;
    apiKeyGrokInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyGrokInput.value = newKey;
      twpConfig.set("apiKeyGrok", newKey);
      if (grokModelSelect) {
        const selectedModel =
          grokModelSelect.value || twpConfig.get("grokModel") || "";
        populateGrokModels(
          grokModelSelect,
          newKey,
          selectedModel,
          fallbackGrokOptions
        );
      }
    };
  }
  if (grokModelSelect) {
    populateGrokModels(
      grokModelSelect,
      storedApiKeyGrok,
      storedGrokModel,
      fallbackGrokOptions
    );
    grokModelSelect.onchange = (e) => {
      twpConfig.set("grokModel", e.target.value);
    };
  }
  // Anthropic model dropdown auto-fill
  async function populateAnthropicModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "anthropic",
        missingConfigNotice: "",
        loadOptions: sanitizedKey
          ? () => loadAiProviderModelOptions({
              provider: "anthropic",
              apiKey: sanitizedKey,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "anthropic" }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("Unable to load Anthropic models from API:", error);
    }
  }

  // Anthropic model dropdown auto-fill logic
  const anthropicModelSelect = $("#anthropicModel");
  const fallbackAnthropicOptions = anthropicModelSelect
    ? Array.from(anthropicModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedAnthropicModel = twpConfig.get("anthropicModel") || "";
  const apiKeyAnthropicInput = $("#apiKeyAnthropic");
  const storedApiKeyAnthropic = (twpConfig.get("apiKeyAnthropic") || "").trim();
  if (apiKeyAnthropicInput) {
    apiKeyAnthropicInput.value = storedApiKeyAnthropic;
    apiKeyAnthropicInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyAnthropicInput.value = newKey;
      twpConfig.set("apiKeyAnthropic", newKey);
      if (anthropicModelSelect) {
        const selectedModel =
          anthropicModelSelect.value || twpConfig.get("anthropicModel") || "";
        populateAnthropicModels(
          anthropicModelSelect,
          newKey,
          selectedModel,
          fallbackAnthropicOptions
        );
      }
    };
  }
  if (anthropicModelSelect) {
    populateAnthropicModels(
      anthropicModelSelect,
      storedApiKeyAnthropic,
      storedAnthropicModel,
      fallbackAnthropicOptions
    );
    anthropicModelSelect.onchange = (e) => {
      twpConfig.set("anthropicModel", e.target.value);
    };
  }
"use strict"; // Enable strict mode to avoid potential implicit errors

import twpLang from "../lib/languages.js" // Import language utilities
import twpConfig from "../lib/config.js" // Import config storage module
import platformInfo from "../lib/platformInfo.js" // Import platform info (detect mobile, etc.)
import "../lib/i18n.js" // Import i18n initialization script (side-effect import)
import { createAiOptionsController } from "./aiOptionsController.js";
import { enableDarkMode, disableDarkMode } from "./darkmode.js"; // Import dark mode toggle functions
import { loadAiProviderModelOptions, normalizeOpenAiCompatibleModelsEndpoint } from "./aiModelApi.js";
import { refreshAiModelSelect } from "./aiModelRefresh.js";
import { loadPreviewModels } from "../lib/ai/providerModelPreview.js";
import { createProviderRegistry, BUILT_IN_PROVIDERS, mergeRegistries, lookupKnownApiBase } from "../lib/ai/providerRegistry.js";
import { migrateProviderConfig } from "../lib/ai/providerMigration.js";
import 'toolcool-color-picker'; // Import third-party color picker component (custom element)

// Execute main initialization logic after config is loaded
twpConfig.onReady(function () {
  if (platformInfo.isMobile.any) { // If on any mobile device
    let style = document.createElement("style"); // Dynamically create a style element
    style.textContent = ".desktopOnly {display: none !important}"; // Hide desktop-only elements
    document.head.appendChild(style); // Inject into page
  }

  let sideBarIsVisible = false; // Track whether sidebar is currently expanded; false when page width is small (typically mobile), true when expanded

  $("#btnOpenMenu").onclick = (e) => { // Bind click event for menu button, located at top-right corner, visible on mobile.
    $("#menuContainer").classList.toggle("change"); // Toggle animation/style class

    if (sideBarIsVisible) { // If currently shown, hide it
      $("#sideBar").style.display = "none";
      sideBarIsVisible = false; // Update state
    } else { // If currently hidden, show it
      $("#sideBar").style.display = "block";
      sideBarIsVisible = true; // Update state
    }
  };

  /**
   * Callback function for url hash change event
   * When the url hash changes, show the element represented by the hash (tab content) and hide others
   */
  function hashchange() { // Handle address bar #hash switching
    const hash = location.hash || "#languages"; // Current hash, defaults to languages tab
    const divs = [ // Collection of all tab content blocks
      $("#languages"),
      $("#sites"),
      $("#translations"),
      $("#ai"),
      $("#style"),
      $("#hotkeys"),
      $("#storage"),
      $("#others"),
    ];
    divs.forEach((element) => { // Hide all uniformly
      element.style.display = "none";
    });

    document.querySelectorAll("nav a").forEach((a) => { // Remove all navigation highlights
      a.classList.remove("w3-light-grey");
    });

    if($(hash).style.display){ // If the element for current hash has a display property (this check seems redundant)
      $(hash).style.display = "block"; // Show the corresponding tab
    }
    $('a[href="' + hash + '"]').classList.add("w3-light-grey"); // Highlight the corresponding nav link

    let text; // Title text
    text = chrome.i18n.getMessage("lblSettings"); // Get localized title

    $("#itemSelectedName").textContent = text; // Update the selected item name displayed in header

    if (sideBarIsVisible) { // If sidebar is currently shown, toggle to hidden (close on mobile after click)
      $("#menuContainer").classList.toggle("change"); // Sync button visual state
      $("#sideBar").style.display = "none"; // Hide sidebar
      sideBarIsVisible = false; // Update state
    }

  }
  hashchange(); // On init, show the tab corresponding to current hash
  window.addEventListener("hashchange", hashchange); // Listen for hash changes

  /**
   * Fill language list for a dropdown
   * @param { Element } select Target select element (dropdown)
   */
  function fillLanguageList(select) { // Dynamically fill language dropdown
    let langs = twpLang.getLanguageList(); // Get language mapping (code -> name)

    const langsSorted = []; // Sorted array

    for (const i in langs) { // Iterate object properties
      langsSorted.push([i, langs[i]]); // Push into array for sorting
    }

    langsSorted.sort(function (a, b) { // Sort by language name
      return a[1]?.localeCompare?.(b[1]);
    });

    langsSorted.forEach((value) => { // Generate and insert option elements
      const option = document.createElement("option");
      option.value = value[0]; // Language code
      option.textContent = value[1]; // Display name
      select.appendChild(option);
    });
  }

  fillLanguageList($("#selectTargetLanguage")); // Fill language list for web page translation target dropdown
  fillLanguageList($("#selectTargetLanguageForText")); // Fill language list for text translation target dropdown

  fillLanguageList($("#favoriteLanguage1")); // Fill language list for favorite language 1 dropdown
  fillLanguageList($("#favoriteLanguage2")); // Fill language list for favorite language 2 dropdown
  fillLanguageList($("#favoriteLanguage3")); // Fill language list for favorite language 3 dropdown

  fillLanguageList($("#addToNeverTranslateLangs")); // Fill language list for never-translate language dropdown
  fillLanguageList($("#addToAlwaysTranslateLangs")); // Fill language list for always-translate language dropdown
  fillLanguageList($("#addLangToTranslateWhenHovering")); // Fill language list for translate-on-hover language dropdown

  function updateDarkMode() { // Apply dark mode strategy based on config
    switch (twpConfig.get("darkMode")) { // Get darkMode config value
      case "auto": // Auto mode: follow system preference
        if (matchMedia("(prefers-color-scheme: dark)").matches) { // If system prefers dark
          enableDarkMode(); // Enable
        } else {
          disableDarkMode(); // Otherwise disable
        }
        break;
      case "yes": // Force enable
        enableDarkMode();
        break;
      case "no": // Force disable
        disableDarkMode();
        break;
      default: // Other cases not handled
        break;
    }
  }
  updateDarkMode(); // Execute once on init

  // Web page translation target language config
  const targetLanguage = twpConfig.get("targetLanguage"); // Current web page translation target language
  $("#selectTargetLanguage").value = targetLanguage; // Set select initial value
  $("#selectTargetLanguage").onchange = (e) => { // Change event handler
    console.log("target language is changed to: ", e.target.value) // Log to console
    twpConfig.setTargetLanguage(e.target.value); // Update config
    // reload options page to refresh language-dependent parts of the UI
    location.reload();
  };

  // Text translation target language config
  const targetLanguageTextTranslation = twpConfig.get(
    "targetLanguageTextTranslation"
  ); // Get text translation target language
  $("#selectTargetLanguageForText").value = targetLanguageTextTranslation; // Set initial value
  $("#selectTargetLanguageForText").onchange = (e) => { // Selection change event
    twpConfig.setTargetLanguage(e.target.value, true); // Set text translation target language
    twpConfig.setTargetLanguage(targetLanguage, false); // Sync main language (preserve the previous main language)
    location.reload(); // Reload to refresh
  };

  // Priority target languages config
  const targetLanguages = twpConfig.get("targetLanguages"); // Favorite languages array [l1,l2,l3]
  $("#favoriteLanguage1").value = targetLanguages[0]; // Initialize favorite language 1
  $("#favoriteLanguage2").value = targetLanguages[1]; // Initialize favorite language 2
  $("#favoriteLanguage3").value = targetLanguages[2]; // Initialize favorite language 3

  $("#favoriteLanguage1").onchange = (e) => { // Favorite language 1 change
    targetLanguages[0] = e.target.value; // Update in-memory array
    twpConfig.set("targetLanguages", targetLanguages); // Save
    if (targetLanguages.indexOf(twpConfig.get("targetLanguage")) == -1) { // If current main language is no longer in favorites
      twpConfig.set("targetLanguage", targetLanguages[0]); // Reset to first favorite
    }
    if (
      targetLanguages.indexOf(twpConfig.get("targetLanguageTextTranslation")) ==
      -1
    ) { // If text translation target language is not in favorites
      twpConfig.set("targetLanguageTextTranslation", targetLanguages[0]); // Reset
    }
    location.reload(); // Refresh UI
  };

  $("#favoriteLanguage2").onchange = (e) => { // Favorite language 2 change logic (same as above)
    targetLanguages[1] = e.target.value;
    twpConfig.set("targetLanguages", targetLanguages);
    if (targetLanguages.indexOf(twpConfig.get("targetLanguage")) == -1) {
      twpConfig.set("targetLanguage", targetLanguages[0]);
    }
    if (
      targetLanguages.indexOf(twpConfig.get("targetLanguageTextTranslation")) ==
      -1
    ) {
      twpConfig.set("targetLanguageTextTranslation", targetLanguages[0]);
    }
    location.reload();
  };

  $("#favoriteLanguage3").onchange = (e) => { // Favorite language 3 change
    targetLanguages[2] = e.target.value;
    twpConfig.set("targetLanguages", targetLanguages);
    if (targetLanguages.indexOf(twpConfig.get("targetLanguage")) == -1) {
      twpConfig.set("targetLanguage", targetLanguages[0]);
    }
    if (
      targetLanguages.indexOf(twpConfig.get("targetLanguageTextTranslation")) ==
      -1
    ) {
      twpConfig.set("targetLanguageTextTranslation", targetLanguages[0]);
    }
    location.reload();
  };

  // Never-translate language list config
  function createNodeToNeverTranslateLangsList(langCode, langName) { // Create never-translate language list item
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container"); // Container class
    li.value = langCode; // Store language code
    li.textContent = langName; // Display language name

    const close = document.createElement("span"); // Delete button
    close.setAttribute("class", "w3-button w3-transparent w3-display-right"); // Style classes
    close.innerHTML = "&times;"; // Multiplication sign symbol

    close.onclick = (e) => { // Click to delete
      e.preventDefault();

      twpConfig.removeLangFromNeverTranslate(langCode); // Remove from config
      li.remove(); // Remove from DOM
    };

    li.appendChild(close); // Attach button

    return li; // Return DOM node
  }

  const neverTranslateLangs = twpConfig.get("neverTranslateLangs"); // Get never-translate languages array
  neverTranslateLangs.sort((a, b) => a?.localeCompare?.(b)); // Sort
  neverTranslateLangs.forEach((langCode) => { // Render list
    const langName = twpLang.codeToLanguage(langCode); // Code to name
    const li = createNodeToNeverTranslateLangsList(langCode, langName); // Create LI element
    $("#neverTranslateLangs").appendChild(li); // Insert into DOM
  });

  $("#addToNeverTranslateLangs").onchange = (e) => { // Add never-translate language event
    const langCode = e.target.value; // Selected language code
    const langName = twpLang.codeToLanguage(langCode); // Convert to name
    const li = createNodeToNeverTranslateLangsList(langCode, langName); // Create node
    $("#neverTranslateLangs").appendChild(li); // Insert into DOM

    twpConfig.addLangToNeverTranslate(langCode); // Save to config
  };

  // Always-translate language list config
  function createNodeToAlwaysTranslateLangsList(langCode, langName) { // Create always-translate language list item
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = langCode;
    li.textContent = langName;

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // Delete event
      e.preventDefault();

      twpConfig.removeLangFromAlwaysTranslate(langCode); // Remove from config
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const alwaysTranslateLangs = twpConfig.get("alwaysTranslateLangs"); // Get always-translate languages array
  alwaysTranslateLangs.sort((a, b) => a?.localeCompare?.(b)); // Sort
  alwaysTranslateLangs.forEach((langCode) => { // Render
    const langName = twpLang.codeToLanguage(langCode);
    const li = createNodeToAlwaysTranslateLangsList(langCode, langName);
    $("#alwaysTranslateLangs").appendChild(li);
  });

  $("#addToAlwaysTranslateLangs").onchange = (e) => { // Add event
    const langCode = e.target.value;
    const langName = twpLang.codeToLanguage(langCode);
    const li = createNodeToAlwaysTranslateLangsList(langCode, langName);
    $("#alwaysTranslateLangs").appendChild(li);

    twpConfig.addLangToAlwaysTranslate(langCode); // Save to config
  };

  // Translate-on-hover language list config
  function createNodeToLangsToTranslateWhenHoveringList(langCode, langName) { // Create translate-on-hover language list item
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = langCode;
    li.textContent = langName;

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // Delete event
      e.preventDefault();

      twpConfig.removeLangFromTranslateWhenHovering(langCode); // Remove from config
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const langsToTranslateWhenHovering = twpConfig.get(
    "langsToTranslateWhenHovering"
  ); // Get translate-on-hover languages array
  langsToTranslateWhenHovering.sort((a, b) => a?.localeCompare?.(b)); // Sort
  langsToTranslateWhenHovering.forEach((langCode) => { // Render
    const langName = twpLang.codeToLanguage(langCode);
    const li = createNodeToLangsToTranslateWhenHoveringList(langCode, langName);
    $("#langsToTranslateWhenHovering").appendChild(li);
  });

  $("#addLangToTranslateWhenHovering").onchange = (e) => { // Add event
    const langCode = e.target.value;
    const langName = twpLang.codeToLanguage(langCode);
    const li = createNodeToLangsToTranslateWhenHoveringList(langCode, langName);
    $("#langsToTranslateWhenHovering").appendChild(li);

    twpConfig.addLangToTranslateWhenHovering(langCode); // Save to config
  };

  // Always-translate sites list config
  function createNodeToAlwaysTranslateSitesList(hostname) { // Create always-translate site list item
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = hostname; // Store hostname
    li.textContent = hostname; // Display hostname

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // Delete site
      e.preventDefault();

      twpConfig.removeSiteFromAlwaysTranslate(hostname); // Remove from config
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const alwaysTranslateSites = twpConfig.get("alwaysTranslateSites"); // Get always-translate sites array
  alwaysTranslateSites.sort((a, b) => a?.localeCompare?.(b)); // Alphabetical sort
  alwaysTranslateSites.forEach((hostname) => { // Render
    const li = createNodeToAlwaysTranslateSitesList(hostname);
    $("#alwaysTranslateSites").appendChild(li);
  });

  $("#addToAlwaysTranslateSites").onclick = (e) => { // Add site button
    const hostname = prompt("Enter the site hostname", "www.site.com"); // Prompt for input
    if (!hostname) return; // Return on cancel

    const li = createNodeToAlwaysTranslateSitesList(hostname); // Create node
    $("#alwaysTranslateSites").appendChild(li); // Insert

    twpConfig.addSiteToAlwaysTranslate(hostname); // Save to config
  };

  // Never-translate sites list config

  function createNodeToNeverTranslateSitesList(hostname) { // Create never-translate site list item
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = hostname;
    li.textContent = hostname;

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // Delete event
      e.preventDefault();

      twpConfig.removeSiteFromNeverTranslate(hostname); // Remove from config
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const neverTranslateSites = twpConfig.get("neverTranslateSites"); // Get never-translate sites array
  neverTranslateSites.sort((a, b) => a?.localeCompare?.(b)); // Sort
  neverTranslateSites.forEach((hostname) => { // Render
    const li = createNodeToNeverTranslateSitesList(hostname);
    $("#neverTranslateSites").appendChild(li);
  });

  $("#addToNeverTranslateSites").onclick = (e) => { // Add never-translate site
    const hostname = prompt("Enter the site hostname", "www.site.com");
    if (!hostname) return;

    const li = createNodeToNeverTranslateSitesList(hostname);
    $("#neverTranslateSites").appendChild(li);

    twpConfig.addSiteToNeverTranslate(hostname); // Save to config
  };

  // Custom dictionary config
  function createcustomDictionary(keyWord, customValue) { // Create custom dictionary entry display
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = keyWord; // Store keyword
    if (customValue !== "") {
      li.textContent = keyWord + " ------------------- " + customValue; // Display mapping
    } else {
      li.textContent = keyWord; // Display keyword only
    }
    const close = document.createElement("span"); // Delete button
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // Delete entry
      e.preventDefault();
      twpConfig.removeKeyWordFromcustomDictionary(keyWord); // Remove from config
      li.remove();
    };
    li.appendChild(close);
    return li;
  }

  let customDictionary = twpConfig.get("customDictionary"); // Get custom dictionary (Map)
  customDictionary = new Map( // Rebuild sorted Map
    [...customDictionary.entries()].sort((a, b) =>
      String(a[0])?.localeCompare?.(String(b[0]))
    )
  );
  customDictionary.forEach(function (customValue, keyWord) { // Render dictionary list
    const li = createcustomDictionary(keyWord, customValue);
    $("#customDictionary").appendChild(li);
  });

  $("#addToCustomDictionary").onclick = (e) => { // Add custom entry
    let keyWord = prompt("Enter the keyWord, Minimum two letters ", ""); // Enter keyword
    if (!keyWord || keyWord.length < 2) return; // Return if too short
    keyWord = keyWord.trim().toLowerCase(); // Normalize
    let customValue = prompt(
      "(Optional)\nYou can enter a value to replace it , or fill in nothing.",
      ""
    ); // Optional replacement value
    if (!customValue) customValue = ""; // Use empty string if empty
    customValue = customValue.trim(); // Trim whitespace
    const li = createcustomDictionary(keyWord, customValue); // Create node
    $("#customDictionary").appendChild(li); // Insert
    twpConfig.addKeyWordTocustomDictionary(keyWord, customValue); // Save to config
  };

  // Translate-on-hover sites list config

  function createNodeToSitesToTranslateWhenHoveringList(hostname) { // Create translate-on-hover site entry
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = hostname;
    li.textContent = hostname;

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // Delete event
      e.preventDefault();

      twpConfig.removeSiteFromTranslateWhenHovering(hostname); // Remove from config
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const sitesToTranslateWhenHovering = twpConfig.get(
    "sitesToTranslateWhenHovering"
  ); // Get translate-on-hover sites array
  sitesToTranslateWhenHovering.sort((a, b) => a?.localeCompare?.(b)); // Sort
  sitesToTranslateWhenHovering.forEach((hostname) => { // Render
    const li = createNodeToSitesToTranslateWhenHoveringList(hostname);
    $("#sitesToTranslateWhenHovering").appendChild(li);
  });

  $("#addSiteToTranslateWhenHovering").onclick = (e) => { // Add translate-on-hover site
    const hostname = prompt("Enter the site hostname", "www.site.com");
    if (!hostname) return;

    const li = createNodeToSitesToTranslateWhenHoveringList(hostname);
    $("#sitesToTranslateWhenHovering").appendChild(li);

    twpConfig.addSiteToTranslateWhenHovering(hostname); // Save to config
  };

  // Translation behavior config
  $("#translateLongerThan").value = twpConfig.get("translateLongerThan"); // Initialize "translate longer than X" threshold
  $("#translateLongerThan").onchange = (e) => { // Modify threshold
    twpConfig.set("translateLongerThan", e.target.value);
  };

  $("#whereToDisplayTranslatedText").onchange = (e) => { // Translated text display position change
    twpConfig.set("whereToDisplayTranslatedText", e.target.value);
  };
  $("#whereToDisplayTranslatedText").value = twpConfig.get("whereToDisplayTranslatedText"); // Initialize translated text display position

  $("#aiImproveForLongerThan").value = twpConfig.get("aiImproveForLongerThan"); // AI improvement threshold init
  $("#aiImproveForLongerThan").onchange = (e) => { // Modify
    twpConfig.set("aiImproveForLongerThan", e.target.value);
  };

  $("#enableAiTranslationCache").onchange = (e) => { // Enable AI translation cache toggle
    twpConfig.set("enableAiTranslationCache", e.target.value);
  };
  $("#enableAiTranslationCache").value = twpConfig.get("enableAiTranslationCache") || "yes"; // Initialize value (default enabled)

  const aiProviderSelect = $("#aiProvider");
  const aiOptionsController = createAiOptionsController({
    root: document,
    aiProviderSelect,
    config: twpConfig,
    refreshCurrentProvider: (provider) => {
      switch (provider) {
        case "openai":
          if (typeof populateOpenAiModels === "function" && openAiModelSelect) {
            const key = apiKeyOpenAIInput ? apiKeyOpenAIInput.value : (twpConfig.get("apiKeyOpenAI") || "");
            const stored = twpConfig.get("openAiModel") || "";
            populateOpenAiModels(openAiModelSelect, key, stored, fallbackOpenAiOptions);
          }
          break;
        case "openrouter":
          if (typeof populateOpenRouterModels === "function" && openRouterModelSelect) {
            const stored = twpConfig.get("openRouterModel") || "";
            const fallback = openRouterModelSelect ? Array.from(openRouterModelSelect.options || []).map((o) => ({ value: o.value, text: o.textContent })) : [];
            populateOpenRouterModels(openRouterModelSelect, twpConfig.get("openRouterApiBase") || "", stored, fallback);
          }
          break;
        case "anthropic":
          if (typeof populateAnthropicModels === "function" && anthropicModelSelect) {
            const key = apiKeyAnthropicInput ? apiKeyAnthropicInput.value : (twpConfig.get("apiKeyAnthropic") || "");
            const stored = twpConfig.get("anthropicModel") || "";
            populateAnthropicModels(anthropicModelSelect, key, stored, fallbackAnthropicOptions);
          }
          break;
        case "google-gemini":
          if (typeof populateGoogleGeminiModels === "function" && googleGeminiModelSelect) {
            const key = apiKeyGoogleGeminiInput ? apiKeyGoogleGeminiInput.value : (twpConfig.get("apiKeyGoogleGemini") || "");
            const stored = twpConfig.get("googleGeminiModel") || "";
            populateGoogleGeminiModels(googleGeminiModelSelect, key, stored, fallbackGoogleGeminiOptions);
          }
          break;
        case "azure-openai":
          if (typeof populateAzureOpenAIModels === "function" && azureOpenAIModelSelect) {
            const key = apiKeyAzureOpenAIInput ? apiKeyAzureOpenAIInput.value : (twpConfig.get("apiKeyAzureOpenAI") || "");
            const endpoint = azureOpenAIEndpointInput ? azureOpenAIEndpointInput.value : (twpConfig.get("azureOpenAIEndpoint") || "");
            const stored = twpConfig.get("azureOpenAIModel") || "";
            populateAzureOpenAIModels(azureOpenAIModelSelect, key, endpoint, stored, fallbackAzureOpenAIOptions);
          }
          break;
        case "deepseek":
          if (typeof populateDeepSeekModels === "function" && deepSeekModelSelect) {
            const key = apiKeyDeepSeekInput ? apiKeyDeepSeekInput.value : (twpConfig.get("apiKeyDeepSeek") || "");
            const stored = twpConfig.get("deepSeekModel") || "";
            populateDeepSeekModels(deepSeekModelSelect, key, stored, fallbackDeepSeekOptions);
          }
          break;
        case "grok":
          if (typeof populateGrokModels === "function" && grokModelSelect) {
            const key = apiKeyGrokInput ? apiKeyGrokInput.value : (twpConfig.get("apiKeyGrok") || "");
            const stored = twpConfig.get("grokModel") || "";
            populateGrokModels(grokModelSelect, key, stored, fallbackGrokOptions);
          }
          break;
        default:
          break;
      }
    },
    refreshers: {
      openai: () => {
        if ($("#openAiModel") && typeof populateOpenAiModels === "function") {
          const select = $("#openAiModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateOpenAiModels(select, twpConfig.get("apiKeyOpenAI") || "", twpConfig.get("openAiModel") || "", fallback);
        }
      },
      googleGemini: () => {
        if ($("#googleGeminiModel") && typeof populateGoogleGeminiModels === "function") {
          const select = $("#googleGeminiModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateGoogleGeminiModels(select, twpConfig.get("apiKeyGoogleGemini") || "", twpConfig.get("googleGeminiModel") || "", fallback);
        }
      },
      anthropic: () => {
        if ($("#anthropicModel") && typeof populateAnthropicModels === "function") {
          const select = $("#anthropicModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateAnthropicModels(select, twpConfig.get("apiKeyAnthropic") || "", twpConfig.get("anthropicModel") || "", fallback);
        }
      },
      azureOpenAI: () => {
        if ($("#azureOpenAIModel") && typeof populateAzureOpenAIModels === "function") {
          const select = $("#azureOpenAIModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          const apiKey = $("#apiKeyAzureOpenAI") ? $("#apiKeyAzureOpenAI").value : (twpConfig.get("apiKeyAzureOpenAI") || "");
          const endpoint = $("#azureOpenAIEndpoint") ? $("#azureOpenAIEndpoint").value : (twpConfig.get("azureOpenAIEndpoint") || "");
          populateAzureOpenAIModels(select, apiKey, endpoint, twpConfig.get("azureOpenAIModel") || "", fallback);
        }
      },
      deepseek: () => {
        if ($("#deepSeekModel") && typeof populateDeepSeekModels === "function") {
          const select = $("#deepSeekModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateDeepSeekModels(select, twpConfig.get("apiKeyDeepSeek") || "", twpConfig.get("deepSeekModel") || "", fallback);
        }
      },
      grok: () => {
        if ($("#grokModel") && typeof populateGrokModels === "function") {
          const select = $("#grokModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateGrokModels(select, twpConfig.get("apiKeyGrok") || "", twpConfig.get("grokModel") || "", fallback);
        }
      },
      openrouter: () => {
        if ($("#openRouterModel") && typeof populateOpenRouterModels === "function") {
          const select = $("#openRouterModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateOpenRouterModels(select, twpConfig.get("openRouterApiBase") || "", twpConfig.get("openRouterModel") || "", fallback);
        }
      },
    },
  });
  if (aiProviderSelect) {
    aiOptionsController.initialize();
    aiProviderSelect.onchange = (e) => {
      aiOptionsController.handleProviderChange(e.target.value);
    };
  }
  // Keep options page UI in sync when config is changed elsewhere (e.g. popup or background page)
  // E.g.: if aiProvider or API key is changed in another extension page, the options page should immediately switch to the corresponding settings panel or refresh model list
  if (typeof twpConfig.onChanged === "function") {
    twpConfig.onChanged((name, newValue) => {
      console.debug("twpConfig.onChanged event:", name, newValue);
      try {
        const handledByAiSync = aiOptionsController.handleConfigChanged(name, newValue);
        if (handledByAiSync) {
          return;
        }

        switch (name) {
          case "openRouterApiBase":
          case "openRouterReferer":
          case "openRouterTitle":
            break;
          default:
            // Unhandled config items ignored
            break;
        }
      } catch (err) {
        console.warn("twpConfig.onChanged handler error:", err);
      }
    });
  }

  // Additional storage change listener as a safeguard (in case twpConfig.onChanged is not called in some cases)
  if (typeof chrome !== "undefined" && chrome.storage && typeof chrome.storage.onChanged !== "undefined") {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      aiOptionsController.handleStorageChanged(changes, areaName);
    });
  }


  // Google Gemini model dropdown auto-fill (declared early to avoid undefined)
  async function populateGoogleGeminiModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        missingConfigNotice: !sanitizedKey
          ? i18nOrDefault("msgEnterApiKeyForModels", "Please enter API key to get available models for this provider")
          : "",
        loadOptions: () => loadAiProviderModelOptions({
          provider: "google-gemini",
          apiKey: sanitizedKey,
          translate: i18nOrDefault,
        }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
        errorToNotice: (error) =>
          error instanceof Error && error.message
            ? error.message
            : i18nOrDefault("msgCannotLoadGoogleGeminiModelsHttp", "Unable to load Google Gemini models"),
      });
    } catch (error) {
      console.warn("Unable to load Google Gemini models from API:", error);
    }
  }
  const openAiModelSelect = $("#openAiModel");
  const fallbackOpenAiOptions = openAiModelSelect
    ? Array.from(openAiModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedOpenAiModel = twpConfig.get("openAiModel") || "";
  const storedApiKeyOpenAI = (twpConfig.get("apiKeyOpenAI") || "").trim();
  if (storedApiKeyOpenAI !== (twpConfig.get("apiKeyOpenAI") || "")) {
    twpConfig.set("apiKeyOpenAI", storedApiKeyOpenAI);
  }
  const apiKeyOpenAIInput = $("#apiKeyOpenAI");
  if (apiKeyOpenAIInput) {
    apiKeyOpenAIInput.value = storedApiKeyOpenAI;
    apiKeyOpenAIInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyOpenAIInput.value = newKey;
      twpConfig.set("apiKeyOpenAI", newKey);
      if (openAiModelSelect) {
        const selectedModel =
          openAiModelSelect.value || twpConfig.get("openAiModel") || "";
        populateOpenAiModels(
          openAiModelSelect,
          newKey,
          selectedModel,
          fallbackOpenAiOptions
        );
      }
    };
  }
  if (openAiModelSelect) {
    populateOpenAiModels(
      openAiModelSelect,
      storedApiKeyOpenAI,
      storedOpenAiModel,
      fallbackOpenAiOptions
    );
    openAiModelSelect.onchange = (e) => {
      twpConfig.set("openAiModel", e.target.value);
    };
  }

  // Google Gemini model dropdown auto-fill
  const googleGeminiModelSelect = $("#googleGeminiModel");
  const fallbackGoogleGeminiOptions = googleGeminiModelSelect
    ? Array.from(googleGeminiModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedGoogleGeminiModel = twpConfig.get("googleGeminiModel") || "";
  const apiKeyGoogleGeminiInput = $("#apiKeyGoogleGemini");
  const storedApiKeyGoogleGemini = (twpConfig.get("apiKeyGoogleGemini") || "").trim();
  if (apiKeyGoogleGeminiInput) {
    apiKeyGoogleGeminiInput.value = storedApiKeyGoogleGemini;
    apiKeyGoogleGeminiInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyGoogleGeminiInput.value = newKey;
      twpConfig.set("apiKeyGoogleGemini", newKey);
      if (googleGeminiModelSelect) {
        const selectedModel =
          googleGeminiModelSelect.value || twpConfig.get("googleGeminiModel") || "";
        populateGoogleGeminiModels(
          googleGeminiModelSelect,
          newKey,
          selectedModel,
          fallbackGoogleGeminiOptions
        );
      }
    };
  }
  if (googleGeminiModelSelect) {
    populateGoogleGeminiModels(
      googleGeminiModelSelect,
      storedApiKeyGoogleGemini,
      storedGoogleGeminiModel,
      fallbackGoogleGeminiOptions
    );
    googleGeminiModelSelect.onchange = (e) => {
      twpConfig.set("googleGeminiModel", e.target.value);
    };
  }

  const apiKeyOpenRouterInput = $("#apiKeyOpenRouter");
  if (apiKeyOpenRouterInput) {
    apiKeyOpenRouterInput.value = twpConfig.get("apiKeyOpenRouter") || "";
    apiKeyOpenRouterInput.onchange = (e) => {
      twpConfig.set("apiKeyOpenRouter", e.target.value);
    };
  }

  async function populateGoogleGeminiModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    select.disabled = true;
    select.innerHTML = "";
    const loadingOption = document.createElement("option");
    loadingOption.value = "";
    loadingOption.textContent = "Loading...";
    loadingOption.disabled = true;
    loadingOption.selected = true;
    select.appendChild(loadingOption);
    const sanitizedKey = (apiKey || "").trim();
    if (!sanitizedKey) {
      // No API Key: use preview (OpenRouter → static list fallback)
      try {
        const previewModels = await loadPreviewModels({ provider: "google-gemini" });
        select.innerHTML = "";
        previewModels.forEach((model) => {
          const option = document.createElement("option");
          option.value = model.value;
          option.textContent = model.text;
          select.appendChild(option);
        });
        fallback.splice(0, fallback.length, ...previewModels);
      } catch (_) {
        select.innerHTML = "";
        fallback.forEach((item) => {
          const option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.text;
          select.appendChild(option);
        });
      }
      select.disabled = false;
      if (storedValue) select.value = storedValue;
      if (!select.value) {
        const firstEnabled = Array.from(select.options).find((opt) => !opt.disabled);
        if (firstEnabled) select.value = firstEnabled.value;
      }
      return;
    }
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${sanitizedKey}`);
      if (!response.ok) {
        let message = i18nOrDefault("msgCannotLoadGoogleGeminiModelsHttp", `Unable to load Google Gemini models (HTTP ${response.status})`);
        try {
          const errorPayload = await response.json();
          if (errorPayload?.error?.message) {
            message = errorPayload.error.message;
          }
        } catch (jsonError) {}
        throw new Error(message);
      }
      const payload = await response.json();
      const models = Array.isArray(payload?.models) ? payload.models : [];
      if (!models.length) throw new Error("Google Gemini models list is empty");
      models.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
      select.innerHTML = "";
      models.forEach((model) => {
        if (!model || !model.name) return;
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent = model.displayName || model.name;
        select.appendChild(option);
      });
      if (storedValue && !models.some((model) => model?.name === storedValue)) {
        const preservedOption = document.createElement("option");
        preservedOption.value = storedValue;
        preservedOption.textContent = storedValue;
        select.appendChild(preservedOption);
      }
    } catch (error) {
      console.warn("Unable to load Google Gemini models from API:", error);
      select.innerHTML = "";
      fallback.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.text;
        select.appendChild(option);
      });
    } finally {
      select.disabled = false;
      if (storedValue) select.value = storedValue;
      if (!select.value && select.options.length > 0) select.selectedIndex = 0;
    }
  }
  async function populateOpenAiModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) {
      return;
    }

    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];

    const sanitizedKey = (apiKey || "").trim();

    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "openai",
        missingConfigNotice: "",
        loadOptions: sanitizedKey
          ? () => loadAiProviderModelOptions({
              provider: "openai",
              apiKey: sanitizedKey,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "openai" }),
        errorToNotice: (error) =>
          error instanceof Error && error.message
            ? error.message
            : "Unable to load OpenAI models",
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("Unable to load OpenAI models from API:", error);
    }
  }

  async function populateOpenRouterModels(select, apiBase, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) {
      return;
    }

    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedApiBase = (apiBase || "").trim();

    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        loadOptions: () => loadAiProviderModelOptions({
          provider: "openrouter",
          endpoint: sanitizedApiBase,
        }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("Unable to load OpenRouter models from API:", error);
    }
  }

  const openRouterModelSelect = $("#openRouterModel");
  if (openRouterModelSelect) {
    const storedOpenRouterModel = twpConfig.get("openRouterModel") || "";
    const fallbackOpenRouterOptions = Array.from(
      openRouterModelSelect.options || []
    ).map((option) => ({
      value: option.value,
      text: option.textContent,
    }));

    populateOpenRouterModels(
      openRouterModelSelect,
      twpConfig.get("openRouterApiBase") || "",
      storedOpenRouterModel,
      fallbackOpenRouterOptions
    );

    openRouterModelSelect.onchange = (e) => {
      twpConfig.set("openRouterModel", e.target.value);
    };
  }

  const openRouterApiBaseInput = $("#openRouterApiBase");
  if (openRouterApiBaseInput) {
    openRouterApiBaseInput.value = twpConfig.get("openRouterApiBase") || "";
    openRouterApiBaseInput.onchange = (e) => {
      const nextValue = (e.target.value || "").trim();
      openRouterApiBaseInput.value = nextValue;
      twpConfig.set("openRouterApiBase", nextValue);
      if (openRouterModelSelect) {
        populateOpenRouterModels(
          openRouterModelSelect,
          nextValue,
          openRouterModelSelect.value || twpConfig.get("openRouterModel") || "",
          Array.from(openRouterModelSelect.options || []).map((option) => ({
            value: option.value,
            text: option.textContent,
          }))
        );
      }
    };
  }

  const openRouterRefererInput = $("#openRouterReferer");
  if (openRouterRefererInput) {
    openRouterRefererInput.value = twpConfig.get("openRouterReferer") || "";
    openRouterRefererInput.onchange = (e) => {
      twpConfig.set("openRouterReferer", e.target.value);
    };
  }

  const openRouterTitleInput = $("#openRouterTitle");
  if (openRouterTitleInput) {
    openRouterTitleInput.value = twpConfig.get("openRouterTitle") || "";
    openRouterTitleInput.onchange = (e) => {
      twpConfig.set("openRouterTitle", e.target.value);
    };
  }

  // Custom endpoint inputs for each provider
  for (const [id, configKey] of [
    ["openAiApiBase", "openAiApiBase"],
    ["anthropicApiBase", "anthropicApiBase"],
    ["googleGeminiApiBase", "googleGeminiApiBase"],
    ["deepSeekApiBase", "deepSeekApiBase"],
    ["grokApiBase", "grokApiBase"],
  ]) {
    const input = $("#" + id);
    if (input) {
      input.value = twpConfig.get(configKey) || "";
      input.onchange = (e) => {
        twpConfig.set(configKey, (e.target.value || "").trim());
      };
    }
  }

  // Set i18n placeholder for all API Key inputs uniformly
  const apiKeyPlaceholder = chrome.i18n.getMessage("lblEnterApiKey") || "Enter API key";
  for (const id of [
    "apiKeyOpenAI", "apiKeyOpenRouter", "apiKeyAnthropic", "apiKeyGoogleGemini",
    "apiKeyAzureOpenAI", "apiKeyDeepSeek", "apiKeyGrok", "apiKeyGeneric",
  ]) {
    const input = $("#" + id);
    if (input && !input.placeholder) {
      input.placeholder = apiKeyPlaceholder;
    }
  }

  // Only expose currently supported free page translation engines; fall back to google for incompatible legacy values.
  $("#pageTranslatorService").onchange = (e) => {
    twpConfig.set("pageTranslatorService", e.target.value);
  };
  const currentPageTranslatorService = twpConfig.get("pageTranslatorService");
  $("#pageTranslatorService").value = ["google", "microsoft"].includes(currentPageTranslatorService)
    ? currentPageTranslatorService
    : "google";

  // $("#textTranslatorService").onchange = (e) => {
  //   twpConfig.set("textTranslatorService", e.target.value);
  // };
  // $("#textTranslatorService").value = twpConfig.get("textTranslatorService");

  $("#ttsSpeed").oninput = (e) => { // TTS speed slider real-time update
    twpConfig.set("ttsSpeed", e.target.value);
    $("#displayTtsSpeed").textContent = e.target.value; // Display current value
  };
  $("#ttsSpeed").value = twpConfig.get("ttsSpeed"); // Initialize speech speed
  $("#displayTtsSpeed").textContent = twpConfig.get("ttsSpeed"); // Display initial speech speed

  $("#showOriginalTextWhenHovering").onchange = (e) => { // Show original text on hover toggle
    twpConfig.set("showOriginalTextWhenHovering", e.target.value);
  };
  $("#showOriginalTextWhenHovering").value = twpConfig.get(
    "showOriginalTextWhenHovering"
  ); // Initialize

  $("#translateTag_pre").onchange = (e) => { // Whether to translate <pre> tag content
    twpConfig.set("translateTag_pre", e.target.value);
  };
  $("#translateTag_pre").value = twpConfig.get("translateTag_pre"); // Initialize

  $("#enableDeepL").onchange = (e) => { // DeepL translation toggle change
    twpConfig.set("enableDeepL", e.target.value);
  };
  $("#enableDeepL").value = twpConfig.get("enableDeepL"); // Initialize DeepL toggle state

  $("#dontSortResults").onchange = (e) => { // Whether to not sort translation results
    twpConfig.set("dontSortResults", e.target.value);
  };
  $("#dontSortResults").value = twpConfig.get("dontSortResults"); // Initialize

  $("#translateDynamicallyCreatedContent").onchange = (e) => { // Whether to translate dynamically created content
    twpConfig.set("translateDynamicallyCreatedContent", e.target.value);
  };
  $("#translateDynamicallyCreatedContent").value = twpConfig.get(
    "translateDynamicallyCreatedContent"
  ); // Initialize

  $("#autoTranslateWhenClickingALink").onchange = (e) => { // Auto-translate when clicking link toggle
    if (e.target.value == "yes") { // Need to request webNavigation permission
      chrome.permissions.request(
        {
          permissions: ["webNavigation"], // Request permission
        },
        (granted) => { // Callback handler
          if (granted) {
            twpConfig.set("autoTranslateWhenClickingALink", "yes"); // Granted: update config
          } else {
            twpConfig.set("autoTranslateWhenClickingALink", "no"); // Otherwise fall back
            e.target.value = "no"; // Sync UI
          }
        }
      );
    } else { // Remove permission when disabling
      twpConfig.set("autoTranslateWhenClickingALink", "no");
      chrome.permissions.remove({
        permissions: ["webNavigation"], // Release permission
      });
    }
  };
  $("#autoTranslateWhenClickingALink").value = twpConfig.get(
    "autoTranslateWhenClickingALink"
  ); // Initialize

  // if (twpConfig.get("enableDeepL") === "yes") {
  //   $('#textTranslatorService option[value="deepl"]').removeAttribute("hidden");
  // } else {
  //   $('#textTranslatorService option[value="deepl"]').setAttribute(
  //     "hidden",
  //     ""
  //   );
  // }
  // twpConfig.onChanged((name, newvalue) => {
  //   switch (name) {
  //     case "enableDeepL":
  //       if (newvalue === "yes") {
  //         $('#textTranslatorService option[value="deepl"]').removeAttribute(
  //           "hidden"
  //         );
  //       } else {
  //         twpConfig.set("textTranslatorService", "google");
  //         $("#textTranslatorService").value = "google";
  //         $('#textTranslatorService option[value="deepl"]').setAttribute(
  //           "hidden",
  //           ""
  //         );
  //       }
  //       break;
  //   }
  // });

  /**
   * Enable/disable advanced options based on toggle
   * @param {*} value 
   */
  function enableOrDisableTranslateSelectedAdvancedOptions(value) { 
    if (value === "no") {
      document
        .querySelectorAll("#translateSelectedAdvancedOptions input")
        .forEach((input) => {
          input.setAttribute("disabled", ""); // Disable input
        });
    } else {
      document
        .querySelectorAll("#translateSelectedAdvancedOptions input")
        .forEach((input) => {
          input.removeAttribute("disabled"); // Re-enable
        });
    }
  }

  // Floating translate button toggle and its advanced options
  $("#showTranslateSelectedButton").onchange = (e) => { 
    twpConfig.set("showTranslateSelectedButton", e.target.value);
    enableOrDisableTranslateSelectedAdvancedOptions(e.target.value); // Sync advanced options state
  };
  $("#showTranslateSelectedButton").value = twpConfig.get(
    "showTranslateSelectedButton"
  ); // Initialize
  enableOrDisableTranslateSelectedAdvancedOptions(
    twpConfig.get("showTranslateSelectedButton")
  ); // Initial set of advanced options enabled state

  $("#dontShowIfPageLangIsTargetLang").onchange = (e) => { // Don't show button if page language is target language
    twpConfig.set(
      "dontShowIfPageLangIsTargetLang",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#dontShowIfPageLangIsTargetLang").checked =
    twpConfig.get("dontShowIfPageLangIsTargetLang") === "yes" ? true : false; // Initialize checkbox state

  $("#dontShowIfPageLangIsUnknown").onchange = (e) => { // Don't show button when page language is unknown
    twpConfig.set(
      "dontShowIfPageLangIsUnknown",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#dontShowIfPageLangIsUnknown").checked =
    twpConfig.get("dontShowIfPageLangIsUnknown") === "yes" ? true : false; // Initialize

  $("#dontShowIfSelectedTextIsTargetLang").onchange = (e) => { // Don't show if selected text is already in target language
    twpConfig.set(
      "dontShowIfSelectedTextIsTargetLang",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#dontShowIfSelectedTextIsTargetLang").checked =
    twpConfig.get("dontShowIfSelectedTextIsTargetLang") === "yes"
      ? true
      : false; // Initialize

  $("#dontShowIfSelectedTextIsUnknown").onchange = (e) => { // Don't show if selected text language is unknown
    twpConfig.set(
      "dontShowIfSelectedTextIsUnknown",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#dontShowIfSelectedTextIsUnknown").checked =
    twpConfig.get("dontShowIfSelectedTextIsUnknown") === "yes" ? true : false; // Initialize

  // Style options / theme related
  $("#useOldPopup").onchange = (e) => { // Popup style change
    twpConfig.set("useOldPopup", e.target.value);
    updateDarkMode();
  };
  $("#useOldPopup").value = twpConfig.get("useOldPopup"); // Initialize popup style

  // Dark mode options
  $("#darkMode").onchange = (e) => { 
    twpConfig.set("darkMode", e.target.value);
    updateDarkMode(); // Apply change
  };
  $("#darkMode").value = twpConfig.get("darkMode"); // Initialize

  // Translated text color picker change
  const googleTranslatedColorPicker = $("#translatedColorEyeDropper");
  const aiTranslatedColorPicker = $("#aiTranslatedColorEyeDropper");

  googleTranslatedColorPicker.addEventListener("change", (e) => {
    twpConfig.set("translatedColor", e.detail?.rgba || e.target.color || "");
  });
  googleTranslatedColorPicker.color = twpConfig.get("translatedColor");

  $("#resetTranslatedColor").addEventListener("click", () => {
    twpConfig.set("translatedColor", "");
    googleTranslatedColorPicker.color = "";
  });

  aiTranslatedColorPicker.addEventListener("change", (e) => {
    twpConfig.set("aiTranslatedColor", e.detail?.rgba || e.target.color || "");
  });
  aiTranslatedColorPicker.color = twpConfig.get("aiTranslatedColor");

  $("#resetAiTranslatedColor").addEventListener("click", () => {
    twpConfig.set("aiTranslatedColor", "");
    aiTranslatedColorPicker.color = "";
  });

  // Whether to show blue popup after whole-site translation
  $("#popupBlueWhenSiteIsTranslated").onchange = (e) => { 
    twpConfig.set("popupBlueWhenSiteIsTranslated", e.target.value);
  };
  $("#popupBlueWhenSiteIsTranslated").value = twpConfig.get(
    "popupBlueWhenSiteIsTranslated"
  ); // Initialize

  // Keyboard shortcut config
  function escapeHtml(unsafe) { // Simple HTML escape (not used in inputs above, kept for reference)
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  $('[data-i18n="lblTranslateSelectedWhenPressTwice"]').innerHTML = $(
    '[data-i18n="lblTranslateSelectedWhenPressTwice"]'
  ).innerHTML.replace("[Ctrl]", "<kbd>Ctrl</kbd>"); // Replace [Ctrl] in hint text
  $('[data-i18n="lblTranslateTextOverMouseWhenPressTwice"]').innerHTML = $(
    '[data-i18n="lblTranslateTextOverMouseWhenPressTwice"]'
  ).innerHTML.replace("[Ctrl]", "<kbd>Ctrl</kbd>"); // Same as above

  $("#openNativeShortcutManager").onclick = (e) => { // Open browser native shortcut manager page
    chrome.tabs.create({
      url: "chrome://extensions/shortcuts",
    });
  };

  $("#translateSelectedWhenPressTwice").onclick = (e) => { // Double-press Ctrl to translate selected text toggle
    twpConfig.set(
      "translateSelectedWhenPressTwice",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#translateSelectedWhenPressTwice").checked =
    twpConfig.get("translateSelectedWhenPressTwice") === "yes"; // Initialize

  $("#translateTextOverMouseWhenPressTwice").onclick = (e) => { // Double-press Ctrl to translate text under mouse toggle
    twpConfig.set(
      "translateTextOverMouseWhenPressTwice",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#translateTextOverMouseWhenPressTwice").checked =
    twpConfig.get("translateTextOverMouseWhenPressTwice") === "yes"; // Initialize

  const defaultShortcuts = {}; // Store default shortcut mappings
  // Iterate commands registered in manifest, populate defaultShortcuts object
  for (const name of Object.keys(chrome.runtime.getManifest().commands || {})) { 
    const info = chrome.runtime.getManifest().commands[name]; // Single command info
    if (info.suggested_key && info.suggested_key.default) { // If has a default shortcut
      defaultShortcuts[name] = info.suggested_key.default; // Record
    } else {
      defaultShortcuts[name] = ""; // Otherwise empty string
    }
  }

  // Whether to allow modifying shortcuts in extension's own page. true for Firefox, false for Chromium (MV3). Chromium can only modify via native browser entry
  const canUpdateBrowserShortcut = (typeof browser !== 'undefined') ? true : false;
  console.log(`Browser supports commands.update: ${canUpdateBrowserShortcut}`);
  const browserApi = (typeof browser !== 'undefined') ? browser : (typeof chrome !== 'undefined' ? chrome : undefined);
  // For Firefox, hide native shortcut manager and show extension's own shortcut UI; for Chromium, vice versa
  if (canUpdateBrowserShortcut) { // fireFox
    console.log("Browser supports commands.update, can update browser-level shortcuts.");
    $("#openNativeShortcutManager").style.display = "none";
    $("#hotkeysListContainer").style.display = "block";
  } else { // Chromium
    console.log("Browser does not support commands.update, cannot update browser-level shortcuts.");
    $("#hotkeysListContainer").style.display = "none";
    $("#openNativeShortcutManager").style.display = "block";
  }

  /**
   * Get existing shortcut info from browser.commands and add to the page
   * @param {*} hotkeyname Shortcut command name
   * @param {*} description Description text
   */
  function addHotkey(hotkeyname, description) { // Dynamically build shortcut editing UI
    if (hotkeyname === "_execute_browser_action" && !description) { // Default description for special command
      description = "Enable the extension";
    }

    const li = document.createElement("li"); // Outer LI
    li.classList.add("shortcut-row"); // Add style class
    li.setAttribute("id", hotkeyname); // Set id
    li.innerHTML = `
        <div>${description}</div>
        <div class="shortcut-input-options">
            <div style="position: relative;">
                <input name="input" class="w3-input w3-border shortcut-input" type="text" readonly placeholder="Enter a shortcut" data-i18n-placeholder="enterShortcut">
                <p name="error" class="shortcut-error" style="position: absolute;"></p>
            </div>
            <div class="w3-hover-light-grey shortcut-button" name="removeKey"><i class="gg-trash"></i></div>
            <div class="w3-hover-light-grey shortcut-button" name="resetKey"><i class="gg-sync"></i></div>
        </div>  
        `; // Template string inserting edit area structure
    $("#KeyboardShortcuts").appendChild(li); // Insert into shortcut list container

    const input = /** @type {HTMLInputElement} */ (li.querySelector(`[name="input"]`)); // Cast to input element
    const error = /** @type {HTMLElement} */ (li.querySelector(`[name="error"]`)); // Error message element
    const removeKey = /** @type {HTMLElement} */ (li.querySelector(`[name="removeKey"]`)); // Remove button element
    const resetKey = /** @type {HTMLElement} */ (li.querySelector(`[name="resetKey"]`)); // Reset button element

    // Runtime guard: if any element is missing, return early to avoid null reference
    if(!input || !error || !removeKey || !resetKey){
      console.warn("Hotkey row elements missing for", hotkeyname);
      return;
    }

    input.value = twpConfig.get("hotkeys")[hotkeyname]; // Set display value for the currently stored shortcut
    if (input.value) { // If has a custom value
      resetKey.style.display = "none"; // Hide "restore default"
    } else {
      removeKey.style.display = "none"; // Otherwise hide "remove"
    }

    function setError(errorname) { // Show corresponding error message based on error type
      const text = chrome.i18n.getMessage("hotkeyError_" + errorname); // Get localized text from i18n
      switch (errorname) { // Handle by category
        case "ctrlOrAlt":
          error.textContent = text ? text : "Include Ctrl or Alt"; // Must include Ctrl or Alt
          break;
        case "letter":
          error.textContent = text ? text : "Type a letter"; // Need to type a letter/digit
          break;
        case "invalid":
          error.textContent = text ? text : "Invalid combination"; // Invalid combination
          break;
        default:
          error.textContent = ""; // Clear error
          break;
      }
    }

    /**
     * Convert key event to string form
     * @param {*} e 
     * @returns 
     */
    function getKeyString(e) {
      let result = ""; // Initial empty string
      if (e.ctrlKey) { // Ctrl modifier
        result += "Ctrl+";
      }
      if (e.altKey) { // Alt modifier
        result += "Alt+";
      }
      if (e.shiftKey) { // Shift modifier
        result += "Shift+";
      }
      if (e.code.match(/Key([A-Z])/)) { // Letter key
        result += e.code.match(/Key([A-Z])/)[1];
      } else if (e.code.match(/Digit([0-9])/)) { // Digit key
        result += e.code.match(/Digit([0-9])/)[1];
      }

      return result; // Return combination string
    }

    /**
     * Save shortcut to config and notify browser
     * @param {*} name 
     * @param {*} keystring 
     */
    function setShortcut(name, keystring) { 
      const hotkeys = twpConfig.get("hotkeys"); // Read current mappings
      hotkeys[hotkeyname] = keystring; // Update specified command shortcut
      twpConfig.set("hotkeys", hotkeys); // Write back to config
      // Only Firefox (or browsers supporting commands.update) can actually update browser-level shortcuts
      // @ts-ignore Firefox supports commands.update, Chromium does not
      if (canUpdateBrowserShortcut && browserApi?.commands && typeof browserApi.commands.update === 'function') {
        try {
          // @ts-ignore update is missing from type definitions but available in Firefox
          browserApi.commands.update({
            name: name,
            shortcut: keystring,
          });
        } catch (err) {
          console.warn("commands.update call failed:", err);
        }
      } else {
        // No commands.update under Chromium, keeping local config is sufficient
      }
    }

    /**
     * Handle keyboard keydown/keyup events
     * @param {*} e 
     * @returns 
     */
    function onkeychange(e) { 
      input.value = getKeyString(e); // Display combination in real-time

      if (e.Key == "Tab") { // Tab skip
        return;
      }
      if (e.key == "Escape") { // Esc cancels input
        input.blur();
        return;
      }
      if (e.key == "Backspace" || e.key == "Delete") { // Delete key clears the shortcut
        setShortcut(hotkeyname, getKeyString(e)); // Save as empty (because the combination is an empty string)
        input.blur(); // Blur
        return;
      }
      if (!e.ctrlKey && !e.altKey) { // Show error if Ctrl / Alt not included
        setError("ctrlOrAlt");
        return;
      }
      if (e.ctrlKey && e.altKey && e.shiftKey) { // All three modifiers pressed simultaneously is invalid
        setError("invalid");
        return;
      }
      e.preventDefault(); // Prevent default browser behavior (to avoid triggering shortcut actions)
      if (!e.code.match(/Key([A-Z])/) && !e.code.match(/Digit([0-9])/)) { // Not a letter or digit
        setError("letter");
        return;
      }

      setShortcut(hotkeyname, getKeyString(e)); // Set and save shortcut
      input.blur(); // Input complete

      setError("none"); // Clear error
    }

    input.onkeydown = (e) => onkeychange(e); // Keydown event binding
    input.onkeyup = (e) => onkeychange(e); // Keyup event binding

    input.onfocus = (e) => { // Clear displayed value on focus to prepare for new input
      input.value = "";
      setError("");
    };

    input.onblur = (e) => { // Restore to saved config value on blur
      input.value = twpConfig.get("hotkeys")[hotkeyname];
      setError("");
    };

    removeKey.onclick = (e) => { // Remove current custom shortcut
      input.value = ""; // Clear input field
      setShortcut(hotkeyname, ""); // Save as empty

      removeKey.style.display = "none"; // Hide remove button
      resetKey.style.display = "block"; // Show restore default button
    };

    resetKey.onclick = (e) => { // Restore default shortcut
      input.value = defaultShortcuts[hotkeyname]; // Show default
      setShortcut(hotkeyname, defaultShortcuts[hotkeyname]); // Save default

      removeKey.style.display = "block"; // Show remove button
      resetKey.style.display = "none"; // Hide restore button
    };

  }

  if (canUpdateBrowserShortcut && typeof chrome.commands !== "undefined") {
    chrome.commands.getAll((results) => {
      for (const result of results) {
        addHotkey(result.name, result.description);
      }
    });
  }

  // Storage/backup related
  $("#deleteTranslationCache").onclick = (e) => { // Delete translation cache button
    if (confirm(chrome.i18n.getMessage("doYouWantToDeleteTranslationCache"))) { // Confirmation prompt
      chrome.runtime.sendMessage({ // Send message to background to delete cache
        action: "deleteTranslationCache",
        reload: true,
      });
    }
  };

  $("#backupToFile").onclick = (e) => { // Backup config to file
    const configJSON = twpConfig.export(); // Export JSON text

    const element = document.createElement("a"); // Create download link
    element.setAttribute(
      "href",
      "data:text/plain;charset=utf-8," + encodeURIComponent(configJSON)
    ); // Use data URL to trigger download
    element.setAttribute(
      "download",
      "twp-backup_" +
        new Date()
          .toISOString()
          .replace(/T/, "_")
          .replace(/\..+/, "")
          .replace(/\:/g, ".") +
        ".txt"
    ); // Name includes timestamp

    element.style.display = "none"; // Hide temporary element
    document.body.appendChild(element); // Insert into document

    element.click(); // Trigger click to download

    document.body.removeChild(element); // Remove temporary element
  };
  $("#restoreFromFile").onclick = (e) => { // Restore config from file
    const element = document.createElement("input"); // File selection input
    element.setAttribute("type", "file");
    element.setAttribute("accept", "text/plain"); // Restrict to text files

    element.style.display = "none"; // Hide
    document.body.appendChild(element);

    element.oninput = (e) => { // File selection event
      const inputEl = /** @type {HTMLInputElement} */(e.target); // Cast to file input element
      const file = inputEl.files && inputEl.files[0]; // Get the first file
      if(!file){ // Return if no file
        return;
      }

      const reader = new FileReader(); // Create file reader
      reader.onload = function () { // Read complete callback
        try {
          const loaded = reader.result; // Read result (string | ArrayBuffer)
          let textContent = ""; // Unified text content
          if (typeof loaded === "string") { // Already a string
            textContent = loaded;
          } else if (loaded instanceof ArrayBuffer) { // Convert ArrayBuffer -> UTF-8 text
            try {
              textContent = new TextDecoder("utf-8").decode(loaded);
            } catch (err) {
              console.warn("TextDecoder decode failed, fallback to manual conversion", err);
              const uint8 = new Uint8Array(loaded);
              textContent = Array.from(uint8).map(c => String.fromCharCode(c)).join("");
            }
          }
          if (
            confirm(chrome.i18n.getMessage("doYouWantOverwriteAllSettings"))
          ) { // Confirm overwrite
            twpConfig.import(textContent); // Import config (ensure it's a string)
          }
        } catch (e) { // Catch error
          alert(chrome.i18n.getMessage("fileIsCorrupted")); // File corrupted message
          console.error(e); // Console output
        }
      };

      reader.readAsText(file); // Start reading selected file as text
    };

    element.click(); // Trigger file selection

    document.body.removeChild(element); // Remove temporary input
  };
  $("#resetToDefault").onclick = (e) => { // Restore to default settings
    if (confirm(chrome.i18n.getMessage("doYouWantRestoreSettings"))) { // Confirmation prompt
      twpConfig.restoreToDefault(); // Reset config
    }
  };

  $("#showPopupMobile").onchange = (e) => { // Mobile popup display mode change
    twpConfig.set("showPopupMobile", e.target.value);
  };
  $("#showPopupMobile").value = twpConfig.get("showPopupMobile"); // Initialize mobile popup settings

  $("#showFloatingBtn").onchange = (e) => { // Whether to show floating button
    twpConfig.set("showFloatingBtn", e.target.value);
  };
  $("#showFloatingBtn").value = twpConfig.get("showFloatingBtn"); // Initialize
  
  $("#showTranslatePageContextMenu").onchange = (e) => { // Page translation context menu toggle
    twpConfig.set("showTranslatePageContextMenu", e.target.value);
  };
  $("#showTranslatePageContextMenu").value = twpConfig.get(
    "showTranslatePageContextMenu"
  ); // Initialize

  $("#showTranslateSelectedContextMenu").onchange = (e) => { // Selected text translation context menu toggle
    twpConfig.set("showTranslateSelectedContextMenu", e.target.value);
  };
  $("#showTranslateSelectedContextMenu").value = twpConfig.get(
    "showTranslateSelectedContextMenu"
  ); // Initialize

  $("#showButtonInTheAddressBar").onchange = (e) => { // Address bar button display toggle
    twpConfig.set("showButtonInTheAddressBar", e.target.value);
  };
  $("#showButtonInTheAddressBar").value = twpConfig.get(
    "showButtonInTheAddressBar"
  ); // Initialize

  $("#translateClickingOnce").onchange = (e) => { // Single-click translate toggle
    twpConfig.set("translateClickingOnce", e.target.value);
  };
  $("#translateClickingOnce").value = twpConfig.get("translateClickingOnce"); // Initialize

  // ── Provider Registry Initialization ──
  migrateProviderConfig(twpConfig); // Run one-time migration

  // Populate the AI provider dropdown from the registry
  const providerRegistry = createProviderRegistry(BUILT_IN_PROVIDERS);
  // Prioritize the currently active aiProvider; the old activeProviderId is only a compatibility fallback to prevent historical values from overriding user's new selection.
  const activeId = twpConfig.get("aiProvider") || twpConfig.get("activeProviderId") || "openai";

  const _aiProviderDropdown = document.querySelector("#aiProvider");
  if (_aiProviderDropdown) {
    const builtInProviders = providerRegistry.listProviders();

    /** Build provider definitions from models.dev data */
    function _buildDevProviderDefs(devData) {
      const defs = [];
      for (const [devId, devInfo] of Object.entries(devData)) {
        const npm = devInfo.npm || "@ai-sdk/openai-compatible";
        // Contains ${VAR} template variables → treat as no api (user must enter manually)
        const rawApi = devInfo.api || "";
        const apiBase = (rawApi && !rawApi.includes("${")) ? rawApi : lookupKnownApiBase(devId);
        defs.push({
          id: devId,
          name: devInfo.name || devId,
          apiBase,
          modelListUrl: apiBase ? (apiBase.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "") + "/models") : null,
          auth: { type: npm.includes("anthropic") ? "api-key-header" : "bearer", header: "Authorization", prefix: "Bearer " },
          responseFormat: npm.includes("anthropic") ? "anthropic-sse" : "openai-sse",
          supportsStreaming: true,
          source: "models.dev",
          category: "dynamic",
          tags: [],
        });
      }
      return defs;
    }

    /** Provider ID → i18n message key mapping */
    const PROVIDER_I18N_MAP = {
      "openai": "aiProviderOpenAI",
      "anthropic": "aiProviderAnthropic",
      "google-gemini": "aiProviderGoogleGemini",
      "mistral": "aiProviderMistral",
      "cohere": "aiProviderCohere",
      "together": "aiProviderTogether",
      "groq": "aiProviderGroq",
      "openrouter": "aiProviderOpenRouter",
      "azure-openai": "aiProviderAzureOpenAI",
      "deepseek": "aiProviderDeepSeek",
      "zhipu": "aiProviderZhipu",
      "moonshot": "aiProviderMoonshot",
      "qwen": "aiProviderQwen",
      "baidu": "aiProviderBaidu",
      "bytedance": "aiProviderBytedance",
      "iflytek": "aiProviderIflytek",
      "perplexity": "aiProviderPerplexity",
      "grok": "aiProviderGrok",
      "deepinfra": "aiProviderDeepInfra",
      "cerebras": "aiProviderCerebras",
      "vercel": "aiProviderVercel",
    };

    /**
     * Get localized name for a provider
     * @param {string} providerId Provider ID
     * @param {string} fallbackName Original name (fallback)
     * @returns {string} Localized name
     */
    function _getProviderLocalizedName(providerId, fallbackName) {
      const i18nKey = PROVIDER_I18N_MAP[providerId];
      if (i18nKey) {
        const localized = chrome.i18n.getMessage(i18nKey);
        if (localized) return localized;
      }
      return fallbackName;
    }

    /** Render dropdown list */
    function _renderProviderDropdown(providers) {
      /** @type {Array<Object>} */
      const normalizedProviders = Array.isArray(providers) ? providers : [];
      /** @type {Object<string, any>} */
      const providerConfigs = twpConfig.get("providerConfigs") || {};
      /** @type {Set<string>} */
      const existingIds = new Set(normalizedProviders.map((provider) => provider.id));
      /** @type {Array<Object>} */
      const mergedProviders = [...normalizedProviders];
      for (const [providerId, providerConfig] of Object.entries(providerConfigs)) {
        /** @type {boolean} */
        const isCustomProvider = String(providerId || "").startsWith("_custom_");
        /** @type {string} */
        const customProviderName = String(providerConfig?.name || "").trim();
        if (!isCustomProvider || existingIds.has(providerId) || !customProviderName) continue;
        mergedProviders.push({ id: providerId, name: customProviderName });
        existingIds.add(providerId);
      }
      _aiProviderDropdown.innerHTML = "";
      for (const p of mergedProviders) {
        const opt = document.createElement("option");
        opt.value = p.id;
        // Use i18n localized name; fall back to original name if no translation exists
        opt.textContent = _getProviderLocalizedName(p.id, p.name);
        if (p.id === activeId) opt.selected = true;
        _aiProviderDropdown.appendChild(opt);
      }
    }

    /** Show/hide "Loading" indicator */
    const _providerLoadingSpan = document.createElement("span");
    _providerLoadingSpan.className = "model-loading-msg";
    _providerLoadingSpan.setAttribute("data-i18n", "msgLoadingModels");
    _providerLoadingSpan.textContent = "Loading...";
    _providerLoadingSpan.style.display = "none";
    _aiProviderDropdown.parentNode?.insertBefore(_providerLoadingSpan, _aiProviderDropdown.nextSibling);

    function _showProviderLoading(show) {
      _providerLoadingSpan.style.display = show ? "" : "none";
    }

    /** Main loading logic */
    async function _loadProviderDropdown() {
      // Try to read models.dev cache
      let devData = null;
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        try {
          const cache = await chrome.storage.local.get("modelsdev:providers");
          devData = cache?.["modelsdev:providers"]?.data;
        } catch (_) {}
      }

      const isValid = devData && typeof devData === "object" && Object.keys(devData).length > 10;

      if (isValid) {
        // ① Cache valid → merge models.dev data + missing built-in providers
        const devDefs = _buildDevProviderDefs(devData);
        const devIds = new Set(devDefs.map((d) => d.id));
        for (const bp of builtInProviders) {
          if (!devIds.has(bp.id)) devDefs.push(bp);  // Supplement providers missing from models.dev
        }
        _renderProviderDropdown(devDefs);
      } else {
        // ② Cache invalid → show built-in providers
        _renderProviderDropdown(builtInProviders);
        // If no cache at all, show loading and wait
        if (!devData && typeof chrome !== "undefined" && chrome.storage?.local) {
          _showProviderLoading(true);
        }
      }
      _showProviderLoading(false);
    }

    _loadProviderDropdown();

    // ③ Listen for storage changes, auto-refresh dropdown when data arrives
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes["modelsdev:providers"]) {
          _loadProviderDropdown();
        }
      });
    }

    // Wire generic panel: load config for the selected provider
    // Legacy config keys → providerConfigs fallback map
    const LEGACY_KEYS = {
      openai: { apiKey: "apiKeyOpenAI", model: "openAiModel" },
      openrouter: { apiKey: "apiKeyOpenRouter", model: "openRouterModel", apiBase: "openRouterApiBase" },
      anthropic: { apiKey: "apiKeyAnthropic", model: "anthropicModel" },
      "google-gemini": { apiKey: "apiKeyGoogleGemini", model: "googleGeminiModel" },
      "azure-openai": { apiKey: "apiKeyAzureOpenAI", model: "azureOpenAIModel", apiBase: "azureOpenAIEndpoint" },
      deepseek: { apiKey: "apiKeyDeepSeek", model: "deepSeekModel" },
      grok: { apiKey: "apiKeyGrok", model: "grokModel" },
    };

    // Highlight the three config inputs to guide the user
    function _highlightConfigInputs() {
      const inputs = [
        document.querySelector("#apiKeyGeneric"),
        document.querySelector("#genericApiBase"),
        document.querySelector("#genericModel"),
      ];
      inputs.forEach(el => {
        if (!el) return;
        el.classList.add("dualtran-input-highlight");
        setTimeout(() => el.classList.remove("dualtran-input-highlight"), 1500);
      });
    }

    function _loadGenericProviderConfig(providerId) {
      const providerConfigs = twpConfig.get("providerConfigs") || {};
      let stored = providerConfigs[providerId] || {};
      _highlightConfigInputs();

      // Legacy fallback: if no data in providerConfigs, try old config keys
      const legacy = LEGACY_KEYS[providerId];
      if (legacy && !stored.apiKey && !stored.model) {
        const apiKey = (twpConfig.get(legacy.apiKey) || "").trim();
        const model = (twpConfig.get(legacy.model) || "").trim();
        if (apiKey) stored.apiKey = apiKey;
        if (model) stored.model = model;
        if (legacy.apiBase) {
          const ab = (twpConfig.get(legacy.apiBase) || "").trim();
          if (ab) stored.apiBase = ab;
        }
      }
      const apiKeyInput = document.querySelector("#apiKeyGeneric");
      const apiBaseInput = document.querySelector("#genericApiBase");
      const modelSelect = document.querySelector("#genericModel");

      // Dynamically update panel labels (prefer registry, fallback to models.dev cache)
      let providerDef = providerRegistry.getProvider(providerId);
      function _updatePanelLabels(def) {
        const name = def?.name || providerId || "";
        const keyLabel = document.querySelector("#genericApiKeyLabel");
        const baseLabel = document.querySelector("#genericApiBaseLabel");
        const modelLabel = document.querySelector("#genericModelLabel");
        const apiKeyLink = document.querySelector("#genericApiKeyLink");
        if (keyLabel) keyLabel.textContent = name ? `${name} API Key` : "API Key";
        if (baseLabel) baseLabel.textContent = name ? `${name} API Endpoint URL` : "API Endpoint URL";
        if (modelLabel) modelLabel.textContent = name ? `${name} Model` : "Model";
        if (apiKeyLink) {
          if (def?.apiKeyUrl) {
            apiKeyLink.href = def.apiKeyUrl;
            apiKeyLink.textContent = `How to get ${name} API Key?`;
            apiKeyLink.style.display = "";
          } else if (def?.doc) {
            apiKeyLink.href = def.doc;
            apiKeyLink.textContent = `${name} Documentation`;
            apiKeyLink.style.display = "";
          } else {
            apiKeyLink.style.display = "none";
          }
        }
      }
      _updatePanelLabels(providerDef);
      // When not in registry, async supplement labels from models.dev
      if (!providerDef && typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get("modelsdev:providers", (cacheRes) => {
          const devData = cacheRes?.["modelsdev:providers"]?.data?.[providerId];
          if (devData) {
            _updatePanelLabels({
              name: devData.name,
              apiBase: devData.api,
              apiKeyUrl: devData.apiKeyUrl || null,
              doc: devData.doc || null,
            });
          }
        });
      }
      if (apiKeyInput) apiKeyInput.value = stored.apiKey || "";
      if (apiBaseInput) {
        const providerDef = providerRegistry.getProvider(providerId);
        function _endpointPlaceholder(apiBase) {
          if (!apiBase) return "";
          return apiBase.includes("/chat/completions") ? apiBase : apiBase.replace(/\/+$/, "") + "/chat/completions";
        }
        apiBaseInput.value = stored.apiBase || "";
        apiBaseInput.placeholder = _endpointPlaceholder(providerDef?.apiBase || lookupKnownApiBase(providerId));
        // When not in registry, async supplement placeholder from models.dev cache
        if (!providerDef && typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get("modelsdev:providers", (cacheRes) => {
            const devData = cacheRes?.["modelsdev:providers"]?.data?.[providerId];
            const rawApi = devData?.api || "";
            const api = (rawApi && !rawApi.includes("${")) ? rawApi : lookupKnownApiBase(providerId);
            if (api && apiBaseInput && !apiBaseInput.value) {
              apiBaseInput.placeholder = _endpointPlaceholder(api);
            }
          });
        }
      }
      // Populate model select
      if (modelSelect) {
        const providerDef = providerRegistry.getProvider(providerId);
        const customProviderName = (stored.name || providerId || "").trim();
        const customProviderRegistry = createProviderRegistry([
          {
            id: providerId,
            name: customProviderName || providerId,
            apiBase: stored.apiBase || "",
            modelListUrl: normalizeOpenAiCompatibleModelsEndpoint(stored.apiBase || ""),
            auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
            responseFormat: "openai-sse",
            modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
          },
        ]);
        const canLoadCustomProviderModels = Boolean(
          !providerDef && stored.apiKey && normalizeOpenAiCompatibleModelsEndpoint(stored.apiBase || "")
        );
        const hasModelApi = providerDef?.modelListUrl || providerDef?.id === "google-gemini" || canLoadCustomProviderModels;
        const storedModel = stored.model || "";

        // Helper: hide the "Loading" span above the select
        function _hideLoading() {
          const labelP = modelSelect?.previousElementSibling;
          if (!labelP) return;
          const span = labelP.querySelector(".model-loading-msg");
          if (span) span.style.display = "none";
        }

        if (stored.apiKey && hasModelApi) {
          // Has API key and model list endpoint → fetch from API
          modelSelect.disabled = true;
          modelSelect.innerHTML = '<option value="" disabled>Loading...</option>';
          loadAiProviderModelOptions({
            provider: providerId,
            apiKey: stored.apiKey,
            endpoint: canLoadCustomProviderModels ? stored.apiBase : undefined,
            registry: canLoadCustomProviderModels ? customProviderRegistry : undefined,
            translate: i18nOrDefault,
          }).then(models => {
            modelSelect.innerHTML = "";
            for (const m of models) {
              const opt = document.createElement("option");
              opt.value = m.value;
              opt.textContent = m.text || m.value;
              modelSelect.appendChild(opt);
            }
            if (storedModel && !models.some(m => m.value === storedModel)) {
              const opt = document.createElement("option");
              opt.value = storedModel;
              opt.textContent = storedModel;
              modelSelect.appendChild(opt);
            }
            modelSelect.disabled = false;
            if (storedModel) modelSelect.value = storedModel;
            _hideLoading();
          }).catch(() => {
            // API Key fetch failed → load preview models first, then insert notice at top
            _loadPreviewModelsFallback(true);
          });
        } else {
          // No API key or no model list API → loadPreviewModels
          _loadPreviewModelsFallback(false);
        }

        function _loadPreviewModelsFallback(showErrorNotice) {
          if (!modelSelect) return;
          modelSelect.disabled = true;
          modelSelect.innerHTML = '<option value="" disabled>Loading...</option>';
          loadPreviewModels({ provider: providerId }).then(models => {
            modelSelect.innerHTML = "";
            // When API Key fetch fails, insert a notice at the first row
            if (showErrorNotice) {
              const notice = chrome.i18n.getMessage("msgModelListFetchFailed") || "Failed to fetch model list with API key. Available models:";
              const noticeOpt = document.createElement("option");
              noticeOpt.value = "";
              noticeOpt.textContent = notice;
              noticeOpt.disabled = true;
              modelSelect.appendChild(noticeOpt);
            }
            for (const m of models) {
              const opt = document.createElement("option");
              opt.value = m.value;
              opt.textContent = m.text || m.value;
              modelSelect.appendChild(opt);
            }
            if (storedModel && !models.some(m => m.value === storedModel)) {
              const opt = document.createElement("option");
              opt.value = storedModel;
              opt.textContent = storedModel;
              modelSelect.appendChild(opt);
            }
            // Load custom models previously added by user
            const customModels = stored.customModels || [];
            for (const cm of customModels) {
              if (!models.some(m => m.value === cm)) {
                const opt = document.createElement("option");
                opt.value = cm;
                opt.textContent = cm;
                modelSelect.appendChild(opt);
              }
            }
            modelSelect.disabled = false;
            if (storedModel) modelSelect.value = storedModel;
            _hideLoading();
          }).catch(() => {
            modelSelect.innerHTML = '<option value="" disabled>Error loading models</option>';
            modelSelect.disabled = false;
            _hideLoading();
          });
        }
      }
    }

    function _saveGenericProviderConfig(providerId) {
      const providerConfigs = twpConfig.get("providerConfigs") || {};
      if (!providerConfigs[providerId]) providerConfigs[providerId] = {};
      const apiKeyInput = document.querySelector("#apiKeyGeneric");
      const apiBaseInput = document.querySelector("#genericApiBase");
      const modelSelect = document.querySelector("#genericModel");
      if (apiKeyInput) providerConfigs[providerId].apiKey = apiKeyInput.value.trim();
      if (apiBaseInput) providerConfigs[providerId].apiBase = apiBaseInput.value.trim();
      if (modelSelect) providerConfigs[providerId].model = modelSelect.value || "";
      twpConfig.set("providerConfigs", providerConfigs);
    }

    // Wire generic inputs — use "input" for real-time save (change fires only on blur)
    document.querySelector("#apiKeyGeneric")?.addEventListener("input", () => {
      const providerId = _aiProviderDropdown.value;
      _saveGenericProviderConfig(providerId);
    });
    document.querySelector("#apiKeyGeneric")?.addEventListener("change", () => {
      const providerId = _aiProviderDropdown.value;
      _loadGenericProviderConfig(providerId); // reload models on blur with new key
    });
    document.querySelector("#genericApiBase")?.addEventListener("change", () => {
      _saveGenericProviderConfig(_aiProviderDropdown.value);
    });
    document.querySelector("#genericModel")?.addEventListener("change", () => {
      _saveGenericProviderConfig(_aiProviderDropdown.value);
    });

    // All providers use the generic panel uniformly
    _aiProviderDropdown.addEventListener("change", () => {
      _loadGenericProviderConfig(_aiProviderDropdown.value);
    });

    // Initialize: after dropdown is populated, load config for the actually selected value
    _loadProviderDropdown().then(() => {
      _loadGenericProviderConfig(_aiProviderDropdown.value || activeId);
    });

    // ── "Add Custom Provider" Button ──
    const _btnAddCustomProvider = document.querySelector("#btnAddCustomProvider");
    if (_btnAddCustomProvider) {
      _btnAddCustomProvider.addEventListener("click", () => {
        const name = (prompt("Enter provider name:") || "").trim();
        if (!name) return;
        const id = "_custom_" + name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const apiBase = (prompt("Enter API Endpoint URL (optional, press OK to skip):") || "").trim();

        // Add to dropdown list
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
        opt.selected = true;
        _aiProviderDropdown.appendChild(opt);
        _aiProviderDropdown.value = id;

        // Save to providerConfigs
        const providerConfigs = twpConfig.get("providerConfigs") || {};
        providerConfigs[id] = { name, apiBase, model: "", apiKey: "" };
        twpConfig.set("providerConfigs", providerConfigs);

        _loadGenericProviderConfig(id);
      });
    }

    // ── "Add Custom Model" Button ──
    const _btnAddCustomModel = document.querySelector("#btnAddCustomModel");
    if (_btnAddCustomModel) {
      _btnAddCustomModel.addEventListener("click", () => {
        const modelName = (prompt("Enter model name/ID:") || "").trim();
        if (!modelName) return;
        const modelSelect = document.querySelector("#genericModel");
        if (!modelSelect) return;

        const opt = document.createElement("option");
        opt.value = modelName;
        opt.textContent = modelName;
        opt.selected = true;
        modelSelect.appendChild(opt);
        modelSelect.value = modelName;

        // Persist
        const providerId = _aiProviderDropdown.value;
        const providerConfigs = twpConfig.get("providerConfigs") || {};
        if (!providerConfigs[providerId]) providerConfigs[providerId] = {};
        if (!providerConfigs[providerId].customModels) providerConfigs[providerId].customModels = [];
        if (!providerConfigs[providerId].customModels.includes(modelName)) {
          providerConfigs[providerId].customModels.push(modelName);
        }
        providerConfigs[providerId].model = modelName;
        twpConfig.set("providerConfigs", providerConfigs);
      });
    }
  }


  $("#btnCalculateStorage").style.display = "inline-block"; // Show "Calculate Storage" button
  $("#storageUsed").style.display = "none"; // Initially hide storage info
  $("#btnCalculateStorage").onclick = (e) => { // Calculate cache usage button
    $("#btnCalculateStorage").style.display = "none"; // Hide button to prevent repeated clicks

    chrome.runtime.sendMessage( // Request background to return cache size
      {
        action: "getCacheSize",
      },
      (result) => { // Callback to display result
        $("#storageUsed").textContent = result; // Display value
        $("#storageUsed").style.display = "inline-block"; // Show
      }
    );
  };
});

window.scrollTo({ // Ensure page scrolls to top after loading
  top: 0,
});
