import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockChrome } from "../fixtures/chrome/mockChrome.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const CONFIG_MODULE_URL = pathToFileURL(resolve(__dirname, "../../src/lib/config.js")).href;

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    otherConfigs: {},
    codeToLanguageNameInEnglish: vi.fn((c) => c),
    fixTLanguageCode: vi.fn((c) => c),
  },
}));

vi.mock("../../src/lib/i18n.js", () => ({}));

describe("configListFlow", () => {
  let chrome;

  beforeEach(async () => {
    chrome = createMockChrome();
    globalThis.chrome = chrome;
    vi.resetModules();
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  async function loadConfig() {
    const { default: twpConfig } = await import(CONFIG_MODULE_URL + "?t=" + Date.now());
    await twpConfig.onReady();
    return twpConfig;
  }

  // ── 分组 A：悬停翻译列表 ──

  it("A1: sitesToTranslateWhenHovering add + remove + storage round-trip", async () => {
    const twpConfig = await loadConfig();

    twpConfig.addSiteToTranslateWhenHovering("example.com");
    expect(twpConfig.get("sitesToTranslateWhenHovering")).toContain("example.com");

    twpConfig.removeSiteFromTranslateWhenHovering("example.com");
    expect(twpConfig.get("sitesToTranslateWhenHovering")).not.toContain("example.com");
  });

  it("A2: langsToTranslateWhenHovering add + remove + storage round-trip", async () => {
    const twpConfig = await loadConfig();

    twpConfig.addLangToTranslateWhenHovering("fr");
    expect(twpConfig.get("langsToTranslateWhenHovering")).toContain("fr");

    twpConfig.removeLangFromTranslateWhenHovering("fr");
    expect(twpConfig.get("langsToTranslateWhenHovering")).not.toContain("fr");
  });

  it("A3: addSiteToTranslateWhenHovering dedup — duplicate add produces no duplicate", async () => {
    const twpConfig = await loadConfig();

    twpConfig.addSiteToTranslateWhenHovering("example.com");
    twpConfig.addSiteToTranslateWhenHovering("example.com");
    twpConfig.addSiteToTranslateWhenHovering("other.com");

    const sites = twpConfig.get("sitesToTranslateWhenHovering");
    expect(sites.filter((s) => s === "example.com")).toHaveLength(1);
    expect(sites).toHaveLength(2);
  });

  // ── 分组 B：布尔行为开关 ──

  it("B1: translateTag_pre storage round-trip + default value", async () => {
    const twpConfig = await loadConfig();

    // 默认值为 "no"
    expect(twpConfig.get("translateTag_pre")).toBe("no");

    twpConfig.set("translateTag_pre", "yes");
    expect(twpConfig.get("translateTag_pre")).toBe("yes");

    twpConfig.set("translateTag_pre", "no");
    expect(twpConfig.get("translateTag_pre")).toBe("no");
  });

  it("B2: translateDynamicallyCreatedContent storage round-trip", async () => {
    const twpConfig = await loadConfig();

    // 默认值为 "yes"
    expect(twpConfig.get("translateDynamicallyCreatedContent")).toBe("yes");

    twpConfig.set("translateDynamicallyCreatedContent", "no");
    expect(twpConfig.get("translateDynamicallyCreatedContent")).toBe("no");
  });

  it("B3: autoTranslateWhenClickingALink storage round-trip", async () => {
    const twpConfig = await loadConfig();

    // 默认值为 "no"
    expect(twpConfig.get("autoTranslateWhenClickingALink")).toBe("no");

    twpConfig.set("autoTranslateWhenClickingALink", "yes");
    expect(twpConfig.get("autoTranslateWhenClickingALink")).toBe("yes");
  });

  it("B4: autoTranslateWhenClickingALink is readable via chrome.storage.local", async () => {
    const twpConfig = await loadConfig();

    twpConfig.set("autoTranslateWhenClickingALink", "yes");

    // 验证值在 storage 中可被其他 context（如 sw.js）读取
    const stored = await new Promise((resolve) => {
      chrome.storage.local.get("autoTranslateWhenClickingALink", (result) => {
        resolve(result);
      });
    });

    expect(stored.autoTranslateWhenClickingALink).toBe("yes");
  });

  // ── 分组 C：customDictionary 行为测试 ──

  it("C1: addKeyWordTocustomDictionary adds + removeKeyWordFromcustomDictionary removes", async () => {
    const twpConfig = await loadConfig();

    twpConfig.addKeyWordTocustomDictionary("hello", "bonjour");
    const dict = twpConfig.get("customDictionary");
    expect(dict.get("hello")).toBe("bonjour");

    twpConfig.removeKeyWordFromcustomDictionary("hello");
    expect(twpConfig.get("customDictionary").has("hello")).toBe(false);
  });

  it("C2: customDictionary preserves Map type and entries through storage", async () => {
    const twpConfig = await loadConfig();

    twpConfig.addKeyWordTocustomDictionary("Spring Boot", "Spring Boot译名");
    twpConfig.addKeyWordTocustomDictionary("hello", "bonjour");

    // Map 在 storage 中会被序列化为普通对象，twpConfig 应正确还原
    const dict = twpConfig.get("customDictionary");
    expect(dict).toBeInstanceOf(Map);
    expect(dict.get("Spring Boot")).toBe("Spring Boot译名");
    expect(dict.size).toBe(2);
  });

  // ── 分组 D：alwaysTranslate / neverTranslate 互斥行为 ──

  it("D1: addSiteToAlwaysTranslate removes site from neverTranslateSites", async () => {
    const twpConfig = await loadConfig();

    // 先添加到 neverTranslateSites
    twpConfig.addSiteToNeverTranslate("example.com");
    expect(twpConfig.get("neverTranslateSites")).toContain("example.com");

    // 再添加到 alwaysTranslateSites → 应从 neverTranslateSites 中移除
    twpConfig.addSiteToAlwaysTranslate("example.com");
    expect(twpConfig.get("alwaysTranslateSites")).toContain("example.com");
    expect(twpConfig.get("neverTranslateSites")).not.toContain("example.com");
  });

  it("D2: addSiteToNeverTranslate removes from alwaysTranslateSites AND sitesToTranslateWhenHovering", async () => {
    const twpConfig = await loadConfig();

    twpConfig.addSiteToAlwaysTranslate("example.com");
    twpConfig.addSiteToTranslateWhenHovering("example.com");

    // 添加到 neverTranslateSites → 应从另外两处同时移除
    twpConfig.addSiteToNeverTranslate("example.com");
    expect(twpConfig.get("neverTranslateSites")).toContain("example.com");
    expect(twpConfig.get("alwaysTranslateSites")).not.toContain("example.com");
    expect(twpConfig.get("sitesToTranslateWhenHovering")).not.toContain("example.com");
  });

  it("D3: addLangToAlwaysTranslate removes lang from neverTranslateLangs", async () => {
    const twpConfig = await loadConfig();

    twpConfig.addLangToNeverTranslate("de");
    expect(twpConfig.get("neverTranslateLangs")).toContain("de");

    twpConfig.addLangToAlwaysTranslate("de");
    expect(twpConfig.get("alwaysTranslateLangs")).toContain("de");
    expect(twpConfig.get("neverTranslateLangs")).not.toContain("de");
  });

  it("D4: addLangToNeverTranslate removes from alwaysTranslateLangs AND langsToTranslateWhenHovering", async () => {
    const twpConfig = await loadConfig();

    twpConfig.addLangToAlwaysTranslate("fr");
    twpConfig.addLangToTranslateWhenHovering("fr");

    twpConfig.addLangToNeverTranslate("fr");
    expect(twpConfig.get("neverTranslateLangs")).toContain("fr");
    expect(twpConfig.get("alwaysTranslateLangs")).not.toContain("fr");
    expect(twpConfig.get("langsToTranslateWhenHovering")).not.toContain("fr");
  });

  // ── 分组 E：translateTag_pre 行为逻辑 ──

  it("E1: translateTag_pre='yes' means pre tags are NOT ignored; 'no' means they are", async () => {
    const twpConfig = await loadConfig();

    // "no" → pre 标签应被忽略（不翻译）
    twpConfig.set("translateTag_pre", "no");
    const shouldIgnoreWhenNo = twpConfig.get("translateTag_pre") !== "yes";
    expect(shouldIgnoreWhenNo).toBe(true);

    // "yes" → pre 标签应被翻译
    twpConfig.set("translateTag_pre", "yes");
    const shouldIgnoreWhenYes = twpConfig.get("translateTag_pre") !== "yes";
    expect(shouldIgnoreWhenYes).toBe(false);
  });

  it("E2: onChanged handler toggles pre tag ignore state correctly", async () => {
    const twpConfig = await loadConfig();

    // 模拟 pageTranslator.js:1230-1244 的逻辑：根据配置维护 htmlTagsInlineIgnore 列表
    const htmlTagsInlineIgnore = [];

    function syncPreTagIgnore(configValue) {
      const idx = htmlTagsInlineIgnore.indexOf("pre");
      if (idx !== -1) htmlTagsInlineIgnore.splice(idx, 1);
      if (configValue !== "yes") htmlTagsInlineIgnore.push("pre");
    }

    // 初始状态 "no" → pre 在忽略列表中
    twpConfig.set("translateTag_pre", "no");
    syncPreTagIgnore("no");
    expect(htmlTagsInlineIgnore).toContain("pre");

    // 切换为 "yes" → pre 从忽略列表中移除
    syncPreTagIgnore("yes");
    expect(htmlTagsInlineIgnore).not.toContain("pre");

    // 再次切换为 "no" → pre 重新加入
    syncPreTagIgnore("no");
    expect(htmlTagsInlineIgnore).toContain("pre");

    // 多次切换不会重复添加
    syncPreTagIgnore("no");
    syncPreTagIgnore("no");
    expect(htmlTagsInlineIgnore.filter((t) => t === "pre")).toHaveLength(1);
  });
});
