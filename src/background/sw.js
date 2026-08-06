"use strict";

console.log("sw.js is running")

import { migrateProviderConfig } from "../lib/ai/providerMigration.js";
import twpLang from "../lib/languages.js"
import twpConfig from "../lib/config.js"
import platformInfo from "../lib/platformInfo.js"
import translationCache from "../background/translationCache.js"
import { aiTranslationCacheGet, aiTranslationCacheSet } from "./aiTranslationCache.js";
import {
  buildOpenAiRequestTrackingExecutionPlan,
  executeOpenAiRequestTracking,
} from "../background/openAiRequestTrackerExecutionHelpers.js"
import {
  buildInstalledActionPlan,
  buildStartupStorageReset,
  evaluateReleaseNotesDisplay,
  getReloadableTabIds,
  resolveDevelopmentReloadPlan,
} from "../background/installHelpers.js"
import {
  buildDevelopmentReloadExecutionPlan,
  buildInstalledExecutionPlan,
  buildStartupExecutionPlan,
  createInstallEffectExecutor,
  executeDevelopmentReloadBootstrap,
  executeInstallEffects,
} from "../background/installExecutionHelpers.js"
import {
  getTranslatePageContextMenuTitle,
} from "../background/contextMenuHelpers.js"
import {
  buildStaticActionContextMenuConfigs,
} from "../background/contextMenuRegistrationHelpers.js"
import {
  executeActivatedContextMenuRefresh,
  executeContextMenuEffects,
  executeStaticContextMenuRegistration,
  buildTranslatePageContextMenuEffects,
  buildTranslatePageContextMenuRefreshPlan,
  buildTranslateSelectedContextMenuEffects,
  buildTranslateSelectedContextMenuRefreshPlan,
} from "../background/contextMenuExecutionHelpers.js"
import {
  resolveBasicMenuClickAction,
  resolvePdfMenuExecutionFromStorage,
  resolveTranslateSelectedMenuClick,
  resolveTranslateSelectedMenuClickFromStorage,
} from "../background/menuClickHelpers.js"
import {
  buildBasicMenuEffectPlan,
  createMenuEffectExecutor,
  executeMenuEffects,
  buildTranslateSelectedEffectPlan,
  executePdfMenuFromStorage,
  executeTranslateSelectedFromStorage,
} from "../background/menuExecutionHelpers.js"
import {
  buildBrowserActionPopupConfig,
  buildPageActionPopupConfig,
} from "../background/popupHelpers.js"
import {
  applyBrowserActionPopupReset,
  executeActivePageActionPopupReset,
  applyPageActionPopupReset,
  executePopupEffects,
} from "../background/popupExecutionHelpers.js"
import {
  detectTabLanguageForSender,
  getActiveTabMimeType,
  getTabHostNameFromSender,
  queryMainFrame,
} from "../background/runtimeMessageHelpers.js"
import {
  buildFrameFocusBroadcastEffect,
  buildOpenDonationPageEffect,
  buildOpenOptionsPageEffect,
  createRuntimeMessageEffectExecutor,
  executeMainFrameRuntimeQuery,
  executeSenderTabHostNameQuery,
  executeSenderTabLanguageQuery,
  executeQueriedActiveTabMimeType,
} from "../background/runtimeMessageExecutionHelpers.js"
import {
  collectTabIds,
  resolveDesktopToggleTranslationMessage,
  resolveMobileActionClickMessage,
  resolveMobilePageActionUpdate,
} from "../background/actionClickHelpers.js"
import {
  buildDesktopActionClickEffects,
  buildMobileActionClickEffects,
  buildPageActionHideEffects,
  createActionClickEffectExecutor,
  executeInitialPageActionHide,
  executeActionClickEffects,
} from "../background/actionClickExecutionHelpers.js"
import {
  resolveActionConfigChange,
  shouldRefreshIconsForConfigChange,
} from "../background/configChangeHelpers.js"
import {
  buildActiveTabTranslationBootstrap,
  buildAutoTranslateDomExecutionPlan,
  buildSitesToAutoTranslateRemoval,
  buildSitesToAutoTranslateOnCommitted,
  resolveActiveTabTranslationInfoMessageUpdate,
  resolveActiveTabTranslationQueryResponse,
  resolveAutoTranslateOnDOMContentLoaded,
} from "../background/autoTranslateLinkHelpers.js"
import {
  executeActiveTabTranslationBootstrap,
  executeAutoTranslateDomEffects,
  executeQueriedActiveTabTranslationBootstrap,
} from "../background/autoTranslateLinkExecutionHelpers.js"
import {
  buildAutoTranslateResetState,
  resolveAutoTranslateAlarmDispatch,
  resolveAutoTranslateConfigChange,
  resolveAutoTranslatePermissionBootstrap,
  shouldDisableAutoTranslateForRemovedPermissions,
} from "../background/autoTranslateRuntimeHelpers.js"
import {
  buildAutoTranslateAlarmExecutionPlan,
  buildAutoTranslateConfigToggleEffects,
  buildAutoTranslatePermissionBootstrapEffects,
  buildAutoTranslatePermissionRemovedEffects,
  createAutoTranslateRuntimeEffectExecutor,
  createAutoTranslateToggleInvoker,
  executeAutoTranslateAlarm,
  executeAutoTranslatePermissionBootstrap,
} from "../background/autoTranslateRuntimeExecutionHelpers.js"
import {
  buildDisableAutoTranslateListenerPlan,
  buildEnableAutoTranslateListenerPlan,
} from "../background/autoTranslateListenerHelpers.js"
import {
  buildDisableAutoTranslateExecutionPlan,
  buildEnableAutoTranslateExecutionPlan,
  createAutoTranslateListenerEffectExecutor,
  createAutoTranslateListenerInvoker,
} from "../background/autoTranslateListenerExecutionHelpers.js"
import {
  buildAllTabIconRefreshPlan,
  buildIconEffectPlan,
  buildThemeIconRefreshPlan,
  resolveActionIconPath,
  resolveIconUpdateFromLanguageState,
  resolveIconUpdateFromRuntimeMessage,
  resolveIconUpdateOnTabActivated,
  resolveIconUpdateOnTabLoading,
  resolveTabIncognitoState,
  resolveSvgIconAppearance,
} from "../background/iconHelpers.js"
import {
  createIconEffectExecutor,
  executeAllTabIconRefresh,
  executeActivatedTabIconRefresh,
  executeIconEffects,
  executeQueriedTabIconRefresh,
} from "../background/iconExecutionHelpers.js"
import {
  buildMimeTypeStorageUpdate,
  resolveTabUpdatedLifecycleAction,
} from "../background/tabStateHelpers.js"
import {
  buildTabHasContentScriptExecutionPlan,
  executeContentScriptProbe,
  executeInitialContentScriptProbeBroadcast,
  executeTabHasContentScriptRemoval,
} from "../background/tabStateExecutionHelpers.js"
import {
  buildMimeTypeHeaderExecutionPlan,
  executeMimeTypeHeaderWrite,
} from "../background/webRequestExecutionHelpers.js"
import {
  createStorageEffectExecutor,
  executeStorageEffects,
} from "../background/storageExecutionHelpers.js"
import {
  createTabEffectExecutor,
} from "../background/tabExecutionHelpers.js"
import {
} from "../background/commandHelpers.js"
import {
  createCommandEffectExecutor,
  executeCommandEffects,
  executeHotkeyCommand,
} from "../background/commandExecutionHelpers.js"
import "../background/translationService.js"
import "../background/textToSpeech.js"
import "../background/aiProxy.js"

