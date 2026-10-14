/**
 * models.dev data store — factory over injected host capabilities (plan 59 M2).
 *
 * Extracted from src/background/aiProxy.js §models.dev 段 with the semantics
 * kept verbatim: 24h TTL, the `> 10 providers` validity threshold, in-memory
 * memoization, and the concurrent-refresh re-check. All side effects that were
 * implicit (chrome.storage.local, global fetch, Date.now) are now explicit
 * injection points, so Node / test hosts can run the same store.
 *
 * The extension wires it in src/background/aiProxy.js; the Node CLI uses a
 * memory storage adapter (see scripts/tx-cli.mjs).
 */

export const MODELSDEV_URL = "https://models.dev/api.json";
export const MODELSDEV_CACHE_KEY = "modelsdev:providers";
export const MODELSDEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * @typedef {{ get(keys: string): Promise<object>, set(obj: object): Promise<void> }} StorageAdapter
 */

/**
 * @param {Object} [opts]
 * @param {StorageAdapter|null} [opts.storage=null] — cache storage; null = uncached
 * @param {Function} [opts.fetch=globalThis.fetch]
 * @param {Function} [opts.now=Date.now]
 * @param {number} [opts.ttlMs] — cache TTL
 * @param {string} [opts.url]
 * @param {string} [opts.cacheKey]
 */
export function createModelsDevStore({
  storage = null,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  ttlMs = MODELSDEV_CACHE_TTL_MS,
  url = MODELSDEV_URL,
  cacheKey = MODELSDEV_CACHE_KEY,
} = {}) {
  let _providersData = null;

  async function getProvidersData() {
    if (_providersData) return _providersData;
    try {
      if (storage) {
        const result = await storage.get(cacheKey);
        const cached = result[cacheKey];
        if (cached?.data && Object.keys(cached.data).length > 10) {
          _providersData = cached.data;
          const age = now() - (cached.ts || 0);
          if (age > ttlMs) {
            refreshProvidersData(); // Cache expired, refresh in background
          }
          return _providersData;
        }
      }
    } catch (_) {}
    try {
      const resp = await fetchImpl(url);
      if (resp.ok) {
        _providersData = await resp.json();
        if (storage) {
          storage.set({ [cacheKey]: { data: _providersData, ts: now() } });
        }
        return _providersData;
      }
    } catch (_) {}
    return null;
  }

  async function refreshProvidersData() {
    try {
      // Re-check cache age to avoid concurrent duplicate fetches
      if (storage) {
        const result = await storage.get(cacheKey);
        const cached = result[cacheKey];
        if (cached?.ts && (now() - cached.ts) < ttlMs) return;
      }
    } catch (_) {}
    try {
      const resp = await fetchImpl(url);
      if (resp.ok) {
        _providersData = await resp.json();
        if (storage) {
          storage.set({ [cacheKey]: { data: _providersData, ts: now() } });
        }
      }
    } catch (_) {}
  }

  return {
    getProvidersData,
    refreshProvidersData,
    /** Startup prefetch — the extension calls this on Service Worker boot. */
    prefetch: getProvidersData,
  };
}
