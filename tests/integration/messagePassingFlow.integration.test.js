import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBasicMenuClickAction } from "../../src/background/menuClickHelpers.js";
import {
  buildFrameFocusBroadcastEffect,
  buildOpenDonationPageEffect,
  buildOpenOptionsPageEffect,
} from "../../src/background/runtimeMessageExecutionHelpers.js";
import {
  detectTabLanguageForSender,
  getActiveTabMimeType,
  getTabHostNameFromSender,
} from "../../src/background/runtimeMessageHelpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("message passing flow integration", () => {
  beforeEach(() => {
    globalThis.chrome = {
      runtime: {},
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  it("extracts the sender tab hostname for SW routing", () => {
    expect(
      getTabHostNameFromSender({
        tab: {
          url: "https://docs.dualtran.example/path?x=1",
        },
      })
    ).toBe("docs.dualtran.example");
  });

  it("detects the sender tab language through the injected detector callback", async () => {
    const detectLanguage = vi.fn((tabId, callback) => {
      callback("fr");
    });

    await expect(
      detectTabLanguageForSender({ tab: { id: 12 } }, detectLanguage)
    ).resolves.toBe("fr");
    expect(detectLanguage).toHaveBeenCalledWith(12, expect.any(Function));
  });

  it("falls back to und when sender.tab is missing during language detection", async () => {
    const detectLanguage = vi.fn();

    await expect(detectTabLanguageForSender({}, detectLanguage)).resolves.toBe("und");
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it("builds an open-tab effect for the options page", () => {
    expect(buildOpenOptionsPageEffect("chrome-extension://id/options/options.html")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);
  });

  it("builds an open-tab effect for the donation page", () => {
    expect(buildOpenDonationPageEffect("chrome-extension://id/options/options.html#donation")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html#donation",
      },
    ]);
  });

  it("builds a frame-focus broadcast effect for sibling frames in the same tab", () => {
    expect(buildFrameFocusBroadcastEffect({ tab: { id: 44 } })).toEqual([
      {
        type: "send-tab-message",
        tabId: 44,
        message: {
          action: "anotherFrameIsInFocus",
        },
      },
    ]);
  });

  it("routes translate-web-page menu clicks to a toggle-translation tab message", () => {
    expect(
      resolveBasicMenuClickAction({
        menuItemId: "translate-web-page",
        tabId: 33,
      })
    ).toEqual({
      type: "send-tab-message",
      tabId: 33,
      message: {
        action: "toggle-translation",
      },
    });
  });

  it("routes restore/open style actions to distinct outcomes across modules", () => {
    const openFromMenu = resolveBasicMenuClickAction({
      menuItemId: "more-options",
      tabId: 9,
      optionsPageUrl: "chrome-extension://id/options/options.html",
    });
    const openFromRuntime = buildOpenOptionsPageEffect("chrome-extension://id/options/options.html");
    const focusBroadcast = buildFrameFocusBroadcastEffect({ tab: { id: 9 } });

    expect(openFromMenu).toEqual({
      type: "open-tab",
      url: "chrome-extension://id/options/options.html",
    });
    expect(openFromRuntime).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);
    expect(focusBroadcast).toEqual([
      {
        type: "send-tab-message",
        tabId: 9,
        message: {
          action: "anotherFrameIsInFocus",
        },
      },
    ]);
  });

  it("reads the active tab mime type through tab query plus storage lookup", async () => {
    const queryTabs = vi.fn((query, callback) => {
      callback([{ id: 21 }]);
    });
    const storageGet = vi.fn(async () => ({
      tabToMimeType: {
        21: "application/pdf",
      },
    }));

    await expect(getActiveTabMimeType(queryTabs, storageGet)).resolves.toBe("application/pdf");
    expect(queryTabs).toHaveBeenCalledWith({ active: true, currentWindow: true }, expect.any(Function));
    expect(storageGet).toHaveBeenCalledWith(["tabToMimeType"]);
  });

  it("handles missing sender or undefined actions with safe fallbacks", () => {
    expect(buildFrameFocusBroadcastEffect({})).toEqual([]);
    expect(resolveBasicMenuClickAction({ menuItemId: undefined, tabId: 1 })).toBeNull();
  });

  it("covers all known basic menu action routes with expected effects", () => {
    expect(
      resolveBasicMenuClickAction({
        menuItemId: "translate-web-page",
        tabId: 7,
      })
    ).toEqual({
      type: "send-tab-message",
      tabId: 7,
      message: {
        action: "toggle-translation",
      },
    });

    expect(
      resolveBasicMenuClickAction({
        menuItemId: "browserAction-showPopup",
        tabId: 7,
      })
    ).toEqual({
      type: "run-popup-sequence",
      steps: [
        {
          type: "reset-browser-action",
          forceShow: true,
        },
        {
          type: "open-browser-action-popup",
        },
        {
          type: "reset-browser-action",
          forceShow: false,
        },
      ],
    });

    expect(
      resolveBasicMenuClickAction({
        menuItemId: "pageAction-showPopup",
        tabId: 7,
      })
    ).toEqual({
      type: "run-popup-sequence",
      steps: [
        {
          type: "reset-page-action",
          tabId: 7,
          forceShow: true,
        },
        {
          type: "open-page-action-popup",
        },
        {
          type: "reset-page-action",
          tabId: 7,
          forceShow: false,
        },
      ],
    });

    expect(
      resolveBasicMenuClickAction({
        menuItemId: "never-translate",
        tabId: 7,
        tabUrl: "https://news.dualtran.example/article",
      })
    ).toEqual({
      type: "add-never-translate-site",
      hostname: "news.dualtran.example",
    });

    expect(
      resolveBasicMenuClickAction({
        menuItemId: "more-options",
        tabId: 7,
        optionsPageUrl: "chrome-extension://id/options/options.html",
      })
    ).toEqual({
      type: "open-tab",
      url: "chrome-extension://id/options/options.html",
    });

    expect(resolveBasicMenuClickAction({ menuItemId: "unknown", tabId: 7 })).toBeNull();
    expect(__dirname.endsWith("tests\\integration") || __dirname.endsWith("tests/integration")).toBe(true);
  });
});
