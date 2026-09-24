/**
 * sw.js 平台形态矩阵测试（P1, issue #88 — #85 逃逸复盘）
 *
 * sw.js 中的环境探测（`typeof chrome.contextMenus` / `chrome.action.openPopup` /
 * `chrome.pageAction.openPopup` / `browser` + `browser.theme` / `chrome.commands`）
 * 都是**形态敏感**代码：它们只在特定平台形态下取特定分支。#85 逃逸的根因正是
 * 「没有任何测试环境呈现过 Chrome 148+ 的 `browser` 别名形态」——本文件把真实
 * 平台形态逐一实例化，让每个探测点的每个分支都有测试执行。
 *
 * 形态定义（来源：真实 Chrome 151 探针 + Firefox MV3 API 文档）：
 *   A. Chrome 148+：`browser` 存在（`chrome` 别名）但**无** `browser.theme`、
 *      **无** `commands.update`；`chrome.pageAction` **不存在**；
 *      `chrome.action.openPopup` 存在。
 *   B. Chrome 无 action.openPopup（历史/边缘构建）：PDF 菜单退化为打开网站。
 *   C. Firefox：`browser.theme.getCurrent` 存在、`chrome.pageAction` 存在。
 *   D. 降级形态（chrome.commands / chrome.contextMenus 缺失）：导入不崩溃、
 *      对应监听器不注册。
 *
 * 断言强度：所有格均为无条件断言；`vi.waitFor` 只用于等待异步 onReady 链完成
 * （等待的谓词本身是断言），不构成条件断言。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 构造一个平台形态的 chrome 桩 + 监听器账本。
 * 回调风格与真实 MV3 API 一致（storage.get(keys, cb) / getAcceptLanguages(cb) /
 * commands.getAll(cb) / permissions.contains(perms, cb)）——这是 onReady 链能真正
 * 跑完的前提：任何一处桩只返回 Promise 而不调回调，config 加载就会永远挂起，
 * onReady 之后的全部接线（含本文件要覆盖的探测点）就都执行不到。
 */
