/**
 * Tests for scripts/check-state-reachability.js (S1 lint, issue #45)
 *
 * Verifies the state-reachability linter catches:
 *   1. Matrix row referencing a missing test file
 *   2. Matrix row with no test-file reference at all
 *   3. attachShadow call site for an unaudited component (escape guard)
 *   4. Exemption missing 理由 / 上游影响
 *   5. Passes a valid matrix + exemptions
 *   6. Fails when the matrix section is missing entirely
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-state-reachability.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "state-reachability-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function runCheck(docContent, extraFiles = {}, srcFiles = {}) {
  // Isolated subdir per call — files from one test must not leak into another
  const testDir = join(tmpDir, `case-${counter++}`);
  mkdirSync(testDir, { recursive: true });
  const docPath = join(testDir, "CLAUDE.md");
  writeFileSync(docPath, docContent);
  const files = { ...extraFiles };
  for (const [name, content] of Object.entries(files)) {
    const full = join(testDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  // src fixtures (if any) go in <testDir>/src-fixture — passed via --src-dir
  const srcDir = join(testDir, "src-fixture");
  mkdirSync(srcDir, { recursive: true });
  for (const [name, content] of Object.entries(srcFiles)) {
    const full = join(srcDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  try {
    const out = execFileSync("node", [SCRIPT, "--claude-md", docPath, "--src-dir", srcDir], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return { exitCode: e.status ?? 1, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

const SECTION_HEADER = `### 组件状态空间 → 可达性 → 测试引用矩阵（S1 失败状态可达性审计）`;

function matrixDoc(rows, exemptions = []) {
  const header = `| 组件 | 状态 | 可达性 | 测试引用 |\n|---|---|---|---|`;
  const body = rows.join("\n");
  const ex = exemptions.length
    ? `\n\n**豁免记录（transient 组件）：**\n${exemptions.join("\n")}`
    : "";
  return `${SECTION_HEADER}\n\n${header}\n${body}${ex}\n\n## Next Section\n`;
}

describe("check-state-reachability", () => {
  it("catches a matrix row referencing a missing test file", () => {
    const { exitCode, out } = runCheck(
      matrixDoc(["| widget | absent | 单元 | `missing.test.js`「some case」 |"]),
      {},
      { "widget.js": "el.attachShadow({mode:'open'})" }
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("missing test file");
  });

  it("catches a matrix row with no test-file reference", () => {
    const { exitCode, out } = runCheck(
      matrixDoc(["| widget | absent | 单元 | 行为已验证（没有文件引用） |"]),
      {},
      { "widget.js": "el.attachShadow({mode:'open'})" }
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("no test-file reference");
  });

  it("catches an attachShadow call site for an unaudited component", () => {
    const { exitCode, out } = runCheck(
      matrixDoc(
        ["| widget | absent | 单元 | `widget.test.js`「case」 |"],
        ["- `widget` — 理由：transient；上游影响：无用户可见故障。"]
      ),
      { "tests/contentScript/widget.test.js": "// fixture" },
      { "intruder.js": "el.attachShadow({mode:'open'})" }
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("not covered by the S1 matrix");
  });

  it("catches an exemption missing 理由 / 上游影响", () => {
    const { exitCode, out } = runCheck(
      matrixDoc(
        ["| widget | absent | 单元 | `widget.test.js`「case」 |"],
        ["- `stray` — just a bare note."]
      ),
      { "tests/contentScript/widget.test.js": "// fixture" },
      { "stray.js": "el.attachShadow({mode:'open'})" }
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("must state both 理由 and 上游影响");
  });

  it("passes a valid matrix + complete exemptions", () => {
    const { exitCode, out } = runCheck(
      matrixDoc(
        ["| widget | absent | 单元 | `widget.test.js`「case」 |"],
        ["- `stray` — 理由：transient tooltip；上游影响：无用户可见故障。"]
      ),
      { "tests/contentScript/widget.test.js": "// fixture" },
      { "widget.js": "el.attachShadow({mode:'open'})", "stray.js": "el.attachShadow({mode:'open'})" }
    );
    expect(exitCode).toBe(0);
    expect(out).toContain("S1 reachability");
  });

  it("fails when the matrix section is missing entirely", () => {
    const { exitCode, out } = runCheck("# Some other doc\nNo matrix here.\n");
    expect(exitCode).toBe(1);
    expect(out).toContain("not found");
  });
});
