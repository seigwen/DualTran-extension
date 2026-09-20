/**
 * Tests for scripts/check-mock-fidelity-vitest.js (issue #72, mechanism 4)
 *
 * The lint enforces arrival-path mock fidelity at the vitest layer:
 *   R1  vi.mock() of a watched module (aiStreamMessage.js / fetchSSE.js) must
 *       pass importOriginal through OR carry a `// mock-fidelity-allow:
 *       <reason>` marker (own line or directly above)
 *   R2  the marker's reason must be non-empty (≥ 3 chars after the colon)
 *
 * Covered cases:
 *   1.  R1 violation: bare factory stub of aiStreamMessage.js       → exit 1
 *   2.  R1 pass: importOriginal factory                              → exit 0
 *   3.  R1 pass: factory body awaiting vi.importActual()             → exit 0
 *   4.  R1 pass: mock-fidelity-allow marker on the mock line         → exit 0
 *   5.  R1 pass: marker on the line directly above                   → exit 0
 *   6.  R2 violation: empty marker reason                            → exit 1
 *   7.  R2 violation: 2-char marker reason                           → exit 1
 *   8.  unrelated modules are not scanned (browser.js etc.)          → exit 0
 *   9.  violation output is line-level locatable (file:line + [R1])  → exit 1
 *   10. nested subdirectories are scanned too                        → exit 1
 *   11. the real repo tree passes (regression guard)                 → exit 0
 *
 * NOTE ON FIXTURE SHAPE: fixture module names are injected through a
 * `__MOD__` placeholder (withModule) so THIS file contains no literal
 * `vi.mock(<watched-module>)` line — otherwise the regression guard (case 11)
 * would scan this very file and flag its fixture strings. The written fixture
 * files do contain the real names, which is exactly what the lint must see.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-mock-fidelity-vitest.js");
const REPO_ROOT = join(__dirname, "..", "..");

const ARRIVAL_MOD = ["aiStream", "Message.js"].join("");
const TRANSPORT_MOD = ["fetch", "SSE.js"].join("");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mock-fidelity-vitest-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Inject the watched module name into a fixture template at write time. */
function withModule(tpl, mod) {
  return tpl.replaceAll("__MOD__", mod);
}

function runCheck(files) {
  const caseDir = join(tmpDir, `case-${counter++}`);
  const testDir = join(caseDir, "tests", "contentScript");
  mkdirSync(testDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(testDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  try {
    const stdout = execFileSync("node", [SCRIPT, "--dir", join(caseDir, "tests"), "--root", caseDir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (err) {
    return { code: err.status, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

const BARE_STUB = `
import { vi } from "vitest";
vi.mock("../../src/contentScript/__MOD__", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(),
}));
`;

const IMPORT_ORIGINAL = `
import { vi } from "vitest";
vi.mock("../../src/contentScript/__MOD__", async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});
`;

const AWAIT_INSIDE = `
import { vi } from "vitest";
vi.mock("../../src/contentScript/__MOD__", async () => {
  const actual = await vi.importActual("../../src/contentScript/__MOD__");
  return actual;
});
`;

const MARKED_OWN_LINE = `
import { vi } from "vitest";
// mock-fidelity-allow: unrelated module, arrival not exercised here
vi.mock("../../src/contentScript/__MOD__", () => ({ translateWithAI: vi.fn() }));
`;

const MARKED_ABOVE = `
import { vi } from "vitest";
// mock-fidelity-allow: observer-filter suite, arrival semantics pinned elsewhere
vi.mock("../../src/contentScript/__MOD__", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(),
}));
`;

const MARKED_EMPTY_REASON = `
import { vi } from "vitest";
// mock-fidelity-allow:
vi.mock("../../src/contentScript/__MOD__", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(),
}));
`;

const MARKED_SHORT_REASON = `
import { vi } from "vitest";
// mock-fidelity-allow: ok
vi.mock("../../src/contentScript/__MOD__", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(),
}));
`;

const UNRELATED_MODULE = `
import { vi } from "vitest";
vi.mock("../../src/contentScript/browser.js", () => ({ default: {} }));
`;

describe("check-mock-fidelity-vitest.js (R1/R2)", () => {
  it("R1 violation: bare factory stub → exit 1", () => {
    const { code } = runCheck({ "cell.test.js": withModule(BARE_STUB, ARRIVAL_MOD) });
    expect(code).toBe(1);
  });

  it("R1 pass: importOriginal factory → exit 0", () => {
    const { code } = runCheck({ "cell.test.js": withModule(IMPORT_ORIGINAL, ARRIVAL_MOD) });
    expect(code).toBe(0);
  });

  it("R1 pass: vi.importActual inside the factory counts as fidelity", () => {
    const { code } = runCheck({ "cell.test.js": withModule(AWAIT_INSIDE, TRANSPORT_MOD) });
    expect(code).toBe(0);
  });

  it("R1 pass: mock-fidelity-allow marker on the mock line → exit 0", () => {
    const { code } = runCheck({ "cell.test.js": withModule(MARKED_OWN_LINE, TRANSPORT_MOD) });
    expect(code).toBe(0);
  });

  it("R1 pass: marker on the line directly above → exit 0", () => {
    const { code } = runCheck({ "cell.test.js": withModule(MARKED_ABOVE, ARRIVAL_MOD) });
    expect(code).toBe(0);
  });

  it("R2 violation: empty marker reason → exit 1", () => {
    const { code } = runCheck({ "cell.test.js": withModule(MARKED_EMPTY_REASON, ARRIVAL_MOD) });
    expect(code).toBe(1);
  });

  it("R2 violation: too-short marker reason → exit 1", () => {
    const { code } = runCheck({ "cell.test.js": withModule(MARKED_SHORT_REASON, ARRIVAL_MOD) });
    expect(code).toBe(1);
  });

  it("unrelated modules are not scanned → exit 0", () => {
    const { code } = runCheck({ "cell.test.js": UNRELATED_MODULE });
    expect(code).toBe(0);
  });

  it("violation output is line-level locatable (file:line + [R1])", () => {
    const { code, output } = runCheck({ "locator.test.js": withModule(BARE_STUB, ARRIVAL_MOD) });
    expect(code).toBe(1);
    expect(output).toMatch(/locator\.test\.js:\d+ \[R1\]/);
  });

  it("nested subdirectories are scanned too", () => {
    const { code } = runCheck({ "nested/deep/cell.test.js": withModule(BARE_STUB, ARRIVAL_MOD) });
    expect(code).toBe(1);
  });

  it("the real repo tree passes (regression guard)", () => {
    let result;
    try {
      const stdout = execFileSync("node", [join(REPO_ROOT, "scripts", "check-mock-fidelity-vitest.js")], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      result = { code: 0, output: stdout };
    } catch (err) {
      result = { code: err.status, output: `${err.stdout || ""}${err.stderr || ""}` };
    }
    expect(result.code, result.output).toBe(0);
  });
});
