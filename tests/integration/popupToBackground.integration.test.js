import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let _moduleLoadSeq = 0; // 确定性 cache-busting（替代 Math.random()）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const translationServiceSourcePath = resolve(__dirname, "../../src/background/translationService.js");
const translationCacheSourcePath = resolve(__dirname, "../../src/background/translationCache.js");

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

async function importInstrumentedTranslationService() {
  const nonce = _moduleLoadSeq++;
  const source = await readFile(translationServiceSourcePath, "utf8");
  const instrumentedSource = source
    .replace(
      /import twpLang from "\.\.\/lib\/languages\.js"\s*/,
      'const twpLang = globalThis.__popupBackgroundTestDeps.twpLang;\n'
    )
    .replace(
      /import translationCache from "\.\.\/background\/translationCache\.js"\s*/,
      'const translationCache = globalThis.__popupBackgroundTestDeps.translationCache;\n'
    )
    .replace(
      /return translationService;\s*\}\)\(\);/,
      [
        "translationService.__testHooks = { serviceList };",
        "  return translationService;",
        "})();",
      ].join("\n")
    )
    .concat(`\n//# sourceURL=${translationServiceSourcePath}?instrumented=${nonce}`);

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(instrumentedSource).toString("base64")}#${nonce}`;
  const module = await import(moduleUrl);
  return module.default;
}

async function importInstrumentedTranslationCache() {
  const nonce = _moduleLoadSeq++;
  const source = await readFile(translationCacheSourcePath, "utf8");
  const instrumentedSource = source
    .replace(
      // 替换静态 import（Service Worker 不支持动态 import，源码已改为静态 import）
      /import \{ deleteAiTranslationCache \} from "\.\/aiTranslationCache\.js";/g,
      "const deleteAiTranslationCache = () => Promise.resolve();"
    )
    .replace(
      // 删除源码中相对路径的动态 import("./aiTranslationCache.js")：
      // 该 import 在 data: URL 上下文中无法解析相对路径（ERR_INVALID_URL）。
      // 测试不关心 AI 缓存的异步删除副作用，此处用等价空操作替换以保持语句结构。
      /import\("\.\/aiTranslationCache\.js"\)\.then\(\(\{ deleteAiTranslationCache \}\) => \{[\s\S]*?\}\);?/,
      "Promise.resolve(null).then(() => {}); // 测试桩：跳过 aiTranslationCache.js 动态导入"
    )
    .replace(
      /return translationCache;\s*\}\)\(\);/,
      [
        "translationCache.__testHooks = { cacheList };",
        "  return translationCache;",
        "})();",
      ].join("\n")
    )
    .concat(`\n//# sourceURL=${translationCacheSourcePath}?instrumented=${nonce}`);

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(instrumentedSource).toString("base64")}#${nonce}`;
  const module = await import(moduleUrl);
  return module.default;
}