// Run provider config migration after storage is loaded (must be inside onReady to prevent overwriting user API keys with empty data)
twpConfig.onReady(() => {
  try {
    migrateProviderConfig(twpConfig);
  } catch (e) {
    console.warn("Provider config migration failed:", e);
  }
});

// Avoid outputting the error message "Receiving end does not exist" in the Console.
function checkedLastError() {
  chrome.runtime.lastError;
}

// Bound references to chrome.storage.local methods.
// In MV3 Service Workers, passing chrome.storage.local.get/set as detached
// function references loses the `this` context, causing:
//   "TypeError: Illegal invocation: Function must be called on an object of type StorageArea"
// Pre-binding once here avoids the issue everywhere.
const boundStorageGet = chrome.storage.local.get.bind(chrome.storage.local)
const boundStorageSet = chrome.storage.local.set.bind(chrome.storage.local)

const runStorageEffects = createStorageEffectExecutor({
  setStorage: boundStorageSet,
  log: console.log,
})

const runTabEffects = createTabEffectExecutor({
  createTab: chrome.tabs.create,
  sendTabMessage: chrome.tabs.sendMessage,
  reloadTab: chrome.tabs.reload,
  sendMessageCallback: checkedLastError,
})

// get a map of tabId to document's mimetype
chrome.webRequest.onHeadersReceived.addListener(
  function (details) {
    if (details.tabId !== -1) {
      executeMimeTypeHeaderWrite({
        details,
        getStorage: boundStorageGet,
        log: console.log,
        applyStorageEffects: runStorageEffects,
      });
    }
  },
  {
    urls: ["*://*/*"],
    types: ["main_frame"],
  },
  ["responseHeaders"]
);

// determine if a user is Free user Or Paid user of openAI
// IMPORTANT: this listener must stay non-async. In Chrome, an async runtime
// message listener returns a Promise for every message, which can cause
// unrelated sendMessage callers to receive a premature null response.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("message 'recordNewRequestToOpenAI' is received: ", request)
  if (request.action !== "recordNewRequestToOpenAI") {
    return false;
  }

  executeOpenAiRequestTracking(request, {
    getStorage: boundStorageGet,
    logError: console.error,
    applyStorageEffects: runStorageEffects,
  }).catch((error) => {
    console.error("[DualTran][OpenAiRequestTrackingCatch]", error)
  });

  return false;
})

// AI translation cache relay — content scripts cannot access IndexedDB directly,
// so cache reads and writes are relayed through the service worker.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "aiTranslationCacheGet") {
    const { sourceLanguage, targetLanguage, providerId, modelId, urlWithoutParams, originalText } = request;
    aiTranslationCacheGet(sourceLanguage, targetLanguage, providerId, modelId, urlWithoutParams, originalText)
      .then(result => sendResponse(result || null))
      .catch(() => sendResponse(null));
    return true;
  }
  if (request.action === "aiTranslationCacheSet") {
    const { sourceLanguage, targetLanguage, providerId, modelId, urlWithoutParams, originalText, translatedText } = request;
    aiTranslationCacheSet(sourceLanguage, targetLanguage, providerId, modelId, urlWithoutParams, originalText, translatedText)
      .catch(e => console.error("[AI-CACHE] set via sw failed:", e));
    sendResponse(true);
  }
  return false;
})

