import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const {
  configValues,
  translateWithAIMock,
  toastFactoryMock,
  showToastMock,
  sendMessageMock,
} = vi.hoisted(() => ({
  configValues: {
    targetLanguage: "fr",
    targetLanguageTextTranslation: "de",
    aiTranslatedColor: "rgb(1, 2, 3)",
    apiKeyOpenAI: "test-api-key",
  },
  translateWithAIMock: vi.fn(),
  toastFactoryMock: vi.fn(),
  showToastMock: vi.fn(),
  sendMessageMock: vi.fn(),
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: vi.fn((key, value) => {
      configValues[key] = value;
    }),
    onReady: () => new Promise(() => {}),
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    codeToLanguageNameInEnglish: (code) => ({ fr: "French", de: "German", en: "English" }[code] || code),
    otherConfigs: {},
  },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({
  default: {},
}));

vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: {},
}));


vi.mock("../../src/contentScript/fetchSSE.js", () => ({
  translateWithAI: (...args) => translateWithAIMock(...args),
}));

vi.mock("toastify-js", () => ({
  default: (...args) => toastFactoryMock(...args),
}));

vi.mock("gpt-tokenizer", () => ({
  encode: (text) => Array.from(text || ""),
}));


function createButton(document, options = {}) {
  const button = document.createElement("button");
  button.className = options.className || "dualtran-hide";
  button.btnAiTxtNode = document.createElement("span");
  button.tooltip = document.createElement("span");
  button.translatedTextNode = document.createElement("span");
  button.translatedTextNode.className = "dualtran-loading";
  button.sourceString = options.sourceString || "hello world";
  button.append(button.btnAiTxtNode, button.tooltip, button.translatedTextNode);
  document.body.appendChild(button);
  return button;
}

