import { describe, expect, it, vi } from "vitest";
import { migrateProviderConfig } from "../../src/lib/ai/providerMigration.js";

describe("providerMigration", () => {
  function createMockConfig(overrides = {}) {
    const storage = {
      aiProvider: "openai",
      apiKeyOpenAI: "sk-test-openai",
      openAiModel: "gpt-4o",
      apiKeyGoogleGemini: "gemini-test-key",
      googleGeminiModel: "models/gemini-1.5-flash",
      apiKeyAnthropic: "anthropic-test-key",
      anthropicModel: "claude-3-haiku-20240307",
      apiKeyAzureOpenAI: "azure-test-key",
      azureOpenAIEndpoint: "https://myorg.openai.azure.com",
      azureOpenAIModel: "gpt-4-deployment",
      apiKeyDeepSeek: "deepseek-test-key",
      deepSeekModel: "deepseek-chat",
      apiKeyGrok: "grok-test-key",
      grokModel: "grok-beta",
      apiKeyOpenRouter: "openrouter-test-key",
      openRouterModel: "openai/gpt-4o-mini",
      openRouterApiBase: "https://openrouter.ai/api/v1/chat/completions",
      openRouterReferer: "https://example.com",
      openRouterTitle: "My App",
      ...overrides,
    };
    return {
      get: (key) => storage[key],
      set: vi.fn(),
    };
  }

  it("migrates all 7 provider configs", () => {
    const config = createMockConfig();
    const result = migrateProviderConfig(config);

    expect(result.activeProviderId).toBe("openai");
    expect(result.providers.openai.apiKey).toBe("sk-test-openai");
    expect(result.providers.openai.model).toBe("gpt-4o");
    expect(result.providers["google-gemini"].apiKey).toBe("gemini-test-key");
    expect(result.providers["google-gemini"].model).toBe("models/gemini-1.5-flash");
    expect(result.providers.anthropic.apiKey).toBe("anthropic-test-key");
    expect(result.providers.anthropic.model).toBe("claude-3-haiku-20240307");
    expect(result.providers["azure-openai"].apiKey).toBe("azure-test-key");
    expect(result.providers["azure-openai"].endpoint).toBe("https://myorg.openai.azure.com");
    expect(result.providers["azure-openai"].model).toBe("gpt-4-deployment");
    expect(result.providers.deepseek.apiKey).toBe("deepseek-test-key");
    expect(result.providers.deepseek.model).toBe("deepseek-chat");
    expect(result.providers.grok.apiKey).toBe("grok-test-key");
    expect(result.providers.grok.model).toBe("grok-beta");
    expect(result.providers.openrouter.apiKey).toBe("openrouter-test-key");
    expect(result.providers.openrouter.model).toBe("openai/gpt-4o-mini");
    expect(result.providers.openrouter.apiBase).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(result.providers.openrouter.referer).toBe("https://example.com");
    expect(result.providers.openrouter.title).toBe("My App");
  });

  it("is idempotent (no crash on re-run)", () => {
    const config = createMockConfig();
    const first = migrateProviderConfig(config);
    const second = migrateProviderConfig(config);
    expect(second.providers.openai.apiKey).toBe(first.providers.openai.apiKey);
    expect(second.activeProviderId).toBe(first.activeProviderId);
  });

  it("handles empty config gracefully", () => {
    // SPEC 2.1 #8: nothing legacy to infer from → stay unconfigured (""), not openai.
    const config = { get: () => undefined, set: vi.fn() };
    const result = migrateProviderConfig(config);
    expect(result.activeProviderId).toBe("");
    expect(result.providers).toBeDefined();
    expect(config.set).toHaveBeenCalledWith("aiProvider", "");
  });

  it("keeps an explicit empty provider empty (never migrates it back to openai)", () => {
    const config = createMockConfig({
      aiProvider: "",
      apiKeyOpenAI: "",
      apiKeyGoogleGemini: "",
      apiKeyAnthropic: "",
      apiKeyAzureOpenAI: "",
      apiKeyDeepSeek: "",
      apiKeyGrok: "",
      apiKeyOpenRouter: "",
      openAiModel: "",
      anthropicModel: "",
      googleGeminiModel: "",
      deepSeekModel: "",
      grokModel: "",
      openRouterModel: "",
      openAiApiBase: "",
      anthropicApiBase: "",
      googleGeminiApiBase: "",
      deepSeekApiBase: "",
      openRouterApiBase: "",
      azureOpenAIEndpoint: "",
    });
    const result = migrateProviderConfig(config);
    expect(result.activeProviderId).toBe("");
    expect(config.set).toHaveBeenCalledWith("aiProvider", "");
  });

  it("infers the provider from the legacy flat apiKeys (spec 2.1 order)", () => {
    const onlyAnthropic = createMockConfig({
      aiProvider: "",
      apiKeyOpenAI: "",
      apiKeyGoogleGemini: "",
      apiKeyAnthropic: "anthropic-key",
      apiKeyDeepSeek: "",
      apiKeyOpenRouter: "",
    });
    expect(migrateProviderConfig(onlyAnthropic).activeProviderId).toBe("anthropic");

    const onlyOpenRouter = createMockConfig({
      aiProvider: "",
      apiKeyOpenAI: "",
      apiKeyAnthropic: "",
      apiKeyGoogleGemini: "",
      apiKeyDeepSeek: "",
      apiKeyOpenRouter: "openrouter-key",
    });
    expect(migrateProviderConfig(onlyOpenRouter).activeProviderId).toBe("openrouter");
  });

  it("uses the custom provider when no key exists but an endpoint/model does", () => {
    // openRouterApiBase is the only legacy endpoint field with no key next to it.
    const config = createMockConfig({
      aiProvider: "",
      apiKeyOpenAI: "",
      apiKeyAnthropic: "",
      apiKeyGoogleGemini: "",
      apiKeyDeepSeek: "",
      apiKeyOpenRouter: "",
      openRouterApiBase: "https://proxy.example/v1/chat/completions",
    });
    expect(migrateProviderConfig(config).activeProviderId).toBe("_custom_legacy");

    const modelOnly = createMockConfig({
      aiProvider: "",
      apiKeyOpenAI: "",
      apiKeyAnthropic: "",
      apiKeyGoogleGemini: "",
      apiKeyDeepSeek: "",
      apiKeyOpenRouter: "",
      openAiApiBase: "",
      anthropicApiBase: "",
      googleGeminiApiBase: "",
      deepSeekApiBase: "",
      openRouterApiBase: "",
      openRouterModel: "some/model",
    });
    expect(migrateProviderConfig(modelOnly).activeProviderId).toBe("_custom_legacy");
  });

  it("does not re-migrate if already migrated", () => {
    const config = createMockConfig({ registryMigrated: "true" });
    const result = migrateProviderConfig(config);
    expect(result).toBeNull();
  });
});