// Listen for messages (from background or content scripts)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const runRuntimeMessageEffects = createRuntimeMessageEffectExecutor({
    applyTabEffects: runTabEffects,
  })

  // Get main frame page language state
  if (request.action === "getMainFramePageLanguageState") {
    executeMainFrameRuntimeQuery({
      sender,
      action: "getCurrentPageLanguageState",
      sendTabMessage: chrome.tabs.sendMessage,
      afterSend: checkedLastError,
    }).then(sendResponse);

    return true;
  }
  // Get main frame tab language
  else if (request.action === "getMainFrameTabLanguage") {
    executeMainFrameRuntimeQuery({
      sender,
      action: "getOriginalTabLanguage",
      sendTabMessage: chrome.tabs.sendMessage,
      afterSend: checkedLastError,
    }).then(sendResponse);

    return true;
  }
  // Set page language state
  else if (request.action === "setPageLanguageState") {
    updateContextMenu(request.pageLanguageState);
  }
  // Open options page
  else if (request.action === "openOptionsPage") {
    const optionsHash = typeof request.hash === "string" && request.hash.startsWith("#")
      ? request.hash
      : ""
    runRuntimeMessageEffects(
      buildOpenOptionsPageEffect(chrome.runtime.getURL(`/options/options.html${optionsHash}`))
    )
  }
  // Open donation page
  else if (request.action === "openDonationPage") {
    runRuntimeMessageEffects(
      buildOpenDonationPageEffect(chrome.runtime.getURL("/options/options.html#donation"))
    )
  }
  // Detect page language
  else if (request.action === "detectTabLanguage") {
    executeSenderTabLanguageQuery({
      sender,
      detectLanguage: chrome.tabs.detectLanguage,
    }).then(sendResponse);

    return true;
  }
  // Get tab hostname
  else if (request.action === "getTabHostName") {
    sendResponse(executeSenderTabHostNameQuery(sender));
  }
  // Frame received focus
  else if (request.action === "thisFrameIsInFocus") {
    runRuntimeMessageEffects(buildFrameFocusBroadcastEffect(sender))
  }
  // Get tab MIME type
  else if (request.action === "getTabMimeType") {
    executeQueriedActiveTabMimeType({
      queryTabs: chrome.tabs.query,
      getStorage: boundStorageGet,
    }).then(sendResponse);
    return true;
  }
});

/**
 * Update translate-selected-text context menu
 */
function updateTranslateSelectedContextMenu() {
  if (typeof chrome.contextMenus !== "undefined") { // check if chrome context menu is defined 
    executeContextMenuEffects(buildTranslateSelectedContextMenuRefreshPlan({
      isEnabled: twpConfig.get("showTranslateSelectedContextMenu") === "yes",
      title: chrome.i18n.getMessage("msgTranslateSelectedText"),
    }), {
      removeContextMenu: chrome.contextMenus.remove,
      createContextMenu: chrome.contextMenus.create,
      removeCallback: checkedLastError,
      createCallback: () => chrome.runtime.lastError,
    })
  }
}

/**
 * Update context menu
 * @param {*} pageLanguageState 
 */
function updateContextMenu(pageLanguageState = "original") {
  const targetLanguage = twpConfig.get("targetLanguage");
  if (typeof chrome.contextMenus != "undefined") {
    executeContextMenuEffects(buildTranslatePageContextMenuRefreshPlan({
      isEnabled: twpConfig.get("showTranslatePageContextMenu") == "yes",
      pageLanguageState,
      restoreLabel: chrome.i18n.getMessage("btnRestore"),
      targetLanguageName: twpLang.codeToLanguage(targetLanguage),
      buildTranslateForLabel: (languageName) => chrome.i18n.getMessage("msgTranslateFor", languageName),
    }), {
      removeContextMenu: chrome.contextMenus.remove,
      createContextMenu: chrome.contextMenus.create,
      removeCallback: checkedLastError,
      createCallback: () => chrome.runtime.lastError,
    })
  }
}

// Listen for browser startup event, reset global state on startup
chrome.runtime.onStartup.addListener((details) => {
  const startupReset = buildStartupStorageReset()
  runStorageEffects(buildStartupExecutionPlan(startupReset))
});

