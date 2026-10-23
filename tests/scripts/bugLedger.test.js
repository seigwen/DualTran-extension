import { describe, expect, it } from "vitest";
import { checkPullRequest, parseBugIds, validateLedger } from "../../scripts/check-bug-ledger.mjs";

const ledger = {
  version: 1,
  bugs: [
    {
      id: "BUG-003",
      title: "provider order",
      regressionTests: ["tests/options/providerSort.test.js"],
      guarded: true,
    },
    {
      id: "BUG-001",
      title: "amo icon",
      regressionTests: ["tests/store/amoIcon.test.mjs"],
      guarded: false,
    },
  ],
};

describe("parseBugIds", () => {
  it("extracts unique ids in first-seen order", () => {
    expect(parseBugIds("Fixes BUG-003 and BUG-001, again BUG-003")).toEqual(["BUG-003", "BUG-001"]);
  });

  it("ignores lookalikes", () => {
    expect(parseBugIds("BUG-3 ABUG-004 bug-004")).toEqual([]);
  });
});

describe("validateLedger", () => {
  it("accepts a well-formed ledger", () => {
    expect(validateLedger(ledger)).toEqual([]);
  });

  it("reports duplicates and missing arrays", () => {
    const broken = { bugs: [{ id: "BUG-001", title: "x", guarded: true }, { id: "BUG-001", title: "y", guarded: true }] };
    const problems = validateLedger(broken);
    expect(problems.some((p) => p.includes("duplicate"))).toBe(true);
    expect(problems.some((p) => p.includes("regressionTests"))).toBe(true);
  });
});

describe("checkPullRequest", () => {
  it("passes when the referenced bug's regression test is in the diff", () => {
    const result = checkPullRequest({
      ledger,
      body: "Fixes BUG-003",
      changedFiles: ["src/options/options.js", "tests/options/providerSort.test.js"],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join()).toContain("BUG-001");
  });

  it("fails when the fix does not touch the regression test", () => {
    const result = checkPullRequest({ ledger, body: "Fixes BUG-003", changedFiles: ["src/options/options.js"] });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("tests/options/providerSort.test.js");
  });

  it("fails when the id is unknown", () => {
    const result = checkPullRequest({ ledger, body: "Fixes BUG-999", changedFiles: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("missing from docs/bugs/ledger.json");
  });

  it("blocks a release while any bug is unguarded", () => {
    const result = checkPullRequest({ ledger, body: "", changedFiles: [], release: true });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("release blocked");
  });

  it("only warns outside release mode", () => {
    const result = checkPullRequest({ ledger, body: "", changedFiles: [], release: false });
    expect(result.ok).toBe(true);
  });
});