describe("popup to background integration", () => {
  let runtimeMessageListeners;
  let translationService;
  let translationCache;
  let serviceListener;
  let cacheListener;

  beforeEach(async () => {
    vi.resetModules();

    if (!globalThis.crypto?.subtle) {
      globalThis.crypto = webcrypto;
    }

    runtimeMessageListeners = [];
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            runtimeMessageListeners.push(listener);
          }),
        },
        reload: vi.fn(),
      },
    };

    globalThis.fetch = vi.fn();
    globalThis.XMLHttpRequest = class {
      open() {
      }

      send() {
      }
    };

    globalThis.__popupBackgroundTestDeps = {
      twpLang: {
        getAlternativeService: vi.fn((_, serviceName) => serviceName),
      },
      translationCache: {
        get: vi.fn(),
        set: vi.fn(),
      },
    };

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    translationService = await importInstrumentedTranslationService();
    translationCache = await importInstrumentedTranslationCache();

    [serviceListener, cacheListener] = runtimeMessageListeners;
  });

  afterEach(() => {
    delete globalThis.__popupBackgroundTestDeps;
    delete globalThis.chrome;
    delete globalThis.fetch;
    delete globalThis.XMLHttpRequest;
  });

  it("responds to getCacheSize through the cache listener", async () => {
    const sendResponse = vi.fn();
    const calculateSizeMock = vi.fn().mockResolvedValue("12.5 KB");

    translationCache.__testHooks.cacheList.calculateSize = calculateSizeMock;

    const result = cacheListener({ action: "getCacheSize" }, {}, sendResponse);

    expect(result).toBe(true);
    await flushAsyncWork();
    expect(calculateSizeMock).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith("12.5 KB");
  });

  it("routes deleteTranslationCache messages into the cache module", () => {
    const deleteTranslationCacheMock = vi.fn();

    translationCache.deleteTranslationCache = deleteTranslationCacheMock;

    const result = cacheListener({ action: "deleteTranslationCache", reload: false }, {}, vi.fn());

    expect(result).toBeUndefined();
    expect(deleteTranslationCacheMock).toHaveBeenCalledWith(false);
  });

  it("routes translateHTML messages into translationService and returns translated html", async () => {
    const sendResponse = vi.fn();
    const translatedHtml = [["你好"], ["世界"]];
    const translateHTMLMock = vi.fn().mockResolvedValue(translatedHtml);

    translationService.translateHTML = translateHTMLMock;

    const result = serviceListener(
      {
        action: "translateHTML",
        translationService: "google",
        targetLanguage: "zh-CN",
        sourceArray2d: [["hello"], ["world"]],
        dontSortResults: "yes",
      },
      { tab: { incognito: false } },
      sendResponse
    );

    expect(result).toBe(true);
    await flushAsyncWork();
    expect(translateHTMLMock).toHaveBeenCalledWith(
      "google",
      "auto",
      "zh-CN",
      [["hello"], ["world"]],
      false,
      "yes"
    );
    expect(sendResponse).toHaveBeenCalledWith(translatedHtml);
  });

  it("routes translateText messages into translationService and returns translated attributes", async () => {
    const sendResponse = vi.fn();
    const translateTextMock = vi.fn().mockResolvedValue(["你好", "世界"]);

    translationService.translateText = translateTextMock;

    const result = serviceListener(
      {
        action: "translateText",
        translationService: "google",
        targetLanguage: "zh-CN",
        sourceArray: ["hello", "world"],
      },
      { tab: { incognito: false } },
      sendResponse
    );

    expect(result).toBe(true);
    await flushAsyncWork();
    expect(translateTextMock).toHaveBeenCalledWith(
      "google",
      "auto",
      "zh-CN",
      ["hello", "world"],
      false
    );
    expect(sendResponse).toHaveBeenCalledWith(["你好", "世界"]);
  });

  it("routes translateSingleText messages into translationService and returns translated text", async () => {
    const sendResponse = vi.fn();
    const translateSingleTextMock = vi.fn().mockResolvedValue("你好");

    translationService.translateSingleText = translateSingleTextMock;

    const result = serviceListener(
      {
        action: "translateSingleText",
        translationService: "google",
        targetLanguage: "zh-CN",
        source: "hello",
      },
      { tab: { incognito: false } },
      sendResponse
    );

    expect(result).toBe(true);
    await flushAsyncWork();
    expect(translateSingleTextMock).toHaveBeenCalledWith(
      "google",
      "auto",
      "zh-CN",
      "hello",
      false
    );
    expect(sendResponse).toHaveBeenCalledWith("你好");
  });

  it("broadcasts removeTranslationsWithError across registered translation services", () => {
    const removalSpies = [];

    translationService.__testHooks.serviceList.forEach((service) => {
      service.removeTranslationsWithError = vi.fn();
      removalSpies.push(service.removeTranslationsWithError);
    });

    const result = serviceListener({ action: "removeTranslationsWithError" }, {}, vi.fn());

    expect(result).toBeUndefined();
    expect(removalSpies).toHaveLength(5);
    removalSpies.forEach((spy) => {
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  it("marks incognito translateHTML requests as non-persistent cache writes", async () => {
    const sendResponse = vi.fn();
    const translateHTMLMock = vi.fn().mockResolvedValue([["隐身"]]);

    translationService.translateHTML = translateHTMLMock;

    serviceListener(
      {
        action: "translateHTML",
        translationService: "google",
        targetLanguage: "zh-CN",
        sourceArray2d: [["secret"]],
        dontSortResults: "yes",
      },
      { tab: { incognito: true } },
      sendResponse
    );

    await flushAsyncWork();
    expect(translateHTMLMock).toHaveBeenCalledWith(
      "google",
      "auto",
      "zh-CN",
      [["secret"]],
      true,
      "yes"
    );
    expect(sendResponse).toHaveBeenCalledWith([["隐身"]]);
  });

  it("keeps normal-window translateHTML requests eligible for persistent cache writes", async () => {
    const sendResponse = vi.fn();
    const translateHTMLMock = vi.fn().mockResolvedValue([["普通"]]);

    translationService.translateHTML = translateHTMLMock;

    serviceListener(
      {
        action: "translateHTML",
        translationService: "google",
        targetLanguage: "zh-CN",
        sourceArray2d: [["normal"]],
        dontSortResults: "yes",
      },
      { tab: { incognito: false } },
      sendResponse
    );

    await flushAsyncWork();
    expect(translateHTMLMock).toHaveBeenCalledWith(
      "google",
      "auto",
      "zh-CN",
      [["normal"]],
      false,
      "yes"
    );
    expect(sendResponse).toHaveBeenCalledWith([["普通"]]);
  });

  it("ignores unknown popup actions instead of sending a response", () => {
    const sendResponse = vi.fn();

    const result = serviceListener({ action: "getTabMimeType" }, {}, sendResponse);

    expect(result).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("returns an empty response when translateHTML rejects", async () => {
    const sendResponse = vi.fn();
    const translateHTMLMock = vi.fn().mockRejectedValue(new Error("network down"));

    translationService.translateHTML = translateHTMLMock;

    const result = serviceListener(
      {
        action: "translateHTML",
        translationService: "google",
        targetLanguage: "zh-CN",
        sourceArray2d: [["hello"]],
        dontSortResults: "yes",
      },
      { tab: { incognito: false } },
      sendResponse
    );

    expect(result).toBe(true);
    await flushAsyncWork();
    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith();
  });
});
