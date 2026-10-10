/**
 * i18n write-site guard self-test (#157 / spec 47 §2.1) — positive/negative
 * calibration for `scripts/check-i18n-writes.js` plus a live assertion that the
 * real `src/` tree currently passes with zero unexempted violations.
 *
 * Why: the guard is the enforcement arm of the i18n system design (doc 46 /
 * spec 47). A lint whose detector is never proven to fire (and never proven to
 * stay quiet on clean input) is a false sense of safety — this suite feeds it
 * two crafted trees:
 *   - clean fixture  → exit 0 (no false positives);
 *   - dirty fixture  → exit 1 and every seeded violation is reported with the
 *     right rule tag (R1 / R1b / R2 / R3), while the same-line
 *     `i18n-exempt: legacy` marker suppresses exactly its own line and
 *     `data-i18n-ph-value` is never key-checked;
 *   - orphan fixture → exit 1 for an en key referenced nowhere (the orphan hard
 *     gate), naming exactly the orphan and not the referenced sibling key.
 *
 * RED-first calibration (2026-10-10, precision-probe runs over the real tree):
 * 82 → 43 → 33 raw hits across three rule-narrowing iterations (CJS/ESM
 * comments, statement bounding, call-frame depth, CSS/entity stripping, key
 * case-insensitivity — `chrome.i18n.getMessage` is case-insensitive, verified
 * by an in-browser probe). The remaining 33 audited sites carry counted
 * `legacy` exemption markers; burn-down is tracked in issue #157.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-i18n-writes.js");

function runLint(dir) {
  const res = spawnSync(process.execPath, [SCRIPT, "--dir", dir], {
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout || ""}${res.stderr || ""}` };
}

describe("i18n write-site guard (check-i18n-writes)", () => {
  it("passes on the clean fixture (negative calibration: no false positives)", () => {
    const { status, out } = runLint(resolve(__dirname, "fixtures/i18nWrites/clean/src"));
    expect(status, out).toBe(0);
  });

  it("flags every seeded violation in the dirty fixture with the right rule", () => {
    const { status, out } = runLint(resolve(__dirname, "fixtures/i18nWrites/dirty/src"));
    expect(status, out).toBe(1);
    // R1 — write-site literals
    expect(out).toContain('"Hardcoded label"');
    expect(out).toContain('"Hardcoded tip"');
    expect(out).toContain('"Question text"');
    expect(out).toContain("[R1]");
    // R1b — unwired innerHTML template
    expect(out).toContain("Visible Text");
    expect(out).toContain("[R1b]");
    // R2 — missing keys (call + data-i18n attribute)
    expect(out).toContain("nonexistentKeyXyz");
    expect(out).toContain("alsoMissingKeyXyz");
    expect(out).toContain("[R2]");
    // R3 — dead data-i18n binding (no translateDocument in file)
    expect(out).toContain("[R3]");
    // exemptions must suppress exactly their own line
    expect(out).not.toContain('"Exempted"');
    // data-i18n-ph-value is a substitution value, never a key
    expect(out).not.toContain('"(.pdf)"');
  });

  it("fails on orphan en keys (hard gate: key exists but is referenced nowhere)", () => {
    const { status, out } = runLint(resolve(__dirname, "fixtures/i18nWrites/orphan/src"));
    expect(status, out).toBe(1);
    expect(out).toContain("orphanDemoKey");
    expect(out).toContain("orphan");
    expect(out).not.toContain("referencedDemoKey");
  });

  it("passes on the real src tree (zero unexempted violations)", () => {
    const { status, out } = runLint(resolve(ROOT, "src"));
    expect(status, out).toBe(0);
  });
});
