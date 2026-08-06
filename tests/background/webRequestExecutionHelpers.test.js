import { describe, expect, it, vi } from "vitest";
import {
  buildMimeTypeHeaderExecutionPlan,
  executeMimeTypeHeaderWrite,
} from "../../src/background/webRequestExecutionHelpers.js";

describe("webRequestExecutionHelpers", () => {
  it("builds a storage-write effect for mimeType updates", () => {
    expect(buildMimeTypeHeaderExecutionPlan({
      tabToMimeType: {
        18: "application/pdf",
      },
    })).toEqual([
      {
        type: "set-storage",
        update: {
          tabToMimeType: {
            18: "application/pdf",
          },
        },
        logLabel: "tabToMimeType写入成功:",
        logValue: {
          18: "application/pdf",
        },
      },
    ]);
  });

  it("returns no effects when there is no update payload", () => {
    expect(buildMimeTypeHeaderExecutionPlan(null)).toEqual([]);
  });

  it("loads stored mimeType state before dispatching header write effects", async () => {
    const getStorage = vi.fn(async () => ({
      tabToMimeType: {
        3: "text/html",
      },
    }));
    const applyStorageEffects = vi.fn();
    const log = vi.fn();

    await expect(
      executeMimeTypeHeaderWrite({
        details: {
          tabId: 18,
          responseHeaders: [
            { name: "content-type", value: "application/pdf; charset=utf-8" },
          ],
        },
        getStorage,
        applyStorageEffects,
        log,
      })
    ).resolves.toEqual({
      tabToMimeType: {
        3: "text/html",
        18: "application/pdf",
      },
    });

    expect(getStorage).toHaveBeenCalledWith(["tabToMimeType"]);
    expect(log).toHaveBeenCalledWith("tabToMimeType读取成功:", {
      tabToMimeType: {
        3: "text/html",
      },
    });
    expect(applyStorageEffects).toHaveBeenCalledWith([
      {
        type: "set-storage",
        update: {
          tabToMimeType: {
            3: "text/html",
            18: "application/pdf",
          },
        },
        logLabel: "tabToMimeType写入成功:",
        logValue: {
          3: "text/html",
          18: "application/pdf",
        },
      },
    ]);
  });

  it("returns null when webRequest details are missing or not tab-bound", async () => {
    await expect(executeMimeTypeHeaderWrite({
      getStorage: vi.fn(),
      applyStorageEffects: vi.fn(),
    })).resolves.toBeNull();

    await expect(executeMimeTypeHeaderWrite({
      details: { tabId: -1 },
      getStorage: vi.fn(),
      applyStorageEffects: vi.fn(),
    })).resolves.toBeNull();
  });
});