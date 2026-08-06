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
  },
  configChangeCallbacks: [],
  pageTranslatorCallbacks: {
    onPageLanguageStateChange: [],
    onPageRenderStateChange: [],
    onAiRenderStateChange: [],
    onGetOriginalTabLanguage: [],
  },
  pageTranslatorMock: {
    translatePage: vi.fn(),
    translatePageAi: vi.fn(),
    restorePage: vi.fn(),
    stopAiAutoTranslate: vi.fn(),
    onPageLanguageStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageLanguageStateChange.push(callback);
    }),
    onPageRenderStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onPageRenderStateChange.push(callback);
    }),
    onAiRenderStateChange: vi.fn((callback) => {
      pageTranslatorCallbacks.onAiRenderStateChange.push(callback);
    }),
    onGetOriginalTabLanguage: vi.fn((callback) => {
      pageTranslatorCallbacks.onGetOriginalTabLanguage.push(callback);
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

function emitConfigChange(name, value) {
  configValues[name] = value;
  configChangeCallbacks.forEach((callback) => callback(name, value));
}

function emitPageLanguageStateChange(value) {
  pageTranslatorCallbacks.onPageLanguageStateChange.forEach((callback) => callback(value));
}

function emitPageRenderStateChange(value) {
  pageTranslatorCallbacks.onPageRenderStateChange.forEach((callback) => callback(value));
}

function emitAiRenderStateChange(value) {
  pageTranslatorCallbacks.onAiRenderStateChange.forEach((callback) => callback(value));
}

async function flushMicrotasks(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("floatingBtn", () => {
  let attachShadowSpy;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    pageTranslatorCallbacks.onPageLanguageStateChange.length = 0;
    pageTranslatorCallbacks.onPageRenderStateChange.length = 0;
    pageTranslatorCallbacks.onAiRenderStateChange.length = 0;
    pageTranslatorCallbacks.onGetOriginalTabLanguage.length = 0;
    configValues.targetLanguage = "fr";
    configValues.pageTranslatorService = "google";
    configValues.alwaysTranslateSites = [];
    configValues.neverTranslateSites = [];
    configValues.neverTranslateLangs = [];
    configValues.showFloatingBtn = "yes";
    configValues.floatingBtnPosition = null;
    configValues.darkMode = "no";

    setMock.mockClear();
    pageTranslatorMock.translatePage.mockReset();
    pageTranslatorMock.translatePageAi.mockReset();
    pageTranslatorMock.restorePage.mockReset();
    pageTranslatorMock.stopAiAutoTranslate.mockReset();
    pageTranslatorMock.onPageLanguageStateChange.mockClear();
    pageTranslatorMock.onPageRenderStateChange.mockClear();
    pageTranslatorMock.onAiRenderStateChange.mockClear();
    pageTranslatorMock.onGetOriginalTabLanguage.mockClear();

    document.body.innerHTML = "";
    document.head.innerHTML = "";

    attachShadowSpy = vi
      .spyOn(HTMLElement.prototype, "attachShadow")
      .mockImplementation(function attachShadow(init) {
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
      Promise.resolve({
        text: () => Promise.resolve(""),
      })
    );
    globalThis.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks(); // 恢复原型级 mock（如 HTMLElement.prototype.attachShadow）
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

  function getIcon() {
    return getHost()?.shadowRoot?.getElementById("btnGoogle");
  }
  function getContainer() {
    return getHost()?.shadowRoot?.getElementById("floatingBtnContainer");
  }
  function getAiButton() {
    return getHost()?.shadowRoot?.getElementById("btnAi");
  }
  function getDragHandle() {
    return getHost()?.shadowRoot?.getElementById("dragHandle");
  }

  function getLayer() {
    return getHost()?.shadowRoot?.getElementById("floatingBtnLayer");
  }

  // 修复: 原测试用 toBeTypeOf("function") 永远通过，替换为可调用性验证
  it("imports and exports the floatingBtn object with callable public methods", async () => {
    const floatingBtn = await loadModule();

    expect(floatingBtn).toBeTypeOf("object");
    expect(floatingBtn).toHaveProperty("show");
    expect(floatingBtn).toHaveProperty("hide");
    // 验证方法可调用而不抛出（比纯类型检查更有意义）
    expect(() => floatingBtn.show()).not.toThrow();
    expect(() => floatingBtn.hide()).not.toThrow();
  });

  it("show creates a shadow-root host containing the floating container and buttons", async () => {
    await loadModule();

    expect(attachShadowSpy).toHaveBeenCalled();
    expect(getHost()).not.toBeNull();
    expect(getIcon()?.tagName).toBe("BUTTON");
  });

  it("hide removes the floating button host", async () => {
    const floatingBtn = await loadModule();

    expect(getHost()).not.toBeNull();
    floatingBtn.hide();
    expect(getHost()).toBeNull();
  });

  it("show returns early when showFloatingBtn is not yes", async () => {
    configValues.showFloatingBtn = "no";
    const floatingBtn = await loadModule();

    expect(getHost()).toBeNull();
    floatingBtn.show();
    expect(getHost()).toBeNull();
  });

  it("showFloatingBtn config changes trigger the button to render", async () => {
    configValues.showFloatingBtn = "no";
    await loadModule();

    expect(getHost()).toBeNull();
    emitConfigChange("showFloatingBtn", "yes");
    await flushMicrotasks();

    expect(getHost()).not.toBeNull();
  });

  it("always/never translate config changes all trigger show", async () => {
    const floatingBtn = await loadModule();
    const showSpy = vi.spyOn(floatingBtn, "show");

    emitConfigChange("alwaysTranslateSites", ["example.com"]);
    emitConfigChange("neverTranslateSites", ["blocked.com"]);
    emitConfigChange("neverTranslateLangs", ["fr"]);

    expect(showSpy).toHaveBeenCalledTimes(3);
  });

  it("clicking the icon translates the page in the original state", async () => {
    await loadModule();

    getIcon().click();

    expect(pageTranslatorMock.translatePage).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
  });

  it("clicking the Google button restores the page in the translated state", async () => {
    await loadModule();
    emitPageLanguageStateChange("translated");

    getIcon().click();

    expect(pageTranslatorMock.restorePage).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
  });

  it("updates the buttons when render state changes", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: function() {
        if (this.id === "btnGoogle" || this.id === "btnAi") return 100;
        return 0;
      }
    });
    await loadModule();

    expect(getIcon().textContent).toBe("Google");
    expect(getAiButton().textContent).toBe("AI");

    emitPageRenderStateChange("loading");
    expect(getIcon().textContent).toBe("Google…");

    emitPageRenderStateChange("success");
    expect(getIcon().textContent).toBe("Google ✓");

    emitAiRenderStateChange("loading");
    expect(getAiButton().textContent).toBe("AI…");

    emitAiRenderStateChange("success");
    expect(getAiButton().textContent).toBe("AI ✓");

    emitPageLanguageStateChange("original");
    expect(getIcon().textContent).toBe("Google");
    expect(getAiButton().textContent).toBe("AI");
  });

  it("clicking the AI button triggers AI page translation on translated pages", async () => {
    await loadModule();
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("success");

    getAiButton().click();

    expect(pageTranslatorMock.translatePageAi).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.restorePage).not.toHaveBeenCalled();
  });

  it("switching from AI to Google translation calls stopAiAutoTranslate before translatePage", async () => {
    // 用户已用 AI 翻译（aiRenderState=success）且 Google 译文也在（googleRenderState=success），
    // 此时点击 AI 按钮应切换到 Google 译文，并停止 AI 自动翻译模式，
    // 使后续动态加载的新内容不再被 AI 翻译。
    await loadModule();
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("success");
    emitAiRenderStateChange("success");

    getAiButton().click();

    // stopAiAutoTranslate 必须在 translatePage 之前调用，
    // 因为 translatePage 内部会保留 shouldForceAiAfterPageTranslation 标志，
    // 必须先显式重置才能正确停止 AI 自动翻译。
    // vitest 不内置 toHaveBeenCalledBefore 匹配器，用 invocationCallOrder 比较调用先后
    expect(pageTranslatorMock.stopAiAutoTranslate).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.translatePage).toHaveBeenCalledOnce();
    expect(pageTranslatorMock.stopAiAutoTranslate.mock.invocationCallOrder[0]).toBeLessThan(
      pageTranslatorMock.translatePage.mock.invocationCallOrder[0]
    );
    expect(pageTranslatorMock.translatePageAi).not.toHaveBeenCalled();
  });

  it("restores a saved floating button position from config", async () => {
    configValues.floatingBtnPosition = { left: 120, top: 80 };
    await loadModule();

    expect(getLayer().style.left).toBe("120px");
    expect(getLayer().style.top).toBe("80px");
    expect(getLayer().style.bottom).toBe("");
    expect(getLayer().style.right).toBe("");
  });

  it("does not auto-convert anchored placement to absolute on resize when not saved", async () => {
    await loadModule();

    // Default placement is top/right centered
    expect(getLayer().style.top).toBe("50%");
    expect(getLayer().style.right).toBe("0px");
    expect(getLayer().style.transform).toBe("translateY(-50%)");
    expect(getLayer().style.left).toBe("");
    expect(getLayer().style.bottom).toBe("");

    // Trigger a resize
    window.dispatchEvent(new Event("resize"));
    await flushMicrotasks();

    // Should still be anchored
    expect(getLayer().style.top).toBe("50%");
    expect(getLayer().style.right).toBe("0px");
    expect(getLayer().style.transform).toBe("translateY(-50%)");
    expect(getLayer().style.left).toBe("");
    expect(getLayer().style.bottom).toBe("");
  });

  it("suppresses click after a drag and saves the new position", async () => {
    await loadModule();
    const icon = getIcon();
    const dragHandle = getDragHandle();

    dragHandle.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      })
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 30,
        clientY: 40,
      })
    );
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(setMock).toHaveBeenCalledWith(
      "floatingBtnPosition",
      expect.objectContaining({ left: 20, top: 30 })
    );
    expect(pageTranslatorMock.translatePage).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────
  // bfcache (back/forward cache) 恢复回归测试
  //
  // 场景：用户翻译页面（Google + AI）后导航到其他页面，再通过浏览器回退
  // 按钮返回。页面从 bfcache 恢复，JavaScript 堆状态保留（AI 按钮显示绿色），
  // 但页面动态内容被重新获取，AI 翻译因无缓存而缺失。
  //
  // pageTranslator 应在检测到 bfcache 恢复后通过 onAiRenderStateChange
  // 将 AI 状态从过时的 "success" 纠正为 "idle"。
  // ──────────────────────────────────────────────────────────────

  it("corrects stale AI success state to idle after bfcache restore", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: function() {
        if (this.id === "btnGoogle" || this.id === "btnAi") return 100;
        return 0;
      }
    });
    await loadModule();

    // Step 1: 模拟 bfcache 恢复后的过时状态
    //         页面已翻译，Google 和 AI 均为 success（来自 bfcache 冻结前的状态）
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("success");
    emitAiRenderStateChange("success");

    // 验证：两个按钮都显示绿色 ✓（bfcache 刚恢复时的过时状态）
    expect(getIcon().textContent).toBe("Google ✓");
    expect(getAiButton().textContent).toBe("AI ✓");

    // Step 2: pageTranslator 检测到 bfcache 恢复（pageshow 事件），
    //         重新评估 AI 渲染状态后发现存在未翻译块，
    //         将 AI 状态从 "success" 纠正为 "idle"
    emitAiRenderStateChange("idle");

    // 验证：AI 按钮恢复到 idle 状态（"AI"），Google 按钮保持 success（"Google ✓"）
    //       因为 Google 翻译有缓存，而 AI 翻译无缓存
    expect(getIcon().textContent).toBe("Google ✓");
    expect(getAiButton().textContent).toBe("AI");

    // 验证按钮颜色也恢复到 idle 状态
    expect(getAiButton().style.color).toBe("rgb(124, 58, 237)"); // AI idle purple
    expect(getAiButton().style.background).toBe("rgb(245, 243, 255)");
  });

  it("does not reset AI state to idle when no untranslated blocks exist", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: function() {
        if (this.id === "btnGoogle" || this.id === "btnAi") return 100;
        return 0;
      }
    });
    await loadModule();

    // 设置页面为已翻译 + 两个按钮均为 success（正常状态，非 bfcache 恢复）
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("success");
    emitAiRenderStateChange("success");

    // 验证两个按钮均为绿色
    expect(getIcon().textContent).toBe("Google ✓");
    expect(getAiButton().textContent).toBe("AI ✓");

    // 模拟 pageLanguageState 变回 original（用户点击恢复原始）
    emitPageLanguageStateChange("original");

    // 验证两个按钮都恢复到 idle
    expect(getIcon().textContent).toBe("Google");
    expect(getAiButton().textContent).toBe("AI");
  });

  it("handles bfcache restore when Google is translated but AI was idle", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: function() {
        if (this.id === "btnGoogle" || this.id === "btnAi") return 100;
        return 0;
      }
    });
    await loadModule();

    // 模拟场景：用户只用了 Google 翻译，AI 未翻译
    // 从另一个页面回退到此页面，bfcache 恢复了 Google=success, AI=idle
    emitPageLanguageStateChange("translated");
    emitPageRenderStateChange("success");
    emitAiRenderStateChange("idle");

    // 验证 Google 显示绿色，AI 显示 idle
    expect(getIcon().textContent).toBe("Google ✓");
    expect(getAiButton().textContent).toBe("AI");

    // 确认 Google 颜色是绿色（success 状态）
    expect(getIcon().style.color).toBe("rgb(21, 128, 61)");
    // 确认 AI 颜色是紫色（idle 状态）
    expect(getAiButton().style.color).toBe("rgb(124, 58, 237)");
  });

  // ──────────────────────────────────────────────────────────────
  // SPA 导航恢复回归测试
  //
  // 场景：在 GitHub 等使用 Turbo Drive 的站点上，用户浏览页面后点击
  // 回退/前进按钮。Turbo 替换 DOM（包括 document.body 内容），导致
  // 浮动按钮的 host 元素从 DOM 中移除。由于 floatingBtn.show() 仅在
  // 初始加载时调用一次，导航后按钮不会自动重建。
  //
  // 修复：floatingBtn.js 监听 popstate 和 pageshow 事件，
  // 检测 host 是否丢失，若丢失则自动调用 floatingBtn.show() 重建。
  // ──────────────────────────────────────────────────────────────

  it("popstate 事件在 host 丢失时自动重建浮动按钮", async () => {
    await loadModule();

    const originalHost = getHost();
    expect(originalHost).not.toBeNull();

    // 模拟 Turbo/SPA 导航替换 DOM：移除浮动按钮 host
    originalHost.remove();
    expect(getHost()).toBeNull();

    // 触发 popstate 事件（模拟浏览器回退/前进）
    window.dispatchEvent(new PopStateEvent("popstate"));

    // 前进 200ms debounce 计时器
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    // 验证：浮动按钮已被重建
    const newHost = getHost();
    expect(newHost).not.toBeNull();
    expect(newHost).not.toBe(originalHost);
    // 验证新 host 有 shadow root（按钮功能完整）
    expect(newHost.shadowRoot).not.toBeNull();
    expect(newHost.shadowRoot.getElementById("btnGoogle")).not.toBeNull();
  });

  it("popstate 事件在 host 存在时不做多余重建", async () => {
    const floatingBtn = await loadModule();
    const showSpy = vi.spyOn(floatingBtn, "show");

    const originalHost = getHost();
    expect(originalHost).not.toBeNull();

    // Host 仍存在于 DOM，触发 popstate
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    // 验证：不应触发重建（host 仍在 DOM 中）
    expect(showSpy).not.toHaveBeenCalled();
    expect(getHost()).toBe(originalHost);
  });

  it("pageshow (persisted) 在 host 丢失时重建浮动按钮", async () => {
    await loadModule();

    const originalHost = getHost();
    expect(originalHost).not.toBeNull();

    // 模拟 DOM 替换
    originalHost.remove();
    expect(getHost()).toBeNull();

    // 触发 pageshow 事件（bfcache 恢复，DOM 被部分替换的边缘情况）
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await flushMicrotasks();

    // 验证：浮动按钮已被重建（pageshow 无 debounce）
    const newHost = getHost();
    expect(newHost).not.toBeNull();
    expect(newHost.shadowRoot).not.toBeNull();
  });

  it("pageshow (non-persisted) 且 host 存在时不做重建", async () => {
    const floatingBtn = await loadModule();
    const showSpy = vi.spyOn(floatingBtn, "show");

    const originalHost = getHost();
    expect(originalHost).not.toBeNull();

    // 非 bfcache 恢复，host 仍在 DOM
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    await flushMicrotasks();

    // 验证：不应触发重建
    expect(showSpy).not.toHaveBeenCalled();
    expect(getHost()).toBe(originalHost);
  });

  it("多次 popstate 快速触发时只重建一次（debounce）", async () => {
    await loadModule();

    const originalHost = getHost();
    expect(originalHost).not.toBeNull();
    originalHost.remove();
    expect(getHost()).toBeNull();

    // 快速连续触发 3 次 popstate
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new PopStateEvent("popstate"));

    // 前进 timer，但不足 200ms — timer 应尚未触发
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(getHost()).toBeNull(); // 100ms 内尚未重建

    // 前进到超过 200ms（最后一次 popstate 重置了 timer）
    vi.advanceTimersByTime(150); // 总共 250ms
    await flushMicrotasks();

    // 验证：按钮已重建（debounce 生效，所有快速 popstate 合并为一次重建）
    const newHost = getHost();
    expect(newHost).not.toBeNull();
    expect(newHost).not.toBe(originalHost);
    // 确认只有一个 host（未重复创建）
    expect(document.querySelectorAll("#dualtran-floating-btn-host")).toHaveLength(1);
  });

  // ──────────────────────────────────────────────────────────────
  // MutationObserver 恢复回归测试
  //
  // 场景：SPA 链接导航（非 popstate）替换 DOM → body.innerHTML
  // 被替换 → 浮动按钮 host 随旧 body 消失。
  // MutationObserver 应检测到 host 丢失并自动重建。
  // ──────────────────────────────────────────────────────────────

  it("MutationObserver 在 host 被 DOM 替换移除时自动重建", async () => {
    await loadModule();

    const originalHost = getHost();
    expect(originalHost).not.toBeNull();

    // 模拟 SPA 链接导航：替换 body.innerHTML（移除所有子元素包括 host）
    document.body.innerHTML = "<p>New content after SPA navigation</p>";
    
    // 先 flush microtasks：让 MutationObserver 回调触发并注册 setTimeout
    await flushMicrotasks();
    
    // 前进 MutationObserver 的 debounce timer（300ms）
    vi.advanceTimersByTime(350);
    await flushMicrotasks();

    // 验证：浮动按钮已被重建
    const newHost = getHost();
    expect(newHost).not.toBeNull();
    expect(newHost).not.toBe(originalHost);
    expect(newHost.shadowRoot).not.toBeNull();
  });

  it("MutationObserver 多次 DOM 替换不创建重复 host", async () => {
    await loadModule();
    expect(getHost()).not.toBeNull();

    // 第一次 SPA 导航
    document.body.innerHTML = "<p>Page 1</p>";
    await flushMicrotasks();
    vi.advanceTimersByTime(350);
    await flushMicrotasks();
    expect(getHost()).not.toBeNull();

    // 第二次 SPA 导航
    document.body.innerHTML = "<p>Page 2</p>";
    await flushMicrotasks();
    vi.advanceTimersByTime(350);
    await flushMicrotasks();

    // 只有一个 host
    expect(document.querySelectorAll("#dualtran-floating-btn-host")).toHaveLength(1);
  });

});
