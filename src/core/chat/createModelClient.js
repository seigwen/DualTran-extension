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

export async function createModelClient({ provider, apiKey, model, extra = {}, getProvidersData = null }) {
  const data = getProvidersData ? await getProvidersData() : null;
  // models.dev keys its data by its own IDs — resolve the internal → models.dev
  // alias first (e.g. google-gemini → google), otherwise npm never resolves and
  // the provider silently falls back to the OpenAI-compatible client (#88).
  const providerData = data?.[resolveModelsDevId(provider)];
  const npm = providerData?.npm;
  const rawApi = providerData?.api || "";
  const apiBase = extra.baseURL || (rawApi && !rawApi.includes("${") ? rawApi : "") || lookupKnownApiBase(provider) || undefined;

  // A base URL without a scheme (or a bare path) makes the AI SDK build a relative
  // request. Firefox resolves that against the extension origin and answers
  // 200 + a non-JSON body, which surfaces as the useless
  // "HTTP 200: Failed to process successful response" — fail loudly instead.
  if (apiBase && !/^https?:\/\//i.test(apiBase)) {
    throw new Error(
      `Invalid API base URL "${apiBase}" for provider "${provider}" — it must start with http:// or https://`
    );
  }

  // Azure special handling
  if (provider === "azure" || provider === "azure-openai") {
    const resourceName = extra.resourceName || "";
    return createAzure({ apiKey, resourceName, baseURL: apiBase })(model);
  }

  // Lookup SDK mapping
  if (npm && SDK_MAP[npm]) {
    try {
      return SDK_MAP[npm]({ apiKey, baseURL: apiBase })(model);
    } catch (_) {}
  }

  // Fallback: OpenAI-compatible client
  if (!apiBase) {
    throw new Error(`Unknown AI provider "${provider}" and no base URL in models.dev data`);
  }
  return createOpenAICompatible({
    name: providerData?.name || provider,
    apiKey,
    baseURL: apiBase,
  })(model);
}
