/**
 * AI 请求后台代理 — 使用 Vercel AI SDK streamText() 处理各提供商的请求。
 * 通过 models.dev 数据实现 npm 包 → SDK 客户端的动态映射。
 *
 * 数据流：
 *   models.dev/api.json → 缓存到 chrome.storage.local
 *   provider.npm → SDK_MAP 查找 createXxx 函数
 *   未知 npm → fallback 到 @ai-sdk/openai-compatible
 *
 * ═══════════════════════════════════════════════════════════
 * 为什么有些提供商走 openai-compatible fallback？
 * ═══════════════════════════════════════════════════════════
 *
 * OpenRouter 是典型例子：它的 API 完全兼容 OpenAI 格式（/v1/chat/completions），
 * 但在 SDK_MAP 中没有 @ai-sdk/openrouter 条目。这不是疏漏，而是有意设计：
 *
 * 1. Vercel AI SDK 官方没有提供 @ai-sdk/openrouter 包。
 * 2. 即使将其映射到 @ai-sdk/openai，OpenAI SDK 包含 OpenRouter 不支持的
 *    专有功能（Responses API、Realtime API、Files API），错误处理语义也可能差异。
 * 3. @ai-sdk/openai-compatible 是更干净的抽象 — 只依赖标准 /v1/chat/completions
 *    契约，不绑定任何提供商的专有扩展。
 * 4. createOpenAICompatible({ baseURL: "https://openrouter.ai/api/v1" })
 *    产生的 HTTP 请求与 createOpenAI 完全等价 — OpenRouter 本身就是 OpenAI
 *    格式的透明代理。
 *
 * 同理适用于其他 API 格式为 OpenAI-compatible 但没有专用 SDK 的提供商
 * （如 models.dev 中的 100+ 小型提供商）。只要它们的 chat endpoint 接受标准
 * OpenAI JSON 格式，openai-compatible fallback 就能正确工作。
 *
 * 只有提供非标准 API 或有重要专有特性的提供商才值得加入 SDK_MAP
 * （如 Anthropic 的 Messages API、Google Gemini 的 generateContent API）。
 */

import { streamText } from "ai";

// ── SDK 映射表：npm 包名 → createXxx 函数 ──────────────
// 仅包含可在浏览器/Service Worker 环境中使用的 SDK 包。
// Node.js 专有包（如 google-vertex, amazon-bedrock）走 openai-compatible fallback。
//
// 注意：以下提供商有意通过 openai-compatible fallback 路由，而非专用 SDK：
//   • OpenRouter — 无 @ai-sdk/openrouter 包；API 完全兼容 OpenAI 格式
//   • 任何 models.dev 中 npm 字段不匹配 SDK_MAP 的提供商
// 详见本文件头部注释。

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { createAzure } from "@ai-sdk/azure";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createGroq } from "@ai-sdk/groq";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/** npm 包名 → createXxx 函数 */
const SDK_MAP = Object.freeze({
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/deepseek": createDeepSeek,
  "@ai-sdk/xai": createXai,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/deepinfra": createDeepInfra,
});

import { lookupKnownApiBase } from "../lib/ai/providerRegistry.js";

const AI_PORT_NAME = "ai-sse";

// ── models.dev 数据缓存 ────────────────────────────────

const MODELSDEV_URL = "https://models.dev/api.json";
const MODELSDEV_CACHE_KEY = "modelsdev:providers";
let _providersData = null;

const MODELSDEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

async function getProvidersData() {
  if (_providersData) return _providersData;
  try {
    const result = await chrome.storage.local.get(MODELSDEV_CACHE_KEY);
    const cached = result[MODELSDEV_CACHE_KEY];
    if (cached?.data && Object.keys(cached.data).length > 10) {
      _providersData = cached.data;
      const age = Date.now() - (cached.ts || 0);
      if (age > MODELSDEV_CACHE_TTL_MS) {
        refreshProvidersData(); // 缓存过期，后台刷新
      }
      return _providersData;
    }
  } catch (_) {}
  try {
    const resp = await fetch(MODELSDEV_URL);
    if (resp.ok) {
      _providersData = await resp.json();
      chrome.storage.local.set({ [MODELSDEV_CACHE_KEY]: { data: _providersData, ts: Date.now() } });
      return _providersData;
    }
  } catch (_) {}
  return null;
}

async function refreshProvidersData() {
  try {
    // 再次检查缓存年龄，避免并发重复拉取
    const result = await chrome.storage.local.get(MODELSDEV_CACHE_KEY);
    const cached = result[MODELSDEV_CACHE_KEY];
    if (cached?.ts && (Date.now() - cached.ts) < MODELSDEV_CACHE_TTL_MS) return;
  } catch (_) {}
  try {
    const resp = await fetch(MODELSDEV_URL);
    if (resp.ok) {
      _providersData = await resp.json();
      chrome.storage.local.set({ [MODELSDEV_CACHE_KEY]: { data: _providersData, ts: Date.now() } });
    }
  } catch (_) {}
}

getProvidersData(); // 启动时拉取

// ── 客户端创建（动态 npm → SDK 映射） ──────────────────

