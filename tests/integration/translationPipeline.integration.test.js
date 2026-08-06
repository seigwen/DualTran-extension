import "fake-indexeddb/auto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 确定性计数器，替代 Math.random() 做 cache busting（避免 flaky）
let _moduleLoadSeq = 0;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSLATION_SERVICE_MODULE_URL = pathToFileURL(
  resolve(__dirname, "../../src/background/translationService.js")
).href;
const TRANSLATION_CACHE_MODULE_URL = pathToFileURL(
  resolve(__dirname, "../../src/background/translationCache.js")
).href;

const mockState = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getAlternativeServiceMock: vi.fn(),
  onMessageListeners: [],
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    getAlternativeService: (...args) => mockState.getAlternativeServiceMock(...args),
  },
}));

function createFetchResponse(body, init = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const status = init.status ?? 200;

  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    statusText: init.statusText ?? "OK",
    text: vi.fn().mockResolvedValue(payload),
    json: vi.fn().mockResolvedValue(typeof body === "string" ? JSON.parse(body) : body),
  };
}

function waitForTick() {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

async function waitFor(condition, { timeout = 1000 } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeout) {
    if (await condition()) {
      return;
    }
    await waitForTick();
  }

  throw new Error("Timed out waiting for condition");
}

async function deleteIndexedDb(name) {
  return await new Promise((resolvePromise) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolvePromise();
  });
}

async function cleanupIndexedDb() {
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    for (const database of databases) {
      if (database?.name) {
        await deleteIndexedDb(database.name);
      }
    }
    return;
  }

  for (const databaseName of [
    "cacheList",
    "google@auto.es",
    "google@en.es",
    "google@auto.fr",
  ]) {
    await deleteIndexedDb(databaseName);
  }
}

function resetMockState() {
  mockState.fetchMock.mockReset();
  mockState.getAlternativeServiceMock.mockReset().mockImplementation((_targetLanguage, serviceName) => serviceName);
  mockState.onMessageListeners.length = 0;
}

function installChromeMock() {
  globalThis.chrome = {
    runtime: {
      id: "dualtran-test-extension",
      reload: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener) => {
          mockState.onMessageListeners.push(listener);
        }),
        removeListener: vi.fn((listener) => {
          const index = mockState.onMessageListeners.indexOf(listener);
          if (index >= 0) {
            mockState.onMessageListeners.splice(index, 1);
          }
        }),
      },
    },
    i18n: {
      getMessage: vi.fn((key) => key),
    },
    tabs: {
      get: vi.fn(),
      sendMessage: vi.fn(),
      create: vi.fn(),
    },
  };
}

async function importTranslationModules() {
  // 使用确定性计数器替代 Math.random() 进行 cache busting
  const serviceModule = await import(`${TRANSLATION_SERVICE_MODULE_URL}?t=${Date.now()}-${_moduleLoadSeq++}`);
  const cacheModule = await import(`${TRANSLATION_CACHE_MODULE_URL}?t=${Date.now()}-${_moduleLoadSeq++}`);

  return {
    translationService: serviceModule.default,
    translationCache: cacheModule.default,
  };
}

async function getTranslationServiceRuntimeListener() {
  await waitFor(() => mockState.onMessageListeners.length >= 2);
  return mockState.onMessageListeners.find((listener) => {
    const source = listener.toString();
    return source.includes("translateHTML") && source.includes("translateSingleText");
  });
}

