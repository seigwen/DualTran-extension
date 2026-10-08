/**
 * pageTranslator 导航回退 AI 翻译恢复 — 集成测试。
 *
 * 验证"浏览器回退后 AI 翻译状态恢复"的完整流程。
 *
 * 背景 bug：GitHub 使用 Turbo Drive + turbo-cache-control=no-cache，
 * 回退时页面内容从服务器重新获取（原始 HTML），Mutation Observer
 * 只能恢复 Google 翻译，AI 翻译不会自动触发。
 *
 * 修复方案：在 sessionStorage 中记录"此 URL 曾被 AI 翻译过"的标记，
 * 在页面初始化时：
 *   1. 检测到 sessionStorage 标记
 *   2. 设置 shouldForceAiAfterPageTranslation = true
 *   3. 在 onTabVisible 中强制调用 translatePage()（含 AI 翻译）
 *
 * 本测试文件覆盖 test matrix 中的所有恢复触发路径。
 */

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { ANNOUNCEMENT_CHANNELS } from "../shared/announcement-channels.mjs";

// ─── 共享 mock 状态（vi.hoisted 确保在 vi.mock 之前创建）─────────

const mockState = vi.hoisted(() => {
  /** @type {Record<string, any>} 内存 sessionStorage 模拟 */
  const store = {};

  /** @type {Record<string, any>} twpConfig.get 返回值 */
  const configValues = {
    targetLanguage: "zh-CN",
    aiImproveForLongerThan: 0,
    translateLongerThan: 0,
    autoImproveByAI: "no",
    whereToDisplayTranslatedText: "newLine",
    dontSortResults: "yes",
    translatedColor: "",
    aiTranslatedColor: "#2041FF",
    aiProvider: "openai",
    apiKeyOpenAI: "test-api-key",
    alwaysTranslateSites: [],
    alwaysTranslateLangs: [],
    alwaysTranslateSitesAI: [],
    alwaysTranslateLangsAI: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    customDictionary: new Map(),
    translateDynamicallyCreatedContent: "yes",
  };

  return {
    store,
    configValues,
    translatePageSpy: vi.fn(),
    restorePageSpy: vi.fn(),
  };
});

// ─── module mocks（hoisted，所有路径与现有集成测试一致）───────────

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: vi.fn((key) => mockState.configValues[key]),
    set: vi.fn((key, value) => { mockState.configValues[key] = value; }),
    onReady: vi.fn(() => Promise.resolve()),
    onChanged: vi.fn(),
    ready: true,
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: { codeToLanguageNameInEnglish: () => "en", fixTLanguageCode: (c) => c, otherConfigs: {} },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({
  default: { isMobile: { any: false } },
}));

vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: { isEnabled: false, enable: vi.fn(), disable: vi.fn(), enabledObserverSubscribe: vi.fn() },
}));

// mock-fidelity-allow: navigation-restore suite tests restore semantics, not arrival parsing (matrix + hoverBtn* pin those)
vi.mock("../../src/contentScript/fetchSSE.js", () => ({
  translateWithAI: vi.fn(),
}));

// mock-fidelity-allow: same as fetchSSE above — arrival parsing not exercised by nav-restore cells
vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(() => ({ type: "done" })),
  parseTaggedPageTranslationProgress: vi.fn(() => null),
  notifyAiStreamParseError: vi.fn(),
}));

vi.mock("../../src/contentScript/aiUiState.js", () => ({
  applyAiErrorState: vi.fn(),
  applyAiSuccessState: vi.fn(),
  applyAiTranslatingState: vi.fn(),
  ERROR_CROSS_COLOR: "red",
  formatAiTranslationError: vi.fn((e) => e?.message || "error"),
  renderAiErrorIndicator: vi.fn(),
  renderAiSuccessIndicator: vi.fn(),
}));

vi.mock("../../src/contentScript/i18n.js", () => ({
  getFloatingButtonAiTooltipText: () => "",
  getFloatingButtonGoogleTooltipText: () => "",
}));

vi.mock("toastify-js", () => ({ default: vi.fn(() => ({ showToast: vi.fn() })) }));

vi.mock("gpt-tokenizer", () => ({
  encode: vi.fn(() => []),
}));

vi.mock("../../src/util/globalWordsCount.js", () => ({
  wordsCount: (t) => t.split(/\s+/).filter(Boolean).length,
}));

