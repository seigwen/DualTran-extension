/**
 * AI translation cache key construction — single source (plan 59 M3-8).
 * Extracted from src/background/aiTranslationCache.js.
 */

export const AI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Build the composite cache key.
 * Uses NUL-byte separator to prevent key-collision attacks.
 *
 * `reasoningDepth` participates so that changing the reasoning depth produces a
 * different entry: the same provider+model at a different depth may return a
 * different translation, and serving the old one would silently hand the user
 * a result from a depth they no longer asked for. Adding this segment also
 * invalidates pre-existing entries on upgrade — the cost is one re-translation,
 * which is strictly safer than mislabelling a cached result.
 *
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} reasoningDepth
 * @param {string} urlWithoutParams
 * @param {string} originalText
 * @returns {string}
 */
export function buildCacheKey(providerId, modelId, reasoningDepth, urlWithoutParams, originalText) {
  return `${providerId}\0${modelId}\0${reasoningDepth ?? ""}\0${urlWithoutParams}\0${originalText}`;
}
