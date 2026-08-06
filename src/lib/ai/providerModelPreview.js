/**
 * 模型列表预览 — 通过 models.dev 公开 API（无需认证）获取各提供商的模型列表，
 * 并在 models.dev 不可用时回退到内置静态模型列表。
 *
 * 缓存策略：
 * 1. 首次成功拉取后将结果保存到 chrome.storage.local
 * 2. 后续打开 options 页时优先展示缓存（即时显示），同时后台静默刷新
 * 3. 无缓存且 models.dev 不可用时使用内置静态列表
 */

const MODELSDEV_API_URL = "https://models.dev/api.json";

/**
 * 内部 provider ID → models.dev provider ID 映射。
 * 只有在此映射表中的 provider 才会从 models.dev 拉取模型。
 */
const INTERNAL_TO_MODELSDEV = Object.freeze({
  openai: "openai",
  anthropic: "anthropic",
  "google-gemini": "google",
  deepseek: "deepseek",
  grok: "xai",
  zhipu: "zhipuai",
  moonshot: "moonshotai",
  mistral: "mistral",
  cohere: "cohere",
  groq: "groq",
  together: "togetherai",
  qwen: "alibaba-cn",
  perplexity: "perplexity",
  "azure-openai": "azure",
});

/**
 * 内置静态模型列表（终极 fallback）。
 * 当无本地缓存且 models.dev 不可用时使用。
 */