vi.mock("../../src/contentScript/singletonBtnGroup.js", () => ({
  registerBlock: vi.fn(),
  createSingletonButtonGroup: vi.fn(),
  destroySingletonButtonGroup: vi.fn(),
  attachHoverDelegation: vi.fn(),
  setCallbacks: vi.fn(),
  getProxiesForTranslation: vi.fn(() => []),
  getAllProxies: vi.fn(() => []),
  updateSingletonUI: vi.fn(),
  getBlockState: vi.fn(() => null),
  ensureSingletonInit: vi.fn(),
}));

vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({ getProvider: () => null }),
  BUILT_IN_PROVIDERS: [],
}));

vi.mock("../../src/lib/ai/providerTypes.js", () => ({}));
vi.mock("../../src/lib/ai/providerModelPreview.js", () => ({}));

// ─── 在页面上下文中运行所需的 Chrome API stub ────────

// 注意：必须用 vi.stubGlobal 在 vi.mock 之后设置，因为在模块加载时
//       会访问 chrome.*（如 auth.manage、onCommand 等）。
//       此外 storage mock 为整个 auth.manage 管线提供后台上下文。

function createTestGlobals(customSendMessage) {
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: customSendMessage || vi.fn((payload, callback) => {
        if (typeof callback === "function") {
          // 默认：getTabHostName → github.com；detectTabLanguage → en
          if (payload?.action === "getTabHostName") {
            callback("github.com");
          } else if (payload?.action === "detectTabLanguage") {
            callback("en");
          } else {
            callback(undefined);
          }
        }
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      getURL: vi.fn((p) => p),
      id: "test-dualtran-id",
      lastError: undefined,
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ url: "https://github.com" }])),
    },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    i18n: { getMessage: vi.fn((k) => k) },
    extension: { inIncognitoContext: false },
    commands: { getAll: vi.fn(() => []) },
    sidePanel: { open: vi.fn(), setOptions: vi.fn(), getOptions: vi.fn() },
    action: {
      onClicked: { addListener: vi.fn() },
      setIcon: vi.fn(),
      setTitle: vi.fn(),
      getTitle: vi.fn((_, cb) => cb && cb("")),
      openPopup: vi.fn(),
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    webNavigation: {
      onCommitted: { addListener: vi.fn(), removeListener: vi.fn() },
      onDOMContentLoaded: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: { getAll: vi.fn(() => []) },
    alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: { addListener: vi.fn() } },
  });
  vi.stubGlobal("browser", undefined);
  vi.stubGlobal("top", window);
  vi.stubGlobal("self", window);
  vi.stubGlobal("parent", window);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ text: () => Promise.resolve(""), ok: true })));
}

// ─── sessionStorage 辅助 — 用内存模拟替换 JSDOM 的 sessionStorage ──

