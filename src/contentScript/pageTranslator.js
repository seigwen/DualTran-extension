/**
 * Page translation main script
 */

// DONE: When translated text color is not the original (default) color, still show translated text even if it is identical to the original
// DONE: In some cases, parent element height is insufficient. This is because height limits on some ancestor elements were not removed. Now all ancestor element height limits are removed
// DONE: When a text node's parent is a flex element, the translated element does not wrap. Optimized this
// DONE: When parent is inline-flex, child element's style.display becomes block but no new line is actually created. Special handling needed when determining isNewLine
// DONE: https://www.scmp.com/ scrolling issue
// DONE: After changing target language, clicking floatingBtn still used the old language (reason: currentTargetLanguage is a separate variable, not always the same as targetLanguage; fixed)
// DONE: Sometimes the translation result is not the target language but the original text (e.g., when translating a Twitter profile bio, example: https://twitter.com/therealbuni). Reason: text content violates content policies. Solution: have ChatGPT translate all text including policy-violating content.
// DONE: Set options page to large screen display
// DONE: Added OpenAI to full-page translation
// DONE: Added OpenAI to selected-text translation
// DONE: Facebook and ProductHunt re-translate some already-translated nodes. Likely caused by the page itself refreshing nodes. Solution: build a cache
// DONE: In singleTranslation mode, cannot translate "English(US)" text. Removed singleTranslation mode; now always use batchTranslation
// DONE: Selected-text translation popup sometimes fails to appear: the original code only showed the popup after receiving translation results; without VPN, results could never be obtained so the popup never appeared. Fixed.
// DONE: Added Firefox support (changed chrome. to browser.)
// DONE: When translateLongerThan is not 0, it should only apply to standalone elements, not elements embedded in long text. Temporary solution: set translateLongerThan default to 0. Final solution: this issue appears to be resolved

// TODO: In inline replacement translation, if dontSortResults is "no", links and translations may not align. Temporary solution: always set dontSortResults to "yes", disallow modification
// TODO: Custom video controls height set to unlimit causes overlay on video. Should be optimized. Temporary solution: do not set unlimit-height on pages with video elements
// TODO: In some cases, parent element height becomes excessively large. Main cause: when a block parent has multiple inline elements, if any inline element adds a block child (e.g., <translated>), it causes line breaks (example: https://developer.chrome.com/docs/extensions/mv3/getstarted/tut-reading-time/).

// TOOD: When translated text color is not the original (default), if translated color is too similar to the background color, change the translated text color. Reference: https://stackoverflow.com/questions/11867545/change-text-color-based-on-brightness-of-the-covered-background-area
// TODO: Add multi-language support for extension description
// TODO: PDF translation feature

"use strict";

console.log("pageTranslator.js is running")

import twpLang from "../lib/languages.js"
import twpConfig from "../lib/config.js"
import { createProviderRegistry, BUILT_IN_PROVIDERS } from "../lib/ai/providerRegistry.js"
import platformInfo from "../lib/platformInfo.js"

const _providerRegistry = createProviderRegistry(BUILT_IN_PROVIDERS);
import showOriginal from "./showOriginal.js"
import { translateWithAI } from "./fetchSSE.js"
import {
  notifyAiStreamParseError,
  parseOpenAiStyleStreamMessage,
  parseTaggedPageTranslationProgress,
} from "./aiStreamMessage.js"
import {
  applyAiErrorState,
  applyAiSuccessState,
  applyAiTranslatingState,
  applyGoogleIdle,
  applyGoogleSuccess,
  applyGoogleTranslating,
  applyShowGoogleOnlyState,
  ERROR_CROSS_COLOR,
  formatAiTranslationError,
  renderAiErrorIndicator,
  renderAiSuccessIndicator,
  resetBlockState,
} from "./aiUiState.js"
import {
  getFloatingButtonAiTooltipText,
  getFloatingButtonGoogleTooltipText,
} from "./i18n.js"
import Toastify from 'toastify-js'
import { encode } from 'gpt-tokenizer'
import { wordsCount } from "../util/globalWordsCount.js"
import { registerBlock, createSingletonButtonGroup, destroySingletonButtonGroup, attachHoverDelegation, setCallbacks, getProxiesForTranslation, getAllProxies, getBlockState, updateSingletonUI } from "./singletonBtnGroup.js";

/**
 * Convert the dontSortResults config value to a boolean (pure function, for unit testing).
 * @param {string} configValue — return value of twpConfig.get("dontSortResults") ("yes" | "no" | undefined)
 * @returns {boolean}
 */
export function resolveDontSortResults(configValue) {
  return configValue === "yes";
}

/**
 * Determine whether text should trigger AI improvement (pure function, for unit testing).
 * @param {number} wordCount — word count of the text
 * @param {number|string} threshold — aiImproveForLongerThan config value
 * @returns {boolean}
 */
export function shouldTriggerAiImprove(wordCount, threshold) {
  const t = parseInt(threshold);
  // threshold=0 means "always trigger" (consistent with addTranslatedContent behavior in newLine mode)
  if (isNaN(t) || t < 0) return false;
  if (t === 0) return wordCount > 0;
  return wordCount > t;
}

/**
 * Resolve the next value of the AI render state (pure function, for unit testing).
 *
 * Called when the global AI button state needs to be determined based on currently registered blocks' AI states.
 * Special handling for bfcache restore scenarios — AI translations are not cached, so after bfcache restore, dynamic content
 * will be re-translated by Google cache but AI translations are missing. Need to correct stale "success"/"error"
 * states to "idle".
 *
 * @param {string} currentAiRenderState — current AI render state ("idle"|"loading"|"success"|"error")
 * @param {number} translatingCount — number of blocks currently being translated
 * @param {number} toBeTranslatedCount — number of blocks waiting to be translated
 * @param {number} totalBlockCount — total number of blocks
 * @returns {string|null} — new state, or null to keep current state unchanged
 */
export function resolveNextAiRenderState(currentAiRenderState, translatingCount, toBeTranslatedCount, totalBlockCount) {
  if (translatingCount > 0) {
    return "loading";
  }
  if (totalBlockCount > 0 && toBeTranslatedCount === 0) {
    return "success";
  }
  if (toBeTranslatedCount > 0 && translatingCount === 0) {
     // There are blocks waiting to be translated but none are currently being translated.
     // If current state is success/error, it indicates a stale state from bfcache restore or similar scenario
     // — AI translations are not cached, dynamic content added new <translated> nodes via Google cache translation,
     // but these nodes have not yet been AI-translated. Correct the state to idle.
    if (currentAiRenderState === "success" || currentAiRenderState === "error") {
      return "idle";
    }
  }
  return null;
}

let singletonInitialized = false;
function ensureSingletonInit() {
  if (window.self !== window.top) return;
  createSingletonButtonGroup();
  attachHoverDelegation();
  setCallbacks({
    onGoogleClick: handleSingletonGoogleClick,
    onAiClick: handleSingletonAiClick,
  });
  singletonInitialized = true;
}

let hasVideoInPage = false
const translationInterval = 600 // Under normal conditions, send a translation request every translationInterval ms
const aiTranslationInterval = 2500 // Under normal conditions, send an AI translation request every aiTranslationInterval ms
const openAiRateLimitWaitingTime = 10 * 1000 // When an AI translation API error occurs, wait openAiRateLimitWaitingTime ms before resuming AI translation requests.
export const abortControllers = []
export const aiCache = []

// ── Hover-button handler state (MUST stay at module top level) ───────────────
// handleSingletonGoogleClick / handleSingletonAiClick are module-level functions
// registered via setCallbacks(); they reference these. If these were scoped inside
// the Promise.all(...).then() callback below, clicking the hover buttons would
// throw ReferenceError (silently swallowed by try/catch → "no response").
let currentTargetLanguage = "";
let nodesToRestore = [];
/* mili-seconds to wait for next openAI request after translation error happened. 
* initial value should be 0 so that translation can be started as soon as page is loaded.
*/
let openAiRateLimitCountDown = 0
let timerAiTran
let hadGoogleTranslationError = false
let shouldForceAiAfterPageTranslation = false

// ── AI translation state persistence (sessionStorage) ──────────────────────────
// Used to restore AI translation state after Turbo/pjax navigation.
// Sites like GitHub use Turbo Drive for SPA navigation and set turbo-cache-control=no-cache,
// causing Turbo to re-fetch the page from the server (not from cache) when the back button is clicked,
// so the new page's DOM contains no translations. Mutation Observer automatically re-translates Google translations,
     // Silently degrade when sessionStorage is unavailable
// By recording a "this URL was AI-translated" marker in sessionStorage,
// restore shouldForceAiAfterPageTranslation on popstate / pageshow, so AI translation is automatically re-triggered.
const AI_APPLIED_KEY_PREFIX = "dualtran:aiApplied:";

/** Get the sessionStorage key name for the current page URL */
function getAiAppliedStorageKey() {
  return AI_APPLIED_KEY_PREFIX + location.origin + location.pathname;
}

/** Mark the current page as having been AI-translated (called after AI translation is successfully applied) */
function saveAiAppliedFlag() {
  try {
    sessionStorage.setItem(getAiAppliedStorageKey(), "true");
  } catch (_) {
     // Silently degrade when sessionStorage is unavailable
  }
}

/** Check whether the current page was previously AI-translated, without consuming the marker */
function checkAiAppliedFlag() {
  try {
    return sessionStorage.getItem(getAiAppliedStorageKey()) === "true";
  } catch (_) {
    return false;
  }
}

/** Clear the AI translation marker for the current page (called when user clicks "Restore original") */
function removeAiAppliedFlag() {
  try {
    sessionStorage.removeItem(getAiAppliedStorageKey());
  } catch (_) {
  }
}

function hasCustomTranslatedColor() {
  return !(["", "rgba(0, 0, 0, 1)", undefined, null].includes(twpConfig.get("translatedColor")))
}

function applyTranslatedColorToNode(node) {
  if (!hasCustomTranslatedColor() || !node?.style) {
    return
  }
  node.style.color = twpConfig.get("translatedColor")
}

/**
 * In newLine mode, apply AI translation color to the <translated> element containing translatedTextNode.
 * In replaceOriginal mode, skip (use original text color).
 * @param {object} btnAi - BtnAiProxy or similar object, must have translatedTextNode property
 * @param {string} aiColor - AI translation color value
 */
/**
 * After AI translation succeeds in replaceOriginal mode, register the visible
 * AI-translated element with showOriginal so hovering it pops up the original text.
 *
 * In replaceOriginal mode, Google-translated <font> elements are hidden when AI
 * takes over (nodesToClear). The AI text lives in translatedTextNode (a plain
 * <span>), which was never registered with showOriginal — causing "hover to show
 * original" to silently fail on AI-translated blocks.
 *
 * In newLine (dual-span) mode, the parent <translated> element is already
 * registered, so this helper is a no-op.
 */
function _registerAiForShowOriginal(btnAi) {
  if (!showOriginal.isEnabled) return;
  // In newLine (dual-span) mode, aiSpan exists and the <translated> parent is
  // already registered — nothing to do.
  if (btnAi.aiSpan) return;
  // replaceOriginal mode: register the AI text element with the source string.
  const el = btnAi.translatedTextNode;
  if (el) {
    showOriginal.add(el, btnAi.sourceString);
  }
}

function _applyAiColorToTranslatedElement(btnAi, aiColor) {
  try {
    if (!aiColor || ["", "rgba(0, 0, 0, 1)", undefined, null].includes(aiColor)) return;
    // Dual-span mode: apply AI color to aiSpan directly
    if (btnAi?.aiSpan) {
      btnAi.aiSpan.style.color = aiColor;
      return;
    }
    const ttn = btnAi?.translatedTextNode;
    if (!ttn) return;
     // Do not apply AI color in replaceOriginal mode (use original text color)
     // Distinguish modes by checking whether nodesToClear exists: in newLine mode nodesToClear is null
    const blockState = btnAi?._st ? btnAi._st() : null;
    if (blockState && Array.isArray(blockState.nodesToClear) && blockState.nodesToClear.length > 0) return;
     // Walk up to find <translated> element and set AI translation color
    let target = ttn.nodeType === 3 ? ttn.parentNode : ttn;
    while (target && target !== document.body) {
      if (target.nodeName?.toLowerCase() === "translated") {
        target.style.color = aiColor;
        return;
      }
      target = target.parentElement || target.parentNode;
    }
  } catch (_) {}
}

/**
 * Check whether the currently selected AI provider has a non-empty API key configured.
 * Used to gate auto-improve so that providers other than OpenAI are not blocked.
 * @returns {boolean}
 */
function hasActiveProviderApiKey() {
  const providerId = twpConfig.get("aiProvider") || "openai";
  const providerDef = _providerRegistry.getProvider(providerId);

  // Check migrated providerConfigs first
  const providerConfigs = twpConfig.get("providerConfigs") || {};
  const providerConfig = providerConfigs[providerId];
  if (providerConfig?.apiKey) {
    return true;
  }

  // Legacy fallback — maps old config keys
  const legacyKeyMap = {
    openai: "apiKeyOpenAI",
    "google-gemini": "apiKeyGoogleGemini",
    anthropic: "apiKeyAnthropic",
    "azure-openai": "apiKeyAzureOpenAI",
    deepseek: "apiKeyDeepSeek",
    grok: "apiKeyGrok",
    openrouter: "apiKeyOpenRouter",
  };

  const legacyKey = legacyKeyMap[providerId] || "apiKeyOpenAI";
  return !!twpConfig.get(legacyKey);
}

/**
 * Get the current model name for the specified provider (three-tier lookup).
 *
 * Tier 1: Dedicated config key (only 7 major providers have these):
 *   openai→openAiModel, anthropic→anthropicModel, google-gemini→googleGeminiModel,
 *   azure-openai→azureOpenAIModel, deepseek→deepSeekModel, grok→grokModel,
 *   openrouter→openRouterModel
 *
 * Tier 2: providerConfigs generic storage (works for all providers, especially models.dev dynamically registered ones):
 *   twpConfig.get("providerConfigs")?.[providerId]?.model
 *
 * Tier 3: Hardcoded fallback (for known providers when the above two tiers are not set)
 *
 * @param {string} providerId — e.g. "openai", "anthropic", "zhipu"
 * @returns {string} — model name, or "" if unresolvable
 */
function getModelForProvider(providerId) {
  const DEDICATED_KEYS = {
    "openai":        "openAiModel",
    "anthropic":     "anthropicModel",
    "google-gemini": "googleGeminiModel",
    "azure-openai":  "azureOpenAIModel",
    "deepseek":      "deepSeekModel",
    "grok":          "grokModel",
    "openrouter":    "openRouterModel",
  };
  const dedicatedKey = DEDICATED_KEYS[providerId];
  if (dedicatedKey) {
    const model = twpConfig.get(dedicatedKey);
    if (model) return model;
  }

  const providerConfigs = twpConfig.get("providerConfigs") || {};
  const providerConfig = providerConfigs[providerId];
  if (providerConfig?.model) return providerConfig.model;

  const FALLBACK_MODELS = {
    "openai":        "gpt-4o-mini",
    "anthropic":     "claude-haiku-3-5-20241022",
    "google-gemini": "gemini-2.5-flash",
    "deepseek":      "deepseek-chat",
    "grok":          "grok-3-mini",
    "openrouter":    "openai/gpt-4o-mini",
    "azure-openai":  "gpt-4o-mini",
  };
  return FALLBACK_MODELS[providerId] || "";
}

/**
 * Build urlWithoutParams for cache key.
 * @returns {string}
 */
function getCacheUrlKey() {
  return location.origin + location.pathname;
}

/**
 * Try to read AI translation from persistent cache.
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} originalText
 * @returns {Promise<string|null>} cached translated text or null
 */
async function getCachedAiTranslation(sourceLanguage, targetLanguage, providerId, modelId, originalText) {
  if (twpConfig.get("enableAiTranslationCache") !== "yes") return null;
  try {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: "aiTranslationCacheGet",
        sourceLanguage,
        targetLanguage,
        providerId,
        modelId,
        urlWithoutParams: getCacheUrlKey(),
        originalText,
      }, (result) => {
        resolve(result?.translated || null);
      });
    });
  } catch (_) {
    return null;
  }
}

