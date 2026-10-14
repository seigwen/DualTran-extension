/**
 * Provider settings resolution — pure helpers (plan 59 M3-2).
 *
 * Extracted from src/contentScript/fetchSSE.js `_resolveProviderSettings`.
 * The split: every computation over plain values lives here; config reads,
 * the interactive ensureConfigString dialog flow and twpConfig side effects
 * stay in the caller, which becomes thin orchestration
 * ("read config + fill gaps via dialog → call the pure functions").
 *
 * Behavior is kept byte-faithful to the original — including the exact
 * endpoint-suffix stripping and version-path appending rules.
 */

/**
 * Resolve the plain config-value layer for a provider.
 *
 * apiKey: per-provider config only — the legacy/dialog fallbacks are
 * interactive and stay with the caller. model: per-provider config, then the
 * legacy flat key (passed in as `legacyModel`).
 *
 * @param {Object} params
 * @param {string} params.providerId
 * @param {Object} params.providerConfigs — twpConfig.get("providerConfigs")
 * @param {*} [params.legacyModel] — raw legacy twpConfig model value (undefined = no legacy key)
 * @returns {{apiKeyFromConfig: string, model: string, userApiBase: string, isUserCustom: boolean, reasoningDepth: string}}
 */
export function resolveConfigValues({ providerId, providerConfigs = {}, legacyModel = undefined }) {
  const config = providerConfigs?.[providerId] || {};

  const apiKeyFromConfig = config.apiKey || "";

  let model = config.model || "";
  if (!model && legacyModel !== undefined) {
    model = (legacyModel || "").trim();
  }

  const userApiBase = (config.apiBase || "").trim();
  const isUserCustom = !!userApiBase;

  // Reasoning depth (per-provider, stored with apiKey/model). "" = no parameter sent.
  const reasoningDepth = config.reasoningDepth || "";

  return { apiKeyFromConfig, model, userApiBase, isUserCustom, reasoningDepth };
}

/**
 * Compute the effective base URL.
 * - User-customized: strip endpoint suffixes (/chat/completions, /messages), auto-append version path (/v1, /v1beta)
 * - Built-in default: extract base path (Google keeps /v1beta, others use origin + /v1)
 *
 * @param {Object} params
 * @param {string} params.providerId
 * @param {Object|undefined} params.providerDef — registry provider definition
 * @param {string} [params.userApiBase] — trimmed user-customized base ("" = none)
 * @returns {string}
 */
export function computeEffectiveBaseURL({ providerId, providerDef, userApiBase = "" }) {
  const isUserCustom = !!userApiBase;
  let effectiveBaseURL = "";
  if (isUserCustom) {
    // ① Strip known endpoint suffixes and trailing slashes
    effectiveBaseURL = userApiBase
      .replace(/\/(chat\/completions|messages)\/?$/, "")
      .replace(/\/+$/, "");

    // ② Check if the URL already contains a non-root path (e.g. /v1, /v1beta, /api, etc.)
    const url = new URL(effectiveBaseURL);
    const hasPath = url.pathname !== "/" && url.pathname !== "";

    // ③ If no path present, append a default version path based on provider type
    if (!hasPath) {
      // Check if this is a Google-family provider (gemini-json response format)
      const isGoogle = providerId === "google-gemini" || providerId === "google"
        || providerDef?.responseFormat === "gemini-json";
      // Google uses /v1beta, other providers use /v1
      effectiveBaseURL += isGoogle ? "/v1beta" : "/v1";
    }
  } else if (providerDef?.apiBase) {
    // Google built-in apiBase already contains /v1beta, use as-is; other providers use origin + /v1
    if (providerId === "google-gemini" || providerDef?.responseFormat === "gemini-json") {
      effectiveBaseURL = providerDef.apiBase;
    } else {
      effectiveBaseURL = new URL(providerDef.apiBase).origin + "/v1";
    }
  }
  return effectiveBaseURL;
}

/**
 * Decide which value (if any) `extra.baseURL` should receive.
 *
 * User customized API Base URL → always pass to all provider SDKs (all createXxx
 * functions in SDK_MAP accept a baseURL parameter). Non-custom: only set baseURL
 * for OpenAI-compatible formats and specific providers
 * (Anthropic/DeepSeek/Grok: the SDK handles baseURL via extra).
 *
 * @param {Object} params
 * @returns {string|null} base URL to set, or null to leave extra.baseURL unset
 */
export function computeExtraBaseURL({ providerId, providerDef, isUserCustom, effectiveBaseURL }) {
  if (!effectiveBaseURL) return null;
  if (isUserCustom) return effectiveBaseURL;
  if (providerDef?.responseFormat === "openai-sse" || providerDef?.responseFormat === "openai-json") {
    return effectiveBaseURL;
  }
  if (["anthropic", "deepseek", "grok"].includes(providerId)) {
    return effectiveBaseURL;
  }
  return null;
}

/**
 * OpenRouter special handling (base override + model normalization).
 *
 * @param {Object} params
 * @param {string} params.model
 * @param {string} params.openRouterApiBase — trimmed legacy twpConfig value ("" = none)
 * @param {string|undefined} params.extraBaseURL — the extra.baseURL chosen so far
 * @param {string|undefined} params.providerDefApiBase
 * @returns {{model: string, baseURL: string|null}} baseURL null = keep existing
 */
export function resolveOpenRouterOverrides({ model, openRouterApiBase = "", extraBaseURL, providerDefApiBase }) {
  let nextModel = model;
  let baseURL = null;
  // Only override when user set via legacy key; otherwise keep providerConfigs or built-in default
  if (openRouterApiBase) {
    baseURL = openRouterApiBase;
  } else if (!extraBaseURL && providerDefApiBase) {
    baseURL = providerDefApiBase;
  }
  if (nextModel) {
    nextModel = nextModel.replace(/^openrouter\//i, "");
  }
  if (!nextModel) nextModel = "openai/gpt-4o-mini";
  return { model: nextModel, baseURL };
}
