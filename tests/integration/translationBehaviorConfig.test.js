import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockChrome } from "../fixtures/chrome/mockChrome.js";

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    otherConfigs: {},
    codeToLanguageNameInEnglish: vi.fn((c) => c),
    fixTLanguageCode: vi.fn((c) => c),
  },
}));

vi.mock("../../src/lib/i18n.js", () => ({}));

describe("translation behavior config", () => {
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
    const { default: twpConfig } = await import("../../src/lib/config.js");
    await twpConfig.onReady();
    return twpConfig;
  }

  it("B1+B2: pageTranslatorService storage round-trip + valid values", async () => {
    const twpConfig = await loadConfig();

    twpConfig.set("pageTranslatorService", "google");
    expect(twpConfig.get("pageTranslatorService")).toBe("google");

    twpConfig.set("pageTranslatorService", "yandex");
    expect(twpConfig.get("pageTranslatorService")).toBe("yandex");
  });

  it("B3: textTranslatorService storage round-trip", async () => {
    const twpConfig = await loadConfig();

    twpConfig.set("textTranslatorService", "google");
    expect(twpConfig.get("textTranslatorService")).toBe("google");

    twpConfig.set("textTranslatorService", "deepl");
    expect(twpConfig.get("textTranslatorService")).toBe("deepl");
  });

  it("D2a: translateLongerThan storage round-trip", async () => {
    const twpConfig = await loadConfig();

    twpConfig.set("translateLongerThan", 100);
    expect(twpConfig.get("translateLongerThan")).toBe(100);

    twpConfig.set("translateLongerThan", 0);
    expect(twpConfig.get("translateLongerThan")).toBe(0);
  });

  it("D3a: ttsSpeed storage round-trip", async () => {
    const twpConfig = await loadConfig();

    twpConfig.set("ttsSpeed", 0.8);
    expect(twpConfig.get("ttsSpeed")).toBe(0.8);

    twpConfig.set("ttsSpeed", 1.5);
    expect(twpConfig.get("ttsSpeed")).toBe(1.5);
  });

  it("D3b: ttsSpeed onChanged listener triggers on storage change", async () => {
    const listener = vi.fn();
    chrome.storage.onChanged.addListener(listener);

    await new Promise((resolve) => {
      chrome.storage.local.set({ ttsSpeed: 2.0 }, resolve);
    });

    expect(listener).toHaveBeenCalled();
  });

  it("D5: enableDeepL storage round-trip", async () => {
    const twpConfig = await loadConfig();

    twpConfig.set("enableDeepL", "yes");
    expect(twpConfig.get("enableDeepL")).toBe("yes");

    twpConfig.set("enableDeepL", "no");
    expect(twpConfig.get("enableDeepL")).toBe("no");
  });
});