/**
 * Store AI translation in persistent cache (fire-and-forget).
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} originalText
 * @param {string} translatedText
 */
function setCachedAiTranslation(sourceLanguage, targetLanguage, providerId, modelId, originalText, translatedText) {
  if (twpConfig.get("enableAiTranslationCache") !== "yes") return;
  try {
    chrome.runtime.sendMessage({
      action: "aiTranslationCacheSet",
      sourceLanguage,
      targetLanguage,
      providerId,
      modelId,
      urlWithoutParams: getCacheUrlKey(),
      originalText,
      translatedText,
    });
  } catch (_) {
    // Best-effort; don't block on cache write failures
  }
}

/**
 * Determine whether to skip AI auto-translation (pure decision function, no side effects, for unit testing).
 * @param {boolean} hasApiKey — whether the current provider has an API key configured
 * @param {number} rateLimitCountdown — rate limit cooldown countdown (milliseconds)
 * @param {boolean} shouldForce — shouldForceAiAfterPageTranslation flag
 * @returns {boolean} true = skip AI translation, false = proceed with AI translation
 */
function _shouldSkipAiTranslation(hasApiKey, rateLimitCountdown, shouldForce) {
  return rateLimitCountdown > 0 || !shouldForce || !hasApiKey;
}

function promptToConfigureAiProvider() {
  const confirmMessage = chrome.i18n.getMessage("confirmSetApiKeyNow") || "API key is not set. Do you want to set it now?"

  if (!window.confirm(confirmMessage)) {
    return
  }

  chrome.runtime?.sendMessage?.({
    action: "openOptionsPage",
    hash: "#ai",
  })
}

function resetAiButtonToIdle(btnAi) {
  if (!btnAi) return

  btnAi.translationStatus = undefined
  btnAi.classList?.remove?.("dualtran-hide")
  btnAi.classList?.remove?.("dualtran-ai-loading", "dualtran-ai-success", "dualtran-ai-error")

  if (btnAi.btnAiTxtNode) {
    btnAi.btnAiTxtNode.textContent = "AI"
  }
  if (btnAi.tooltip) {
    btnAi.tooltip.textContent = getFloatingButtonAiTooltipText()
    btnAi.tooltip.style.color = ""
  }
  if (btnAi.style) {
    btnAi.style.color = ""
  }
  if (typeof btnAi.setAttribute === "function") {
    try {
      btnAi.setAttribute("title", getFloatingButtonAiTooltipText())
    } catch (_) {
    }
  }
  try {
    if (btnAi.translatedTextNode?.classList) {
      btnAi.translatedTextNode.classList.remove("dualtran-loading")
    }
  } catch (_) {
  }
}

// ── Singleton button group click handlers ─────────────────────

/**
 * Restore per-block original text. Used by both hover-button handlers.
 * replaceOriginal mode: nodesToClear get originalText from nodesToRestore, AI span cleared.
 * newLine mode: the <translated> element is hidden (original text stays visible above).
 * Resets aiStatus/translationId/googleBtnState; displayMode becomes "original".
 */
function restoreBlockOriginal(state, translatedElement) {
  if (!state) return;
  if (state.nodesToClear && Array.isArray(state.nodesToClear)) {
    state.nodesToClear.forEach((n) => {
      try {
        const restored = nodesToRestore.find((r) => r && r.node === n);
        if (restored) {
          if (n.nodeType === 3) {
            n.textContent = restored.originalText;
            const parent = n.parentNode;
            if (parent && parent.nodeType === 1 && parent.style && parent.style.display === "none") {
              parent.style.display = "";
            }
          } else if (n.nodeType === 1) {
            n.style.display = "";
            n.textContent = restored.originalText;
          }
        }
      } catch (_) {}
    });
  }
  // Clear AI span in replaceOriginal mode
  if (state.translatedTextNode && !state.googleSpan) {
    try { state.translatedTextNode.textContent = ""; } catch (_) {}
    try { state.translatedTextNode.style.display = ""; } catch (_) {}
  }
  // newLine mode: hide the whole <translated> element
  if (state.googleSpan && translatedElement && translatedElement.style) {
    try {
      translatedElement.style.display = "none";
      state.googleSpan.style.display = "none";
      if (state.aiSpan) state.aiSpan.style.display = "none";
    } catch (_) {}
  }
  resetBlockState(state);
  try { updateSingletonUI(translatedElement); } catch (_) {}
}

/**
 * Show Google-only view for one block.
 * newLine: unhide <translated>, show googleSpan, hide aiSpan.
 * replaceOriginal: write Google text into nodesToClear (from googleTranslatedText
 * or nodesToRestore[].translatedText), hide AI span (text preserved for re-show).
 */
function showBlockGoogleOnly(state, translatedElement) {
  if (!state) return;
  if (state.googleSpan) {
    // newLine dual-span
    if (translatedElement && translatedElement.style) {
      try { translatedElement.style.display = "block"; } catch (_) {}
    }
    state.googleSpan.style.display = "block";
    if (state.aiSpan) state.aiSpan.style.display = "none";
  } else {
    // replaceOriginal: restore Google text into text nodes
    if (state.nodesToClear && Array.isArray(state.nodesToClear)) {
      if (typeof state.googleTranslatedText === "string" && state.googleTranslatedText) {
        state.nodesToClear.forEach((n, idx) => {
          try {
            if (n.nodeType === 3) {
              n.textContent = idx === 0 ? state.googleTranslatedText : "";
              const parent = n.parentNode;
              if (parent && parent.nodeType === 1 && parent.style && parent.style.display === "none") {
                parent.style.display = "";
              }
            } else if (n.nodeType === 1) {
              n.style.display = idx === 0 ? "" : "none";
              n.textContent = idx === 0 ? state.googleTranslatedText : "";
            }
          } catch (_) {}
        });
      } else {
        state.nodesToClear.forEach((n) => {
          try {
            const restored = nodesToRestore.find((r) => r && r.node === n);
            if (restored) {
              if (n.nodeType === 3) {
                n.textContent = restored.translatedText;
                const parent = n.parentNode;
                if (parent && parent.nodeType === 1 && parent.style && parent.style.display === "none") {
                  parent.style.display = "";
                }
              } else if (n.nodeType === 1) {
                n.style.display = "";
                n.textContent = restored.translatedText;
              }
            }
          } catch (_) {}
        });
      }
    }
    // Hide AI span but PRESERVE its text so clicking AI again can re-show it
    if (state.translatedTextNode) {
      try { state.translatedTextNode.style.display = "none"; } catch (_) {}
    }
  }
  applyGoogleSuccess(state);
  // "userPinned": the user explicitly chose Google-only for this block.
  // Renders the singleton AI button in its initial (pre-AI) look, AND keeps
  // the block out of getProxiesForTranslation() so the periodic
  // aiTranslateDynamically() loop does NOT re-translate it with AI.
  state.aiStatus = "userPinned";
  state.translationId = "";
  state.errorMessage = undefined;
  try { updateSingletonUI(translatedElement); } catch (_) {}
}

/**
 * Write a freshly obtained Google translation into the block (both modes).
 */
function writeGoogleIntoBlock(state, result, translatedElement) {
  if (state.googleSpan) {
    // newLine: write into googleSpan and show it
    if (translatedElement && translatedElement.style) {
      try { translatedElement.style.display = "block"; } catch (_) {}
    }
    state.googleSpan.textContent = result;
    state.googleSpan.style.display = "block";
    if (state.aiSpan) state.aiSpan.style.display = "none";
  } else {
    // replaceOriginal: first text node gets the result, others cleared
    if (state.nodesToClear && Array.isArray(state.nodesToClear)) {
      state.nodesToClear.forEach((n, idx) => {
        try {
          if (n.nodeType === 3) {
            n.textContent = idx === 0 ? result : "";
            const parent = n.parentNode;
            if (parent && parent.nodeType === 1 && parent.style && parent.style.display === "none") {
              parent.style.display = "";
            }
          } else if (n.nodeType === 1) {
            n.style.display = idx === 0 ? "" : "none";
            n.textContent = idx === 0 ? result : "";
          }
        } catch (_) {}
      });
    }
  }
}

async function handleSingletonGoogleClick(translatedElement) {
  const state = getBlockState(translatedElement);
  if (!state) return;

  // Legacy state fallback: blocks registered before displayMode existed
  const displayMode = state.displayMode ||
    (state.aiStatus === "translated" ? "ai" : "google");

  if (displayMode === "google") {
    // Behavior 1 second click: restore original
    restoreBlockOriginal(state, translatedElement);
    return;
  }
  if (displayMode === "ai") {
    // Behavior 4 second step: show Google only (no network)
    showBlockGoogleOnly(state, translatedElement);
    return;
  }
  // displayMode === "original": behavior 1 first click — Google-only translation
  applyGoogleTranslating(state);
  try {
    const result = await backgroundTranslateSingleText(
      "google", currentTargetLanguage, state.sourceString
    );
    if (result) {
      state.googleTranslatedText = result;
      writeGoogleIntoBlock(state, result, translatedElement);
      applyGoogleSuccess(state);
    } else {
      applyGoogleIdle(state);
    }
  } catch (_) {
    applyGoogleIdle(state);
  }
  try { updateSingletonUI(translatedElement); } catch (_) {}
}

async function handleSingletonAiClick(translatedElement) {
  const state = getBlockState(translatedElement);
  if (!state) return;

  // Legacy state fallback: blocks registered before displayMode existed
  const displayMode = state.displayMode ||
    (state.aiStatus === "translated" ? "ai" : "google");

  if (displayMode === "ai") {
    // Behavior 3 second click: restore original
    restoreBlockOriginal(state, translatedElement);
    return;
  }

  if (!hasActiveProviderApiKey()) {
    promptToConfigureAiProvider();
    return;
  }

  if (displayMode === "google") {
    if (state.aiStatus === "translated") {
      // Behavior 4 last step: re-show AI without re-translating
      if (state.googleSpan) {
        // newLine: toggle spans
        state.googleSpan.style.display = "none";
        if (state.aiSpan) state.aiSpan.style.display = "block";
      } else {
        // replaceOriginal: clear text nodes, re-show AI span (text preserved)
        if (state.nodesToClear && Array.isArray(state.nodesToClear)) {
          state.nodesToClear.forEach((n) => {
            try {
              if (n.nodeType === 3) {
                n.textContent = "";
                const parent = n.parentNode;
                if (parent && parent.nodeType === 1 && parent.style && parent.style.display === "none") {
                  parent.style.display = "";
                }
              } else if (n.nodeType === 1) {
                n.style.display = "none";
              }
            } catch (_) {}
          });
        }
        if (state.translatedTextNode) {
          try { state.translatedTextNode.style.display = ""; } catch (_) {}
        }
      }
      state.displayMode = "ai";
      try { updateSingletonUI(translatedElement); } catch (_) {}
      return;
    }
    // Behavior 2: run AI on top of Google
    state.aiStatus = "translating";
    state.errorMessage = undefined;
    try {
      const proxy = {
        _st: () => state,
        get sourceString() { return state.sourceString; },
        get translatedTextNode() { return state.translatedTextNode; },
        get googleSpan() { return state.googleSpan || null; },
        get aiSpan() { return state.aiSpan || null; },
        get translationId() { return state.translationId; },
        set translationId(v) { state.translationId = v; },
        get translationStatus() { return state.aiStatus; },
        set translationStatus(v) { state.aiStatus = v; },
        get btnAiTxtNode() { return document.createElement("span"); },
        get tooltip() { return document.createElement("span"); },
        get classList() { return { contains: () => false, add: () => {}, remove: () => {} }; },
        get style() { let _c = ""; return { set color(v) { _c = v; }, get color() { return _c; } }; },
        get ownerDocument() { return document; },
        setAttribute: () => {},
      };
      await aiTranslateText([proxy], false);
      if (state.aiStatus === "translated") {
        state.displayMode = "ai";
      } else if (state.aiStatus === "translationError") {
        // Fall back: keep Google visible
        state.displayMode = state.googleBtnState === "success" || state.googleTranslatedText ? "google" : "original";
      }
    } catch (e) {
      state.aiStatus = "translationError";
      state.errorMessage = e?.message || "AI translation error";
    }
    try { updateSingletonUI(translatedElement); } catch (_) {}
    return;
  }

  // displayMode === "original": behavior 3 — Google+AI concurrently, final display AI
  applyGoogleTranslating(state);
  backgroundTranslateSingleText("google", currentTargetLanguage, state.sourceString)
    .then((result) => {
      if (result) {
        state.googleTranslatedText = result;
        state.googleBtnState = "success";
        // Write into googleSpan unconditionally (text needed for later "show Google only");
        // visibility toggle only if AI hasn't taken over the display yet
        if (state.googleSpan) {
          try { state.googleSpan.textContent = result; } catch (_) {}
        }
        if (state.displayMode === "original") {
          writeGoogleIntoBlock(state, result, translatedElement);
          state.displayMode = "google";
          try { updateSingletonUI(translatedElement); } catch (_) {}
        }
      } else {
        applyGoogleIdle(state);
      }
    })
    .catch(() => { applyGoogleIdle(state); });

  state.aiStatus = "translating";
  state.errorMessage = undefined;
  try {
    const proxy = {
      _st: () => state,
      get sourceString() { return state.sourceString; },
      get translatedTextNode() { return state.translatedTextNode; },
      get googleSpan() { return state.googleSpan || null; },
      get aiSpan() { return state.aiSpan || null; },
      get translationId() { return state.translationId; },
      set translationId(v) { state.translationId = v; },
      get translationStatus() { return state.aiStatus; },
      set translationStatus(v) { state.aiStatus = v; },
      get btnAiTxtNode() { return document.createElement("span"); },
      get tooltip() { return document.createElement("span"); },
      get classList() { return { contains: () => false, add: () => {}, remove: () => {} }; },
      get style() { let _c = ""; return { set color(v) { _c = v; }, get color() { return _c; } }; },
      get ownerDocument() { return document; },
      setAttribute: () => {},
    };
    await aiTranslateText([proxy], false);
    if (state.aiStatus === "translated") {
      state.displayMode = "ai";
    } else if (state.aiStatus === "translationError") {
      state.displayMode = state.googleBtnState === "success" || state.googleTranslatedText ? "google" : "original";
    }
  } catch (e) {
    state.aiStatus = "translationError";
    state.errorMessage = e?.message || "AI translation error";
  }
  try { updateSingletonUI(translatedElement); } catch (_) {}
}

/**
 * @typedef {HTMLSpanElement & {
 *  btnAiTxtNode?: HTMLElement,
 *  tooltip?: HTMLElement,
 *  sourceString?: string,
 *  translatedTextNode?: Node,
 *  translationStatus?: "queuing"|"translating"|"translated"|"translationError",
 *  translationId?: string,
 * }} DualtranAiBtn
 */

/**
 * translate the element list with AI
 * @param {Array<any>} toBeTranslated 
 * @returns 
 */
// Pre-declare AI render state (for use by onError/onFinished)
let aiRenderState = "idle";
const aiRenderStateObservers = [];
function setAiRenderState(state) {
  if (aiRenderState !== state) {
    aiRenderState = state;
    aiRenderStateObservers.forEach((cb) => cb(state));
  }
}