// Listen for install event, open options page or release notes on install/update
chrome.runtime.onInstalled.addListener((details) => {
  const optionsPageUrl = chrome.runtime.getURL("/options/options.html")
  const releaseNotesPageUrl = chrome.runtime.getURL("/options/options.html#release_notes")
  const runInstallEffects = createInstallEffectExecutor({
    setConfig(key, value) {
      twpConfig.set(key, value);
    },
    deleteTranslationCache() {
      translationCache.deleteTranslationCache();
    },
    applyTabEffects: runTabEffects,
  })

  if (details.reason === "install") {
    runInstallEffects(buildInstalledExecutionPlan({
      openPageUrl: optionsPageUrl,
    }))
  }
  else if (
    details.reason == "update" &&
    chrome.runtime.getManifest().version != details.previousVersion
  ) {
    twpConfig.onReady(async () => {
      const plan = buildInstalledActionPlan({
        reason: details.reason,
        currentVersion: chrome.runtime.getManifest().version,
        previousVersion: details.previousVersion,
        isMobile: platformInfo.isMobile.any,
        showReleaseNotes: twpConfig.get("showReleaseNotes"),
        lastTimeShowingReleaseNotes: twpConfig.get("lastTimeShowingReleaseNotes"),
        optionsPageUrl,
        releaseNotesPageUrl,
      })
      runInstallEffects(buildInstalledExecutionPlan(plan))
    });
  }

  twpConfig.onReady(async () => {
    const plan = buildInstalledActionPlan({
      reason: details.reason,
      currentVersion: chrome.runtime.getManifest().version,
      previousVersion: details.previousVersion,
      isMobile: platformInfo.isMobile.any,
      showReleaseNotes: twpConfig.get("showReleaseNotes"),
      lastTimeShowingReleaseNotes: twpConfig.get("lastTimeShowingReleaseNotes"),
      optionsPageUrl,
      releaseNotesPageUrl,
    })
    runInstallEffects(buildInstalledExecutionPlan({
      shouldDisableDeepL: plan.shouldDisableDeepL,
    }))
  });

  // Dev mode: auto-reload all http/https tabs after install/update to re-inject fresh content scripts
  // This prevents “stale content script + new extension version” mismatch at the root
  if (details.reason === "install" || details.reason === "update") {
    console.log("Running in development mode, reloading all tabs because extension was installed or updated...");  
    if (chrome.management && chrome.tabs && chrome.tabs.query && chrome.tabs.reload) {
      executeDevelopmentReloadBootstrap({
        reason: details.reason,
        getSelf: chrome.management.getSelf,
        queryTabs: chrome.tabs.query,
        hasRuntimeError() {
          return Boolean(chrome.runtime && chrome.runtime.lastError)
        },
        executeReloadEffects: runInstallEffects,
      })
    }
  }
});

/**
 * Reset page action
 * @param {*} tabId 
 * @param {*} forceShow 
 */
function resetPageAction(tabId, forceShow = false) {
  applyPageActionPopupReset({
    tabId,
    forceShow,
    translateClickingOnce: twpConfig.get("translateClickingOnce"),
    useOldPopup: twpConfig.get("useOldPopup"),
    setPageActionPopup: chrome.pageAction?.setPopup,
  });
}

/**
 * Set BrowserAction popup based on translateClickingOnce setting (none / old popup / new popup)
 * @param {*} forceShow 
 */
function resetBrowserAction(forceShow = false) {
  applyBrowserActionPopupReset({
    forceShow,
    translateClickingOnce: twpConfig.get("translateClickingOnce"),
    useOldPopup: twpConfig.get("useOldPopup"),
    setBrowserActionPopup: chrome.action?.setPopup,
  });
}

const runMenuEffects = createMenuEffectExecutor({
  addNeverTranslateSite(hostname) {
    twpConfig.addSiteToNeverTranslate(hostname);
  },
  logError(message) {
    console.error(message);
  },
  applyPopupEffects(nextEffects) {
    executePopupEffects(nextEffects, {
      resetBrowserAction,
      openBrowserActionPopup: chrome.action?.openPopup,
      resetPageAction,
      setPageActionPopup: chrome.pageAction?.setPopup,
      openPageActionPopup: chrome.pageAction?.openPopup,
    });
  },
  applyTabEffects(nextEffects) {
    runTabEffects(nextEffects)
  },
})