function buildPlatformHarness({
  firefoxShape = false,
  withCommands = true,
  withContextMenus = true,
  withActionOpenPopup = true,
} = {}) {
  const listeners = {};
  function mockEvent(name) {
    return {
      addListener: vi.fn((fn) => {
        (listeners[name] = listeners[name] || []).push(fn);
      }),
    };
  }

  const storageData = { tabToMimeType: { 7: "application/pdf" } };

  const chromeStub = {
    runtime: {
      onMessage: mockEvent("runtime.onMessage"),
      onStartup: mockEvent("runtime.onStartup"),
      onInstalled: mockEvent("runtime.onInstalled"),
      onConnect: mockEvent("runtime.onConnect"),
      sendMessage: vi.fn(),
      getURL: vi.fn((p) => p),
      id: "test-id",
      lastError: null,
      getManifest: vi.fn(() => ({ version: "1.0", manifest_version: 3, commands: {} })),
    },
    tabs: {
      onActivated: mockEvent("tabs.onActivated"),
      onUpdated: mockEvent("tabs.onUpdated"),
      onRemoved: mockEvent("tabs.onRemoved"),
      query: vi.fn((_q, cb) => { cb?.([]); return Promise.resolve([]); }),
      sendMessage: vi.fn(),
      create: vi.fn((opts) => Promise.resolve({ id: 99, ...opts })),
      get: vi.fn(() => Promise.resolve({})),
      reload: vi.fn(),
    },
    action: {
      onClicked: mockEvent("action.onClicked"),
      setIcon: vi.fn(),
      setTitle: vi.fn(),
      setPopup: vi.fn(),
      getPopup: vi.fn(() => Promise.resolve("")),
      ...(withActionOpenPopup ? { openPopup: vi.fn(() => Promise.resolve()) } : {}),
    },
    alarms: { onAlarm: mockEvent("alarms.onAlarm"), create: vi.fn(), clear: vi.fn() },
    webRequest: { onHeadersReceived: mockEvent("webRequest") },
    webNavigation: {
      onCommitted: mockEvent("webNav.onCommitted"),
      onCompleted: mockEvent("webNav.onCompleted"),
      onDOMContentLoaded: mockEvent("webNav.onDOMContentLoaded"),
    },
    permissions: {
      onRemoved: mockEvent("permissions.onRemoved"),
      contains: vi.fn((_p, cb) => { cb?.(true); return Promise.resolve(true); }),
    },
    storage: {
      local: {
        get: vi.fn((_keys, cb) => { const r = { ...storageData }; if (typeof cb === "function") cb(r); return Promise.resolve(r); }),
        set: vi.fn((_v, cb) => { cb?.(); return Promise.resolve(); }),
      },
      onChanged: mockEvent("storage.onChanged"),
    },
    i18n: {
      getMessage: vi.fn((k) => k),
      getAcceptLanguages: vi.fn((cb) => { cb?.(["en"]); return Promise.resolve(["en"]); }),
      getUILanguage: vi.fn(() => "en"),
    },
    management: { getSelf: vi.fn(() => Promise.resolve({ installType: "development" })) },
    theme: { onUpdated: mockEvent("theme.onUpdated") },
  };

  if (withCommands) {
    chromeStub.commands = { onCommand: mockEvent("commands.onCommand"), getAll: vi.fn((cb) => cb?.([])) };
  }
  if (withContextMenus) {
    chromeStub.contextMenus = {
      onClicked: mockEvent("contextMenus.onClicked"),
      create: vi.fn((_cfg, cb) => { cb?.(); }),
      remove: vi.fn(),
      removeAll: vi.fn((cb) => cb?.()),
      update: vi.fn(),
    };
  }
  if (firefoxShape) {
    chromeStub.pageAction = {
      onClicked: mockEvent("pageAction.onClicked"),
      show: vi.fn(), hide: vi.fn(), setIcon: vi.fn(), setTitle: vi.fn(), setPopup: vi.fn(),
      openPopup: vi.fn(() => Promise.resolve()),
    };
    globalThis.browser = {
      theme: { getCurrent: vi.fn(() => Promise.resolve({ colors: { frame: "#111" } })) },
      commands: { update: vi.fn(), getAll: vi.fn() },
    };
  }

  vi.stubGlobal("chrome", chromeStub);
  vi.stubGlobal("self", { registration: { scope: "test" }, clients: { matchAll: vi.fn(() => Promise.resolve([])) } });
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}), ok: true })));
  // navigator 显式 stub：Node 22 有全局 navigator、Node 20（CI）没有——
  // sw.js 的 onReady 链会经 platformInfo.js 读 navigator.userAgent，
  // 不 stub 则 CI（Node 20）报 ReferenceError: navigator is not defined。
  // 显式 stub 让测试在两个 Node 版本上行为一致。
  if (typeof globalThis.navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36" },
    });
  }
  vi.stubGlobal("indexedDB", {
    open: vi.fn(() => {
      const r = { result: {}, set onsuccess(_) {}, set onerror(_) {}, set onupgradeneeded(_) {} };
      return r;
    }),
    deleteDatabase: vi.fn(),
  });
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn(() => Promise.resolve(new ArrayBuffer(20))) } });
  vi.stubGlobal("TextEncoder", class { encode(s) { return new Uint8Array(Array.from(s).map((c) => c.charCodeAt(0))); } });

  return { chromeStub, listeners };
}

/** 导入 sw.js 并等待全部 onReady 链完成（末个 onReady 块以 permissions.contains 引导收尾）。 */
async function importSwAndSettle(chromeStub) {
  await import("../../src/background/sw.js");
  await vi.waitFor(() => {
    expect(chromeStub.permissions.contains).toHaveBeenCalled();
  }, { timeout: 5000 });
}

