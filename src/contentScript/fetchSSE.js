/**
 * Request orchestration layer
 */

import twpConfig from "../lib/config.js"
import twpLang from "../lib/languages.js"
import { buildTranslationMessages } from "../core/translator/prompts.js"
import { resolveConfigValues, computeEffectiveBaseURL, computeExtraBaseURL, resolveOpenRouterOverrides } from "../core/providers/settings.js"
import detectTextLanguage from "../util/detectTextLanguage.js"
import { fetchSSE } from "../lib/ai/sseClient.js"
import { createProviderRegistry, BUILT_IN_PROVIDERS } from "../lib/ai/providerRegistry.js"
import "../lib/i18n.js" // Import i18n support

const _providerRegistry = createProviderRegistry(BUILT_IN_PROVIDERS);

// Legacy config key mappings for each provider
const _PROVIDER_CONFIG_KEYS = {
  openai: { apiKey: "apiKeyOpenAI", model: "openAiModel", promptKey: "promptInputOpenAIKey", promptFallback: "Please input your OpenAI API Key:" },
  openrouter: { apiKey: "apiKeyOpenRouter", model: "openRouterModel", promptKey: "promptInputOpenRouterKey", promptFallback: "Please input your OpenRouter API Key:" },
  deepseek: { apiKey: "apiKeyDeepSeek", model: "deepSeekModel", promptKey: "promptInputDeepSeekKey", promptFallback: "Please input your DeepSeek API Key:" },
  grok: { apiKey: "apiKeyGrok", model: "grokModel", promptKey: "promptInputGrokKey", promptFallback: "Please input your Grok API Key:" },
  "azure-openai": { apiKey: "apiKeyAzureOpenAI", model: "azureOpenAIModel", promptKey: "promptInputAzureOpenAIKey", promptFallback: "Please input your Azure OpenAI API Key:", endpoint: "azureOpenAIEndpoint" },
  anthropic: { apiKey: "apiKeyAnthropic", model: "anthropicModel", promptKey: "promptInputAnthropicKey", promptFallback: "Please input your Anthropic API Key:" },
  "google-gemini": { apiKey: "apiKeyGoogleGemini", model: "googleGeminiModel", promptKey: "promptInputGoogleGeminiKey", promptFallback: "Please input your Google Gemini API Key:" },
};

/**
 * Build apiKey, model, extra for a given provider using registry + legacy config keys.
 * Returns null if the required apiKey couldn't be obtained.
 */
function _resolveProviderSettings(providerId, ensureConfigString) {
  const providerDef = _providerRegistry.getProvider(providerId);
  const keys = _PROVIDER_CONFIG_KEYS[providerId] || {};

  // ── Read the plain config-value layer (pure — src/core/providers/settings.js) ──
  const providerConfigs = twpConfig.get("providerConfigs") || {};
  const legacyModel = keys.model ? twpConfig.get(keys.model) : undefined;
  const {
    apiKeyFromConfig,
    model: configModel,
    userApiBase,
    isUserCustom,
    reasoningDepth,
  } = resolveConfigValues({ providerId, providerConfigs, legacyModel });

  // Determine API key — check providerConfigs first, then legacy keys
  let apiKey = apiKeyFromConfig;

  if (!apiKey && keys.apiKey) {
    // Legacy key fallback
    apiKey = ensureConfigString(keys.apiKey, keys.promptKey || "promptInputApiKey",
      keys.promptFallback || `Please input your API Key:`,
      { confirmAuto: true, openOptionsOnMissing: true });
    if (!apiKey) return null;
  }

  if (!apiKey) {
    apiKey = ensureConfigString(`apiKey_${providerId}`, "promptInputApiKey",
      `Please input your ${providerDef?.name || providerId} API Key:`,
      { confirmAuto: true, openOptionsOnMissing: true });
    if (!apiKey) return null;
  }

  // Model — providerConfigs first; legacy fallback resolved above
  let model = configModel;

  // Build extra
  const extra = {};
  // User-customized API Base URL takes priority over provider built-in defaults;
  // the effective-base computation is pure — src/core/providers/settings.js
  const effectiveBaseURL = computeEffectiveBaseURL({ providerId, providerDef, userApiBase });
  const extraBaseURL = computeExtraBaseURL({ providerId, providerDef, isUserCustom, effectiveBaseURL });
  if (extraBaseURL) extra.baseURL = extraBaseURL;

  // OpenRouter special handling
  if (providerId === "openrouter") {
    const openRouterApiBase = (twpConfig.get("openRouterApiBase") || "").trim();
    const overrides = resolveOpenRouterOverrides({
      model,
      openRouterApiBase,
      extraBaseURL: extra.baseURL,
      providerDefApiBase: providerDef?.apiBase,
    });
    if (overrides.baseURL) extra.baseURL = overrides.baseURL;
    model = overrides.model;
  }

  // Azure special handling
  if (providerId === "azure-openai") {
    let endpoint = (twpConfig.get("azureOpenAIEndpoint") || "").trim();
    if (endpoint) {
      extra.resourceName = new URL(endpoint).hostname.split(".")[0];
    }
  }

  return { apiKey, model, extra, reasoningDepth };
}