export async function createModelClient({ provider, apiKey, model, extra = {} }) {
  const data = await getProvidersData();
  const providerData = data?.[provider];
  const npm = providerData?.npm;
  const rawApi = providerData?.api || "";
  const apiBase = extra.baseURL || (rawApi && !rawApi.includes("${") ? rawApi : "") || lookupKnownApiBase(provider) || undefined;

  // Azure 特例处理
  if (provider === "azure" || provider === "azure-openai") {
    const resourceName = extra.resourceName || "";
    return createAzure({ apiKey, resourceName, baseURL: apiBase })(model);
  }

  // 查 SDK 映射表
  if (npm && SDK_MAP[npm]) {
    try {
      return SDK_MAP[npm]({ apiKey, baseURL: apiBase })(model);
    } catch (_) {}
  }

  // Fallback: OpenAI 兼容客户端
  if (!apiBase) {
    throw new Error(`Unknown AI provider "${provider}" and no base URL in models.dev data`);
  }
  return createOpenAICompatible({
    name: providerData?.name || provider,
    apiKey,
    baseURL: apiBase,
  })(model);
}

// ── Port 监听 ──────────────────────────────────────────

/**
 * Extract the most user-friendly error message from an AI SDK or fetch error.
 * Priority: original API error message → status code hint → raw message → string fallback
 */
function _formatErrorPayload(err) {
  const apiMsg = err?.data?.error?.message || err?.responseBody?.error?.message || "";
  const statusCode = err?.statusCode || err?.status || "";
  const sdkMsg = err?.message || "";

  let message = "";
  if (apiMsg) {
    message = apiMsg;
  } else if (statusCode) {
    // Map common status codes to user-friendly hints
    const hints = { 401: "Invalid or missing API key", 403: "Access denied", 429: "Rate limit exceeded", 500: "Server error", 503: "Service unavailable" };
    const hint = hints[statusCode] || `HTTP ${statusCode}`;
    message = sdkMsg ? `${hint}: ${sdkMsg}` : hint;
  } else if (sdkMsg) {
    message = sdkMsg;
  } else {
    message = String(err || "Unknown error");
  }
  return { message };
}

/**
 * 兼容 AI SDK `text-delta` 事件的新旧字段名。
 * 新版使用 `part.text`，旧版或历史 bundle 可能仍然使用 `part.textDelta`。
 */
function _extractAiTextDelta(part) {
  if (typeof part?.text === "string") {
    return part.text;
  }
  if (typeof part?.textDelta === "string") {
    return part.textDelta;
  }
  return "";
}

const inflight = new Map();

function clearRequest(id) {
  const ctx = inflight.get(id);
  if (ctx) {
    if (ctx.timer) { try { clearTimeout(ctx.timer); } catch {} }
    inflight.delete(id);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== AI_PORT_NAME) return;

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg?.type === "abort" && msg?.id) {
        inflight.get(msg.id)?.controller?.abort();
        return;
      }
      if (msg?.type === "start") {
        const { id, provider, apiKey, model, messages, temperature = 0.1, topP = 0.1, inactivityTimeoutMs = 60000, extra = {} } = msg;
        if (!id || !provider || !apiKey || !model || !messages) {
          port.postMessage({ type: "error", id, error: { message: "invalid start message" } });
          return;
        }
        const controller = new AbortController();
        inflight.set(id, { controller, port });
        try {
          const languageModel = await createModelClient({ provider, apiKey, model, extra });
          // maxRetries: 0 — 禁用 AI SDK 内置重试，由 content script 的 aiTranslateDynamically()
          // 间隔重试机制统一控制重试策略（带 10s 退避），避免多层重试叠加导致请求风暴。
          const result = streamText({ model: languageModel, messages, temperature, topP, maxRetries: 0, abortSignal: controller.signal });
          let totalChunks = 0;
          let streamError = null;
          for await (const part of result.fullStream) {
            if (part.type === "error") {
              streamError = part.error; // 保存原始 API 错误
            } else if (part.type === "text-delta") {
              const chunkText = _extractAiTextDelta(part);

              // 跳过空 chunk，避免“把 `undefined` 计为成功输出而导致前端只收到 done 不收到文本”。
              if (!chunkText) {
                continue;
              }

              totalChunks++;
              port.postMessage({ type: "data", id, chunk: chunkText });
            }
          }
          if (streamError) {
            port.postMessage({ type: "error", id, error: _formatErrorPayload(streamError) });
          } else if (totalChunks === 0) {
            port.postMessage({ type: "error", id, error: { message: "No response from AI provider" } });
          } else {
            port.postMessage({ type: "done", id });
          }
          clearRequest(id);
        } catch (err) {
          const timedOut = inflight.get(id)?.timedOut;
          if (timedOut) {
            port.postMessage({ type: "error", id, error: { type: "timeout", message: "Request timed out" } });
          } else if (err?.name === "AbortError") {
            port.postMessage({ type: "aborted", id });
          } else {
            port.postMessage({ type: "error", id, error: _formatErrorPayload(err) });
          }
          clearRequest(id);
        }
      }
    } catch (e) {
      try { port.postMessage({ type: "error", error: { message: String(e?.message || e) } }); } catch {}
    }
  });

  port.onDisconnect.addListener(() => {
    for (const [id, ctx] of Array.from(inflight.entries())) {
      if (ctx.port === port) { try { ctx.controller.abort(); } catch {}; clearRequest(id); }
    }
  });
});