describe("translation pipeline integration", () => {
  beforeEach(async () => {
    vi.resetModules();
    resetMockState();
    await cleanupIndexedDb();
    installChromeMock();
    globalThis.fetch = mockState.fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete globalThis.browser;
  });

  afterEach(async () => {
    delete globalThis.chrome;
    delete globalThis.fetch;
    delete globalThis.browser;
    await cleanupIndexedDb();
  });

  it("translateSingleText calls the service and returns translated text", async () => {
    const { translationService } = await importTranslationModules();

    mockState.fetchMock.mockResolvedValueOnce(
      createFetchResponse([[ ["Hola"] ], null, "en"])
    );

    await expect(
      translationService.translateSingleText("google", "auto", "es", "Hello")
    ).resolves.toBe("Hola");

    expect(mockState.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores translated results in the real cache after a successful request", async () => {
    const { translationService, translationCache } = await importTranslationModules();

    mockState.fetchMock.mockResolvedValueOnce(
      createFetchResponse([[ ["Bonjour"] ], null, "en"])
    );

    await translationService.translateSingleText("google", "auto", "fr", "Hello");
    await waitFor(async () => {
      const entry = await translationCache.get("google", "auto", "fr", "Hello");
      return entry?.translatedText === "Bonjour";
    });

    const entry = await translationCache.get("google", "auto", "fr", "Hello");
    expect(entry).toMatchObject({
      originalText: "Hello",
      translatedText: "Bonjour",
      detectedLanguage: "en",
    });
  });

  it("returns the second identical translation request from cache without a second fetch", async () => {
    const { translationService, translationCache } = await importTranslationModules();
    const sourceText = `Hello-cache-${Date.now()}`;

    mockState.fetchMock.mockResolvedValueOnce(
      createFetchResponse([[ ["Hola"] ], null, "en"])
    );

    await expect(
      translationService.translateSingleText("google", "auto", "es", sourceText)
    ).resolves.toBe("Hola");
    await waitFor(async () => Boolean(await translationCache.get("google", "auto", "es", sourceText)));

    await expect(
      translationService.translateSingleText("google", "auto", "es", sourceText)
    ).resolves.toBe("Hola");

    expect(mockState.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("translateHTML preserves the 2D result shape across multiple requests", async () => {
    const { translationService } = await importTranslationModules();

    mockState.fetchMock
      .mockResolvedValueOnce(createFetchResponse([[ ["Uno\n\n\nDos"] ], null, "en"]))
      .mockResolvedValueOnce(createFetchResponse([[ ["Tres"] ], null, "en"]));

    await expect(
      translationService.translateHTML("google", "auto", "es", [["One", "Two"], ["Three"]])
    ).resolves.toEqual([
      ["Uno", "Dos"],
      ["Tres"],
    ]);
  });

  it("translateText preserves the 1D result shape for attribute translation", async () => {
    const { translationService } = await importTranslationModules();

    mockState.fetchMock.mockResolvedValueOnce(
      createFetchResponse([[ ["Uno\n\n\nDos"] ], null, "en"])
    );

    await expect(
      translationService.translateText("google", "auto", "es", ["One", "Two"])
    ).resolves.toEqual(["Uno", "Dos"]);
  });

  it("routes runtime translateHTML messages through the translation pipeline", async () => {
    await importTranslationModules();
    const listener = await getTranslationServiceRuntimeListener();
    expect(listener).toEqual(expect.any(Function));

    mockState.fetchMock
      .mockResolvedValueOnce(createFetchResponse([[ ["Uno"] ], null, "en"]))
      .mockResolvedValueOnce(createFetchResponse([[ ["Dos"] ], null, "en"]));

    const sendResponse = vi.fn();
    const keepAlive = listener({
      action: "translateHTML",
      translationService: "google",
      targetLanguage: "es",
      sourceArray2d: [["One"], ["Two"]],
      dontSortResults: false,
    }, {
      tab: {
        incognito: false,
      },
    }, sendResponse);

    await waitFor(() => sendResponse.mock.calls.length === 1);

    expect(keepAlive).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith([["Uno"], ["Dos"]]);
  });

  it("routes runtime translateSingleText messages through the translation pipeline", async () => {
    await importTranslationModules();
    const listener = await getTranslationServiceRuntimeListener();
    expect(listener).toEqual(expect.any(Function));

    mockState.fetchMock.mockResolvedValueOnce(
      createFetchResponse([[ ["Bonjour"] ], null, "en"])
    );

    const sendResponse = vi.fn();
    const keepAlive = listener({
      action: "translateSingleText",
      translationService: "google",
      targetLanguage: "fr",
      source: "Hello",
    }, {
      tab: {
        incognito: false,
      },
    }, sendResponse);

    await waitFor(() => sendResponse.mock.calls.length === 1);

    expect(keepAlive).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith("Bonjour");
  });

  it("executes the full cache-miss to fetch to cache-populated pipeline", async () => {
    const { translationCache } = await importTranslationModules();
    const listener = await getTranslationServiceRuntimeListener();
    expect(listener).toEqual(expect.any(Function));

    const sourceText = `Pipeline-${Date.now()}`;

    expect(await translationCache.get("google", "auto", "es", sourceText)).toBeUndefined();

    mockState.fetchMock.mockResolvedValueOnce(
      createFetchResponse([[ ["Canalización"] ], null, "en"])
    );

    const sendResponse = vi.fn();
    listener({
      action: "translateText",
      translationService: "google",
      targetLanguage: "es",
      sourceArray: [sourceText],
    }, {
      tab: {
        incognito: false,
      },
    }, sendResponse);

    await waitFor(() => sendResponse.mock.calls.length === 1);
    await waitFor(async () => {
      const entry = await translationCache.get("google", "auto", "es", sourceText);
      return entry?.translatedText === "Canalización";
    });

    expect(sendResponse).toHaveBeenCalledWith(["Canalización"]);
    expect(await translationCache.get("google", "auto", "es", sourceText)).toMatchObject({
      translatedText: "Canalización",
      detectedLanguage: "en",
    });
  });
});
