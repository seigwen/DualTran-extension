/**
 * Tests for scripts/check-infra-assumptions.js
 *
 * Verifies the infra-assumptions linter catches:
 *   1. Assumption without → 测试： reference
 *   2. Assumption with reference to a missing test file
 *   3. Passes assumptions with valid references
 *   4. Passes when no assumptions section exists
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-infra-assumptions.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "infra-assumptions-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function runCheck(claudeMdContent, extraFiles = {}) {
  // Isolated subdir per call — files from one test must not leak into another
  const testDir = join(tmpDir, `case-${counter++}`);
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, "CLAUDE.md"), claudeMdContent);
  for (const [name, content] of Object.entries(extraFiles)) {
    const full = join(testDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  try {
    const out = execFileSync("node", [SCRIPT, "--claude-md", join(testDir, "CLAUDE.md")], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return { exitCode: e.status ?? 1, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

const SECTION_HEADER = `**基础设施假设清单（Infrastructure Assumptions，M1 issue #31）—— 每个假设必须有测试引用：**`;

describe("check-infra-assumptions", () => {
  it("catches assumptions without a test reference", () => {
    const { exitCode, out } = runCheck(
      `${SECTION_HEADER}\n- **假设：** document.body may be replaced by frameworks (Turbo Drive)\n`
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("without test reference");
  });

  it("catches references to missing test files", () => {
    const { exitCode, out } = runCheck(
      `${SECTION_HEADER}\n- **假设：** document.body may be replaced → 测试：\`tests/contentScript/nonexistent.test.js\`「T1」\n`
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("missing file");
  });

  it("passes assumptions with valid references", () => {
    const { exitCode } = runCheck(
      `${SECTION_HEADER}\n- **假设：** document.body may be replaced → 测试：\`tests/contentScript/foo.test.js\`「T1」\n`,
      { "tests/contentScript/foo.test.js": "// fixture" }
    );
    expect(exitCode).toBe(0);
  });

  it("passes when no assumptions section exists", () => {
    const { exitCode } = runCheck(`# Some other doc\nNo assumptions here.\n`);
    expect(exitCode).toBe(0);
  });
});