const STATIC_MODELS = Object.freeze({
  openai: [
    { value: "gpt-4o", text: "GPT-4o" },
    { value: "gpt-4o-mini", text: "GPT-4o Mini" },
    { value: "gpt-4-turbo", text: "GPT-4 Turbo" },
    { value: "gpt-4", text: "GPT-4" },
    { value: "gpt-3.5-turbo", text: "GPT-3.5 Turbo" },
    { value: "o4-mini", text: "o4 Mini" },
    { value: "o3-mini", text: "o3 Mini" },
    { value: "o1", text: "o1" },
    { value: "o1-mini", text: "o1 Mini" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", text: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", text: "Claude Opus 4" },
    { value: "claude-haiku-3-5-20241022", text: "Claude 3.5 Haiku" },
    { value: "claude-3-5-sonnet-20241022", text: "Claude 3.5 Sonnet" },
    { value: "claude-3-opus-20240229", text: "Claude 3 Opus" },
  ],
  "google-gemini": [
    { value: "gemini-2.5-flash", text: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", text: "Gemini 2.5 Pro" },
    { value: "gemini-2.0-flash", text: "Gemini 2.0 Flash" },
    { value: "gemini-1.5-flash", text: "Gemini 1.5 Flash" },
    { value: "gemini-1.5-pro", text: "Gemini 1.5 Pro" },
  ],
  deepseek: [
    { value: "deepseek-chat", text: "DeepSeek Chat (V3)" },
    { value: "deepseek-reasoner", text: "DeepSeek Reasoner (R1)" },
  ],
  grok: [
    { value: "grok-3", text: "Grok 3" },
    { value: "grok-3-mini", text: "Grok 3 Mini" },
    { value: "grok-2", text: "Grok 2" },
  ],
  zhipu: [
    { value: "glm-4-plus", text: "GLM-4 Plus" },
    { value: "glm-4-flash", text: "GLM-4 Flash" },
    { value: "glm-4-air", text: "GLM-4 Air" },
    { value: "glm-4-long", text: "GLM-4 Long (1M)" },
  ],
  moonshot: [
    { value: "moonshot-v1-8k", text: "Moonshot V1 8K" },
    { value: "moonshot-v1-32k", text: "Moonshot V1 32K" },
    { value: "moonshot-v1-128k", text: "Moonshot V1 128K" },
  ],
  mistral: [
    { value: "mistral-large-latest", text: "Mistral Large" },
    { value: "mistral-small-latest", text: "Mistral Small" },
    { value: "mistral-medium-latest", text: "Mistral Medium" },
    { value: "codestral-latest", text: "Codestral" },
  ],
  cohere: [
    { value: "command-r-plus", text: "Command R Plus" },
    { value: "command-r", text: "Command R" },
    { value: "command", text: "Command" },
  ],
  together: [
    { value: "mistralai/Mixtral-8x7B-Instruct-v0.1", text: "Mixtral 8x7B" },
    { value: "meta-llama/Llama-3-70b-chat-hf", text: "Llama 3 70B" },
    { value: "meta-llama/Llama-3-8b-chat-hf", text: "Llama 3 8B" },
  ],
  groq: [
    { value: "llama-3.3-70b-versatile", text: "Llama 3.3 70B" },
    { value: "llama-3.1-8b-instant", text: "Llama 3.1 8B" },
    { value: "mixtral-8x7b-32768", text: "Mixtral 8x7B" },
  ],
  qwen: [
    { value: "qwen-max", text: "Qwen Max" },
    { value: "qwen-plus", text: "Qwen Plus" },
    { value: "qwen-turbo", text: "Qwen Turbo" },
    { value: "qwen2.5-72b-instruct", text: "Qwen 2.5 72B" },
  ],
  baidu: [
    { value: "ernie-4.0-turbo-8k", text: "ERNIE 4.0 Turbo" },
    { value: "ernie-3.5-8k", text: "ERNIE 3.5" },
    { value: "ernie-speed-8k", text: "ERNIE Speed" },
  ],
  bytedance: [
    { value: "doubao-pro-32k", text: "豆包 Pro 32K" },
    { value: "doubao-lite-32k", text: "豆包 Lite 32K" },
    { value: "doubao-pro-128k", text: "豆包 Pro 128K" },
  ],
  iflytek: [
    { value: "spark-lite", text: "Spark Lite" },
    { value: "spark-pro", text: "Spark Pro" },
    { value: "spark-max", text: "Spark Max" },
    { value: "spark-4.0-ultra", text: "Spark 4.0 Ultra" },
  ],
  perplexity: [
    { value: "sonar-small-chat", text: "Sonar Small" },
    { value: "sonar-medium-chat", text: "Sonar Medium" },
    { value: "sonar-small-online", text: "Sonar Small Online" },
  ],
  "azure-openai": [
    { value: "gpt-4o", text: "GPT-4o" },
    { value: "gpt-4o-mini", text: "GPT-4o Mini" },
    { value: "gpt-4", text: "GPT-4" },
    { value: "gpt-3.5-turbo", text: "GPT-3.5 Turbo" },
  ],
});

const ALL_PROVIDERS = Object.keys(STATIC_MODELS);
const CACHE_KEY_PREFIX = "previewModels:v4:";
const PERSISTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

/** 单次会话内缓存 models.dev 返回的原始数据 */
let _modelsDevCache = null;
let _modelsDevFetchTime = 0;
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;

/** 后台刷新进行中标记（避免重复刷新） */
let _backgroundRefreshPromise = null;

// ── 存储缓存读写 ──────────────────────────────────────

function cacheKey(provider) {
  return CACHE_KEY_PREFIX + provider;
}

async function readCache(provider) {
  try {
    const key = cacheKey(provider);
    const result = await chrome.storage.local.get(key);
    const entry = result[key];
    if (entry && Array.isArray(entry.models) && entry.models.length) {
      return entry;
    }
  } catch (_) { /* storage 不可用 */ }
  return null;
}

async function writeCache(provider, models) {
  try {
    const key = cacheKey(provider);
    await chrome.storage.local.set({
      [key]: { models, ts: Date.now() },
    });
  } catch (_) { /* storage 写入失败，静默忽略 */ }
}

function isCacheFresh(entry) {
  if (!entry?.ts) return false;
  return (Date.now() - entry.ts) < PERSISTENT_CACHE_TTL_MS;
}

// ── models.dev 拉取与解析 ───────────────────────────────

/**
 * 从 models.dev 获取全量提供商和模型数据（无需认证）。
 * 结果在会话内缓存 5 分钟。
 */
async function fetchModelsDevData(fetcher = globalThis.fetch) {
  const now = Date.now();
  if (_modelsDevCache && (now - _modelsDevFetchTime) < MEMORY_CACHE_TTL_MS) {
    return _modelsDevCache;
  }
  const response = await fetcher(MODELSDEV_API_URL);
  if (!response.ok) {
    throw new Error(`models.dev unavailable (HTTP ${response.status})`);
  }
  const payload = await response.json();
  _modelsDevCache = payload;
  _modelsDevFetchTime = now;
  return payload;
}

/**
 * 从 models.dev 数据中提取指定 provider 的模型列表。
 * models.dev 按提供商分组，每个模型直接有 id 和 name，无需像 OpenRouter 那样去前缀。
 */
function extractModelsFromDevData(provider, data) {
  // 优先用映射表（内部 ID → models.dev ID），若无映射则直接用 provider ID
  const modelsDevId = INTERNAL_TO_MODELSDEV[provider] || provider;

  const providerData = data[modelsDevId];
  if (!providerData || !providerData.models) return [];

  const seen = new Set();
  const models = [];

  for (const [modelId, modelInfo] of Object.entries(providerData.models)) {
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);

    const name = modelInfo.name || modelId;
    const pricing = modelInfo.pricing;

    models.push({
      value: modelId,
      text: name,
      ...(pricing ? { pricing: { prompt: String(pricing.input || "0"), completion: String(pricing.output || "0") } } : {}),
    });
  }

  models.sort((a, b) => a.text.localeCompare(b.text));
  return models;
}

/**
 * 从 models.dev 拉取全量数据 → 按 provider 分组 → 写入缓存。
 * 成功后返回映射表 { provider: models[] }。
 */
async function fetchAndCacheAll(fetcher) {
  const data = await fetchModelsDevData(fetcher);
  const grouped = {};
  for (const provider of ALL_PROVIDERS) {
    const models = extractModelsFromDevData(provider, data);
    if (models.length) {
      grouped[provider] = models;
      await writeCache(provider, models);
    }
  }
  return grouped;
}

