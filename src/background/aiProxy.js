/**
 * AI backend proxy — handles provider requests using Vercel AI SDK streamText().
 * Dynamic npm → SDK client mapping via models.dev data.
 *
 * Data flow:
 *   models.dev/api.json → cached in chrome.storage.local
 *   provider.npm → SDK_MAP lookup for createXxx function
 *   unknown npm → fallback to @ai-sdk/openai-compatible
 *
 * ═══════════════════════════════════════════════════════════
 * Why do some providers use the openai-compatible fallback?
 * ═══════════════════════════════════════════════════════════
 *
 * OpenRouter is the canonical example: its API is fully OpenAI-compatible
 * (/v1/chat/completions), but has no @ai-sdk/openrouter entry in SDK_MAP.
 * This is intentional, not an oversight:
 *
 * 1. Vercel AI SDK does not ship an @ai-sdk/openrouter package.
 * 2. Mapping to @ai-sdk/openai would pull in OpenAI-specific features
 *    (Responses API, Realtime API, Files API) that OpenRouter doesn't support,
 *    and whose error-handling semantics may differ.
 * 3. @ai-sdk/openai-compatible is a cleaner abstraction — it depends only on
 *    the standard /v1/chat/completions contract, without binding to any
 *    provider's proprietary extensions.
 * 4. createOpenAICompatible({ baseURL: "https://openrouter.ai/api/v1" })
 *    produces HTTP requests functionally identical to createOpenAI — OpenRouter
 *    acts as a transparent proxy for the OpenAI format.
 *
 * The same applies to any other provider whose API is OpenAI-compatible but
 * lacks a dedicated SDK (100+ smaller providers in models.dev). As long as
 * their chat endpoint accepts standard OpenAI JSON, the openai-compatible
 * fallback works correctly.
 *
 * Only providers with non-standard APIs or important proprietary features
 * warrant a dedicated SDK_MAP entry (e.g. Anthropic Messages API,
 * Google Gemini generateContent API).
 */

import { streamText } from "ai";

// ── SDK mapping table: npm package name → createXxx function ──────────────
// Only includes SDK packages usable in browser/Service Worker environments.
// Node.js-only packages (e.g. google-vertex, amazon-bedrock) use openai-compatible fallback.
//
// Note: the following providers intentionally route through openai-compatible fallback:
//   • OpenRouter — no @ai-sdk/openrouter package; API is fully OpenAI-compatible
//   • Any models.dev provider whose npm field does not match SDK_MAP
// See file header comment for details.

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

/** npm package name → createXxx function */
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

// ── models.dev data cache ────────────────────────────────

const MODELSDEV_URL = "https://models.dev/api.json";
const MODELSDEV_CACHE_KEY = "modelsdev:providers";
let _providersData = null;

const MODELSDEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getProvidersData() {
  if (_providersData) return _providersData;
  try {
    const result = await chrome.storage.local.get(MODELSDEV_CACHE_KEY);
    const cached = result[MODELSDEV_CACHE_KEY];
    if (cached?.data && Object.keys(cached.data).length > 10) {
      _providersData = cached.data;
      const age = Date.now() - (cached.ts || 0);
      if (age > MODELSDEV_CACHE_TTL_MS) {
        refreshProvidersData(); // Cache expired, refresh in background
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
    // Re-check cache age to avoid concurrent duplicate fetches
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

getProvidersData(); // Fetch on startup

// ── Client creation (dynamic npm → SDK mapping) ──────────────────

export async function createModelClient({ provider, apiKey, model, extra = {} }) {
  const data = await getProvidersData();
  const providerData = data?.[provider];
  const npm = providerData?.npm;
  const rawApi = providerData?.api || "";
  const apiBase = extra.baseURL || (rawApi && !rawApi.includes("${") ? rawApi : "") || lookupKnownApiBase(provider) || undefined;

  // Azure special handling
  if (provider === "azure" || provider === "azure-openai") {
    const resourceName = extra.resourceName || "";
    return createAzure({ apiKey, resourceName, baseURL: apiBase })(model);
  }

  // Lookup SDK mapping
  if (npm && SDK_MAP[npm]) {
    try {
      return SDK_MAP[npm]({ apiKey, baseURL: apiBase })(model);
    } catch (_) {}
  }

  // Fallback: OpenAI-compatible client
  if (!apiBase) {
    throw new Error(`Unknown AI provider "${provider}" and no base URL in models.dev data`);
  }
  return createOpenAICompatible({
    name: providerData?.name || provider,
    apiKey,
    baseURL: apiBase,
  })(model);
}

// ── Port listener ──────────────────────────────────────────

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
 * Compatible with both old and new field names for AI SDK `text-delta` events.
 * New versions use `part.text`, older/historical bundles may still use `part.textDelta`.
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
          // maxRetries: 0 — disable AI SDK built-in retries; retry strategy is unified
          // by the content script's aiTranslateDynamically() with 10s backoff to avoid request storms.
          const result = streamText({ model: languageModel, messages, temperature, topP, maxRetries: 0, abortSignal: controller.signal });
          let totalChunks = 0;
          let streamError = null;
          for await (const part of result.fullStream) {
            if (part.type === "error") {
              streamError = part.error; // Save original API error
            } else if (part.type === "text-delta") {
              const chunkText = _extractAiTextDelta(part);

              // Skip empty chunks to avoid counting `undefined` as successful output, which would cause
              // the frontend to receive only "done" without any text.
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
