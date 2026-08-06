import { describe, expect, it, vi } from "vitest";
import {
  createStorageEffectExecutor,
  executeStorageEffects,
} from "../../src/background/storageExecutionHelpers.js";

describe("storageExecutionHelpers", () => {
  it("persists storage updates and logs label/value pairs", async () => {
    const setStorage = vi.fn(async () => undefined);
    const log = vi.fn();

    const result = await executeStorageEffects([
      {
        type: "set-storage",
        update: {
          tabHasContentScript: { 8: true },
        },
        logLabel: "tabHasContentScript写入成功:",
        logValue: { 8: true },
      },
    ], { setStorage, log });

    expect(setStorage).toHaveBeenCalledWith({
      tabHasContentScript: { 8: true },
    });
    expect(log).toHaveBeenCalledWith("tabHasContentScript写入成功:", { 8: true });
    expect(result).toEqual([
      {
        tabHasContentScript: { 8: true },
      },
    ]);
  });

  it("supports single-message logging for startup writes", async () => {
    const setStorage = vi.fn(async () => undefined);
    const log = vi.fn();

    await executeStorageEffects([
      {
        type: "set-storage",
        update: {
          tabToMimeType: {},
        },
        logMessage: "tabToMimeType写入成功[object Object]",
      },
    ], { setStorage, log });

    expect(log).toHaveBeenCalledWith("tabToMimeType写入成功[object Object]");
  });

  it("ignores non-storage effects and missing writers", async () => {
    await expect(
      executeStorageEffects([{ type: "open-tab", url: "https://example.com" }], {})
    ).resolves.toEqual([]);
  });

  it("creates a storage effect executor that forwards effect lists to the shared storage writer", async () => {
    const setStorage = vi.fn(async () => undefined);
    const log = vi.fn();
    const executeEffects = createStorageEffectExecutor({ setStorage, log });

    await executeEffects([
      {
        type: "set-storage",
        update: {
          tabToMimeType: { 8: "text/html" },
        },
        logLabel: "tabToMimeType写入成功:",
        logValue: { 8: "text/html" },
      },
    ]);

    expect(setStorage).toHaveBeenCalledWith({
      tabToMimeType: { 8: "text/html" },
    });
    expect(log).toHaveBeenCalledWith("tabToMimeType写入成功:", { 8: "text/html" });
  });
});