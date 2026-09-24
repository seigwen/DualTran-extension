/**
 * Tests for scripts/check-assertion-strength.js
 *
 * Verifies the assertion-strength linter catches:
 *   1. Conditional assertions (false-green pattern): `if (x) { expect(...) }`
 *   2. Tests with no assertions at all (L0)
 *   3. Passes clean files (L2+ unconditional assertions)
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-assertion-strength.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "assertion-strength-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function runCheck(files) {
  // Isolated subdir per call — files from one test must not leak into another
  const testDir = join(tmpDir, `case-${counter++}`, "tests", "contentScript");
  mkdirSync(testDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(testDir, name), content);
  }
  try {
    const out = execFileSync("node", [SCRIPT, "--dir", testDir], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    // Violations are printed to stderr; execFileSync throws with both streams
    return { exitCode: e.status ?? 1, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

function runCheckE2e(files) {
  // E2E skip-typing pass only scans paths containing `browser-e2e` (issue #88, P2)
  const testDir = join(tmpDir, `case-${counter++}`, "tests", "browser-e2e");
  mkdirSync(testDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(testDir, name), content);
  }
  try {
    const out = execFileSync("node", [SCRIPT, "--dir", testDir], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return { exitCode: e.status ?? 1, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

describe("check-assertion-strength", () => {
  it("catches conditional assertions (false-green pattern)", () => {
    const { exitCode, out } = runCheck({
      "bad.test.js": `
import { it, expect } from "vitest";
it("conditional assertion", () => {
  const x = null;
  if (x) {
    expect(x).toBe(1);
  }
});
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("conditional assertion");
  });

  it("catches tests with no assertions (L0)", () => {
    const { exitCode, out } = runCheck({
      "noassert.test.js": `
import { it } from "vitest";
it("no assertions", () => {
  const x = 1;
});
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("no assertions");
  });

  it("passes clean files with unconditional assertions", () => {
    const { exitCode } = runCheck({
      "good.test.js": `
import { it, expect } from "vitest";
it("unconditional assertion", () => {
  expect(1).toBe(1);
});
`,
    });
    expect(exitCode).toBe(0);
  });

  it("passes files with expect inside try/catch (legitimate)", () => {
    const { exitCode } = runCheck({
      "trycatch.test.js": `
import { it, expect } from "vitest";
it("try/catch assertion", () => {
  try {
    expect(1).toBe(1);
  } catch (e) {
    throw e;
  }
});
`,
    });
    expect(exitCode).toBe(0);
  });

  // ── E2E skip-typing pass (issue #88, P2) ──────────────────────

  it("catches untyped skip branches in E2E scenarios", () => {
    const { exitCode, out } = runCheckE2e({
      "scenario.mjs": `
export async function run(scope) {
  if (!scope.mockServerConfig) {
    console.log("[S1] 跳过（无 mock 配置）");
    return;
  }
  console.log("[S1] 通过");
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("UNSKIPPED-TYPE");
  });

  it("passes skips typed as SKIP-ENV / SKIP-DATA with an objective premise", () => {
    const { exitCode } = runCheckE2e({
      "scenario.mjs": `
export async function run(scope) {
  if (!managementDeclared) {
    // SKIP-ENV: manifest lacks "management" permission
    console.log("[E6] SKIP-ENV: manifest 未声明 management 权限，结构性不可用");
    return;
  }
  console.log("[E6] 通过");
}
`,
    });
    expect(exitCode).toBe(0);
  });

  it("rejects SKIP-ENV with too-short premise (symptom-as-premise guard)", () => {
    const { exitCode, out } = runCheckE2e({
      "scenario.mjs": `
export async function run(scope) {
  // SKIP-ENV: x
  console.log("[S1] skipped (premise too short)");
  return;
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("UNSKIPPED-TYPE");
  });

  it("honours the skip-typing-allow exemption marker for fatal branches", () => {
    const { exitCode } = runCheckE2e({
      "scenario.mjs": `
export async function run(scope) {
  try {
    await setup();
  } catch (e) {
    console.error("[FATAL] 跳过所有场景"); // skip-typing-allow: 致命分支，返回非零退出
    return 1;
  }
  console.log("done");
}
`,
    });
    expect(exitCode).toBe(0);
  });
});
