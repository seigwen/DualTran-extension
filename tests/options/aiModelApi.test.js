import { describe, expect, it, vi } from "vitest";
import { loadAiProviderModelOptions } from "../../src/options/aiModelApi.js";
import { createProviderRegistry } from "../../src/lib/ai/providerRegistry.js";

function createJsonResponse({ ok = true, status = 200, payload }) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

describe("aiModelApi", () => {
  it("filters OpenAI model payloads down to unique chat-capable options", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      payload: {
        data: [
          { id: "text-embedding-3-small" },
          { id: "gpt-4o-mini" },
          { id: "gpt-4o-mini" },
          { id: "o1-mini" },
        ],
      },
    }));

    const options = await loadAiProviderModelOptions({
      provider: "openai",
      apiKey: "openai-key",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      { headers: { Authorization: "Bearer openai-key" } }
    );
    expect(options).toEqual([
      { value: "gpt-4o-mini", text: "gpt-4o-mini" },
      { value: "o1-mini", text: "o1-mini" },
    ]);
  });

  it("loads OpenRouter models using display names when available", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      payload: {
        data: [
          { id: "openai/gpt-4o-mini", name: "OpenAI GPT-4o Mini" },
          { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
        ],
      },
    }));

    const options = await loadAiProviderModelOptions({
      provider: "openrouter",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", {});
    expect(options).toEqual([
      { value: "anthropic/claude-3.5-haiku", text: "Claude 3.5 Haiku" },
      { value: "openai/gpt-4o-mini", text: "OpenAI GPT-4o Mini" },
    ]);
  });

  it("uses a custom OpenRouter models endpoint when provided", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      payload: {
        data: [
          { id: "openai/gpt-4o-mini", name: "OpenAI GPT-4o Mini" },
        ],
      },
    }));

    const options = await loadAiProviderModelOptions({
      provider: "openrouter",
      endpoint: "http://127.0.0.1:8787/openrouter/v1/models",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8787/openrouter/v1/models", {});
    expect(options).toEqual([
      { value: "openai/gpt-4o-mini", text: "OpenAI GPT-4o Mini" },
    ]);
  });

  it("derives a generic OpenAI-compatible models endpoint from chat completions", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      payload: {
        data: [
          { id: "custom-model-a" },
          { id: "custom-model-b" },
        ],
      },
    }));
    const registry = createProviderRegistry([
      {
        id: "custom-openai-compatible",
        name: "Custom OpenAI Compatible",
        apiBase: "https://example.com/v1/chat/completions",
        modelListUrl: "https://example.com/v1/models",
        auth: {
          type: "bearer",
          prefix: "Bearer ",
        },
        responseFormat: "openai-chat",
        npm: "openai-compatible",
        modelListParser: {
          path: "data",
          valueKey: "id",
          labelKey: "id",
          filter: "^(?!.*(?:embedding|image|audio|whisper|moderation|realtime|search|tts)).*",
        },
      },
    ]);

    const options = await loadAiProviderModelOptions({
      provider: "custom-openai-compatible",
      apiKey: "custom-key",
      endpoint: "https://example.com/v1/chat/completions",
      fetcher,
      registry,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com/v1/models",
      { headers: { Authorization: "Bearer custom-key" } }
    );
    expect(options).toEqual([
      { value: "custom-model-a", text: "custom-model-a" },
      { value: "custom-model-b", text: "custom-model-b" },
    ]);
  });

  it("loads Azure OpenAI models and normalizes them in sorted order", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      payload: {
        data: [
          { id: "gpt-4o" },
          { id: "gpt-4o-mini" },
        ],
      },
    }));

    const options = await loadAiProviderModelOptions({
      provider: "azure-openai",
      apiKey: "azure-key",
      endpoint: "https://dualtran.openai.azure.com/",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://dualtran.openai.azure.com/openai/models?api-version=2023-12-01-preview",
      { headers: { "api-key": "azure-key" } }
    );
    expect(options).toEqual([
      { value: "gpt-4o", text: "gpt-4o" },
      { value: "gpt-4o-mini", text: "gpt-4o-mini" },
    ]);
  });

  it("prefers provider error messages for HTTP failures", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      ok: false,
      status: 401,
      payload: {
        error: {
          message: "Mock auth error",
        },
      },
    }));

    await expect(loadAiProviderModelOptions({
      provider: "deepseek",
      apiKey: "deepseek-key",
      fetcher,
    })).rejects.toThrow("Mock auth error");

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/models",
      { headers: { Authorization: "Bearer deepseek-key" } }
    );
  });

  it("falls back to translated HTTP errors when payload has no message", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      ok: false,
      status: 429,
      payload: {},
    }));
    const translate = vi.fn((_key, fallback) => `translated: ${fallback}`);

    await expect(loadAiProviderModelOptions({
      provider: "grok",
      apiKey: "grok-key",
      fetcher,
      translate,
    })).rejects.toThrow("translated: Unable to load xAI (Grok) models (HTTP 429)");
  });

  it("reports empty model lists as explicit errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      payload: {
        models: [],
      },
    }));

    await expect(loadAiProviderModelOptions({
      provider: "anthropic",
      apiKey: "anthropic-key",
      fetcher,
    })).rejects.toThrow("Anthropic models list is empty");

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      {
        headers: {
          "x-api-key": "anthropic-key",
          "anthropic-version": "2023-06-01",
        },
      }
    );
  });

  it("loads Google Gemini models using display names when available", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      payload: {
        models: [
          { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
          { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
        ],
      },
    }));

    const options = await loadAiProviderModelOptions({
      provider: "google-gemini",
      apiKey: "gemini-key",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=gemini-key",
      {}
    );
    expect(options).toEqual([
      { value: "models/gemini-2.0-flash", text: "Gemini 2.0 Flash" },
      { value: "models/gemini-2.5-flash", text: "Gemini 2.5 Flash" },
    ]);
  });
});

