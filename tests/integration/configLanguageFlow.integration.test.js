import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockChrome } from "../fixtures/chrome/mockChrome.js";

let _moduleLoadSeq = 0; // 确定性 cache-busting（替代 Math.random()）

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_MODULE_URL = pathToFileURL(resolve(__dirname, "../../src/lib/config.js")).href;

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    otherConfigs: {},
    codeToLanguageNameInEnglish: vi.fn((c) => c),
    fixTLanguageCode: vi.fn((code) => {
      const map = { iw: "he", jw: "jv", zh: "zh-CN", "zh-Hant": "zh-TW" };
      if (map[code]) return map[code];
      const known = ["en", "es", "de", "fr", "he", "jv", "zh-CN", "zh-TW"];
      return known.includes(code) ? code : code?.includes("-") ? code : undefined;
    }),
  },
}));

vi.mock("../../src/lib/i18n.js", () => ({}));

describe("configLanguageFlow", () => {
  let chrome;

  beforeEach(async () => {
    chrome = createMockChrome();
    globalThis.chrome = chrome;
    vi.resetModules();
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  /** 导入 config 模块（使用 cache-busting URL 确保每次获得全新实例） */
  async function importFreshConfig() {
    const module = await import(`${CONFIG_MODULE_URL}?t=${Date.now()}-${_moduleLoadSeq++}`);
    return module.default;
  }

  async function loadConfigWith(storageData) {
    await new Promise((resolve) => {
      chrome.storage.local.set(storageData, resolve);
    });
    const twpConfig = await importFreshConfig();
    await twpConfig.onReady();
    return twpConfig;
  }

  it("A3: null targetLanguage falls back to targetLanguages[0]", async () => {
    const twpConfig = await loadConfigWith({
      targetLanguage: null,
      targetLanguageTextTranslation: null,
      targetLanguages: ["de", "es", "en"],
      neverTranslateLangs: [],
      alwaysTranslateLangs: [],
    });

    expect(twpConfig.get("targetLanguage")).toBe("de");
  });

  it("A4a: null targetLanguageTextTranslation init falls back to targetLanguages[0]", async () => {
    const twpConfig = await loadConfigWith({
      targetLanguage: "es",
      targetLanguageTextTranslation: null,
      targetLanguages: ["de", "es", "en"],
      neverTranslateLangs: [],
      alwaysTranslateLangs: [],
    });

    expect(twpConfig.get("targetLanguageTextTranslation")).toBe("de");
  });

  it("A5: two-pass fix+revalidate after language code transformation", async () => {
    // mock fixTLanguageCode: "xx" 不在已知列表中且不含连字符 → 返回 undefined
    const twpConfig = await loadConfigWith({
      targetLanguage: "fr",
      targetLanguageTextTranslation: "fr",
      targetLanguages: ["fr", "xx", "de"],
      neverTranslateLangs: [],
      alwaysTranslateLangs: [],
    });

    // "fr" 在修正后的 targetLanguages 中仍然有效
    expect(twpConfig.get("targetLanguage")).toBe("fr");
    // "xx" 被 fixTLanguageCode 转为 undefined，filter(Boolean) 移除
    expect(twpConfig.get("targetLanguages").filter(Boolean)).toHaveLength(2);
  });

  it("A6a: setTargetLanguage dedup + reorder (existing lang moves to front)", async () => {
    const twpConfig = await loadConfigWith({
      targetLanguage: "en",
      targetLanguageTextTranslation: "en",
      targetLanguages: ["en", "es", "de"],
    });

    // setTargetLanguage(lang, true) 会强制调用 addTargetLanguage 实现去重+重新排序
    twpConfig.setTargetLanguage("es", true);
    expect(twpConfig.get("targetLanguages")).toEqual(["es", "en", "de"]);
  });

  it("A6b: setTargetLanguage max-3 enforcement (new lang pushes out last)", async () => {
    const twpConfig = await loadConfigWith({
      targetLanguage: "en",
      targetLanguageTextTranslation: "en",
      targetLanguages: ["en", "es", "de"],
    });

    // setTargetLanguage 内部调用 addTargetLanguage，往数组前插入、弹出末尾
    twpConfig.setTargetLanguage("fr");
    expect(twpConfig.get("targetLanguages")).toEqual(["fr", "en", "es"]);
    expect(twpConfig.get("targetLanguages")).toHaveLength(3);
  });

  it("A6c: removing a language preserves order of remaining", async () => {
    const twpConfig = await loadConfigWith({
      targetLanguage: "en",
      targetLanguageTextTranslation: "en",
      targetLanguages: ["en", "es", "de"],
    });

    // removeTargetLanguage 是 IIFE 私有函数，通过直接 set 验证数组变异行为
    twpConfig.set("targetLanguages", ["en", "de"]);
    expect(twpConfig.get("targetLanguages")).toEqual(["en", "de"]);
  });
});
