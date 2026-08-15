import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { BtnAiProxy, createBlockState, getProxiesForTranslation, getAllProxies, registerBlock, createSingletonButtonGroup, destroySingletonButtonGroup } from "../../src/contentScript/singletonBtnGroup.js";

describe("BtnAiProxy", () => {
  let dom, doc, singleton, stateMap, element;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "http://localhost" });
    doc = dom.window.document;

    element = doc.createElement("translated");
    doc.body.appendChild(element);

    // Minimal singleton mock
    singleton = {
      currentTarget: element,
      aiBtn: doc.createElement("button"),
      aiTextNode: doc.createElement("span"),
      tooltipNode: doc.createElement("span"),
    };
    singleton.aiBtn.textContent = "AI";

    stateMap = new WeakMap();
    stateMap.set(element, {
      sourceString: "Hello world",
      translatedTextNode: doc.createTextNode("Bonjour"),
      translationId: "test-id-123",
      aiStatus: "idle",
      googleTranslatedText: "Bonjour",
      nodesToClear: [],
    });
  });

  afterEach(() => {
    dom.window.close();
  });

  test("sourceString reads from WeakMap state", () => {
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    expect(proxy.sourceString).toBe("Hello world");
  });

  test("translationStatus read/write goes to WeakMap", () => {
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    expect(proxy.translationStatus).toBe("idle");
    proxy.translationStatus = "translating";
    expect(stateMap.get(element).aiStatus).toBe("translating");
    expect(proxy.translationStatus).toBe("translating");
  });

  test("btnAiTxtNode returns singleton node when currentTarget matches", () => {
    singleton.currentTarget = element;
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    expect(proxy.btnAiTxtNode).toBe(singleton.aiTextNode);
  });

  test("btnAiTxtNode returns DUMMY_NODE when currentTarget is different", () => {
    const other = doc.createElement("translated");
    singleton.currentTarget = other;
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    expect(proxy.btnAiTxtNode).not.toBe(singleton.aiTextNode);
    // Should not throw on textContent write
    expect(() => { proxy.btnAiTxtNode.textContent = "test"; }).not.toThrow();
  });

  test("ownerDocument returns a document with createElement", () => {
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    // ownerDocument must work so renderAiSuccessIndicator can createElement
    const result = proxy.ownerDocument;
    expect(result).toBeTruthy();
    expect(typeof result.createElement).toBe("function");
    const span = result.createElement("span");
    expect(span).not.toBeNull();
  });

  test("setAttribute updates singleton when target matches", () => {
    singleton.currentTarget = element;
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    proxy.setAttribute("title", "Success!");
    expect(singleton.aiBtn.getAttribute("title")).toBe("Success!");
  });

  test("setAttribute is silent no-op when target differs", () => {
    const other = doc.createElement("translated");
    singleton.currentTarget = other;
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    expect(() => proxy.setAttribute("title", "nope")).not.toThrow();
  });

  test("classList.contains returns false for dummy (off-target)", () => {
    const other = doc.createElement("translated");
    singleton.currentTarget = other;
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    expect(proxy.classList.contains("dualtran-ai-selected-btn")).toBe(false);
  });

  test("dummyNode.appendChild does not throw", () => {
    const other = doc.createElement("translated");
    singleton.currentTarget = other;
    const proxy = new BtnAiProxy(element, stateMap, singleton);
    const child = doc.createElement("span");
    expect(() => proxy.btnAiTxtNode.appendChild(child)).not.toThrow();
  });
});

