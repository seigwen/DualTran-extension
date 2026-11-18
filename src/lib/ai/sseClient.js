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
 * @param {string} [options.reasoningDepth=""] - reasoning effort ("", "low", "high" …); "" sends no parameter
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
    reasoningDepth = "",
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
  // What "no bytes for inactivityTimeoutMs" means depends on the transport: the direct
  // fetch path aborts its controller; the port path has to tell the background AND report
  // the timeout itself (the background may never answer an aborted request).
  let inactivityHandler = () => {
    timedOut = true;
    controller.abort();
  };
  const resetTimer = () => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      inactivityHandler();
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
        finish(onFinished);
      } else if (message.type === "error") {
        finish(onError, message);
      } else if (message.type === "aborted") {
        finish();
      }
    };

    let settled = false;
    const finish = (callback, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      try {
        callback?.(payload);
      } catch (_) {
      }
      cleanup();
    };

    const cleanup = () => {
      try { port.onMessage.removeListener(onPortMessage); } catch {}
      try { port.onDisconnect?.removeListener(onPortDisconnect); } catch {}
      try { port.disconnect(); } catch {}
      if (externalSignal && externalAbortHandler) {
        try { externalSignal.removeEventListener("abort", externalAbortHandler); } catch {}
      }
    };

    // The Service Worker is recycled aggressively. Without this listener the port closed
    // silently and the request stayed pending forever: no result, no error, a spinner that
    // never stops. `settled` keeps the normal cleanup path from reporting a false failure.
    const onPortDisconnect = () => {
      finish(onError, { error: { type: "network", message: "connection to AI service closed" } });
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

    // Inactivity in port mode used to abort only the local controller, which the background
    // never hears about — so the page hung instead of showing a timeout. Report it here.
    inactivityHandler = () => {
      if (settled) return;
      timedOut = true;
      abortViaPort();
      finish(onError, { error: { type: "timeout", message: "server response timeout" } });
    };

    try {
      resetTimer();
      port.onMessage.addListener(onPortMessage);
      port.onDisconnect?.addListener(onPortDisconnect);

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
        reasoningDepth,
        inactivityTimeoutMs,
        extra,
      });
      return;
    } catch (err) {
      try { port.onMessage.removeListener(onPortMessage); } catch {}
      try { port.disconnect(); } catch {}
    }
  }

  // Fallback: non-Chrome environment, direct fetch (OpenAI-compatible endpoint)
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
        const { resolveModelsDevId } = await import("./providerRegistry.js");
        const cache = await chrome.storage.local.get("modelsdev:providers");
        // models.dev keys differ from internal IDs (google-gemini → google, #88)
        apiBase = cache?.["modelsdev:providers"]?.data?.[resolveModelsDevId(provider)]?.api || "";
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
