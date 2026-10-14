/**
 * Plan 62 M1 — web-ext lint warning policy (allowlist with archived reasons).
 *
 * AMO submissions must be error-free; warnings are triaged once and then
 * FROZEN here. Any new warning class (or a new message under an old code)
 * must fail `npm run lint:firefox` so it gets triaged deliberately instead of
 * riding along silently.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const policy = require(path.join(ROOT, "scripts/firefox-lint-policy.js"));

describe("firefox lint warning policy", () => {
  it("covers exactly the archived warning classes, each with a reason", () => {
    expect(policy.ALLOWED_WARNING_PAIRS.map((p) => p.code).sort()).toEqual([
      "DANGEROUS_EVAL",
      "UNSAFE_VAR_ASSIGNMENT",
      "UNSUPPORTED_API",
    ]);
    for (const p of policy.ALLOWED_WARNING_PAIRS) {
      expect(p.reason.length > 0).toBe(true);
    }
  });

  it("tolerates the known warnings", () => {
    const warnings = policy.ALLOWED_WARNING_PAIRS.map((p) => ({
      code: p.code,
      message: p.message,
      file: "bundle.js",
    }));
    expect(policy.findUnknownWarnings(warnings)).toEqual([]);
  });

  it("reports a brand-new warning code", () => {
    const unknown = policy.findUnknownWarnings([
      { code: "SOME_NEW_PROBLEM", message: "something regressed", file: "x.js" },
    ]);
    expect(unknown.length).toBe(1);
    expect(unknown[0].code).toBe("SOME_NEW_PROBLEM");
  });

  it("reports an old code carrying a new message", () => {
    const unknown = policy.findUnknownWarnings([
      { code: "UNSUPPORTED_API", message: "tabs.zoom is not supported", file: "y.js" },
    ]);
    expect(unknown.length).toBe(1);
  });
});
