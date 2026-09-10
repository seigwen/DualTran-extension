/**
 * Tests for the floating button's three-state behavior (Original / Google / AI).
 *
 * Model (Q28 behavior table):
 *   - Exactly one button highlighted at all times
 *   - Click always switches highlight; no-op only means no translation action
 *   - Intervention flag: after user clicks, highlight is click-driven;
 *     before, content-driven (auto-translate → Google highlight)
 *   - No loading state on buttons (per-block indicators show progress)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  configValues,
  configChangeCallbacks,
  pageTranslatorCallbacks,
  pageTranslatorMock,
  platformState,
  setMock,
} = vi.hoisted(() => ({
  configValues: {
    targetLanguage: "fr",
    pageTranslatorService: "google",
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    showFloatingBtn: "yes",
    floatingBtnPosition: null,
    darkMode: "no",
    whereToDisplayTranslatedText: "newLine",
  },
  configChangeCallbacks: [],
  pageTranslatorCallbacks: {
    onPageLanguageStateChange: [],
    onPageRenderStateChange: [],
    onAiRenderStateChange: [],
  },
  pageTranslatorMock: {
    translatePage: vi.fn(),
    translatePageAi: vi.fn(() => true),
    restorePage: vi.fn(),
    showGoogleOnly: vi.fn(),
    showAiOnly: vi.fn(),
    stopAiAutoTranslate: vi.fn(),
    setAiModeActive: vi.fn(),
    hasAiResults: vi.fn(() => false),
    getPageLanguageState: vi.fn(() => "original"),
    getPageRenderState: vi.fn(() => "idle"),
    getAiRenderState: vi.fn(() => "idle"),
    getAiModeActive: vi.fn(() => true),
    getState: vi.fn(() => ({
      pageLanguageState: "original",
      pageRenderState: "idle",
      aiRenderState: "idle",
      aiModeActive: true,
    })),
    onPageLanguageStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageLanguageStateChange.push(callback);
    }),
    onPageRenderStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageRenderStateChange.push(callback);
    }),
    onAiRenderStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onAiRenderStateChange.push(callback);
    }),
  },
  platformState: {
    isMobile: false,
  },
  setMock: vi.fn((key, value) => {
    configValues[key] = value;
  }),
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: setMock,
    onReady: vi.fn((callback) => {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }),
    onChanged: vi.fn((callback) => {
      configChangeCallbacks.push(callback);
    }),
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: (lang) => lang,
    codeToLanguage: (lang) => lang,
    isRtlLanguage: () => false,
  },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({
  default: {
    isMobile: {
      get any() {
        return platformState.isMobile;
      },
    },
  },
}));

vi.mock("../../src/contentScript/pageTranslator.js", () => ({
  pageTranslator: pageTranslatorMock,
  backgroundTranslateSingleText: vi.fn(),
  aiTranslateText: vi.fn(),
}));

function emitPageLanguageStateChange(value) {
  pageTranslatorCallbacks.onPageLanguageStateChange.forEach((cb) => cb(value));
}
function emitPageRenderStateChange(value) {
  pageTranslatorCallbacks.onPageRenderStateChange.forEach((cb) => cb(value));
}
function emitAiRenderStateChange(value) {
  pageTranslatorCallbacks.onAiRenderStateChange.forEach((cb) => cb(value));
}

async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("floatingBtn — three-state behavior", () => {
  let attachShadowSpy;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    pageTranslatorCallbacks.onPageLanguageStateChange.length = 0;
    pageTranslatorCallbacks.onPageRenderStateChange.length = 0;
    pageTranslatorCallbacks.onAiRenderStateChange.length = 0;
    configValues.targetLanguage = "fr";
    configValues.pageTranslatorService = "google";
    configValues.alwaysTranslateSites = [];
    configValues.neverTranslateSites = [];
    configValues.neverTranslateLangs = [];
    configValues.showFloatingBtn = "yes";
    configValues.floatingBtnPosition = null;
    configValues.darkMode = "no";
    configValues.whereToDisplayTranslatedText = "newLine";

    setMock.mockClear();
    pageTranslatorMock.translatePage.mockReset();
    pageTranslatorMock.translatePageAi.mockReset();
    pageTranslatorMock.translatePageAi.mockReturnValue(true);
    pageTranslatorMock.restorePage.mockReset();
    pageTranslatorMock.showGoogleOnly.mockReset();
    pageTranslatorMock.showAiOnly.mockReset();
    pageTranslatorMock.stopAiAutoTranslate.mockReset();
    pageTranslatorMock.setAiModeActive.mockReset();
    pageTranslatorMock.hasAiResults.mockReset();
    pageTranslatorMock.hasAiResults.mockReturnValue(false);
    pageTranslatorMock.getPageLanguageState.mockReset();
    pageTranslatorMock.getPageLanguageState.mockReturnValue("original");
    pageTranslatorMock.getPageRenderState.mockReset();
    pageTranslatorMock.getPageRenderState.mockReturnValue("idle");
    pageTranslatorMock.getAiRenderState.mockReset();
    pageTranslatorMock.getAiRenderState.mockReturnValue("idle");
    pageTranslatorMock.getAiModeActive.mockReset();
    pageTranslatorMock.getAiModeActive.mockReturnValue(true);
    pageTranslatorMock.getState.mockReset();
    pageTranslatorMock.getState.mockReturnValue({
      pageLanguageState: "original",
      pageRenderState: "idle",
      aiRenderState: "idle",
      aiModeActive: true,
    });
    pageTranslatorMock.onPageLanguageStateChange.mockClear();
    pageTranslatorMock.onPageRenderStateChange.mockClear();
    pageTranslatorMock.onAiRenderStateChange.mockClear();

    document.body.innerHTML = "";
    document.head.innerHTML = "";

    attachShadowSpy = vi
      .spyOn(HTMLElement.prototype, "attachShadow")
      .mockImplementation(function (init) {
        return Element.prototype.attachShadow.call(this, { ...init, mode: "open" });
      });

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn((payload, callback) => {
          if (typeof callback === "function") {
            callback(payload?.action === "getTabHostName" ? "example.com" : undefined);
          }
        }),
        getURL: vi.fn((path) => path),
      },
      i18n: {
        getMessage: vi.fn((key) => key),
        translateDocument: vi.fn(),
      },
    };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ text: () => Promise.resolve("") })
    );
    globalThis.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function loadModule() {
    const module = await import("../../src/contentScript/floatingBtn.js");
    await flushMicrotasks();
    return module.default;
  }

  function getHost() {
    return document.body.querySelector("div.notranslate");
  }
  function getOriginalButton() {
    return getHost()?.shadowRoot?.getElementById("btnOriginal");
  }
  function getGoogleButton() {
    return getHost()?.shadowRoot?.getElementById("btnGoogle");
  }
  function getAiButton() {
    return getHost()?.shadowRoot?.getElementById("btnAi");
  }
  function isHighlighted(btn) {
    return btn?.classList.contains("dualtran-floating-btn-active") ?? false;
  }

  // ──────────────────────────────────────────────
  // Initial state
  // ──────────────────────────────────────────────

  it("initial state: three buttons exist, Original highlighted", async () => {
    await loadModule();
    expect(getOriginalButton()).toBeTruthy();
    expect(getGoogleButton()).toBeTruthy();
    expect(getAiButton()).toBeTruthy();
    expect(isHighlighted(getOriginalButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
    expect(isHighlighted(getAiButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 2: page original → Google click
  // ──────────────────────────────────────────────

  it("scenario 2: page original + Google click → translatePage + Google highlighted", async () => {
    await loadModule();
    getGoogleButton().click();
    expect(pageTranslatorMock.translatePage).toHaveBeenCalledOnce();
    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getOriginalButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 4: page original → AI click (has key)
  // ──────────────────────────────────────────────

  it("scenario 4: page original + AI click → translatePageAi + AI highlighted", async () => {
    await loadModule();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(isHighlighted(getAiButton())).toBe(true);
    expect(isHighlighted(getOriginalButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 3: page original → AI click (no key)
  // ──────────────────────────────────────────────

  it("scenario 3: page original + AI click (no key) → prompt, AI highlighted, no translation", async () => {
    pageTranslatorMock.translatePageAi.mockReturnValue(false);
    await loadModule();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(isHighlighted(getAiButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 6: Google displayed + Google highlighted → Google click noop
  // ──────────────────────────────────────────────

  it("scenario 6: Google displayed + Google click → noop (no restore, no re-translate)", async () => {
    await loadModule();
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    pageTranslatorMock.translatePage.mockClear();
    pageTranslatorMock.restorePage.mockClear();
    getGoogleButton().click();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
    expect(isHighlighted(getGoogleButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 7: Google displayed + Google highlighted → AI click
  // ──────────────────────────────────────────────

  it("scenario 7: Google displayed + AI click → translatePageAi (Google not re-called)", async () => {
    await loadModule();
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    pageTranslatorMock.translatePage.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
    expect(isHighlighted(getAiButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 12/13: Original click restores
  // ──────────────────────────────────────────────

  it("scenario 12: AI displayed + Original click → restorePage + Original highlighted", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("success");
    getOriginalButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
    expect(isHighlighted(getOriginalButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 11: AI displayed + Google click → showGoogleOnly, no requests
  // ──────────────────────────────────────────────

  it("scenario 11: AI displayed + Google click → showGoogleOnly + Google highlighted", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("success");
    pageTranslatorMock.translatePage.mockClear();
    getGoogleButton().click();
    expect(pageTranslatorMock.showGoogleOnly).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
    expect(isHighlighted(getGoogleButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 16: auto-translate (no intervention) → Google highlighted
  // ──────────────────────────────────────────────

  it("scenario 16: auto-translate without intervention → Google highlighted (content-driven)", async () => {
    await loadModule();
    emitPageLanguageStateChange("translated");
    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getOriginalButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 14: intervention + auto-translate event → highlight unchanged
  // ──────────────────────────────────────────────

  it("scenario 14: after AI click, pageLanguageState translated → AI stays highlighted (click priority)", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    expect(isHighlighted(getAiButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Scenario 8: AI in-flight + AI click → noop
  // ──────────────────────────────────────────────

  it("scenario 8: AI in-flight + AI click → noop (no duplicate request)", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("loading");
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).not.toHaveBeenCalled();
    expect(isHighlighted(getAiButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 9: AI failed + AI click → retry
  // ──────────────────────────────────────────────

  it("scenario 9: AI failed blocks + AI click → retry (translatePageAi called again)", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("error");
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────
  // Scenario 10: AI displayed + AI click → noop
  // ──────────────────────────────────────────────

  it("scenario 10: AI displayed + AI click → noop", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("success");
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).not.toHaveBeenCalled();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // Scenario 5: page original + AI highlighted + AI click → translatePageAi
  // ──────────────────────────────────────────────

  it("scenario 5: page original + AI highlighted (no-key then key configured) + AI click → translatePageAi", async () => {
    pageTranslatorMock.translatePageAi.mockReturnValue(false);
    await loadModule();
    getAiButton().click(); // no-key click: AI highlighted, no translation
    expect(isHighlighted(getAiButton())).toBe(true);
    pageTranslatorMock.translatePageAi.mockReturnValue(true);
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click(); // now has key: should start AI translation
    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────
  // Scenario 10a: Google displayed + newLine + AI result available + AI click → showAiOnly
  // ──────────────────────────────────────────────

  it("scenario 10a: Google displayed + AI result available (newLine) + AI click → showAiOnly, zero requests", async () => {
    pageTranslatorMock.hasAiResults.mockReturnValue(true);
    await loadModule();
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    pageTranslatorMock.translatePageAi.mockClear();
    getAiButton().click();
    expect(pageTranslatorMock.translatePageAi).not.toHaveBeenCalled();
    expect(isHighlighted(getAiButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 15: AI in-flight + Original click → restorePage
  // ──────────────────────────────────────────────

  it("scenario 15: AI in-flight + Original click → restorePage + Original highlighted", async () => {
    await loadModule();
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("loading");
    getOriginalButton().click();
    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
    expect(isHighlighted(getOriginalButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Scenario 19: external restore (pageLanguageState → original) resets highlight
  // ──────────────────────────────────────────────

  it("scenario 19: pageLanguageState → original resets highlight to Original", async () => {
    await loadModule();
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    expect(isHighlighted(getGoogleButton())).toBe(true);
    emitPageLanguageStateChange("original");
    expect(isHighlighted(getOriginalButton())).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Bug: SPA 导航后退后重建，高亮重置为 Original（用户报告）
  // 场景：页面已 Google 翻译（pageLanguageState="translated"），
  //       用户 SPA 导航到别页再后退（popstate → host 重建），
  //       Google 译文自动恢复，但重建后的按钮组高亮错误地回到 Original。
  // ──────────────────────────────────────────────

  it("bug: SPA back-nav rebuild after Google translation → Google stays highlighted", async () => {
    await loadModule();
    // 用户点 Google → 翻译完成 → Google 高亮
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("success");
    expect(isHighlighted(getGoogleButton())).toBe(true);

    // 模拟 SPA 导航（Turbo 替换 body，floatingBtn host 被移除）
    const originalHost = getHost();
    originalHost.remove();
    expect(getHost()).toBeNull();

    // pageTranslator 侧状态仍是 translated（SPA 不重置）
    pageTranslatorMock.getState.mockReturnValue({
      pageLanguageState: "translated",
      pageRenderState: "success",
      aiRenderState: "idle",
      aiModeActive: false, // 用户点过 Google 按钮 → aiModeActive=false（Q5：setAiModeActive(false)）
    });

    // 后退 → popstate → host 重建
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    // 重建成功
    expect(getHost()).not.toBeNull();
    expect(getHost()).not.toBe(originalHost);
    // Google 译文自动恢复（MutationObserver 路径，pageTranslator 广播 render success）
    emitPageRenderStateChange("success");

    // 用户症状：页面是 Google 译文，但按钮高亮应该是 Google
    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getOriginalButton())).toBe(false);
  });

  it("bug: SPA back-nav rebuild after AI translation → AI stays highlighted", async () => {
    await loadModule();
    // 用户点 Google → AI → Google+AI 翻译完成 → AI 高亮
    getGoogleButton().click();
    emitPageLanguageStateChange("translated");
    getAiButton().click();
    emitAiRenderStateChange("success");
    expect(isHighlighted(getAiButton())).toBe(true);

    // SPA 导航：host 移除
    const originalHost = getHost();
    originalHost.remove();

    // pageTranslator 侧状态仍是 translated + AI success
    pageTranslatorMock.getState.mockReturnValue({
      pageLanguageState: "translated",
      pageRenderState: "success",
      aiRenderState: "success",
      aiModeActive: true,
    });

    // 后退 → popstate → 重建
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    // 用户症状：页面 AI 译文恢复，AI 按钮应高亮
    expect(isHighlighted(getAiButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // A1: 生命周期矩阵测试（Lifecycle Matrix Testing）
  // 覆盖 {original, google, ai} × {translated, original} × {intervention}
  // 的跨重建状态保持。已有：Google 高亮保持、AI 高亮保持。
  // 补充：original 重建、自动翻译路径（aiModeActive 默认 true 陷阱）、
  //       AI 失败重试路径。
  // ──────────────────────────────────────────────

  it("A1: 未翻译页面重建 → Original 高亮保持（引擎 original）", async () => {
    await loadModule();
    // 页面未翻译，Original 高亮
    expect(isHighlighted(getOriginalButton())).toBe(true);

    // SPA 导航：host 移除，引擎状态仍是 original
    const originalHost = getHost();
    originalHost.remove();
    pageTranslatorMock.getState.mockReturnValue({
      pageLanguageState: "original",
      pageRenderState: "idle",
      aiRenderState: "idle",
      aiModeActive: true,
    });

    // 后退 → popstate → 重建
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    // 重建后仍应 Original 高亮
    expect(isHighlighted(getOriginalButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
    expect(isHighlighted(getAiButton())).toBe(false);
  });

  it("A1: 自动翻译路径重建 → Google 高亮（aiModeActive 默认 true 但 AI 未启动）", async () => {
    await loadModule();
    // 自动翻译（无用户点击）：pageLanguageState → translated，Google 高亮
    emitPageLanguageStateChange("translated");
    expect(isHighlighted(getGoogleButton())).toBe(true);

    // SPA 导航：host 移除。引擎状态：translated + aiRenderState=idle
    // （AI 从未启动）+ aiModeActive=true（Q5 默认值——用户从未点击）
    const originalHost = getHost();
    originalHost.remove();
    pageTranslatorMock.getState.mockReturnValue({
      pageLanguageState: "translated",
      pageRenderState: "success",
      aiRenderState: "idle",
      aiModeActive: true,
    });

    // 后退 → popstate → 重建
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    // 关键断言：不能误判为 AI 高亮（aiModeActive 默认 true 陷阱）
    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getAiButton())).toBe(false);
  });

  it("A1: AI 失败后重建 → AI 高亮保持（点击 = 重试语义）", async () => {
    await loadModule();
    // 用户点 AI → 失败（无 key 或错误）→ AI 高亮保持（Q4 重试语义）
    pageTranslatorMock.translatePageAi.mockReturnValue(false);
    getAiButton().click();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("error");
    expect(isHighlighted(getAiButton())).toBe(true);

    // SPA 导航：host 移除。引擎状态：translated + aiRenderState=error
    const originalHost = getHost();
    originalHost.remove();
    pageTranslatorMock.getState.mockReturnValue({
      pageLanguageState: "translated",
      pageRenderState: "success",
      aiRenderState: "error",
      aiModeActive: true,
    });

    // 后退 → popstate → 重建
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    // 重建后 AI 高亮保持（用户再点 = 重试）
    expect(isHighlighted(getAiButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // B3: show() 状态注入点测试
  // engineStateOverride 直接注入状态验证初始化契约，不依赖 getState mock。
  // ──────────────────────────────────────────────

  it("B3: show(forceShow, engineStateOverride) 注入 translated+AI → AI 高亮", async () => {
    const floatingBtn = await loadModule();
    // 移除 host，用注入点重建（模拟 SPA 回退，引擎状态 translated + AI success）
    getHost().remove();
    floatingBtn.show(true, {
      pageLanguageState: "translated",
      pageRenderState: "success",
      aiRenderState: "success",
      aiModeActive: true,
    });
    await flushMicrotasks();

    expect(isHighlighted(getAiButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
    expect(isHighlighted(getOriginalButton())).toBe(false);
  });

  it("B3: show(forceShow, engineStateOverride) 注入 translated+Google → Google 高亮", async () => {
    const floatingBtn = await loadModule();
    getHost().remove();
    floatingBtn.show(true, {
      pageLanguageState: "translated",
      pageRenderState: "success",
      aiRenderState: "idle",
      aiModeActive: false,
    });
    await flushMicrotasks();

    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getAiButton())).toBe(false);
  });

  it("B3: show(forceShow, engineStateOverride) 注入 original → Original 高亮", async () => {
    const floatingBtn = await loadModule();
    getHost().remove();
    floatingBtn.show(true, {
      pageLanguageState: "original",
      pageRenderState: "idle",
      aiRenderState: "idle",
      aiModeActive: true,
    });
    await flushMicrotasks();

    expect(isHighlighted(getOriginalButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
    expect(isHighlighted(getAiButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Reload-restore path (bug report 2026-09-06): refresh after AI
  // translation → page auto-shows AI (sessionStorage marker) but the
  // button stays Google highlighted. Event sequence without intervention:
  // translated → Google highlight (page shows Google while AI in flight),
  // then aiRenderState=success → button must switch to AI highlight.
  // ──────────────────────────────────────────────

  it("reload-restore: AI success after auto-translate (no intervention) → AI highlighted", async () => {
    await loadModule();
    // pageshow restore: pageLanguageState → translated (Google shows first)
    emitPageLanguageStateChange("translated");
    expect(isHighlighted(getGoogleButton())).toBe(true);
    // AI translation completes → page now shows AI → button must follow
    emitAiRenderStateChange("success");
    expect(isHighlighted(getAiButton())).toBe(true);
    expect(isHighlighted(getGoogleButton())).toBe(false);
  });

  it("reload-restore: AI in flight (loading) → Google stays highlighted (page still shows Google)", async () => {
    await loadModule();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("loading");
    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getAiButton())).toBe(false);
  });

  it("reload-restore: AI error after auto-translate → Google stays highlighted (page falls back to Google)", async () => {
    await loadModule();
    emitPageLanguageStateChange("translated");
    emitAiRenderStateChange("error");
    expect(isHighlighted(getGoogleButton())).toBe(true);
    expect(isHighlighted(getAiButton())).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Turbo body-element replacement (bug report 2026-09-10): on real
  // GitHub, Turbo Drive replaces the <body> ELEMENT itself on back-nav
  // (verified live: document.body !== oldBody after goBack). The E2E
  // mock pages use body.innerHTML (body element survives), so the
  // observer on document.body never sees the host disappear in real
  // Turbo — the floating button group is gone after back-nav.
  // ──────────────────────────────────────────────

  it("turbo back-nav: body element replaced AFTER popstate 200ms check → host must be recreated", async () => {
    await loadModule();
    expect(getHost()).toBeTruthy();

    // popstate fires (Turbo back-nav starts) — body not yet replaced
    window.dispatchEvent(new Event("popstate"));
    await vi.advanceTimersByTimeAsync(200);
    // host still present (Turbo still fetching) → popstate check passes, no rebuild
    expect(document.getElementById("dualtran-floating-btn-host")).toBeTruthy();

    // Clear stale timers from previous test instances (observer debounce
    // timers set when beforeEach cleared the body would otherwise fire
    // during advanceTimersByTimeAsync below and mask the bug).
    vi.clearAllTimers();

    // Turbo finishes fetch → replaces the BODY ELEMENT itself
    const newBody = document.createElement("body");
    newBody.innerHTML = "<h1>SPA Source Page</h1>";
    document.body.replaceWith(newBody);
    expect(document.getElementById("dualtran-floating-btn-host")).toBeNull();

    // observer debounce (300ms) — observer is on the OLD body (detached),
    // so it never fires → host is NOT recreated (this is the bug)
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.getElementById("dualtran-floating-btn-host")).toBeTruthy();
  });

  it("turbo back-nav: body element replaced immediately → host must be recreated", async () => {
    await loadModule();
    expect(getHost()).toBeTruthy();

    // Clear stale timers from previous test instances (see above).
    vi.clearAllTimers();

    // Turbo replaces the BODY ELEMENT (no popstate in some SPA paths)
    const newBody = document.createElement("body");
    newBody.innerHTML = "<h1>SPA Source Page</h1>";
    document.body.replaceWith(newBody);
    expect(document.getElementById("dualtran-floating-btn-host")).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(document.getElementById("dualtran-floating-btn-host")).toBeTruthy();
  });
});
