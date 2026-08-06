import { describe, expect, it, vi } from "vitest";
import {
  executeContentScriptProbe,
  executeInitialContentScriptProbeBroadcast,
  executeTabHasContentScriptRemoval,
} from "../../src/background/tabStateExecutionHelpers.js";
import { createStorageEffectExecutor } from "../../src/background/storageExecutionHelpers.js";

describe("tab state dispatch loop integration", () => {
  it("dispatches complete-state probe writebacks through the shared storage executor", async () => {
    const setStorage = vi.fn(async () => undefined);
    const log = vi.fn();
    const applyStorageEffects = createStorageEffectExecutor({ setStorage, log });
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback(true);
    });

    await executeContentScriptProbe(18, {
      sendTabMessage,
      getStorage: vi.fn(async () => ({
        tabHasContentScript: {
          3: true,
        },
      })),
      applyStorageEffects,
    });

    expect(setStorage).toHaveBeenCalledWith({
      tabHasContentScript: {
        3: true,
        18: true,
      },
    });
    expect(log).toHaveBeenCalledWith("tabHasContentScript write succeeded:", {
      3: true,
      18: true,
    });
  });

  it("dispatches startup probe persistence and tab-removal cleanup through the shared storage executor", async () => {
    const setStorage = vi.fn(async () => undefined);
    const log = vi.fn();
    const applyStorageEffects = createStorageEffectExecutor({ setStorage, log });
    await executeInitialContentScriptProbeBroadcast({
      queryTabs(_queryInfo, callback) {
        callback([
          { id: 7 },
          { id: 18 },
        ]);
      },
      sendTabMessage(tabId, payload, options, callback) {
        callback(true);
      },
      getStorage: vi.fn(async () => ({
        tabHasContentScript: {
          3: true,
        },
      })),
      applyStorageEffects,
    });

    await executeTabHasContentScriptRemoval(18, {
      getStorage: vi.fn(async () => ({
        tabHasContentScript: {
          3: true,
          7: true,
          18: false,
        },
      })),
      applyStorageEffects,
    });

    expect(setStorage.mock.calls).toEqual([
      [{
        tabHasContentScript: {
          3: true,
          7: true,
        },
      }],
      [{
        tabHasContentScript: {
          3: true,
          18: true,
        },
      }],
      [{
        tabHasContentScript: {
          3: true,
          7: true,
        },
      }],
    ]);
  });
});