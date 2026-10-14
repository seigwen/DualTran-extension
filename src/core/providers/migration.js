"use strict";

/**
 * Maps old flat config keys to new provider-based structure.
 * Returns null if already migrated.
 * @param {{ get: Function, set: Function }} config
 * @returns {Object|null} migrated data or null
 */
export function migrateProviderConfig(config) {
  if (config.get("registryMigrated")) {
    return null;
  }

  const activeProviderId = config.get("aiProvider") || "openai";

  const providers = {};

  // OpenAI
  const openaiKey = (config.get("apiKeyOpenAI") || "").trim();
  if (openaiKey) {
    providers.openai = {
      apiKey: openaiKey,
      model: config.get("openAiModel") || "gpt-3.5-turbo",
    };
  }

  // Google Gemini
  const geminiKey = (config.get("apiKeyGoogleGemini") || "").trim();
  if (geminiKey) {
    providers["google-gemini"] = {
      apiKey: geminiKey,
      model: config.get("googleGeminiModel") || "models/gemini-1.5-flash",
    };
  }

  // Anthropic
  const anthropicKey = (config.get("apiKeyAnthropic") || "").trim();
  if (anthropicKey) {
    providers.anthropic = {
      apiKey: anthropicKey,
      model: config.get("anthropicModel") || "claude-3-haiku-20240307",
    };
  }

  // Azure OpenAI
  const azureKey = (config.get("apiKeyAzureOpenAI") || "").trim();
  if (azureKey) {
    providers["azure-openai"] = {
      apiKey: azureKey,
      endpoint: (config.get("azureOpenAIEndpoint") || "").trim(),
      model: config.get("azureOpenAIModel") || "",
    };
  }

  // DeepSeek
  const deepseekKey = (config.get("apiKeyDeepSeek") || "").trim();
  if (deepseekKey) {
    providers.deepseek = {
      apiKey: deepseekKey,
      model: config.get("deepSeekModel") || "deepseek-chat",
    };
  }

  // Grok
  const grokKey = (config.get("apiKeyGrok") || "").trim();
  if (grokKey) {
    providers.grok = {
      apiKey: grokKey,
      model: config.get("grokModel") || "grok-beta",
    };
  }

  // OpenRouter (has extra fields)
  const openrouterKey = (config.get("apiKeyOpenRouter") || "").trim();
  if (openrouterKey) {
    providers.openrouter = {
      apiKey: openrouterKey,
      model: (config.get("openRouterModel") || "openai/gpt-4o-mini").trim(),
      apiBase: (config.get("openRouterApiBase") || "").trim(),
      referer: (config.get("openRouterReferer") || "").trim(),
      title: (config.get("openRouterTitle") || "").trim(),
    };
  }

  // Write back to config
  config.set("activeProviderId", activeProviderId);
  config.set("providerConfigs", providers);
  config.set("registryMigrated", "true");

  return { activeProviderId, providers };
}