let aiTranslateText = async (toBeTranslated, showToastForError = true)=>{
  if (!hasActiveProviderApiKey()) {
    toBeTranslated.forEach((btnAi) => resetAiButtonToIdle(btnAi))
    promptToConfigureAiProvider()
    return false
  }

  // Detect context and choose the correct target language for AI
  const isSelectedPanel = Array.isArray(toBeTranslated) && toBeTranslated.some(btn => {
    try { return btn?.classList?.contains('dualtran-ai-selected-btn') } catch { return false }
  })
  const targetLanguageCodeForAI = isSelectedPanel
    ? (twpConfig.get("targetLanguageTextTranslation") || twpConfig.get("targetLanguage"))
    : twpConfig.get("targetLanguage")
  let contentSequence = ""
  for (let i = 0; i < toBeTranslated.length; i++) {
  let btnAi = toBeTranslated[i]
  // 1. Check in-memory cache first (fast path)
  let cacheItem = aiCache.find(item => btnAi.sourceString === item.original && item.targetLanguage === targetLanguageCodeForAI)
    if (cacheItem) {
      applyAiSuccessState(btnAi, {
        translatedText: cacheItem.translated || "",
        translatedTextColor: twpConfig.get("aiTranslatedColor"),
        tooltipText: "Translated, click to translate again",
        titleText: null,
      })
       // newLine mode: ensure AI translation color overrides Google translation color
      _applyAiColorToTranslatedElement(btnAi, twpConfig.get("aiTranslatedColor"));
      _registerAiForShowOriginal(btnAi);
       // After page-level AI translation succeeds, mark this URL as AI-translated in sessionStorage,
       // so AI translation state is automatically restored on Turbo/pjax navigation back
      if (!isSelectedPanel) saveAiAppliedFlag();
      continue
    }

    // 2. Check persistent AI cache (IndexedDB, via SW).
    //    Source language defaults to "und" (same convention as Google cache).
    const providerId = twpConfig.get("aiProvider") || "openai";
    const modelId = getModelForProvider(providerId);
    const cached = await getCachedAiTranslation(
      "und", targetLanguageCodeForAI,
      providerId, modelId, btnAi.sourceString
    );
    if (cached) {
      applyAiSuccessState(btnAi, {
        translatedText: cached,
        translatedTextColor: twpConfig.get("aiTranslatedColor"),
        tooltipText: "Translated (cached), click to translate again",
        titleText: null,
      });
       // newLine mode: ensure AI translation color overrides Google translation color
      _applyAiColorToTranslatedElement(btnAi, twpConfig.get("aiTranslatedColor"));
      _registerAiForShowOriginal(btnAi);
       // After page-level AI translation succeeds (persistent cache hit), mark this URL in sessionStorage
      if (!isSelectedPanel) saveAiAppliedFlag();
      // Populate in-memory cache for subsequent lookups
      aiCache.push({
        original: btnAi.sourceString,
        targetLanguage: targetLanguageCodeForAI,
        translated: cached,
      });
      continue;
    }

    // 3. No cache hit — queue for API translation
    btnAi.translationId = "i" + Math.random().toString().substring(2, 10)
    btnAi.translationStatus = "queuing"
     // Clear previous error message (if any) to prevent stale errors after successful retry
    try { const st = btnAi._st(); if (st) st.errorMessage = undefined; } catch (_) {}
    btnAi.btnAiTxtNode.textContent = "queuing"
    btnAi.tooltip.textContent = "This text will be translated by AI soon"
    contentSequence = contentSequence + `<译泽 id="${btnAi.translationId}">${btnAi.sourceString}</译泽>`
  }
  console.log("contentSequence:", contentSequence)

   // contentSequence is empty → all cache hits, no API request needed
  if (!(contentSequence.trim().length)) {
    console.log("contentSequence is empty (all cache hits)")
    return true
  }

  let accumulatedText = ""
   // Parse the response
  let onMessage = (msg) => {
    console.log(11111, 'received message', msg)

    const parsedChunk = parseOpenAiStyleStreamMessage(msg)
    if (parsedChunk.kind === "empty" || parsedChunk.kind === "done") {
      if (parsedChunk.kind === "done") {
        console.log("AI stream completion marker received")
      }
      return
    }

    if (accumulatedText === "") {
      chrome.runtime.sendMessage({
        action: "recordNewRequestToOpenAI",
        result: "successful",
        timeStamp: Date.now()
      })
    }
    if (parsedChunk.kind === "parse-error") {
      console.log("Response parsing error 1", parsedChunk.error)
      notifyAiStreamParseError({
        error: parsedChunk.error,
        controller,
        onError,
      })
      return
    }

    if (parsedChunk.kind === "no-result") {
      console.log(33333, 'No result')
      return { error: 'No result' }
    }
    if (parsedChunk.kind === "finished") {
      console.log(4444444, parsedChunk.finishReason)
      return
    }

    if (parsedChunk.kind !== "delta") {
      return
    }

    let targetTxt = ''
    targetTxt = parsedChunk.text
    console.log("targetTxt:", targetTxt)

    if ([undefined, null, ""].includes(targetTxt)) {
      return
    }
    accumulatedText = accumulatedText + targetTxt
    console.log("accumulatedText:", accumulatedText)

    // Process all complete translation blocks from accumulatedText.
    // The AI may return multiple blocks in a single stream chunk, so we
    // loop until no more complete blocks can be extracted.
    while (true) {
      // Trim leading whitespace that AI may insert between XML blocks
      // (e.g. newlines). The regex in parseTaggedPageTranslationProgress
       // expects the text to start with "<译泽".
      accumulatedText = accumulatedText.trimStart()

       // Some AI models (e.g., DeepSeek R1/V4) may output reasoning text or explanatory content
       // before the translation XML. Detect and discard everything before the first <译泽 tag here,
       // ensuring parseTaggedPageTranslationProgress can correctly identify XML blocks.
      if (accumulatedText && !accumulatedText.startsWith("<译泽")) {
        const firstTagIndex = accumulatedText.indexOf("<译泽")
        if (firstTagIndex > 0) {
          console.log("[AI-STATE] stripping preamble before first <译泽> tag:",
            accumulatedText.substring(0, firstTagIndex).trim().substring(0, 100))
          accumulatedText = accumulatedText.substring(firstTagIndex)
        }
      }

      if (!accumulatedText) {
        break
      }
      const progress = parseTaggedPageTranslationProgress(accumulatedText)
      if (!progress) {
        break
      }
      let btnAi
      try {
        let translationId = progress.translationId
        console.log("translationId:", translationId)
        console.log("translatedText:", progress.translatedText)

         // Replace original translation with AI translation
        btnAi = toBeTranslated.find(btnAi => btnAi.translationId === translationId)
        if (!btnAi) {
           // Translation block no longer exists in DOM (may have been removed during translation),
           // skip current block and continue processing remaining translations to avoid losing all remaining paragraphs.
          console.log("btnAi not found, skipping this block:", translationId)
          if (progress.remainingAccumulatedText !== null) {
            accumulatedText = progress.remainingAccumulatedText
            continue
          }
          break
        }
        console.log("btnAi:", btnAi)
        applyAiTranslatingState(btnAi, {
          translatedText: progress.translatedText,
          translatedTextColor: twpConfig.get("aiTranslatedColor"),
        })
         // newLine mode: ensure AI translation color overrides Google translation color
        _applyAiColorToTranslatedElement(btnAi, twpConfig.get("aiTranslatedColor"));

        console.log("indexOfCloseTag:", progress.remainingAccumulatedText === null ? -1 : 0)

        if (progress.remainingAccumulatedText !== null) {
          accumulatedText = progress.remainingAccumulatedText
          console.log("accumulatedText is changed to:", accumulatedText)
          applyAiSuccessState(btnAi, {
            translatedTextColor: twpConfig.get("aiTranslatedColor"),
            tooltipText: "translated, click to translate again",
            titleText: null,
          })
           // newLine mode: ensure AI translation color overrides Google translation color
          _applyAiColorToTranslatedElement(btnAi, twpConfig.get("aiTranslatedColor"));
          _registerAiForShowOriginal(btnAi);
           // After page-level AI translation succeeds (streaming response complete), mark this URL in sessionStorage
          if (!isSelectedPanel) saveAiAppliedFlag();
           // replaceOriginal mode: AI translation start already hid original text nodes via display:none,
           // just keep them hidden here (nodes were already hidden in applyAiTranslatingState)
          // In-memory cache write.
          // Dual-span mode: AI text lives in aiSpan (translatedTextNode is googleSpan),
          // so read the AI text from aiSpan when present.
          const aiTextForCache = btnAi.aiSpan
            ? btnAi.aiSpan.textContent
            : (btnAi.translatedTextNode ? btnAi.translatedTextNode.textContent : "");
          aiCache.push({
            original: btnAi.sourceString,
            targetLanguage: targetLanguageCodeForAI,
            translated: aiTextForCache
          })
          // Persistent cache write (fire-and-forget, sourceLanguage defaults to "und")
          setCachedAiTranslation(
            "und", targetLanguageCodeForAI,
            twpConfig.get("aiProvider") || "openai",
            getModelForProvider(twpConfig.get("aiProvider") || "openai"),
            btnAi.sourceString,
            aiTextForCache
          );
          // Continue loop — there may be more blocks in the remainder.
        } else {
          // Incomplete block, wait for more stream data.
          break
        }

      } catch (e) {
        console.log("Response parsing error 2", e)
        break
      }
    }
  }
  let onError = (err) => {
    console.log("[AI-STATE] onError fired, calling setAiRenderState(error)")
    setAiRenderState("error")

    chrome.runtime.sendMessage({
      action: "recordNewRequestToOpenAI",
      result: "failed",
      timeStamp: Date.now()
    })

    openAiRateLimitCountDown = openAiRateLimitWaitingTime // Wait

     // Unified error message: if timeout, show "server response timeout"; otherwise show both code and message (if present)
    const errTxt = formatAiTranslationError(err)
    console.log(999999, err)
    // Toastify({
    //   text: errTxt,
    //   duration: 5000,
    //   newWindow: true,
    //   close: true,
    //   gravity: "top", // `top` or `bottom`
    //   position: "left", // `left`, `center` or `right`
    //   stopOnFocus: true, // Prevents dismissing of toast on hover
    //   style: {
    //     background: "linear-gradient(to bottom, red, darkred)",
    //     fontSize: "12px"
    //   },
    //   onClick: function () { } // Callback after click
    // }).showToast();

    toBeTranslated
      .filter(btnAi => btnAi.translationStatus != "translated")
      .map(btnAi => {
         // Persist error info to blockState for updateSingletonUI to restore tooltip on hover
        try { const st = btnAi._st(); if (st) st.errorMessage = errTxt; } catch (_) {}
        applyAiErrorState(btnAi, {
          errorText: errTxt,
          translatedText: btnAi.classList && btnAi.classList.contains('dualtran-ai-selected-btn') ? errTxt : undefined,
          tooltipColor: "red",
          titleText: null,
        })
      })

    if(showToastForError){
      Toastify({
        text: errTxt,
        duration: 5000,
        newWindow: true,
        close: true,
        gravity: "top", // `top` or `bottom`
        position: "left", // `left`, `center` or `right`
        stopOnFocus: true, // Prevents dismissing of toast on hover
        style: {
          background: "linear-gradient(to bottom, red, darkred)",
          fontSize: "12px"
        },
        onClick: function () { } // Callback after click
      }).showToast();
    }
  }
  let onFinished = () => {
     // AI response is complete; mark remaining unmatched queuing blocks as errors
     // (these blocks have no corresponding 译泽 tags in the AI response XML)
    let stuckCount = 0;
     // Diagnostic: log residual text to help troubleshoot AI response format issues
    if (accumulatedText && accumulatedText.trim().length > 0) {
      console.log("[AI-STATE] onFinished: residual accumulatedText (no matching <译泽> tags):",
        accumulatedText.trim().substring(0, 200));
    }
    toBeTranslated.forEach((btn) => {
      if (btn.translationStatus === "queuing") {
         // Uniformly apply error state (including visual markers) via applyAiErrorState,
         // to avoid UI inconsistency from only modifying status (e.g., red X only appearing on hover).
        const errTxt = accumulatedText && accumulatedText.trim().length > 0
          ? (chrome.i18n.getMessage("errorAiResponseNoTranslationTags") || "AI response did not contain expected translation tags")
          : (chrome.i18n.getMessage("errorAiNoResponse") || "No response from AI provider");
        try { const st = btn._st(); if (st) st.errorMessage = errTxt; } catch (_) {}
        applyAiErrorState(btn, {
          errorText: errTxt,
          translatedText: btn.classList && btn.classList.contains('dualtran-ai-selected-btn') ? errTxt : undefined,
          tooltipColor: "red",
          titleText: null,
        });
        stuckCount++;
      }
    });
    if (stuckCount > 0) {
      console.log("[AI-STATE] onFinished: marked " + stuckCount + " stuck blocks as translationError");
      setAiRenderState("error");
    } else {
      console.log("[AI-STATE] onFinished fired, calling setAiRenderState(success)")
      setAiRenderState("success")
    }
  }

  const controller = new AbortController();
  abortControllers.push(controller)
  const signal = controller.signal;
  translateWithAI(contentSequence, onMessage, onError, onFinished, signal, false, targetLanguageCodeForAI)
  return true
}

function countTokens(str) {
  let tokens = []
  try {
    tokens = encode(str)
  } catch (e) {
    console.error(e)
  }
  return tokens.length
}

function insertGlobalRule() {
   // Insert styles: 1. Remove height limits 2. Change element display to block
  var style = document.createElement("style");
  style.innerHTML = `
    .dualtran-hide{
      display: none
    }
    .unlimit-height.unlimit-height-2 {
      -webkit-line-clamp: unset !important; 
      max-height: unset !important; 
      height: auto !important;
    }
    .columnified {
      display: inline-flex !important; 
      flex-direction: column !important; 
    }
    .dualtran-inline-btn-group {
      position: absolute;
      left: 0%;
      margin-left: 6px;
      top: 160%;
      transform: translateY(-50%);
      display: inline-flex;
      flex-direction: row;
      gap: 4px;
      z-index: 99999;
      white-space: nowrap;
    }
    .dualtran-inline-google-btn {
      font-size: 12px;
      font-weight: 700;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid #86efac;
      white-space: nowrap;
      position: relative;
      background: #f0fdf4;
      color: #15803d;
      transition: all 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dualtran-inline-ai-btn {
      font-size: 12px;
      font-weight: 700;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid #ddd6fe;
      white-space: nowrap;
      position: relative;
      background: #f5f3ff;
      color: #7c3aed;
      transition: all 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dualtran-inline-ai-btn.dualtran-ai-loading {
      background: #f3f4f6;
      color: #6b7280;
      border-color: #d1d5db;
    }
    .dualtran-inline-ai-btn.dualtran-ai-success {
      background: #f0fdf4;
      color: #15803d;
      border-color: #86efac;
    }
    .dualtran-inline-ai-btn.dualtran-ai-error {
      background: #fef2f2;
      color: #dc2626;
      border-color: #fecaca;
    }
    .dualtran-inline-btn-spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 999px;
      animation: dualtranInlineBtnSpin 0.7s linear infinite;
      box-sizing: border-box;
      vertical-align: middle;
      margin-right: 3px;
    }
    @keyframes dualtranInlineBtnSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .dualtran-ai-btn{
      margin-left:6px;
      position: relative;
      opacity: 1;
    }
    .dualtran-ai-btn:hover{
      cursor: pointer;
    }
    .dualtran-ai-tooltip{
      display: none;
      position: absolute;
      color: #1f2937; /* darker text for better contrast on light bg */
      font-size: 12px;
      background-color: #f3f4f6; /* lighter background */
      border: 1px solid #e5e7eb; /* subtle border to distinguish */
      padding: 4px 5px 5px 4px;
      border-radius: 6px;
      max-width: min(90vw, 600px);
      min-width: max-content;
      top: 30px;
      left: -50%;
      opacity: 1;
      z-index: 2147483647;
    }
    .dualtran-ai-btn:hover .dualtran-ai-tooltip{
      display: block;
    }
    .dualtran-ai-btn.dualtran-inline-ai-btn:hover {
      overflow: visible;
    }
    @media (hover: hover) and (pointer: fine) {
      .dualtran-inline-btn-group {
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
      }
      .dualtran-result-container:hover > .dualtran-inline-btn-group,
      .dualtran-result-container:hover .dualtran-inline-btn-group,
      .dualtran-inline-btn-group:hover {
        opacity: 1;
        visibility: visible;
      }
    }
    /* below is for styles for Toastify js 1.12.0*/
    .toastify {
      padding: 12px 20px;
      color: #fff;
      display: inline-block;
      box-shadow: 0 3px 6px -1px rgba(0, 0, 0, .12), 0 10px 36px -4px rgba(77, 96, 232, .3);
      background: -webkit-linear-gradient(315deg, #73a5ff, #5477f5);
      background: linear-gradient(135deg, #73a5ff, #5477f5);
      position: fixed;
      opacity: 0;
      transition: all .4s cubic-bezier(.215, .61, .355, 1);
      border-radius: 2px;
      cursor: pointer;
      text-decoration: none;
      max-width: calc(50% - 20px);
      z-index: 2147483647
    }
    
    .toastify.on {
      opacity: 1
    }
    
    .toast-close {
      background: 0 0;
      border: 0;
      color: #fff;
      cursor: pointer;
      font-family: inherit;
      font-size: 1em;
      opacity: .4;
      padding: 0 5px
    }
    
    .toastify-right {
      right: 15px
    }
    
    .toastify-left {
      left: 15px
    }
    
    .toastify-top {
      top: -150px
    }
    
    .toastify-bottom {
      bottom: -150px
    }
    
    .toastify-rounded {
      border-radius: 25px
    }
    
    .toastify-avatar {
      width: 1.5em;
      height: 1.5em;
      margin: -7px 5px;
      border-radius: 2px
    }
    
    .toastify-center {
      margin-left: auto;
      margin-right: auto;
      left: 0;
      right: 0;
      max-width: fit-content;
      max-width: -moz-fit-content
    }
    
    @media only screen and (max-width:360px) {
    
      .toastify-left,
      .toastify-right {
        margin-left: auto;
        margin-right: auto;
        left: 0;
        right: 0;
        max-width: fit-content
      }
    }
  `
  document.head.appendChild(style);
}
insertGlobalRule()

