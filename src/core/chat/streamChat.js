/**
 * streamChat — the shared streamText() loop (plan 59 M2 — extracted from the
 * port handler in src/background/aiProxy.js).
 *
 * Shape discipline: the streamText() call below keeps the exact argument
 * shape the previous in-aiProxy implementation used —
 *   streamText({ model, messages, temperature, topP, ...(providerOptions ? { providerOptions } : {}), maxRetries: 0, abortSignal })
 * — because tests/background/aiProxyReasoningDepth.test.js vi.mocks "ai" and
 * asserts the captured port→providerOptions chain. A shape drift turns that
 * file RED first; do not "tidy" the call.
 *
 * The stream result is returned as a summary ({ totalChunks, streamError })
 * instead of being thrown: the port handler maps it to its message protocol,
 * and other hosts (Node CLI) consume it directly.
 */
import { streamText } from "ai";
import { buildProviderOptions } from "../providers/reasoningDepth.js";
import { resolveModelsDevId } from "../providers/registry.js";
import { createModelClient } from "./createModelClient.js";

/**
 * Extract the most user-friendly error message from an AI SDK or fetch error.
 * Priority: original API error message → status code hint → raw message → string fallback
 */
export function formatAiError(err) {
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

/**
 * Run one streaming chat request.
 *
 * @param {Object} opts
 * @param {string} opts.provider
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Array} opts.messages
 * @param {number} [opts.temperature=0.1]
 * @param {number} [opts.topP=0.1]
 * @param {string} [opts.reasoningDepth=""]
 * @param {Object} [opts.extra={}] — baseURL / resourceName ...
 * @param {Object|null} [opts.store=null] — models.dev store (createModelsDevStore)
 * @param {AbortSignal} [opts.signal]
 * @param {(text: string) => void} [opts.onChunk]
 * @returns {Promise<{ totalChunks: number, streamError: * }>}
 */
export async function streamChat({
  provider,
  apiKey,
  model,
  messages,
  temperature = 0.1,
  topP = 0.1,
  reasoningDepth = "",
  extra = {},
  store = null,
  signal = undefined,
  onChunk = () => {},
}) {
  const getProvidersData = store ? () => store.getProvidersData() : null;

  const languageModel = await createModelClient({ provider, apiKey, model, extra, getProvidersData });

  // Reasoning depth → providerOptions. The dialect is resolved from the
  // same models.dev npm field that selected the SDK above, so the
  // parameter mapping can never drift from the client choice (#88).
  const providerData = getProvidersData
    ? (await getProvidersData())?.[resolveModelsDevId(provider)]
    : null;
  const providerOptions = buildProviderOptions({
    provider,
    npm: providerData?.npm,
    depth: reasoningDepth,
  });

  // maxRetries: 0 — disable AI SDK built-in retries; retry strategy is unified
  // by the content script's aiTranslateDynamically() with 10s backoff to avoid request storms.
  const result = streamText({ model: languageModel, messages, temperature, topP, ...(providerOptions ? { providerOptions } : {}), maxRetries: 0, abortSignal: signal });

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
      onChunk(chunkText);
    }
  }

  return { totalChunks, streamError };
}