// Create context menus (shown when right-clicking the extension icon)
if (typeof chrome.contextMenus !== "undefined") {
  executeStaticContextMenuRegistration(
    buildStaticActionContextMenuConfigs({
      showPopupLabel: chrome.i18n.getMessage("btnShowPopup"),
      neverTranslateLabel: chrome.i18n.getMessage("btnNeverTranslate"),
      moreOptionsLabel: chrome.i18n.getMessage("btnMoreOptions"),
      pdfToHtmlLabel: chrome.i18n.getMessage("msgPDFtoHTML"),
    }),
    {
      createContextMenu: chrome.contextMenus.create,
      createCallback: () => chrome.runtime.lastError,
    }
  );

  // Context menu click event handler
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const basicAction = resolveBasicMenuClickAction({
      menuItemId: info.menuItemId,
      tabId: tab.id,
      tabUrl: tab.url,
      optionsPageUrl: chrome.runtime.getURL("/options/options.html"),
    })
    const basicEffects = buildBasicMenuEffectPlan(basicAction)
    if (basicEffects.length) {
      runMenuEffects(basicEffects)
      return
    }
    // Menu action: translate selected text
    else if (info.menuItemId == "translate-selected-text") {
      await executeTranslateSelectedFromStorage({
        tabId: tab.id,
        selectionText: info.selectionText,
        hasPageActionOpenPopup: !!(chrome.pageAction && chrome.pageAction.openPopup),
        isInReaderMode: !!tab.isInReaderMode,
        getStorage: boundStorageGet,
        applyEffects: runMenuEffects,
      })
    }
    // Menu action: PDF to HTML (browser action)
    else if (info.menuItemId == "browserAction-pdf-to-html") {
      executePdfMenuFromStorage({
        tabId: tab.id,
        canOpenPopup: typeof chrome.action.openPopup !== "undefined",
        popupTarget: "browserAction",
        getStorage: boundStorageGet,
        applyEffects: runMenuEffects,
      });
    }
    // Menu action: PDF to HTML (page action)
    else if (info.menuItemId == "pageAction-pdf-to-html") {
      executePdfMenuFromStorage({
        tabId: tab.id,
        canOpenPopup: typeof chrome.pageAction.openPopup !== "undefined",
        popupTarget: "pageAction",
        getStorage: boundStorageGet,
        applyEffects: runMenuEffects,
      });
    }
  });

  // On tab activation, get language state and update context menu
  chrome.tabs.onActivated.addListener((activeInfo) => {
    executeActivatedContextMenuRefresh(activeInfo.tabId, {
      applyContextMenuRefresh(pageLanguageState) {
        twpConfig.onReady(() => updateContextMenu(pageLanguageState));
      },
      sendTabMessage: chrome.tabs.sendMessage,
      afterSend: checkedLastError,
    })
  });

  // When navigating to a new URL, tab properties (url, title, favIconUrl) are updated, generating multiple onUpdated events. 
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const lifecycleAction = resolveTabUpdatedLifecycleAction({
      isTabActive: !!tab.active,
      status: changeInfo.status,
    })
    // Tab is loading (changeInfo.status === "loading")
    if (lifecycleAction === "refresh-context-menu") {
      twpConfig.onReady(() => updateContextMenu());
    }
    // Tab finished loading (changeInfo.status === "complete")
    else if (lifecycleAction === "probe-content-script") {
      executeContentScriptProbe(tabId, {
        sendTabMessage: chrome.tabs.sendMessage,
        getStorage: boundStorageGet,
        afterSend: checkedLastError,
        applyStorageEffects: runStorageEffects,
      })
    }
  });

  // On tab close, remove tabHasContentScript entry
  chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    await executeTabHasContentScriptRemoval(tabId, {
      getStorage: boundStorageGet,
      applyStorageEffects: runStorageEffects,
    })
  });

  // Probe all tabs to verify content script injection
  executeInitialContentScriptProbeBroadcast({
    queryTabs: chrome.tabs.query,
    sendTabMessage: chrome.tabs.sendMessage,
    getStorage: boundStorageGet,
    afterSend: checkedLastError,
    applyStorageEffects: runStorageEffects,
  });
}

