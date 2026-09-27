/**
 * Tests for scripts/check-mode-symmetry.mjs
 *
 * The #98 recurrence review found this lint was a DECLARATION-LEVEL FALSE
 * GREEN: it used plain `content.includes("newLine")`, so a comment mentioning
 * the mode satisfied it. Measured on the real repo before the fix:
 * `translation.mjs` and the old `dynamic-content-showmore.mjs` had ZERO code
 * occurrences of either mode token after removing comments, yet the lint
 * reported success — that is exactly how the replaceOriginal half of #98 sat
 * with no gate at all.
 *
 * These tests lock the hardened behaviour:
 *   1. comment-only mentions → FAIL (the original false green)
 *   2. real forEachDisplayMode iteration → PASS
 *   3. single-sided scenario (no iteration) → FAIL
 *   4. written exemption with a reason → PASS
 *   5. exemption marker with a too-short reason → FAIL
 *   6. self-built for-loop over both mode literals → PASS
 *   7. two bare mode strings without any loop → FAIL
 *   8. colour assertions without both-mode coverage → FAIL
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-mode-symmetry.mjs");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mode-symmetry-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Run the lint against an isolated fixture tree that mirrors the real layout
 * (`<root>/tests/browser-e2e/...`), with one scenario file per case.
 */
function runCheck(files) {
  const root = join(tmpDir, `case-${counter++}`);
  const e2eDir = join(root, "tests", "browser-e2e");
  mkdirSync(e2eDir, { recursive: true });
  // The lint resolves scenario paths from its TRANSLATION_SCENARIOS list —
  // write the file under the canonical name so it is picked up.
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(e2eDir, name), content);
  }
  try {
    const out = execFileSync("node", [SCRIPT, "--dir", root], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return {
      exitCode: e.status ?? 1,
      out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? ""),
    };
  }
}

const SCENARIO = "translation.mjs";

describe("check-mode-symmetry (hardened, #98 recurrence review)", () => {
  it("FAILS when the mode tokens appear only in comments (the original false green)", () => {
    const { exitCode, out } = runCheck({
      [SCENARIO]: `
/**
 * This scenario exercises newLine and replaceOriginal in prose only.
 * The old lint accepted exactly this — that was the false green.
 */
export async function run(scope) {
  await scope.page.goto("about:blank");
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("无任何模式证据");
  });

  it("PASSES when the scenario iterates modes behaviorally via forEachDisplayMode", () => {
    const { exitCode } = runCheck({
      [SCENARIO]: `
const { forEachDisplayMode } = await import("./setup.mjs");
export async function run(scope) {
  await forEachDisplayMode(scope, async (mode) => {
    await scope.page.goto("about:blank?m=" + mode);
  });
}
`,
    });
    expect(exitCode).toBe(0);
  });

  it("FAILS a single-sided scenario with no mode iteration", () => {
    const { exitCode, out } = runCheck({
      [SCENARIO]: `
export async function run(scope) {
  await scope.page.evaluate(() => localStorage.setItem("whereToDisplayTranslatedText", "replaceOriginal"));
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("mode asymmetric");
  });

  it("PASSES with a written exemption carrying a reason", () => {
    const { exitCode } = runCheck({
      [SCENARIO]: `
// mode-symmetry-allow: newLine default-path scenario; the mirror lives in translation-replace-original.mjs
export async function run(scope) {
  await scope.page.goto("about:blank");
}
`,
    });
    expect(exitCode).toBe(0);
  });

  it("FAILS an exemption marker whose reason is too short", () => {
    const { exitCode, out } = runCheck({
      [SCENARIO]: `
// mode-symmetry-allow: x
export async function run(scope) {
  await scope.page.goto("about:blank");
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("理由过短");
  });

  it("PASSES a self-built for-loop that runs both mode literals", () => {
    const { exitCode } = runCheck({
      [SCENARIO]: `
const MODES = ["newLine", "replaceOriginal"];
export async function run(scope) {
  for (const mode of MODES) {
    await scope.page.evaluate((m) => chrome.storage.local.set({ whereToDisplayTranslatedText: m }), mode);
  }
}
`,
    });
    expect(exitCode).toBe(0);
  });

  it("FAILS two bare mode strings with no loop around them", () => {
    const { exitCode, out } = runCheck({
      [SCENARIO]: `
const A = "newLine";
const B = "replaceOriginal";
export async function run(scope) {
  await scope.page.goto("about:blank");
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("无真实遍历");
  });

  it("FAILS colour assertions that do not cover both modes", () => {
    const { exitCode, out } = runCheck({
      [SCENARIO]: `
export async function run(scope) {
  const color = await scope.page.evaluate(() => document.querySelector("translated").style.color);
  if (!color) throw new Error("no colour");
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("color matrix asymmetric");
  });
});