/** 触发 contextMenus.onClicked 监听器（sw.js 在模块作用域注册的第一个）。 */
async function clickContextMenu(listeners, menuItemId, tab = { id: 7, url: "https://example.com/doc.pdf" }) {
  const handler = listeners["contextMenus.onClicked"]?.[0];
  await handler({ menuItemId, selectionText: "hello" }, tab);
  // sw.js 对 PDF 路径不 await 内部 promise；等微任务 + 定时器排空后再断言效果。
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("sw.js 平台形态矩阵（P1, issue #88）", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete globalThis.browser;
    vi.unstubAllGlobals();
  });

  it("Chrome 148+ shape: completes onReady wiring, skips the theme branch, registers command listener", async () => {
    const { chromeStub, listeners } = buildPlatformHarness();
    // Chrome 148+ 的真实形态：`browser` 存在（chrome 别名）但无 browser.theme。
    globalThis.browser = { commands: { getAll: vi.fn() } };

    await importSwAndSettle(chromeStub);

    const createIds = chromeStub.contextMenus.create.mock.calls.map(([cfg]) => cfg?.id);
    expect(createIds).toContain("pageAction-pdf-to-html");
    expect(createIds).toContain("translate-page-google");

    // browser.theme 不存在 → theme 分支整体跳过（Chrome 语义）
    expect(listeners["theme.onUpdated"]).toBeUndefined();
    // chrome.commands 存在 → 命令监听器已注册
    expect(listeners["commands.onCommand"]).toHaveLength(1);
  });

  it("Chrome shape without action.openPopup: browserAction PDF menu falls back to the website", async () => {
    const { chromeStub, listeners } = buildPlatformHarness({ withActionOpenPopup: false });
    globalThis.browser = { commands: { getAll: vi.fn() } };

    await importSwAndSettle(chromeStub);
    await clickContextMenu(listeners, "browserAction-pdf-to-html");

    expect(chromeStub.tabs.create).toHaveBeenCalledWith({ url: "https://translatewebpages.org/" });
  });

  it("Chrome shape with action.openPopup: browserAction PDF menu opens the popup", async () => {
    const { chromeStub, listeners } = buildPlatformHarness();
    globalThis.browser = { commands: { getAll: vi.fn() } };

    await importSwAndSettle(chromeStub);
    await clickContextMenu(listeners, "browserAction-pdf-to-html");

    expect(chromeStub.action.openPopup).toHaveBeenCalled();
    expect(chromeStub.tabs.create).not.toHaveBeenCalled();
  });

  it("Chrome shape: pageAction PDF menu path does not throw and falls back to the website (#88)", async () => {
    const { chromeStub, listeners } = buildPlatformHarness();
    globalThis.browser = { commands: { getAll: vi.fn() } };

    await importSwAndSettle(chromeStub);
    // Chrome 上 chrome.pageAction 完全不存在；本行曾无守护直接读属性 →
    // TypeError: Cannot read properties of undefined (reading 'openPopup')（同 #85 族）。
    await clickContextMenu(listeners, "pageAction-pdf-to-html");

    expect(chromeStub.tabs.create).toHaveBeenCalledWith({ url: "https://translatewebpages.org/" });
  });

  it("Firefox shape: reads the current theme and subscribes to theme updates", async () => {
    const { chromeStub, listeners } = buildPlatformHarness({ firefoxShape: true });

    await importSwAndSettle(chromeStub);
    await vi.waitFor(() => {
      expect(globalThis.browser.theme.getCurrent).toHaveBeenCalled();
    }, { timeout: 5000 });

    expect(listeners["theme.onUpdated"]).toHaveLength(1);
  });

  it("Firefox shape: pageAction PDF menu path opens the page-action popup (#88)", async () => {
    const { chromeStub, listeners } = buildPlatformHarness({ firefoxShape: true });

    await importSwAndSettle(chromeStub);
    await clickContextMenu(listeners, "pageAction-pdf-to-html");

    expect(chromeStub.pageAction.openPopup).toHaveBeenCalled();
    expect(chromeStub.tabs.create).not.toHaveBeenCalled();
  });

  it("Degraded shape without chrome.commands: no command listener is registered", async () => {
    const { chromeStub, listeners } = buildPlatformHarness({ withCommands: false });

    await importSwAndSettle(chromeStub);

    expect(listeners["commands.onCommand"]).toBeUndefined();
    // 模块其余接线不受影响
    expect(listeners["runtime.onMessage"]?.length).toBeGreaterThan(0);
  });

  it("Degraded shape without chrome.contextMenus: no menus are created", async () => {
    const { chromeStub, listeners } = buildPlatformHarness({ withContextMenus: false });

    await importSwAndSettle(chromeStub);

    expect(listeners["contextMenus.onClicked"]).toBeUndefined();
    expect(listeners["runtime.onMessage"]?.length).toBeGreaterThan(0);
  });
});
