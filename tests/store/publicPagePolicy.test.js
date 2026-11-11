import { describe, expect, it } from "vitest";
import { publicPagePolicy } from "../../scripts/store/publicPagePolicy.mjs";

describe("publicPagePolicy", () => {
  it("downgrades a 404 to warning while the channel is in review", () => {
    const policy = publicPagePolicy({ status: "in_review", pendingSince: "2026-10-19" });
    expect(policy.optional).toBe(true);
    expect(policy.note).toContain("审核中");
    expect(policy.note).toContain("2026-10-19");
  });

  it("keeps a 404 fatal once the channel is live", () => {
    expect(publicPagePolicy({ status: "live" }).optional).toBe(false);
  });

  it("keeps a 404 fatal when the channel has no status", () => {
    expect(publicPagePolicy({}).optional).toBe(false);
  });
});
