/**
 * Shared Chrome API mock factory.
 *
 * Usage (in a test file):
 *   import { createMockChrome } from "../fixtures/chrome/mockChrome.js";
 *   beforeEach(() => { globalThis.chrome = createMockChrome(); });
 *   afterEach(() => { delete globalThis.chrome; });
 *
 * Each call returns a fresh mock so tests stay isolated.
 */
import { vi } from "vitest";

/**
 * In-memory storage backend shared by mockStorage helpers.
 * Supports `local`, `sync`, and `session` areas.
 */
export function createMockStorage() {
  const stores = { local: {}, sync: {}, session: {} };
  const listeners = [];

  function area(name) {
    const store = stores[name] || (stores[name] = {});
    return {
      get: vi.fn((keys, cb) => {
        const result = {};
        // 当 keys 为 null 或 undefined 时，返回所有存储的键（与 Chrome 行为一致）
        if (keys === null || keys === undefined) {
          Object.assign(result, store);
          if (typeof cb === "function") cb(result);
          return Promise.resolve(result);
        }
        const keyList = Array.isArray(keys)
          ? keys
          : typeof keys === "string"
            ? [keys]
            : typeof keys === "object"
              ? Object.keys(keys)
              : [];
        for (const k of keyList) {
          result[k] = k in store ? store[k] : (typeof keys === "object" && keys !== null ? keys[k] : undefined);
        }
        if (typeof cb === "function") cb(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items, cb) => {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: store[k], newValue: v };
          store[k] = v;
        }
        for (const fn of listeners) fn(changes, name);
        if (typeof cb === "function") cb();
        return Promise.resolve();
      }),
      remove: vi.fn((keys, cb) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) delete store[k];
        if (typeof cb === "function") cb();
        return Promise.resolve();
      }),
      clear: vi.fn((cb) => {
        for (const k of Object.keys(store)) delete store[k];
        if (typeof cb === "function") cb();
        return Promise.resolve();
      }),
      /** Direct access for test assertions */
      _store: store,
    };
  }

  return {
    local: area("local"),
    sync: area("sync"),
    session: area("session"),
    onChanged: {
      addListener: vi.fn((fn) => listeners.push(fn)),
      removeListener: vi.fn((fn) => {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      }),
      hasListener: vi.fn((fn) => listeners.includes(fn)),
    },
    /** Flush all stores (call in afterEach if desired) */
    _reset() {
      for (const s of Object.values(stores)) {
        for (const k of Object.keys(s)) delete s[k];
      }
      listeners.length = 0;
    },
  };
}

/**
 * Create a complete chrome.* mock object.
 * @param {object} [overrides] - Merge additional/overridden namespaces.
 */
export function createMockChrome(overrides = {}) {
  const storage = createMockStorage();
  const messageListeners = [];
  const installedListeners = [];
  const commandListeners = [];

  const chrome = {
    storage,

    runtime: {
      sendMessage: vi.fn((payload, cb) => {
        if (typeof cb === "function") cb();
        return Promise.resolve();
      }),
      onMessage: {
        addListener: vi.fn((fn) => messageListeners.push(fn)),
        removeListener: vi.fn((fn) => {
          const idx = messageListeners.indexOf(fn);
          if (idx !== -1) messageListeners.splice(idx, 1);
        }),
        hasListener: vi.fn((fn) => messageListeners.includes(fn)),
        /** Simulate an incoming message */
        _emit(message, sender, sendResponse) {
          for (const fn of messageListeners) fn(message, sender, sendResponse);
        },
      },
      onInstalled: {
        addListener: vi.fn((fn) => installedListeners.push(fn)),
        removeListener: vi.fn(),
      },
      getManifest: vi.fn(() => ({
        name: "DualTran",
        version: "1.0.0",
        homepage_url: "https://dualtran.example",
      })),
      getURL: vi.fn((path) => `chrome-extension://mock-id/${path}`),
      id: "mock-extension-id",
    },

    i18n: {
      getMessage: vi.fn((key) => key),
      getAcceptLanguages: vi.fn((cb) => {
        const langs = ["en"];
        if (typeof cb === "function") cb(langs);
        return Promise.resolve(langs);
      }),
    },

    tabs: {
      query: vi.fn((opts, cb) => {
        const tabs = [{ id: 1, url: "https://example.com", active: true }];
        if (typeof cb === "function") cb(tabs);
        return Promise.resolve(tabs);
      }),
      sendMessage: vi.fn((tabId, msg, cb) => {
        if (typeof cb === "function") cb();
        return Promise.resolve();
      }),
      create: vi.fn((opts, cb) => {
        const tab = { id: 2, ...opts };
        if (typeof cb === "function") cb(tab);
        return Promise.resolve(tab);
      }),
      executeScript: vi.fn((tabId, details, cb) => {
        if (typeof cb === "function") cb([]);
        return Promise.resolve([]);
      }),
    },

    commands: {
      onCommand: {
        addListener: vi.fn((fn) => commandListeners.push(fn)),
        removeListener: vi.fn(),
      },
      getAll: vi.fn((cb) => cb?.([])),
    },

    action: {
      setIcon: vi.fn(),
      setTitle: vi.fn(),
      setPopup: vi.fn(),
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },

    contextMenus: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeAll: vi.fn(),
      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },

    /** Helpers for tests — not part of real Chrome API */
    _listeners: {
      message: messageListeners,
      installed: installedListeners,
      command: commandListeners,
    },
  };

  return deepMerge(chrome, overrides);
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      typeof source[key] !== "function"
    ) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
