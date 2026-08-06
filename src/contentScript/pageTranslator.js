/**
 * 页面翻译主脚本
 */

// DONE: 当译文颜色不为原色(默认色)时,即使译文和原文完全相同,仍然显示译文
// DONE: 某些情况下, 父元素高度会不够大. 这是由于某些高层父元素的高度限制未去除. 现已去除全部高层元素的高度限制
// DONE: 当文本节点的父元素是flex元素时, 会造成translated元素不换行显示, 优化之
// DONE: 父元素是inline-flex时,子元素会style.display的值会变成block,但实际上并没有新建行,在判断isNewLine时要特殊对待
// DONE: https://www.scmp.com/无法滚动的问题
// DONE: 更改目标语言后, 点击floatingBtn仍然使用旧语言(原因:currentTargetLanguage是独立变量,与targetLanguage不一定相同,已更改)
// DONE: 有时候翻译结果并不是目标语言,而是原文(例如在twitter的个人简介页翻译个人简介时, 例子:https://twitter.com/therealbuni). 原因:文本内容违反相关政策. 解决方案:要求chatGPT翻译所有文本包括那些违反相关政策的.
// DONE: 设置options页为大屏显示
// DONE: 整页翻译中,加入openAI
// DONE：划词翻译中添加openAI
// DONE: hfacebook 和 producthunt 有些已翻译的会重新翻译. 应该是网页自身会刷新node的原因. 方法: 建立缓存
// DONE: singleTranslation模式下,无法翻译"English(US)"这段文字. 取消singleTranslation模式, 一律按batchTranslation
// DONE: 划词翻译窗口有时候弹不出来：这是因为原先代码中，获取到翻译结果才弹出窗口，如果没开VPN，就一直获取不到翻译结果，所以一直不弹窗口。已修改。
// DONE: 添加fireFox支持（把chrome.改为browser.）
// DONE: 当translateLongerThan不为0时, 应优化为:仅对单个存在的元素适用, 对于夹在长文中的,不应该适用. 临时解决方案:translateLongerThan默认设置为0。最终解决方案：此问题似乎已经解决

// TODO: 在inline替换翻译时, 如果dontSortResults为no, 会造成链接与译文对不上的问题. 临时解决方案： 一律dontSortResults设为yes，不允许修改
// TODO: 网站的视频界面自定义控件高度被设为unlimit后导致覆盖video. 应优化。 临时解决方案: 遇到有video元素的页面,不设置unlimit-height
// TODO: 某些情况下, 父元素高度会被撑得过大. 主要原因: 在block父元素有多个inline元素时, 如果任何一个inline元素添加block子元素(比如<translated>>),会导致换行(例子:https://developer.chrome.com/docs/extensions/mv3/getstarted/tut-reading-time/). 

// TOOD: 当译文颜色不为原色(默认色)时, 如果译文颜色与背景色过于相似,则更改译文颜色. 参考此文章: https://stackoverflow.com/questions/11867545/change-text-color-based-on-brightness-of-the-covered-background-area
// TODO: 扩展的介绍增加多语言
// TODO：pdf翻译功能

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
  ERROR_CROSS_COLOR,
  formatAiTranslationError,
  renderAiErrorIndicator,
  renderAiSuccessIndicator,
} from "./aiUiState.js"
import {
  getFloatingButtonAiTooltipText,
  getFloatingButtonGoogleTooltipText,
} from "./i18n.js"
import Toastify from 'toastify-js'
import { encode } from 'gpt-tokenizer'
import { wordsCount } from "../util/globalWordsCount.js"
import { registerBlock, createSingletonButtonGroup, destroySingletonButtonGroup, attachHoverDelegation, setCallbacks, getProxiesForTranslation, getAllProxies, getBlockState } from "./singletonBtnGroup.js";

/**
 * 将 dontSortResults 配置值转换为布尔值（纯函数，供测试使用）。
 * @param {string} configValue — twpConfig.get("dontSortResults") 的返回值 ("yes" | "no" | undefined)
 * @returns {boolean}
 */
export function resolveDontSortResults(configValue) {
  return configValue === "yes";
}

/**
 * 判断文本是否应触发 AI 改进（纯函数，供测试使用）。
 * @param {number} wordCount — 文本字数
 * @param {number|string} threshold — aiImproveForLongerThan 配置值
 * @returns {boolean}
 */
export function shouldTriggerAiImprove(wordCount, threshold) {
  const t = parseInt(threshold);
  // threshold=0 表示"始终触发"（与 newLine 模式 addTranslatedContent 的行为一致）
  if (isNaN(t) || t < 0) return false;
  if (t === 0) return wordCount > 0;
  return wordCount > t;
}

/**
 * 解析 AI 渲染状态的下一个值（纯函数，供测试使用）。
 *
 * 调用时机：需要根据当前已注册块的 AI 状态决定全局 AI 按钮状态时。
 * 特别处理 bfcache 恢复场景 —— AI 译文无缓存，bfcache 恢复后动态内容
 * 会被 Google 缓存重新翻译但 AI 翻译缺失，需将过时的 "success"/"error"
 * 纠正为 "idle"。
 *
 * @param {string} currentAiRenderState — 当前 AI 渲染状态 ("idle"|"loading"|"success"|"error")
 * @param {number} translatingCount — 正在翻译的块数量
 * @param {number} toBeTranslatedCount — 待翻译的块数量
 * @param {number} totalBlockCount — 总块数量
 * @returns {string|null} — 新状态，或 null 表示保持当前状态不变
 */
