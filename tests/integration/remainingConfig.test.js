import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockChrome } from "../fixtures/chrome/mockChrome.js";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

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

describe("remainingConfig", () => {
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

  // ── 子项目 5：上下文菜单/快捷键/行为开关 ──

  it("showButtonInTheAddressBar round-trip: default 'yes'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("showButtonInTheAddressBar")).toBe("yes");
    twpConfig.set("showButtonInTheAddressBar", "no");
    expect(twpConfig.get("showButtonInTheAddressBar")).toBe("no");
  });

  it("showReleaseNotes round-trip: default 'no'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("showReleaseNotes")).toBe("no");
    twpConfig.set("showReleaseNotes", "yes");
    expect(twpConfig.get("showReleaseNotes")).toBe("yes");
  });

  it("translateClickingOnce round-trip: default 'no'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("translateClickingOnce")).toBe("no");
    twpConfig.set("translateClickingOnce", "yes");
    expect(twpConfig.get("translateClickingOnce")).toBe("yes");
  });

  it("translateSelectedWhenPressTwice round-trip: default 'no'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("translateSelectedWhenPressTwice")).toBe("no");
    twpConfig.set("translateSelectedWhenPressTwice", "yes");
    expect(twpConfig.get("translateSelectedWhenPressTwice")).toBe("yes");
  });

  it("translateTextOverMouseWhenPressTwice round-trip: default 'no'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("translateTextOverMouseWhenPressTwice")).toBe("no");
    twpConfig.set("translateTextOverMouseWhenPressTwice", "yes");
    expect(twpConfig.get("translateTextOverMouseWhenPressTwice")).toBe("yes");
  });

  it("dontShowIfPageLangIsTargetLang round-trip: default 'no'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("dontShowIfPageLangIsTargetLang")).toBe("no");
    twpConfig.set("dontShowIfPageLangIsTargetLang", "yes");
    expect(twpConfig.get("dontShowIfPageLangIsTargetLang")).toBe("yes");
  });

  it("dontShowIfPageLangIsUnknown round-trip: default 'no'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("dontShowIfPageLangIsUnknown")).toBe("no");
    twpConfig.set("dontShowIfPageLangIsUnknown", "yes");
    expect(twpConfig.get("dontShowIfPageLangIsUnknown")).toBe("yes");
  });

  it("dontShowIfSelectedTextIsTargetLang round-trip: default 'no'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("dontShowIfSelectedTextIsTargetLang")).toBe("no");
    twpConfig.set("dontShowIfSelectedTextIsTargetLang", "yes");
    expect(twpConfig.get("dontShowIfSelectedTextIsTargetLang")).toBe("yes");
  });

  it("dontShowIfSelectedTextIsUnknown round-trip: default 'no'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("dontShowIfSelectedTextIsUnknown")).toBe("no");
    twpConfig.set("dontShowIfSelectedTextIsUnknown", "yes");
    expect(twpConfig.get("dontShowIfSelectedTextIsUnknown")).toBe("yes");
  });

  it("hotkeys: default empty object, stores and retrieves shortcuts", async () => {
    const twpConfig = await loadConfig();
    // hotkeys 在 config init 时从 chrome.commands.getAll 填充，mock 返回空数组
    const hotkeys = twpConfig.get("hotkeys");
    expect(hotkeys).toBeDefined();
    expect(typeof hotkeys).toBe("object");

    twpConfig.set("hotkeys", { "toggle-translation": "Ctrl+Shift+1" });
    expect(twpConfig.get("hotkeys")["toggle-translation"]).toBe("Ctrl+Shift+1");
  });

  // ── 子项目 6：OpenRouter 特有配置 ──

  it("openRouterReferer round-trip: default ''", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("openRouterReferer")).toBe("");
    twpConfig.set("openRouterReferer", "https://myapp.com");
    expect(twpConfig.get("openRouterReferer")).toBe("https://myapp.com");
  });

  it("openRouterTitle round-trip: default ''", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("openRouterTitle")).toBe("");
    twpConfig.set("openRouterTitle", "My App");
    expect(twpConfig.get("openRouterTitle")).toBe("My App");
  });

  it("openRouterModel round-trip: default 'openai/gpt-4o-mini'", async () => {
    const twpConfig = await loadConfig();
    expect(twpConfig.get("openRouterModel")).toBe("openai/gpt-4o-mini");
    twpConfig.set("openRouterModel", "anthropic/claude-sonnet-4");
    expect(twpConfig.get("openRouterModel")).toBe("anthropic/claude-sonnet-4");
  });
});
