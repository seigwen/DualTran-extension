import { describe, expect, it, vi } from "vitest";
import { executeOpenAiRequestTracking } from "../../src/background/openAiRequestTrackerExecutionHelpers.js";
import { createStorageEffectExecutor } from "../../src/background/storageExecutionHelpers.js";

describe("openAiRequestTracker dispatch loop integration", () => {
  it("dispatches paid-user tracking updates through the shared storage executor", async () => {
    const setStorage = vi.fn(async () => undefined);
    const log = vi.fn();
    const applyStorageEffects = createStorageEffectExecutor({ setStorage, log });
    const baseTime = 1_700_000_000_000;

    await executeOpenAiRequestTracking(
      { action: "recordNewRequestToOpenAI", timeStamp: baseTime, result: "successful" },
      {
        getStorage: vi.fn(async () => ({
          requestsToOpenAi: [
            { timeStamp: baseTime - 5_000, result: "successful" },
          ],
        })),
        applyStorageEffects,
      }
    );

    expect(setStorage).toHaveBeenCalledWith({
      openAiUserType: "paid",
      requestsToOpenAi: [
        { timeStamp: baseTime - 5_000, result: "successful" },
        { timeStamp: baseTime, result: "successful" },
      ],
    });
    expect(log).toHaveBeenCalledWith("updated requestsToOpenAi:", [
      { timeStamp: baseTime - 5_000, result: "successful" },
      { timeStamp: baseTime, result: "successful" },
    ]);
  });

  it("dispatches trimmed histories through the shared storage executor", async () => {
    const setStorage = vi.fn(async () => undefined);
    const applyStorageEffects = createStorageEffectExecutor({ setStorage });
    const baseTime = 1_700_000_000_000;
    const existingRequests = Array.from({ length: 200 }, (_, index) => ({
      timeStamp: baseTime + index,
      result: index % 2 === 0 ? "successful" : "failed",
    }));

    await executeOpenAiRequestTracking(
      { action: "recordNewRequestToOpenAI", timeStamp: baseTime + 500, result: "successful" },
      {
        getStorage: vi.fn(async () => ({
          requestsToOpenAi: existingRequests,
        })),
        applyStorageEffects,
      }
    );

    expect(setStorage).toHaveBeenCalledTimes(1);
    expect(setStorage.mock.calls[0][0].requestsToOpenAi).toHaveLength(110);
    expect(setStorage.mock.calls[0][0].requestsToOpenAi.at(-1)).toEqual({
      timeStamp: baseTime + 500,
      result: "successful",
    });
  });
});