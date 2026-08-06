"use strict";

/**
 * 这个模块定义了内置的AI提供商列表，并提供了一个函数来合并内置、远程和用户定义的提供商注册表。
 * 它还提供了一个工厂函数来创建一个提供商注册表实例，以及一个静态函数来根据已知ID查找API基础URL。
 */

import { validateProviderDefinition } from "./providerTypes.js";

export const BUILT_IN_PROVIDERS = Object.freeze([
  // ── Global (7) ──
  {
    id: "openai", name: "OpenAI", website: "https://openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    shortDesc: "GPT, O-series models",
    apiBase: "https://api.openai.com/v1/chat/completions",
    modelListUrl: "https://api.openai.com/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id", filter: "/^(gpt|chatgpt|o\\d|omni)/i" },
    source: "built-in", category: "global", tags: ["gpt", "chatgpt"],
  },
  {
    id: "anthropic", name: "Anthropic", website: "https://anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/keys",
    shortDesc: "Claude models",
    apiBase: "https://api.anthropic.com/v1/messages",
    modelListUrl: "https://api.anthropic.com/v1/models",
    auth: { type: "api-key-header", header: "x-api-key" },
    responseFormat: "anthropic-sse", supportsStreaming: true,
    extraHeaders: { "anthropic-version": "2023-06-01" },
    modelListParser: { path: "models", valueKey: "name", labelKey: "name" },
    source: "built-in", category: "global", tags: ["claude"],
  },
  {
    id: "google-gemini", name: "Google Gemini", website: "https://ai.google.dev",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    shortDesc: "Gemini models",
    apiBase: "https://generativelanguage.googleapis.com/v1beta",
    modelListUrl: null,
    auth: { type: "query-param", header: "", queryParam: "key" },
    responseFormat: "gemini-json", supportsStreaming: false,
    modelListParser: { path: "models", valueKey: "name", labelKey: "displayName" },
    source: "built-in", category: "global", tags: ["gemini"],
  },
  {
    id: "mistral", name: "Mistral AI", website: "https://mistral.ai",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    shortDesc: "Mistral Large, Codestral, open-weight models",
    apiBase: "https://api.mistral.ai/v1/chat/completions",
    modelListUrl: "https://api.mistral.ai/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "global", tags: ["french", "opensource"],
  },
  {
    id: "cohere", name: "Cohere", website: "https://cohere.com",
    apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    shortDesc: "Command R, Aya multilingual models",
    apiBase: "https://api.cohere.com/v2/chat",
    modelListUrl: "https://api.cohere.com/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-json", supportsStreaming: false,
    modelListParser: { path: "models", valueKey: "name", labelKey: "name" },
    source: "built-in", category: "global", tags: ["enterprise"],
  },
  {
    id: "together", name: "Together AI", website: "https://together.ai",
    apiKeyUrl: "https://api.together.ai/settings/api-keys",
    shortDesc: "Open-source models at scale",
    apiBase: "https://api.together.xyz/v1/chat/completions",
    modelListUrl: "https://api.together.xyz/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "global", tags: ["opensource"],
  },
  {
    id: "groq", name: "Groq", website: "https://groq.com",
    apiKeyUrl: "https://console.groq.com/keys",
    shortDesc: "Ultra-fast LPU inference",
    apiBase: "https://api.groq.com/openai/v1/chat/completions",
    modelListUrl: "https://api.groq.com/openai/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "global", tags: ["fast"],
  },

  // ── Aggregator (1) ──
  {
    id: "openrouter", name: "OpenRouter", website: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
    shortDesc: "300+ models across providers, unified API",
    apiBase: "https://openrouter.ai/api/v1/chat/completions",
    modelListUrl: "https://openrouter.ai/api/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    extraHeaders: {},
    modelListParser: { path: "data", valueKey: "id", labelKey: "name" },
    source: "built-in", category: "global", tags: ["aggregator", "multi-provider"],
  },

  // ── Enterprise (1) ──
  {
    id: "azure-openai", name: "Azure OpenAI", website: "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
    apiKeyUrl: "https://portal.azure.com",
    shortDesc: "Enterprise-grade OpenAI models on Azure",
    apiBase: "",
    modelListUrl: null,
    auth: { type: "api-key-header", header: "api-key" },
    responseFormat: "openai-json", supportsStreaming: false,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "enterprise", tags: ["microsoft", "enterprise"],
  },

  // ── China (7) ──
  {
    id: "deepseek", name: "DeepSeek", website: "https://deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    shortDesc: "DeepSeek-Chat, DeepSeek-Reasoner",
    apiBase: "https://api.deepseek.com/v1/chat/completions",
    modelListUrl: "https://api.deepseek.com/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "china", tags: ["chinese", "reasoning"],
  },
  {
    id: "zhipu", name: "智谱AI (Zhipu/GLM)", website: "https://open.bigmodel.cn",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    shortDesc: "GLM-4, ChatGLM series",
    apiBase: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    modelListUrl: "https://open.bigmodel.cn/api/paas/v4/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "china", tags: ["chinese", "glm"],
  },
  {
    id: "moonshot", name: "月之暗面 (Moonshot/Kimi)", website: "https://moonshot.cn",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    shortDesc: "Kimi long-context models",
    apiBase: "https://api.moonshot.cn/v1/chat/completions",
    modelListUrl: "https://api.moonshot.cn/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "china", tags: ["chinese", "long-context"],
  },
  {
    id: "qwen", name: "阿里通义千问 (Qwen/DashScope)", website: "https://tongyi.aliyun.com",
    apiKeyUrl: "https://bailian.console.aliyun.com/#/api-key",
    shortDesc: "Qwen series, Tongyi Qianwen",
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    modelListUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "china", tags: ["chinese", "alibaba"],
  },
  {
    id: "baidu", name: "百度文心 (Baidu/ERNIE)", website: "https://yiyan.baidu.com",
    apiKeyUrl: "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    shortDesc: "ERNIE Bot, Qianfan platform",
    apiBase: "https://qianfan.baidubce.com/v2/chat/completions",
    modelListUrl: "https://qianfan.baidubce.com/v2/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "result", valueKey: "model", labelKey: "modelName" },
    source: "built-in", category: "china", tags: ["chinese", "baidu"],
  },
  {
    id: "bytedance", name: "字节豆包 (ByteDance/Doubao)", website: "https://www.volcengine.com/product/doubao",
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    shortDesc: "Doubao models on Volcano Engine Ark",
    apiBase: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    modelListUrl: "https://ark.cn-beijing.volces.com/api/v3/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "china", tags: ["chinese", "bytedance"],
  },
  {
    id: "iflytek", name: "讯飞星火 (iFlytek Spark)", website: "https://xinghuo.xfyun.cn",
    apiKeyUrl: "https://console.xfyun.cn/services/bm3",
    shortDesc: "Spark series models",
    apiBase: "https://spark-api-open.xf-yun.com/v1/chat/completions",
    modelListUrl: "https://spark-api-open.xf-yun.com/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "china", tags: ["chinese", "iflytek"],
  },

  // ── Research/Search (2) ──
  {
    id: "perplexity", name: "Perplexity", website: "https://perplexity.ai",
    apiKeyUrl: "https://www.perplexity.ai/settings/api",
    shortDesc: "Search-augmented AI models",
    apiBase: "https://api.perplexity.ai/chat/completions",
    modelListUrl: "https://api.perplexity.ai/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "global", tags: ["search"],
  },
  {
    id: "grok", name: "xAI (Grok)", website: "https://x.ai",
    apiKeyUrl: "https://console.x.ai",
    shortDesc: "Grok models by xAI",
    apiBase: "https://api.x.ai/v1/chat/completions",
    modelListUrl: "https://api.x.ai/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "global", tags: ["grok", "xai"],
  },

  // ── Additional providers with known endpoints (not in models.dev) ──
  {
    id: "deepinfra", name: "Deep Infra", website: "https://deepinfra.com",
    apiKeyUrl: "https://deepinfra.com/dash/api_keys",
    shortDesc: "Serverless ML inference",
    apiBase: "https://api.deepinfra.com/v1/openai/chat/completions",
    modelListUrl: "https://api.deepinfra.com/v1/openai/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "global", tags: ["serverless"],
  },
  {
    id: "cerebras", name: "Cerebras", website: "https://cerebras.ai",
    apiKeyUrl: "https://cloud.cerebras.ai",
    shortDesc: "Wafer-scale AI inference",
    apiBase: "https://api.cerebras.ai/v1/chat/completions",
    modelListUrl: "https://api.cerebras.ai/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "global", tags: ["wafer-scale"],
  },
  {
    id: "vercel", name: "Vercel AI Gateway", website: "https://vercel.com",
    apiKeyUrl: "https://vercel.com/account/tokens",
    shortDesc: "Vercel AI Gateway",
    apiBase: "https://api.vercel.ai/v1/chat/completions",
    modelListUrl: "https://api.vercel.ai/v1/models",
    auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
    responseFormat: "openai-sse", supportsStreaming: true,
    modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
    source: "built-in", category: "global", tags: ["gateway"],
  },
]);

