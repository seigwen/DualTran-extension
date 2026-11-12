"use strict";

/**
 * Maps old flat config keys to new provider-based structure.
 * Returns null if already migrated.
 *
 * SPEC 2.1 §8 — the provider is inferred from the legacy flat keys, never
 * defaulted to OpenAI:
 *   1. an existing (non-empty) `aiProvider` is kept as-is — an explicit ""
 *      stays "" and is never migrated back to openai;
 *   2. otherwise the first legacy API key in a fixed order decides the provider;
 *   3. no key but a legacy endpoint/model exists → the custom provider;
 *   4. nothing at all → "" (the unconfigured state the settings page shows).
 * @param {{ get: Function, set: Function }} config
 * @returns {Object|null} migrated data or null
 */
const LEGACY_KEY_PROVIDER_ORDER = [
  ["apiKeyOpenAI", "openai"],
  ["apiKeyAnthropic", "anthropic"],
  ["apiKeyGoogleGemini", "google-gemini"],
  ["apiKeyDeepSeek", "deepseek"],
  ["apiKeyOpenRouter", "openrouter"],
];

/** Legacy endpoint/model fields that imply the user typed a custom provider by hand. */
const LEGACY_CUSTOM_FIELDS = [
  "openAiApiBase",
  "anthropicApiBase",
  "googleGeminiApiBase",
  "deepSeekApiBase",
  "azureOpenAIEndpoint",
  "openRouterApiBase",
];

export const LEGACY_CUSTOM_PROVIDER_ID = "_custom_legacy";

function _trimmed(value) {
  return String(value ?? "").trim();
}

export function inferLegacyProviderId(config) {
  const storedProvider = _trimmed(config.get("aiProvider"));
  if (storedProvider) return storedProvider;

  for (const [keyName, providerId] of LEGACY_KEY_PROVIDER_ORDER) {
    if (_trimmed(config.get(keyName))) return providerId;
  }

  if (LEGACY_CUSTOM_FIELDS.some((keyName) => _trimmed(config.get(keyName)))) {
    return LEGACY_CUSTOM_PROVIDER_ID;
  }

  return "";
}

export function migrateProviderConfig(config) {
  if (config.get("registryMigrated")) {
    return null;
  }

  const activeProviderId = inferLegacyProviderId(config);

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

  // Write back to config. `aiProvider` is persisted explicitly (including "")
  // so a migrated install has a stable provider and the legacy inference never
  // runs twice; stored values are not otherwise rewritten.
  config.set("aiProvider", activeProviderId);
  config.set("activeProviderId", activeProviderId);
  config.set("providerConfigs", providers);
  config.set("registryMigrated", "true");

  return { activeProviderId, providers };
}
