import { describe, expect, it } from "vitest";
import { checkTag } from "../../scripts/release-check.mjs";

describe("checkTag", () => {
  it("passes when HEAD carries the tag for the manifest version", () => {
    expect(checkTag(["v2.2.4"], { version: "2.2.4" })).toMatchObject({ status: "pass", detail: "v2.2.4" });
  });

  it("fails when HEAD is tagged with a different version", () => {
    const result = checkTag(["v2.2.3"], { version: "2.2.4" });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("v2.2.3");
  });

  it("warns on an untagged HEAD during development", () => {
    expect(checkTag([], { version: "2.2.4" })).toMatchObject({ status: "warn" });
  });

  it("fails on an untagged HEAD when the release requires a tag", () => {
    expect(checkTag([], { version: "2.2.4", requireTag: true }).status).toBe("fail");
  });

  it("ignores unrelated tags when the expected one is present", () => {
    expect(checkTag(["nightly", "v2.2.4"], { version: "2.2.4" }).status).toBe("pass");
  });
});
