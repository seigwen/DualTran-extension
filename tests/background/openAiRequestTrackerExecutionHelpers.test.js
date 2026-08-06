import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAiRequestTrackingExecutionPlan,
  executeOpenAiRequestTracking,
} from "../../src/background/openAiRequestTrackerExecutionHelpers.js";

describe("openAiRequestTrackerExecutionHelpers", () => {
  it("builds a storage-write effect for request tracking updates", () => {
    expect(buildOpenAiRequestTrackingExecutionPlan({
      openAiUserType: "paid",
      requestsToOpenAi: [
        { timeStamp: 1, result: "successful" },
        { timeStamp: 2, result: "successful" },
      ],
    })).toEqual([
      {
        type: "set-storage",
        update: {
          openAiUserType: "paid",
          requestsToOpenAi: [
            { timeStamp: 1, result: "successful" },
            { timeStamp: 2, result: "successful" },
          ],
        },
        logLabel: "updated requestsToOpenAi:",
        logValue: [
          { timeStamp: 1, result: "successful" },
          { timeStamp: 2, result: "successful" },
        ],
      },
    ]);
  });

  it("returns no effects when the tracking update is missing", () => {
    expect(buildOpenAiRequestTrackingExecutionPlan(null)).toEqual([]);
  });

  it("loads tracking storage before dispatching request history updates", async () => {
    const baseTime = 1_700_000_000_000;
    const getStorage = vi.fn(async () => ({
      requestsToOpenAi: [
        { timeStamp: baseTime - 5_000, result: "successful" },
      ],
    }));
    const applyStorageEffects = vi.fn();

    await expect(
      executeOpenAiRequestTracking(
        { action: "recordNewRequestToOpenAI", timeStamp: baseTime, result: "successful" },
        {
          getStorage,
          applyStorageEffects,
        }
      )
    ).resolves.toEqual({
      openAiUserType: "paid",
      requestsToOpenAi: [
        { timeStamp: baseTime - 5_000, result: "successful" },
        { timeStamp: baseTime, result: "successful" },
      ],
    });

    expect(getStorage).toHaveBeenCalledWith(["openAiUserType", "requestsToOpenAi"]);
    expect(applyStorageEffects).toHaveBeenCalledWith([
      {
        type: "set-storage",
        update: {
          openAiUserType: "paid",
          requestsToOpenAi: [
            { timeStamp: baseTime - 5_000, result: "successful" },
            { timeStamp: baseTime, result: "successful" },
          ],
        },
        logLabel: "updated requestsToOpenAi:",
        logValue: [
          { timeStamp: baseTime - 5_000, result: "successful" },
          { timeStamp: baseTime, result: "successful" },
        ],
      },
    ]);
  });

  it("logs storage read errors and still computes the tracking update", async () => {
    const baseTime = 1_700_000_000_000;
    const error = new Error("storage failed");
    const logError = vi.fn();
    const applyStorageEffects = vi.fn();

    await expect(
      executeOpenAiRequestTracking(
        { action: "recordNewRequestToOpenAI", timeStamp: baseTime, result: "failed" },
        {
          getStorage: vi.fn(async () => {
            throw error;
          }),
          applyStorageEffects,
          logError,
        }
      )
    ).resolves.toEqual({
      requestsToOpenAi: [
        { timeStamp: baseTime, result: "failed" },
      ],
    });

    expect(logError).toHaveBeenCalledWith(error);
    expect(applyStorageEffects).toHaveBeenCalledWith([
      {
        type: "set-storage",
        update: {
          requestsToOpenAi: [
            { timeStamp: baseTime, result: "failed" },
          ],
        },
        logLabel: "updated requestsToOpenAi:",
        logValue: [
          { timeStamp: baseTime, result: "failed" },
        ],
      },
    ]);
  });
});