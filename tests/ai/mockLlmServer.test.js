import http from "node:http";
import https from "node:https";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAimockLlmServer, stopAimockLlmServer } from "../mock-server/mock-llm-server-aimock.js";

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(target, {
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
        });
      });
    });

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

describe("aimock LLM server", () => {
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
    const resp = await request(`${baseUrl}/health`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
  });

  it("serves OpenAI-compatible SSE responses with auto tagged-echo", async () => {
    const resp = await request(`${baseUrl}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: '<译泽 id="1">openai test</译泽>' }],
      }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("🌐[aimock]");
    expect(text).toContain("[DONE]");
  });

  it("serves DeepSeek-compatible SSE responses with auto tagged-echo", async () => {
    const resp = await request(`${baseUrl}/deepseek/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        stream: true,
        messages: [{ role: "user", content: '<译泽 id="2">deepseek test</译泽>' }],
      }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("🌐[aimock]");
    expect(text).toContain("[DONE]");
  });

  it("serves Grok-compatible SSE responses with auto tagged-echo", async () => {
    const resp = await request(`${baseUrl}/grok/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-2-latest",
        stream: true,
        messages: [{ role: "user", content: '<译泽 id="3">grok test</译泽>' }],
      }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("🌐[aimock]");
    expect(text).toContain("[DONE]");
  });

  it("serves Anthropic-style event streams with auto tagged-echo", async () => {
    const resp = await request(`${baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-haiku",
        stream: true,
        messages: [{ role: "user", content: '<译泽 id="4">anthropic test</译泽>' }],
      }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("content_block_delta");
    expect(text).toContain("🌐[aimock]");
  });

  it("can serve Anthropic streaming error events", async () => {
    const resp = await request(`${baseUrl}/anthropic/v1/messages?scenario=event-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-3-haiku", stream: true }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("Anthropic mock stream error");
  });

  it("can serve Anthropic fallback error events with non-object payloads", async () => {
    const resp = await request(`${baseUrl}/anthropic/v1/messages?scenario=event-error-fallback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-3-haiku", stream: true }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain('"error":"quota exceeded"');
  });

  it("can serve malformed Anthropic stream events for parser hardening", async () => {
    const resp = await request(`${baseUrl}/anthropic/v1/messages?scenario=malformed-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-3-haiku", stream: true }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("{bad json");
    expect(text).toContain('"type":"message_stop"');
  });

  it("can serve slow Anthropic stream events for transport timeout and abort testing", async () => {
    const resp = await request(`${baseUrl}/anthropic/v1/messages?scenario=slow-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-3-haiku", stream: true }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("content_block_delta");
    expect(text).toContain("🌐[aimock]");
    expect(text).toContain('"type":"message_stop"');
  });

  it("serves Gemini JSON responses with auto tagged-echo", async () => {
    const resp = await request(`${baseUrl}/gemini/v1beta/models/gemini-2.0-flash:generateContent?key=test-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: '<译泽 id="5">gemini test</译泽>' }] }],
      }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.candidates[0].content.parts[0].text).toContain("🌐[aimock]");
  });

  it("can serve empty Gemini JSON responses", async () => {
    const resp = await request(`${baseUrl}/gemini/v1beta/models/gemini-2.0-flash:generateContent?key=test-key&scenario=empty`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data).toEqual({ candidates: [] });
  });

  it("can serve non-JSON Gemini error bodies for HTTP fallback testing", async () => {
    const resp = await request(`${baseUrl}/gemini/v1beta/models/gemini-2.0-flash:generateContent?key=test-key&scenario=non-json-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    expect(resp.status).toBe(503);
    const text = await resp.text();
    expect(text).toBe("Gemini upstream exploded");
  });

  it("can simulate auth errors cheaply", async () => {
    const resp = await request(`${baseUrl}/openai/v1/chat/completions?scenario=auth-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(resp.status).toBe(401);
    const data = await resp.json();
    expect(data.error.message).toBe("Mock auth error");
  });

  it("can simulate rate limits through request headers", async () => {
    const resp = await request(`${baseUrl}/openrouter/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-scenario": "rate-limit",
      },
      body: JSON.stringify({ model: "openai/gpt-4o-mini", stream: true }),
    });

    expect(resp.status).toBe(429);
    const data = await resp.json();
    expect(data.error.message).toBe("Mock rate limit");
  });

  it("serves Azure OpenAI compatible SSE responses with auto tagged-echo", async () => {
    const resp = await request(`${baseUrl}/azure/openai/deployments/gpt-4o-prod/chat/completions?api-version=2024-02-01`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": "azure-key" },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: "user", content: '<译泽 id="6">azure test</译泽>' }],
      }),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toContain("🌐[aimock]");
    expect(text).toContain("[DONE]");
  });

  it("returns not found for unknown mock routes", async () => {
    const resp = await request(`${baseUrl}/unknown/provider`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(resp.status).toBe(404);
    const data = await resp.json();
    expect(data.error.message).toContain("Unknown aimock route");
  });
});