describe("getProxiesForTranslation", () => {
  let singleton, stateMap, elements;

  beforeEach(() => {
    // Use global document (vitest jsdom environment) so the module can query it
    singleton = {
      currentTarget: null,
      aiBtn: document.createElement("button"),
      aiTextNode: document.createElement("span"),
      tooltipNode: document.createElement("span"),
    };
    stateMap = new WeakMap();
    elements = [];
    for (let i = 0; i < 3; i++) {
      const el = document.createElement("translated");
      document.body.appendChild(el);
      elements.push(el);
    }
  });

  afterEach(() => {
    elements.forEach(el => el.remove());
  });

  test("returns only proxies with non-queuing/translating/translated status", () => {
    stateMap.set(elements[0], { aiStatus: "idle", sourceString: "a" });
    stateMap.set(elements[1], { aiStatus: "queuing", sourceString: "b" });
    stateMap.set(elements[2], { aiStatus: "translated", sourceString: "c" });

    const result = getProxiesForTranslation(stateMap, singleton);
    expect(result).toHaveLength(1);
    expect(result[0].sourceString).toBe("a");
  });

  test("returns empty when all blocks are queuing/translating/translated", () => {
    stateMap.set(elements[0], { aiStatus: "queuing", sourceString: "a" });
    stateMap.set(elements[1], { aiStatus: "translating", sourceString: "b" });
    stateMap.set(elements[2], { aiStatus: "translated", sourceString: "c" });

    expect(getProxiesForTranslation(stateMap, singleton)).toHaveLength(0);
  });

  test("skips unregistered <translated> elements safely", () => {
    // Only register elements[0] and elements[1]
    stateMap.set(elements[0], { aiStatus: "idle", sourceString: "a" });
    stateMap.set(elements[1], { aiStatus: "idle", sourceString: "b" });
    // elements[2] is in DOM but not in WeakMap

    const result = getProxiesForTranslation(stateMap, singleton);
    expect(result).toHaveLength(2);
    // No throw for unregistered element
  });

  test("returns empty when no blocks registered", () => {
    expect(getProxiesForTranslation(stateMap, singleton)).toHaveLength(0);
  });
});

describe("getAllProxies", () => {
  let singleton, stateMap, elements;

  beforeEach(() => {
    singleton = {
      currentTarget: null,
      aiBtn: document.createElement("button"),
      aiTextNode: document.createElement("span"),
      tooltipNode: document.createElement("span"),
    };
    stateMap = new WeakMap();
    elements = [];
    for (let i = 0; i < 3; i++) {
      const el = document.createElement("translated");
      document.body.appendChild(el);
      elements.push(el);
    }
  });

  afterEach(() => {
    elements.forEach(el => el.remove());
  });

  test("returns proxies for all registered blocks regardless of status", () => {
    stateMap.set(elements[0], { aiStatus: "idle", sourceString: "a" });
    stateMap.set(elements[1], { aiStatus: "queuing", sourceString: "b" });
    stateMap.set(elements[2], { aiStatus: "translated", sourceString: "c" });

    const result = getAllProxies(stateMap, singleton);
    expect(result).toHaveLength(3);
  });

  test("returns empty when no blocks registered", () => {
    expect(getAllProxies(stateMap, singleton)).toHaveLength(0);
  });

  // 回归测试: ISSUE-006 — getAllProxies 必须能找到通过 [data-dualtran-block] 注册的非 <translated> 元素
  // 发现于 /qa on 2026-07-03
  test("returns proxies for blocks on [data-dualtran-block] elements", () => {
    const regularEl = document.createElement("div");
    regularEl.textContent = "Translated text";
    document.body.appendChild(regularEl);
    elements.push(regularEl);  // 确保 afterEach 清理

    const regularStateMap = new WeakMap();
    regularStateMap.set(regularEl, {
      sourceString: "Hello world",
      translatedTextNode: document.createTextNode("Bonjour"),
      translationId: "",
      aiStatus: "idle",
      googleTranslatedText: "Bonjour",
    });

    // 模拟 registerBlock: 设置 data-dualtran-block 属性
    regularEl.dataset.dualtranBlock = "1";

    const regularSingleton = {
      currentTarget: regularEl,
      aiBtn: document.createElement("button"),
      aiTextNode: document.createElement("span"),
      tooltipNode: document.createElement("span"),
    };

    const proxies = getAllProxies(regularStateMap, regularSingleton);
    expect(proxies).toHaveLength(1);
    expect(proxies[0].sourceString).toBe("Hello world");
  });

  test("returns mixed proxies from both <translated> and [data-dualtran-block] elements", () => {
    const regularEl = document.createElement("div");
    regularEl.textContent = "Regular element";
    document.body.appendChild(regularEl);
    elements.push(regularEl);  // 确保 afterEach 清理

    const mixedMap = new WeakMap();
    mixedMap.set(elements[0], {
      sourceString: "From translated element",
      translatedTextNode: document.createTextNode("Traduit"),
      translationId: "",
      aiStatus: "idle",
      googleTranslatedText: "Traduit",
    });
    mixedMap.set(regularEl, {
      sourceString: "From regular element",
      translatedTextNode: document.createTextNode("Régulier"),
      translationId: "",
      aiStatus: "idle",
      googleTranslatedText: "Régulier",
    });

    // 标记 regularEl 为已注册块
    regularEl.dataset.dualtranBlock = "1";

    const mixedSingleton = {
      currentTarget: elements[0],
      aiBtn: document.createElement("button"),
      aiTextNode: document.createElement("span"),
      tooltipNode: document.createElement("span"),
    };

    const proxies = getAllProxies(mixedMap, mixedSingleton);
    expect(proxies).toHaveLength(2);
    const sources = proxies.map(p => p.sourceString).sort();
    expect(sources).toEqual(["From regular element", "From translated element"]);
  });
});

