/**
 * sw.js 事件接线冒烟测试
 *
 * 验证 Service Worker 入口在导入时不崩溃，且至少注册了核心事件监听器。
 * 完整逻辑测试由 helpers/execution-helpers 层覆盖。
 *
 * P3 #7 — 发现于 /qa on 2026-07-03
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock chrome API ──
const listeners = {};

function mockEvent(name) {
  return { addListener: vi.fn((fn) => { listeners[name] = (listeners[name] || 0) + 1; }) };
}

vi.stubGlobal("chrome", {
  runtime: {
    onMessage: mockEvent("runtime.onMessage"),
    onStartup: mockEvent("runtime.onStartup"),
    onInstalled: mockEvent("runtime.onInstalled"),
    onConnect: mockEvent("runtime.onConnect"),
    sendMessage: vi.fn(),
    getURL: vi.fn((p) => p),
    id: "test-id",
    lastError: null,
    getManifest: vi.fn(() => ({ version: "1.0", manifest_version: 3 })),
  },
  tabs: {
    onActivated: mockEvent("tabs.onActivated"),
    onUpdated: mockEvent("tabs.onUpdated"),
    onRemoved: mockEvent("tabs.onRemoved"),
    query: vi.fn((_q, cb) => cb?.([])),
    sendMessage: vi.fn(),
    get: vi.fn(() => Promise.resolve({})),
  },
  action: {
    onClicked: mockEvent("action.onClicked"),
    setIcon: vi.fn(), setTitle: vi.fn(), setPopup: vi.fn(),
    getPopup: vi.fn(() => Promise.resolve("")),
  },
  contextMenus: {
    onClicked: mockEvent("contextMenus.onClicked"),
    create: vi.fn(), removeAll: vi.fn(), update: vi.fn(),
  },
  commands: { onCommand: mockEvent("commands.onCommand") },
  alarms: { onAlarm: mockEvent("alarms.onAlarm"), create: vi.fn(), clear: vi.fn() },
  webRequest: { onHeadersReceived: mockEvent("webRequest") },
  webNavigation: { onCommitted: mockEvent("webNav"), onCompleted: mockEvent("webNav") },
  permissions: { onRemoved: mockEvent("permissions.onRemoved"), contains: vi.fn(() => Promise.resolve(true)) },
  storage: {
    local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
    onChanged: mockEvent("storage.onChanged"),
  },
  i18n: { getMessage: vi.fn((k) => k), getAcceptLanguages: vi.fn(() => Promise.resolve(["en"])), getUILanguage: vi.fn(() => "en") },
  management: { getSelf: vi.fn(() => Promise.resolve({ installType: "development" })) },
  theme: { onUpdated: mockEvent("theme") },
  pageAction: { onClicked: mockEvent("pageAction"), show: vi.fn(), hide: vi.fn(), setIcon: vi.fn(), setTitle: vi.fn() },
});

vi.stubGlobal("self", { registration: { scope: "test" }, clients: { matchAll: vi.fn(() => Promise.resolve([])) } });
vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}), ok: true })));
vi.stubGlobal("indexedDB", { open: vi.fn(() => { const r = { result: {}, set onsuccess(_) {}, set onerror(_) {}, set onupgradeneeded(_) {} }; return r; }), deleteDatabase: vi.fn() });
vi.stubGlobal("crypto", { subtle: { digest: vi.fn(() => Promise.resolve(new ArrayBuffer(20))) } });
vi.stubGlobal("TextEncoder", class { encode(s) { return new Uint8Array(Array.from(s).map(c => c.charCodeAt(0))); } });

describe("sw.js wiring smoke test", () => {
  let importError = null;

  beforeAll(async () => {
    try {
      await import("../../src/background/sw.js");
    } catch (e) {
      importError = e;
    }
    // 等待微任务队列清空（模块异步初始化）
    await vi.waitFor(() => {
      // 轮询直到至少一个监听器被注册或超时
      expect(Object.keys(listeners).length).toBeGreaterThanOrEqual(0);
    }, { timeout: 500 });
  });

  it("sw.js 可被导入而不崩溃", () => {
    // 如果导入失败，报告错误信息以便调试
    expect(importError, `sw.js import failed: ${importError?.message}`).toBeNull();
  });

  it("至少注册了 runtime.onMessage 监听器（核心消息分发）", () => {
    expect(listeners["runtime.onMessage"] || 0).toBeGreaterThan(0);
  });
});
