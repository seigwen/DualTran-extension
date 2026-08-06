import { describe, expect, it } from "vitest";
import { buildOpenAiRequestTrackingUpdate } from "../../src/background/openAiRequestTracker.js";

describe("openAiRequestTracker", () => {
  it("marks the user as paid after two successful requests inside the rolling window", () => {
    const baseTime = 1_700_000_000_000;

    const update = buildOpenAiRequestTrackingUpdate(
      {
        openAiUserType: undefined,
        requestsToOpenAi: [{ timeStamp: baseTime - 5_000, result: "successful" }],
      },
      { timeStamp: baseTime, result: "successful" }
    );

    expect(update).toEqual({
      openAiUserType: "paid",
      requestsToOpenAi: [
        { timeStamp: baseTime - 5_000, result: "successful" },
        { timeStamp: baseTime, result: "successful" },
      ],
    });
  });

  it("marks the user as free when the first failure after a lone success arrives", () => {
    const baseTime = 1_700_000_000_000;

    const update = buildOpenAiRequestTrackingUpdate(
      {
        requestsToOpenAi: [{ timeStamp: baseTime - 5_000, result: "successful" }],
      },
      { timeStamp: baseTime, result: "failed" }
    );

    expect(update).toEqual({
      openAiUserType: "free",
      requestsToOpenAi: [
        { timeStamp: baseTime - 5_000, result: "successful" },
        { timeStamp: baseTime, result: "failed" },
      ],
    });
  });

  it("keeps the user as paid when a failure follows enough recent successful requests", () => {
    const baseTime = 1_700_000_000_000;

    const update = buildOpenAiRequestTrackingUpdate(
      {
        requestsToOpenAi: [
          { timeStamp: baseTime - 20_000, result: "successful" },
          { timeStamp: baseTime - 5_000, result: "successful" },
        ],
      },
      { timeStamp: baseTime, result: "failed" }
    );

    expect(update).toEqual({
      openAiUserType: "paid",
      requestsToOpenAi: [
        { timeStamp: baseTime - 20_000, result: "successful" },
        { timeStamp: baseTime - 5_000, result: "successful" },
        { timeStamp: baseTime, result: "failed" },
      ],
    });
  });

  it("trims long request histories down to the newest 110 records", () => {
    const baseTime = 1_700_000_000_000;
    const existingRequests = Array.from({ length: 200 }, (_, index) => ({
      timeStamp: baseTime + index,
      result: index % 2 === 0 ? "successful" : "failed",
    }));

    const update = buildOpenAiRequestTrackingUpdate(
      {
        requestsToOpenAi: existingRequests,
      },
      { timeStamp: baseTime + 500, result: "successful" }
    );

    expect(update.requestsToOpenAi).toHaveLength(110);
    expect(update.requestsToOpenAi[0]).toEqual(existingRequests[91]);
    expect(update.requestsToOpenAi.at(-1)).toEqual({
      timeStamp: baseTime + 500,
      result: "successful",
    });
  });
});