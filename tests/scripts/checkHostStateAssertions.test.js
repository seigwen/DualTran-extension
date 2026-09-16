/**
 * Tests for scripts/check-host-state-assertions.js (S4, issue #53)
 *
 * The lint enforces tri-state host assertions in E2E scenarios
 * (line-level grammar):
 *   H1  host selector literal in a boolean context (`!!` / `Boolean(` /
 *       `!document.` / `.length`) → violation, unless the same line
 *       contains `shadowRoot` or a `// host-state-allow` marker
 *   H2  `inDOM` token → violation (marked exemption allowed)
 *
 * Scope: tests/browser-e2e/*.mjs, excluding setup.mjs.
 *
 * Covered cases:
 *   1.  H1 violation: `!!document.getElementById("dualtran-*-host")`  → exit 1
 *   2.  H1 violation: `querySelectorAll("...").length`               → exit 1
 *   3.  H2 violation: `inDOM` field                                   → exit 1
 *   4.  H1 exempt: same line contains shadowRoot                      → exit 0
 *   5.  H1/H2 exempt: `// host-state-allow` marker                    → exit 0
 *   6.  clean sample: assertHostState / waitForHostState usage        → exit 0
 *   7.  setup.mjs is excluded from the scan                           → exit 0
 *   8.  violation output is line-level locatable (file:line + [H1])   → exit 1
 *   9.  multiple violations counted correctly                          → exit 1
 *   10. empty directory                                               → exit 0
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-host-state-assertions.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "host-state-assertions-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function runCheck(files) {
  // Isolated subdir per call — files from one test must not leak into another
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

const CLEAN_SCENARIO = `import { assertHostState, waitForHostState } from "./setup.mjs";

export async function run(scope) {
  const { page } = scope;
  await waitForHostState(page, "floating", "healthy", { timeoutMs: 10000 });
  const state = await assertHostState(page, "singleton", "shell", { label: "after injection" });
  console.log("count:", state.count);
}
`;

describe("check-host-state-assertions lint", () => {
  it("flags a !! boolean coercion of a host lookup (H1)", () => {
    const { exitCode, out } = runCheck({
      "violation.mjs": `await page.waitForFunction(() => !!document.getElementById("dualtran-singleton-btn-host"));\n`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("[H1]");
  });

  it("flags a querySelectorAll(...).length existence count (H1)", () => {
    const { exitCode, out } = runCheck({
      "violation.mjs": `const n = await page.evaluate(() => document.querySelectorAll("#dualtran-floating-btn-host").length);\n`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("[H1]");
  });

  it("flags the inDOM token (H2)", () => {
    const { exitCode, out } = runCheck({
      "violation.mjs": `return { exists: !!host, inDOM: document.body.contains(host) };\n`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("[H2]");
  });

  it("passes a shadowRoot read on the same line (H1 exemption)", () => {
    const { exitCode } = runCheck({
      "ok.mjs": `const btn = document.getElementById("dualtran-floating-btn-host")?.shadowRoot?.getElementById("btnGoogle");\n`,
    });
    expect(exitCode).toBe(0);
  });

  it("passes when the host-state-allow marker is present (H1/H2 exemption)", () => {
    const { exitCode } = runCheck({
      "ok.mjs": `const present = !!document.getElementById("dualtran-singleton-btn-host"); // host-state-allow: presence-only probe, classification below\nconst inDOM = false; // host-state-allow: legacy field kept for the diagnostic payload\n`,
    });
    expect(exitCode).toBe(0);
  });

  it("passes the clean assertHostState / waitForHostState sample", () => {
    const { exitCode } = runCheck({ "ok.mjs": CLEAN_SCENARIO });
    expect(exitCode).toBe(0);
  });

  it("excludes setup.mjs from the scan", () => {
    const { exitCode } = runCheck({
      "setup.mjs": `const x = !!document.getElementById("dualtran-singleton-btn-host");\nconst y = { inDOM: true };\n`,
    });
    expect(exitCode).toBe(0);
  });

  it("reports violations with file:line locations", () => {
    const { exitCode, out } = runCheck({
      "locatable.mjs": `// header\nconst ok = 1;\nconst bad = !!document.getElementById("dualtran-floating-btn-host");\n`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("locatable.mjs:3");
  });

  it("counts multiple violations across files", () => {
    const { exitCode, out } = runCheck({
      "a.mjs": `const bad = !!document.getElementById("dualtran-floating-btn-host");\n`,
      "b.mjs": `const legacy = { exists: true, inDOM: true };\n`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("2 violation(s)");
  });

  it("passes an empty directory", () => {
    const { exitCode } = runCheck({});
    expect(exitCode).toBe(0);
  });
});
