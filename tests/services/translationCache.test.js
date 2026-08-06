import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

let _moduleLoadSeq = 0; // 确定性 cache-busting（替代 Math.random()）

const SOURCE_FILE_URL = new URL("../../src/background/translationCache.js", import.meta.url);
const CACHE_LIST_DB_NAME = "cacheList";
const LEGACY_CACHE_NAMES = ["googleCache", "yandexCache", "bingCache"];
const knownDatabaseNames = new Set([CACHE_LIST_DB_NAME, ...LEGACY_CACHE_NAMES]);

let capturedMessageListener;
let translationCacheModule;
let testHooks;

function registerCacheDatabaseName(service, sourceLanguage, targetLanguage) {
  knownDatabaseNames.add(`${service}@${sourceLanguage}.${targetLanguage}`);
}

function installChromeMock() {
  capturedMessageListener = undefined;

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener) => {
          capturedMessageListener = listener;
        }),
      },
      reload: vi.fn(),
    },
  };
}

function waitForTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(condition, { timeout = 1000 } = {}) {
  const start = Date.now();

  while (Date.now() - start <= timeout) {
    if (await condition()) return;
    await waitForTick();
  }

  throw new Error("Timed out waiting for condition");
}

function deleteIndexedDb(name) {
  return new Promise((resolve) => {
    if (!name) return resolve();

    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function cleanupIndexedDb() {
  const names = new Set(knownDatabaseNames);

  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    databases.forEach((database) => {
      if (database?.name) names.add(database.name);
    });
  }

  for (const name of names) {
    await deleteIndexedDb(name);
  }
}

async function readCacheListEntry(db, dbName) {
  return await new Promise((resolve, reject) => {
    const request = db
      .transaction(["cache_list"], "readonly")
      .objectStore("cache_list")
      .get(dbName);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function waitForCacheListReady() {
  await waitFor(() => Boolean(testHooks?.cacheList?.dbCacheList));
}

async function waitForCacheListEntry(dbName) {
  await waitForCacheListReady();
  await waitFor(async () => Boolean(await readCacheListEntry(testHooks.cacheList.dbCacheList, dbName)));
}

async function importTranslationCache() {
  const source = await readFile(SOURCE_FILE_URL, "utf8");
  const instrumentedSource = source
    // 替换静态 import（Service Worker 不支持动态 import，源码已改为静态 import）
    .replace(
      /import \{ deleteAiTranslationCache \} from "\.\/aiTranslationCache\.js";/g,
      "const deleteAiTranslationCache = () => Promise.resolve();"
    )
    .replace(
      /import\("\.\/aiTranslationCache\.js"\)/g,
      'Promise.resolve().then(() => ({ deleteAiTranslationCache: () => Promise.resolve() }))'
    )
    .replace(
      /return translationCache;\s*}\)\(\);/,
      [
        'translationCache.__testHooks = { Utils, Cache, CacheList, cacheList };',
        "  return translationCache;",
        "})();",
      ].join("\n")
    )
    .concat(`\n//# sourceURL=translationCache.testable.${_moduleLoadSeq++}.js`);

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(instrumentedSource).toString("base64")}`;
  const importedModule = await import(moduleUrl);

  translationCacheModule = importedModule.default;
  testHooks = translationCacheModule.__testHooks;

  await waitForCacheListReady();

  return translationCacheModule;
}

describe("translationCache", () => {
  beforeEach(async () => {
    vi.resetModules();

    if (!globalThis.crypto?.subtle) {
      globalThis.crypto = webcrypto;
    }

    translationCacheModule = undefined;
    testHooks = undefined;

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    delete globalThis.chrome;
    await cleanupIndexedDb();
    installChromeMock();
  });

  afterEach(async () => {
    testHooks?.cacheList?.list?.forEach((cache) => cache.close());
    testHooks?.cacheList?.dbCacheList?.close?.();

    delete globalThis.chrome;
    await cleanupIndexedDb();
  });

  it("stores a translation and returns true from set", async () => {
    const translationCache = await importTranslationCache();

    const result = await translationCache.set("google", "en", "fr", "hello", "bonjour", "en");

    registerCacheDatabaseName("google", "en", "fr");
    expect(result).toBe(true);
  });

  it("retrieves a stored translation with get", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set("google", "en", "fr", "hello", "bonjour", "en");
    registerCacheDatabaseName("google", "en", "fr");

    const entry = await translationCache.get("google", "en", "fr", "hello");

    expect(entry).toMatchObject({
      originalText: "hello",
      translatedText: "bonjour",
      detectedLanguage: "en",
    });
    expect(entry.key).toMatch(/^[a-f0-9]{40}$/);
  });

  it("returns undefined for a missing entry", async () => {
    const translationCache = await importTranslationCache();

    const entry = await translationCache.get("google", "en", "fr", "missing text");

    registerCacheDatabaseName("google", "en", "fr");
    expect(entry).toBeUndefined();
  });

  it("round-trips originalText translatedText and detectedLanguage", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set(
      "google",
      "en",
      "fr",
      "A small test sentence",
      "Une petite phrase de test",
      "en"
    );
    registerCacheDatabaseName("google", "en", "fr");

    const entry = await translationCache.get("google", "en", "fr", "A small test sentence");

    expect(entry).toEqual({
      originalText: "A small test sentence",
      translatedText: "Une petite phrase de test",
      detectedLanguage: "en",
      key: expect.any(String),
    });
  });

  it("isolates cached entries by translation service", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set("google", "en", "fr", "shared", "bonjour", "en");
    await translationCache.set("yandex", "en", "fr", "shared", "salut", "en");
    registerCacheDatabaseName("google", "en", "fr");
    registerCacheDatabaseName("yandex", "en", "fr");

    const googleEntry = await translationCache.get("google", "en", "fr", "shared");
    const yandexEntry = await translationCache.get("yandex", "en", "fr", "shared");

    expect(googleEntry?.translatedText).toBe("bonjour");
    expect(yandexEntry?.translatedText).toBe("salut");
  });

  it("isolates cached entries by language pair", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set("google", "en", "fr", "tree", "arbre", "en");
    await translationCache.set("google", "en", "de", "tree", "Baum", "en");
    registerCacheDatabaseName("google", "en", "fr");
    registerCacheDatabaseName("google", "en", "de");

    const frenchEntry = await translationCache.get("google", "en", "fr", "tree");
    const germanEntry = await translationCache.get("google", "en", "de", "tree");

    expect(frenchEntry?.translatedText).toBe("arbre");
    expect(germanEntry?.translatedText).toBe("Baum");
  });

  it("deletes all translation caches", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set("google", "en", "fr", "hello", "bonjour", "en");
    registerCacheDatabaseName("google", "en", "fr");

    await translationCache.deleteTranslationCache(false);

    const entry = await translationCache.get("google", "en", "fr", "hello");

    expect(entry).toBeUndefined();
  });

  it("reloads the extension when deleteTranslationCache is called with reload=true", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.deleteTranslationCache(true);

    expect(globalThis.chrome.runtime.reload).toHaveBeenCalledOnce();
  });

  it("registers a runtime onMessage listener on import", async () => {
    await importTranslationCache();

    expect(globalThis.chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(capturedMessageListener).toEqual(expect.any(Function));
  });

  it("responds to getCacheSize messages with a size string", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set("google", "en", "fr", "message size test", "test de taille", "en");
    registerCacheDatabaseName("google", "en", "fr");
    await waitForCacheListEntry("google@en.fr");

    const sendResponse = vi.fn();
    const keepAlive = capturedMessageListener({ action: "getCacheSize" }, {}, sendResponse);

    await waitFor(() => sendResponse.mock.calls.length === 1);

    expect(keepAlive).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(expect.stringMatching(/^\d+(?:\.\d)?\s(?:B|KB|MB|GB|TB|PB|EB|ZB|YB)$/));
  });

  it("clears the cache when deleteTranslationCache is requested through the runtime listener", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set("google", "en", "fr", "listener delete", "suppression écouteur", "en");
    registerCacheDatabaseName("google", "en", "fr");

    capturedMessageListener({ action: "deleteTranslationCache", reload: false }, {}, vi.fn());

    await waitFor(async () => {
      const entry = await translationCache.get("google", "en", "fr", "listener delete");
      return entry === undefined;
    });

    expect(await translationCache.get("google", "en", "fr", "listener delete")).toBeUndefined();
    expect(globalThis.chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it("formats small sizes with Utils.humanReadableSize", async () => {
    await importTranslationCache();

    expect(testHooks.Utils.humanReadableSize(512)).toBe("512 B");
  });

  it("formats kilobytes with Utils.humanReadableSize", async () => {
    await importTranslationCache();

    expect(testHooks.Utils.humanReadableSize(1024)).toBe("1.0 KB");
  });

  it("builds database names with Cache.getDataBaseName", async () => {
    await importTranslationCache();

    expect(testHooks.Cache.getDataBaseName("google", "en", "fr")).toBe("google@en.fr");
  });

  it("returns the cache object store name", async () => {
    await importTranslationCache();

    expect(testHooks.Cache.getCacheStorageName()).toBe("cache");
  });

  it("opens a translation cache database with the cache store", async () => {
    await importTranslationCache();

    const db = await testHooks.Cache.openDataBaseCache("google", "es", "it");

    registerCacheDatabaseName("google", "es", "it");
    expect(db.name).toBe("google@es.it");
    expect([...db.objectStoreNames]).toEqual(["cache"]);
    db.close();
  });

  it("reuses the same Cache instance for repeated CacheList lookups", async () => {
    await importTranslationCache();

    const firstCache = await testHooks.cacheList.getCache("google", "en", "fr");
    const secondCache = await testHooks.cacheList.getCache("google", "en", "fr");

    registerCacheDatabaseName("google", "en", "fr");
    expect(firstCache).toBe(secondCache);
  });

  it("calculates a human readable cache size through CacheList", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set("google", "en", "fr", "sized text", "texte mesuré", "en");
    registerCacheDatabaseName("google", "en", "fr");
    await waitForCacheListEntry("google@en.fr");

    const size = await testHooks.cacheList.calculateSize();

    expect(size).toMatch(/^\d+(?:\.\d)?\s(?:B|KB|MB|GB|TB|PB|EB|ZB|YB)$/);
  });

  it("keeps queried translations in memory and avoids a second IndexedDB read", async () => {
    const translationCache = await importTranslationCache();

    await translationCache.set("google", "en", "fr", "memoized text", "texte memo", "en");
    registerCacheDatabaseName("google", "en", "fr");

    const getSpy = vi.spyOn(IDBObjectStore.prototype, "get");

    try {
      const firstEntry = await translationCache.get("google", "en", "fr", "memoized text");
      const secondEntry = await translationCache.get("google", "en", "fr", "memoized text");

      expect(firstEntry?.translatedText).toBe("texte memo");
      expect(secondEntry).toEqual(firstEntry);
      expect(getSpy).toHaveBeenCalledTimes(1);
    } finally {
      getSpy.mockRestore();
    }
  });

  it("returns undefined when translationCache.get catches a cache query error", async () => {
    const translationCache = await importTranslationCache();
    const cache = await testHooks.cacheList.getCache("google", "en", "fr");

    vi.spyOn(cache, "query").mockRejectedValueOnce(new Error("query failed"));

    await expect(translationCache.get("google", "en", "fr", "boom")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("returns undefined when translationCache.set catches a cache add error", async () => {
    const translationCache = await importTranslationCache();
    const cache = await testHooks.cacheList.getCache("google", "en", "fr");

    vi.spyOn(cache, "add").mockRejectedValueOnce(new Error("add failed"));

    await expect(
      translationCache.set("google", "en", "fr", "hello", "bonjour", "en")
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("deletes legacy databases before clearing caches", async () => {
    const translationCache = await importTranslationCache();
    const originalDeleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
    const deleteSpy = vi
      .spyOn(indexedDB, "deleteDatabase")
      .mockImplementation((name) => originalDeleteDatabase(name));

    try {
      await translationCache.deleteTranslationCache(true);

      expect(deleteSpy).toHaveBeenCalledWith("googleCache");
      expect(deleteSpy).toHaveBeenCalledWith("yandexCache");
      expect(deleteSpy).toHaveBeenCalledWith("bingCache");
      expect(globalThis.chrome.runtime.reload).toHaveBeenCalledOnce();
    } finally {
      deleteSpy.mockRestore();
    }
  });

  it("responds with 0B when getCacheSize calculation rejects", async () => {
    await importTranslationCache();
    vi.spyOn(testHooks.cacheList, "calculateSize").mockRejectedValueOnce(new Error("size failed"));

    const sendResponse = vi.fn();
    const keepAlive = capturedMessageListener({ action: "getCacheSize" }, {}, sendResponse);

    await waitFor(() => sendResponse.mock.calls.length === 1);

    expect(keepAlive).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith("0B");
  });

  it("reloads when deleteTranslationCache is requested through the runtime listener", async () => {
    await importTranslationCache();

    capturedMessageListener({ action: "deleteTranslationCache", reload: true }, {}, vi.fn());
    await waitFor(() => globalThis.chrome.runtime.reload.mock.calls.length === 1);

    expect(globalThis.chrome.runtime.reload).toHaveBeenCalledOnce();
  });

  it("rejects querying a Cache without a database", async () => {
    await importTranslationCache();

    const cache = new testHooks.Cache("google", "en", "fr");

    await expect(cache.query("missing-db")).rejects.toBeUndefined();
  });

  it("returns false when adding to a Cache without a database", async () => {
    await importTranslationCache();

    const cache = new testHooks.Cache("google", "en", "fr");

    await expect(cache.add("hello", "bonjour", "en")).resolves.toBe(false);
  });

  it("resolves false and deletes the database when Cache.start fails", async () => {
    await importTranslationCache();

    const openSpy = vi.spyOn(testHooks.Cache, "openDataBaseCache").mockRejectedValueOnce(new Error("open failed"));
    const deleteSpy = vi.spyOn(testHooks.Cache, "deleteDatabase").mockResolvedValueOnce(true);
    const cache = new testHooks.Cache("google", "en", "fr");

    try {
      await expect(cache.start()).resolves.toBe(false);
      expect(deleteSpy).toHaveBeenCalledWith("google", "en", "fr");
    } finally {
      openSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });

  it("returns false when CacheList.deleteAll catches an unexpected error", async () => {
    await importTranslationCache();

    const result = await testHooks.CacheList.prototype.deleteAll.call({ list: null });

    expect(result).toBe(false);
  });

  it("returns 0 B when CacheList.calculateSize catches an unexpected error", async () => {
    await importTranslationCache();

    const originalDb = testHooks.cacheList.dbCacheList;
    testHooks.cacheList.dbCacheList = {
      transaction() {
        throw new Error("broken cacheList db");
      },
    };

    try {
      await expect(testHooks.cacheList.calculateSize()).resolves.toBe("0 B");
    } finally {
      testHooks.cacheList.dbCacheList = originalDb;
    }
  });

  it("rejects when Utils.getDatabaseSize cannot open the database", async () => {
    await importTranslationCache();

    const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request = {};
      setTimeout(() => {
        request.onerror?.({ type: "error" });
      }, 0);
      return request;
    });

    try {
      await expect(testHooks.Utils.getDatabaseSize("broken-db")).rejects.toBeUndefined();
    } finally {
      openSpy.mockRestore();
    }
  });
});
