/**
 * JSON file-backed translation cache — Node CLI (plan 59 M4).
 *
 * Same contract as createMemoryCache, persisted to a JSON file. Written for
 * the CLI's scale (one-shot batch runs): the file is loaded lazily on first
 * use and rewritten on every set. Storage failures degrade to in-memory-only
 * operation (the translation still succeeds).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @param {string} filePath
 * @returns {{get: Function, set: Function, size: () => number}}
 */
export function createFileCache(filePath) {
  let loaded = false;
  /** @type {Object<string, {translatedText: string, detectedLanguage: string}>} */
  let entries = {};

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      entries = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (_) {
      entries = {};
    }
  }

  function persist() {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(entries, null, 2));
    } catch (_) {
      /* best effort — cache only */
    }
  }

  const keyOf = (service, sourceLanguage, targetLanguage, text) =>
    JSON.stringify([service, sourceLanguage, targetLanguage, text]);

  return {
    async get(service, sourceLanguage, targetLanguage, requestString) {
      load();
      return entries[keyOf(service, sourceLanguage, targetLanguage, requestString)];
    },
    async set(service, sourceLanguage, targetLanguage, originalText, translatedText, detectedLanguage) {
      load();
      entries[keyOf(service, sourceLanguage, targetLanguage, originalText)] = {
        translatedText,
        detectedLanguage,
      };
      persist();
    },
    size() {
      load();
      return Object.keys(entries).length;
    },
  };
}