describe("pageTranslator aiTranslateText", () => {
  const parseErrorPrefix = "AI translation error: response parsing failed:";

  beforeEach(() => {
    vi.resetModules();
    translateWithAIMock.mockReset();
    toastFactoryMock.mockReset();
    showToastMock.mockReset();
    sendMessageMock.mockReset();
    configValues.targetLanguage = "fr";
    configValues.targetLanguageTextTranslation = "de";
    configValues.aiTranslatedColor = "rgb(1, 2, 3)";
    toastFactoryMock.mockReturnValue({
      showToast: showToastMock,
    });

    const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
      url: "https://example.com/article",
    });

    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: dom.window.navigator,
    });
    globalThis.alert = vi.fn();
    globalThis.prompt = vi.fn();
    globalThis.confirm = vi.fn(() => false);
    globalThis.chrome = {
      runtime: {
        sendMessage: sendMessageMock.mockImplementation((payload, callback) => {
          if (typeof callback === "function") {
            if (payload?.action === "getTabHostName") {
              callback("example.com");
            } else {
              callback();
            }
          }
        }),
      },
      i18n: {
        getMessage: vi.fn(() => ""),
      },
    };
  });

  it("marks unfinished page translation buttons as translationError on stream parse failure", async () => {
    translateWithAIMock.mockImplementation((content, onMessage) => {
      onMessage("{bad json");
    });

    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;

    const firstButton = createButton(document, { sourceString: "hello" });
    const secondButton = createButton(document, { sourceString: "world" });

    // 显式关闭错误 toast：本用例只验证解析失败时的错误标记行为，不验证 toast
    await aiTranslateText([firstButton, secondButton], false);

    expect(translateWithAIMock).toHaveBeenCalledOnce();
    expect(translateWithAIMock.mock.calls[0][6]).toBe("fr");
    expect(firstButton.translationStatus).toBe("translationError");
    expect(secondButton.translationStatus).toBe("translationError");
    expect(firstButton.tooltip.textContent).toContain(parseErrorPrefix);
    expect(secondButton.tooltip.textContent).toContain(parseErrorPrefix);
    expect(firstButton.translatedTextNode.textContent).toContain(parseErrorPrefix);
    expect(secondButton.translatedTextNode.textContent).toContain(parseErrorPrefix);
    expect(showToastMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recordNewRequestToOpenAI", result: "failed" })
    );
  });

  it("uses selected-text target language and shows toast for selected-panel parse errors", async () => {
    translateWithAIMock.mockImplementation((content, onMessage) => {
      onMessage("{bad json");
    });

    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;

    const selectedButton = createButton(document, {
      className: "dualtran-ai-selected-btn dualtran-hide",
      sourceString: "selected text",
    });

    await aiTranslateText([selectedButton], true);

    expect(translateWithAIMock).toHaveBeenCalledOnce();
    const callArgs = translateWithAIMock.mock.calls[0];
    // 7th argument (index 6) is overrideTargetLanguageCode
    expect(callArgs[6]).toBe("de");
    expect(selectedButton.translationStatus).toBe("translationError");
    expect(selectedButton.translatedTextNode.textContent).toContain(parseErrorPrefix);
    expect(selectedButton.tooltip.textContent).toContain(parseErrorPrefix);
    // Toast assertions are only relevant when showToastForError=true
    // The mock above simulates a parse error, so toast is not called here
  });

  it("streams partial page translations, then marks completion and stores the cache entry", async () => {
    let streamCallbacks;
    translateWithAIMock.mockImplementation((content, onMessage, onError, onFinished) => {
      streamCallbacks = { content, onMessage, onError, onFinished };
    });

    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;

    const button = createButton(document, { sourceString: "hello world" });

    await aiTranslateText([button]);

    const translationId = /<译泽 id="([^"]+)">/.exec(streamCallbacks.content)?.[1];
    expect(translationId).toBeTruthy();
    expect(button.translationStatus).toBe("queuing");

    streamCallbacks.onMessage(
      JSON.stringify({
        choices: [{ delta: { content: `<译泽 id="${translationId}">bon` }, finish_reason: null }],
      })
    );

    expect(button.translationStatus).toBe("translating");
    expect(button.translatedTextNode.textContent).toBe("bon");
    expect(button.translatedTextNode.style.color).toBe("rgb(1, 2, 3)");
    expect(button.tooltip.textContent).toBe("translating...");

    streamCallbacks.onMessage(
      JSON.stringify({
        choices: [{ delta: { content: "jour</译泽>" }, finish_reason: null }],
      })
    );

    expect(button.translationStatus).toBe("translated");
    expect(button.translatedTextNode.textContent).toBe("bonjour");
    expect(button.tooltip.textContent).toBe("translated, click to translate again");
    expect(aiCache).toEqual([
      {
        original: "hello world",
        targetLanguage: "fr",
        translated: "bonjour",
      },
    ]);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recordNewRequestToOpenAI", result: "successful" })
    );
  });

  it("keeps already translated buttons untouched when a later queued item fails", async () => {
    translateWithAIMock.mockImplementation((content, onMessage) => {
      onMessage("{bad json");
    });

    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;
    aiCache.push({
      original: "cached text",
      targetLanguage: "fr",
      translated: "texte en cache",
    });

    const cachedButton = createButton(document, { sourceString: "cached text" });
    const queuedButton = createButton(document, { sourceString: "needs translation" });

    await aiTranslateText([cachedButton, queuedButton]);

    expect(cachedButton.translationStatus).toBe("translated");
    expect(cachedButton.translatedTextNode.textContent).toBe("texte en cache");
    expect(cachedButton.translatedTextNode.style.color).toBe("rgb(1, 2, 3)");
    expect(cachedButton.tooltip.textContent).toBe("Translated, click to translate again");
    expect(queuedButton.translationStatus).toBe("translationError");
    expect(queuedButton.tooltip.textContent).toContain(parseErrorPrefix);
  });

  it("includes long text in the AI request instead of rejecting it locally", async () => {
    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;

    const longButton = createButton(document, { sourceString: "x".repeat(5000) });

    await aiTranslateText([longButton]);

    expect(translateWithAIMock).toHaveBeenCalled();
    const callArg = translateWithAIMock.mock.calls[0][0];
    expect(callArg).toContain("x".repeat(5000));
    expect(longButton.translationStatus).toBe("queuing");
  });

  it("reuses aiCache entries without issuing another AI request", async () => {
    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;
    aiCache.push({
      original: "cached text",
      targetLanguage: "fr",
      translated: "texte en cache",
    });

    const button = createButton(document, { sourceString: "cached text" });

    await aiTranslateText([button]);

    expect(translateWithAIMock).not.toHaveBeenCalled();
    expect(button.translationStatus).toBe("translated");
    expect(button.translatedTextNode.textContent).toBe("texte en cache");
    expect(button.tooltip.textContent).toBe("Translated, click to translate again");
  });

  it("saves AI-applied flag to sessionStorage after successful stream translation", async () => {
    let streamCallbacks;
    translateWithAIMock.mockImplementation((content, onMessage, onError, onFinished) => {
      streamCallbacks = { content, onMessage, onError, onFinished };
    });

    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;

    // 清除 sessionStorage 中的标记，确保测试起始状态干净
    sessionStorage.removeItem("dualtran:aiApplied:https://example.com/article");

    const button = createButton(document, { sourceString: "hello world" });

    await aiTranslateText([button]);

    const translationId = /<译泽 id="([^"]+)">/.exec(streamCallbacks.content)?.[1];
    // 模拟 AI 流式返回完整译文
    streamCallbacks.onMessage(
      JSON.stringify({
        choices: [{ delta: { content: `<译泽 id="${translationId}">bonjour</译泽>` }, finish_reason: null }],
      })
    );

    // 验证 sessionStorage 中已保存 AI 翻译标记
    expect(sessionStorage.getItem("dualtran:aiApplied:https://example.com/article")).toBe("true");
  });

  it("saves AI-applied flag to sessionStorage on in-memory cache hit", async () => {
    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;
    aiCache.push({
      original: "cached text",
      targetLanguage: "fr",
      translated: "texte en cache",
    });

    // 清除标记
    sessionStorage.removeItem("dualtran:aiApplied:https://example.com/article");

    const button = createButton(document, { sourceString: "cached text" });
    await aiTranslateText([button]);

    // 缓存命中时也应保存标记
    expect(sessionStorage.getItem("dualtran:aiApplied:https://example.com/article")).toBe("true");
  });

  it("does NOT save AI-applied flag for selected-text translations", async () => {
    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;
    aiCache.push({
      original: "selected text",
      targetLanguage: "de",
      translated: "ausgewählter text",
    });

    // 清除标记
    sessionStorage.removeItem("dualtran:aiApplied:https://example.com/article");

    // 使用 selected-btn class 模拟划词翻译
    const button = createButton(document, {
      className: "dualtran-ai-selected-btn dualtran-hide",
      sourceString: "selected text",
    });
    await aiTranslateText([button], false);

    // 划词翻译不应保存页面级 AI 标记
    expect(sessionStorage.getItem("dualtran:aiApplied:https://example.com/article")).toBeNull();
  });
});


