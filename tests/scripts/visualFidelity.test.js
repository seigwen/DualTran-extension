/**
 * Tests for scripts/check-visual-fidelity.mjs (V2 fidelity gate, issue #75)
 *
 * The gate enforces declared `mustDifferFrom` pairs: two checkpoints that
 * claim to capture different states must not render identically.
 *
 * The invariant was CALIBRATED against real runs, and the naive form
 * ("no two checkpoints may ever be byte-identical") was empirically
 * falsified — `after-ai-translation` and `floating-three-state` legitimately
 * converge. These tests lock in both directions:
 *
 *   - declared pair rendering identically        → hard fail
 *   - declared pair rendering near-identically   → hard fail (< 0.1%)
 *   - declared pair rendering differently        → pass
 *   - UNDECLARED identical pair                  → pass (the legitimate case)
 *   - missing shots dir                          → pass, no double-report
 *   - missing member of a declared pair          → warning, not failure
 *   - failures/ excluded                         → identical forensic shots pass
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-visual-fidelity.mjs");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "visual-fidelity-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a solid-colour PNG fixture of the given size. */
function writePng(filePath, { width = 40, height = 30, rgb = [255, 255, 255] } = {}) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, PNG.sync.write(png));
}

/** A PNG that differs from another only in a tiny corner patch (< 0.1% of pixels). */
function writeNearlyIdenticalPng(filePath, { width = 400, height = 300, base = [255, 255, 255] } = {}) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = base[0];
    png.data[i * 4 + 1] = base[1];
    png.data[i * 4 + 2] = base[2];
    png.data[i * 4 + 3] = 255;
  }
  // 4 pixels of 120000 = 0.0033% — well under the 0.1% threshold
  for (let i = 0; i < 4; i++) {
    png.data[i * 4] = 0;
    png.data[i * 4 + 1] = 0;
    png.data[i * 4 + 2] = 0;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, PNG.sync.write(png));
}

/**
 * Build an isolated shots dir + checks fixture and run the gate.
 *
 * @param {Array} checkpoints — CHECKPOINTS array for the fixture
 * @param {(dir: string) => void} populate — writes the shot files
 * @returns {{ exitCode: number, out: string }}
 */
function runGate(checkpoints, populate) {
  const caseDir = join(tmpDir, `case-${counter++}`);
  const shotsDir = join(caseDir, "shots");
  mkdirSync(shotsDir, { recursive: true });

  const checksPath = join(caseDir, "visual-checks.mjs");
  writeFileSync(checksPath, `export const CHECKPOINTS = ${JSON.stringify(checkpoints, null, 2)};\n`);

  populate(shotsDir);

  try {
    const out = execFileSync("node", [SCRIPT, "--dir", shotsDir, "--checks", checksPath], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return { exitCode: e.status ?? 1, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

/** Minimal checkpoint with a declared mustDifferFrom pair. */
function cp(id, mustDifferFrom = []) {
  return { id, scenario: "visual-audit", capture: { page: "mock", when: "x" }, mustDifferFrom, expect: ["something"] };
}

describe("check-visual-fidelity", () => {
  it("fails when a declared pair is byte-identical", () => {
    const { exitCode, out } = runGate([cp("alpha", ["beta"]), cp("beta")], (dir) => {
      writePng(join(dir, "visual-audit", "alpha.png"), { rgb: [255, 255, 255] });
      writePng(join(dir, "visual-audit", "beta.png"), { rgb: [255, 255, 255] });
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("0.0000%");
  });

  it("fails when a declared pair is near-identical (below 0.1%)", () => {
    const { exitCode, out } = runGate([cp("alpha", ["beta"]), cp("beta")], (dir) => {
      writePng(join(dir, "visual-audit", "alpha.png"), { width: 400, height: 300 });
      writeNearlyIdenticalPng(join(dir, "visual-audit", "beta.png"));
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("min 0.10%");
  });

  it("passes when a declared pair differs", () => {
    const { exitCode, out } = runGate([cp("alpha", ["beta"]), cp("beta")], (dir) => {
      writePng(join(dir, "visual-audit", "alpha.png"), { rgb: [255, 255, 255] });
      writePng(join(dir, "visual-audit", "beta.png"), { rgb: [0, 0, 0] });
    });
    expect(exitCode).toBe(0);
    expect(out).toContain("✅");
  });

  it("passes an UNDECLARED identical pair (legitimate convergence)", () => {
    // The calibrated case: after-ai-translation == floating-three-state in a
    // clean run. Not declared ⇒ must not fire.
    const { exitCode } = runGate([cp("after-ai-translation"), cp("floating-three-state")], (dir) => {
      writePng(join(dir, "visual-audit", "after-ai-translation.png"), { rgb: [124, 58, 237] });
      writePng(join(dir, "visual-audit", "floating-three-state.png"), { rgb: [124, 58, 237] });
    });
    expect(exitCode).toBe(0);
  });

  it("passes (no double-report) when the shots dir is missing", () => {
    const caseDir = join(tmpDir, `case-${counter++}`);
    mkdirSync(caseDir, { recursive: true });
    const checksPath = join(caseDir, "visual-checks.mjs");
    writeFileSync(checksPath, `export const CHECKPOINTS = ${JSON.stringify([cp("alpha", ["beta"])])};\n`);
    try {
      const out = execFileSync("node", [SCRIPT, "--dir", join(caseDir, "nope"), "--checks", checksPath], { encoding: "utf8" });
      expect(out).toContain("skipped");
    } catch (e) {
      throw new Error(`expected exit 0, got ${e.status}: ${e.stdout}`);
    }
  });

  it("warns (does not fail) when a declared member was not captured", () => {
    const { exitCode, out } = runGate([cp("alpha", ["never-shot"])], (dir) => {
      writePng(join(dir, "visual-audit", "alpha.png"), { rgb: [255, 255, 255] });
    });
    expect(exitCode).toBe(0);
    expect(out).toContain("never-shot");
    expect(out).toContain("WARN");
  });

  it("excludes failures/ from pair checks", () => {
    const { exitCode } = runGate([cp("alpha", ["beta"])], (dir) => {
      writePng(join(dir, "visual-audit", "alpha.png"), { rgb: [255, 255, 255] });
      writePng(join(dir, "visual-audit", "beta.png"), { rgb: [0, 0, 0] });
      // identical forensic shots must not be compared
      writePng(join(dir, "failures", "failure-a.png"), { rgb: [1, 2, 3] });
      writePng(join(dir, "failures", "failure-b.png"), { rgb: [1, 2, 3] });
    });
    expect(exitCode).toBe(0);
  });
});
