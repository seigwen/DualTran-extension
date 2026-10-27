/**
 * streamChat — injected fetch (host transport seam).
 *
 * The browser extension runs inside a Service Worker where global fetch is
 * enough, but host apps living in a renderer (Obsidian) have providers that
 * reject the `app://` origin with a CORS error ("Failed to fetch"). The host
 * must be able to hand its own CORS-free transport to the core, exactly like
 * `fetchImpl` already works for the Google path.
 *
 * These tests drive the real AI SDK against a fake Response, so they prove the
 * injected fetch is what actually reaches the network layer.
 */
import { describe, expect, it, vi } from "vitest";
import { streamChat } from "../../src/core/chat/streamChat.js";

const SSE = [
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
  "",
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}]}',
  "",
  "data: [DONE]",
  "",
].join("\n");

function sseResponse() {
  return new Response(SSE, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("streamChat — injected fetch", () => {
  it("uses the injected fetch for a dedicated SDK provider and streams the chunks back", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return sseResponse();
    });

    const chunks = [];
    const { totalChunks, streamError } = await streamChat({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      extra: { baseURL: "http://fake.local/v1" },
      fetch: fetchImpl,
      onChunk: (text) => chunks.push(text),
    });

    expect(streamError).toBeNull();
    expect(totalChunks).toBe(2);
    expect(chunks.join("")).toBe("Hello world");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toContain("/chat/completions");
    expect(calls[0].url.startsWith("http://fake.local/v1")).toBe(true);
  });

  it("uses the injected fetch for the OpenAI-compatible fallback too", async () => {
    const fetchImpl = vi.fn(async () => sseResponse());
    const chunks = [];
    const { totalChunks, streamError } = await streamChat({
      provider: "some-catalogue-only-provider",
      apiKey: "test-key",
      model: "model-x",
      messages: [{ role: "user", content: "hi" }],
      extra: { baseURL: "http://fakeproxy.local/v1" },
      fetch: fetchImpl,
      onChunk: (text) => chunks.push(text),
    });

    expect(streamError).toBeNull();
    expect(totalChunks).toBe(2);
    expect(chunks.join("")).toBe("Hello world");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces an API error from the injected fetch instead of a transport failure", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
    const { totalChunks, streamError } = await streamChat({
      provider: "openai",
      apiKey: "bad-key",
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      extra: { baseURL: "http://fake.local/v1" },
      fetch: fetchImpl,
    });
    expect(totalChunks).toBe(0);
    expect(streamError).not.toBeNull();
    expect(String(streamError?.message || streamError)).toContain("Incorrect API key");
  });
});
