import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { configValues, configChangeCallbacks, platformState } = vi.hoisted(() => ({
  configValues: {
    showOriginalTextWhenHovering: "yes",
    darkMode: "no",
  },
  configChangeCallbacks: [],
  platformState: {
    isMobile: false,
  },
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: vi.fn((key, value) => {
      configValues[key] = value;
    }),
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
  pageTranslator: {
    translatePage: vi.fn(),
    restorePage: vi.fn(),
    onPageLanguageStateChange: vi.fn(),
    onGetOriginalTabLanguage: vi.fn(),
  },
  backgroundTranslateSingleText: vi.fn(),
  aiTranslateText: vi.fn(),
}));

function emitConfigChange(name, value) {
  configValues[name] = value;
  configChangeCallbacks.forEach((callback) => callback(name, value));
}

async function flushMicrotasks(times = 5) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("showOriginal", () => {
  let attachShadowSpy;
  let addEventListenerSpy;
  let removeEventListenerSpy;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    configChangeCallbacks.length = 0;
    configValues.showOriginalTextWhenHovering = "yes";
    configValues.darkMode = "no";
    platformState.isMobile = false;

    document.body.innerHTML = "";
    document.head.innerHTML = "";

    attachShadowSpy = vi
      .spyOn(HTMLElement.prototype, "attachShadow")
      .mockImplementation(function attachShadow(init) {
        return Element.prototype.attachShadow.call(this, { ...init, mode: "open" });
      });

    addEventListenerSpy = vi.spyOn(document, "addEventListener");
    removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

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
        text: () => Promise.resolve("#originalText { color: black; }"),
      })
    );
    globalThis.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    window.isTranslatingSelected = false;
  });

  afterEach(() => {
    vi.restoreAllMocks(); // 恢复原型级 mock（如 HTMLElement.prototype.attachShadow）
    vi.useRealTimers();
  });

  async function loadModule() {
    const module = await import("../../src/contentScript/showOriginal.js");
    await flushMicrotasks();
    return module.default;
  }

  function getOverlayHost() {
    return document.body.querySelector("div.notranslate");
  }

  async function showTooltip(showOriginal, node, pointer = { x: 24, y: 32 }) {
    showOriginal.enable();
    showOriginal.add(node);
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: pointer.x,
        clientY: pointer.y,
      })
    );
    node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();
    return getOverlayHost();
  }

  // 修复: 原测试用 toBeTypeOf("function") 永远通过，替换为行为验证
  it("imports and exports the showOriginal object with callable public methods", async () => {
    const showOriginal = await loadModule();

    expect(showOriginal).toBeTypeOf("object");
    expect(showOriginal).toHaveProperty("enable");
    expect(showOriginal).toHaveProperty("disable");
    expect(showOriginal).toHaveProperty("add");
    expect(showOriginal).toHaveProperty("removeAll");
    // 验证方法可调用而不抛出（比纯类型检查更有意义）
    expect(() => showOriginal.enable()).not.toThrow();
    expect(() => showOriginal.disable()).not.toThrow();
    expect(() => showOriginal.removeAll()).not.toThrow();
  });

  it("turns all public methods into no-ops on mobile", async () => {
    platformState.isMobile = true;
    const showOriginal = await loadModule();

    const node = document.createElement("span");
    node.textContent = "hello";

    expect(() => {
      showOriginal.enable();
      showOriginal.add(node);
      showOriginal.removeAll();
      showOriginal.disable();
    }).not.toThrow();
    expect(attachShadowSpy).not.toHaveBeenCalled();
    expect(getOverlayHost()).toBeNull();
  });

  it("enable creates the tooltip shadow root and registers document listeners", async () => {
    const showOriginal = await loadModule();

    showOriginal.enable();

    expect(attachShadowSpy).toHaveBeenCalledOnce();
    expect(addEventListenerSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });

  it("disable removes the displayed tooltip and unregisters listeners", async () => {
    const showOriginal = await loadModule();
    const node = document.createElement("span");
    node.textContent = "original";
    document.body.appendChild(node);

    const overlayHost = await showTooltip(showOriginal, node);
    expect(overlayHost).not.toBeNull();

    showOriginal.disable();

    expect(getOverlayHost()).toBeNull();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });

  it("add stores the node original text for later hover display", async () => {
    const showOriginal = await loadModule();
    const node = document.createElement("span");
    node.textContent = "original text";
    document.body.appendChild(node);

    showOriginal.enable();
    showOriginal.add(node);
    node.textContent = "translated text";

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 12, clientY: 18 })
    );
    node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();

    const overlayRoot = getOverlayHost()?.shadowRoot;
    expect(overlayRoot?.getElementById("originalText")?.textContent).toBe("original text");
  });

  it("removeAll clears tracked nodes so hovering no longer shows a tooltip", async () => {
    const showOriginal = await loadModule();
    const node = document.createElement("span");
    node.textContent = "hello";
    document.body.appendChild(node);

    showOriginal.enable();
    showOriginal.add(node);
    showOriginal.removeAll();

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 14, clientY: 22 })
    );
    node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();

    expect(getOverlayHost()).toBeNull();
  });

  it("reacts to showOriginalTextWhenHovering config changes by enabling the feature", async () => {
    configValues.showOriginalTextWhenHovering = "no";
    const showOriginal = await loadModule();
    const enabledObserver = vi.fn();

    showOriginal.enabledObserverSubscribe(enabledObserver);
    emitConfigChange("showOriginalTextWhenHovering", "yes");
    await flushMicrotasks();

    expect(showOriginal.isEnabled).toBe(true);
    expect(attachShadowSpy).toHaveBeenCalledOnce();
    expect(enabledObserver).toHaveBeenCalledOnce();
  });

  it("shows original text on hover after config change from no to yes", async () => {
    // 初始设置为"no"，模拟用户尚未开启此功能
    configValues.showOriginalTextWhenHovering = "no";
    const showOriginal = await loadModule();

    // 用户在options页将设置改为"yes"
    emitConfigChange("showOriginalTextWhenHovering", "yes");
    await flushMicrotasks();

    // 模拟翻译后的节点
    const node = document.createElement("span");
    node.textContent = "translated text";
    document.body.appendChild(node);

    // 将节点添加到showOriginal追踪列表（模拟翻译完成后的add调用）
    showOriginal.add(node);
    // 保存原始文本（add时记录的是当前textContent）
    // 模拟实际场景：add时记录原文，之后节点被替换为译文
    // 这里直接测试add之后hover是否能显示已保存的文本

    const overlayHost = await showTooltip(showOriginal, node);
    expect(overlayHost).not.toBeNull();

    const overlayRoot = overlayHost.shadowRoot;
    expect(overlayRoot.getElementById("originalText").textContent).toBe(
      "translated text"
    );
  });

  it("does not show tooltip when showOriginalTextWhenHovering is no", async () => {
    configValues.showOriginalTextWhenHovering = "no";
    const showOriginal = await loadModule();

    const node = document.createElement("span");
    node.textContent = "hello";
    document.body.appendChild(node);

    // enable() 应该不创建div（因为设置为"no"）
    showOriginal.enable();
    showOriginal.add(node);

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 })
    );
    node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();

    // 设置为"no"时，不应该显示tooltip
    expect(getOverlayHost()).toBeNull();
  });

  it("toggling config from yes to no to yes preserves full hover behavior", async () => {
    configValues.showOriginalTextWhenHovering = "yes";
    const showOriginal = await loadModule();

    const node = document.createElement("span");
    node.textContent = "original";
    document.body.appendChild(node);

    // 初始状态：功能开启，可以正常工作
    const overlayHost1 = await showTooltip(showOriginal, node);
    expect(overlayHost1).not.toBeNull();

    // 关闭功能
    emitConfigChange("showOriginalTextWhenHovering", "no");
    await flushMicrotasks();
    expect(showOriginal.isEnabled).toBe(false);

    // 重新开启功能
    emitConfigChange("showOriginalTextWhenHovering", "yes");
    await flushMicrotasks();
    expect(showOriginal.isEnabled).toBe(true);

    // 模拟 pageTranslator.translatePage() 的重新翻译流程：
    //   showOriginal.enable() → disable(false) → removeAll()（清除旧追踪节点）
    //   翻译结果回来后调用 showOriginal.add(node)
    showOriginal.enable();
    showOriginal.add(node);

    // 悬停验证（不再调用 showTooltip 避免重复调用 enable() 清除节点）
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 24, clientY: 32 })
    );
    node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();

    const overlayHost2 = getOverlayHost();
    expect(overlayHost2).not.toBeNull();

    const overlayRoot = overlayHost2.shadowRoot;
    expect(overlayRoot.getElementById("originalText").textContent).toBe(
      "original"
    );
  });

  it("adds dark mode styles when darkMode is yes", async () => {
    configValues.darkMode = "yes";
    const showOriginal = await loadModule();

    showOriginal.enable();

    const shadowRoots = attachShadowSpy.mock.results.map((result) => result.value);
    const tooltipRoot = shadowRoots.at(-1);
    expect(tooltipRoot.getElementById("darkModeElement")).not.toBeNull();
  });

  it("enables dark mode automatically when system preference is dark", async () => {
    configValues.darkMode = "auto";
    globalThis.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const showOriginal = await loadModule();

    showOriginal.enable();

    const shadowRoots = attachShadowSpy.mock.results.map((result) => result.value);
    const tooltipRoot = shadowRoots.at(-1);
    expect(tooltipRoot.getElementById("darkModeElement")).not.toBeNull();
  });

  it("does not add dark mode styles when darkMode is no", async () => {
    configValues.darkMode = "no";
    const showOriginal = await loadModule();

    showOriginal.enable();

    const shadowRoots = attachShadowSpy.mock.results.map((result) => result.value);
    const tooltipRoot = shadowRoots.at(-1);
    expect(tooltipRoot.getElementById("darkModeElement")).toBeNull();
  });
});