var backgroundTranslateSingleText
var pageTranslator = {};

/**
 * This mark cannot contain words, like <customskipword>12</customskipword>34
 *
 * Google will reorder as <customskipword>1234</customskipword>
 *
 * Under certain circumstances，Google broken the translation, returned startMark0 in some cases
 * */
const startMark = "@%";
const endMark = "#$";
const startMark0 = "@ %";
const endMark0 = "# $";

let currentIndex;
let compressionMap;


/**
 *  Replace matched keywords (from customDictionary) with special numbers before sending to translation engine. These keywords are filtered out (replaced with numbers).
 *  This allows users to customize translation terminology.
 *  Only effective for languages with spaces between words, such as English, French, etc. Not effective for languages without spaces like Chinese, Burmese, etc.
 *  Paired with handleCustomWords()
 * 
 *  Convert matching keywords to a string of special numbers to skip translation before sending to the translation engine.
 * 
 *  For English words, ignore case when matching.
 *
 *  But for the word "app" , We don't want to "Happy" also matched.
 *
 *  So we match only isolated words, by checking the two characters before and after the keyword.
 *
 *  But this will also cause this method to not work for Chinese, Burmese and other languages without spaces.
 * */
function filterKeywordsInText(textContext) {
  // a map
  let customDictionary = twpConfig.get("customDictionary");
  if (customDictionary.size > 0) {
    // reordering the map, we want to match the keyword "Spring Boot" first then the keyword "Spring"
    customDictionary = new Map(
      [...customDictionary.entries()].sort(
        (a, b) => String(b[0]).length - String(a[0]).length
      )
    );
    for (let keyWord of customDictionary.keys()) {
      while (true) {
        let index = textContext.toLowerCase().indexOf(keyWord);
        if (index === -1) {
          break;
        } else {
          textContext = removeExtraDelimiter(textContext);
          let previousIndex = index - 1;
          let nextIndex = index + keyWord.length;
          let previousChar =
            previousIndex === -1 ? "\n" : textContext.charAt(previousIndex);
          let nextChar =
            nextIndex === textContext.length
              ? "\n"
              : textContext.charAt(nextIndex);
          let placeholderText = "";
          let keyWordWithCase = textContext.substring(
            index,
            index + keyWord.length
          );
          if (
            isPunctuationOrDelimiter(previousChar) &&
            isPunctuationOrDelimiter(nextChar)
          ) {
            placeholderText =
              startMark + handleHitKeywords(keyWordWithCase, true) + endMark;
          } else {
            placeholderText = "#n%o#";
            for (let c of Array.from(keyWordWithCase)) {
              placeholderText += c;
              placeholderText += "#n%o#";
            }
          }
          let frontPart = textContext.substring(0, index);
          let backPart = textContext.substring(index + keyWord.length);
          textContext = frontPart + placeholderText + backPart;
        }
      }
      textContext = textContext.replaceAll("#n%o#", "");
    }
  }
  return textContext;
}

/**
 *  Replace matched keywords (from customDictionary) with special numbers in the translated result,
 *  Paired with filterKeywordsInText()
 * 
 *  handle the keywords in translatedText, replace it if there is a custom replacement value.
 *
 *  When encountering Google Translate reordering, the original text contains our mark, etc. , 
 *  we will catch these exceptions and call the text translation method to retranslate this section.
 */
async function handleCustomWords(
  translated,
  originalText,
  currentPageTranslatorService,
  currentTargetLanguage
) {
  try {
    const customDictionary = twpConfig.get("customDictionary");
    if (customDictionary.size > 0) {
      translated = removeExtraDelimiter(translated);
      translated = translated.replaceAll(startMark0, startMark);
      translated = translated.replaceAll(endMark0, endMark);

      while (true) {
        let startIndex = translated.indexOf(startMark);
        let endIndex = translated.indexOf(endMark);
        if (startIndex === -1 && endIndex === -1) {
          break;
        } else {
          let placeholderText = translated.substring(
            startIndex + startMark.length,
            endIndex
          );
          // At this point placeholderText is actually currentIndex , the real value is in compressionMap
          let keyWord = handleHitKeywords(placeholderText, false);
          if (keyWord === "undefined") {
            throw new Error("undefined");
          }
          let frontPart = translated.substring(0, startIndex);
          let backPart = translated.substring(endIndex + endMark.length);
          let customValue = customDictionary.get(keyWord.toLowerCase());
          customValue = customValue === "" ? keyWord : customValue;
          // Highlight custom words, make it have a space before and after it
          frontPart = isPunctuationOrDelimiter(
            frontPart.charAt(frontPart.length - 1)
          )
            ? frontPart
            : frontPart + " ";
          backPart = isPunctuationOrDelimiter(backPart.charAt(0))
            ? backPart
            : " " + backPart;
          translated = frontPart + customValue + backPart;
        }
      }
    }
  } catch (e) {
    return await backgroundTranslateSingleText(
      currentPageTranslatorService,
      currentTargetLanguage,
      originalText
    );
  }

  return translated;
}

/**
 * Store the keyword in the Map and return the index or Extract keywords by index
 * @param {*} value keyword
 * @param {boolean} mode True : Store the keyword in the Map and return the index; False : Extract keywords by index
 * @returns 
 */
function handleHitKeywords(value, mode) {
  // Store the keyword in the Map and return the index;
  if (mode) {
    if (currentIndex === undefined) {
      currentIndex = 1;
      compressionMap = new Map();
      compressionMap.set(currentIndex, value);
    } else {
      compressionMap.set(++currentIndex, value);
    }
    return String(currentIndex);
  }
  // Extract keywords by index
  else {
    return String(compressionMap.get(Number(value)));
  }
}

/**
 * Whether the character is punctuation or a separator
 * any kind of punctuation character (including international e.g. Chinese and Spanish punctuation), and spaces, newlines
 *
 * source: https://github.com/slevithan/xregexp/blob/41f4cd3fc0a8540c3c71969a0f81d1f00e9056a9/src/addons/unicode/unicode-categories.js#L142
 *
 * note: XRegExp unicode output taken from http://jsbin.com/uFiNeDOn/3/edit?js,console (see chrome console.log), then converted back to JS escaped unicode here http://rishida.net/tools/conversion/, then tested on http://regexpal.com/
 *
 * suggested by: https://stackoverflow.com/a/7578937
 *
 * added: extra characters like "$", "\uFFE5" [yen symbol], "^", "+", "=" which are not consider punctuation in the XRegExp regex (they are currency or mathmatical characters)
 *
 * added: Chinese Punctuation: \u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3010|\u3011|\u007e
 *
 * added: special html space symbol: &nbsp; &ensp; &emsp; &thinsp; &zwnj; &zwj; -> \u00A0|\u2002|\u2003|\u2009|\u200C|\u200D
 * @see https://stackoverflow.com/a/21396529/19616126
 * */