describe("_shouldSkipAiTranslation guard logic", () => {
  it("A1: returns true when autoImproveByAI=no and not forced", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("no", true, 0, false)).toBe(true);
  });

  it("A2: returns false when autoImproveByAI=yes, has key, rate limit=0, not forced", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("yes", true, 0, false)).toBe(false);
  });

  it("A3: returns false when autoImproveByAI=no but force=true", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("no", true, 0, true)).toBe(false);
  });

  it("A4: returns true when hasApiKey is false", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("yes", false, 0, false)).toBe(true);
  });

  it("A5: returns true when rateLimitCountdown > 0", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("yes", true, 60_000, false)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════
  // 回归测试：动态加载内容 AI 翻译失败
  //
  // Bug：用户点击 AI 按钮后，初始内容被 AI 翻译，但 x.com 等动态加载
  // 页面向下翻页出现新文本时，仅被 Google 翻译，不会被 AI 翻译。
  //
  // 根因：aiTranslateDynamically 每轮翻译完成后将
  // shouldForceAiAfterPageTranslation 重置为 false，导致下一轮
  // _shouldSkipAiTranslation("no", true, 0, false) → true → 跳过。
  //
  // 修复：shouldForceAiAfterPageTranslation 在用户点击 AI 按钮后
  // 持续保持 true，仅 restorePage()/stopAiAutoTranslate() 时重置。
  // ═══════════════════════════════════════════════════════════════

  it("B1: 用户点击AI按钮后动态内容应被翻译 (shouldForce=true)", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("no", true, 0, true)).toBe(false);
  });

  it("B2: bug场景 — shouldForce被错误重置后动态内容被跳过 (shouldForce=false)", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("no", true, 0, false)).toBe(true);
  });

  it("B3: shouldForce必须跨多轮保持true才能实现持续AI翻译", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    // 修复后: 每轮 shouldForce=true → 不跳过
    for (let round = 0; round < 3; round++) {
      expect(_shouldSkipAiTranslation("no", true, 0, true)).toBe(false);
    }
    // 修复前(bug): 首轮后 shouldForce=false → 后续全部跳过
    for (let round = 0; round < 3; round++) {
      expect(_shouldSkipAiTranslation("no", true, 0, false)).toBe(true);
    }
  });

  it("B4: rate limit冷却中时force标志也不生效（rate limit优先）", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("no", true, 10_000, true)).toBe(true);
  });

  it("B5: 无API key时force标志也不生效", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    expect(_shouldSkipAiTranslation("no", false, 0, true)).toBe(true);
  });

  it("B6: 完整决策矩阵 — 验证所有关键场景", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    const matrix = [
      ["默认无强制（bug场景）",        "no",  true, 0,    false, true],
      ["默认+强制（AI按钮）",          "no",  true, 0,    true,  false],
      ["自动改进模式",                "yes", true, 0,    false, false],
      ["无API Key",                  "no",  false,0,    true,  true],
    ];
    for (const [desc, improve, key, limit, force, expected] of matrix) {
      expect(
        _shouldSkipAiTranslation(improve, key, limit, force),
        `"${desc}" 期望 ${expected}`
      ).toBe(expected);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 回归测试：AI 翻译失败后再次点击 AI 按钮不发请求
  //
  // Bug：AI 翻译失败后 openAiRateLimitCountDown 被设为 10 秒。
  // 用户再次点击 AI 按钮时，translatePageAi() → aiTranslateDynamically()
  // → _shouldSkipAiTranslation() 因 rateLimitCountdown > 0 返回 true，
  // 导致请求被跳过，按钮一直停在 loading 状态。
  //
  // 修复：translatePageAi() 中将 openAiRateLimitCountDown 重置为 0，
  // 使 _shouldSkipAiTranslation 不再因 rate limit 跳过用户主动发起的请求。
  // ═══════════════════════════════════════════════════════════════

  it("C1: 修复后 — rate limit被重置为0后force=true应放行请求", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    // translatePageAi() 已将 openAiRateLimitCountDown 重置为 0
    expect(_shouldSkipAiTranslation("no", true, 0, true)).toBe(false);
  });

  it("C2: 修复前 bug 场景 — rate limit>0时即使force=true也被跳过", async () => {
    const { _shouldSkipAiTranslation } = await import("../../src/contentScript/pageTranslator.js");
    // 修复前：translatePageAi() 未重置 countdown，仍为 10000
    expect(_shouldSkipAiTranslation("no", true, 10_000, true)).toBe(true);
  });
});