export function resolveNextAiRenderState(currentAiRenderState, translatingCount, toBeTranslatedCount, totalBlockCount) {
  if (translatingCount > 0) {
    return "loading";
  }
  if (totalBlockCount > 0 && toBeTranslatedCount === 0) {
    return "success";
  }
  if (toBeTranslatedCount > 0 && translatingCount === 0) {
    // 存在待翻译块但无正在翻译的块。
    // 如果当前状态是 success/error，说明是 bfcache 恢复等场景下的过时状态
    // —— AI 译文未缓存，动态内容经 Google 缓存翻译后新增了 <translated> 节点，
    // 但这些节点尚未 AI 翻译。此时应将状态纠正为 idle。
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
const translationInterval = 600 // 正常情况下,每隔translationInterval发送一个翻译请求
const aiTranslationInterval = 2500 // 正常情况下,每隔aiTranslationInterval发送一个AI翻译请求
const openAiRateLimitWaitingTime = 10 * 1000 // 当遇到AI翻译接口错误时, 等待openAiRateLimitWaitingTime后才重新开始发送AI翻译请求.
export const abortControllers = []
export const aiCache = []
/* mili-seconds to wait for next openAI request after translation error happened. 
* initial value should be 0 so that translation can be started as soon as page is loaded.
*/
let openAiRateLimitCountDown = 0
let timerAiTran
let hadGoogleTranslationError = false
let shouldForceAiAfterPageTranslation = false

// ── AI 翻译状态持久化（sessionStorage）──────────────────────────
// 用于在 Turbo/pjax 导航后恢复 AI 翻译状态。
// GitHub 等站点使用 Turbo Drive 做 SPA 导航，且设置 turbo-cache-control=no-cache，
// 导致点击回退按钮时 Turbo 重新从服务器获取页面（而非从缓存恢复），
// 新页面的 DOM 不含任何翻译。Mutation Observer 会自动重新翻译 Google 译文，
// 但 AI 译文不会自动触发（因为 shouldForceAiAfterPageTranslation 已被上次翻译完成后重置为 false）。
// 通过在 sessionStorage 中记录"此 URL 曾被 AI 翻译过"的标记，
// 在 popstate / pageshow 时恢复 shouldForceAiAfterPageTranslation，使 AI 翻译自动重新触发。
const AI_APPLIED_KEY_PREFIX = "dualtran:aiApplied:";

/** 获取当前页面 URL 对应的 sessionStorage 键名 */
function getAiAppliedStorageKey() {
  return AI_APPLIED_KEY_PREFIX + location.origin + location.pathname;
}

/** 标记当前页面已被 AI 翻译过（在 AI 译文应用成功后调用） */
function saveAiAppliedFlag() {
  try {
    sessionStorage.setItem(getAiAppliedStorageKey(), "true");
  } catch (_) {
    // sessionStorage 不可用时静默降级
  }
}

/** 检查当前页面是否曾被 AI 翻译过，不消费标记 */
function checkAiAppliedFlag() {
  try {
    return sessionStorage.getItem(getAiAppliedStorageKey()) === "true";
  } catch (_) {
    return false;
  }
}

/** 清除当前页面的 AI 翻译标记（在用户点击"恢复原文"时调用） */
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
 * newLine 模式下，将 AI 译文颜色应用到包含 translatedTextNode 的 <translated> 元素上。
 * replaceOriginal 模式下跳过（使用原文颜色）。
 * @param {object} btnAi - BtnAiProxy 或类似对象，需有 translatedTextNode 属性
 * @param {string} aiColor - AI 译文颜色值
 */
function _applyAiColorToTranslatedElement(btnAi, aiColor) {
  try {
    if (!aiColor || ["", "rgba(0, 0, 0, 1)", undefined, null].includes(aiColor)) return;
    const ttn = btnAi?.translatedTextNode;
    if (!ttn) return;
    // replaceOriginal 模式下不应用 AI 颜色（使用原文颜色）
    // 通过检查 nodesToClear 是否存在来区分模式：newLine 模式 nodesToClear 为 null
    const blockState = btnAi?._st ? btnAi._st() : null;
    if (blockState && Array.isArray(blockState.nodesToClear) && blockState.nodesToClear.length > 0) return;
    // 向上查找 <translated> 元素并设置 AI 译文颜色
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
 * 获取指定 provider 的当前模型名称（三层查找）。
 *
 * Tier 1: 专属 config key（仅 7 个主要 provider 有）:
 *   openai→openAiModel, anthropic→anthropicModel, google-gemini→googleGeminiModel,
 *   azure-openai→azureOpenAIModel, deepseek→deepSeekModel, grok→grokModel,
 *   openrouter→openRouterModel
 *
 * Tier 2: providerConfigs 通用存储（适用于所有 provider，尤其是 models.dev 动态注册的）:
 *   twpConfig.get("providerConfigs")?.[providerId]?.model
 *
 * Tier 3: 硬编码 fallback（适用于已知 provider 但上述两级均未设置时）
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
 * 判断是否应跳过 AI 自动翻译（纯决策函数，无副作用，供单元测试使用）。
 * @param {string} autoImproveByAI — twpConfig 中的 "autoImproveByAI" 值（"yes" / "no"）
 * @param {boolean} hasApiKey — 当前提供商是否已配置 API key
 * @param {number} rateLimitCountdown — rate limit 冷却倒计时（毫秒）
 * @param {boolean} shouldForce — shouldForceAiAfterPageTranslation 标志
 * @returns {boolean} true = 跳过 AI 翻译，false = 执行 AI 翻译
 */
function _shouldSkipAiTranslation(autoImproveByAI, hasApiKey, rateLimitCountdown, shouldForce) {
  return rateLimitCountdown > 0 || (autoImproveByAI === "no" && !shouldForce) || !hasApiKey;
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

async function handleSingletonGoogleClick(translatedElement) {
  const state = getBlockState(translatedElement);
  if (!state) return;

  if (state.googleBtnState === "success") {
    state.googleBtnState = "idle";
    if (state.aiStatus === "translated") {
      const cacheItem = aiCache.find(item =>
        state.sourceString === item.original && item.targetLanguage === currentTargetLanguage
      );
      if (cacheItem && state.translatedTextNode) {
        state.translatedTextNode.textContent = cacheItem.translated;
      }
    } else {
      if (state.nodesToClear) {
        state.nodesToClear.forEach((n) => {
          try {
            // 恢复被清空/隐藏的节点
            const restored = nodesToRestore.find((r) => r.node === n);
            if (restored) {
              if (n.nodeType === 3) {
                // 文本节点：恢复内容
                n.textContent = restored.originalText;
                // 恢复被隐藏的父元素（如 <code>）
                const parent = n.parentNode;
                if (parent && parent.nodeType === 1 && parent.style?.display === "none") {
                  parent.style.display = "";
                }
              } else if (n.nodeType === 1) {
                // 元素节点：显示并恢复内容
                n.style.display = "";
                n.textContent = restored.originalText;
              }
            }
          } catch (_) {}
        });
      }
      if (state.translatedTextNode) {
        state.translatedTextNode.textContent = "";
      }
    }
  } else {
    state.googleBtnState = "translating";
    try {
      const result = await backgroundTranslateSingleText(
        "google", currentTargetLanguage, state.sourceString
      );
      if (result) {
        state.googleTranslatedText = result;
        if (state.translatedTextNode) {
          state.translatedTextNode.textContent = result;
        }
        state.googleBtnState = "success";
      }
    } catch (_) {
      state.googleBtnState = "idle";
    }
  }
}

async function handleSingletonAiClick(translatedElement) {
  if (!hasActiveProviderApiKey()) {
    promptToConfigureAiProvider();
    return;
  }

  const state = getBlockState(translatedElement);
  if (!state) return;

  if (state.aiStatus === "translated") {
    // Already translated — reset and restore Google if available
    state.aiStatus = "idle";
    if (state.googleBtnState === "success" && state.translatedTextNode && typeof state.googleTranslatedText === "string") {
      try { state.translatedTextNode.textContent = state.googleTranslatedText; } catch (_) {}
    } else if (state.nodesToClear) {
      // replaceOriginal 模式：恢复原文节点，并清除 AI 译文 span
      if (state.translatedTextNode) {
        try { state.translatedTextNode.textContent = ""; } catch (_) {}
      }
      state.nodesToClear.forEach((n) => {
        try {
          // 恢复被清空/隐藏的节点
          const restored = nodesToRestore.find((r) => r.node === n);
          if (restored) {
            if (n.nodeType === 3) {
              // 文本节点：恢复内容
              n.textContent = restored.originalText;
              // 恢复被隐藏的父元素（如 <code>）
              const parent = n.parentNode;
              if (parent && parent.nodeType === 1 && parent.style?.display === "none") {
                parent.style.display = "";
              }
            } else if (n.nodeType === 1) {
              // 元素节点：显示并恢复内容
              n.style.display = "";
              n.textContent = restored.originalText;
            }
          }
        } catch (_) {}
      });
    }
    return;
  }

  state.aiStatus = "translating";
  // 清除上次错误信息，防止重试成功后残留
  state.errorMessage = undefined;
  try {
    // Build a lightweight proxy with direct state access
    const proxy = {
      _st: () => state,
      get sourceString() { return this._st().sourceString; },
      get translatedTextNode() { return this._st().translatedTextNode; },
      get translationId() { return this._st().translationId; },
      set translationId(v) { this._st().translationId = v; },
      get translationStatus() { return this._st().aiStatus; },
      set translationStatus(v) { this._st().aiStatus = v; },
      get btnAiTxtNode() { return document.createElement("span"); },
      get tooltip() { return document.createElement("span"); },
      get classList() { return { contains: ()=>false, add: ()=>{}, remove: ()=>{} }; },
      get style() { let _c=""; return { set color(v){_c=v}, get color(){return _c} }; },
      get ownerDocument() { return document; },
      setAttribute: () => {},
    };
    await aiTranslateText([proxy], false);
  } catch (e) {
    state.aiStatus = "translationError";
    state.errorMessage = e?.message || "AI translation error";
  }
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
// 提前声明 AI 渲染状态（供 onError/onFinished 使用）
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
      // newLine 模式：确保 AI 译文颜色覆盖谷歌译文颜色
      _applyAiColorToTranslatedElement(btnAi, twpConfig.get("aiTranslatedColor"));
      // 页面级 AI 翻译成功后，在 sessionStorage 标记此 URL 曾被 AI 翻译，
      // 以便 Turbo/pjax 导航回退时自动恢复 AI 翻译状态
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
      // newLine 模式：确保 AI 译文颜色覆盖谷歌译文颜色
      _applyAiColorToTranslatedElement(btnAi, twpConfig.get("aiTranslatedColor"));
      // 页面级 AI 翻译成功后（持久缓存命中），在 sessionStorage 标记此 URL
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
    // 清除上次错误信息（若存在），防止重试成功后残留
    try { const st = btnAi._st(); if (st) st.errorMessage = undefined; } catch (_) {}
    btnAi.btnAiTxtNode.textContent = "queuing"
    btnAi.tooltip.textContent = "This text will be translated by AI soon"
    contentSequence = contentSequence + `<译泽 id="${btnAi.translationId}">${btnAi.sourceString}</译泽>`
  }
  console.log("contentSequence:", contentSequence)

  // contentSequence 为空 → 全部命中缓存，无需发起 API 请求
  if (!(contentSequence.trim().length)) {
    console.log("contentSequence为空字符串（全部命中缓存）")
    return true
  }

  let accumulatedText = ""
  // 解析响应
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
      console.log("解析响应出错1", parsedChunk.error)
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

      // 某些 AI 模型（如 DeepSeek R1/V4）可能在译文 XML 之前输出推理文本或
      // 解释性文字。在此处检测并丢弃第一个 <译泽 标签之前的所有内容，
      // 确保 parseTaggedPageTranslationProgress 能正确识别 XML 块。
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

        // 用AI译文替换原译文
        btnAi = toBeTranslated.find(btnAi => btnAi.translationId === translationId)
        if (!btnAi) {
          // 翻译块在 DOM 中已不存在（可能在翻译期间被移除），
          // 跳过当前块继续处理后续译文，避免丢失所有剩余段落。
          console.log("未找到btnAi, 跳过此块:", translationId)
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
        // newLine 模式：确保 AI 译文颜色覆盖谷歌译文颜色
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
          // newLine 模式：确保 AI 译文颜色覆盖谷歌译文颜色
          _applyAiColorToTranslatedElement(btnAi, twpConfig.get("aiTranslatedColor"));
          // 页面级 AI 翻译成功后（流式响应完成），在 sessionStorage 标记此 URL
          if (!isSelectedPanel) saveAiAppliedFlag();
          // replaceOriginal 模式：AI 翻译开始时已通过 display:none 隐藏原始文本节点，
          // 这里保持隐藏状态即可（节点已在 applyAiTranslatingState 中隐藏）
          // In-memory cache write
          aiCache.push({
            original: btnAi.sourceString,
            targetLanguage: targetLanguageCodeForAI,
            translated: btnAi.translatedTextNode.textContent
          })
          // Persistent cache write (fire-and-forget, sourceLanguage defaults to "und")
          setCachedAiTranslation(
            "und", targetLanguageCodeForAI,
            twpConfig.get("aiProvider") || "openai",
            getModelForProvider(twpConfig.get("aiProvider") || "openai"),
            btnAi.sourceString,
            btnAi.translatedTextNode.textContent
          );
          // Continue loop — there may be more blocks in the remainder.
        } else {
          // Incomplete block, wait for more stream data.
          break
        }

      } catch (e) {
        console.log("解析响应出错2", e)
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

    openAiRateLimitCountDown = openAiRateLimitWaitingTime // 等待

    // 统一错误文案：若为超时，显示“server response timeout”；否则同时展示 code 与 message（若存在）
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
        // 持久化错误信息到 blockState，供 hover 时 updateSingletonUI 恢复 tooltip
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
    // AI 响应已完整，将仍未匹配到的 queuing 块标记为错误
    // （这些块在 AI 返回的 XML 中没有对应的译泽标签）
    let stuckCount = 0;
    // 诊断信息：记录残留文本，帮助排查 AI 返回格式问题
    if (accumulatedText && accumulatedText.trim().length > 0) {
      console.log("[AI-STATE] onFinished: residual accumulatedText (no matching <译泽> tags):",
        accumulatedText.trim().substring(0, 200));
    }
    toBeTranslated.forEach((btn) => {
      if (btn.translationStatus === "queuing") {
        // 统一通过 applyAiErrorState 应用错误状态（含视觉标记），
        // 避免仅修改 status 导致 UI 不一致（如红色 X 仅在 hover 后才出现）。
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
  // 插入样式: 1.解除高度限制 2.使元素display方式变为block
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
 *  把匹配的关键字(在customDictionary字典中)替换为特殊数字,在送往翻译引擎前,会过滤掉这些关键字(替换为数字).
 *  这是为了用户能自定义翻译术语.
 *  仅对单词之间有空格的语言有效,如英语,法语等. 对于中文,缅甸语等没有空格的语言无效.
 *  与handleCustomWords()配对使用
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
 *  对翻译后的结果,把匹配的关键字(在customDictionary字典中)替换为特殊数字,
 *  与filterKeywordsInText()配对使用
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
 * 是否标点或分隔符
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
 * 请求后台翻译节点列表
 *  
 * @param {*} translationService 
 * @param {*} targetLanguage 
 * @param {*} sourceArray2d 
 * @param {*} dontSortResults  // true: 按原始HTML节点顺序; false: 按翻译后节点顺序
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
 * 请求后台翻译属性文本列表
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
 * 请求后台翻译单串文字(用于标题翻译或划词翻译)
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
 * 获取tab主机名
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
  // inline文本
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

  // 不翻译的inline元素. 如果送给google的原文段缺少某些inline元素,会造成翻译效果不好,译文不通顺, 所以还是把所有inline元素都送去翻(但是最后addToTranslated时,仍然采用翻译前的原文字), 因此把此数组置空.
  const htmlTagsInlineIgnore = []

  // 不翻译的block元素
  const htmlTagsNoTranslate = ["title", "script", "style", "textarea", "translated", "noscript"];

  if (twpConfig.get("translateTag_pre") !== "yes") {
    htmlTagsInlineIgnore.push("pre");
  }

  // 监听配置变更, 实时反映到内存变量htmlTagsInlineIgnore中
  twpConfig.onChanged((name, newvalue) => {
    switch (name) {
      // 是否翻译pre标签的内容
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
  // 页面原始语言
  let originalTabLanguage = "und";
  // 页面当前语言
  let currentPageLanguage = "und";
  // 页面语言状态(原始/已翻译)
  let pageLanguageState = "original"; // "original" or "translated"
  // 当前目标语言. 一开始时,改值从config获取到, 用户使用中更改目标语言时, currentTargetLanguage随之更改
  let currentTargetLanguage = twpConfig.get("targetLanguage");
  // 翻译服务引擎(google/yandex)
  let currentPageTranslatorService = twpConfig.get("pageTranslatorService");
  // google返回的翻译结果为了通顺, HTML节点顺序会跟原始HTML节点顺序不一样. 
  // 可以选择重新排序(dontSortResults === false),按照原始HTML节点顺序显示,更符合原有的样式.但是这样可能会不通顺例如"what is the <b>treatment</b> for stroke",会被翻译成"是什么<b>治疗方法</b>中风的"
  // 也可设置为不重排(dontSortResults === true),按照google的结果显示,会更通顺,但是样式可能不对
  let dontSortResults =
    twpConfig.get("dontSortResults") == "yes" ? true : false;
  let fooCount = 0;

  let originalPageTitle;
  // 需要翻译的attributes(如placeholder等)
  let attributesToTranslate = [];
  // 定时翻译新节点(用setInterval定时)
  let translateNewNodesTimerHandler;
  // 新节点(mutationObserver添加的节点)
  let newNodes = [];
  // 新节点(mutationObserver删除的节点)
  let removedNodes = [];

  let nodesToRestore = [];



  /**
   * 实时更新newNodes数组和removedNodes数组
   * 原理: 新建一个MutationObserver观察者实例, 实时将新增节点放入newNodes数组,删除节点放入removedNodes数组
   */
  const mutationObserver = new MutationObserver(function (mutations) { // 浏览器要等到当前所有排队中的 DOM 操作都结束才调用此回调参数,因此传入回调函数的参数是复数mutations
    const tmpNewNodes = [];
    mutations.forEach((mutation) => {
      // 新增节点, 如果是块级元素且属于要翻译的标签, 则放入本地的tmpNewNodes数组
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

      // 删除节点放入removedNodes数组
      mutation.removedNodes.forEach((removedNode) => {
        removedNodes.push(removedNode);
      });
    });

    // 如果tmpNewNodes数组的元素不在newNodes数组里, 则把元素推入newNodes数组
    tmpNewNodes.forEach((node) => {
      if (newNodes.indexOf(node) == -1) {
        newNodes.push(node);
      }
    });
  });

  /**
   * 每2秒更新piecesToTranslate数组(根据newNodes的信息)
   */
  function updatePiecesToTranslateWithNewNodes() {
    try {
      newNodes.forEach((nn) => {
        if (removedNodes.indexOf(nn) != -1) return;

        // 从每个new node中取得pieces
        let newPiecesToTranslate = getPiecesToTranslate(nn);

        // 检查piecesToTranslate数组里是否已包含新取得的piece,如果没有包含,则push到piecesToTranslate数组
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
   * 用观察者实例观察整个文档,即监听document.body树的所有节点变更,实时更新newNodes,每2秒把newNodes选择合适的推入piecesToTranslate数组
   */
  function enableMutatinObserver() {
    disableMutatinObserver();

    if (twpConfig.get("translateDynamicallyCreatedContent") == "yes") {
      // 设定定时器: 每2秒把新节点推入piecesToTranslate数组
      translateNewNodesTimerHandler = setInterval(updatePiecesToTranslateWithNewNodes, 2000);
      // 监听document.body的更新, 实时更新
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  /**
   * 取消观察者实例对整个文档的监听; 取消定时翻译器
   */
  function disableMutatinObserver() {
    clearInterval(translateNewNodesTimerHandler);
    newNodes = [];
    removedNodes = [];
    //取消监听
    mutationObserver.disconnect();
    // 除了使用回调函数，我们还可以使用 takeRecords 函数主动从 通知队列中拉取所有待处理的通知, 此动作会导致清空所有通知。
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
   * 监视页面可视性. 页面可视时启用mutationObserver观察者实例监听页面,否则关闭mutationObserver观察者实例对于页面的监听
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
   * 处理 bfcache (back/forward cache) 恢复事件。
   * 页面从 bfcache 恢复时，JavaScript 堆状态被保留，但动态内容可能已被页面的
   * JavaScript 重新获取。Google 翻译有缓存所以能重新应用到新 DOM 节点，
   * 但 AI 翻译没有缓存 —— 导致 AI 按钮显示绿色（过时的 success 状态），
   * 实际页面上 AI 译文缺失（仅剩 Google 译文）。
   *
   * 在 bfcache 恢复时立即重新评估 AI 渲染状态，纠正过时状态。
   *
   * 对于非 bfcache 的 pageshow（完整页面重新加载），
   * 检查 sessionStorage 中是否有 AI 翻译标记，
   * 若有则设置 shouldForceAiAfterPageTranslation，使后续自动翻译包含 AI。
   */
  const handlePageShow = function (event) {
    if (event.persisted) {
      console.log("[AI-STATE] page restored from bfcache, re-evaluating AI render state");
      updateAiRenderStateInternal();
    } else {
      // 非bfcache恢复（完整页面加载），检查是否需要恢复AI翻译状态
      if (checkAiAppliedFlag()) {
        console.log("[AI-STATE] pageshow (non-bfcache): restoring shouldForceAiAfterPageTranslation");
        shouldForceAiAfterPageTranslation = true;
        setAiRenderState("loading");
      }
    }
  };
  window.addEventListener("pageshow", handlePageShow, false);

  /**
   * 处理 popstate 事件（浏览器回退/前进按钮）。
   *
   * GitHub 等站点使用 Turbo Drive 做 SPA 导航，且设置 turbo-cache-control=no-cache。
   * 当用户点击回退按钮时：
   * 1. popstate 事件触发（URL 已切换到目标页面）
   * 2. Turbo 从服务器重新获取页面内容（因为 no-cache）
   * 3. Turbo 替换 data-turbo-body 内容为全新的原始 HTML（不含任何翻译）
   * 4. Mutation Observer 检测到新节点，自动翻译 Google 译文
   * 5. 但 AI 翻译不会自动触发（shouldForceAiAfterPageTranslation 已被上次翻译完成后重置为 false）
   *
   * 通过在 popstate 时检查 sessionStorage 标记，恢复 shouldForceAiAfterPageTranslation。
   * 由于 Turbo/SPA 的 body 替换是异步的（fetch → then → innerHTML），
   * 使用 setTimeout 延迟调用 translatePage()，确保 SPA 已完成 body 替换后再重新翻译。
   * 延迟设为 1500ms——大多数 SPA 的 fetch + DOM 替换在一秒内完成。
   * 使用 pendingPopstateTranslate 防止多次快速 popstate 导致重复翻译。
   */
  let pendingPopstateTranslate = null;
  const handlePopState = function () {
    if (checkAiAppliedFlag()) {
      console.log("[AI-STATE] popstate: restoring shouldForceAiAfterPageTranslation for Turbo back-nav");
      shouldForceAiAfterPageTranslation = true;
      setAiRenderState("loading");

      // 清除之前的待处理定时器（防止多次快速 popstate 堆积）
      if (pendingPopstateTranslate !== null) {
        clearTimeout(pendingPopstateTranslate);
      }

      // 为 SPA body 替换预留时间，然后重新翻译整个页面。
      // 注意：pageLanguageState 仍为 "translated"（SPA 导航未重置），
      // 但 body 内容已被替换为全新 HTML，需要从头翻译。
      // translatePage 内部会调用 restorePage 清除旧状态，
      // 然后重新扫描 DOM、翻译 Google 和 AI 译文。
      pendingPopstateTranslate = setTimeout(() => {
        pendingPopstateTranslate = null;
        // 再次检查标记（可能在等待期间被 restorePage 清除）
        if (checkAiAppliedFlag()) {
          console.log("[AI-STATE] popstate: SPA body likely replaced, triggering translatePage");
          pageTranslator.translatePage();
        }
      }, 1500);
    }
  };
  window.addEventListener("popstate", handlePopState, false);

  /**
   * 获取传入的节点的树(包括节点自身和它的所有后代节点)的所有需要翻译的节点的信息
   * 原理: 通过遍历,获取所有元素的信息,每个块级元素的信息放入一个对象,然后把块级元素下面的inline子元素放入对象的nodes属性,然后将该对象推入一个数组,最后返回此数组
   * @param {*} root 
   * @returns {array} piecesToTranslate, 一维数组, 数组元素格式如下:
   *  {
        isTranslated: boolean,
        parentElement: node, // 上一个需要翻译的文本节点的祖先element(不一定是直接的parentNode), 在此node下面添加<translated>子元素
        topElement: node, // 本piece的第一个element
        bottomElement: node, // 本piece的最后一个element
        nodes: [], // 所有要翻译的文本节点
        nodesToBeInTranslatedNode: [] // 所有会进入<translated>节点的原始节点(包括要翻译的,以及不翻译(直接复制的)的节点)
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
     * 获取节点的树的全部节点(即节点和后代节点),更新piecesToTranslate数组. 
     * 过程为递归调用. 深度优先, 先序遍历
     * @param {*} node 
     * @param {*} lastHTMLElement   // 分析过程中最后的一个HTML元素,动态赋值的,一般是当前正在分析的节点. (注意textNode节点不是HTML元素)
     * @param {*} lastSelectOrDataListElement 
     * @returns 
     */
    const getAllNodes = function (
      node,
      lastHTMLElement = null,
      lastSelectOrDataListElement = null
    ) {
      // 忽略"translated"节点
      if (node?.nodeName.toLowerCase() === "translated"
      ) {
        return
      }

      /**
       * nodeType:
       *  
        1	Node.ELEMENT_NODE                 一个 元素 节点，例如 <p> 和 <div>。
        2	Node.ATTRIBUTE_NODE	              元素 的耦合 属性。
        3	Node.TEXT_NODE                    Element或者 Attr 中实际的 文字
        4	Node.CDATA_SECTION_NODE           一个 CDATASection，例如 <!CDATA[[ … ]]>。
        7	Node.PROCESSING_INSTRUCTION_NODE	一个用于 XML 文档的 ProcessingInstruction (en-US) ，例如 <?xml-stylesheet ... ?> 声明。
        8	Node.COMMENT_NODE	                一个 Comment 节点。
        9	Node.DOCUMENT_NODE	              一个 Document 节点。
        10 Node.DOCUMENT_TYPE_NODE	        描述文档类型的 DocumentType 节点。例如 <!DOCTYPE html> 就是用于 HTML5 的。
        11 Node.DOCUMENT_FRAGMENT_NODE		  一个 DocumentFragment 节点
       */
      // element node or fragment node, 这两种节点具有子节点
      if (node.nodeType == 1 || node.nodeType == 11) {
        // 有video元素时, 删除全页的unlimit-height
        if (node.nodeName === "VIDEO" && !hasVideoInPage) {
          document.querySelectorAll(".unlimit-height").forEach((node) => { node.classList.remove('unlimit-height') })
          document.querySelectorAll(".unlimit-height-2").forEach((node) => { node.classList.remove('unlimit-height-2') })
          hasVideoInPage = true
        }
        // 是video元素时, 删除Video元素和它的所有祖先元素的的unlimit-height类
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
        // 如果是element node
        else if (node.nodeType == 1) {

          lastHTMLElement = node;
          const nodeName = node?.nodeName.toLowerCase();

          if (nodeName === "select" || nodeName === "datalist")
            lastSelectOrDataListElement = node;

          // 如果根元素是不需要翻译的元素
          // 特例：当元素为 <code> 且不在 <pre> 内部时，应当被翻译（即使带有 translate="no" 或 notranslate 类）
          //       只有当 <code> 是 <pre> 的后代时，才不翻译。
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
              // 规则：<code> 在 <pre> 内部 -> 不翻译；否则 -> 翻译
              shouldSkipTranslate = insidePre ? true : false;
            }
          } catch (e) {
            // 安全兜底：若 closest 不可用或异常，保持原判定
          }

          if (shouldSkipTranslate) {
            const isNewLine = isNewLineBoundary(node)


            // 如果是block元素
            if (isNewLine) {
              // 前面没有需要翻译的
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
              // 前面有需要翻译的
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

                // 把一个新对象(代表一个新行)推入piecesToTranslate数组作为一级元素, 并退出getAllNodes函数!!!!!!!!!
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
            // 如果是inline元素
            else {
              // 直接放入nodesToBeInTranslatedNode, 不进行翻译
              tmpPiecesToTranslate[index].nodesToBeInTranslatedNode.push(node)
            }

            // 退出!!!!!!!!!
            return;
          }
        }

        /**
         * 获取节点的全部子节点
         * 
         * @param {*} childNodes !!!!注意:childNodes其实是父节点的所有子节点, 包括元素起始标签与下一个元素标签之间的换行(算作一个#text)\元素节点\文本节点\注释节点等等!!!!!!!
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

            // 如果节点是"非inline元素"或button元素或br元素或flex子元素
            const isNewLine = isNewLineBoundary(_node)
            if (isNewLine) {
              // 前面没有需要翻译的
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
              // 前面有需要翻译的
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
                    console.log("插入翻译节点出错:", error)
                  }

                }
                // 如果tmpPiecesToTranslate[index]只有一个节点, 且是元素节点(而不是文本节点)
                else if (tmpPiecesToTranslate[index].nodes.length === 1 && tmpPiecesToTranslate[index].nodes[0].nodeType == 1) {
                  prevNode.appendChild(translatedElement)
                }
                else {
                  _node.parentNode.insertBefore(translatedElement, _node)
                }
                tmpPiecesToTranslate[index].translatedElement = translatedElement

                // 把一个新对象(代表一行)推入piecesToTranslate数组作为一级元素
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

              // 获取该子节点的所有子节点
              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);

              // 前面没有需要翻译的
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
              // 前面有需要翻译的
              else {
                // console.log(777777, tmpPiecesToTranslate[index].nodes)
                currentParagraphSize = 0;
                tmpPiecesToTranslate[index].bottomElement = lastHTMLElement;

                let translatedElement = document.createElement("translated")
                translatedElement.style.display = "none"
                lastHTMLElement.appendChild(translatedElement)
                tmpPiecesToTranslate[index].translatedElement = translatedElement

                // 把一个初始对象推入piecesToTranslate数组作为一级元素
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
            // 如果节点是inline元素
            else {
              // 获取该子节点的所有子节点
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
      // 文本节点
      else if (node.nodeType == 3) {
        // 文本长度大于0
        if (node.textContent.trim().length > 0) {
          // 对developer.mozilla.org,删除文本中的换行符
          if (location.hostname.includes("developer.mozilla.org")) {
            node.textContent = node.textContent.replace(/[\r\n]/g, '')
          }

          // 给piece元素的parentElement赋值(注意:最终值不一定是元素实际上的那个parentNode)
          if (!tmpPiecesToTranslate[index].parentElement) {
            // 如果是option元素的子元素
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
            // 如果不是option元素的子元素
            else {
              let temp = node.parentNode;
              // 向上递归寻找父元素(父元素是inline元素,则继续向上寻找,直至root)
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

          // 给piece元素的topElement赋值 (实际上就是上一个非文本节点的元素节点)
          if (!tmpPiecesToTranslate[index].topElement) {
            tmpPiecesToTranslate[index].topElement = lastHTMLElement;
          }


          if (currentParagraphSize > 1000) {

            // 新建一个translatedElement, 赋给tmpPiecesToTranslate[index].translatedElement
            let translatedElement = document.createElement("translated")
            translatedElement.style.display = "none"
            lastHTMLElement.appendChild(translatedElement)
            tmpPiecesToTranslate[index].translatedElement = translatedElement

            tmpPiecesToTranslate[index].bottomElement = lastHTMLElement;

            // 再新建一个piece
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
            console.log("判断父元素是否为flex元素:", e)
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

            // 把文本节点推入piecesToTranslate的元素的nodes属性(是一个数组)
            tmpPiecesToTranslate[index].nodes.push(node);
            tmpPiecesToTranslate[index].bottomElement = null;
            tmpPiecesToTranslate[index].nodesToBeInTranslatedNode.push(node);

            // 把一个新对象(代表一行)推入piecesToTranslate数组作为一级元素
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
            // 把文本节点推入piecesToTranslate的元素的nodes属性(是一个数组)
            tmpPiecesToTranslate[index].nodes.push(node);
            tmpPiecesToTranslate[index].bottomElement = null;
            tmpPiecesToTranslate[index].nodesToBeInTranslatedNode.push(node);

            currentParagraphSize += node.textContent.length;
          }
        }
      }


    };
    getAllNodes(root);

    // 如果最后一个piece的nodes是空数组,则删除该piece
    if (
      tmpPiecesToTranslate.length > 0 &&
      tmpPiecesToTranslate[tmpPiecesToTranslate.length - 1].nodes.length == 0
    ) {
      tmpPiecesToTranslate.pop();
    }

    return tmpPiecesToTranslate;
  }

  /**
   * 获取传入的节点的树(包括节点自身和它的所有后代节点)的所有需要翻译的属性的信息
   * 
   * @param {*} root 
   * @returns {array} attributesToTranslate, 一维数组(通过遍历,获取所有属性的信息,每个属性的信息放入一个对象,然后将该对象推入此一维数组), 数组元素格式如下:
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
   * 用font标签包裹文本节点
   * @param {*} node 文本节点
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
   * 把节点文本替换为翻译后的文本
   * 
   * @param {*} piecesToTranslateNow 要翻译的节点
   * @param {*} results 翻译结果. 结构为二维数组.
   */
  function translateResults(piecesToTranslateNow, results) {
    // true: 按原始HTML节点顺序; false: true: 按翻译后节点顺序; false: 按原始HTML节点顺序（重排结果）
    if (dontSortResults) {
      for (let i = 0; i < results.length; i++) {
        const nodes = piecesToTranslateNow[i].nodes;

        // 添加内联按钮组（Google + AI）
        if (nodes.length > 0 && nodes[0]) {
          let sourceString = nodes.reduce((accumulator, currentNode) => accumulator + currentNode.textContent, "")
          if (shouldTriggerAiImprove(wordsCount(sourceString), twpConfig.get("aiImproveForLongerThan"))) {
            // 译文节点（用于显示AI翻译结果）
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

            // 有时候,results[i]数组长度比piecesToTranslateNow[i].nodes数组长度要长,此时把剩余结果append to last node
            if (
              piecesToTranslateNow[i].nodes.length - 1 === j &&
              results[i].length > j
            ) {
              const restResults = results[i].slice(j + 1);
              translated += restResults.join(" ");
            }

            const originalTextNode = nodes[j];

            // "悬停显示原文"已开启
            if (showOriginal.isEnabled) {
              // 把文本节点用font标签包裹
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

            // 把节点的原始文本存储起来, 用于恢复
            const toRestore = {
              original: originalTextNode,  // 原始文本节点
              originalText: originalTextNode.textContent, // 原始文本
              node: nodes[j],  // 文本节点(在"悬停显示原文"已开启的情况下,是包裹后文本节点,否则为原始文本节点)
              translatedText: translated,  // 翻译后文本
            };
            nodesToRestore.push(toRestore);

            // 处理自定义翻译
            handleCustomWords(
              translated,
              nodes[j].textContent,
              currentPageTranslatorService,
              currentTargetLanguage
            ).then((results) => {
              // 如果节点已被 AI 翻译隐藏（display: none），则跳过更新
              // 这避免了覆盖 applyAiTranslatingState 中的隐藏操作
              if (nodes[j].nodeType === 1 && nodes[j].style?.display === "none") {
                return;
              }
              // 把文本节点的文本的值赋为翻译后文本
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

            // "悬停显示原文"已开启
            if (showOriginal.isEnabled) {
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

            // 把节点的原始文本存储起来, 用于恢复
            const toRestore = {
              node: nodes[j],
              original: originalTextNode,
              originalText: originalTextNode.textContent,
              translatedText: translated,
            };
            nodesToRestore.push(toRestore);

            // 处理自定义翻译
            handleCustomWords(
              translated,
              nodes[j].textContent,
              currentPageTranslatorService,
              currentTargetLanguage
            ).then((results) => {
              // 把文本节点的文本的值赋为翻译后文本
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
   * 把翻译后文本添加到已有的translatedElement节点
   * 
   * @param {*} piecesToTranslateNow 要翻译的节点
   * @param {*} results 翻译结果. 结构为二维数组.
   */
  async function addTranslatedContent(piecesToTranslateNow, results) {
    console.log("piecesToTranslateNow:", piecesToTranslateNow)
    console.log("results:", results)
    for (const i in piecesToTranslateNow) {
      try {
        // 获取<translated>元素的引用
        const translatedElement = piecesToTranslateNow[i].translatedElement
        if (!translatedElement) {
          continue
        }

        // 设置样式
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

        // 强制使左右padding与父元素一致(当父元素是inline元素时,其padding无法影响block类型子元素,所以手动设置其padding为inherit)
        if (translatedElement.parentNode.style.display.includes("inline")) {
          translatedElement.style.paddingLeft = "inherit"
          translatedElement.style.paddingRight = "inherit"
        }

        // 解除高度限制
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
              console.log("解除高度限制出错:", e)
              shouldRemoveHeightLimit = false
            }
          } while (shouldRemoveHeightLimit)
        }
        // dontSortResults: true: 按翻译后节点顺序; false: 按原始HTML节点顺序（重排结果）
        if (dontSortResults) {
          // 如果翻译前只有一个元素
          if (piecesToTranslateNow[i].nodes.length === 1) {
            // 如果类型是code或kbd元素
            if (["code", "kbd"].includes(piecesToTranslateNow[i].nodes[0].parentNode?.nodeName.toLowerCase())
              // 或者翻译前后文字完全一样并且译文颜色为原色
              // || (['','rgba(0, 0, 0, 1)'].includes(twpConfig.get("translatedColor")) && piecesToTranslateNow[i].nodes[0]?.textContent === results[i].reduce((accumulated, item) => { return "" + accumulated + item }))
            ) {
              // 则translatedElement节点隐藏
              translatedElement.style.display = "none"
              continue
            }
          }

          // 如果译文颜色为原色
          if (['', 'rgba(0, 0, 0, 1)'].includes(twpConfig.get("translatedColor"))) {
            // 如果翻译前后文本完全相同,则translatedElement节点隐藏
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

          // 拼接翻译后文本

          let finalResults = ""
          for (let k = 0; k < results[i].length; k++) {

            // 由于 results数组的长度有可能比piecesToTranslateNow[i].nodes数组的长度要更长,所以下面这个方法行不通(piecesToTranslateNow[i].nodes[k]可能不存在)
            // let nodeName = piecesToTranslateNow[i].nodes[k].parentNode.nodeName.toLowerCase()
            // // 如果是code节点或kdb节点
            // if (["code", "kdb"].includes(nodeName)) {
            //   // 直接复制节点(不管翻译如何)
            //   translatedElement.appendChild(piecesToTranslateNow[i].nodes[k].parentNode.cloneNode(true))
            // } else {
            //   const translated = results[i][k]
            //   // 用自定义词典再过一遍
            //   finalResults = await handleCustomWords(
            //     translated,
            //     piecesToTranslateNow[i].nodes[k].textContent,
            //     currentPageTranslatorService,
            //     currentTargetLanguage
            //   )
            //   // 添加翻译后文字
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
          translatedElement.appendChild(translatedTextNode)

          // 添加内联按钮组（Google + AI）
          let sourceString = piecesToTranslateNow[i].nodes.reduce((accumulator, currentNode) => accumulator + currentNode.textContent, "")
          // 使用 shouldTriggerAiImprove 而非内联表达式，确保 newLine 和 replaceOriginal 模式行为一致
          if (shouldTriggerAiImprove(wordsCount(finalResults), twpConfig.get("aiImproveForLongerThan"))) {
            ensureSingletonInit();
            registerBlock(
              translatedElement, sourceString, translatedTextNode,
              finalResults, // Store Google translation for restoration
              null // No nodes to clear in new-line mode
            );
          }
        }
        // dontSortResult: true: 按翻译后节点顺序; false: 按原始HTML节点顺序（重排结果） 
        else {
          // TODO: 有时候results数组的长度比piecesToTranslateNow[i]数组的长度要长, 比如1句英文翻译成了2句中文, 这种情况要添加处理逻辑

          const allChildNodes = piecesToTranslateNow[i].nodesToBeInTranslatedNode
          for (let k = 0; k < allChildNodes.length; k++) {
            const node = allChildNodes[k]

            let m = piecesToTranslateNow[i].nodes.indexOf(node)

            // 如果节点是要翻译的节点 
            if (m > -1) {
              // 拿到机翻结果
              const translated = results[i][m] + " ";
              // 用自定义词典再过一遍
              const finalResults = await handleCustomWords(
                translated,
                piecesToTranslateNow[i].nodes[m].textContent,
                currentPageTranslatorService,
                currentTargetLanguage
              )
              // 添加翻译后文字
              translatedElement.appendChild(document.createTextNode(finalResults))
            }
            // 如果节点是不要翻译的节点         
            else {
              // 直接复制节点
              translatedElement.appendChild(node.cloneNode(true))
            }
          }
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
   * 把属性文本替换为翻译后的属性文本
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
   * 每600毫秒, 在piecesToTranslate数组和attributesToTranslate数组找到那些进入了屏幕可视区域的节点, 进行翻译
   * 这里通过遍历元素的坐标, 而不是使用intersectionObserver, 不知道为什么??? (可能是为了代码更易写,或者兼容性)
   */
  function translateDynamically() {
    try {
      if (piecesToTranslate && pageIsVisible) {
        (function () {
          const innerHeight = window.innerHeight;

          /**
           * 判断元素是否完全在屏幕
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
           * 判断元素顶部是否在屏幕显示
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
           * 判断元素底部是否在屏幕显示
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

          // 从piecesToTranslate数组中选择那些进入了屏幕可视区域的未翻译的元素,放入piecesToTranslateNow数组中
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
              console.log(time.getHours() + ":" + time.getMinutes() + ":" + time.getSeconds() + "   " + "有新节点需要翻译!")
            }
          });

          // 从attributesToTranslate数组中选择那些进入了屏幕可视区域的未翻译的元素,放入attributesToTranslateNow数组中
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

            // 翻译节点列表
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
                    // 添加翻译文本子节点
                    ? await addTranslatedContent(piecesToTranslateNow, results)
                    // 把原节点文本替换为翻译后的节点文本
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
            // 翻译属性列表
            backgroundTranslateText(
              currentPageTranslatorService,
              currentTargetLanguage,
              attributesToTranslateNow.map((ati) => ati.original)
            ).then((results) => {
              if (
                pageLanguageState === "translated" &&
                currentFooCount === fooCount
              ) {
                // 把属性文本替换为翻译后的属性文本
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
    let toBeTranslated = allProxies.filter(p => !["queuing", "translating", "translated"].includes(p.translationStatus));

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

  // 用AI自动翻译.
  // 注意事项: 由于是跨域请求, 浏览器会发起预检, 坑爹的是, 预检请求也会被openAI视为有效请求... 导致更容易触发rate limit
  //
  // shouldForceAiAfterPageTranslation 的语义：
  // 用户点击 AI 按钮后被设为 true，并在整个页面会话期间保持 true，
  // 使后续动态加载的新内容（如 x.com 信息流、无限滚动页面）也会被自动 AI 翻译。
  // 仅在以下情况重置为 false：
  //   1. restorePage() —— 用户主动恢复原文
  //   2. pageTranslator.stopAiAutoTranslate() —— 用户从 AI 译文切换到 Google 译文
  //   3. translatePageAi() 检测到无 API key —— 无法进行 AI 翻译
  async function aiTranslateDynamically() {
    console.log("aiTranslateDynamically() is called")
    updateAiRenderStateInternal();
    try {
      openAiRateLimitCountDown = openAiRateLimitCountDown - aiTranslationInterval
      if (_shouldSkipAiTranslation(twpConfig.get("autoImproveByAI"), hasActiveProviderApiKey(), openAiRateLimitCountDown, shouldForceAiAfterPageTranslation)) {
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
      // 注意：此处不再重置 shouldForceAiAfterPageTranslation。
      // 保留为 true，使后续动态加载的新内容也会被自动 AI 翻译。
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
   * 停止 AI 自动翻译模式。
   * 重置 shouldForceAiAfterPageTranslation 标志，使后续动态加载的新内容不再被自动 AI 翻译。
   * 用于用户主动从 AI 译文切换到 Google 译文的场景。
   * 注意：restorePage() 内部已包含此重置，故恢复原文时无需额外调用。
   */
  pageTranslator.stopAiAutoTranslate = function () {
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
    // 用户主动点击 AI 按钮 → 清除错误后的 rate limit 倒计时，
    // 否则 _shouldSkipAiTranslation 会因 rateLimitCountdown > 0 跳过请求
    openAiRateLimitCountDown = 0;
    setAiRenderState("loading");
    if (pageLanguageState === "original") {
      pageTranslator.translatePage(targetLanguage);
    } else {
      // 页面已翻译（如已被 Google 翻译）→ 重置错误块为 idle，
      // 否则 getProxiesForTranslation() 会过滤掉 translationError 状态的块，
      // 导致 aiTranslateDynamically() 无块可翻译、不发请求
      getAllProxies().forEach((p) => {
        if (p.translationStatus === "translationError") {
          p.translationStatus = "idle";
        }
      });
      // If already translated, force AI on remaining un-AI-translated nodes
      aiTranslateDynamically();
    }
    return true;
  };

  /**
   * 翻译整个页面
   * @param {*} targetLanguage 
   */
  pageTranslator.translatePage = function (targetLanguage) {
    const shouldForceAiForThisRun = shouldForceAiAfterPageTranslation
    fooCount++;
    // 恢复原来页面
    pageTranslator.restorePage();
    shouldForceAiAfterPageTranslation = shouldForceAiForThisRun
    hadGoogleTranslationError = false
    pendingGoogleBatches = 0
    setPageRenderState("loading")
    setAiRenderState(shouldForceAiAfterPageTranslation ? "loading" : "idle")
    // 开启悬停显示原文字
    showOriginal.enable();
    // 删除错误翻译
    chrome.runtime.sendMessage({ action: "removeTranslationsWithError" });

    // true: 按翻译后节点顺序; false: 按原始HTML节点顺序（重排结果）
    dontSortResults = resolveDontSortResults(twpConfig.get("dontSortResults"));

    if (targetLanguage) {
      currentTargetLanguage = targetLanguage;
    } else {
      currentTargetLanguage = twpConfig.get("targetLanguage")
    }

    // 获取所有要翻译的节点的信息列表(一维数组)
    piecesToTranslate = getPiecesToTranslate();

    // 获取所有要翻译的属性的信息列表(一维数组)
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

    // 翻译标题
    translatePageTitle();

    // 监听节点变更
    enableMutatinObserver();

    // 翻译节点和属性(带定时器setTimeout)
    translateDynamically();
  };

  // 恢复原始页面
  pageTranslator.restorePage = function () {
    shouldForceAiAfterPageTranslation = false;
    hadGoogleTranslationError = false;
    pendingGoogleBatches = 0;
    setPageRenderState("idle");
    setAiRenderState("idle");
    // 用户主动恢复原文，清除 AI 翻译标记，避免回退时自动触发 AI 翻译
    removeAiAppliedFlag();
    // 删除所有<translated>元素
    document.querySelectorAll("translated").forEach((node) => { node.parentNode.removeChild(node); node = null })

    // 删除所有内联按钮组（包含其中的AI按钮和Google按钮）
    // 销毁单例按钮组
    destroySingletonButtonGroup();
    singletonInitialized = false;
    // 删除所有遗留的AI按钮
    document.querySelectorAll(".dualtran-ai-btn").forEach((node) => { if (node.parentNode) node.parentNode.removeChild(node); node = null })

    // 删除inline替换模式下所有AI翻译文本
    document.querySelectorAll(".dualtran-aitranslatedtext-replacemode").forEach((node) => { node.parentNode.removeChild(node); node = null })

    // 删除所有unlimit-height类
    document.querySelectorAll(".unlimit-height").forEach((node) => { node.classList.remove('unlimit-height') })
    document.querySelectorAll(".unlimit-height-2").forEach((node) => { node.classList.remove('unlimit-height-2') })

    fooCount++;
    piecesToTranslate = [];

    // 禁止悬停显示原文字(因为已经是原始页面了)
    showOriginal.disable();

    // 禁止监听节点变化
    disableMutatinObserver();

    pageLanguageState = "original";
    chrome.runtime.sendMessage({
      action: "setPageLanguageState",
      pageLanguageState,
    });

    // 调用所有监听"pageLanguageState"变更事件的回调
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = originalTabLanguage;

    if (originalPageTitle) {
      document.title = originalPageTitle;
    }
    originalPageTitle = null;

    for (const ntr of nodesToRestore) {
      // 如果现元素与原始元素相同
      if (ntr.node === ntr.original) {
        // // 如果现元素内容为翻译后文本
        // if (ntr.node.textContent === ntr.translatedText) {
        //   // 翻译后文本替换为原始文本
        //   ntr.node.textContent = ntr.originalText;
        // }
        ntr.node.textContent = ntr.originalText;
      }
      // 现元素与原始元素不同
      else {
        // 把现元素替换为原始元素
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
   * 切换翻译服务
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

  // 暴露内部函数供测试使用（遵循 resolveDontSortResults / shouldTriggerAiImprove 的先例）
  /** @internal — 仅用于测试 translateResults 和 addTranslatedContent 的行为 */
  pageTranslator._translateResults = translateResults;
  /** @internal — 仅用于测试 */
  pageTranslator._addTranslatedContent = addTranslatedContent;
  /** @internal — 仅用于测试 getPiecesToTranslate 的 DOM 解析行为 */
  pageTranslator._getPiecesToTranslate = getPiecesToTranslate;
  /** @internal — 仅用于测试自定义词典过滤 */
  pageTranslator._filterKeywordsInText = filterKeywordsInText;
  /** @internal — 仅用于测试自定义词典替换 */
  pageTranslator._handleCustomWords = handleCustomWords;
  /** @internal — 仅用于测试 AI 按钮点击处理 */
  pageTranslator._handleSingletonAiClick = handleSingletonAiClick;
  /** @internal — 仅用于测试 Google 按钮点击处理 */
  pageTranslator._handleSingletonGoogleClick = handleSingletonGoogleClick;
  /** @internal — 仅用于测试视口感知翻译 */
  pageTranslator._translateDynamically = translateDynamically;
  /** @internal — 仅用于测试 provider → model 映射 */
  pageTranslator._getModelForProvider = getModelForProvider;
  /** @internal — 仅用于测试 AI 持续翻译模式（检测”动态加载内容 AI 翻译失败“回归） */
  pageTranslator._aiTranslateDynamically = aiTranslateDynamically;
  /** @internal — 仅用于测试：设置 shouldForceAiAfterPageTranslation 内部状态 */
  pageTranslator._setForceAiTranslation = (v) => { shouldForceAiAfterPageTranslation = v; };

  let alreadyGotTheLanguage = false;
  // 探测到tab语言时的回调函数
  const observersOnTabLanguageDetected = [];

  /**
   * 为"获取tab语言"消息调用回调或添加回调
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

  // 主帧
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

          // 如果 sessionStorage 中有 AI 翻译标记（说明此页面之前被 AI 翻译过），
          // 且页面当前处于未翻译状态，则强制调用 translatePage() 恢复翻译。
          // 这处理的是 Turbo/pjax 导航回退后页面被重新加载的场景：
          // 页面是全新的原始 HTML，但用户之前已经翻译过，应该自动恢复翻译状态。
          if (needAutoTranslateFromSession && pageLanguageState === "original") {
            console.log("[AI-STATE] onTabVisible: auto-restoring translation from sessionStorage flag");
            pageTranslator.translatePage();
          }
        }
      );
    };
    // 安全兜底：如果 pageshow 事件在 pageshow 监听器注册前已触发，
    // 此处补充检查 sessionStorage 标记，确保 shouldForceAiAfterPageTranslation
    // 在 onTabVisible → translatePage 之前被正确设置。
    // 同时记录"需要自动翻译"标志，以便在 onTabVisible 中强制调用 translatePage()。
    const needAutoTranslateFromSession = checkAiAppliedFlag();
    if (needAutoTranslateFromSession) {
      console.log("[AI-STATE] init: restoring shouldForceAiAfterPageTranslation from sessionStorage");
      shouldForceAiAfterPageTranslation = true;
      setAiRenderState("loading");
    }
    // 监听主页面可视性, 设置可视性变更的回调
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
  // 非主帧
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

    // 获取主帧状态
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
  console.log("触发beforeunload事件")
  abortControllers.forEach((controller) => {
    controller.abort()
  })
});

export { backgroundTranslateSingleText, pageTranslator, aiTranslateText, _shouldSkipAiTranslation, getAiAppliedStorageKey, saveAiAppliedFlag, checkAiAppliedFlag, removeAiAppliedFlag }
