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

describe("uiAppearanceConfig", () => {
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

  it("floatingBtnPosition round-trip: stores and retrieves {left, top}", async () => {
    const twpConfig = await loadConfig();
    const pos = { left: 100, top: 200 };

    twpConfig.set("floatingBtnPosition", pos);
    expect(twpConfig.get("floatingBtnPosition")).toEqual(pos);
  });

  it("floatingBtnWidth round-trip: default 92, can be changed", async () => {
    const twpConfig = await loadConfig();

    expect(twpConfig.get("floatingBtnWidth")).toBe(92);
    twpConfig.set("floatingBtnWidth", 120);
    expect(twpConfig.get("floatingBtnWidth")).toBe(120);
  });

  it("useOldPopup round-trip: default 'no', can be changed", async () => {
    const twpConfig = await loadConfig();

    expect(twpConfig.get("useOldPopup")).toBe("no");
    twpConfig.set("useOldPopup", "yes");
    expect(twpConfig.get("useOldPopup")).toBe("yes");
  });

  it("popupBlueWhenSiteIsTranslated round-trip", async () => {
    const twpConfig = await loadConfig();

    expect(twpConfig.get("popupBlueWhenSiteIsTranslated")).toBe("no");
    twpConfig.set("popupBlueWhenSiteIsTranslated", "yes");
    expect(twpConfig.get("popupBlueWhenSiteIsTranslated")).toBe("yes");
  });

  it("expandPanelTranslateSelectedText round-trip: default 'yes'", async () => {
    const twpConfig = await loadConfig();

    expect(twpConfig.get("expandPanelTranslateSelectedText")).toBe("yes");
    twpConfig.set("expandPanelTranslateSelectedText", "no");
    expect(twpConfig.get("expandPanelTranslateSelectedText")).toBe("no");
  });
});