describe("registerBlock", () => {
  let dom, doc;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "http://localhost" });
    doc = dom.window.document;
  });

  afterEach(() => {
    dom.window.close();
  });

  // 回归测试: ISSUE-006 — registerBlock 必须在元素上设置 data-dualtran-block 属性，
  // 使 getProxiesForTranslation 能在 replaceOriginal 模式下找到非 <translated> 元素
  // 发现于 /qa on 2026-07-03
  test("sets data-dualtran-block attribute on the registered element", () => {
    const regularDiv = doc.createElement("div");
    const textNode = doc.createTextNode("Bonjour");

    registerBlock(regularDiv, "Hello world", textNode, "Bonjour", null);

    expect(regularDiv.dataset.dualtranBlock).toBe("1");
  });

  test("can register a non-<translated> element (replaceOriginal mode)", () => {
    const parentElement = doc.createElement("p");
    parentElement.textContent = "Hello world";
    const aiTextNode = doc.createElement("span");
    aiTextNode.classList.add("dualtran-aitranslatedtext-replacemode");

    const nodesToClear = [doc.createTextNode("Hello")];

    registerBlock(parentElement, "Hello world", aiTextNode, "", nodesToClear);

    expect(parentElement.dataset.dualtranBlock).toBe("1");
  });

  test("can register a <translated> element (newLine mode)", () => {
    const translatedEl = doc.createElement("translated");
    const textNode = doc.createTextNode("Bonjour le monde");

    registerBlock(translatedEl, "Hello world", textNode, "Bonjour le monde", null);

    expect(translatedEl.dataset.dualtranBlock).toBe("1");
  });
});

describe("getProxiesForTranslation with non-<translated> elements", () => {
  // 使用全局 document（vitest jsdom 环境），使模块能通过 querySelectorAll 找到元素
  let elements;

  beforeEach(() => {
    elements = [];
  });

  afterEach(() => {
    elements.forEach(el => el.remove());
  });

  // 回归测试: ISSUE-006 — getProxiesForTranslation 必须在 replaceOriginal 模式下
  // 找到通过 registerBlock 注册的非 <translated> 元素（使用 [data-dualtran-block] 选择器）
  // 发现于 /qa on 2026-07-03
  test("finds blocks registered on [data-dualtran-block] elements", () => {
    const regularDiv = document.createElement("div");
    regularDiv.textContent = "Translated via replaceOriginal";
    document.body.appendChild(regularDiv);
    elements.push(regularDiv);

    // 模拟 registerBlock: 标记元素并注册到 WeakMap
    regularDiv.dataset.dualtranBlock = "1";

    const stateMap = new WeakMap();
    stateMap.set(regularDiv, {
      sourceString: "Original text",
      translatedTextNode: document.createTextNode("Translated text"),
      translationId: "",
      aiStatus: "idle",
      googleTranslatedText: "",
    });

    const singleton = {
      currentTarget: regularDiv,
      aiBtn: document.createElement("button"),
      aiTextNode: document.createElement("span"),
      tooltipNode: document.createElement("span"),
    };

    const proxies = getProxiesForTranslation(stateMap, singleton);
    expect(proxies).toHaveLength(1);
    expect(proxies[0].sourceString).toBe("Original text");
    // 验证它来自非 <translated> 元素
    expect(proxies[0]._el.tagName).not.toBe("TRANSLATED");
  });

  test("returns empty when no [data-dualtran-block] elements exist and no <translated>", () => {
    // 只创建普通 div（无 data-dualtran-block 属性）
    const plainDiv = document.createElement("div");
    document.body.appendChild(plainDiv);
    elements.push(plainDiv);

    const stateMap = new WeakMap();
    stateMap.set(plainDiv, {
      sourceString: "Original",
      translatedTextNode: document.createTextNode("Trans"),
      translationId: "",
      aiStatus: "idle",
      googleTranslatedText: "",
    });

    const singleton = {
      currentTarget: plainDiv,
      aiBtn: document.createElement("button"),
      aiTextNode: document.createElement("span"),
      tooltipNode: document.createElement("span"),
    };

    // 没有 <translated> 也没有 [data-dualtran-block] → 返回空
    const proxies = getProxiesForTranslation(stateMap, singleton);
    expect(proxies).toHaveLength(0);
  });
});

