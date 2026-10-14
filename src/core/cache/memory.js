/**
 * In-memory adapters — Node / tests (plan 59 M3/M4).
 *
 * Two contracts live here:
 *   - createMemoryCache → the translation-cache contract consumed by the
 *     Service base class / translateGoogle:
 *       get(service, source, target, requestString) → {translatedText, detectedLanguage} | undefined
 *       set(service, source, target, originalText, translatedText, detectedLanguage)
 *   - createMemoryStorage → the storage-adapter contract consumed by the
 *     models.dev store / model preview:
 *       get(keys: string|string[]) → object, set(obj), remove(keys)
 */

/**
 * @returns {{get: Function, set: Function, size: () => number}}
 */
export function createMemoryCache() {
  /** @type {Map<string, {translatedText: string, detectedLanguage: string}>} */
  const entries = new Map();
  const keyOf = (service, sourceLanguage, targetLanguage, text) =>
    [service, sourceLanguage, targetLanguage, text].join("\u0000");

  return {
    async get(service, sourceLanguage, targetLanguage, requestString) {
      return entries.get(keyOf(service, sourceLanguage, targetLanguage, requestString));
    },
    async set(service, sourceLanguage, targetLanguage, originalText, translatedText, detectedLanguage) {
      entries.set(keyOf(service, sourceLanguage, targetLanguage, originalText), {
        translatedText,
        detectedLanguage,
      });
    },
    size() {
      return entries.size;
    },
  };
}

/**
 * @param {Object} [initial] — pre-seeded entries (e.g. a models.dev payload)
 * @returns {{get: Function, set: Function, remove: Function}}
 */
export function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));

  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of list) {
        if (store.has(key)) out[key] = store.get(key);
      }
      return out;
    },
    async set(obj) {
      for (const [key, value] of Object.entries(obj)) {
        store.set(key, value);
      }
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        store.delete(key);
      }
    },
  };
}
