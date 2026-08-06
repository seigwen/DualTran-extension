"use strict";

import { validateProviderDefinition } from "../lib/ai/providerTypes.js";

const CACHE_KEY = "providerRemoteCache";
const CACHE_TIMESTAMP_KEY = "providerRemoteCacheTimestamp";
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch remote provider definitions from a URL.
 * @param {string} url
 * @param {Function} [fetcher=fetch]
 * @returns {Promise<Object[]|null>} parsed providers or null on failure
 */
export async function fetchRemoteProviders(url, fetcher = fetch) {
  if (!url || typeof url !== "string" || !url.trim()) {
    return null;
  }

  try {
    const response = await fetcher(url.trim());
    if (!response.ok) {
      console.warn(`Provider remote fetch failed: HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      console.warn("Provider remote data is not an array");
      return null;
    }
    return data;
  } catch (err) {
    console.warn("Provider remote fetch error:", err);
    return null;
  }
}

/**
 * Merge remote providers into built-in list.
 * Invalid remote entries are silently dropped.
 * @param {Object[]} builtIn
 * @param {Object[]} remote
 * @returns {Object[]} merged provider list
 */
export function mergeRemoteProviders(builtIn, remote) {
  if (!Array.isArray(remote) || remote.length === 0) {
    return [...builtIn];
  }

  const map = new Map();
  for (const def of builtIn) {
    map.set(def.id, { ...def });
  }

  for (const def of remote) {
    const errors = validateProviderDefinition(def);
    if (errors.length > 0) {
      console.warn(`Skipping invalid remote provider "${def.id || "unknown"}":`, errors.join(", "));
      continue;
    }

    const existing = map.get(def.id);
    if (existing) {
      const mutableFields = [
        "name", "website", "apiKeyUrl", "shortDesc", "apiBase",
        "modelListUrl", "auth", "responseFormat", "supportsStreaming",
        "modelListParser", "extraHeaders", "category", "tags",
      ];
      for (const field of mutableFields) {
        if (def[field] !== undefined) {
          existing[field] = def[field];
        }
      }
    } else {
      map.set(def.id, { ...def, source: "remote" });
    }
  }

  return [...map.values()];
}

/**
 * Check cache and optionally fetch fresh remote providers.
 * @param {Object} params
 * @param {string} params.url - remote URL
 * @param {Function} params.storageGet - chrome.storage.local.get binding
 * @param {Function} params.storageSet - chrome.storage.local.set binding
 * @param {Function} [params.fetcher]
 * @param {number} [params.cacheMs]
 * @returns {Promise<Object[]|null>} remote providers or null
 */
export async function getRemoteProvidersWithCache({
  url,
  storageGet,
  storageSet,
  fetcher = fetch,
  cacheMs = DEFAULT_CACHE_MS,
}) {
  if (!url) return null;

  const cached = await new Promise((resolve) => {
    storageGet([CACHE_KEY, CACHE_TIMESTAMP_KEY], (result) => resolve(result || {}));
  });

  const timestamp = cached[CACHE_TIMESTAMP_KEY] || 0;
  const age = Date.now() - timestamp;

  if (age < cacheMs && Array.isArray(cached[CACHE_KEY])) {
    return cached[CACHE_KEY];
  }

  const fresh = await fetchRemoteProviders(url, fetcher);
  if (fresh) {
    await new Promise((resolve) => {
      storageSet({
        [CACHE_KEY]: fresh,
        [CACHE_TIMESTAMP_KEY]: Date.now(),
      }, resolve);
    });
    return fresh;
  }

  if (Array.isArray(cached[CACHE_KEY])) {
    return cached[CACHE_KEY];
  }

  return null;
}
