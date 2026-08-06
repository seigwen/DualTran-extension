import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  buildTabHasContentScriptExecutionPlan,
  executeContentScriptProbe,
  executeInitialContentScriptProbeBroadcast,
  executeTabHasContentScriptRemoval,
} from "../../src/background/tabStateExecutionHelpers.js";

describe("tabStateExecutionHelpers", () => {
  it("builds a storage write effect for tabHasContentScript updates", () => {
    expect(buildTabHasContentScriptExecutionPlan({
      update: {
        tabHasContentScript: {
          18: true,
        },
      },
    })).toEqual([
      {
        type: "set-storage",
        update: {
          tabHasContentScript: {
            18: true,
          },
        },
        logLabel: "tabHasContentScript write succeeded:",
        logValue: {
          18: true,
        },
      },
    ]);
  });

  it("returns no effects when there is no write plan", () => {
    expect(buildTabHasContentScriptExecutionPlan(null)).toEqual([]);
  });

  it("probes a tab and forwards the resulting storage effects", async () => {
    const sendTabMessage = vi.fn((tabId, message, options, callback) => {
      callback(true);
    });
    const getStorage = vi.fn(async () => ({
      tabHasContentScript: {
        3: true,
      },
    }));
    const afterSend = vi.fn();
    const applyStorageEffects = vi.fn();

    await expect(
      executeContentScriptProbe(18, {
        sendTabMessage,
        getStorage,
        afterSend,
        applyStorageEffects,
      })
    ).resolves.toEqual({
      update: {
        tabHasContentScript: {
          3: true,
          18: true,
        },
      },
    });

    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "contentScriptIsInjected" },
      { frameId: 0 },
      expect.any(Function)
    );
    expect(getStorage).toHaveBeenCalledWith(["tabHasContentScript"]);
    expect(afterSend).toHaveBeenCalledTimes(1);
    expect(applyStorageEffects).toHaveBeenCalledWith([
      {
        type: "set-storage",
        update: {
          tabHasContentScript: {
            3: true,
            18: true,
          },
        },
        logLabel: "tabHasContentScript write succeeded:",
        logValue: {
          3: true,
          18: true,
        },
      },
    ]);
  });

  it("skips persistent startup writeback when the content script is not injected", async () => {
    const sendTabMessage = vi.fn((tabId, message, options, callback) => {
      callback(false);
    });
    const getStorage = vi.fn(async () => ({
      tabHasContentScript: {
        3: true,
      },
    }));
    const applyStorageEffects = vi.fn();

    await expect(
      executeContentScriptProbe(18, {
        persistOnlyWhenInjected: true,
        sendTabMessage,
        getStorage,
        applyStorageEffects,
      })
    ).resolves.toBeNull();

    expect(applyStorageEffects).toHaveBeenCalledWith([]);
  });

  it("broadcasts startup probes only to tabs with ids", async () => {
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([
        { id: 7 },
        { url: "https://example.com/no-id" },
        { id: 18 },
      ]);
    });
    const sendTabMessage = vi.fn((tabId, message, options, callback) => {
      callback(true);
    });
    const getStorage = vi.fn(async () => ({ tabHasContentScript: {} }));
    const applyStorageEffects = vi.fn();

    const results = await executeInitialContentScriptProbeBroadcast({
      queryTabs,
      sendTabMessage,
      getStorage,
      applyStorageEffects,
    });

    expect(queryTabs).toHaveBeenCalledWith({}, expect.any(Function));
    expect(sendTabMessage.mock.calls.map((call) => call[0])).toEqual([7, 18]);
    expect(results).toEqual([
      {
        update: {
          tabHasContentScript: {
            7: true,
          },
        },
      },
      {
        update: {
          tabHasContentScript: {
            18: true,
          },
        },
      },
    ]);
  });

  it("loads storage before removing a closed tab from tabHasContentScript", async () => {
    const getStorage = vi.fn(async () => ({
      tabHasContentScript: {
        3: true,
        18: false,
      },
    }));
    const applyStorageEffects = vi.fn();

    await expect(
      executeTabHasContentScriptRemoval(18, {
        getStorage,
        applyStorageEffects,
      })
    ).resolves.toEqual({
      update: {
        tabHasContentScript: {
          3: true,
        },
      },
    });

    expect(getStorage).toHaveBeenCalledWith(["tabHasContentScript"]);
    expect(applyStorageEffects).toHaveBeenCalledWith([
      {
        type: "set-storage",
        update: {
          tabHasContentScript: {
            3: true,
          },
        },
        logLabel: "tabHasContentScript write succeeded:",
        logValue: {
          3: true,
        },
      },
    ]);
  });
});