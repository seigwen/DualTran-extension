/**
 * createModelClient — dynamic npm → SDK client selection (plan 59 M2 —
 * moved here from src/background/aiProxy.js, behavior kept verbatim).
 *
 * Three-tier apiBase fallback chain:
 *   extra.baseURL → models.dev `api` → lookupKnownApiBase() → throw
 *
 * The models.dev data is injected (`getProvidersData`) so the module itself
 * stays host-free; src/background/aiProxy.js binds it to the chrome-storage
 * store and re-exports the bound function at the historic path.
 */
import { createAzure } from "@ai-sdk/azure";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { SDK_MAP } from "./sdkMap.js";
import { lookupKnownApiBase, resolveModelsDevId } from "../providers/registry.js";
import { normalizeEndpoint } from "./endpoint.js";

export async function createModelClient({ provider, apiKey, model, extra = {}, getProvidersData = null, fetch: fetchImpl = undefined }) {
  const data = getProvidersData ? await getProvidersData() : null;
  // models.dev keys its data by its own IDs — resolve the internal → models.dev
  // alias first (e.g. google-gemini → google), otherwise npm never resolves and
  // the provider silently falls back to the OpenAI-compatible client (#88).
  const providerData = data?.[resolveModelsDevId(provider)];
  const npm = providerData?.npm;
  const rawApi = providerData?.api || "";
  const apiBase = extra.baseURL || (rawApi && !rawApi.includes("${") ? rawApi : "") || lookupKnownApiBase(provider) || undefined;

  // One validator for every entry point (plan 86): a base URL without a scheme, with a
  // pasted request path, or with a template variable would otherwise reach the request
  // builder. Firefox then resolves a relative URL against the extension origin and answers
  // 200 + a non-JSON body — the "HTTP 200: Failed to process successful response" symptom.
  let resolvedBase = apiBase;
  if (apiBase) {
    const normalized = normalizeEndpoint(apiBase);
    if (!normalized.ok) {
      const hint = normalized.suggestion ? ` — did you mean ${normalized.suggestion}?` : "";
      throw new Error(`Invalid API base URL "${apiBase}" for provider "${provider}" (${normalized.problem})${hint}`);
    }
    resolvedBase = normalized.url;
  }

  // Azure special handling
  if (provider === "azure" || provider === "azure-openai") {
    const resourceName = extra.resourceName || "";
    return createAzure({ apiKey, resourceName, baseURL: resolvedBase, fetch: fetchImpl })(model);
  }

  // Lookup SDK mapping
  if (npm && SDK_MAP[npm]) {
    try {
      return SDK_MAP[npm]({ apiKey, baseURL: resolvedBase, fetch: fetchImpl })(model);
    } catch (_) {}
  }

  // Fallback: OpenAI-compatible client
  if (!apiBase) {
    throw new Error(`Unknown AI provider "${provider}" and no base URL in models.dev data`);
  }
  return createOpenAICompatible({
    name: providerData?.name || provider,
    apiKey,
    baseURL: resolvedBase,
    fetch: fetchImpl,
  })(model);
}