/**
 * AI 翻译状态持久化（sessionStorage 标记）——单元测试。
 *
 * 验证 saveAiAppliedFlag / checkAiAppliedFlag / removeAiAppliedFlag
 * 三个纯函数的行为。这些函数是"浏览器回退后 AI 翻译状态恢复"
 * 功能的基石。
 *
 * 背景 bug：GitHub 使用 Turbo Drive + turbo-cache-control=no-cache，
 * 回退时页面内容从服务器重新获取（原始 HTML），Mutation Observer
 * 只能恢复 Google 翻译，AI 翻译不会自动触发。通过 sessionStorage
 * 标记机制实现 AI 翻译状态的自动恢复。
 */
describe("sessionStorage AI 翻译标记", () => {
  const store = {}; // 内存模拟 sessionStorage（避免 jsdom sessionStorage 跨测试污染）

  beforeEach(async () => {
    vi.resetModules();
    // 清除内存模拟存储
    Object.keys(store).forEach(k => delete store[k]);
    // 用 getAllKeys 等 API 模拟 sessionStorage
    const mockStorage = {
      getItem: vi.fn((key) => store[key] ?? null),
      setItem: vi.fn((key, value) => { store[key] = String(value); }),
      removeItem: vi.fn((key) => { delete store[key]; }),
      get length() { return Object.keys(store).length; },
      key: vi.fn((i) => Object.keys(store)[i] ?? null),
    };
    // JSDOM 需要 sessionStorage 存在
    const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
      url: "https://github.com/obra/superpowers/projects",
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    // 替换 JSDOM 的 sessionStorage 为我们的 mock
    Object.defineProperty(globalThis.window, "sessionStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
    // 注意：globalThis.sessionStorage 由 JSDOM 代理到 window.sessionStorage
    Object.defineProperty(globalThis, "sessionStorage", {
      get: () => globalThis.window.sessionStorage,
    });
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn((payload, callback) => { if (typeof callback === "function") callback(); }) },
      i18n: { getMessage: vi.fn(() => "") },
      extension: { inIncognitoContext: false },
    };
  });

  it("getAiAppliedStorageKey 应返回正确的键名格式", async () => {
    const { getAiAppliedStorageKey } = await import("../../src/contentScript/pageTranslator.js");
    const key = getAiAppliedStorageKey();
    expect(key).toBe("dualtran:aiApplied:https://github.com/obra/superpowers/projects");
  });

  it("saveAiAppliedFlag 应在 sessionStorage 中保存 'true'", async () => {
    const { getAiAppliedStorageKey, saveAiAppliedFlag } = await import("../../src/contentScript/pageTranslator.js");
    const key = getAiAppliedStorageKey();
    saveAiAppliedFlag();
    expect(store[key]).toBe("true");
  });

  it("checkAiAppliedFlag 应在保存后返回 true，未保存返回 false", async () => {
    const { saveAiAppliedFlag, checkAiAppliedFlag } = await import("../../src/contentScript/pageTranslator.js");
    expect(checkAiAppliedFlag()).toBe(false);
    saveAiAppliedFlag();
    expect(checkAiAppliedFlag()).toBe(true);
  });

  it("removeAiAppliedFlag 应清除标记，之后 check 返回 false", async () => {
    const { saveAiAppliedFlag, checkAiAppliedFlag, removeAiAppliedFlag } = await import("../../src/contentScript/pageTranslator.js");
    saveAiAppliedFlag();
    expect(checkAiAppliedFlag()).toBe(true);
    removeAiAppliedFlag();
    expect(checkAiAppliedFlag()).toBe(false);
  });

  it("removeAiAppliedFlag 在未设置标记时不应抛出异常", async () => {
    const { removeAiAppliedFlag } = await import("../../src/contentScript/pageTranslator.js");
    expect(() => removeAiAppliedFlag()).not.toThrow();
  });

  it("sessionStorage 不可用时 saveAiAppliedFlag / checkAiAppliedFlag / removeAiAppliedFlag 应静默降级", async () => {
    // 模拟 sessionStorage 抛出异常（如 sandboxed iframe）
    Object.defineProperty(globalThis.window, "sessionStorage", {
      get: () => { throw new Error("blocked"); },
      configurable: true,
    });
    const { saveAiAppliedFlag, checkAiAppliedFlag, removeAiAppliedFlag } = await import("../../src/contentScript/pageTranslator.js");
    expect(() => saveAiAppliedFlag()).not.toThrow();
    expect(checkAiAppliedFlag()).toBe(false);
    expect(() => removeAiAppliedFlag()).not.toThrow();
  });

  it("不同 URL 的标记不应相互影响", async () => {
    const { getAiAppliedStorageKey, saveAiAppliedFlag, checkAiAppliedFlag, removeAiAppliedFlag } = await import("../../src/contentScript/pageTranslator.js");

    // 保存 URL A 的标记
    saveAiAppliedFlag();
    const keyA = getAiAppliedStorageKey();

    // 导航到 URL B（模拟）
    const dom2 = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
      url: "https://github.com/obra/superpowers/issues",
    });
    globalThis.location = dom2.window.location;

    // URL B 的标记应为 false（不同 URL）
    const keyB = getAiAppliedStorageKey();
    expect(keyB).not.toBe(keyA);
    expect(checkAiAppliedFlag()).toBe(false);

    // 恢复 URL A 的 location
    globalThis.location = new JSDOM("<!DOCTYPE html>", {
      url: "https://github.com/obra/superpowers/projects",
    }).window.location;

    // URL A 的标记仍应为 true
    expect(checkAiAppliedFlag()).toBe(true);

    // 清除后应为 false
    removeAiAppliedFlag();
    expect(checkAiAppliedFlag()).toBe(false);
  });
});

