/**
 * Tests for scripts/check-platform-probes.js (P1 lint, issue #88)
 *
 * Verifies the platform-shape probe audit catches:
 *   1. A probe token with no matrix row (hard failure)
 *   2. A matrix row whose test reference does not resolve
 *   3. A matrix row with no test reference at all
 *   4. Comments / string literals are not treated as probes
 *   5. Exemption marker `// platform-probe-allow` silences a probe
 *   6. Passes a complete matrix (probes covered, refs resolve)
 *   7. Multiple rows for one file union their tokens
 *   8. Fails when the matrix section is missing entirely
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-platform-probes.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "platform-probes-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Run the lint against an isolated fixture root.
 * Fixture layout: <case>/src/*.js, <case>/tests/CLAUDE.md, <case>/tests/<ref>.test.js
 */
function runCheck(srcFiles = {}, docContent = null, refFiles = {}) {
  const caseDir = join(tmpDir, `case-${counter++}`);
  mkdirSync(join(caseDir, "src"), { recursive: true });
  mkdirSync(join(caseDir, "tests"), { recursive: true });
  for (const [name, content] of Object.entries(srcFiles)) {
    writeFileSync(join(caseDir, "src", name), content);
  }
  for (const [name, content] of Object.entries(refFiles)) {
    writeFileSync(join(caseDir, "tests", name), content);
  }
  if (docContent !== null) {
    writeFileSync(join(caseDir, "tests", "CLAUDE.md"), docContent);
  }
  try {
    const out = execFileSync("node", [SCRIPT, "--root", caseDir], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return { exitCode: e.status ?? 1, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

const SECTION = `### 平台形态矩阵（P1）`;
const MATRIX = (rows) => `${SECTION}\n\n${rows.join("\n")}\n\n## Next Section\n`;

describe("check-platform-probes", () => {
  it("catches a probe token with no matrix row", () => {
    const { exitCode, out } = runCheck(
      { "a.js": `if (typeof browser !== "undefined") { work(); }` },
      MATRIX(["- **探测点：** `src/other.js` tokens=`chrome` → 测试：`tests/b.test.js`"])
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("browser");
    expect(out).toContain("no platform-shape matrix row");
  });

  it("catches a matrix row whose test reference does not resolve", () => {
    const { exitCode, out } = runCheck(
      { "a.js": `if (typeof browser !== "undefined") { work(); }` },
      MATRIX(["- **探测点：** `src/a.js` tokens=`browser` → 测试：`tests/missing.test.js`"])
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("does not resolve");
  });

  it("catches a matrix row with no test reference at all", () => {
    const { exitCode, out } = runCheck(
      { "a.js": `if (typeof browser !== "undefined") { work(); }` },
      MATRIX(["- **探测点：** `src/a.js` tokens=`browser`"])
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("no usable test reference");
  });

  it("ignores probes inside comments and string literals", () => {
    const { exitCode } = runCheck(
      {
        "a.js": `// typeof browser !== "undefined" in a comment\nconst msg = 'typeof chrome !== "undefined"';\n`,
      },
      MATRIX([])
    );
    expect(exitCode).toBe(0);
  });

  it("passes a complete matrix (probes covered, references resolve)", () => {
    const { exitCode } = runCheck(
      { "a.js": `if (typeof browser.commands?.update === "function") { work(); }` },
      MATRIX([
        "- **探测点：** `src/a.js` tokens=`browser.commands.update` → 测试：`tests/shape.test.js`「Chrome 148+」",
      ]),
      { "shape.test.js": "// fixture test file\n" }
    );
    expect(exitCode).toBe(0);
  });

  it("unions tokens across multiple rows for the same file", () => {
    const { exitCode } = runCheck(
      {
        "a.js": `const x = typeof chrome;\nconst y = typeof browser.commands?.update;\n`,
      },
      MATRIX([
        "- **探测点：** `src/a.js` tokens=`chrome` → 测试：`tests/shape.test.js`",
        "- **探测点：** `src/a.js` tokens=`browser.commands.update` → 测试：`tests/shape.test.js`",
      ]),
      { "shape.test.js": "// fixture test file\n" }
    );
    expect(exitCode).toBe(0);
  });

  it("honors the exemption marker on the probe line and the line above", () => {
    const { exitCode } = runCheck(
      {
        "a.js": [
          `// platform-probe-allow: third-party shim`,
          `if (typeof chrome !== "undefined") { a(); }`,
          `if (typeof browser !== "undefined") { b(); } // platform-probe-allow`,
        ].join("\n"),
      },
      MATRIX([])
    );
    expect(exitCode).toBe(0);
  });

  it("fails when the matrix section is missing entirely", () => {
    const { exitCode, out } = runCheck(
      { "a.js": `if (typeof chrome !== "undefined") { work(); }` },
      `# tests/CLAUDE.md\n\nNo matrix section here.\n`
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("chrome");
  });
});
