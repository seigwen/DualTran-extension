"use strict";

console.log("aiTranslationCache.js is running");

import { Cache, Utils } from "./translationCache.js";

const AI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Build the composite cache key.
 * Uses NUL-byte separator to prevent key-collision attacks.
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} urlWithoutParams
 * @param {string} originalText
 * @returns {string}
 */
function buildCacheKey(providerId, modelId, urlWithoutParams, originalText) {
  return `${providerId}\0${modelId}\0${urlWithoutParams}\0${originalText}`;
}

/**
 * Database name follows the same convention as Google cache.
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @returns {string}
 * @example getDatabaseName("en", "zh-CN") → "ai@en.zh-CN"
 */
function getDatabaseName(sourceLanguage, targetLanguage) {
  return `ai@${sourceLanguage}.${targetLanguage}`;
}

/**
 * Cache entry shape (extends Cache's default shape with AI-specific fields).
 * @typedef {Object} AiCacheEntry
 * @property {string} key           — SHA1 hash of composite key
 * @property {string} originalText
 * @property {string} translatedText
 * @property {string} providerId
 * @property {string} modelId
 * @property {string} urlWithoutParams
 * @property {number} timestamp     — Date.now() when stored
 */

/**
 * Create or open the AI cache database for a language pair.
 * Reuses Cache.openIndexeddb from translationCache.js.
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @returns {Promise<IDBDatabase>}
 */
async function openAiDatabase(sourceLanguage, targetLanguage) {
  const dbName = getDatabaseName(sourceLanguage, targetLanguage);
  return await Cache.openIndexeddb(dbName, 1, ["cache"]);
}

/**
 * Get a cached AI translation.
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} urlWithoutParams
 * @param {string} originalText
 * @returns {Promise<{translated: string}|null>}
 */
export async function aiTranslationCacheGet(
  sourceLanguage,
  targetLanguage,
  providerId,
  modelId,
  urlWithoutParams,
  originalText
) {
  try {
    const compositeKey = buildCacheKey(providerId, modelId, urlWithoutParams, originalText);
    const hash = await Utils.stringToSHA1String(compositeKey);

    const db = await openAiDatabase(sourceLanguage, targetLanguage);

    return await new Promise((resolve) => {
      const store = db.transaction(["cache"], "readonly").objectStore("cache");
      const request = store.get(hash);

      request.onsuccess = () => {
        const entry = request.result;
        db.close();
        if (!entry) return resolve(null);
        // TTL check
        if (entry.timestamp && (Date.now() - entry.timestamp) > AI_CACHE_TTL_MS) {
          resolve(null);
        } else {
          resolve({ translated: entry.translatedText });
        }
      };
      request.onerror = () => { db.close(); resolve(null); };
    });
  } catch (e) {
    console.error("[AI-CACHE] get error:", e);
    return null;
  }
}

/**
 * Delete all expired entries from a given language-pair database.
 * Called from aiTranslationCacheSet as lightweight periodic cleanup.
 * @param {IDBDatabase} db
 * @returns {Promise<void>}
 */
async function purgeExpiredEntries(db) {
  try {
    const store = db.transaction(["cache"], "readwrite").objectStore("cache");
    const request = store.openCursor();
    const cutoff = Date.now() - AI_CACHE_TTL_MS;

    return await new Promise((resolve) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.timestamp && cursor.value.timestamp < cutoff) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => resolve();
    });
  } catch (_) {
    // Best-effort
  }
}

/**
 * Store a translation in the AI cache.
 * After storing, purges expired entries from the same language-pair DB.
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} urlWithoutParams
 * @param {string} originalText
 * @param {string} translatedText
 * @returns {Promise<void>}
 */
export async function aiTranslationCacheSet(
  sourceLanguage,
  targetLanguage,
  providerId,
  modelId,
  urlWithoutParams,
  originalText,
  translatedText
) {
  try {
    const compositeKey = buildCacheKey(providerId, modelId, urlWithoutParams, originalText);
    const hash = await Utils.stringToSHA1String(compositeKey);

    const db = await openAiDatabase(sourceLanguage, targetLanguage);

    await new Promise((resolve, reject) => {
      const store = db.transaction(["cache"], "readwrite").objectStore("cache");
      const request = store.put({
        key: hash,
        originalText,
        translatedText,
        providerId,
        modelId,
        urlWithoutParams,
        timestamp: Date.now(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Lightweight periodic cleanup: purge expired entries from this DB
    await purgeExpiredEntries(db);

    db.close();
  } catch (e) {
    console.error("[AI-CACHE] set error:", e);
  }
}

/**
 * Delete all AI translation cache databases.
 * @returns {Promise<void>}
 */
export async function deleteAiTranslationCache() {
  try {
    const databases = await indexedDB.databases();
    for (const dbInfo of databases) {
      if (dbInfo.name && dbInfo.name.startsWith("ai@")) {
        indexedDB.deleteDatabase(dbInfo.name);
      }
    }
  } catch (e) {
    console.error("[AI-CACHE] delete error:", e);
  }
}