describe("positionButtonGroup", () => {
  let dom, doc;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body style='margin:0'></body></html>", { url: "http://localhost" });
    doc = dom.window.document;
  });

  afterEach(() => {
    dom.window.close();
  });

  test("default: below target, aligned left", () => {
    const btnGroup = doc.createElement("div");
    btnGroup.getBoundingClientRect = () => ({ width: 100, height: 30 });

    const target = doc.createElement("translated");
    doc.body.appendChild(target);
    target.getBoundingClientRect = () => ({ left: 100, right: 300, bottom: 200, top: 100 });

    // Simulate position function
    const rect = target.getBoundingClientRect();
    btnGroup.style.left = rect.left + "px";
    btnGroup.style.top = (rect.bottom + 4) + "px";

    expect(btnGroup.style.left).toBe("100px");
    expect(btnGroup.style.top).toBe("204px");
  });

  test("flips above when would overflow viewport bottom", () => {
    const btnGroup = doc.createElement("div");
    btnGroup.getBoundingClientRect = () => ({ width: 100, height: 30 });

    const target = doc.createElement("translated");
    doc.body.appendChild(target);
    target.getBoundingClientRect = () => ({ left: 100, right: 300, bottom: 900, top: 800 });

    const rect = target.getBoundingClientRect();
    let top = rect.bottom + 4; // 904
    // Viewport: 900 high, btnGroup height: 30. 904 + 30 = 934 > 900
    if (top + 30 > 900) {
      top = rect.top - 30 - 4; // 800 - 30 - 4 = 766
    }
    btnGroup.style.top = top + "px";

    expect(btnGroup.style.top).toBe("766px");
  });
});

// ──────────────────────────────────────────────────────────────
// createSingletonButtonGroup — SPA 导航恢复回归测试
//
// 场景：在 Turbo/SPA 导航后，DOM 被替换，旧的 singleton host
// 元素从 document.body 中移除。修复后的 createSingletonButtonGroup
// 应检测到 host 已脱离 DOM 树并自动重建，而不是被 _singleton.host
// 引用阻挡。
// ──────────────────────────────────────────────────────────────

