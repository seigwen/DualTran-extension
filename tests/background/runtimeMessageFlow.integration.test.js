import { describe, expect, it, vi } from "vitest";
import {
  queryMainFrame,
} from "../../src/background/runtimeMessageHelpers.js";
import {
  buildFrameFocusBroadcastEffect,
  buildOpenDonationPageEffect,
  buildOpenOptionsPageEffect,
  executeSenderTabHostNameQuery,
  executeSenderTabLanguageQuery,
  executeQueriedActiveTabMimeType,
} from "../../src/background/runtimeMessageExecutionHelpers.js";

describe("runtime message flow integration", () => {
  it("combines main-frame query with follow-up frame-focus broadcast effects", async () => {
    const afterSend = vi.fn();
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("translated");
    });

    await expect(
      queryMainFrame(12, "getCurrentPageLanguageState", sendTabMessage, afterSend)
    ).resolves.toBe("translated");

    expect(buildFrameFocusBroadcastEffect({ tab: { id: 12 } })).toEqual([
      {
        type: "send-tab-message",
        tabId: 12,
        message: { action: "anotherFrameIsInFocus" },
      },
    ]);
  });

  it("combines hostname/language/mimeType queries with open-tab execution effects", async () => {
    const detectLanguage = vi.fn((tabId, callback) => {
      callback("fr");
    });
    const queryTabs = vi.fn((query, callback) => {
      callback([{ id: 9 }]);
    });
    const storageGet = vi.fn(async () => ({
      tabToMimeType: {
        9: "application/pdf",
      },
    }));

    expect(executeSenderTabHostNameQuery({ tab: { url: "https://docs.example.com/path" } })).toBe("docs.example.com");
    await expect(
      executeSenderTabLanguageQuery({
        sender: { tab: { id: 9 } },
        detectLanguage,
      })
    ).resolves.toBe("fr");
    await expect(
      executeQueriedActiveTabMimeType({
        queryTabs,
        getStorage: storageGet,
      })
    ).resolves.toBe("application/pdf");

    expect(buildOpenOptionsPageEffect("chrome-extension://id/options/options.html")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);
    expect(buildOpenDonationPageEffect("chrome-extension://id/options/options.html#donation")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html#donation",
      },
    ]);
  });
});