const baseRequestBody = {
  model: "", // Dynamically retrieved from config
  // Sampling temperature, between 0 and 2, controls randomness of results. Higher values = more random.
  temperature: 0.1,
  // Alternative to temperature sampling. Between 0-1. Controls output token diversity. Higher values = more random.
  top_p: 0.1,
  // frequency_penalty adds a penalty during generation to reduce the probability of high-frequency tokens/phrases and increase the likelihood of low-frequency ones.
  // 0 means no penalty, 1 means high-frequency tokens/phrases are completely forbidden.
  frequency_penalty: 0,
  // presence_penalty adds a penalty during generation to discourage repeated tokens. If the output cannot contain tokens already present in the input, it affects the final output.
  // Its value ranges from 0 to 1, where 0 means no penalty and 1 completely forbids the model from copying tokens or phrases from the input.
  presence_penalty: 0,
  stream: true,
  messages: [
    {
      role: 'system',
      content: "",
    },
    {
      role: 'assistant',
      content: "",
    },
    {
      role: 'user',
      content: ""
    }
  ]
}
/**
 * translate text with AI
 * @param {*} content 
 * @param {*} onMessage 
 * @param {*} onError 
 * @param {*} onFinished 
 * @returns 
 */

// ── Extracted module-level pure function helpers (for testing) ──

/**
 * Determine whether the error should be ignored (user-initiated cancel or abort)
 * @internal — extracted from translateWithAI for testing
 */
export function shouldIgnoreTransportError(err) {
  const errorName = err?.name || err?.error?.name;
  return errorName === 'AbortError' || errorName === 'CanceledError';
}

/**
 * Convert AI response payload to text and deliver to onMessage
 * @internal — extracted from translateWithAI for testing
 */
export function deliverTransformed(payload, onMessage) {
  if (payload == null) return;
  if (Array.isArray(payload)) {
    payload.forEach((p) => deliverTransformed(p, onMessage));
    return;
  }
  const text = typeof payload === 'string' ? payload : String(payload ?? '');
  if (!text) return;
  onMessage?.(text);
}

/**
 * Determine whether a raw stream chunk is deliverable valid JSON or [DONE]
 * @internal — extracted from translateWithAI for testing
 */
export function isDeliverableRawStreamChunk(payload) {
  if (typeof payload !== 'string') return true;
  const text = payload.trim();
  if (!text) return false;
  if (text === '[DONE]') return true;
  try {
    JSON.parse(text);
    return true;
  } catch (_) {
    return false;
  }
}

