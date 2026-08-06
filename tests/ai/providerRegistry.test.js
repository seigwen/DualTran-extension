import { describe, expect, it } from "vitest";
import { validateProviderDefinition } from "../../src/lib/ai/providerTypes.js";
import { createProviderRegistry, mergeRegistries } from "../../src/lib/ai/providerRegistry.js";

describe("providerTypes", () => {
  it("accepts a valid OpenAI-compatible provider definition", () => {
    const def = {
      id: "test-provider",
      name: "Test Provider",
      website: "https://test.example",
      apiKeyUrl: "https://test.example/keys",
      shortDesc: "A test provider",
      apiBase: "https://api.test.example/v1/chat/completions",
      modelListUrl: "https://api.test.example/v1/models",
      auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
      responseFormat: "openai-sse",
      supportsStreaming: true,
      modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
      source: "built-in",
      category: "global",
      tags: ["test"],
    };
    const errors = validateProviderDefinition(def);
    expect(errors).toEqual([]);
  });

  it("rejects a provider missing required fields", () => {
    const errors = validateProviderDefinition({ id: "bare" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("name"))).toBe(true);
    expect(errors.some((e) => e.includes("apiBase"))).toBe(true);
  });

  it("rejects invalid responseFormat", () => {
    const errors = validateProviderDefinition({
      id: "bad", name: "Bad", website: "x", apiKeyUrl: "x",
      apiBase: "x", auth: { type: "bearer", header: "Authorization" },
      responseFormat: "xml-soap", supportsStreaming: true,
      source: "built-in", category: "global",
    });
    expect(errors.some((e) => e.includes("responseFormat"))).toBe(true);
  });

  it("rejects invalid auth type", () => {
    const errors = validateProviderDefinition({
      id: "bad", name: "Bad", website: "x", apiKeyUrl: "x",
      apiBase: "x", auth: { type: "basic-auth" },
      responseFormat: "openai-sse", supportsStreaming: true,
      source: "built-in", category: "global",
    });
    expect(errors.some((e) => e.includes("auth.type"))).toBe(true);
  });

  it("accepts a provider without modelListUrl", () => {
    const def = {
      id: "no-models", name: "No Models", website: "https://x.example",
      apiKeyUrl: "https://x.example/keys", apiBase: "https://api.x.example/v1/chat/completions",
      modelListUrl: null,
      auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
      responseFormat: "openai-sse", supportsStreaming: true,
      source: "built-in", category: "global",
    };
    const errors = validateProviderDefinition(def);
    expect(errors).toEqual([]);
  });

  it("accepts a user-sourced provider with minimal fields", () => {
    const def = {
      id: "custom-1",
      name: "My Custom",
      website: "",
      apiKeyUrl: "",
      apiBase: "https://myapi.example/v1/chat/completions",
      modelListUrl: null,
      auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
      responseFormat: "openai-sse",
      supportsStreaming: true,
      source: "user",
      category: "global",
    };
    const errors = validateProviderDefinition(def);
    expect(errors).toEqual([]);
  });
});