/**
 * Merge three provider layers: built-in → remote → user.
 * Remote updates fields on existing built-ins but never changes id or source.
 * User overrides everything.
 * @param {Object[]} builtIn
 * @param {Object[]} remote
 * @param {Object[]} user
 * @param {Set<string>} [hiddenIds]
 * @returns {Object[]} merged provider definitions
 */
export function mergeRegistries(builtIn, remote, user, hiddenIds = new Set()) {
  const map = new Map();

  // Layer 1: built-in
  for (const def of builtIn) {
    map.set(def.id, { ...def });
  }

  // Layer 2: remote — overwrites fields but preserves id + source
  for (const def of remote) {
    const existing = map.get(def.id);
    if (existing) {
      const mutableFields = [
        "name", "website", "apiKeyUrl", "shortDesc", "apiBase",
        "modelListUrl", "auth", "responseFormat", "supportsStreaming",
        "modelListParser", "extraHeaders", "category", "tags",
      ];
      for (const field of mutableFields) {
        if (def[field] !== undefined) {
          existing[field] = def[field];
        }
      }
    } else {
      map.set(def.id, { ...def, source: "remote" });
    }
  }

  // Layer 3: user — full override, adds custom providers
  for (const def of user) {
    map.set(def.id, { ...def, source: def.source || "user" });
  }

  // Filter out hidden + return
  return [...map.values()].filter((p) => !hiddenIds.has(p.id));
}

