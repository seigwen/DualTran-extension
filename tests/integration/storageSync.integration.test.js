import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let _moduleLoadSeq = 0; // 确定性 cache-busting（替代 Math.random()）

const __dirname = dirname(fileURLToPath(import.meta.url));
const configModuleUrl = pathToFileURL(resolve(__dirname, "../../src/lib/config.js")).href;

const { mockState, normalizeLanguageCode } = vi.hoisted(() => ({
  mockState: {
    acceptedLanguages: ["en", "es"],
    storageData: {},
    storageListeners: [],
    storageDispatches: [],
  },
  normalizeLanguageCode: (lang) => {
    if (!lang) return lang;
    const map = {
      "en-US": "en",
      "en-GB": "en",
      "zh-CN": "zh-CN",
      "pt-BR": "pt",
    };
    return map[lang] ?? lang;
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: vi.fn((lang) => normalizeLanguageCode(lang)),
    otherConfigs: {},
  },
}));

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function valuesAreEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resetMockState() {
  mockState.acceptedLanguages = ["en", "es"];
  mockState.storageData = {};
  mockState.storageListeners = [];
  mockState.storageDispatches = [];
}

function emitStorageChanges(changes, areaName = "local") {
  const clonedChanges = {};

  Object.entries(changes).forEach(([name, change]) => {
    clonedChanges[name] = {
      oldValue: cloneValue(change.oldValue),
      newValue: cloneValue(change.newValue),
    };
    mockState.storageData[name] = cloneValue(change.newValue);
  });

  queueMicrotask(() => {
    mockState.storageListeners.forEach((listener, index) => {
      mockState.storageDispatches.push({ index, areaName, changes: cloneValue(clonedChanges) });
      listener(cloneValue(clonedChanges), areaName);
    });
  });
}

function installChromeMock() {
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((keys, callback) => {
          callback(cloneValue(mockState.storageData));
        }),
        set: vi.fn((payload, callback) => {
          const changes = {};

          Object.entries(payload).forEach(([name, value]) => {
            const previousValue = mockState.storageData[name];
            if (!valuesAreEqual(previousValue, value)) {
              changes[name] = {
                oldValue: cloneValue(previousValue),
                newValue: cloneValue(value),
              };
              mockState.storageData[name] = cloneValue(value);
            }
          });

          if (typeof callback === "function") {
            callback();
          }

          if (Object.keys(changes).length > 0) {
            emitStorageChanges(changes, "local");
          }
        }),
      },
      onChanged: {
        addListener: vi.fn((listener) => {
          mockState.storageListeners.push(listener);
        }),
      },
    },
    i18n: {
      getAcceptLanguages: vi.fn((callback) => {
        callback([...mockState.acceptedLanguages]);
      }),
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: "1.2.3", commands: {} })),
      reload: vi.fn(),
    },
  };
}

async function waitForSync() {
  await Promise.resolve();
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

async function importConfigContext() {
  vi.resetModules();
  const module = await import(`${configModuleUrl}?context=${_moduleLoadSeq++}`);
  await module.default.onReady();
  return module.default;
}

async function createSyncedContexts() {
  const contextA = await importConfigContext();
  const contextB = await importConfigContext();
  return { contextA, contextB };
}

describe("storage sync integration", () => {
  beforeEach(() => {
    resetMockState();
    installChromeMock();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete globalThis.browser;
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.browser;
  });

  it("dispatches storage.onChanged into the peer context when context A calls set", async () => {
    const { contextA } = await createSyncedContexts();

    contextA.set("pageTranslatorService", "bing");
    await waitForSync();

    expect(mockState.storageDispatches).toHaveLength(2);
    expect(mockState.storageDispatches[1]).toMatchObject({
      areaName: "local",
      changes: {
        pageTranslatorService: {
          newValue: "bing",
        },
      },
    });
  });

  it("fires peer-context observers with the synchronized new value", async () => {
    const { contextA, contextB } = await createSyncedContexts();
    const observerB = vi.fn();

    contextB.onChanged(observerB);
    contextA.set("pageTranslatorService", "yandex");
    await waitForSync();

    expect(observerB).toHaveBeenCalledWith("pageTranslatorService", "yandex");
  });

  it("updates context B get() results after a synchronized write", async () => {
    const { contextA, contextB } = await createSyncedContexts();

    contextA.set("pageTranslatorService", "microsoft");
    await waitForSync();

    expect(contextB.get("pageTranslatorService")).toBe("microsoft");
  });

  it("serializes customDictionary as an object and restores a Map in the peer context", async () => {
    const { contextA, contextB } = await createSyncedContexts();
    const customDictionary = new Map([
      ["hello", "你好"],
      ["world", "世界"],
    ]);

    contextA.set("customDictionary", customDictionary);
    await waitForSync();

    expect(globalThis.chrome.storage.local.set).toHaveBeenLastCalledWith(
      {
        customDictionary: {
          hello: "你好",
          world: "世界",
        },
      }
    );
    expect(contextB.get("customDictionary")).toBeInstanceOf(Map);
    expect([...contextB.get("customDictionary").entries()]).toEqual([
      ["hello", "你好"],
      ["world", "世界"],
    ]);
  });

  it("synchronizes array values such as alwaysTranslateSites", async () => {
    const { contextA, contextB } = await createSyncedContexts();

    contextA.set("alwaysTranslateSites", ["docs.example.com", "app.example.com"]);
    await waitForSync();

    expect(contextB.get("alwaysTranslateSites")).toEqual(["docs.example.com", "app.example.com"]);
  });

  it("synchronizes string values such as pageTranslatorService", async () => {
    const { contextA, contextB } = await createSyncedContexts();

    contextA.set("pageTranslatorService", "deepl");
    await waitForSync();

    expect(contextB.get("pageTranslatorService")).toBe("deepl");
  });

  it("does not notify the peer context twice when the same value is written twice", async () => {
    const { contextA, contextB } = await createSyncedContexts();
    const observerB = vi.fn();

    contextB.onChanged(observerB);
    contextA.set("pageTranslatorService", "bing");
    await waitForSync();
    contextA.set("pageTranslatorService", "bing");
    await waitForSync();

    expect(observerB).toHaveBeenCalledTimes(1);
    expect(observerB).toHaveBeenCalledWith("pageTranslatorService", "bing");
  });

  it("propagates multiple changed keys from one storage update into the peer context", async () => {
    const { contextB } = await createSyncedContexts();
    const observerB = vi.fn();

    contextB.onChanged(observerB);
    emitStorageChanges({
      pageTranslatorService: {
        oldValue: "google",
        newValue: "bing",
      },
      alwaysTranslateSites: {
        oldValue: [],
        newValue: ["batch.example.com"],
      },
    });
    await waitForSync();

    expect(contextB.get("pageTranslatorService")).toBe("bing");
    expect(contextB.get("alwaysTranslateSites")).toEqual(["batch.example.com"]);
    expect(observerB).toHaveBeenNthCalledWith(1, "pageTranslatorService", "bing");
    expect(observerB).toHaveBeenNthCalledWith(2, "alwaysTranslateSites", ["batch.example.com"]);
  });
});
