"use strict";

/**
 * AI port client — sends
 * structured AI requests (provider + apiKey + model + messages) to the
 * background Service Worker and receives streamed plain-text chunks.
 *
 * The background Service Worker processes requests via Vercel AI SDK streamText().
 */

/**
 * @param {Object} options
 * @param {string} options.provider
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {Array<{role:string, content:string}>} options.messages
 * @param {number} [options.temperature=0.1]
 * @param {number} [options.topP=0.1]
 * @param {Function} options.onMessage - (chunk: string) => void
 * @param {Function} [options.onError]
 * @param {Function} [options.onFinished]
 * @param {Function} [options.onStatusCode]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.inactivityTimeoutMs=60000]
 * @param {Object} [options.extra] - provider-specific extra options (baseURL, resourceName, etc.)
 * @param {Function} [options.fetchFn] - injectable fetch (for testing)
 */
export async function fetchSSE(options) {
  const {
    provider, apiKey, model, messages,
    temperature = 0.1, topP = 0.1,
    onMessage, onError, onFinished, onStatusCode,
    signal: externalSignal,
    inactivityTimeoutMs = 60_000,
    extra = {},
    fetchFn,
  } = options;

  const controller = new AbortController();
  let externalAbortHandler;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalAbortHandler = () => controller.abort();
      externalSignal.addEventListener("abort", externalAbortHandler, { once: true });
    }
  }

  let timerId;
  let timedOut = false;
  const resetTimer = () => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, inactivityTimeoutMs);
  };

  const canUsePort = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.connect;

  if (canUsePort) {
    // Proxy through background Service Worker (Vercel AI SDK)
    const port = chrome.runtime.connect({ name: "ai-sse" });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const onPortMessage = (message) => {
      if (!message || message.id !== id) return;
      if (message.type === "status") {
        onStatusCode?.(message.status);
      } else if (message.type === "data") {
        resetTimer();
        onMessage?.(message.chunk); // Plain-text chunk, no SSE parsing needed!
      } else if (message.type === "done") {
        clearTimeout(timerId);
        onFinished?.();
        cleanup();
      } else if (message.type === "error") {
        clearTimeout(timerId);
        onError?.(message);
        cleanup();
      } else if (message.type === "aborted") {
        clearTimeout(timerId);
        cleanup();
      }
    };

    const cleanup = () => {
      try { port.onMessage.removeListener(onPortMessage); } catch {}
      try { port.disconnect(); } catch {}
      if (externalSignal && externalAbortHandler) {
        try { externalSignal.removeEventListener("abort", externalAbortHandler); } catch {}
      }
    };

    let portAborted = false;
    const abortViaPort = () => {
      if (portAborted) return;
      portAborted = true;
      try { port.postMessage({ type: "abort", id }); } catch {}
    };
    if (externalSignal) {
      if (externalSignal.aborted) abortViaPort();
      else externalSignal.addEventListener("abort", abortViaPort, { once: true });
    }

    try {
      resetTimer();
      port.onMessage.addListener(onPortMessage);

      // Send structured request (no longer sending raw HTTP url/headers/body)
      port.postMessage({
        type: "start",
        id,
        provider,
        apiKey,
        model,
        messages,
        temperature,
        topP,
        inactivityTimeoutMs,
        extra,
      });
      return;
    } catch (err) {
      try { port.onMessage.removeListener(onPortMessage); } catch {}
      try { port.disconnect(); } catch {}
    }
  }

  // Fallback: 非 Chrome 环境，直接 fetch（使用 OpenAI 兼容端点）
  try {
    resetTimer();
    // Get apiBase from registry as fallback
    let apiBase = extra.baseURL || "";
    if (!apiBase) {
      try {
        const { createProviderRegistry, BUILT_IN_PROVIDERS } = await import("./providerRegistry.js");
        const reg = createProviderRegistry(BUILT_IN_PROVIDERS);
        apiBase = reg.getProvider(provider)?.apiBase || "";
      } catch (_) {}
    }
    if (!apiBase && typeof chrome !== "undefined" && chrome.storage?.local) {
      try {
        const cache = await chrome.storage.local.get("modelsdev:providers");
        apiBase = cache?.["modelsdev:providers"]?.data?.[provider]?.api || "";
      } catch (_) {}
    }
    // Extract base URL (strip /chat/completions suffix if present)
    let baseURL = apiBase ? apiBase.replace(/\/chat\/completions\/?$/, "") : "https://api.openai.com/v1";
    const url = `${baseURL}/chat/completions`;

    const fetcher = fetchFn || fetch;
    const resp = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature, top_p: topP, stream: true }),
      signal: controller.signal,
    });

    onStatusCode?.(resp.status);

    if (!resp.ok) {
      clearTimeout(timerId);
      try {
        const err = await resp.json();
        onError?.(err);
      } catch (e) {
        onError?.({ error: { message: `HTTP ${resp.status}`, status: resp.status } });
      }
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timerId);
          onFinished?.();
          break;
        }
        resetTimer();
        const text = decoder.decode(value, { stream: true });
        onMessage?.(text);
      }
    } finally {
      reader.releaseLock();
      clearTimeout(timerId);
    }
  } catch (err) {
    clearTimeout(timerId);
    if (timedOut) {
      onError?.({ error: { message: `Request timed out: no response for ${inactivityTimeoutMs} ms`, type: "timeout" } });
    } else if (!(err && (err.name === "AbortError" || err.name === "CanceledError"))) {
      onError?.(err);
    }
  } finally {
    if (externalSignal && externalAbortHandler) {
      try { externalSignal.removeEventListener("abort", externalAbortHandler); } catch {}
    }
  }
}