/**
 * Create a provider registry instance.
 * @param {Object[]} [builtIn] - overridable for testing
 * @returns {Object} registry API
 */
export function createProviderRegistry(builtIn = BUILT_IN_PROVIDERS) {
  let _merged = [...builtIn];
  let _hiddenIds = new Set();

  /**
   * @param {Object} [opts]
   * @param {string} [opts.search] - text search across name, shortDesc, tags
   * @param {string} [opts.category] - filter by category
   * @returns {Object[]}
   */
  function listProviders(opts = {}) {
    let results = [..._merged];
    if (opts.search) {
      const q = opts.search.toLowerCase();
      results = results.filter((p) => {
        const haystack = [p.name, p.shortDesc || "", p.id, ...(p.tags || [])].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }
    if (opts.category) {
      results = results.filter((p) => p.category === opts.category);
    }
    return results;
  }

  /**
   * @param {string} id
   * @returns {Object|undefined}
   */
  function getProvider(id) {
    return _merged.find((p) => p.id === id);
  }

  return {
    listProviders,
    getProvider,
    _updateMerged(builtIn, remote, user, hiddenIds) {
      _merged = mergeRegistries(builtIn, remote, user, hiddenIds);
      _hiddenIds = hiddenIds || new Set();
    },
    _getMerged() { return _merged; },
  };
}

// ── Convenience: static API base lookup ────────────────

const _staticRegistry = createProviderRegistry(BUILT_IN_PROVIDERS);

/**
 * Look up the apiBase for a provider by any known ID (internal or models.dev).
 * @param {string} id — internal ID ("google-gemini", "together") or models.dev ID ("google", "togetherai")
 * @returns {string} apiBase or ""
 */
export function lookupKnownApiBase(id) {
  // 1. Direct registry lookup
  let def = _staticRegistry.getProvider(id);
  if (def?.apiBase) return def.apiBase;

  // 2. Reverse lookup: models.dev ID → internal ID
  const reverseMap = {
    google: "google-gemini",
    xai: "grok",
    togetherai: "together",
    zhipuai: "zhipu",
    moonshotai: "moonshot",
    "alibaba-cn": "qwen",
    azure: "azure-openai",
  };
  const internalId = reverseMap[id];
  if (internalId) {
    def = _staticRegistry.getProvider(internalId);
    if (def?.apiBase) return def.apiBase;
  }

  return "";
}
