/**
 * 本文件是请求编排层
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
  // 读取用户自定义的 API Base URL（优先于 provider 内置默认值）
  const userApiBase = (providerConfigsForModel[providerId]?.apiBase || "").trim();
  const isUserCustom = !!userApiBase;

  // 计算有效的 baseURL
  // - 用户自定义：去除端点后缀（/chat/completions、/messages），自动补全版本路径（/v1、/v1beta）
  // - 内置默认：提取 base 路径（Google 保留 /v1beta，其他取 origin + /v1）
  let effectiveBaseURL = "";
  if (isUserCustom) {
    // ① 去除已知的端点后缀和尾部斜杠
    effectiveBaseURL = userApiBase
      .replace(/\/(chat\/completions|messages)\/?$/, "")
      .replace(/\/+$/, "");

    // ② 检测是否已包含非根路径（如 /v1、/v1beta、/api 等）
    const url = new URL(effectiveBaseURL);
    const hasPath = url.pathname !== "/" && url.pathname !== "";

    // ③ 如未包含路径，根据 provider 类型追加默认版本路径
    if (!hasPath) {
      // 判断是否为 Google 系 provider（gemini-json 响应格式）
      const isGoogle = providerId === "google-gemini" || providerId === "google"
        || providerDef?.responseFormat === "gemini-json";
      // Google 使用 /v1beta，其余 provider 使用 /v1
      effectiveBaseURL += isGoogle ? "/v1beta" : "/v1";
    }
  } else if (providerDef?.apiBase) {
    // Google 内置 apiBase 已含 /v1beta，直接使用；其他 provider 取 origin + /v1
    if (providerId === "google-gemini" || providerDef?.responseFormat === "gemini-json") {
      effectiveBaseURL = providerDef.apiBase;
    } else {
      effectiveBaseURL = new URL(providerDef.apiBase).origin + "/v1";
    }
  }

  if (effectiveBaseURL) {
    // 用户自定义了 API Base URL → 始终传递给所有 provider 的 SDK
    // 所有 SDK_MAP 中的 createXxx 函数均接受 baseURL 参数
    if (isUserCustom) {
      extra.baseURL = effectiveBaseURL;
    } else {
      // 非自定义：仅对 OpenAI-compatible 格式和特定 provider 设置 baseURL
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
    // 仅在用户通过 legacy key 设置时才覆盖；否则保留 providerConfigs 或内置默认值
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
  model: "", // 将从配置中动态获取
  // 采样温度，介于0和2之间, 控制结果的随机性。 数值越高越随机。
  temperature: 0.1,
  // 温度采样的替代方案. 介于0-1之间. 控制输出单词的多样性. 数值越高越随机。
  top_p: 0.1,
  // frequency_penalty这个参数是在生成句子的时候加入惩罚项减少总体上使用频率较高的单词/短语的概率，增加使用频率较低的单词/短语的可能性。
  // 0表示没有惩罚，1表示使用频率高的单词/短语完全不允许出现。
  frequency_penalty: 0,
  // presence_penalty这个参数是在生成句子的时候加入惩罚项来限制重复单词的，如果输出的文章不能包含与输入段落中已有的单词相同的单词，则会影响最终的输出。
  // 它的值可以是 0 到 1，其中 0 表示没有惩罚，1 表示完全禁止模型复制输入段落中出现的单词或短语。
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

// ── 提取到模块级别的纯函数助手（便于测试） ──

/**
 * 判断错误是否应被忽略（用户主动取消或 abort）
 * @internal — 从 translateWithAI 提取，供测试使用
 */
export function shouldIgnoreTransportError(err) {
  const errorName = err?.name || err?.error?.name;
  return errorName === 'AbortError' || errorName === 'CanceledError';
}

/**
 * 将 AI 响应 payload 转换为文本并传递给 onMessage
 * @internal — 从 translateWithAI 提取，供测试使用
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
 * 判断原始流 chunk 是否为可投递的有效 JSON 或 [DONE]
 * @internal — 从 translateWithAI 提取，供测试使用
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

  // ① 读取配置
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

  // ② 构建翻译 prompt
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

  // ③ 读取 apiKey + model（Vercel AI SDK 统一处理各 provider，通过 registry 驱动）
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

  // ④ 发送结构化请求（Vercel AI SDK 在后台 Service Worker 中处理）
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

// 暴露内部函数供测试使用（遵循 pageTranslator 中的先例）
export { _resolveProviderSettings }