export async function translateWithAI(content, onMessage, onError, onFinished, signal, isSingleWord = false, overrideTargetLanguageCode = undefined) {
  const requestBody = JSON.parse(JSON.stringify(baseRequestBody))

  // ① Read configuration
  const provider = twpConfig.get("aiProvider") || "openai"

  const ensureConfigString = (configKey, promptKey, promptFallback, options) => {
    const {
      confirmAuto = false,
      errorMessageKey = 'errorApiKeyNotFound',
      errorFallbackMessage,
      openOptionsOnMissing = false,
    } = options || {}
    let value = twpConfig.get(configKey)
    if (typeof value === 'string') {
      value = value.trim()
    }
    if (!value) {
      if (openOptionsOnMissing) {
        const confirmMessage = chrome.i18n.getMessage("confirmSetApiKeyNow") || 'API key is not set. Do you want to set it now?'
        if (window.confirm(confirmMessage)) {
          chrome.runtime?.sendMessage?.({
            action: "openOptionsPage",
            hash: "#ai",
          })
        }
        return null
      }
      const promptMessage = chrome.i18n.getMessage(promptKey) || promptFallback
      const input = prompt(promptMessage)
      value = (input || '').trim()
      if (!value) {
        const errMsg = chrome.i18n.getMessage(errorMessageKey) || errorFallbackMessage || 'Required configuration is missing.'
        onError?.({
          error: {
            message: errMsg
          }
        })
        return null
      }
      twpConfig.set(configKey, value)
      if (confirmAuto) {
        if (window.confirm(confirmMessage)) {
        }
      }
    }
    return value
  }

  // Determine target language: prefer explicit override (e.g., selected-text panel),
  // otherwise fall back to page translation target language.
  let targetLanguageCode = overrideTargetLanguageCode || twpConfig.get("targetLanguage")
  console.log("targetLanguageCode:", targetLanguageCode)
  if(!targetLanguageCode){
    alert(chrome.i18n.getMessage("alertSpecifyTargetLanguage"))
    return true
  }
  let targetLanguageName = twpLang.codeToLanguageNameInEnglish(targetLanguageCode)
  console.log("targetLanguageName:", targetLanguageName)

  const { lang: detectedSourceLang, isReliable: sourceLangIsReliable } = await detectTextLanguage(content);
  // Word-path source-language gate (issue #151): only a reliable CLD reading
  // (and a real language code) may drive the dictionary role and the
  // same-language branch. For lone words CLD is routinely unreliable AND wrong
  // (measured: "Undertow"/"hello"/"undertow" -> "sr"), and pinning that bogus
  // language into the role made the model fabricate a whole layer of it. The
  // previous "und -> English" hardcoded fallback is deliberately gone — an
  // unknown reading now travels through the language-neutral role instead.
  const sourceLanguageTrusted = sourceLangIsReliable === true && detectedSourceLang !== 'und';
  let sourceLanguageCode = detectedSourceLang;
  let sourceLanguageName = sourceLanguageTrusted
    ? twpLang.codeToLanguageNameInEnglish(sourceLanguageCode)
    : '';

  const isSameLanguage = sourceLanguageTrusted && sourceLanguageCode === targetLanguageCode

  let targetLangConfig = twpLang.otherConfigs[targetLanguageCode] 

  // ② Build translation prompt (pure builders — src/core/translator/prompts.js)
  const promptMessages = buildTranslationMessages({
    content,
    targetLanguageName,
    hostname: location.hostname,
    isSingleWord,
    targetLangConfig,
    sourceLanguageTrusted,
    sourceLanguageName,
    isSameLanguage,
  })
  const sysPromptTranslation = promptMessages.system
  requestBody.messages[0].content = sysPromptTranslation
  requestBody.messages[1].content = `I understand. Please give me the ${isSingleWord?'word':'text'}.`
  requestBody.messages[2].content = content
  console.log("user prompt to be sent:", requestBody.messages[2].content)

  // ③ Read apiKey + model (Vercel AI SDK handles all providers uniformly, driven by registry)
  const resolved = _resolveProviderSettings(provider, ensureConfigString, twpConfig);
  if (!resolved) return;
  let { apiKey, model, extra, reasoningDepth } = resolved;

  // ③b Azure-specific validation (endpoint + deployment)
  if (provider === "azure-openai") {
    let endpoint = ensureConfigString("azureOpenAIEndpoint", "promptInputAzureOpenAIEndpoint",
      "Please input your Azure OpenAI endpoint:",
      { errorMessageKey: "errorAzureOpenAIEndpointMissing", errorFallbackMessage: "Azure OpenAI endpoint is not configured." });
    if (!endpoint) return;
    endpoint = endpoint.trim().replace(/\/+$/, "");
    if (!endpoint) {
      onError?.({ error: { message: "Azure OpenAI endpoint is not configured." } });
      return;
    }
    if (endpoint !== twpConfig.get("azureOpenAIEndpoint")) {
      twpConfig.set("azureOpenAIEndpoint", endpoint);
    }
    model = (twpConfig.get("azureOpenAIModel") || "").trim();
    if (!model) {
      model = ensureConfigString("azureOpenAIModel", "promptInputAzureOpenAIModel",
        "Please input your Azure OpenAI deployment name:",
        { errorMessageKey: "errorAzureOpenAIDeploymentMissing", errorFallbackMessage: "Azure OpenAI deployment is required." });
      if (!model) return;
    }
    extra = { resourceName: new URL(endpoint).hostname.split(".")[0] };
  }

  // ④ Send structured request (Vercel AI SDK processes in background Service Worker)
  await fetchSSE({
    provider,
    apiKey,
    model,
    messages: [
      { role: "system", content: sysPromptTranslation },
      { role: "assistant", content: "I understand. Please give me the " + (isSingleWord ? "word" : "text") + "." },
      { role: "user", content },
    ],
    temperature: baseRequestBody.temperature,
    topP: baseRequestBody.top_p,
    reasoningDepth,
    onMessage: (text) => {
      try {
        if (!text) return;
        deliverTransformed(JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] }), onMessage);
      } catch (err) {
        console.warn("Failed to transform AI stream chunk", err);
      }
    },
    onError: (err) => {
      if (shouldIgnoreTransportError(err)) return;
      onError?.(err);
    },
    onFinished: () => {
      deliverTransformed("[DONE]", onMessage);
      onFinished?.();
    },
    signal,
    inactivityTimeoutMs: 60_000,
    extra,
  });
}

// Expose internal functions for testing (following the precedent in pageTranslator)
export { _resolveProviderSettings }
export { buildWordPromptRole } from "../core/translator/prompts.js"