describe("providerRegistry", () => {
  const builtIn = [
    {
      id: "openai", name: "OpenAI", website: "https://openai.com",
      apiKeyUrl: "https://platform.openai.com/api-keys",
      shortDesc: "GPT, O-series models",
      apiBase: "https://api.openai.com/v1/chat/completions",
      modelListUrl: "https://api.openai.com/v1/models",
      auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
      responseFormat: "openai-sse", supportsStreaming: true,
      modelListParser: { path: "data", valueKey: "id", labelKey: "id", filter: "/^(gpt|chatgpt|o\\d|omni)/i" },
      source: "built-in", category: "global", tags: ["gpt"],
    },
    {
      id: "mistral", name: "Mistral AI", website: "https://mistral.ai",
      apiKeyUrl: "https://console.mistral.ai/api-keys",
      shortDesc: "Mistral Large, Codestral",
      apiBase: "https://api.mistral.ai/v1/chat/completions",
      modelListUrl: "https://api.mistral.ai/v1/models",
      auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
      responseFormat: "openai-sse", supportsStreaming: true,
      modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
      source: "built-in", category: "global", tags: ["french", "opensource"],
    },
  ];

  it("creates a registry from built-in providers", () => {
    const registry = createProviderRegistry(builtIn);
    expect(registry.getProvider("openai").name).toBe("OpenAI");
    expect(registry.getProvider("mistral").name).toBe("Mistral AI");
    expect(registry.getProvider("nonexistent")).toBeUndefined();
  });

  it("lists all providers", () => {
    const registry = createProviderRegistry(builtIn);
    expect(registry.listProviders()).toHaveLength(2);
  });

  it("filters providers by search text", () => {
    const registry = createProviderRegistry(builtIn);
    const results = registry.listProviders({ search: "mistral" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("mistral");
  });

  it("filters by category", () => {
    const registry = createProviderRegistry(builtIn);
    const results = registry.listProviders({ category: "global" });
    expect(results).toHaveLength(2);
    const empty = registry.listProviders({ category: "china" });
    expect(empty).toHaveLength(0);
  });

  it("searches across name, shortDesc, and tags", () => {
    const registry = createProviderRegistry(builtIn);
    expect(registry.listProviders({ search: "french" })).toHaveLength(1);
    expect(registry.listProviders({ search: "gpt" })).toHaveLength(1);
  });

  describe("mergeRegistries", () => {
    it("adds new providers from remote", () => {
      const remote = [{
        id: "groq", name: "Groq", website: "https://groq.com",
        apiKeyUrl: "https://console.groq.com/keys", shortDesc: "Fast inference",
        apiBase: "https://api.groq.com/openai/v1/chat/completions",
        modelListUrl: "https://api.groq.com/openai/v1/models",
        auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
        responseFormat: "openai-sse", supportsStreaming: true,
        modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
        source: "remote", category: "global", tags: ["fast"],
      }];
      const merged = mergeRegistries(builtIn, remote, []);
      expect(merged).toHaveLength(3);
      expect(merged.find((p) => p.id === "groq")).toBeTruthy();
    });

    it("remote updates fields on existing built-in but preserves id and source", () => {
      const remote = [{
        id: "openai", name: "OpenAI Updated", website: "https://new.openai.com",
        apiKeyUrl: "https://new.openai.com/keys", apiBase: "https://new.api.openai.com/v1/chat/completions",
        modelListUrl: "https://new.api.openai.com/v1/models",
        auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
        responseFormat: "openai-sse", supportsStreaming: true,
        modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
        source: "remote", category: "global",
      }];
      const merged = mergeRegistries(builtIn, remote, []);
      const openai = merged.find((p) => p.id === "openai");
      expect(openai.apiBase).toBe("https://new.api.openai.com/v1/chat/completions");
      expect(openai.source).toBe("built-in");
      expect(openai.id).toBe("openai");
    });

    it("user overrides override both built-in and remote", () => {
      const remote = [{
        id: "mistral", name: "Mistral Remote", website: "https://mistral.ai",
        apiKeyUrl: "https://console.mistral.ai/api-keys", apiBase: "https://remote.mistral.ai/v1",
        modelListUrl: null,
        auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
        responseFormat: "openai-sse", supportsStreaming: true,
        source: "remote", category: "global",
      }];
      const user = [{
        id: "mistral", name: "My Mistral", website: "https://mistral.ai",
        apiKeyUrl: "https://console.mistral.ai/api-keys", apiBase: "https://my-proxy.example/v1",
        modelListUrl: null,
        auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
        responseFormat: "openai-sse", supportsStreaming: true,
        source: "user", category: "global",
      }];
      const merged = mergeRegistries(builtIn, remote, user);
      const mistral = merged.find((p) => p.id === "mistral");
      expect(mistral.apiBase).toBe("https://my-proxy.example/v1");
      expect(mistral.name).toBe("My Mistral");
    });

    it("user can add custom providers", () => {
      const user = [{
        id: "my-custom", name: "My Custom API", website: "", apiKeyUrl: "",
        apiBase: "https://custom.example/v1/chat/completions",
        modelListUrl: null,
        auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
        responseFormat: "openai-sse", supportsStreaming: true,
        source: "user", category: "global",
      }];
      const merged = mergeRegistries(builtIn, [], user);
      expect(merged).toHaveLength(3);
      expect(merged.find((p) => p.id === "my-custom").source).toBe("user");
    });

    it("user hidden providers are excluded", () => {
      const merged = mergeRegistries(builtIn, [], [], new Set(["mistral"]));
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe("openai");
    });
  });
});
