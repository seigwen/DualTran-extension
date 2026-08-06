import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchSSE } from "../../src/lib/ai/sseClient.js";

function createStreamingResponse({ status = 200, chunks = [] }) {
  return {
    status,
    body: {
      getReader() {
        let index = 0;
        const encoded = chunks.map((c) => new TextEncoder().encode(c));
        return {
          async read() {
            if (index >= encoded.length) return { done: true, value: undefined };
            return { done: false, value: encoded[index++] };
          },
          releaseLock() {},
        };
      },
    },
    json: async () => {
      try { return JSON.parse(chunks.join("")); } catch { return {}; }
    },
  };
}

function createControlledBody(signal) {
  return {
    getReader() {
      return {
        read() {
          return new Promise((resolve, reject) => {
            const handler = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            signal.addEventListener("abort", handler, { once: true });
          });
        },
        releaseLock() {},
      };
    },
  };
}

function createMockPort({ throwOnStart = false } = {}) {
  let listener;
  return {
    onMessage: {
      addListener: vi.fn((fn) => { listener = fn; }),
      removeListener: vi.fn((fn) => { if (listener === fn) listener = undefined; }),
    },
    disconnect: vi.fn(),
    postMessage: vi.fn((msg) => {
      if (throwOnStart && msg?.type === "start") throw new Error("start failed");
    }),
    emit(msg) { listener?.(msg); },
  };
}

const BASE_OPTS = {
  provider: "openai", apiKey: "test-key", model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hello" }],
};

// Ensure no chrome leaks between tests
afterEach(() => { vi.unstubAllGlobals(); });

describe("sseClient", () => {
  describe("port path (chrome.runtime.connect)", () => {
    it("delivers status, data, and done through the port", async () => {
      const port = createMockPort();
      vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });

      const onStatusCode = vi.fn();
      const onMessage = vi.fn();
      const onFinished = vi.fn();

      await fetchSSE({ ...BASE_OPTS, onStatusCode, onMessage, onFinished });

      const startMsg = port.postMessage.mock.calls.find(([m]) => m?.type === "start")[0];
      expect(startMsg.provider).toBe("openai");

      port.emit({ id: "wrong", type: "status", status: 418 });
      port.emit({ id: startMsg.id, type: "status", status: 202 });
      port.emit({ id: startMsg.id, type: "data", chunk: "hello via port" });
      port.emit({ id: startMsg.id, type: "done" });

      expect(onStatusCode).toHaveBeenCalledWith(202);
      expect(onMessage).toHaveBeenCalledWith("hello via port");
      expect(onFinished).toHaveBeenCalledOnce();
      expect(port.disconnect).toHaveBeenCalledOnce();
    });

    it("reports port errors and cleans up", async () => {
      const port = createMockPort();
      vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });

      const onError = vi.fn();
      await fetchSSE({ ...BASE_OPTS, onError });
      const startMsg = port.postMessage.mock.calls.find(([m]) => m?.type === "start")[0];
      port.emit({ id: startMsg.id, type: "error", error: { message: "boom" } });

      expect(onError).toHaveBeenCalledWith({ id: startMsg.id, type: "error", error: { message: "boom" } });
      expect(port.onMessage.removeListener).toHaveBeenCalled();
      expect(port.disconnect).toHaveBeenCalled();
    });

    it("posts abort when external signal fires", async () => {
      const ctrl = new AbortController();
      const port = createMockPort();
      vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });

      await fetchSSE({ ...BASE_OPTS, signal: ctrl.signal });
      const startMsg = port.postMessage.mock.calls.find(([m]) => m?.type === "start")[0];
      ctrl.abort();
      expect(port.postMessage).toHaveBeenCalledWith({ type: "abort", id: startMsg.id });
    });

    it("pre-aborted signal sends abort before start", async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const port = createMockPort();
      vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });

      await fetchSSE({ ...BASE_OPTS, signal: ctrl.signal });
      const types = port.postMessage.mock.calls.map(([m]) => m?.type);
      expect(types).toEqual(["abort", "start"]);
    });
  });

  describe("fetch fallback (no chrome)", () => {
    it("streams text chunks from fetch", async () => {
      vi.stubGlobal('chrome', undefined);

      const messages = [];
      const onMessage = (text) => messages.push(text);
      const onFinished = vi.fn();

      // Minimal mock: return 200 with a body that streams one chunk then done
      const fetchFn = vi.fn(async (_url, _opts) => ({
        status: 200,
        ok: true,
        body: {
          getReader() {
            let i = 0;
            const chunks = [new TextEncoder().encode("hello world")];
            return {
              read: async () => {
                if (i < chunks.length) return { done: false, value: chunks[i++] };
                return { done: true, value: undefined };
              },
              releaseLock() {},
            };
          },
        },
        json: async () => ({}),
      }));

      await fetchSSE({ ...BASE_OPTS, fetchFn, onMessage, onFinished });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(messages).toEqual(["hello world"]);
      expect(onFinished).toHaveBeenCalledOnce();
    });

    it("uses provider-specific baseURL", async () => {
      vi.stubGlobal('chrome', undefined);

      const fetchFn = vi.fn().mockResolvedValue(createStreamingResponse({ chunks: ["ok"] }));
      await fetchSSE({ ...BASE_OPTS, provider: "deepseek", apiKey: "ds-key", fetchFn, onMessage: vi.fn() });

      expect(fetchFn.mock.calls[0][0]).toBe("https://api.deepseek.com/v1/chat/completions");
    });

    it("reports non-200 as onError", async () => {
      vi.stubGlobal('chrome', undefined);

      const onError = vi.fn();
      await fetchSSE({
        ...BASE_OPTS,
        fetchFn: vi.fn().mockResolvedValue({
          status: 401,
          json: async () => ({ error: { message: "unauthorized" } }),
        }),
        onError,
      });

      expect(onError).toHaveBeenCalledWith({ error: { message: "unauthorized" } });
    });

    it("reports generic HTTP error when JSON parse fails", async () => {
      vi.stubGlobal('chrome', undefined);

      const onError = vi.fn();
      await fetchSSE({
        ...BASE_OPTS,
        fetchFn: vi.fn().mockResolvedValue({
          status: 502,
          json: async () => { throw new Error("bad json"); },
        }),
        onError,
      });

      expect(onError).toHaveBeenCalledWith({ error: { message: "HTTP 502", status: 502 } });
    });

    it("times out on inactivity", async () => {
      vi.stubGlobal('chrome', undefined);

      const onError = vi.fn();
      // Mock real fetch behavior: reject when the abort signal fires.
      // The code's inactivity timer calls controller.abort() which triggers the signal.
      const fetchFn = vi.fn((_url, opts) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
          }, { once: true });
        });
      });

      await fetchSSE({ ...BASE_OPTS, fetchFn, onError, inactivityTimeoutMs: 10 });

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].error.type).toBe("timeout");
    });
  });
});
