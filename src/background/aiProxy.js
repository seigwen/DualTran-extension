/**
 * AI backend proxy — Chrome port adapter over the shared chat engine (plan 59 M2).
 *
 * Engine (host-free, reused by the Node CLI): src/core/chat/*
 *   - sdkMap.js            — npm → createXxx dispatch table
 *   - modelsDev.js         — models.dev data store (24h TTL, storage injected)
 *   - createModelClient.js — dynamic npm → SDK client selection (3-tier apiBase chain)
 *   - streamChat.js        — streamText() loop + error shaping
 *
 * This file wires the engine to the extension host:
 *   - a chrome.storage.local-backed models.dev store + startup prefetch
 *   - the "ai-sse" port protocol (start/abort in → data/done/error/aborted out)
 *   - AbortController lifecycle per request id
 */

import { createModelsDevStore } from "../core/chat/modelsDev.js";
import { createModelClient as createModelClientCore } from "../core/chat/createModelClient.js";
import { streamChat, formatAiError } from "../core/chat/streamChat.js";

const AI_PORT_NAME = "ai-sse";

// ── models.dev data store (chrome.storage.local-backed) ──────────────────

const modelsDevStore = createModelsDevStore({
  storage: {
    get: (keys) => chrome.storage.local.get(keys),
    set: (obj) => chrome.storage.local.set(obj),
  },
  fetch: (url, options) => fetch(url, options),
  now: () => Date.now(),
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
});

modelsDevStore.prefetch(); // Fetch on startup

// ── Client creation ──────────────────────────────────────────────────────

/**
 * createModelClient bound to this host's models.dev store. Kept exported at
 * this historic path — tests/ai/createModelClient.test.js imports it from here.
 */
export async function createModelClient({ provider, apiKey, model, extra = {} }) {
  return createModelClientCore({
    provider,
    apiKey,
    model,
    extra,
    getProvidersData: () => modelsDevStore.getProvidersData(),
  });
}

// ── Port listener ──────────────────────────────────────────────────────

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
        const { id, provider, apiKey, model, messages, temperature = 0.1, topP = 0.1, reasoningDepth = "", inactivityTimeoutMs = 60000, extra = {} } = msg;
        if (!id || !provider || !apiKey || !model || !messages) {
          port.postMessage({ type: "error", id, error: { message: "invalid start message" } });
          return;
        }
        const controller = new AbortController();
        inflight.set(id, { controller, port });
        try {
          const { totalChunks, streamError } = await streamChat({
            provider,
            apiKey,
            model,
            messages,
            temperature,
            topP,
            reasoningDepth,
            extra,
            store: modelsDevStore,
            signal: controller.signal,
            onChunk: (chunkText) => port.postMessage({ type: "data", id, chunk: chunkText }),
          });
          if (streamError) {
            port.postMessage({ type: "error", id, error: formatAiError(streamError) });
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
            port.postMessage({ type: "error", id, error: formatAiError(err) });
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