// On config ready
twpConfig.onReady(() => {
  const runActionClickEffects = createActionClickEffectExecutor({
    hidePageAction: chrome.pageAction?.hide,
    sendTabMessage: chrome.tabs.sendMessage,
    sendMessageCallback: checkedLastError,
  })

  // Mobile platform
  if (platformInfo.isMobile.any) {
    // Gray out page action initially
    executeInitialPageActionHide({
      queryTabs: chrome.tabs.query,
      applyEffects: runActionClickEffects,
    });
    // Gray out DualTran icon while tab is loading
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (resolveMobilePageActionUpdate(changeInfo.status) === "hide") {
        runActionClickEffects(buildPageActionHideEffects([tabId]));
      }
    });
    // Show mobile bottom bar on browser action click
    chrome.action.onClicked.addListener((tab) => {
      runActionClickEffects(
        buildMobileActionClickEffects(tab.id, resolveMobileActionClickMessage())
      )
    });
  }
  // Desktop platform
  else {
    // If pageAction exists, toggle translated/original page on click
    if (chrome.pageAction) {
      chrome.pageAction.onClicked.addListener((tab) => {
        const action = resolveDesktopToggleTranslationMessage(
          twpConfig.get("translateClickingOnce")
        )
          runActionClickEffects(buildDesktopActionClickEffects(tab.id, action))
      });
    }
    // Toggle translated/original page on browser action click
    chrome.action.onClicked.addListener((tab) => {
      const action = resolveDesktopToggleTranslationMessage(
        twpConfig.get("translateClickingOnce")
      )
      runActionClickEffects(buildDesktopActionClickEffects(tab.id, action))
    });

    // Configure browser action popup behavior
    resetBrowserAction();

    // Listen for action-related config changes
    twpConfig.onChanged((name, newvalue) => {
      const configChange = resolveActionConfigChange(name)
      if (configChange.resetBrowserAction) {
        resetBrowserAction();
      }
      if (configChange.resetActivePageAction) {
        executeActivePageActionPopupReset({
          translateClickingOnce: twpConfig.get("translateClickingOnce"),
          useOldPopup: twpConfig.get("useOldPopup"),
          queryTabs: chrome.tabs.query,
          setPageActionPopup: chrome.pageAction?.setPopup,
        })
      }
    });

    // Icon update section
    {
      // Page language state: "original" or "translated"
      let pageLanguageState = "original";

      let themeColorFieldText = null;
      let themeColorAttention = null;

      function applyThemeIconRefresh(themeLike) {
        const plan = buildThemeIconRefreshPlan(themeLike)
        themeColorFieldText = plan.themeColorFieldText;
        themeColorAttention = plan.themeColorAttention;
        if (plan.shouldRefreshAllTabs) {
          updateIconInAllTabs();
        }
      }

      // Update theme colors from current browser theme, then refresh all tab icons
      if (typeof browser !== "undefined" && browser?.theme) {
        browser.theme.getCurrent().then((theme) => {
          applyThemeIconRefresh(theme);
        });

        // Listen for theme updates
        chrome.theme.onUpdated.addListener((updateInfo) => {
          applyThemeIconRefresh(updateInfo);
        });
      }

      /**
       * Dark mode support
       */
      // // Get browser display mode (dark mode check)
      // let darkMode = false;
      // darkMode = matchMedia("(prefers-color-scheme: dark)").matches;

      // // Update icons in all tabs
      // updateIconInAllTabs();

      // // Listen for dark mode changes, update all tab icons
      // matchMedia("(prefers-color-scheme: dark)").addEventListener(
      //   "change",
      //   () => {
      //     darkMode = matchMedia("(prefers-color-scheme: dark)").matches;
      //     updateIconInAllTabs();
      //   }
      // );

      /**
       * Get SVG icon (different icons for different display modes)
       * @param {boolean} incognito 
       * @returns 
       */
      function getSVGIcon(incognito = false) {
        const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                    <path fill="$(fill);" fill-opacity="$(fill-opacity);" d="M 45 0 C 20.186 0 0 20.186 0 45 L 0 347 C 0 371.814 20.186 392 45 392 L 301 392 C 305.819 392 310.34683 389.68544 313.17383 385.77344 C 315.98683 381.84744 316.76261 376.82491 315.22461 372.25391 L 195.23828 10.269531 A 14.995 14.995 0 0 0 181 0 L 45 0 z M 114.3457 107.46289 L 156.19336 107.46289 C 159.49489 107.46289 162.41322 109.61359 163.39258 112.76367 L 163.38281 112.77539 L 214.06641 276.2832 C 214.77315 278.57508 214.35913 281.05986 212.93555 282.98828 C 211.52206 284.90648 209.27989 286.04688 206.87695 286.04688 L 179.28516 286.04688 C 175.95335 286.04687 173.01546 283.86624 172.06641 280.67578 L 159.92969 240.18945 L 108.77148 240.18945 L 97.564453 280.52344 C 96.655774 283.77448 93.688937 286.03711 90.306641 286.03711 L 64.347656 286.03711 C 61.954806 286.03711 59.71461 284.90648 58.291016 282.98828 C 56.867422 281.05986 56.442021 278.57475 57.138672 276.29297 L 107.14648 112.79492 C 108.11572 109.62465 111.03407 107.46289 114.3457 107.46289 z M 133.39648 137.70117 L 114.55664 210.03125 L 154.06445 210.03125 L 133.91211 137.70117 L 133.39648 137.70117 z " />
                    <path fill="$(fill);" fill-opacity="$(fill-opacity);" d="M226.882 378.932c28.35 85.716 26.013 84.921 34.254 88.658a14.933 14.933 0 0 0 6.186 1.342c5.706 0 11.16-3.274 13.67-8.809l36.813-81.19z" />
                    <g>
                    <path fill="$(fill);" fill-opacity="$(fill-opacity);" d="M467 121H247.043L210.234 10.268A15 15 0 0 0 196 0H45C20.187 0 0 20.187 0 45v301c0 24.813 20.187 45 45 45h165.297l36.509 110.438c2.017 6.468 7.999 10.566 14.329 10.566.035 0 .07-.004.105-.004h205.761c24.813 0 45-20.187 45-45V166C512 141.187 491.813 121 467 121zM45 361c-8.271 0-15-6.729-15-15V45c0-8.271 6.729-15 15-15h140.179l110.027 331H45zm247.729 30l-29.4 64.841L241.894 391zM482 467c0 8.271-6.729 15-15 15H284.408l45.253-99.806a15.099 15.099 0 0 0 .571-10.932L257.015 151H467c8.271 0 15 6.729 15 15z" />
                    <path fill="$(fill);" fill-opacity="$(fill-opacity);" d="M444.075 241h-45v-15c0-8.284-6.716-15-15-15-8.284 0-15 6.716-15 15v15h-45c-8.284 0-15 6.716-15 15 0 8.284 6.716 15 15 15h87.14c-4.772 14.185-15.02 30.996-26.939 47.174a323.331 323.331 0 0 1-7.547-10.609c-4.659-6.851-13.988-8.628-20.838-3.969-6.85 4.658-8.627 13.988-3.969 20.839 4.208 6.189 8.62 12.211 13.017 17.919-7.496 8.694-14.885 16.57-21.369 22.94-5.913 5.802-6.003 15.299-.2 21.212 5.777 5.889 15.273 6.027 21.211.201.517-.508 8.698-8.566 19.624-20.937 10.663 12.2 18.645 20.218 19.264 20.837 5.855 5.855 15.35 5.858 21.208.002 5.858-5.855 5.861-15.352.007-21.212-.157-.157-9.34-9.392-21.059-23.059 21.233-27.448 34.18-51.357 38.663-71.338h1.786c8.284 0 15-6.716 15-15 0-8.284-6.715-15-14.999-15z" />
                    </g>
                </svg>
                `;

        const svgAppearance = resolveSvgIconAppearance({
          pageLanguageState,
          popupBlueWhenSiteIsTranslated: twpConfig.get("popupBlueWhenSiteIsTranslated"),
          themeColorFieldText,
          themeColorAttention,
          darkMode: false,
          incognito,
        })
        const svg64 = btoa(
          svgXml
            .replace(/\$\(fill\-opacity\)\;/g, svgAppearance.fillOpacity)
            .replace(/\$\(fill\)\;/g, svgAppearance.fillColor)
        );

        const b64Start = "data:image/svg+xml;base64,";
        return b64Start + svg64;
      }

      const runIconEffects = createIconEffectExecutor({
        resetPageAction,
        setPageActionIcon: chrome.pageAction?.setIcon,
        hidePageAction: chrome.pageAction?.hide,
        showPageAction: chrome.pageAction?.show,
        setActionIcon: chrome.action?.setIcon,
      })

      function applyIconUpdate(tabId, incognito = false) {
        runIconEffects(buildIconEffectPlan({
          tabId,
          hasPageAction: !!chrome.pageAction,
          hasAction: !!chrome.action,
          pageActionIconPath: getSVGIcon(incognito),
          actionIconPath: resolveActionIconPath({
            pageLanguageState,
            popupBlueWhenSiteIsTranslated: twpConfig.get("popupBlueWhenSiteIsTranslated"),
          }),
          showButtonInTheAddressBar: twpConfig.get("showButtonInTheAddressBar"),
        }))
      }

      // Update single tab icon
      function updateIcon(tabId) {
        executeQueriedTabIconRefresh(tabId, {
          queryTabs: chrome.tabs.query,
          applyIconUpdate,
        })
      }

      // Update icons in all tabs
      function updateIconInAllTabs() {
        executeAllTabIconRefresh({
          queryTabs: chrome.tabs.query,
          applyIconUpdate,
        })
      }

      // On tab update, refresh icon
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        const iconUpdate = resolveIconUpdateOnTabLoading(changeInfo.status)
        if (iconUpdate) {
          pageLanguageState = iconUpdate.nextPageLanguageState;
          updateIcon(tabId);
        }
      });

      // On tab activation, get language state and update icon
      chrome.tabs.onActivated.addListener((activeInfo) => {
        executeActivatedTabIconRefresh(activeInfo.tabId, {
          setPageLanguageState(nextPageLanguageState) {
            pageLanguageState = nextPageLanguageState;
          },
          applyIconUpdate: updateIcon,
          sendTabMessage: chrome.tabs.sendMessage,
          afterSend: checkedLastError,
        })
      });

      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        const messageUpdate = resolveIconUpdateFromRuntimeMessage(request, sender.tab.id)
        if (messageUpdate) {
          pageLanguageState = messageUpdate.nextPageLanguageState;
          updateIcon(messageUpdate.updateTabId);
        }
      });

      // Listen for icon-related config changes
      twpConfig.onChanged((name, newvalue) => {
        if (shouldRefreshIconsForConfigChange(name)) {
          updateIconInAllTabs();
        }
      });
    }
  }
});

// Listen for keyboard shortcuts
if (typeof chrome.commands !== "undefined") {
  const executeHotkeyEffects = createCommandEffectExecutor({
    setConfig(key, value) {
      twpConfig.set(key, value);
    },
    setTargetLanguage(value) {
      twpConfig.setTargetLanguage(value);
    },
    applyTabEffects: runTabEffects,
  })

  chrome.commands.onCommand.addListener((command) => {
    executeHotkeyCommand(command, {
      currentPageTranslatorService: twpConfig.get("pageTranslatorService"),
      targetLanguages: twpConfig.get("targetLanguages"),
      queryTabs: chrome.tabs.query,
      executeEffects: executeHotkeyEffects,
    })
  });
}

chrome.alarms.onAlarm.addListener(async (alarmInfo) => {
  await executeAutoTranslateAlarm(alarmInfo, {
    getStorage: boundStorageGet,
    applyTabEffects: runTabEffects,
  })
});

// On config ready, register listeners
twpConfig.onReady(async () => {
  // Update context menu
  updateContextMenu();
  // Update translate-selected context menu
  updateTranslateSelectedContextMenu();

  // Listen for context menu config changes
  twpConfig.onChanged((name, newvalue) => {
    // Update translate-selected context menu
    if (name === "showTranslateSelectedContextMenu") {
      updateTranslateSelectedContextMenu();
    }
  });

  if (!twpConfig.get("installDateTime")) {
    twpConfig.set("installDateTime", Date.now());
  }
});

twpConfig.onReady(async () => {
  let activeTabTranslationInfo = {};

  /**
   * Update activeTabTranslationInfo
   * Bound as callback for chrome.tabs.onActivated event
   * @param {*} activeInfo 
   */
  function tabsOnActivated(activeInfo) {
    executeQueriedActiveTabTranslationBootstrap({
      queryTabs: chrome.tabs.query,
      setActiveTabTranslationInfo(nextState) {
        activeTabTranslationInfo = nextState;
      },
      sendTabMessage: chrome.tabs.sendMessage,
      afterSend: checkedLastError,
    });
  }

  let sitesToAutoTranslate = {};

  /**
   * Update sitesToAutoTranslate array when a tab is closed
   * Bound as callback for chrome.tabs.onRemoved event
   * @param {*} tabId 
   */
  function tabsOnRemoved(tabId) {
    sitesToAutoTranslate = buildSitesToAutoTranslateRemoval(sitesToAutoTranslate, tabId)
  }

  /**
   * Update activeTabTranslationInfo on setPageLanguageState message
   * Bound as callback for chrome.runtime.onMessage event
   * @param {*} request 
   * @param {*} sender 
   * @param {*} sendResponse 
   */
  function runtimeOnMessage(request, sender, sendResponse) {
    const update = resolveActiveTabTranslationInfoMessageUpdate(request, sender)
    if (update) {
      activeTabTranslationInfo = update;
    }
  }

  /**
   * Update sitesToAutoTranslate array
   * Bound as callback for chrome.webNavigation.onCommitted event
   * @param {*} details 
   */
  function webNavigationOnCommitted(details) {
    sitesToAutoTranslate = buildSitesToAutoTranslateOnCommitted(
      sitesToAutoTranslate,
      activeTabTranslationInfo,
      details
    )
  }

  /**
   * Notify tab to auto-translate the page after DOMContentLoaded
   * Bound as callback for chrome.webNavigation.onDOMContentLoaded event
   * @param {*} details 
   */
  async function webNavigationOnDOMContentLoaded(details) {
    const result = resolveAutoTranslateOnDOMContentLoaded(sitesToAutoTranslate, details)
    sitesToAutoTranslate = result.nextSitesToAutoTranslate
    await executeAutoTranslateDomEffects(buildAutoTranslateDomExecutionPlan(result), {
      setStorage: boundStorageSet,
      createAlarm: chrome.alarms.create,
    })
  }

  const invokeAutoTranslateListener = createAutoTranslateListenerInvoker({
    listenerApis: {
      "tabs.onActivated": chrome.tabs.onActivated,
      "tabs.onRemoved": chrome.tabs.onRemoved,
      "runtime.onMessage": chrome.runtime.onMessage,
      "webNavigation.onCommitted": chrome.webNavigation?.onCommitted,
      "webNavigation.onDOMContentLoaded": chrome.webNavigation?.onDOMContentLoaded,
    },
    listeners: {
      tabsOnActivated,
      tabsOnRemoved,
      runtimeOnMessage,
      webNavigationOnCommitted,
      webNavigationOnDOMContentLoaded,
    },
  })

  const runAutoTranslateListenerEffects = createAutoTranslateListenerEffectExecutor({
    setActiveTabTranslationInfo(nextState) {
      activeTabTranslationInfo = nextState;
    },
    setSitesToAutoTranslate(nextState) {
      sitesToAutoTranslate = nextState;
    },
    invokeListener: invokeAutoTranslateListener,
    logInfo(message) {
      console.info(message);
    },
  })

  /**
   * Enable auto-translate when following links to the same domain
   * @returns 
   */
  function enableTranslationOnClickingALink() {
    const plan = buildEnableAutoTranslateListenerPlan(!!chrome.webNavigation)
    if (plan.shouldDisableFirst) {
      disableTranslationOnClickingALink();
    }
    if (!plan.shouldProceed) return;

    runAutoTranslateListenerEffects(buildEnableAutoTranslateExecutionPlan(plan));
  }

  /**
   * Disable auto-translate when following links to the same domain
   * @returns 
   */
  function disableTranslationOnClickingALink() {
    const plan = buildDisableAutoTranslateListenerPlan(!!chrome.webNavigation)

    runAutoTranslateListenerEffects(buildDisableAutoTranslateExecutionPlan({
      plan,
      resetState: buildAutoTranslateResetState(),
    }));
  }

  const toggleAutoTranslate = createAutoTranslateToggleInvoker({
    toggles: {
      enable: enableTranslationOnClickingALink,
      disable: disableTranslationOnClickingALink,
    },
  })

  const runAutoTranslateRuntimeEffects = createAutoTranslateRuntimeEffectExecutor({
    toggleAutoTranslate,
    setConfig(key, value) {
      twpConfig.set(key, value);
    },
  })

  // Listen for auto-translate-on-link-click setting changes
  twpConfig.onChanged((name, newvalue) => {
    const action = resolveAutoTranslateConfigChange(name, newvalue)
    runAutoTranslateRuntimeEffects(buildAutoTranslateConfigToggleEffects(action))
  });

  // When the user revokes webNavigation permission (allows listening for onBeforeNavigate/onCommitted/onDOMContentLoaded/onCompleted)
  // disable auto-translate
  chrome.permissions.onRemoved.addListener((permissions) => {
    runAutoTranslateRuntimeEffects(
      buildAutoTranslatePermissionRemovedEffects(
        shouldDisableAutoTranslateForRemovedPermissions(permissions)
      )
    )
  });
  executeAutoTranslatePermissionBootstrap({
    containsPermissions: chrome.permissions.contains,
    autoTranslateWhenClickingALink: twpConfig.get("autoTranslateWhenClickingALink"),
    executeEffects: runAutoTranslateRuntimeEffects,
  });
});

export { };