/**
 * 后台静默刷新全部 provider 的缓存（fire-and-forget）。
 */
function backgroundRefresh(fetcher) {
  if (_backgroundRefreshPromise) return;
  _backgroundRefreshPromise = fetchAndCacheAll(fetcher)
    .catch(() => { /* 静默失败 */ })
    .finally(() => { _backgroundRefreshPromise = null; });
}

// ── 智能默认模型选择 ──────────────────────────────────

const PROVIDER_PRIORITY = Object.freeze({
  openai: [
    "gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo",
    "o4-mini", "o3-mini", "o1-mini", "o1",
  ],
  anthropic: [
    "claude-haiku-3-5-20241022", "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022", "claude-opus-4-20250514",
    "claude-3-opus-20240229",
  ],
  "google-gemini": [
    "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash",
    "gemini-2.5-pro", "gemini-1.5-pro",
  ],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  grok: ["grok-3-mini", "grok-3", "grok-2"],
  "azure-openai": ["gpt-4o-mini", "gpt-4o", "gpt-4", "gpt-3.5-turbo"],
});

function scoreModelByName(text) {
  const lower = String(text || "").toLowerCase();
  let score = 0;
  for (const kw of ["mini", "flash", "haiku", "lite", "nano", "small", "turbo", "air"]) {
    if (lower.includes(kw)) score += 5;
  }
  for (const kw of ["pro", "opus", "ultra", "max", "preview", "legacy", "experimental"]) {
    if (lower.includes(kw)) score -= 3;
  }
  const verMatch = lower.match(/(\d+(?:\.\d+)*)/g);
  if (verMatch) {
    const nums = verMatch.map((v) => parseFloat(v) || 0);
    score += Math.max(...nums) * 2;
  }
  return score;
}

/**
 * 根据提供的模型列表和 provider，智能选择一个默认模型。
 * 优先级：
 * 1. 如果 models 含有 pricing 字段，则选择单价最低的模型（由于模型列表获取已从openrouter改为models.dev，后者数据不包含price，所以其实第一步不会真正生效）
 * 2. 否则根据名称启发式打分，选择得分最高的模型（适用于内置静态列表）
 * 3. 否则根据 PROVIDER_PRIORITY 中的优先级顺序选择第一个匹配的模型
 * 4. 否则返回 null（不指定默认模型）
 */
export function getSmartDefaultModel({ provider, models }) {
  if (!Array.isArray(models) || !models.length) return null;

  // Tier 1 — models.dev 定价（仅 models 含 pricing 时适用）
  const withPricing = models.filter((m) => m?.pricing?.prompt && m?.pricing?.completion);
  if (withPricing.length) {
    const cheapest = withPricing.reduce((best, cur) => {
      const curTotal = parseFloat(cur.pricing.prompt) + parseFloat(cur.pricing.completion);
      const bestTotal = parseFloat(best.pricing.prompt) + parseFloat(best.pricing.completion);
      return curTotal < bestTotal ? cur : best;
    });
    if (cheapest) return cheapest.value;
  }

  // Tier 2 — 名称启发式
  const scored = models
    .map((m) => ({ ...m, _score: scoreModelByName(m.text || m.value) }))
    .filter((m) => m._score > 0)
    .sort((a, b) => b._score - a._score);
  if (scored.length) return scored[0].value;

  // Tier 3 — 静态优先级
  const priority = PROVIDER_PRIORITY[provider] || [];
  for (const preferred of priority) {
    if (models.some((m) => m.value === preferred)) return preferred;
  }

  return null;
}

// ── 主导出函数 ─────────────────────────────────────────

/**
 * 获取指定 provider 的预览模型列表。
 *
 * 优先级：
 * 1. 本地缓存（chrome.storage.local）→ 即时返回，同时后台刷新
 * 2. models.dev 实时拉取 → 写入缓存 → 返回
 * 3. 内置静态列表（终极 fallback）
 *
 * @param {Object} options
 * @param {string} options.provider - 内部 provider 名称
 * @param {Function} [options.fetcher=globalThis.fetch]
 * @returns {Promise<Array<{value: string, text: string}>>}
 */
export async function loadPreviewModels({ provider, fetcher = globalThis.fetch }) {
  // 1. 优先读本地缓存（即时显示）
  const cached = await readCache(provider);
  if (cached?.models?.length) {
    // 仅在缓存超过 24 小时时后台刷新
    if (!isCacheFresh(cached)) {
      backgroundRefresh(fetcher);
    }
    return cached.models;
  }

  // 2. 无缓存 → 实时从 models.dev 拉取
  try {
    const data = await fetchModelsDevData(fetcher);
    const models = extractModelsFromDevData(provider, data);
    if (models.length) {
      writeCache(provider, models); // 异步缓存，不阻塞
      return models;
    }
  } catch (_) {
    // models.dev 不可用
  }

  // 3. 终极 fallback：内置静态列表
  return [...(STATIC_MODELS[provider] || [])];
}

export function getPreviewProviders() {
  return ALL_PROVIDERS;
}
