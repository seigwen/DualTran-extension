import { describe, expect, it, vi } from "vitest";
import {
  detectTabLanguageForSender,
  getActiveTabMimeType,
} from "../../src/background/runtimeMessageHelpers.js";
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
import { createTabEffectExecutor, executeTabEffects } from "../../src/background/tabExecutionHelpers.js";

describe("runtime message dispatch loop integration", () => {
  it("combines main-frame querying with follow-up frame-focus dispatch on the shared tab executor", async () => {
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      if (typeof callback === "function") {
        callback("translated");
      }
    });

    await expect(
      executeMainFrameRuntimeQuery({
        sender: { tab: { id: 12 } },
        action: "getCurrentPageLanguageState",
        sendTabMessage,
      })
    ).resolves.toBe("translated");

    executeTabEffects(buildFrameFocusBroadcastEffect({ tab: { id: 12 } }), {
      sendTabMessage,
    });

    expect(sendTabMessage).toHaveBeenCalledTimes(2);
    expect(sendTabMessage.mock.calls[0][0]).toBe(12);
    expect(sendTabMessage.mock.calls[0][1]).toEqual({ action: "getCurrentPageLanguageState" });
    expect(sendTabMessage.mock.calls[0][2]).toEqual({ frameId: 0 });
    expect(typeof sendTabMessage.mock.calls[0][3]).toBe("function");
    expect(sendTabMessage.mock.calls[1]).toEqual([
      12,
      { action: "anotherFrameIsInFocus" },
    ]);
  });

  it("combines runtime sender queries with options and donation open-tab dispatch", async () => {
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
    const createTab = vi.fn();
    const applyTabEffects = createTabEffectExecutor({ createTab });
    const executeEffects = createRuntimeMessageEffectExecutor({
      applyTabEffects,
    });

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

    executeEffects(
      [
        ...buildOpenOptionsPageEffect("chrome-extension://id/options/options.html"),
        ...buildOpenDonationPageEffect("chrome-extension://id/options/options.html#donation"),
      ]
    );

    expect(createTab.mock.calls).toEqual([
      [{ url: "chrome-extension://id/options/options.html" }],
      [{ url: "chrome-extension://id/options/options.html#donation" }],
    ]);
  });
});