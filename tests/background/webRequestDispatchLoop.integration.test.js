import { describe, expect, it, vi } from "vitest";
import { executeMimeTypeHeaderWrite } from "../../src/background/webRequestExecutionHelpers.js";
import { createStorageEffectExecutor } from "../../src/background/storageExecutionHelpers.js";

describe("webRequest dispatch loop integration", () => {
  it("dispatches main-frame mimeType updates through the shared storage executor", async () => {
    const setStorage = vi.fn(async () => undefined);
    const log = vi.fn();
    const applyStorageEffects = createStorageEffectExecutor({ setStorage, log });

    await executeMimeTypeHeaderWrite({
      details: {
        tabId: 18,
        responseHeaders: [
          { name: "content-type", value: "application/pdf; charset=utf-8" },
        ],
      },
      getStorage: vi.fn(async () => ({
        tabToMimeType: {
          3: "text/html",
        },
      })),
      applyStorageEffects,
      log,
    });

    expect(setStorage).toHaveBeenCalledWith({
      tabToMimeType: {
        3: "text/html",
        18: "application/pdf",
      },
    });
    expect(log).toHaveBeenCalledWith("tabToMimeType write succeeded:", {
      3: "text/html",
      18: "application/pdf",
    });
  });

  it("dispatches null mimeType writebacks when headers omit content-type", async () => {
    const setStorage = vi.fn(async () => undefined);
    const log = vi.fn();
    const applyStorageEffects = createStorageEffectExecutor({ setStorage, log });

    await executeMimeTypeHeaderWrite({
      details: {
        tabId: 11,
        responseHeaders: [{ name: "etag", value: "abc" }],
      },
      getStorage: vi.fn(async () => ({})),
      applyStorageEffects,
      log,
    });

    expect(setStorage).toHaveBeenCalledWith({
      tabToMimeType: {
        11: null,
      },
    });
    expect(log).toHaveBeenCalledWith("tabToMimeType write succeeded:", {
      11: null,
    });
  });
});