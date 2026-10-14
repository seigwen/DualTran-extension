/**
 * @dualtran/core — public entry (plan 59 M4).
 *
 * The cross-host translation engine extracted from the DualTran Chrome
 * extension. Zero host dependencies — every host capability (storage, fetch,
 * caches, locale) is injected by the caller. Consumed by:
 *   - the extension itself (via the stable shim paths in src/lib, src/background)
 *   - the Node CLI harness (scripts/tx-cli.mjs over dist-core)
 *   - future hosts: browsers family (P1), workbench apps (P2), agents (P3)
 *
 * License: MPL-2.0 (see PROVENANCE.md for the TWP-original classification).
 */

// ── providers ───────────────────────────────────────────────────────────
export {
  BUILT_IN_PROVIDERS,
  createProviderRegistry,
  mergeRegistries,
  resolveModelsDevId,
  lookupKnownApiBase,
  INTERNAL_TO_MODELSDEV,
} from "./providers/registry.js";
export { validateProviderDefinition } from "./providers/types.js";
export { migrateProviderConfig } from "./providers/migration.js";
export {
  getSmartDefaultModel,
  getPreviewProviders,
  loadPreviewModels,
} from "./providers/modelPreview.js";
export {
  REASONING_DEFAULT,
  DIALECT_SDK_NPM_PACKAGES,
  resolveDialect,
  buildReasoningDepthOptions,
  buildProviderOptions,
} from "./providers/reasoningDepth.js";
export {
  resolveConfigValues,
  computeEffectiveBaseURL,
  computeExtraBaseURL,
  resolveOpenRouterOverrides,
} from "./providers/settings.js";

// ── chat transport ──────────────────────────────────────────────────────
export { SDK_MAP } from "./chat/sdkMap.js";
export { createModelsDevStore } from "./chat/modelsDev.js";
export { createModelClient } from "./chat/createModelClient.js";
export { streamChat, formatAiError } from "./chat/streamChat.js";

// ── translator ──────────────────────────────────────────────────────────
export { buildTranslationMessages, buildWordPromptRole } from "./translator/prompts.js";

// ── engines ─────────────────────────────────────────────────────────────
export { Service, serviceRuntime } from "./engines/serviceBase.js";
export { Utils } from "./engines/utils.js";
export { googleService, parseGoogleResponse, translateGoogle } from "./engines/google.js";

// ── cache ───────────────────────────────────────────────────────────────
export { buildCacheKey, AI_CACHE_TTL_MS } from "./cache/keys.js";
export { createMemoryCache, createMemoryStorage } from "./cache/memory.js";
export { createFileCache } from "./cache/file.js";

// ── languages ───────────────────────────────────────────────────────────
export { codeToLanguageNameInEnglish, otherConfigs, allLanguagesNames } from "./languages/names.js";
