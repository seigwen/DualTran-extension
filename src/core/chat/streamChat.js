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
 * Turn an AI SDK / fetch error into a SAFE user-facing error object.
 *
 * The page must never render upstream bodies or the request URL: a provider error body
 * can carry vendor-internal fields, and the URL exposes the user's proxy/endpoint
 * topology. `message` is therefore a short hint selected by class/status, while
 * `detail` keeps the raw material for the console (diagnostics stay available, just not
 * on screen). `code` is what the UI maps to a localized string.
 *
 * @returns {{message: string, code: string, statusCode: string, detail: string}}
 */
export function formatAiError(err) {
  const apiMsg = err?.data?.error?.message || err?.responseBody?.error?.message || "";
  const sdkMsg = String(err?.message || "");
  const httpStatus = Number(err?.statusCode || err?.status || 0) || 0;

  // The AI SDK wraps parse failures as "Failed to process successful response" and keeps the
  // real reason (bad JSON, wrong shape) in `cause`, so keep it in the detail for the console.
  const causeMsg = String(err?.cause?.message || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const rawBody = err?.responseBody;
  /** @type {string} */
  let bodySnippet = "";
  if (typeof rawBody === "string") {
    bodySnippet = rawBody.replace(/\s+/g, " ").trim().slice(0, 160);
  } else if (rawBody && typeof rawBody === "object") {
    try {
      bodySnippet = JSON.stringify(rawBody).slice(0, 160);
    } catch {
      bodySnippet = "";
    }
  }
  const looksLikeHtml = /^\s*</.test(bodySnippet);
  const requestUrl = typeof err?.url === "string" ? err.url : "";

  // Console-only diagnostics. Never assembled into `message`.
  const detail = [apiMsg, causeMsg, bodySnippet, requestUrl].filter(Boolean).join(" | ").slice(0, 400);

  // A transport failure has no status code: fetch throws TypeError("Failed to fetch"), and
  // Chromium reports net::ERR_* in the message. Both are localized by the caller (code
  // "network") instead of surfacing the browser's English exception.
  const isTransport =
    String(err?.name || "") === "TypeError" ||
    /Failed to fetch|NetworkError|net::ERR_|ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(sdkMsg);
  if (isTransport && !httpStatus) {
    return {
      message: "Cannot reach the AI service — check the API endpoint and network",
      code: "network",
      statusCode: "",
      detail,
    };
  }

  if (httpStatus >= 300) {
    const hints = {
      401: "Invalid or missing API key",
      403: "Access denied",
      429: "Rate limit exceeded",
      500: "Server error",
      503: "Service unavailable",
    };
    const hint = hints[httpStatus] || "The AI provider rejected the request";
    return {
      message: `${hint} (HTTP ${httpStatus})`,
      code: `http_${httpStatus}`,
      statusCode: String(httpStatus),
      detail,
    };
  }

  if (looksLikeHtml) {
    return {
      message: "The endpoint returned an HTML page instead of JSON — check the API base URL",
      code: "html",
      statusCode: "",
      detail,
    };
  }

  if (sdkMsg) {
    return {
      message: "The AI response could not be read — check the API base URL",
      code: "parse",
      statusCode: httpStatus ? String(httpStatus) : "",
      detail,
    };
  }

  return { message: "Unknown AI error", code: "unknown", statusCode: "", detail };
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
 * @param {Function} [opts.fetch] — host transport (renderers need a CORS-free fetch);
 *   defaults to the SDK's global fetch when omitted
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
  fetch: fetchImpl = undefined,
  signal = undefined,
  onChunk = () => {},
}) {
  const getProvidersData = store ? () => store.getProvidersData() : null;

  const languageModel = await createModelClient({ provider, apiKey, model, extra, getProvidersData, fetch: fetchImpl });

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