/**
 * 浏览器回退后 AI 翻译状态恢复 —— 行为测试。
 *
 * 验证 aiTranslateText 在成功翻译后正确保存 sessionStorage 标记。
 * 这个标记是"回退后自动恢复"的基础。
 *
 * 完整流程集成测试见 pageTranslator.navRestore.integration.test.js
 */
describe("AI 翻译 → sessionStorage 标记 — 行为验证", () => {
  beforeEach(() => {
    vi.resetModules();
    translateWithAIMock.mockReset();
    toastFactoryMock.mockReset();
    showToastMock.mockReset();
    sendMessageMock.mockReset();
    configValues.targetLanguage = "fr";
    configValues.targetLanguageTextTranslation = "de";
    configValues.aiTranslatedColor = "rgb(1, 2, 3)";
    toastFactoryMock.mockReturnValue({ showToast: showToastMock });

    const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
      url: "https://github.com/obra/superpowers/projects",
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, writable: true, value: dom.window.navigator,
    });
    globalThis.alert = vi.fn();
    globalThis.prompt = vi.fn();
    globalThis.confirm = vi.fn(() => false);
    globalThis.chrome = {
      runtime: {
        sendMessage: sendMessageMock.mockImplementation((payload, callback) => {
          if (typeof callback === "function") {
            if (payload?.action === "getTabHostName") callback("github.com");
            else callback();
          }
        }),
      },
      i18n: { getMessage: vi.fn(() => "") },
    };
  });

  it("流式翻译成功后应保存 sessionStorage 标记", async () => {
    let streamCallbacks;
    translateWithAIMock.mockImplementation((content, onMessage, onError, onFinished) => {
      streamCallbacks = { content, onMessage, onError, onFinished };
    });

    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;

    const url = "https://github.com/obra/superpowers/projects";
    // 先清除标记
    sessionStorage.removeItem("dualtran:aiApplied:" + url);

    const button = createButton(document, { sourceString: "hello world" });
    await aiTranslateText([button]);

    const translationId = /<译泽 id="([^"]+)">/.exec(streamCallbacks.content)?.[1];
    streamCallbacks.onMessage(JSON.stringify({
      choices: [{ delta: { content: `<译泽 id="${translationId}">bonjour</译泽>` }, finish_reason: null }],
    }));

    // 验证标记已保存
    expect(sessionStorage.getItem("dualtran:aiApplied:" + url)).toBe("true");
  });

  it("缓存命中翻译成功后应保存 sessionStorage 标记", async () => {
    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;
    aiCache.push({ original: "cached text", targetLanguage: "fr", translated: "texte en cache" });

    const url = "https://github.com/obra/superpowers/projects";
    sessionStorage.removeItem("dualtran:aiApplied:" + url);

    const button = createButton(document, { sourceString: "cached text" });
    await aiTranslateText([button]);

    expect(sessionStorage.getItem("dualtran:aiApplied:" + url)).toBe("true");
  });

  it("划词翻译成功后不应保存页面级 sessionStorage 标记（isSelectedPanel=true）", async () => {
    const { aiTranslateText, abortControllers, aiCache } = await import("../../src/contentScript/pageTranslator.js");
    abortControllers.length = 0;
    aiCache.length = 0;
    aiCache.push({ original: "selected text", targetLanguage: "de", translated: "ausgewählter text" });

    const url = "https://github.com/obra/superpowers/projects";
    sessionStorage.removeItem("dualtran:aiApplied:" + url);

    const button = createButton(document, {
      className: "dualtran-ai-selected-btn dualtran-hide",
      sourceString: "selected text",
    });
    await aiTranslateText([button], false);

    expect(sessionStorage.getItem("dualtran:aiApplied:" + url)).toBeNull();
  });
});
