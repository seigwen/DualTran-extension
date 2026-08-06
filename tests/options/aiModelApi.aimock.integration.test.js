import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAiProviderModelOptions } from "../../src/options/aiModelApi.js";
import { startAimockLlmServer, stopAimockLlmServer } from "../mock-server/mock-llm-server-aimock.js";

describe("aiModelApi aimock integration", () => {
  let server;
  let baseUrl;

  function rewriteToLocal(url, options) {
    const rewrittenUrl = String(url)
      .replace("https://api.anthropic.com", `${baseUrl}/anthropic`)
      .replace("https://generativelanguage.googleapis.com", `${baseUrl}/gemini`);
    return fetch(rewrittenUrl, options);
  }

  beforeAll(async () => {
    server = await startAimockLlmServer(0);
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await stopAimockLlmServer(server);
  });

  it("loads OpenRouter model options from a real local compatibility endpoint", async () => {
    const options = await loadAiProviderModelOptions({
      provider: "openrouter",
      endpoint: `${baseUrl}/openrouter/v1/chat/completions`,
    });

    expect(options).toEqual([
      { value: "anthropic/claude-3.5-haiku", text: "Claude 3.5 Haiku" },
      { value: "openai/gpt-4o-mini", text: "OpenAI GPT-4o Mini" },
    ]);
  });

  it("loads Azure OpenAI model options from a real local compatibility endpoint", async () => {
    const options = await loadAiProviderModelOptions({
      provider: "azure-openai",
      apiKey: "azure-key",
      endpoint: `${baseUrl}/azure`,
    });

    expect(options).toEqual([
      { value: "gpt-4o", text: "gpt-4o" },
      { value: "gpt-4o-mini", text: "gpt-4o-mini" },
    ]);
  });

  it("loads Anthropic and Gemini model options from real local compatibility endpoints", async () => {
    const [anthropicOptions, geminiOptions] = await Promise.all([
      loadAiProviderModelOptions({
        provider: "anthropic",
        apiKey: "anthropic-key",
        fetcher: rewriteToLocal,
      }),
      loadAiProviderModelOptions({
        provider: "google-gemini",
        apiKey: "gemini-key",
        fetcher: rewriteToLocal,
      }),
    ]);

    expect(anthropicOptions).toEqual([
      { value: "claude-3-5-haiku-latest", text: "claude-3-5-haiku-latest" },
      { value: "claude-3-7-sonnet-20250219", text: "claude-3-7-sonnet-20250219" },
    ]);
    expect(geminiOptions).toEqual([
      { value: "models/gemini-1.5-flash", text: "Gemini 1.5 Flash" },
      { value: "models/gemini-2.0-flash", text: "Gemini 2.0 Flash" },
    ]);
  });

  it("surfaces real HTTP auth errors from the local compatibility endpoint", async () => {
    await expect(loadAiProviderModelOptions({
      provider: "openrouter",
      endpoint: `${baseUrl}/openrouter/v1/models?scenario=auth-error`,
    })).rejects.toThrow("Mock auth error");
  });
});
