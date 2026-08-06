import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getAimockInstance,
  startAimockLlmServer,
  stopAimockLlmServer,
} from "../mock-server/mock-llm-server-aimock.js";

// ---------- SSE helpers ----------

function parseSseDataLines(sseText) {
  return sseText
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice(6).trim());
}

function collectOpenAiDeltaContent(sseText) {
  return parseSseDataLines(sseText)
    .filter((data) => data !== "[DONE]")
    .map((data) => {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((payload) => payload.choices?.[0]?.delta?.content || "")
    .join("");
}

function collectAnthropicDeltaContent(sseText) {
  return sseText
    .split("\n\n")
    .filter((block) => block.includes("content_block_delta"))
    .map((block) => {
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      return dataLine ? JSON.parse(dataLine.slice(6)) : null;
    })
    .filter(Boolean)
    .map((payload) => payload?.delta?.text || "")
    .join("");
}

// ---------- Request helpers ----------

function postOpenAi(baseUrl, userMessage) {
  return fetch(`${baseUrl}/openai/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      stream: true,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
}

function postAnthropic(baseUrl, userMessage, scenario) {
  const url = scenario
    ? `${baseUrl}/anthropic/v1/messages?scenario=${scenario}`
    : `${baseUrl}/anthropic/v1/messages`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "anthropic-key",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 512,
      stream: true,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
}

// ---------- Tests: aimock native capabilities ----------

describe("aimock native chaos & streaming capabilities", () => {
  let server;
  let baseUrl;
  let llm;

  beforeAll(async () => {
    server = await startAimockLlmServer(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    llm = getAimockInstance(server);
  });

  afterAll(async () => {
    await stopAimockLlmServer(server);
  });

  afterEach(() => {
    llm.clearChaos();
  });

  describe("streaming physics", () => {
    it("delivers complete content through a streamingProfile fixture with reduced tps", async () => {
      const resp = await postOpenAi(baseUrl, "slow stream test");
      expect(resp.ok).toBe(true);
      const text = await resp.text();
      const content = collectOpenAiDeltaContent(text);
      expect(content).toBe("this is a slow streamed response from aimock");
    });

    it("delivers complete content through a fixture with added latency", async () => {
      const start = Date.now();
      const resp = await postOpenAi(baseUrl, "latency test");
      expect(resp.ok).toBe(true);
      const text = await resp.text();
      const elapsed = Date.now() - start;
      const content = collectOpenAiDeltaContent(text);
      expect(content).toBe("response with added latency");
      // fixture latency: 200ms — use generous lower bound to avoid CI flakiness
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });
  });

  describe("chaos injection", () => {
    it("corrupts SSE chunks when global malformedRate is 1.0", async () => {
      llm.setChaos({ malformedRate: 1.0 });
      const resp = await postOpenAi(baseUrl, "hello");
      const text = await resp.text();
      // With 100% malformed rate, the clean OpenAI delta content should not be recoverable
      const content = collectOpenAiDeltaContent(text);
      expect(content).not.toBe("aimock mock result");
    });

    it("corrupts SSE chunks on a per-fixture chaos basis", async () => {
      // The "chaos malformed test" fixture has chaos: { malformedRate: 1.0 }
      const resp = await postOpenAi(baseUrl, "chaos malformed test");
      const text = await resp.text();
      const content = collectOpenAiDeltaContent(text);
      expect(content).not.toBe("this response has per-fixture chaos");
    });

    it("drops requests when global dropRate is 1.0, causing a proxy error", async () => {
      llm.setChaos({ dropRate: 1.0 });
      let failed = false;
      try {
        const resp = await postOpenAi(baseUrl, "hello");
        // aimock silently drops all requests — the proxy should return a non-200 error
        failed = !resp.ok;
      } catch {
        // Connection-level failure is also acceptable
        failed = true;
      }
      expect(failed).toBe(true);
    });
  });

  describe("stream truncation", () => {
    it("delivers truncated content when truncateAfterChunks limits output", async () => {
      const fullText = "this long response will be truncated after just one chunk";
      let content = "";
      try {
        const resp = await postOpenAi(baseUrl, "truncated stream test");
        const text = await resp.text();
        content = collectOpenAiDeltaContent(text);
      } catch {
        // Stream truncation may cause connection errors at the proxy level
      }
      // Whether the proxy errors or delivers partial data, the full content should not arrive
      expect(content).not.toBe(fullText);
    });

    it("disconnects the stream before full content is delivered when disconnectAfterMs is configured", async () => {
      const fullText = "this response will disconnect abruptly mid-stream because the server cuts the connection after a short delay";
      let content = "";
      try {
        const resp = await postOpenAi(baseUrl, "disconnect stream test");
        const text = await resp.text();
        content = collectOpenAiDeltaContent(text);
      } catch {
        // Connection drop is expected
      }
      // With tps: 5 and disconnectAfterMs: 100, only a small fraction should arrive
      expect(content.length).toBeLessThan(fullText.length);
    });
  });

  describe("error injection", () => {
    it("returns an HTTP error via nextRequestError() one-shot API", async () => {
      llm.nextRequestError(500, { message: "Injected server error", type: "server_error" });
      const resp = await postOpenAi(baseUrl, "hello");
      expect(resp.status).toBe(500);
      const data = await resp.json();
      expect(data.error.message).toBe("Injected server error");
    });

    it("resumes normal operation after the one-shot error is consumed", async () => {
      llm.nextRequestError(503, { message: "Temporary outage" });
      // Consume the one-shot error
      await postOpenAi(baseUrl, "hello");
      // Next request should succeed normally
      const resp = await postOpenAi(baseUrl, "hello");
      expect(resp.ok).toBe(true);
      const text = await resp.text();
      expect(collectOpenAiDeltaContent(text)).toBe("aimock mock result");
    });
  });
});

// ---------- Tests: compatibility-layer scenarios (migrated from legacy mock) ----------

describe("compatibility-layer error scenarios (migrated from legacy mock)", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = await startAimockLlmServer(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await stopAimockLlmServer(server);
  });

  it("serves slow-stream SSE on OpenAI-compatible routes with delayed chunks", async () => {
    const start = Date.now();
    const resp = await fetch(`${baseUrl}/openai/v1/chat/completions?scenario=slow-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    const text = await resp.text();
    const elapsed = Date.now() - start;

    expect(resp.ok).toBe(true);
    expect(text).toContain("[DONE]");
    expect(collectOpenAiDeltaContent(text)).toContain("🌐[aimock]");
    // At least 2 chunks with 100ms delay each
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it("serves slow-stream SSE on Anthropic routes with delayed chunks", async () => {
    const resp = await postAnthropic(baseUrl, "hello", "slow-stream");
    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("content_block_delta");
    expect(text).toContain('"type":"message_stop"');
    expect(collectAnthropicDeltaContent(text)).toContain("🌐[aimock]");
  });

  it("serves Anthropic SSE error events via event-error scenario", async () => {
    const resp = await postAnthropic(baseUrl, "hello", "event-error");
    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("Anthropic mock stream error");
    expect(text).toContain("rate_limit_error");
  });

  it("serves Anthropic fallback error events with non-object error payload", async () => {
    const resp = await postAnthropic(baseUrl, "hello", "event-error-fallback");
    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain('"error":"quota exceeded"');
  });

  it("serves malformed Anthropic SSE chunks for parser hardening", async () => {
    const resp = await postAnthropic(baseUrl, "hello", "malformed-event");
    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("{bad json");
    expect(text).toContain('"type":"message_stop"');
  });

  it("serves non-JSON Gemini error bodies for HTTP fallback testing", async () => {
    const resp = await fetch(
      `${baseUrl}/gemini/v1beta/models/gemini-2.0-flash:generateContent?key=test-key&scenario=non-json-error`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] }),
      }
    );
    expect(resp.status).toBe(503);
    const text = await resp.text();
    expect(text).toBe("Gemini upstream exploded");
  });
});