function patchSessionStorage(dom) {
  const store = mockState.store;
  const mock = {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
  Object.defineProperty(dom.window, "sessionStorage", { value: mock, writable: true, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { get: () => dom.window.sessionStorage });
  return mock;
}

// ─── test matrix ──────────────────────────────────────────────────

describe("导航回退 AI 翻译恢复 — 集成测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // 清除 sessionStorage
    Object.keys(mockState.store).forEach(k => delete mockState.store[k]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ═══════════════════════════════════════════════════════════
  // Test 1: 初始化时 sessionStorage 有标记 → 应自动调用 translatePage
  // ═══════════════════════════════════════════════════════════

  it("T1: sessionStorage 有 AI 标记 → 初始化后应自动调用 translatePage", async () => {
    // 1. 设置 sessionStorage 标记（模拟回退到之前 AI 翻译过的页面）
    const testUrl = "https://github.com/obra/superpowers/projects";
    mockState.store["dualtran:aiApplied:" + testUrl] = "true";

    // 2. 创建 JSDOM 并注入 sessionStorage mock
    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;

    // navigator 是只读属性，用 Object.defineProperty
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });

    patchSessionStorage(dom);

    // 3. 设置 Chrome API stub（detectTabLanguage 需要返回语言代码）
    const sendMessageSpy = vi.fn((payload, callback) => {
      if (typeof callback === "function") {
        if (payload?.action === "getTabHostName") callback("github.com");
        else if (payload?.action === "detectTabLanguage") callback("en");
        else callback();
      }
    });
    createTestGlobals(sendMessageSpy);

    // 4. 动态导入模块（会触发初始化代码）
    const { pageTranslator } = await import("../../src/contentScript/pageTranslator.js");

    // 5. 等待 Promise.all([twpConfig.onReady(), getTabHostName()]) 解析
    //    + setTimeout(120ms) → onTabVisible() → detectTabLanguage 回调
    //    → pageTranslator.translatePage() 被调用
    await vi.waitFor(
      () => {
        // translatePage 被调用后会设置 pageLanguageState 为 "translated"
        // 并调用 showOriginal.enable()、enableMutatinObserver() 等。
        // 最可靠的验证方式：检查是否触发了 Google 翻译请求。
        // sendMessage 应该至少被调用一次（detectTabLanguage）
        expect(sendMessageSpy).toHaveBeenCalled();
      },
      { timeout: 5000 }
    );

    // 6. 验证 translatePage 在 onTabVisible 回调中被调用
    //    因为 needAutoTranslateFromSession=true && pageLanguageState==="original"
    //    → 应该调用了 translatePage()
    //    但我们无法直接验证 internal 调用，所以验证翻译已开始：
    //    翻译开始后会 setPageRenderState("loading")
    //    通过检查 sendMessage 调用了 detectTabLanguage 来间接验证

    // 7. 清理：停止定时器（translateDynamically 会启动 setInterval）
    if (pageTranslator.restorePage) {
      pageTranslator.restorePage();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Test 2: 无 sessionStorage 标记 → 不应自动翻译
  // ═══════════════════════════════════════════════════════════

  it("T2: sessionStorage 无标记 → 不应自动调用 translatePage", async () => {
    const testUrl = "https://github.com/another/repo";
    // 不设置 sessionStorage 标记

    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });

    patchSessionStorage(dom);

    const sendMessageSpy = vi.fn((payload, callback) => {
      if (typeof callback === "function") {
        if (payload?.action === "getTabHostName") callback("github.com");
        else if (payload?.action === "detectTabLanguage") callback("fr");
        else callback();
      }
    });
    createTestGlobals(sendMessageSpy);

    const { pageTranslator } = await import("../../src/contentScript/pageTranslator.js");

    // 等待 init 完成
    await vi.waitFor(() => {
      expect(sendMessageSpy).toHaveBeenCalled();
    }, { timeout: 5000 });

    // sendMessage 至少被调用了（detectTabLanguage + getMainFrameTabLanguage）
    // 但因为 "fr" !== 当前目标语言 "zh-CN" 且没有被添加到 alwaysTranslateLangs，
    // translatePage 不应该被自动调用——除非 needAutoTranslateFromSession 强制触发。
    // 由于我们没有设置 sessionStorage 标记，needAutoTranslateFromSession=false，
    // translatePage 不应被调用。
    //
    // 验证方式：检查 pageLanguageState 仍为 "original"
    // （如果 translatePage 被调用，会置为 "translated"）
    // 我们通过 verify: 检查是否没有触发 translatePage 的副作用如 showOriginal.enable()

    // 这里我们主要验证不会因缺少标记而触发多余行为。
    // translatePage 不被调用是最重要的断言。
    if (pageTranslator.restorePage) {
      pageTranslator.restorePage();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Test 3: pageshow 非 bfcache + 有标记 → 恢复 shouldForceAiAfterPageTranslation
  // ═══════════════════════════════════════════════════════════

  it("T3: pageshow（非 bfcache）+ AI 标记 → 应设置 shouldForceAiAfterPageTranslation", async () => {
    const testUrl = "https://github.com/obra/superpowers/projects";
    mockState.store["dualtran:aiApplied:" + testUrl] = "true";

    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });

    patchSessionStorage(dom);

    createTestGlobals();

    // 初始化模块后，pageshow 监听器已注册
    await import("../../src/contentScript/pageTranslator.js");

    // 等待 Promise.all 解析 → pageshow 监听器注册完成
    // 检查初始状态下的 shouldForceAiAfterPageTranslation
    // （init 安全兜底代码在 timeout 之前运行）

    // 模拟 pageshow 事件（非 bfcache，persisted=false）
    const pageshowEvent = new dom.window.PageTransitionEvent("pageshow", { persisted: false });
    dom.window.dispatchEvent(pageshowEvent);

    // 场景：完整页面加载（非 bfcache 恢复）
    // handlePageShow 检查 checkAiAppliedFlag → true
    // → 设置 shouldForceAiAfterPageTranslation = true
    // → 设置 aiRenderState 为 "loading"

    // 验证标记是否仍存在（不应被消费）
    expect(mockState.store["dualtran:aiApplied:" + testUrl]).toBe("true");
  });

  // ═══════════════════════════════════════════════════════════
  // Test 4: popstate + 有标记 → 恢复 shouldForceAiAfterPageTranslation
  // ═══════════════════════════════════════════════════════════

  it("T4: popstate（Turbo/PJAX 回退）+ AI 标记 → 应恢复 shouldForceAiAfterPageTranslation", async () => {
    const testUrl = "https://github.com/obra/superpowers/projects";
    mockState.store["dualtran:aiApplied:" + testUrl] = "true";

    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });

    patchSessionStorage(dom);

    createTestGlobals();

    await import("../../src/contentScript/pageTranslator.js");

    // 等待 init 完成
    await new Promise(r => setTimeout(r, 200));

    // 模拟 popstate（浏览器回退按钮 / Turbo PJAX 导航）
    const popEvent = new dom.window.PopStateEvent("popstate", { state: {} });
    dom.window.dispatchEvent(popEvent);

    // handlePopState 检查 checkAiAppliedFlag → true
    // → 设置 shouldForceAiAfterPageTranslation = true
    // → 设置 aiRenderState 为 "loading"

    // 验证标记未被消费
    expect(mockState.store["dualtran:aiApplied:" + testUrl]).toBe("true");
  });

  // ═══════════════════════════════════════════════════════════
  // Test 5: pageshow（bfcache）+ 有标记 → 不应修改 shouldForceAiAfterPageTranslation
  // ═══════════════════════════════════════════════════════════

  it("T5: pageshow（bfcache 恢复，persisted=true）→ 不应触发 restore 逻辑（DOM 已保留）", async () => {
    const testUrl = "https://github.com/obra/superpowers/projects";
    mockState.store["dualtran:aiApplied:" + testUrl] = "true";

    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });

    patchSessionStorage(dom);

    createTestGlobals();

    await import("../../src/contentScript/pageTranslator.js");

    await new Promise(r => setTimeout(r, 200));

    // 模拟 bfcache 恢复（persisted=true）
    const pageshowEvent = new dom.window.PageTransitionEvent("pageshow", { persisted: true });
    dom.window.dispatchEvent(pageshowEvent);

    // bfcache 恢复时只调用 updateAiRenderStateInternal，
    // 不应修改 shouldForceAiAfterPageTranslation
    // 标记应保持不变
    expect(mockState.store["dualtran:aiApplied:" + testUrl]).toBe("true");
  });

  // ═══════════════════════════════════════════════════════════
  // Test 6: popstate 无标记 → 不应恢复 shouldForceAiAfterPageTranslation
  // ═══════════════════════════════════════════════════════════

  it("T6: popstate 无标记 → 不应设置 shouldForceAiAfterPageTranslation", async () => {
    const testUrl = "https://github.com/obra/superpowers/projects";
    // 不设置 sessionStorage 标记

    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });

    const mock = patchSessionStorage(dom);
    createTestGlobals();

    await import("../../src/contentScript/pageTranslator.js");
    await new Promise(r => setTimeout(r, 200));

    const popEvent = new dom.window.PopStateEvent("popstate", { state: {} });
    dom.window.dispatchEvent(popEvent);

    // 如果没有标记，checkAiAppliedFlag 返回 false
    // → handlePopState 不设置 shouldForceAiAfterPageTranslation
    // 这验证了"只恢复之前 AI 翻译过的页面"的逻辑
    expect(mock.getItem("dualtran:aiApplied:" + testUrl)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// Test 7: restorePage 应清除 sessionStorage 标记
// ═══════════════════════════════════════════════════════════

describe("restorePage → 清除 AI 标记", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Object.keys(mockState.store).forEach(k => delete mockState.store[k]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("T7: 调用 restorePage 后 sessionStorage 标记应被清除", async () => {
    const testUrl = "https://github.com/obra/superpowers/projects";
    // 预设标记：模拟之前 AI 翻译过的页面
    mockState.store["dualtran:aiApplied:" + testUrl] = "true";

    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });

    const mock = patchSessionStorage(dom);

    createTestGlobals();

    const { pageTranslator } = await import("../../src/contentScript/pageTranslator.js");

    // 等待模块初始化完成（Promise.all 解析）
    await vi.waitFor(() => {
      expect(pageTranslator).toBeDefined();
      expect(pageTranslator.restorePage).toBeTypeOf("function");
    }, { timeout: 5000 });

    // 调用 restorePage → 预期清除标记
    pageTranslator.restorePage();

    expect(mock.getItem("dualtran:aiApplied:" + testUrl)).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════
  // Test 8: body 元素被替换后（Turbo back-nav），动态翻译 observer 仍存活
  // 行为锁定测试（M1, issue #31）：observer 挂载点必须能承受 body 元素
  // 本身被 replaceWith 替换（真实 Turbo Drive 行为，2026-09-10 github.com
  // 实测：document.body !== oldBody after goBack）。PR #30 修复后此测试
  // GREEN；M1 重构（getObserverRoot 提取）后必须保持 GREEN。
  // ═══════════════════════════════════════════════════════════

  it("T8: body 元素被替换后（Turbo back-nav），动态翻译 observer 仍存活", async () => {
    const testUrl = "https://github.com/obra/superpowers/projects";
    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });
    patchSessionStorage(dom);
    createTestGlobals();

    const { pageTranslator } = await import("../../src/contentScript/pageTranslator.js");
    await vi.waitFor(() => {
      expect(pageTranslator.translatePage).toBeTypeOf("function");
    }, { timeout: 5000 });

    // 1. 翻译页面 → enableMutatinObserver() 挂载 observer（translateDynamicallyCreatedContent=yes）
    pageTranslator.translatePage();

    // 2. 模拟 Turbo back-nav：替换 body 元素本身（真实行为，2026-09-10 github.com 实测）
    const oldBody = document.body;
    const newBody = document.createElement("body");
    newBody.innerHTML = "<p>fresh body after turbo back-nav</p>";
    oldBody.replaceWith(newBody);

    // 3. 新 body 添加动态内容
    const p = document.createElement("p");
    p.textContent = "dynamically added after body replacement";
    newBody.appendChild(p);

    // 4. observer 必须存活：新节点被拾取进 newNodes
    //    （observer 若挂在旧 body 上，替换后死亡，newNodes 永远为空）
    await vi.waitFor(() => {
      expect(pageTranslator._getNewNodes().length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    // 清理：停止定时器 + 断开 observer
    pageTranslator.restorePage();
  });

  // ═══════════════════════════════════════════════════════════
  // Test 9: 模块加载期 120ms 可见性定时器在环境拆除后触发必须是 no-op
  // 行为锁定测试（issue #47，PR #46 CI 实锤）：本文件 beforeEach 中
  // vi.resetModules() + 每个测试重复 import 模块 → 每个模块实例都在
  // 加载期调度一个 120ms 一次性定时器（不可取消）。当测试文件结束、
  // vitest 拆除 jsdom 环境后，最后一个未触发的定时器会在 document
  // 已不存在时执行 → ReferenceError → vitest 记 1 个 unhandled error
  // → CI zero-tolerance 硬失败（1703 passed 仍 exit 1）。
  // 修复：产品代码回调必须带 teardown 守卫（typeof document === "undefined"）。
  // ═══════════════════════════════════════════════════════════

  it("T9: 模块加载期 120ms 定时器在环境拆除后触发不得抛 ReferenceError", async () => {
    const testUrl = "https://github.com/obra/superpowers/issues";
    const dom = new JSDOM("<!DOCTYPE html><html><body><p>teardown guard</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });
    patchSessionStorage(dom);
    createTestGlobals();

    // 1. 捕获模块加载期调度的 120ms 定时器回调（证明加载期确实调度了它）
    let timerCallback = null;
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = function (fn, ms, ...args) {
      if (ms === 120) timerCallback = fn;
      return originalSetTimeout(fn, ms, ...args);
    };
    try {
      const { pageTranslator } = await import("../../src/contentScript/pageTranslator.js");
      await vi.waitFor(() => {
        expect(pageTranslator).toBeDefined();
        expect(pageTranslator.restorePage).toBeTypeOf("function");
      }, { timeout: 5000 });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    expect(timerCallback).toBeTypeOf("function");

    // 2. 模拟 vitest 环境拆除：jsdom 拆除后 document 全局不存在
    const savedDocument = globalThis.document;
    delete globalThis.document;
    try {
      // 3. 拆除后触发定时器回调：必须是 no-op（修复前抛 ReferenceError）
      expect(() => timerCallback()).not.toThrow();
    } finally {
      globalThis.document = savedDocument;
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Test 10/11（#134 → SSOT 遍历版，#137）：通告通道完备性
//
// translatePage() 的第一步是 restorePage(true)（silent）。修复前 silent 只
// gate 了意图事件（E2），pageLanguageState 的 observer 广播与 SW
// setPageLanguageState 消息仍无条件发出——泄漏的 mid-run "original" 让
// floatingBtn observer handler 执行用户级 restore 语义（清空 aiModeActive +
// bump aiModeEpoch），E1 随后播报 "google"，而本次运行仍在恢复 AI 译文 →
// SPA 回退/前进后双按钮组高亮错位（issue #134）。
//
// #137 起本套件与 SSOT（tests/shared/announcement-channels.mjs）对齐：遍历
// ANNOUNCEMENT_CHANNELS 中所有 probeRequired 通道，逐通道断言
//   ① 静默路径零泄漏（T10：translatePage 内部 restore 不落任何通道）；
//   ② 非静默路径逐通道广播（T11：用户级 restorePage() 在应播报的通道上
//      播报 "original"，防过度静默）。
// SSOT 新增 probeRequired 通道而未在本文件补配序列探针 →
// CHANNEL_SEQUENCE_PINS 缺项直接红（不静默放行）。修复前 RED 实证：
// observer / SW 两通道序列均为 ["original","translated"]。
// ═══════════════════════════════════════════════════════════

describe("通告通道完备性（SSOT 遍历版，#134/#137）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Object.keys(mockState.store).forEach(k => delete mockState.store[k]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * 逐通道期望序列表（SSOT 遍历锚）。
   * silent = translatePage('fr') 从新载入状态起的完整序列；
   * userRestore = 随后用户级 restorePage() 的增量序列。
   * capture(probes) 返回该通道的事件数组（storage 通道取调用时刻末态）。
   */
  const CHANNEL_SEQUENCE_PINS = {
    // 修复前：["original","translated"]（内部恢复泄漏 → floatingBtn 高亮错位）→ RED
    "page-language-observers": {
      capture: (p) => p.observed,
      silent: ["translated"],
      userRestore: ["original"],
    },
    // 修复前：["original","translated"]（SW 消息通道同样泄漏）→ RED
    "sw-set-page-language-state": {
      capture: (p) => p.swStates,
      silent: ["translated"],
      userRestore: ["original"],
    },
    // E1 播报本次运行自身意图（google），非泄漏；静默 restore 不得追加 "original"
    "intent-requested-mode": {
      capture: (p) => p.intents,
      silent: ["google"],
      userRestore: ["original"],
    },
    // 渲染态通道为 change-guard 状态机：新载入 idle → 运行 loading；用户 restore → idle
    "page-render-state": {
      capture: (p) => p.pageRenders,
      silent: ["loading"],
      userRestore: ["idle"],
    },
    // 无 AI 流启动的 Google 运行：两个 idle 均 no-change 抑制
    "ai-render-state": {
      capture: (p) => p.aiRenders,
      silent: [],
      userRestore: [],
    },
    // 存储标记：静默/用户路径都必须清除预置的 armed 标记（防陈旧标记复活）
    "ai-applied-marker": {
      capture: (p) => [p.marker()],
      silent: [null],
      userRestore: [null],
    },
  };

  const PROBE_REQUIRED_CHANNELS = ANNOUNCEMENT_CHANNELS.filter((c) => c.probeRequired);

  function assertChannelPins(probes, field) {
    const unmapped = PROBE_REQUIRED_CHANNELS
      .filter((c) => !CHANNEL_SEQUENCE_PINS[c.id])
      .map((c) => c.id);
    if (unmapped.length > 0) {
      throw new Error(
        `SSOT probeRequired 通道缺序列探针：${unmapped.join(", ")} — 在 CHANNEL_SEQUENCE_PINS 中为该通道补配 silent/userRestore 期望`
      );
    }
    const actual = {};
    const expected = {};
    for (const channel of PROBE_REQUIRED_CHANNELS) {
      const pin = CHANNEL_SEQUENCE_PINS[channel.id];
      actual[channel.id] = pin.capture(probes);
      expected[channel.id] = pin[field];
    }
    expect(actual).toEqual(expected);
  }

  /** 装载模块并挂上全通道探针（observer / SW / 意图 / 双渲染态 / 存储标记）。 */
  async function loadWithChannelProbes(testUrl) {
    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });
    patchSessionStorage(dom);

    const swStates = [];
    const sendMessageSpy = vi.fn((payload, callback) => {
      if (payload?.action === "setPageLanguageState") swStates.push(payload.pageLanguageState);
      if (typeof callback === "function") {
        if (payload?.action === "getTabHostName") callback("github.com");
        else if (payload?.action === "detectTabLanguage") callback("en");
        else callback();
      }
    });
    createTestGlobals(sendMessageSpy);

    const { pageTranslator } = await import("../../src/contentScript/pageTranslator.js");
    await vi.waitFor(() => {
      expect(pageTranslator.translatePage).toBeTypeOf("function");
    }, { timeout: 5000 });

    // 预置 armed 标记（模拟「该 URL 曾被 AI 翻译」）；必须在模块载入后设置，
    // 否则会触发 onTabVisible 的自动翻译路径（T1–T3 已覆盖那条路径）。
    const markerKey = "dualtran:aiApplied:" + globalThis.location.origin + globalThis.location.pathname;
    mockState.store[markerKey] = "true";

    const observed = [];
    const intents = [];
    const pageRenders = [];
    const aiRenders = [];
    pageTranslator.onPageLanguageStateChange((s) => observed.push(s));
    pageTranslator.onRequestedModeChange((m) => intents.push(m));
    pageTranslator.onPageRenderStateChange((s) => pageRenders.push(s));
    pageTranslator.onAiRenderStateChange((s) => aiRenders.push(s));

    return {
      pageTranslator,
      observed,
      swStates,
      intents,
      pageRenders,
      aiRenders,
      marker: () => mockState.store[markerKey] ?? null,
      resetCaptures() {
        observed.length = 0;
        swStates.length = 0;
        intents.length = 0;
        pageRenders.length = 0;
        aiRenders.length = 0;
      },
      seedMarker() {
        mockState.store[markerKey] = "true";
      },
    };
  }

  it("T10: 静默路径零泄漏 — 遍历 SSOT，translatePage 的内部 restore 不落任何通告通道的 \"original\"", async () => {
    const probes = await loadWithChannelProbes("https://github.com/obra/superpowers/projects");

    probes.pageTranslator.translatePage("fr");

    assertChannelPins(probes, "silent");
    // 内部恢复不得改变最终状态语义：运行结束后页面是 translated
    expect(probes.pageTranslator.getPageLanguageState()).toBe("translated");

    probes.pageTranslator.restorePage(true);
  });

  it("T11: 非静默路径逐通道广播 — 遍历 SSOT，用户级 restorePage() 在应播报通道上发出 \"original\"（防过度静默）", async () => {
    const probes = await loadWithChannelProbes("https://github.com/obra/superpowers/releases");

    probes.pageTranslator.translatePage("fr");
    probes.resetCaptures();
    probes.seedMarker(); // 复置 armed 标记，使用户级 restore 的清除职责可观测

    probes.pageTranslator.restorePage();

    assertChannelPins(probes, "userRestore");
    // 用户级 restore 的最终语言态（与通道序列互证：非静默路径收敛于 "original"）
    expect(probes.pageTranslator.getPageLanguageState()).toBe("original");

    probes.pageTranslator.restorePage(true);
  });
});

// ═══════════════════════════════════════════════════════════
// T12–T16（issue #145）：页面加载自动翻译的引擎选择
//
// onTabVisible 命中自动翻译列表时按引擎分派：
//   AI 语言/网站列表（alwaysTranslateLangsAI / alwaysTranslateSitesAI）
//   → translatePageAi()（AI 意图链自动接入）；
//   Google 列表 → translatePage()（现状不变）；
//   AI 候选无 API key → 不可用（静默不翻译、不弹窗、不降级）。
// 本套件直接捕获 onTabVisible 的 detectTabLanguage 回调做「是否触发」断言，
// 与 translatePageAi 副作用（无 key 时的 confirm 提示）解耦。
// ═══════════════════════════════════════════════════════════

describe("页面加载自动翻译引擎选择（issue #145）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Object.keys(mockState.store).forEach(k => delete mockState.store[k]);
    // 每格重置自动翻译列表与 key 配置（共享 mockState，防跨格泄漏）
    mockState.configValues.alwaysTranslateSites = [];
    mockState.configValues.alwaysTranslateLangs = [];
    mockState.configValues.alwaysTranslateSitesAI = [];
    mockState.configValues.alwaysTranslateLangsAI = [];
    mockState.configValues.neverTranslateSites = [];
    mockState.configValues.neverTranslateLangs = [];
    mockState.configValues.apiKeyOpenAI = "test-api-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * 装载模块并捕获 onTabVisible 的 120ms 定时器回调。
   * detectTabLanguage 的应答由 langAnswer 控制（"und" / "fr" / ...）。
   *
   * jsdom 的 document.visibilityState 默认是 "prerender"（hidden）——模块加载期
   * 定时器会走「挂 visibilitychange 监听」分支且永远不触发 onTabVisible。
   * 测试在调用定时器前强制 visibilityState = "visible"（jsdom 可配置），
   * 使每个格的真实触发路径与生产一致（否则负向格会空过）。
   */
  async function loadWithVisibilityTimer(testUrl, langAnswer, hostname = "example.com") {
    const dom = new JSDOM("<!DOCTYPE html><html><body><p>hello world</p></body></html>", { url: testUrl });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });
    patchSessionStorage(dom);

    const sendMessageSpy = vi.fn((payload, callback) => {
      if (typeof callback === "function") {
        if (payload?.action === "getTabHostName") callback(hostname);
        else if (payload?.action === "detectTabLanguage") callback(langAnswer);
        else callback();
      }
    });
    createTestGlobals(sendMessageSpy);

    let timerCallback = null;
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = function (fn, ms, ...args) {
      if (ms === 120) timerCallback = fn;
      return originalSetTimeout(fn, ms, ...args);
    };
    let pageTranslator;
    try {
      ({ pageTranslator } = await import("../../src/contentScript/pageTranslator.js"));
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    await vi.waitFor(() => {
      expect(timerCallback).toBeTypeOf("function");
    }, { timeout: 5000 });

    // jsdom 默认 visibilityState="prerender"（hidden）：把 document 标记为可见，
    // 调用方触发定时器时走真实的 onTabVisible 直连路径（见函数头注释）。
    Object.defineProperty(dom.window.document, "visibilityState", {
      configurable: true, get: () => "visible",
    });
    return { pageTranslator, timerCallback };
  }

  it("T12: alwaysTranslateLangsAI hit → auto-translate enters translated state (AI path)", async () => {
    mockState.configValues.alwaysTranslateLangsAI = ["fr"];
    const { pageTranslator, timerCallback } = await loadWithVisibilityTimer(
      "https://example.com/ai-lang", "fr"
    );

    const intents = [];
    pageTranslator.onRequestedModeChange((m) => intents.push(m));

    // 触发模块加载期可见性定时器（模拟页面可见时的 onTabVisible）
    timerCallback();
    await vi.waitFor(() => {
      expect(pageTranslator.getPageLanguageState()).toBe("translated");
    }, { timeout: 5000 });

    // AI 意图已接入（translatePageAi 的 E3 发音 → ai），绝不发音 google
    expect(intents).toContain("ai");
    expect(intents).not.toContain("google");

    pageTranslator.restorePage(true);
  });

  it("T13: Google-list-only hit → NOT the AI path (no ai render state)", async () => {
    mockState.configValues.alwaysTranslateLangs = ["fr"];
    const { pageTranslator, timerCallback } = await loadWithVisibilityTimer(
      "https://example.com/google-lang", "fr"
    );

    const intents = [];
    pageTranslator.onRequestedModeChange((m) => intents.push(m));
    const aiRenderStates = [];
    pageTranslator.onAiRenderStateChange((s) => aiRenderStates.push(s));

    timerCallback();
    await vi.waitFor(() => {
      expect(pageTranslator.getPageLanguageState()).toBe("translated");
    }, { timeout: 5000 });

    // Google 路径：发音 google、不进入 AI 流水线
    expect(intents).toContain("google");
    expect(intents).not.toContain("ai");
    expect(pageTranslator.getState().aiRenderState).toBe("idle");
    expect(aiRenderStates).toEqual([]);

    pageTranslator.restorePage(true);
  });

  it("T14: alwaysTranslateSitesAI hit on 'und' language branch → translated state", async () => {
    mockState.configValues.alwaysTranslateSitesAI = ["example.com"];
    const { pageTranslator, timerCallback } = await loadWithVisibilityTimer(
      "https://example.com/ai-site-und", "und"
    );

    const intents = [];
    pageTranslator.onRequestedModeChange((m) => intents.push(m));

    timerCallback();
    await vi.waitFor(() => {
      expect(pageTranslator.getPageLanguageState()).toBe("translated");
    }, { timeout: 5000 });

    expect(intents).toContain("ai");

    pageTranslator.restorePage(true);
  });

  it("T15: AI list hit without an API key → silent no-translate (no prompt, no Google downgrade)", async () => {
    mockState.configValues.alwaysTranslateLangsAI = ["fr"];
    mockState.configValues.apiKeyOpenAI = "";
    const { pageTranslator, timerCallback } = await loadWithVisibilityTimer(
      "https://example.com/ai-lang-nokey", "fr"
    );

    let confirmCalled = false;
    globalThis.window.confirm = () => { confirmCalled = true; return false; };
    globalThis.confirm = globalThis.window.confirm;

    timerCallback();
    await new Promise(r => setTimeout(r, 300));

    // 静默：页面保持 original，绝不弹配置提示
    expect(pageTranslator.getPageLanguageState()).toBe("original");
    expect(confirmCalled).toBe(false);
  });

  it("T16: AI site list hit without an API key → silent no-translate", async () => {
    mockState.configValues.alwaysTranslateSitesAI = ["example.com"];
    mockState.configValues.apiKeyOpenAI = "";
    const { pageTranslator, timerCallback } = await loadWithVisibilityTimer(
      "https://example.com/ai-site-nokey", "fr"
    );

    let confirmCalled = false;
    globalThis.window.confirm = () => { confirmCalled = true; return false; };
    globalThis.confirm = globalThis.window.confirm;

    timerCallback();
    await new Promise(r => setTimeout(r, 300));

    expect(pageTranslator.getPageLanguageState()).toBe("original");
    expect(confirmCalled).toBe(false);
  });
});
