import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getAimockRequestLog,
  resetAimockRequestLog,
  startAimockLlmServer,
  stopAimockLlmServer,
} from "../mock-server/mock-llm-server-aimock.js";

function collectOpenAiDeltaContent(sseText) {
  return sseText
    .split("\n\n")
    .filter((block) => block.startsWith("data: ") && !block.includes("[DONE]"))
    .map((block) => JSON.parse(block.slice(6)))
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

describe("aimock-backed mock LLM server", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = await startAimockLlmServer(0);
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await stopAimockLlmServer(server);
  });

  it("exposes a health endpoint", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.ok).toBe(true);
    await expect(resp.json()).resolves.toMatchObject({
      ok: true,
      service: "aimock-llm-server",
    });
  });

  it("serves OpenRouter-compatible SSE through the compatibility path", async () => {
    const resp = await fetch(`${baseUrl}/openrouter/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: "hello from openrouter" }],
      }),
    });

    expect(resp.ok).toBe(true);
    expect(resp.headers.get("content-type")).toContain("text/event-stream");
    const text = await resp.text();
    expect(collectOpenAiDeltaContent(text)).toBe("aimock mock result");
    expect(text).toContain("data: [DONE]");
  });

  it("serves Anthropic-compatible event streams through the compatibility path", async () => {
    const resp = await fetch(`${baseUrl}/anthropic/v1/messages`, {
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
        messages: [{ role: "user", content: "hello anthropic" }],
      }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("content_block_delta");
    expect(text).toContain("message_stop");
    expect(collectAnthropicDeltaContent(text)).toBe("aimock mock result");
  });

  it("serves Gemini-compatible JSON responses through the compatibility path", async () => {
    const resp = await fetch(`${baseUrl}/gemini/v1beta/models/gemini-2.0-flash:generateContent?key=test-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hello gemini" }] }],
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.candidates[0].content.parts[0].text).toBe("aimock mock result");
  });

  it("serves Azure deployment URLs by rewriting them to aimock's native Azure route", async () => {
    const resp = await fetch(`${baseUrl}/azure/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-02-01`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": "azure-key",
      },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: "user", content: "hello azure" }],
      }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(collectOpenAiDeltaContent(text)).toBe("aimock mock result");
    expect(text).toContain("[DONE]");
  });

  it("serves local model catalogs for options-page model loading", async () => {
    const [openrouterResp, anthropicResp, geminiResp] = await Promise.all([
      fetch(`${baseUrl}/openrouter/v1/models`),
      fetch(`${baseUrl}/anthropic/v1/models`),
      fetch(`${baseUrl}/gemini/v1beta/models?key=test-key`),
    ]);

    await expect(openrouterResp.json()).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ id: "openai/gpt-4o-mini" }),
      ]),
    });
    await expect(anthropicResp.json()).resolves.toMatchObject({
      models: expect.arrayContaining([
        expect.objectContaining({ name: "claude-3-5-haiku-latest" }),
      ]),
    });
    await expect(geminiResp.json()).resolves.toMatchObject({
      models: expect.arrayContaining([
        expect.objectContaining({ name: "models/gemini-2.0-flash" }),
      ]),
    });
  });

  it("supports cheap auth and rate-limit regression scenarios without touching aimock internals", async () => {
    const [authResp, rateLimitResp] = await Promise.all([
      fetch(`${baseUrl}/openai/v1/chat/completions?scenario=auth-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
      fetch(`${baseUrl}/openrouter/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-scenario": "rate-limit",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
    ]);

    expect(authResp.status).toBe(401);
    await expect(authResp.json()).resolves.toEqual({ error: { message: "Mock auth error", status: 401 } });

    expect(rateLimitResp.status).toBe(429);
    await expect(rateLimitResp.json()).resolves.toEqual({ error: { message: "Mock rate limit", status: 429 } });
  });

  it("preserves aimock tool-call support through the compatibility layer", async () => {
    const resp = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: "what is the weather?" }],
      }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("get_weather");
    expect(text).toContain("[DONE]");
  });

  it("records compatibility-layer rewrites so tests can assert which native aimock route handled a request", async () => {
    resetAimockRequestLog(server);

    await fetch(`${baseUrl}/gemini/v1beta/models/gemini-2.0-flash:generateContent?key=test-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "inspect the request log" }] }],
      }),
    });

    const entries = getAimockRequestLog(server);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      pathname: "/gemini/v1beta/models/gemini-2.0-flash:generateContent",
      rewrittenPath: "/v1beta/models/gemini-2.0-flash:generateContent",
      scenario: "success",
      method: "POST",
    });
  });
});