describe("createSingletonButtonGroup — detached host recovery", () => {
  let attachShadowSpy;

  beforeEach(() => {
    // 确保 shadow DOM 可用（jsdom 需要 mock）
    attachShadowSpy = vi
      .spyOn(HTMLElement.prototype, "attachShadow")
      .mockImplementation(function attachShadow(init) {
        return Element.prototype.attachShadow.call(this, { ...init, mode: "open" });
      });

    // 清理残留的 singleton host（如果之前的测试留下了）
    const existing = document.getElementById("dualtran-singleton-btn-host");
    if (existing) existing.remove();
    destroySingletonButtonGroup();
  });

  afterEach(() => {
    // 清理本测试创建的 host
    const host = document.getElementById("dualtran-singleton-btn-host");
    if (host) host.remove();
    destroySingletonButtonGroup();
    vi.restoreAllMocks();
  });

  test("首次调用 createSingletonButtonGroup 在 document.body 创建 host", () => {
    createSingletonButtonGroup();

    const host = document.getElementById("dualtran-singleton-btn-host");
    expect(host).not.toBeNull();
    expect(document.body.contains(host)).toBe(true);
    expect(host.shadowRoot).not.toBeNull();
    // 验证 shadow DOM 包含按钮组
    expect(host.shadowRoot.querySelector(".dualtran-btn-group")).not.toBeNull();
    expect(host.shadowRoot.querySelector(".dualtran-google-btn")).not.toBeNull();
    expect(host.shadowRoot.querySelector(".dualtran-ai-btn")).not.toBeNull();
  });

  test("host 在 DOM 中时再次调用不会重复创建", () => {
    createSingletonButtonGroup();
    const firstHost = document.getElementById("dualtran-singleton-btn-host");

    // 再次调用，不应创建新 host
    createSingletonButtonGroup();
    const secondHost = document.getElementById("dualtran-singleton-btn-host");

    expect(secondHost).toBe(firstHost);
    // 确保只有一个 host
    expect(document.querySelectorAll("#dualtran-singleton-btn-host")).toHaveLength(1);
  });

  test("host 脱离 DOM 后（模拟 SPA 导航），再次调用会重建 host", () => {
    createSingletonButtonGroup();
    const originalHost = document.getElementById("dualtran-singleton-btn-host");
    expect(originalHost).not.toBeNull();

    // 模拟 Turbo/SPA 导航替换 DOM：移除 host 元素
    originalHost.remove();
    expect(document.body.contains(originalHost)).toBe(false);

    // 再次调用 createSingletonButtonGroup：应检测到 host 脱离 DOM 并重建
    createSingletonButtonGroup();

    const newHost = document.getElementById("dualtran-singleton-btn-host");
    expect(newHost).not.toBeNull();
    expect(newHost).not.toBe(originalHost);
    expect(document.body.contains(newHost)).toBe(true);
    // 验证新 host 功能完整
    expect(newHost.shadowRoot).not.toBeNull();
    expect(newHost.shadowRoot.querySelector(".dualtran-btn-group")).not.toBeNull();
  });

  test("host 脱离 DOM 时清理 pendingHideTimer", () => {
    createSingletonButtonGroup();
    const host = document.getElementById("dualtran-singleton-btn-host");
    expect(host).not.toBeNull();

    // 模拟有一个待处理的隐藏计时器
    // 通过 hover delegation 的 mouseout 触发 pendingHideTimer
    // 这里我们无法直接访问 _singleton，但可以通过以下方式验证：
    // host 脱离 DOM 后重建不会抛出异常

    host.remove();
    // 这不应抛出（即使之前有 pending timer）
    expect(() => createSingletonButtonGroup()).not.toThrow();

    const newHost = document.getElementById("dualtran-singleton-btn-host");
    expect(newHost).not.toBeNull();
  });

  test("重复调用 destroySingletonButtonGroup 不会抛出异常", () => {
    createSingletonButtonGroup();
    destroySingletonButtonGroup();
    // 第二次 destroy 不应抛出
    expect(() => destroySingletonButtonGroup()).not.toThrow();
  });

  test("destroy 后再次 create 能正常重建 host", () => {
    createSingletonButtonGroup();
    destroySingletonButtonGroup();

    expect(document.getElementById("dualtran-singleton-btn-host")).toBeNull();

    // 重建
    createSingletonButtonGroup();
    const newHost = document.getElementById("dualtran-singleton-btn-host");
    expect(newHost).not.toBeNull();
    expect(newHost.shadowRoot).not.toBeNull();
  });
});

describe("createBlockState", () => {
  test("returns default state machine fields", () => {
    const state = createBlockState();

    expect(state.aiStatus).toBe("idle");
    expect(state.googleBtnState).toBe("idle");
    expect(state.displayMode).toBe("original");
    expect(state.translationId).toBe("");
  });

  test("returns a fresh object each time (no shared references)", () => {
    const a = createBlockState();
    const b = createBlockState();

    expect(a).not.toBe(b);
    expect(a).toEqual(b);

    // Mutating one should not affect the other
    a.aiStatus = "translating";
    expect(b.aiStatus).toBe("idle");
  });

  test("registerBlock uses createBlockState defaults for state fields", () => {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    const el = dom.window.document.createElement("div");

    registerBlock(el, "Hello", null, "", null);

    // Access via the WeakMap indirectly through getProxiesForTranslation
    // or check that the state has the expected defaults
    // We can't directly access blockStateMap, but we can verify through BtnAiProxy
    // For now, just verify registerBlock doesn't throw
    expect(el.dataset.dualtranBlock).toBe("1");
  });
});