function isPunctuationOrDelimiter(str) {
  if (typeof str !== "string") return false;
  if (str === "\n" || str === " ") return true;
  const regex =
    /[\$\uFFE5\^\+=`~<>{}\[\]|\u00A0|\u2002|\u2003|\u2009|\u200C|\u200D|\u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3010|\u3011|\u007e!-#%-\x2A,-/:;\x3F@\x5B-\x5D_\x7B}\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E3B\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/g;
  return regex.test(str);
}

/**
 * Remove useless newlines, spaces inside, which may affect our semantics
 * */
function removeExtraDelimiter(textContext) {
  textContext = textContext.replaceAll("\n", " ");
  textContext = textContext.replace(/  +/g, " ");
  return textContext;
}

/**
 * Write debug information to the content-script console.
 *
 * The earlier page-world injection approach made the message easier to see in
 * DevTools, but it also triggered CSP violations on strict pages. Keeping the
 * log inside the isolated world preserves diagnostics without breaking sites.
 *
 * @param {"log"|"warn"|"error"} level
 * @param {string} marker
 * @param {*} payload
 * @returns {void}
 */
function emitDualTranDebugLog(level, marker, payload) {
  const logger = console[level] || console.log;
  logger(marker, payload);
}

/**
 * Request background to translate a node list
 *  
 * @param {*} translationService 
 * @param {*} targetLanguage 
 * @param {*} sourceArray2d 
 * @param {*} dontSortResults  // true: maintain original HTML node order; false: use translated node order
 * @returns 
 */
function backgroundTranslateHTML(
  translationService,
  targetLanguage,
  sourceArray2d,
  dontSortResults
) {
  return new Promise((resolve, reject) => {
    emitDualTranDebugLog("log", "[DualTran][TranslateHTMLRequestStart]", {
      translationService,
      targetLanguage,
      dontSortResults,
      pieceCount: Array.isArray(sourceArray2d) ? sourceArray2d.length : 0,
      requestPreview: Array.isArray(sourceArray2d)
        ? sourceArray2d.slice(0, 5).map((row) => row.join(" ").slice(0, 160))
        : [],
    });
    chrome.runtime.sendMessage(
      {
        action: "translateHTML",
        translationService,
        targetLanguage,
        sourceArray2d,
        dontSortResults,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          emitDualTranDebugLog("error", "[DualTran][TranslateHTMLRuntimeError]", {
            translationService,
            targetLanguage,
            dontSortResults,
            message: chrome.runtime.lastError.message,
            requestPreview: sourceArray2d.slice(0, 5).map((row) => row.join(" ").slice(0, 160)),
          });
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response === undefined) {
          emitDualTranDebugLog("error", "[DualTran][TranslateHTMLUndefinedResponse]", {
            translationService,
            targetLanguage,
            dontSortResults,
            requestPreview: sourceArray2d.slice(0, 5).map((row) => row.join(" ").slice(0, 160)),
          });
          reject(new Error("No translation response received"));
          return;
        }
        emitDualTranDebugLog("log", "[DualTran][TranslateHTMLResponse]", {
          translationService,
          targetLanguage,
          dontSortResults,
          isArray: Array.isArray(response),
          topLevelLength: Array.isArray(response) ? response.length : null,
          firstRowLength: Array.isArray(response) && Array.isArray(response[0]) ? response[0].length : null,
        });
        resolve(response);
      }
    );
  });
}

/**
 * Request background to translate an attribute text list
 * 
 * @param {*} translationService 
 * @param {*} targetLanguage 
 * @param {*} sourceArray 
 * @returns 
 */
function backgroundTranslateText(
  translationService,
  targetLanguage,
  sourceArray
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateText",
        translationService,
        targetLanguage,
        sourceArray,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response === undefined) {
          reject(new Error("No translation response received"));
          return;
        }
        resolve(response);
      }
    );
  });
}

/**
 * Request background to translate a single string (used for title translation or selected-text translation)
 * 
 * @param {*} translationService 
 * @param {*} targetLanguage 
 * @param {*} source a string to be translated
 * @returns 
 */
backgroundTranslateSingleText = function (
  translationService,
  targetLanguage,
  source
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateSingleText",
        translationService,
        targetLanguage,
        source,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response === undefined) {
          reject(new Error("No translation response received"));
          return;
        }
        resolve(response);
      }
    );
  });
}

/**
 * Get the tab hostname
 * @returns 
 */
function getTabHostName() {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "getTabHostName" }, (result) =>
      resolve(result)
    )
  );
}

Promise.all([twpConfig.onReady(), getTabHostName()]).then(function (_) {
  console.log("pageTranslator.js promise.all is resolved")

  const tabHostName = _[1];
   // inline text
  const htmlTagsInlineText = [
    "#text",
    "a",
    "abbr",
    "acronym",
    "b",
    "bdo",
    "big",
    "cite",
    "code",
    "dfn",
    "em",
    "i",
    "label",
    "q",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "u",
    "tt",
    "var",
    "mark"
  ];

   // Non-translatable inline elements. If the original text sent to Google is missing some inline elements, the translation quality will suffer. So we send all inline elements for translation (but when adding to translated, we still use the pre-translation original text). Therefore, this array is left empty.
  const htmlTagsInlineIgnore = []

   // Non-translatable block elements
  const htmlTagsNoTranslate = ["title", "script", "style", "textarea", "translated", "noscript"];

  if (twpConfig.get("translateTag_pre") !== "yes") {
    htmlTagsInlineIgnore.push("pre");
  }

   // Listen for config changes and reflect them in the htmlTagsInlineIgnore memory variable in real time
  twpConfig.onChanged((name, newvalue) => {
    switch (name) {
       // Whether to translate content inside <pre> tags
      case "translateTag_pre":
        const index = htmlTagsInlineIgnore.indexOf("pre");
        if (index !== -1) {
          htmlTagsInlineIgnore.splice(index, 1);
        }
        if (newvalue !== "yes") {
          htmlTagsInlineIgnore.push("pre");
        }
        break;
    }
  });

  // Pieces are a set of nodes separated by inline tags that form a sentence or paragraph.
  let piecesToTranslate = [];
   // Original language of the page
  let originalTabLanguage = "und";
   // Current language of the page
  let currentPageLanguage = "und";
   // Page language state (original/translated)
  let pageLanguageState = "original"; // "original" or "translated"
   // Current target language. Initially loaded from config; when the user changes the target language during use, currentTargetLanguage updates accordingly
  currentTargetLanguage = twpConfig.get("targetLanguage");
   // Translation service engine (google/yandex)
  let currentPageTranslatorService = twpConfig.get("pageTranslatorService");
   // Google returns translations with HTML node order different from the original for fluency.
   // You can choose to re-sort (dontSortResults === false) to display in original HTML node order, which better matches the original layout, but may reduce fluency (e.g. in languages like Chinese where word order differs significantly from English).
   // Or set to not re-sort (dontSortResults === true) to display in Google's order, which is more fluent but the layout may be incorrect
  let dontSortResults =
    twpConfig.get("dontSortResults") == "yes" ? true : false;
  let fooCount = 0;

  let originalPageTitle;
   // Attributes to translate (e.g., placeholder, etc.)
  let attributesToTranslate = [];
   // Periodic translation of new nodes (using setInterval)
  let translateNewNodesTimerHandler;
   // New nodes (added by mutationObserver)
  let newNodes = [];
   // Removed nodes (removed by mutationObserver)
  let removedNodes = [];

   // NOTE: nodesToRestore is declared at module top level (hoisted) so the
   // module-level hover-button handlers can access it. Do not redeclare here.



  /**
    * Update newNodes and removedNodes arrays in real time
    * Principle: Create a MutationObserver instance, continuously adding new nodes to newNodes array and removed nodes to removedNodes array
   */
   const mutationObserver = new MutationObserver(function (mutations) { // The browser waits until all queued DOM operations are finished before calling this callback, hence the plural "mutations" parameter
    const tmpNewNodes = [];
    mutations.forEach((mutation) => {
       // New nodes: if a block-level element belonging to translatable tags, add to local tmpNewNodes array
      mutation.addedNodes.forEach((addedNode) => {
        const nodeName = addedNode.nodeName.toLowerCase();
        if (nodeName.toLowerCase() !== "translated" && addedNode.parentNode?.nodeName.toLowerCase() !== "translated") {
          if (htmlTagsNoTranslate.indexOf(nodeName) == -1) {
            if (htmlTagsInlineText.indexOf(nodeName) == -1) {
              if (htmlTagsInlineIgnore.indexOf(nodeName) == -1) {
                tmpNewNodes.push(addedNode);
              }
            }
          }
        }
      });

       // Add removed nodes to removedNodes array
      mutation.removedNodes.forEach((removedNode) => {
        removedNodes.push(removedNode);
      });
    });

     // If tmpNewNodes array elements are not in newNodes array, push them into newNodes array
    tmpNewNodes.forEach((node) => {
      if (newNodes.indexOf(node) == -1) {
        newNodes.push(node);
      }
    });
  });

  /**
    * Update piecesToTranslate array every 2 seconds (based on newNodes information)
   */
  function updatePiecesToTranslateWithNewNodes() {
    try {
      newNodes.forEach((nn) => {
        if (removedNodes.indexOf(nn) != -1) return;

         // Get pieces from each new node
        let newPiecesToTranslate = getPiecesToTranslate(nn);

         // Check if piecesToTranslate array already contains the newly obtained piece; if not, push it into piecesToTranslate array
        for (const i in newPiecesToTranslate) {
          const newNodes = newPiecesToTranslate[i].nodes;
          let finded = false;

          for (const ntt of piecesToTranslate) {
            if (ntt.nodes.some((n1) => newNodes.some((n2) => n1 === n2))) {
              finded = true;
            }
          }

          if (!finded) {
            piecesToTranslate.push(newPiecesToTranslate[i]);
          }
        }
      });
    } catch (e) {
      console.error(e);
    } finally {
      newNodes = [];
      removedNodes = [];
    }
  }

  /**
    * Use the observer instance to observe the entire document, i.e., listen for all node changes in document.body tree, update newNodes in real time, and push appropriate newNodes into piecesToTranslate array every 2 seconds
   */
  function enableMutatinObserver() {
    disableMutatinObserver();

    if (twpConfig.get("translateDynamicallyCreatedContent") == "yes") {
       // Set up timer: push new nodes into piecesToTranslate array every 2 seconds
      translateNewNodesTimerHandler = setInterval(updatePiecesToTranslateWithNewNodes, 2000);
       // Listen for document.body updates in real time
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  /**
    * Disconnect the observer instance from the entire document; cancel the periodic translator
   */
  function disableMutatinObserver() {
    clearInterval(translateNewNodesTimerHandler);
    newNodes = [];
    removedNodes = [];
     // Disconnect listener
    mutationObserver.disconnect();
     // Besides using callback functions, we can also use takeRecords to actively pull all pending notifications from the notification queue. This action clears all notifications.
    mutationObserver.takeRecords();
  }

  let pageIsVisible = document.visibilityState == "visible";
  // this causes parts of youtube not to be translated
  // new IntersectionObserver(entries => {
  //         if (entries[0].isIntersecting && document.visibilityState == "visible") {
  //             pageIsVisible = true
  //         } else {
  //             pageIsVisible = false
  //         }

  //         if (pageIsVisible && pageLanguageState === "translated") {
  //             enableMutatinObserver()
  //         } else {
  //             disableMutatinObserver()
  //         }
  //     }, {
  //         root: null
  //     })
  //     .observe(document.body)

  /**
    * Monitor page visibility. When the page is visible, enable the mutationObserver to watch the page; otherwise disable it.
   */
  const handleVisibilityChange = function () {
    if (document.visibilityState == "visible") {
      pageIsVisible = true;
    } else {
      pageIsVisible = false;
    }

    if (pageIsVisible && pageLanguageState === "translated") {
      enableMutatinObserver();
    } else {
      disableMutatinObserver();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange, false);

  /**
    * Handle bfcache (back/forward cache) restore events.
    * When a page is restored from bfcache, the JavaScript heap state is preserved, but dynamic content may have been
    * re-fetched by the page's JavaScript. Google translations have cache so they can be re-applied to new DOM nodes,
    * but AI translations have no cache — causing the AI button to show green (stale success state),
    * while the actual page has no AI translations (only Google translations remain).
   *
    * Re-evaluate AI render state immediately on bfcache restore to correct stale states.
   *
    * For non-bfcache pageshow events (full page reload),
    * check sessionStorage for an AI translation marker,
    * and if present, set shouldForceAiAfterPageTranslation so subsequent auto-translations include AI.
   */
  const handlePageShow = function (event) {
    if (event.persisted) {
      console.log("[AI-STATE] page restored from bfcache, re-evaluating AI render state");
      updateAiRenderStateInternal();
    } else {
       // Non-bfcache restore (full page load): check if AI translation state needs to be restored
      if (checkAiAppliedFlag()) {
        console.log("[AI-STATE] pageshow (non-bfcache): restoring shouldForceAiAfterPageTranslation");
        shouldForceAiAfterPageTranslation = true;
        setAiRenderState("loading");
      }
    }
  };
  window.addEventListener("pageshow", handlePageShow, false);

  /**
    * Handle popstate events (browser back/forward buttons).
   *
    * Sites like GitHub use Turbo Drive for SPA navigation and set turbo-cache-control=no-cache.
    * When the user clicks the back button:
    * 1. popstate event fires (URL has switched to the target page)
    * 2. Turbo re-fetches page content from the server (because no-cache)
    * 3. Turbo replaces data-turbo-body content with brand-new original HTML (no translations)
    * 4. Mutation Observer detects new nodes and automatically translates Google translations
    * 5. But AI translation does not auto-trigger (shouldForceAiAfterPageTranslation was reset to false after last translation completed)
   *
    * By checking the sessionStorage marker on popstate, restore shouldForceAiAfterPageTranslation.
    * Since Turbo/SPA body replacement is asynchronous (fetch → then → innerHTML),
    * use setTimeout to delay translatePage() call, ensuring the SPA has completed body replacement before re-translating.
    * Delay is set to 1500ms — most SPAs complete fetch + DOM replacement within one second.
    * Use pendingPopstateTranslate to prevent repeated translations from multiple rapid popstate events.
   */
  let pendingPopstateTranslate = null;
  const handlePopState = function () {
    if (checkAiAppliedFlag()) {
      console.log("[AI-STATE] popstate: restoring shouldForceAiAfterPageTranslation for Turbo back-nav");
      shouldForceAiAfterPageTranslation = true;
      setAiRenderState("loading");

       // Clear previous pending timer (prevent multiple rapid popstate events from piling up)
      if (pendingPopstateTranslate !== null) {
        clearTimeout(pendingPopstateTranslate);
      }

       // Allow time for SPA body replacement, then re-translate the entire page.
       // Note: pageLanguageState is still "translated" (SPA navigation did not reset it),
       // but body content has been replaced with brand-new HTML and needs to be translated from scratch.
       // translatePage internally calls restorePage to clear old state,
       // then re-scans the DOM and translates both Google and AI translations.
      pendingPopstateTranslate = setTimeout(() => {
        pendingPopstateTranslate = null;
         // Re-check the marker (may have been cleared by restorePage during the wait)
        if (checkAiAppliedFlag()) {
          console.log("[AI-STATE] popstate: SPA body likely replaced, triggering translatePage");
          pageTranslator.translatePage();
        }
      }, 1500);
    }
  };
  window.addEventListener("popstate", handlePopState, false);

  /**
    * Get information about all nodes that need translation in the tree of the given node (including the node itself and all its descendants)
    * Principle: Through traversal, get information about all elements. Each block-level element's info is placed in an object, with its inline child elements stored in the object's nodes property. Then push the object into an array and return it.
   * @param {*} root 
    * @returns {array} piecesToTranslate, one-dimensional array with elements in the following format:
   *  {
        isTranslated: boolean,
         parentElement: node, // Ancestor element of the previous text node needing translation (not necessarily the direct parentNode); <translated> child elements are added under this node
         topElement: node, // First element of this piece
         bottomElement: node, // Last element of this piece
         nodes: [], // All text nodes to translate
         nodesToBeInTranslatedNode: [] // All original nodes that will enter the <translated> node (including those to translate and those to copy directly without translation)
      },
   */
  function getPiecesToTranslate(root = document.body) {
    let translateLongerThan = parseInt(twpConfig.get('translateLongerThan'))
    const tmpPiecesToTranslate = [
      {
        isTranslated: false,
        parentElement: null,
        topElement: null,
        bottomElement: null,
        nodes: [],
        nodesToBeInTranslatedNode: []
      },
    ];
    let index = 0;
    let currentParagraphSize = 0;

    /**
     * Some sites insert Text, Comment, ShadowRoot, and other non-Element nodes
     * between real DOM elements. getComputedStyle() only accepts Elements, so we
     * normalize the input before reading layout information.
     * @param {*} node
     * @returns {Element|null}
     */
    function getStyleElement(node) {
      if (node instanceof Element) {
        return node;
      }
      if (node?.nodeType === 11 && node.host instanceof Element) {
        return node.host;
      }
      return null;
    }

    /**
     * Safely read the display value for a node-like value.
     * @param {*} node
     * @returns {string}
     */
    function getDisplayValue(node) {
      const styleElement = getStyleElement(node);
      return styleElement ? window.getComputedStyle(styleElement).display : "";
    }

    /**
     * Decide whether a node should start a new translation block.
     * @param {*} node
     * @returns {boolean}
     */
    function isNewLineBoundary(node) {
      const nodeName = node?.nodeName?.toLowerCase?.() || "";
      if (["button", "br"].includes(nodeName)) {
        return true;
      }

      if (!(node instanceof Element)) {
        return false;
      }

      const display = getDisplayValue(node);
      const parentDisplay = getDisplayValue(node.parentElement || node.parentNode);

      return (
        (!display.includes("inline") && parentDisplay !== "inline-flex") ||
        parentDisplay === "flex"
      );
    }

    /**
     * Get all nodes in the node's tree (i.e., the node and its descendants) and update the piecesToTranslate array.
     * Process: recursive calls. Depth-first, pre-order traversal
     * @param {*} node 
     * @param {*} lastHTMLElement   // The last HTML element encountered during analysis, dynamically assigned — usually the node currently being analyzed. (Note: textNode is not an HTML element)
     * @param {*} lastSelectOrDataListElement 
     * @returns 
     */
    const getAllNodes = function (
      node,
      lastHTMLElement = null,
      lastSelectOrDataListElement = null
    ) {
       // Ignore "translated" nodes
      if (node?.nodeName.toLowerCase() === "translated"
      ) {
        return
      }

      /**
       * nodeType:
       *  
        1	Node.ELEMENT_NODE                 An element node, e.g., <p> and <div>。
        2	Node.ATTRIBUTE_NODE	              A coupled attribute of an element.
        3	Node.TEXT_NODE                    Actual text in an Element or Attr
        4	Node.CDATA_SECTION_NODE           A CDATASection, e.g., <!CDATA[[ … ]]>.
        7	Node.PROCESSING_INSTRUCTION_NODE	A ProcessingInstruction for an XML document (en-US), e.g., <?xml-stylesheet ... ?> declaration.
        8	Node.COMMENT_NODE	                A Comment node.
        9	Node.DOCUMENT_NODE	              A Document node.
        10 Node.DOCUMENT_TYPE_NODE	        A DocumentType describing the document type. E.g., <!DOCTYPE html> is for HTML5.
        11 Node.DOCUMENT_FRAGMENT_NODE		  A DocumentFragment node
       */
       // element node or fragment node — these two types have child nodes
      if (node.nodeType == 1 || node.nodeType == 11) {
         // When video element is present, remove unlimit-height from the entire page
        if (node.nodeName === "VIDEO" && !hasVideoInPage) {
          document.querySelectorAll(".unlimit-height").forEach((node) => { node.classList.remove('unlimit-height') })
          document.querySelectorAll(".unlimit-height-2").forEach((node) => { node.classList.remove('unlimit-height-2') })
          hasVideoInPage = true
        }
         // When it is a video element, remove unlimit-height class from the video element and all its ancestor elements
        // if (node.nodeName === "VIDEO"){
        //   let tmp = node
        //   while(tmp !== document.body){
        //     tmp?.classList?.remove?.('unlimit-height')
        //     tmp = tmp.parentNode
        //   }
        // }
        // fragment node
        if (node.nodeType == 11) {
          lastHTMLElement = node.host;
          lastSelectOrDataListElement = null;
        }
         // If it is an element node
        else if (node.nodeType == 1) {

          lastHTMLElement = node;
          const nodeName = node?.nodeName.toLowerCase();

          if (nodeName === "select" || nodeName === "datalist")
            lastSelectOrDataListElement = node;

           // If the root element is one that should not be translated
           // Special case: when the element is <code> and not inside <pre>, it should be translated (even with translate="no" or notranslate class)
           //       Only when <code> is a descendant of <pre> should it not be translated.
          let shouldSkipTranslate =
            htmlTagsInlineIgnore.indexOf(nodeName) !== -1 ||
            htmlTagsNoTranslate.indexOf(nodeName) !== -1 ||
            node.classList.contains("notranslate") ||
            node.getAttribute("translate") === "no" ||
            node.isContentEditable ||
            node.classList.contains("material-icons") ||
            node.classList.contains("material-symbols-outlined");

          try {
            if (nodeName === "code") {
              const insidePre = !!(node.closest && node.closest("pre"));
               // Rule: <code> inside <pre> → don't translate; otherwise → translate
              shouldSkipTranslate = insidePre ? true : false;
            }
          } catch (e) {
             // Safety fallback: if closest is unavailable or throws, keep original determination
          }

          if (shouldSkipTranslate) {
            const isNewLine = isNewLineBoundary(node)


             // If it is a block element
            if (isNewLine) {
               // Nothing to translate before this
              if (tmpPiecesToTranslate[index].nodes.length === 0
                || countTokens(tmpPiecesToTranslate[index].nodes.reduce((accumulated, current) => { return accumulated + " " + current.textContent }, "")) <= translateLongerThan
              ) {
                tmpPiecesToTranslate[index] = {
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                  nodesToBeInTranslatedNode: [],
                }
              }
               // There is content to translate before this
              else {
                console.log(111111, tmpPiecesToTranslate[index].nodes)
                currentParagraphSize = 0;
                tmpPiecesToTranslate[index].bottomElement = lastHTMLElement;

                let translatedElement = document.createElement("translated")
                translatedElement.style.display = "none"
                console.log(2222222, lastHTMLElement)
                lastHTMLElement.appendChild(translatedElement)
                // let translatedInnerElement = document.createElement("span")
                // translatedElement.appendChild(translatedInnerElement)
                tmpPiecesToTranslate[index].translatedElement = translatedElement

                 // Push a new object (representing a new line) into piecesToTranslate array as a top-level element, and exit getAllNodes function!!!!!!!!!
                tmpPiecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                  nodesToBeInTranslatedNode: [],
                });
                index++;
              }
            }
             // If it is an inline element
            else {
               // Directly add to nodesToBeInTranslatedNode, do not translate
              tmpPiecesToTranslate[index].nodesToBeInTranslatedNode.push(node)
            }

             // Exit!!!!!!!!!
            return;
          }
        }

        /**
          * Get all child nodes of the given node
         * 
          * @param {*} childNodes !!!!Note: childNodes is actually all child nodes of the parent node, including whitespace between element start and next element tags (counted as a #text)\element nodes\text nodes\comment nodes etc.!!!!!!!
         */
        function getAllChilds(childNodes) {
          let prevNode
          Array.from(childNodes).forEach((_node) => {
            const nodeName = _node?.nodeName.toLowerCase();
            if (nodeName === "translated") {
              return
            }

            // element node
            if (_node.nodeType == 1) {
              lastHTMLElement = _node;
              if (nodeName === "select" || nodeName === "datalist")
                lastSelectOrDataListElement = _node;
            }

             // If the node is a "non-inline element" or button element or br element or flex child element
            const isNewLine = isNewLineBoundary(_node)
            if (isNewLine) {
               // Nothing to translate before this
              if (tmpPiecesToTranslate[index].nodes.length === 0
                || countTokens(tmpPiecesToTranslate[index].nodes.reduce((accumulated, current) => { return accumulated + " " + current.textContent }, "")) <= translateLongerThan
              ) {
                // console.log(333333, tmpPiecesToTranslate[index].nodes.length, tmpPiecesToTranslate[index].nodes)
                tmpPiecesToTranslate[index] = {
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                  nodesToBeInTranslatedNode: [],
                }
              }
               // There is content to translate before this
              else {
                console.log(333333, tmpPiecesToTranslate[index].nodes)
                currentParagraphSize = 0;
                tmpPiecesToTranslate[index].bottomElement = lastHTMLElement;
                let translatedElement = document.createElement("translated")
                translatedElement.style.display = "none"

                if (!prevNode) {
                  try {
                    if (tmpPiecesToTranslate[index].parentElement) {
                      tmpPiecesToTranslate[index].parentElement.appendChild(translatedElement)
                    } else {
                      childNodes[0].parentNode.previousSibling.appendChild(translatedElement)
                    }
                  } catch (error) {
                     console.log("Error inserting translation node:", error)
                  }

                }
                 // If tmpPiecesToTranslate[index] has only one node and it is an element node (not a text node)
                else if (tmpPiecesToTranslate[index].nodes.length === 1 && tmpPiecesToTranslate[index].nodes[0].nodeType == 1) {
                  prevNode.appendChild(translatedElement)
                }
                else {
                  _node.parentNode.insertBefore(translatedElement, _node)
                }
                tmpPiecesToTranslate[index].translatedElement = translatedElement

                 // Push a new object (representing a line) into piecesToTranslate array as a top-level element
                tmpPiecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                  nodesToBeInTranslatedNode: [],
                });
                index++;
              }

               // Get all child nodes of this child node
              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);

               // Nothing to translate before this
              if (tmpPiecesToTranslate[index].nodes.length === 0
                || countTokens(tmpPiecesToTranslate[index].nodes.reduce((accumulated, current) => { return accumulated + " " + current.textContent }, "")) <= translateLongerThan
              ) {
                // console.log(555555, tmpPiecesToTranslate[index].nodes)
                // console.log(666666, countTokens(tmpPiecesToTranslate[index].nodes.reduce((accumulated, current)=>{return accumulated+" "+current.textContent},"")))
                tmpPiecesToTranslate[index] = {
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                  nodesToBeInTranslatedNode: [],
                }
              }
               // There is content to translate before this
              else {
                // console.log(777777, tmpPiecesToTranslate[index].nodes)
                currentParagraphSize = 0;
                tmpPiecesToTranslate[index].bottomElement = lastHTMLElement;

                let translatedElement = document.createElement("translated")
                translatedElement.style.display = "none"
                lastHTMLElement.appendChild(translatedElement)
                tmpPiecesToTranslate[index].translatedElement = translatedElement

                 // Push an initial object into piecesToTranslate array as a top-level element
                tmpPiecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                  nodesToBeInTranslatedNode: [],
                });
                index++;
              }
            }
             // If the node is an inline element
            else {
               // Get all child nodes of this child node
              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);
            }
            prevNode = _node
          });
        }
        getAllChilds(node.childNodes);

        if (!tmpPiecesToTranslate[index].bottomElement) {
          tmpPiecesToTranslate[index].bottomElement = node;
        }
        if (node.shadowRoot) {
          getAllChilds(node.shadowRoot.childNodes);
          if (!tmpPiecesToTranslate[index].bottomElement) {
            tmpPiecesToTranslate[index].bottomElement = node;
          }
        }
      }
       // Text node
      else if (node.nodeType == 3) {
         // Text length greater than 0
        if (node.textContent.trim().length > 0) {
           // For developer.mozilla.org, remove newlines from text
          if (location.hostname.includes("developer.mozilla.org")) {
            node.textContent = node.textContent.replace(/[\r\n]/g, '')
          }

           // Assign parentElement to the piece element (note: the final value may not be the actual parentNode)
          if (!tmpPiecesToTranslate[index].parentElement) {
             // If it is a child of an option element
            if (
              node &&
              node.parentNode &&
              node.parentNode?.nodeName.toLowerCase() === "option" &&
              lastSelectOrDataListElement
            ) {
              tmpPiecesToTranslate[index].parentElement =
                lastSelectOrDataListElement;
              tmpPiecesToTranslate[index].bottomElement =
                lastSelectOrDataListElement;
              tmpPiecesToTranslate[index].topElement = lastSelectOrDataListElement;
            }
             // If it is not a child of an option element
            else {
              let temp = node.parentNode;
               // Recursively walk up to find parent element (if parent is inline, keep walking up until root)
              let isNewLine = isNewLineBoundary(temp)
              while (
                temp &&
                temp != root &&
                !isNewLine
              ) {
                temp = temp.parentNode;
                isNewLine = isNewLineBoundary(temp)
              }


              if (temp && temp.nodeType === 11) {
                temp = temp.host;
              }
              tmpPiecesToTranslate[index].parentElement = temp;
            }
          }

           // Assign topElement to the piece element (actually the last non-text element node)
          if (!tmpPiecesToTranslate[index].topElement) {
            tmpPiecesToTranslate[index].topElement = lastHTMLElement;
          }


          if (currentParagraphSize > 1000) {

             // Create a new translatedElement and assign it to tmpPiecesToTranslate[index].translatedElement
            let translatedElement = document.createElement("translated")
            translatedElement.style.display = "none"
            lastHTMLElement.appendChild(translatedElement)
            tmpPiecesToTranslate[index].translatedElement = translatedElement

            tmpPiecesToTranslate[index].bottomElement = lastHTMLElement;

             // Create a new piece
            const pieceInfo = {
              isTranslated: false,
              parentElement: null,
              topElement: lastHTMLElement,
              bottomElement: null,
              nodes: [],
              nodesToBeInTranslatedNode: [],
            };
            pieceInfo.parentElement = tmpPiecesToTranslate[index].parentElement;

            tmpPiecesToTranslate.push(pieceInfo);
            index++;

            currentParagraphSize = 0;
          }

          let isParentBlockFlex
          try {
            isParentBlockFlex = window.getComputedStyle(node.parentNode).display.includes("flex") && !window.getComputedStyle(node.parentNode).display.includes("inline")
          } catch (e) {
             console.log("Error checking if parent is flex element:", e)
            isParentBlockFlex = false
          }
          if (isParentBlockFlex) {
            currentParagraphSize = 0;
            tmpPiecesToTranslate[index].bottomElement = lastHTMLElement;
            let translatedElement = document.createElement("translated")
            translatedElement.style.display = "none"

            let wrapNode = document.createElement("span")
            wrapNode.style.display = "flex"
            wrapNode.style.flexDirection = "column"
            node.parentNode.insertBefore(wrapNode, node)
            wrapNode.appendChild(node)
            wrapNode.appendChild(translatedElement)

            tmpPiecesToTranslate[index].translatedElement = translatedElement

             // Push the text node into the nodes array of the piecesToTranslate element
            tmpPiecesToTranslate[index].nodes.push(node);
            tmpPiecesToTranslate[index].bottomElement = null;
            tmpPiecesToTranslate[index].nodesToBeInTranslatedNode.push(node);

             // Push a new object (representing a line) into piecesToTranslate array as a top-level element
            tmpPiecesToTranslate.push({
              isTranslated: false,
              parentElement: null,
              topElement: null,
              bottomElement: null,
              nodes: [],
              nodesToBeInTranslatedNode: [],
            });
            index++;
          } else {
             // Push the text node into the nodes array of the piecesToTranslate element
            tmpPiecesToTranslate[index].nodes.push(node);
            tmpPiecesToTranslate[index].bottomElement = null;
            tmpPiecesToTranslate[index].nodesToBeInTranslatedNode.push(node);

            currentParagraphSize += node.textContent.length;
          }
        }
      }


    };
    getAllNodes(root);

     // If the last piece's nodes array is empty, remove that piece
    if (
      tmpPiecesToTranslate.length > 0 &&
      tmpPiecesToTranslate[tmpPiecesToTranslate.length - 1].nodes.length == 0
    ) {
      tmpPiecesToTranslate.pop();
    }

     // The translatedElement is normally created when the NEXT block boundary is
     // encountered. A traversal whose root IS the final block (e.g., a single <p>
     // injected by the MutationObserver) never hits that boundary, so the last
     // piece is left without a translatedElement — addTranslatedContent then
     // silently skips it and the Google translation result is discarded.
     // Create the element here so dynamically injected single blocks are rendered.
    const lastPiece =
      tmpPiecesToTranslate[tmpPiecesToTranslate.length - 1];
    if (
      lastPiece &&
      lastPiece.nodes.length > 0 &&
      !lastPiece.translatedElement
    ) {
      const anchor =
        lastPiece.bottomElement ||
        lastPiece.parentElement ||
        lastPiece.topElement ||
        lastPiece.nodes[lastPiece.nodes.length - 1].parentNode;
      if (anchor) {
        const translatedElement = document.createElement("translated");
        translatedElement.style.display = "none";
        anchor.appendChild(translatedElement);
        lastPiece.translatedElement = translatedElement;
      }
    }

    return tmpPiecesToTranslate;
  }

  /**
    * Get information about all attributes that need translation in the tree of the given node (including the node itself and all its descendants)
   * 
   * @param {*} root 
    * @returns {array} attributesToTranslate, one-dimensional array (through traversal, get info for all attributes, place each attribute's info in an object, then push into this one-dimensional array). Element format:
   *  {
        node: e,
        original: "Reset",
        attrName: "value",
      }
   */
  function getAttributesToTranslate(root = document.body) {
    const attributesToTranslate = [];

    const placeholdersElements = root.querySelectorAll(
      "input[placeholder], textarea[placeholder]"
    );
    const altElements = root.querySelectorAll(
      'area[alt], img[alt], input[type="image"][alt]'
    );
    const valueElements = root.querySelectorAll(
      'input[type="button"], input[type="submit"], input[type="reset"]'
    );
    const titleElements = root.querySelectorAll("body [title]");

    function hasNoTranslate(elem) {
      if (
        elem &&
        (elem.classList.contains("notranslate") ||
          elem.getAttribute("translate") === "no")
      ) {
        return true;
      }
    }

    placeholdersElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("placeholder");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "placeholder",
        });
      }
    });

    altElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("alt");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "alt",
        });
      }
    });

    valueElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("value");
      if (e.type == "submit" && !txt) {
        attributesToTranslate.push({
          node: e,
          original: "Submit Query",
          attrName: "value",
        });
      } else if (e.type == "reset" && !txt) {
        attributesToTranslate.push({
          node: e,
          original: "Reset",
          attrName: "value",
        });
      } else if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "value",
        });
      }
    });

    titleElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("title");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "title",
        });
      }
    });

    return attributesToTranslate;
  }

  /**
    * Wrap a text node with a font tag
    * @param {*} node text node
   * @returns 
   */
  // encapsulating the text makes the video disappear 
  // when using a function like Pai.removeChild(child) 
  // an error can be generated when encapsulating
  function encapsulateTextNode(node) {
    const fontNode = document.createElement("font");
    fontNode.setAttribute("style", "vertical-align: inherit;");
    fontNode.textContent = node.textContent;

    node.replaceWith(fontNode);

    return fontNode;
  }

  /**

  /**
    * Replace node text with translated text
   * 
    * @param {*} piecesToTranslateNow nodes to translate
    * @param {*} results translation results. Structure is a two-dimensional array.
   */
  function translateResults(piecesToTranslateNow, results) {
     // true: maintain original HTML node order; false: true: use translated node order; false: maintain original HTML node order (re-sorted results)
    if (dontSortResults) {
      for (let i = 0; i < results.length; i++) {
        const nodes = piecesToTranslateNow[i].nodes;

         // Add inline button group (Google + AI)
        if (nodes.length > 0 && nodes[0]) {
          let sourceString = nodes.reduce((accumulator, currentNode) => accumulator + currentNode.textContent, "")
          if (shouldTriggerAiImprove(wordsCount(sourceString), twpConfig.get("aiImproveForLongerThan"))) {
             // Translation node (for displaying AI translation results)
            let lastTextNode = nodes[nodes.length - 1]
            if (lastTextNode && lastTextNode.parentNode) {
              lastTextNode.parentNode.classList.add("dualtran-result-container")
            }
            let translatedTextNode = document.createElement("span")
            translatedTextNode.classList.add("dualtran-aitranslatedtext-replacemode")
            lastTextNode.parentNode.appendChild(translatedTextNode)

            ensureSingletonInit();
            registerBlock(
              lastTextNode.parentNode, sourceString, translatedTextNode,
              "", // Google text restored via nodesToRestore
              nodes
            );
          }
        }

        for (let j = 0; j < results[i].length; j++) {
          if (nodes[j]) {
            let translated = results[i][j] + " ";

             // Sometimes results[i] array is longer than piecesToTranslateNow[i].nodes array; in that case, append remaining results to last node
            if (
              piecesToTranslateNow[i].nodes.length - 1 === j &&
              results[i].length > j
            ) {
              const restResults = results[i].slice(j + 1);
              translated += restResults.join(" ");
            }

            const originalTextNode = nodes[j];

             // "Hover to show original" is enabled
            if (showOriginal.isEnabled) {
               // Wrap the text node with a font tag
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

             // Store the node's original text for restoration
            const toRestore = {
               original: originalTextNode,  // Original text node
               originalText: originalTextNode.textContent, // Original text
               node: nodes[j],  // Text node (when "hover to show original" is enabled, this is the wrapped text node; otherwise, the original text node)
               translatedText: translated,  // Translated text
            };
            nodesToRestore.push(toRestore);

             // Handle custom translation
            handleCustomWords(
              translated,
              nodes[j].textContent,
              currentPageTranslatorService,
              currentTargetLanguage
            ).then((results) => {
               // If the node has been hidden by AI translation (display: none), skip updating
               // This avoids overwriting the hide operation in applyAiTranslatingState
              if (nodes[j].nodeType === 1 && nodes[j].style?.display === "none") {
                return;
              }
               // Set the text node's text value to the translated text
              // nodes[j].textContent = results;
              nodes[j].textContent = results;
              applyTranslatedColorToNode(nodes[j]);
              toRestore.translatedText = results;
            });
          }

        }
      }
    } else {
      for (const i in piecesToTranslateNow) {
        for (const j in piecesToTranslateNow[i].nodes) {
          if (results[i][j]) {
            const nodes = piecesToTranslateNow[i].nodes;
            const translated = results[i][j] + " ";

            const originalTextNode = nodes[j];

             // "Hover to show original" is enabled
            if (showOriginal.isEnabled) {
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

             // Store the node's original text for restoration
            const toRestore = {
              node: nodes[j],
              original: originalTextNode,
              originalText: originalTextNode.textContent,
              translatedText: translated,
            };
            nodesToRestore.push(toRestore);

             // Handle custom translation
            handleCustomWords(
              translated,
              nodes[j].textContent,
              currentPageTranslatorService,
              currentTargetLanguage
            ).then((results) => {
               // Set the text node's text value to the translated text
              nodes[j].textContent = results;
              applyTranslatedColorToNode(nodes[j]);
              toRestore.translatedText = results;
            });
          }
        }
      }
    }
    mutationObserver.takeRecords();
  }


  /**
    * Add translated text to an existing translatedElement node
   * 
    * @param {*} piecesToTranslateNow nodes to translate
    * @param {*} results translation results. Structure is a two-dimensional array.
   */
  async function addTranslatedContent(piecesToTranslateNow, results) {
    console.log("piecesToTranslateNow:", piecesToTranslateNow)
    console.log("results:", results)
    for (const i in piecesToTranslateNow) {
      try {
         // Get reference to the <translated> element
        const translatedElement = piecesToTranslateNow[i].translatedElement
        if (!translatedElement) {
          continue
        }

         // Set styles
        // translatedElement.classList.add("columnified")
        translatedElement.style.display = "block"
        translatedElement.classList.add("dualtran-result-container")

        // translatedElement.style.marginTop = "4px"
        // translatedElement.style.marginBottom = "4px"
        translatedElement.style.paddingTop = "4px"
        // translatedElement.style.paddingBottom = "4px"
        // translatedElement.style.backgroundColor = "rgba(255,255,0,0.15)"
        // translatedElement.style.opacity = "0.75"
        applyTranslatedColorToNode(translatedElement)

         // Force left/right padding to match parent (when parent is inline, its padding cannot affect block-type children, so manually set padding to inherit)
        if (translatedElement.parentNode.style.display.includes("inline")) {
          translatedElement.style.paddingLeft = "inherit"
          translatedElement.style.paddingRight = "inherit"
        }

         // Remove height limits
        if (!hasVideoInPage) {
          let parentNode = translatedElement.parentNode
          let shouldRemoveHeightLimit = false
          do {
            parentNode?.classList?.add?.('unlimit-height')
            parentNode?.classList?.add?.('unlimit-height-2')
            parentNode = parentNode?.parentNode || parentNode?.parentElement
            try {
              shouldRemoveHeightLimit = (parentNode.nodeName !== "BODY" && !(['scroll', 'auto'].includes(window.getComputedStyle(parentNode).overflowY)))
            } catch (e) {
               console.log("Error removing height limit:", e)
              shouldRemoveHeightLimit = false
            }
          } while (shouldRemoveHeightLimit)
        }
         // dontSortResults: true: use translated node order; false: maintain original HTML node order (re-sorted results)
        if (dontSortResults) {
           // If there was only one element before translation
          if (piecesToTranslateNow[i].nodes.length === 1) {
             // If the type is code or kbd element
            if (["code", "kbd"].includes(piecesToTranslateNow[i].nodes[0].parentNode?.nodeName.toLowerCase())
               // Or the text before and after translation is identical and the translation color is the original color
              // || (['','rgba(0, 0, 0, 1)'].includes(twpConfig.get("translatedColor")) && piecesToTranslateNow[i].nodes[0]?.textContent === results[i].reduce((accumulated, item) => { return "" + accumulated + item }))
            ) {
               // Then hide the translatedElement node
              translatedElement.style.display = "none"
              continue
            }
          }

           // If the translation color is the original color
          if (['', 'rgba(0, 0, 0, 1)'].includes(twpConfig.get("translatedColor"))) {
             // If the text before and after translation is identical, hide the translatedElement node
            let same = true
            for (let k = 0; k < results[i].length; k++) {
              if (results[i][k].trim() !== piecesToTranslateNow[i].nodes[k].textContent.trim()) {
                same = false
                break
              }
            }
            if (same) {
              translatedElement.style.display = "none"
              continue
            }
          }

           // Concatenate translated text

          let finalResults = ""
          for (let k = 0; k < results[i].length; k++) {

             // Since results array length may be longer than piecesToTranslateNow[i].nodes array length, the following approach won't work (piecesToTranslateNow[i].nodes[k] may not exist)
            // let nodeName = piecesToTranslateNow[i].nodes[k].parentNode.nodeName.toLowerCase()
             // // If it is a code or kbd node
            // if (["code", "kdb"].includes(nodeName)) {
             //   // Copy the node directly (regardless of translation)
            //   translatedElement.appendChild(piecesToTranslateNow[i].nodes[k].parentNode.cloneNode(true))
            // } else {
            //   const translated = results[i][k]
             //   // Run through custom dictionary again
            //   finalResults = await handleCustomWords(
            //     translated,
            //     piecesToTranslateNow[i].nodes[k].textContent,
            //     currentPageTranslatorService,
            //     currentTargetLanguage
            //   )
             //   // Add translated text
            //   translatedElement.appendChild(document.createTextNode(finalResults))
            // }

            const translated = results[i][k]
            if (piecesToTranslateNow[i].nodes[k]) {
              finalResults = finalResults + await handleCustomWords(
                translated,
                piecesToTranslateNow[i].nodes[k].textContent,
                currentPageTranslatorService,
                currentTargetLanguage
              )
            } else {
              finalResults = finalResults + translated
            }
          }
          const translatedTextNode = document.createTextNode(finalResults)
          // Dual-span: create separate Google and AI spans inside <translated>
          const googleSpan = document.createElement("span")
          googleSpan.className = "dualtran-google"
          googleSpan.textContent = finalResults
          const aiSpan = document.createElement("span")
          aiSpan.className = "dualtran-ai"
          aiSpan.style.display = "none"
          translatedElement.appendChild(googleSpan)
          translatedElement.appendChild(aiSpan)

           // Add inline button group (Google + AI)
          let sourceString = piecesToTranslateNow[i].nodes.reduce((accumulator, currentNode) => accumulator + currentNode.textContent, "")
           // Use shouldTriggerAiImprove instead of inline expression to ensure consistent behavior between newLine and replaceOriginal modes
          if (shouldTriggerAiImprove(wordsCount(finalResults), twpConfig.get("aiImproveForLongerThan"))) {
            ensureSingletonInit();
            registerBlock(
              translatedElement, sourceString, googleSpan,  // translatedTextNode points to googleSpan for backward compat
              finalResults, // Store Google translation for restoration
              null, // No nodes to clear in new-line mode
              { googleSpan, aiSpan }
            );
          }
        }
         // dontSortResult: true: use translated node order; false: maintain original HTML node order (re-sorted results)
        else {
           // TODO: Sometimes results array is longer than piecesToTranslateNow[i] array, e.g., one English sentence translated into two Chinese sentences. Need to add handling logic for this case.

          const allChildNodes = piecesToTranslateNow[i].nodesToBeInTranslatedNode
          for (let k = 0; k < allChildNodes.length; k++) {
            const node = allChildNodes[k]

            let m = piecesToTranslateNow[i].nodes.indexOf(node)

             // If the node needs to be translated
            if (m > -1) {
               // Get the machine translation result
              const translated = results[i][m] + " ";
               // Run through custom dictionary again
              const finalResults = await handleCustomWords(
                translated,
                piecesToTranslateNow[i].nodes[m].textContent,
                currentPageTranslatorService,
                currentTargetLanguage
              )
               // Add translated text
              translatedElement.appendChild(document.createTextNode(finalResults))
            }
             // If the node does not need translation
            else {
               // Copy the node directly
              translatedElement.appendChild(node.cloneNode(true))
            }
          }
        }

         // "Hover to show original" is enabled — register the translated block
         // with its original (source-language) text so hovering the translation
         // pops up the original. This is the newLine-mode counterpart of the
         // per-source-node registration in translateResults (replaceOriginal mode).
        if (showOriginal.isEnabled) {
          const originalTextForBlock = piecesToTranslateNow[i].nodes.reduce(
            (accumulator, node) => accumulator + node.textContent,
            ""
          );
          showOriginal.add(translatedElement, originalTextForBlock);
        }

        if (!translatedElement) {
          translatedElement.style.display = "none"
        }
      } catch (e) {
        console.log(e, piecesToTranslateNow[i])
      }
    }
    mutationObserver.takeRecords();
  }

  /**
    * Replace attribute text with translated attribute text
   * @param {*} attributesToTranslateNow 
   * @param {*} results 
   */
  function translateAttributes(attributesToTranslateNow, results) {
    for (const i in attributesToTranslateNow) {
      const ati = attributesToTranslateNow[i];
      try {
        ati.node.setAttribute(ati.attrName, results[i]);
      } catch (e) {
        console.log(e)
      }
    }
  }

  let pendingGoogleBatches = 0;
  function updateGoogleRenderState() {
    if (pageLanguageState !== "translated") return;
    if (pendingGoogleBatches > 0) {
      setPageRenderState("loading");
    } else if (hadGoogleTranslationError) {
      setPageRenderState("idle");
    } else {
      setPageRenderState("success");
    }
  }

  /**
    * Every 600ms, find nodes in piecesToTranslate and attributesToTranslate arrays that are in the visible screen area, and translate them
    * This iterates element coordinates rather than using intersectionObserver — not sure why??? (possibly for easier coding or compatibility)
   */
  function translateDynamically() {
    try {
      if (piecesToTranslate && pageIsVisible) {
        (function () {
          const innerHeight = window.innerHeight;

          /**
            * Check if the element is completely within the screen
           * @param {*} element 
           * @returns {boolean}
           */
          function isInScreen(element) {
            const rect = element.getBoundingClientRect();
            if (
              (rect.top > 0 && rect.top <= innerHeight) ||
              (rect.bottom > 0 && rect.bottom <= innerHeight)
            ) {
              return true;
            }
            return false;
          }

          /**
            * Check if the element's top is visible on screen
           * @param {*} element 
           * @returns {boolean}
           */
          function topIsInScreen(element) {
            if (!element) {
              // debugger;
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.top > 0 && rect.top <= innerHeight) {
              return true;
            }
            return false;
          }

          /**
            * Check if the element's bottom is visible on screen
           * @param {*} element 
           * @returns {boolean}
           */
          function bottomIsInScreen(element) {
            if (!element) {
              // debugger;
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.bottom > 0 && rect.bottom <= innerHeight) {
              return true;
            }
            return false;
          }

          const currentFooCount = fooCount;

           // Select untranslated elements from piecesToTranslate array that are in the visible screen area, put them in piecesToTranslateNow array
          const piecesToTranslateNow = [];
          piecesToTranslate.forEach((ptt) => {
            if (!ptt.isTranslated) {
              // if (
              //   bottomIsInScreen(ptt.topElement) ||
              //   topIsInScreen(ptt.bottomElement)
              // ) {
              //   ptt.isTranslated = true;
              //   piecesToTranslateNow.push(ptt);
              // }
              ptt.isTranslated = true;
              piecesToTranslateNow.push(ptt);
              let time = new Date()
               console.log(time.getHours() + ":" + time.getMinutes() + ":" + time.getSeconds() + "   " + "New nodes need translation!")
            }
          });

           // Select untranslated elements from attributesToTranslate array that are in the visible screen area, put them in attributesToTranslateNow array
          const attributesToTranslateNow = [];
          attributesToTranslate.forEach((ati) => {
            if (!ati.isTranslated) {
              if (isInScreen(ati.node)) {
                ati.isTranslated = true;
                attributesToTranslateNow.push(ati);
              }
            }
          });

          if (piecesToTranslateNow.length > 0) {
            pendingGoogleBatches++;
            updateGoogleRenderState();

             // Translate node list
            let array2d = piecesToTranslateNow.map((ptt) =>
              ptt.nodes.map((node) => filterKeywordsInText(node.textContent))
            )
            backgroundTranslateHTML(
              currentPageTranslatorService,
              currentTargetLanguage,
              array2d,
              dontSortResults
            ).then(async (results) => {
              if([undefined, null].includes(results) || (results instanceof Array && results.length === 0)){
                hadGoogleTranslationError = true
                emitDualTranDebugLog("error", "[DualTran][UnknownTranslationError]", {
                  translationService: currentPageTranslatorService,
                  targetLanguage: currentTargetLanguage,
                  pieceCount: piecesToTranslateNow.length,
                  requestPreview: array2d.slice(0, 5).map((row) => row.join(" ").slice(0, 160)),
                  rawResults: results,
                });
                Toastify({
                  text: chrome.i18n.getMessage("errorTranslationUnknown"),
                  duration: 2500,
                  newWindow: true,
                  close: true,
                  gravity: "top", // `top` or `bottom`
                  position: "left", // `left`, `center` or `right`
                  stopOnFocus: true, // Prevents dismissing of toast on hover
                  style: {
                    background: "linear-gradient(to bottom, red, darkred)",
                    fontSize: "12px"
                  },
                  onClick: function () { } // Callback after click
                }).showToast();
              }
              if (
                pageLanguageState === "translated" &&
                currentFooCount === fooCount
              ) {
                if (!hadGoogleTranslationError) {
                  console.log("array2d:", array2d)
                  console.log("translated results:", results)

                  twpConfig.get("whereToDisplayTranslatedText") === "newLine"
                     // Add translated text child node
                    ? await addTranslatedContent(piecesToTranslateNow, results)
                     // Replace original node text with translated node text
                    : await translateResults(piecesToTranslateNow, results);
                }
              }
            })
            .catch((e) => {
              hadGoogleTranslationError = true
              emitDualTranDebugLog("error", "[DualTran][TranslateHTMLCatch]", {
                translationService: currentPageTranslatorService,
                targetLanguage: currentTargetLanguage,
                pieceCount: piecesToTranslateNow.length,
                requestPreview: array2d.slice(0, 5).map((row) => row.join(" ").slice(0, 160)),
                errorMessage: e?.message,
                errorName: e?.name,
              });
              Toastify({
                text: chrome.i18n.getMessage("errorTranslationWithMessage", [e.message]),
                duration: 2500,
                newWindow: true,
                close: true,
                gravity: "top", // `top` or `bottom`
                position: "left", // `left`, `center` or `right`
                stopOnFocus: true, // Prevents dismissing of toast on hover
                style: {
                  background: "linear-gradient(to bottom, red, darkred)",
                  fontSize: "12px"
                },
                onClick: function () { } // Callback after click
              }).showToast();
            }).finally(() => {
              pendingGoogleBatches--;
              updateGoogleRenderState();
            });
          }

          if (attributesToTranslateNow.length > 0) {
             // Translate attribute list
            backgroundTranslateText(
              currentPageTranslatorService,
              currentTargetLanguage,
              attributesToTranslateNow.map((ati) => ati.original)
            ).then((results) => {
              if (
                pageLanguageState === "translated" &&
                currentFooCount === fooCount
              ) {
                 // Replace attribute text with translated attribute text
                translateAttributes(attributesToTranslateNow, results);
              }
            });
          }



        })();
      }
    } catch (e) {
      console.error(e);
    }
    setTimeout(translateDynamically, translationInterval);
  }

  translateDynamically();

  function updateAiRenderStateInternal() {
    if (pageLanguageState !== "translated") return;
    let allProxies = getAllProxies();
    let allTranslating = allProxies.filter(p => ["queuing", "translating"].includes(p.translationStatus));
    let toBeTranslated = allProxies.filter(p => !["queuing", "translating", "translated", "userPinned"].includes(p.translationStatus));

    const nextState = resolveNextAiRenderState(
      aiRenderState,
      allTranslating.length,
      toBeTranslated.length,
      allProxies.length
    );
    if (nextState !== null) {
      setAiRenderState(nextState);
    }
  }

   // Auto-translate with AI.
   // Note: Since this is a cross-origin request, the browser will send a preflight request. Unfortunately, OpenAI also counts preflight requests as valid... making rate limits easier to trigger
  //
   // shouldForceAiAfterPageTranslation semantics:
   // Set to true when the user clicks the AI button, and remains true for the entire page session,
   // so that subsequently loaded dynamic content (e.g., x.com feed, infinite scroll pages) is also automatically AI-translated.
   // Only reset to false in the following cases:
   //   1. restorePage() — user actively restores original text
   //   2. pageTranslator.stopAiAutoTranslate() — user switches from AI translation to Google translation
   //   3. translatePageAi() detects no API key — unable to perform AI translation
  async function aiTranslateDynamically() {
    console.log("aiTranslateDynamically() is called")
    updateAiRenderStateInternal();
    try {
      openAiRateLimitCountDown = openAiRateLimitCountDown - aiTranslationInterval
      if (_shouldSkipAiTranslation(hasActiveProviderApiKey(), openAiRateLimitCountDown, shouldForceAiAfterPageTranslation)) {
        clearTimeout(timerAiTran)
        timerAiTran = setTimeout(aiTranslateDynamically, aiTranslationInterval);
        return
      }
      let toBeTranslated = getProxiesForTranslation();
      if (!toBeTranslated.length) {
        console.log("[AI-STATE] no blocks to translate")
        clearTimeout(timerAiTran)
        timerAiTran = setTimeout(aiTranslateDynamically, aiTranslationInterval);
        return
      }

      console.log("[AI-STATE] aiTranslateDynamically: translating " + toBeTranslated.length + " blocks")
      await aiTranslateText(toBeTranslated)
      console.log("[AI-STATE] aiTranslateDynamically: aiTranslateText returned")
       // Note: shouldForceAiAfterPageTranslation is NOT reset here.
       // Keep it as true so subsequently loaded dynamic content is also automatically AI-translated.
      updateAiRenderStateInternal()
    } catch (e) {
      console.error(e)
    }
    clearTimeout(timerAiTran)
    timerAiTran = setTimeout(aiTranslateDynamically, aiTranslationInterval);
  }

  aiTranslateDynamically()

  function translatePageTitle() {
    const title = document.querySelector("title");
    if (
      title &&
      (title.classList.contains("notranslate") ||
        title.getAttribute("translate") === "no")
    ) {
      return;
    }
    if (document.title.trim().length < 1) return;
    originalPageTitle = document.title;

    backgroundTranslateSingleText(
      currentPageTranslatorService,
      currentTargetLanguage,
      originalPageTitle
    ).then((result) => {
      if (result) {
        document.title = result;
      }
    });
  }

  const pageLanguageStateObservers = [];
  pageTranslator.onPageLanguageStateChange = function (callback) {
    pageLanguageStateObservers.push(callback);
  };

  let pageRenderState = "idle";
  const pageRenderStateObservers = [];
  pageTranslator.onPageRenderStateChange = function (callback) {
    pageRenderStateObservers.push(callback);
  };

  pageTranslator.onAiRenderStateChange = function (callback) {
    aiRenderStateObservers.push(callback);
  };

  /**
    * Stop AI auto-translate mode.
    * Reset the shouldForceAiAfterPageTranslation flag so that subsequently loaded dynamic content is no longer automatically AI-translated.
    * Used when the user actively switches from AI translation to Google translation.
    * Note: restorePage() already includes this reset internally, so no extra call is needed when restoring original text.
   */
  pageTranslator.stopAiAutoTranslate = function () {
    shouldForceAiAfterPageTranslation = false;
  };

  /**
   * Show only Google translations (hide AI spans). Called when user clicks Google button
   * while AI is active — switches from AI view to Google-only view without re-translating.
   */
  pageTranslator.showGoogleOnly = function () {
    getAllProxies().forEach((p) => {
      // Per-block logic lives in aiUiState.applyShowGoogleOnlyState so the
      // replaceOriginal-mode restoration bug is locked down by a unit test
      // at the same seam the bug occurs.
      applyShowGoogleOnlyState(p, nodesToRestore);
    });
    shouldForceAiAfterPageTranslation = false;
  };

  function setPageRenderState(state) {
    if (pageRenderState !== state) {
      pageRenderState = state;
      pageRenderStateObservers.forEach((cb) => cb(state));
    }
  }  

  pageTranslator.translatePageAi = function (targetLanguage) {
    if (!hasActiveProviderApiKey()) {
      shouldForceAiAfterPageTranslation = false;
      promptToConfigureAiProvider();
      return false;
    }

    shouldForceAiAfterPageTranslation = true;
     // User actively clicks AI button → clear the rate limit countdown after clearing errors,
     // otherwise _shouldSkipAiTranslation will skip the request due to rateLimitCountdown > 0
    openAiRateLimitCountDown = 0;
    setAiRenderState("loading");
    if (pageLanguageState === "original") {
      pageTranslator.translatePage(targetLanguage);
    } else {
       // Page is already translated (e.g., by Google) → reset error blocks to idle,
       // otherwise getProxiesForTranslation() will filter out blocks in translationError state,
       // causing aiTranslateDynamically() to have no blocks to translate and not send requests
      getAllProxies().forEach((p) => {
        if (p.translationStatus === "translationError" || p.translationStatus === "userPinned") {
          p.translationStatus = "idle";
        }
      });
      // If already translated, force AI on remaining un-AI-translated nodes
      aiTranslateDynamically();
    }
    return true;
  };

  /**
    * Translate the entire page
   * @param {*} targetLanguage 
   */
  pageTranslator.translatePage = function (targetLanguage) {
    const shouldForceAiForThisRun = shouldForceAiAfterPageTranslation
    fooCount++;
     // Restore original page
    pageTranslator.restorePage();
    shouldForceAiAfterPageTranslation = shouldForceAiForThisRun
    hadGoogleTranslationError = false
    pendingGoogleBatches = 0
    setPageRenderState("loading")
    setAiRenderState(shouldForceAiAfterPageTranslation ? "loading" : "idle")
     // Enable hover-to-show-original text
    showOriginal.enable();
     // Remove erroneous translations
    chrome.runtime.sendMessage({ action: "removeTranslationsWithError" });

     // true: use translated node order; false: maintain original HTML node order (re-sorted results)
    dontSortResults = resolveDontSortResults(twpConfig.get("dontSortResults"));

    if (targetLanguage) {
      currentTargetLanguage = targetLanguage;
    } else {
      currentTargetLanguage = twpConfig.get("targetLanguage")
    }

     // Get info list for all nodes to translate (one-dimensional array)
    piecesToTranslate = getPiecesToTranslate();

     // Get info list for all attributes to translate (one-dimensional array)
    attributesToTranslate = getAttributesToTranslate();

    pageLanguageState = "translated";
    chrome.runtime.sendMessage({
      action: "setPageLanguageState",
      pageLanguageState,
    });
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = currentTargetLanguage;

     // Translate title
    translatePageTitle();

     // Listen for node changes
    enableMutatinObserver();

     // Translate nodes and attributes (with setTimeout timer)
    translateDynamically();
  };

   // Restore original page
  pageTranslator.restorePage = function () {
    shouldForceAiAfterPageTranslation = false;
    hadGoogleTranslationError = false;
    pendingGoogleBatches = 0;
    setPageRenderState("idle");
    setAiRenderState("idle");
     // User actively restores original text; clear AI translation marker to avoid auto-triggering AI translation on back navigation
    removeAiAppliedFlag();
     // Remove all <translated> elements
    document.querySelectorAll("translated").forEach((node) => { node.parentNode.removeChild(node); node = null })

     // Remove all inline button groups (including their AI and Google buttons)
     // Destroy the singleton button group
    destroySingletonButtonGroup();
    singletonInitialized = false;
     // Remove all leftover AI buttons
    document.querySelectorAll(".dualtran-ai-btn").forEach((node) => { if (node.parentNode) node.parentNode.removeChild(node); node = null })

     // Remove all AI translated text in inline replacement mode
    document.querySelectorAll(".dualtran-aitranslatedtext-replacemode").forEach((node) => { node.parentNode.removeChild(node); node = null })

     // Remove all unlimit-height classes
    document.querySelectorAll(".unlimit-height").forEach((node) => { node.classList.remove('unlimit-height') })
    document.querySelectorAll(".unlimit-height-2").forEach((node) => { node.classList.remove('unlimit-height-2') })

    fooCount++;
    piecesToTranslate = [];

     // Disable hover-to-show-original text (because we are already on the original page)
    showOriginal.disable();

     // Stop listening for node changes
    disableMutatinObserver();

    pageLanguageState = "original";
    chrome.runtime.sendMessage({
      action: "setPageLanguageState",
      pageLanguageState,
    });

     // Call all callbacks listening for "pageLanguageState" change events
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = originalTabLanguage;

    if (originalPageTitle) {
      document.title = originalPageTitle;
    }
    originalPageTitle = null;

    for (const ntr of nodesToRestore) {
       // If the current element is the same as the original element
      if (ntr.node === ntr.original) {
         // // If the current element content is translated text
        // if (ntr.node.textContent === ntr.translatedText) {
         //   // Replace translated text with original text
        //   ntr.node.textContent = ntr.originalText;
        // }
        ntr.node.textContent = ntr.originalText;
      }
       // Current element is different from original element
      else {
         // Replace current element with original element
        ntr.node.replaceWith(ntr.original);
      }
    }
    nodesToRestore = [];

    //TODO do not restore attributes that have been modified
    for (const ati of attributesToTranslate) {
      if (ati.isTranslated) {
        ati.node.setAttribute(ati.attrName, ati.original);
      }
    }
    attributesToTranslate = [];
  };

  /**
    * Switch translation service
   */
  pageTranslator.swapTranslationService = function () {
    if (currentPageTranslatorService === "google") {
      currentPageTranslatorService = "yandex";
    } else {
      currentPageTranslatorService = "google";
    }
    if (pageLanguageState === "translated") {
      pageTranslator.translatePage();
    }
  };

   // Expose internal functions for testing (following the precedent of resolveDontSortResults / shouldTriggerAiImprove)
   /** @internal — for testing translateResults and addTranslatedContent behavior */
  pageTranslator._translateResults = translateResults;
   /** @internal — for testing */
  pageTranslator._addTranslatedContent = addTranslatedContent;
   /** @internal — for testing getPiecesToTranslate DOM parsing behavior */
  pageTranslator._getPiecesToTranslate = getPiecesToTranslate;
   /** @internal — for testing custom dictionary filtering */
  pageTranslator._filterKeywordsInText = filterKeywordsInText;
   /** @internal — for testing custom dictionary replacement */
  pageTranslator._handleCustomWords = handleCustomWords;
   /** @internal — for testing AI button click handling */
  pageTranslator._handleSingletonAiClick = handleSingletonAiClick;
   /** @internal — for testing Google button click handling */
  pageTranslator._handleSingletonGoogleClick = handleSingletonGoogleClick;
   /** @internal — for testing viewport-aware translation */
  pageTranslator._translateDynamically = translateDynamically;
   /** @internal — for testing provider → model mapping */
  pageTranslator._getModelForProvider = getModelForProvider;
   /** @internal — for testing AI continuous translation mode (detects "dynamic content AI translation failure" regressions) */
  pageTranslator._aiTranslateDynamically = aiTranslateDynamically;
   /** @internal — for testing: set shouldForceAiAfterPageTranslation internal state */
  pageTranslator._setForceAiTranslation = (v) => { shouldForceAiAfterPageTranslation = v; };
   /** @internal — for testing per-block restore: replace the nodesToRestore array */
  pageTranslator._setNodesToRestoreForTest = (arr) => { nodesToRestore = arr; };

  let alreadyGotTheLanguage = false;
   // Callback function for when tab language is detected
  const observersOnTabLanguageDetected = [];

  /**
    * Call callback or add callback for "get tab language" message
   * @param {Function} callback 
   */
  pageTranslator.onGetOriginalTabLanguage = function (callback) {
    if (alreadyGotTheLanguage) {
      callback(originalTabLanguage);
    } else {
      observersOnTabLanguageDetected.push(callback);
    }
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translatePage") {
      if (request.targetLanguage === "original") {
        pageTranslator.restorePage();
      } else {
        pageTranslator.translatePage(request.targetLanguage);
      }
    } else if (request.action === "restorePage") {
      pageTranslator.restorePage();
    } else if (request.action === "getOriginalTabLanguage") {
      pageTranslator.onGetOriginalTabLanguage(function () {
        sendResponse(originalTabLanguage);
      });
      return true;
    } else if (request.action === "getCurrentPageLanguage") {
      sendResponse(currentPageLanguage);
    } else if (request.action === "getCurrentPageLanguageState") {
      sendResponse(pageLanguageState);
    } else if (request.action === "getCurrentPageTranslatorService") {
      sendResponse(currentPageTranslatorService);
    } else if (request.action === "swapTranslationService") {
      pageTranslator.swapTranslationService();
    } else if (request.action === "toggle-translation") {
      if (pageLanguageState === "translated") {
        pageTranslator.restorePage();
      } else {
        pageTranslator.translatePage();
      }
    } else if (request.action === "translate-page-google") {
      pageTranslator.translatePage();
    } else if (request.action === "translate-page-ai") {
      pageTranslator.translatePageAi();
    } else if (request.action === "restore-original") {
      pageTranslator.restorePage();
    } else if (request.action === "autoTranslateBecauseClickedALink") {
      if (twpConfig.get("autoTranslateWhenClickingALink") === "yes") {
        pageTranslator.onGetOriginalTabLanguage(function () {
          if (
            pageLanguageState === "original" &&
            originalTabLanguage !== currentTargetLanguage &&
            twpConfig
              .get("neverTranslateLangs")
              .indexOf(originalTabLanguage) === -1
          ) {
            pageTranslator.translatePage();
          }
        });
      }
    }
  });

  // Requests the detection of the tab language in the background

   // Main frame
  if (window.self === window.top) {
    // is main frame
    const onTabVisible = function () {
      chrome.runtime.sendMessage(
        {
          action: "detectTabLanguage",
        },
        (result) => {
          result = result || "und";
          if (result === "und") {
            originalTabLanguage = result;
            if (
              twpConfig.get("alwaysTranslateSites").indexOf(tabHostName) !== -1
            ) {
              pageTranslator.translatePage();
            }
          } else {
            const langCode = twpLang.fixTLanguageCode(result);
            if (langCode) {
              originalTabLanguage = langCode;
            }
            if (
              location.hostname === "translatewebpages.org" &&
              location.href.indexOf("?autotranslate") !== -1 &&
              twpConfig.get("neverTranslateSites").indexOf(tabHostName) === -1
            ) {
              pageTranslator.translatePage();
            } else {
              if (
                location.hostname !== "translate.googleusercontent.com" &&
                location.hostname !== "translate.google.com" &&
                location.hostname !== "translate.yandex.com"
              ) {
                if (
                  pageLanguageState === "original" &&
                  !platformInfo.isMobile.any &&
                  !chrome.extension.inIncognitoContext
                ) {
                  if (
                    twpConfig
                      .get("neverTranslateSites")
                      .indexOf(tabHostName) === -1
                  ) {
                    if (
                      langCode &&
                      langCode !== currentTargetLanguage &&
                      twpConfig
                        .get("alwaysTranslateLangs")
                        .indexOf(langCode) !== -1
                    ) {
                      pageTranslator.translatePage();
                    } else if (
                      twpConfig
                        .get("alwaysTranslateSites")
                        .indexOf(tabHostName) !== -1
                    ) {
                      pageTranslator.translatePage();
                    }
                  }
                }
              }
            }
          }

          observersOnTabLanguageDetected.forEach((callback) => callback(originalTabLanguage));
          alreadyGotTheLanguage = true;

           // If sessionStorage has an AI translation marker (indicating this page was previously AI-translated),
           // and the page is currently untranslated, force call translatePage() to restore translation.
           // This handles the scenario where a page is reloaded after Turbo/pjax navigation back:
           // the page is fresh original HTML, but the user had previously translated it, so translation should be auto-restored.
          if (needAutoTranslateFromSession && pageLanguageState === "original") {
            console.log("[AI-STATE] onTabVisible: auto-restoring translation from sessionStorage flag");
            pageTranslator.translatePage();
          }
        }
      );
    };
     // Safety fallback: if the pageshow event fired before the pageshow listener was registered,
     // supplement the sessionStorage marker check here to ensure shouldForceAiAfterPageTranslation
     // is correctly set before onTabVisible → translatePage.
     // Also record the "needs auto-translation" flag so that translatePage() is forced in onTabVisible.
    const needAutoTranslateFromSession = checkAiAppliedFlag();
    if (needAutoTranslateFromSession) {
      console.log("[AI-STATE] init: restoring shouldForceAiAfterPageTranslation from sessionStorage");
      shouldForceAiAfterPageTranslation = true;
      setAiRenderState("loading");
    }
     // Listen for main page visibility and set up visibility change callback
    setTimeout(function () {
      if (document.visibilityState == "visible") {
        onTabVisible();
      } else {
        const handleVisibilityChange = function () {
          if (document.visibilityState == "visible") {
            document.removeEventListener(
              "visibilitychange",
              handleVisibilityChange
            );
            onTabVisible();
          }
        };
        document.addEventListener(
          "visibilitychange",
          handleVisibilityChange,
          false
        );
      }
    }, 120);
  }
   // Non-main frame
  else {
    // is subframe (iframe)
    chrome.runtime.sendMessage(
      {
        action: "getMainFrameTabLanguage",
      },
      (result) => {
        originalTabLanguage = result || "und";
        observersOnTabLanguageDetected.forEach((callback) => callback(originalTabLanguage));
        alreadyGotTheLanguage = true;
      }
    );

     // Get main frame state
    chrome.runtime.sendMessage(
      {
        action: "getMainFramePageLanguageState",
      },
      (result) => {
        if (result === "translated" && pageLanguageState === "original") {
          pageTranslator.translatePage();
        }
      }
    );
  }

  showOriginal.enabledObserverSubscribe(function () {
    if (pageLanguageState !== "original") {
      pageTranslator.translatePage();
    }
  });
});

window.addEventListener("beforeunload", (event) => {
   console.log("beforeunload event triggered")
  abortControllers.forEach((controller) => {
    controller.abort()
  })
});

export { backgroundTranslateSingleText, pageTranslator, aiTranslateText, _shouldSkipAiTranslation, getAiAppliedStorageKey, saveAiAppliedFlag, checkAiAppliedFlag, removeAiAppliedFlag, _registerAiForShowOriginal }
