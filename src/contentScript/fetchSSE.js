/**
 * Request orchestration layer
 */

import twpConfig from "../lib/config.js"
import twpLang from "../lib/languages.js"
import { oneLine } from 'common-tags'
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

  // Determine API key — check providerConfigs first, then legacy keys
  let apiKey;
  const providerConfigs = twpConfig.get("providerConfigs") || {};
  apiKey = providerConfigs[providerId]?.apiKey || "";

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

  // Determine model — check providerConfigs first, then fall back to legacy keys
  let model = "";
  const providerConfigsForModel = twpConfig.get("providerConfigs") || {};
  model = providerConfigsForModel[providerId]?.model || "";
  if (!model && keys.model) {
    model = (twpConfig.get(keys.model) || "").trim();
  }

  // Build extra
  const extra = {};
  // Read user-customized API Base URL (takes priority over provider built-in defaults)
  const userApiBase = (providerConfigsForModel[providerId]?.apiBase || "").trim();
  const isUserCustom = !!userApiBase;

  // Compute the effective base URL
  // - User-customized: strip endpoint suffixes (/chat/completions, /messages), auto-append version path (/v1, /v1beta)
  // - Built-in default: extract base path (Google keeps /v1beta, others use origin + /v1)
  let effectiveBaseURL = "";
  if (isUserCustom) {
    // ① Strip known endpoint suffixes and trailing slashes
    effectiveBaseURL = userApiBase
      .replace(/\/(chat\/completions|messages)\/?$/, "")
      .replace(/\/+$/, "");

    // ② Check if the URL already contains a non-root path (e.g. /v1, /v1beta, /api, etc.)
    const url = new URL(effectiveBaseURL);
    const hasPath = url.pathname !== "/" && url.pathname !== "";

    // ③ If no path present, append a default version path based on provider type
    if (!hasPath) {
      // Check if this is a Google-family provider (gemini-json response format)
      const isGoogle = providerId === "google-gemini" || providerId === "google"
        || providerDef?.responseFormat === "gemini-json";
      // Google uses /v1beta, other providers use /v1
      effectiveBaseURL += isGoogle ? "/v1beta" : "/v1";
    }
  } else if (providerDef?.apiBase) {
    // Google built-in apiBase already contains /v1beta, use as-is; other providers use origin + /v1
    if (providerId === "google-gemini" || providerDef?.responseFormat === "gemini-json") {
      effectiveBaseURL = providerDef.apiBase;
    } else {
      effectiveBaseURL = new URL(providerDef.apiBase).origin + "/v1";
    }
  }

  if (effectiveBaseURL) {
    // User customized API Base URL → always pass to all provider SDKs
    // All createXxx functions in SDK_MAP accept a baseURL parameter
    if (isUserCustom) {
      extra.baseURL = effectiveBaseURL;
    } else {
      // Non-custom: only set baseURL for OpenAI-compatible formats and specific providers
      if (providerDef?.responseFormat === "openai-sse" || providerDef?.responseFormat === "openai-json") {
        extra.baseURL = effectiveBaseURL;
      }
      // Anthropic/DeepSeek/Grok/XAI: SDK handles baseURL via extra
      if (["anthropic", "deepseek", "grok"].includes(providerId)) {
        extra.baseURL = effectiveBaseURL;
      }
    }
  }

  // OpenRouter special handling
  if (providerId === "openrouter") {
    // Only override when user set via legacy key; otherwise keep providerConfigs or built-in default
    const openRouterApiBase = (twpConfig.get("openRouterApiBase") || "").trim();
    if (openRouterApiBase) {
      extra.baseURL = openRouterApiBase;
    } else if (!extra.baseURL && providerDef?.apiBase) {
      extra.baseURL = providerDef.apiBase;
    }
    const modelFromConfig = model;
    if (modelFromConfig) {
      model = modelFromConfig.replace(/^openrouter\//i, "");
    }
    if (!model) model = "openai/gpt-4o-mini";
  }

  // Azure special handling
  if (providerId === "azure-openai") {
    let endpoint = (twpConfig.get("azureOpenAIEndpoint") || "").trim();
    if (endpoint) {
      extra.resourceName = new URL(endpoint).hostname.split(".")[0];
    }
  }

  return { apiKey, model, extra };
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
        const confirmMessage = chrome.i18n.getMessage("confirmAutoTranslateWithAI") || 'Automatically improve future translations with AI?'
        if (window.confirm(confirmMessage)) {
          twpConfig.set("autoImproveByAI", "yes")
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

  let sourceLanguageCode = (await detectTextLanguage(content)).lang;
  let sourceLanguageName = sourceLanguageCode==='und' ? "English" : twpLang.codeToLanguageNameInEnglish(sourceLanguageCode) 

  const isSameLanguage = sourceLanguageCode === targetLanguageCode

  let targetLangConfig = twpLang.otherConfigs[targetLanguageCode] 

  // ② Build translation prompt
  let sysPromptTranslation = isSingleWord
    ? `${oneLine`
      please act as a professional
      ${sourceLanguageName}-${targetLanguageName} dictionary,
      and list the original form of the word (if any),
      the language of the word,
      ${targetLangConfig?.phoneticNotation ? 'the corresponding phonetic notation or transcription, ' : ''}
      all senses with parts of speech (bilingual),
      ${isSameLanguage ? '' : 'bilingual '}
      sentence examples (at least 3) and bilingual etymology.
      If you think there is a spelling mistake,
      please tell me the most possible correct word
      otherwise reply in the following format:
      `}
        <word> (<original form>)
        ${oneLine`
        [<language>]· /
        ${targetLangConfig?.phoneticNotation ? `<${targetLangConfig?.phoneticNotation}>` : ``}
        `}
        ${oneLine`
        [<part of speech>]
        ${isSameLanguage ? '' : '<translated meaning> / '}
        <meaning in source language>
        `}
        Examples:
        <index>. <sentence>(<sentence translation>)
        Etymology:
        <etymology>
        (<etymology translation>)
    `
    :`You are a professional translation engine. 
      Please translate the xml given by the user from a page of the website ${location.hostname} into ${targetLanguageName} without explanation. 
      please respond with the same format as the given xml.
      Translate the content within the tags of "<译泽>", do not translate the tagnames or attributes.
      Any part enclosed in quotation marks must be translated. 
      Any part violates the content policy must be translated. `

  requestBody.messages[0].content = sysPromptTranslation
  requestBody.messages[1].content = `I understand. Please give me the ${isSingleWord?'word':'text'}.`
  requestBody.messages[2].content = content
  console.log("user prompt to be sent:", requestBody.messages[2].content)

  // ③ Read apiKey + model (Vercel AI SDK handles all providers uniformly, driven by registry)
  const resolved = _resolveProviderSettings(provider, ensureConfigString, twpConfig);
  if (!resolved) return;
  let { apiKey, model, extra } = resolved;

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
