import { describe, expect, it } from "vitest";
import {
  buildFrameFocusBroadcastEffect,
  buildOpenDonationPageEffect,
  buildOpenOptionsPageEffect,
  createRuntimeMessageEffectExecutor,
  executeMainFrameRuntimeQuery,
  executeSenderTabHostNameQuery,
  executeSenderTabLanguageQuery,
  executeQueriedActiveTabMimeType,
} from "../../src/background/runtimeMessageExecutionHelpers.js";

describe("runtimeMessageExecutionHelpers", () => {
  it("builds an open-tab effect for the options page", () => {
    expect(buildOpenOptionsPageEffect("chrome-extension://id/options/options.html")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);

    expect(buildOpenOptionsPageEffect("")).toEqual([]);
  });

  it("builds an open-tab effect for the donation page", () => {
    expect(buildOpenDonationPageEffect("chrome-extension://id/options/options.html#donation")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html#donation",
      },
    ]);

    expect(buildOpenDonationPageEffect(null)).toEqual([]);
  });

  it("broadcasts focus to sibling frames only when a sender tab exists", () => {
    expect(buildFrameFocusBroadcastEffect({ tab: { id: 12 } })).toEqual([
      {
        type: "send-tab-message",
        tabId: 12,
        message: { action: "anotherFrameIsInFocus" },
      },
    ]);

    expect(buildFrameFocusBroadcastEffect({})).toEqual([]);
  });

  it("queries the active tab mimeType through the shared runtime execution bridge", async () => {
    const queryTabs = (queryInfo, callback) => {
      expect(queryInfo).toEqual({
        active: true,
        currentWindow: true,
      });
      callback([{ id: 9 }]);
    };
    const getStorage = async (keys) => {
      expect(keys).toEqual(["tabToMimeType"]);
      return {
        tabToMimeType: {
          9: "application/pdf",
        },
      };
    };

    await expect(
      executeQueriedActiveTabMimeType({
        queryTabs,
        getStorage,
      })
    ).resolves.toBe("application/pdf");

    await expect(executeQueriedActiveTabMimeType()).resolves.toBeUndefined();
  });

  it("queries the sender tab main frame through the shared runtime execution bridge", async () => {
    const afterSend = () => undefined;
    const sendTabMessage = (tabId, payload, options, callback) => {
      expect(tabId).toBe(12);
      expect(payload).toEqual({ action: "getCurrentPageLanguageState" });
      expect(options).toEqual({ frameId: 0 });
      callback("translated");
    };

    await expect(
      executeMainFrameRuntimeQuery({
        sender: { tab: { id: 12 } },
        action: "getCurrentPageLanguageState",
        sendTabMessage,
        afterSend,
      })
    ).resolves.toBe("translated");

    await expect(executeMainFrameRuntimeQuery()).resolves.toBeUndefined();
  });

  it("queries the sender tab language through the shared runtime execution bridge", async () => {
    const detectLanguage = (tabId, callback) => {
      expect(tabId).toBe(9);
      callback("fr");
    };

    await expect(
      executeSenderTabLanguageQuery({
        sender: { tab: { id: 9 } },
        detectLanguage,
      })
    ).resolves.toBe("fr");

    await expect(executeSenderTabLanguageQuery()).resolves.toBe("und");
  });

  it("reads the sender tab hostname through the shared runtime execution bridge", () => {
    expect(
      executeSenderTabHostNameQuery({
        tab: {
          url: "https://docs.example.com/path",
        },
      })
    ).toBe("docs.example.com");

    expect(executeSenderTabHostNameQuery()).toBeUndefined();
  });

  it("creates a runtime message effect executor that forwards effect lists to the shared tab executor", () => {
    const applyTabEffects = vi.fn();
    const executeEffects = createRuntimeMessageEffectExecutor({ applyTabEffects });
    const effects = [
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ];

    executeEffects(effects);

    expect(applyTabEffects).toHaveBeenCalledWith(effects);
  });
});