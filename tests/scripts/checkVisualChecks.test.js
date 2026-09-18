/**
 * Tests for scripts/check-visual-checks.js (V1 lint, issue #67)
 *
 * Verifies the visual-checks linter catches:
 *   1. A checkpoint with an empty/missing `expect[]`
 *   2. An invalid id format (must be [a-z0-9-]+)
 *   3. Duplicate checkpoint ids
 *   4. Bidirectional coverage A: a declared checkpoint with no screenshot call site
 *   5. Bidirectional coverage B: a screenshot call site with no declaration
 *   6. A dynamic (non-literal) id passed to screenshotCheckpoint
 *   7. Missing/empty CHECKPOINTS export
 *   8. Passes a valid checks + audit pair
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-visual-checks.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "visual-checks-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Run the linter against fixture files. Each call gets an isolated subdir.
 *
 * @param {string} checksContent — content of the visual-checks fixture
 * @param {string} auditContent — content of the visual-audit fixture
 * @returns {{ exitCode: number, out: string }}
 */
function runCheck(checksContent, auditContent) {
  const testDir = join(tmpDir, `case-${counter++}`);
  mkdirSync(testDir, { recursive: true });
  const checksPath = join(testDir, "visual-checks.mjs");
  const auditPath = join(testDir, "visual-audit.mjs");
  writeFileSync(checksPath, checksContent);
  writeFileSync(auditPath, auditContent);
  try {
    const out = execFileSync("node", [SCRIPT, "--checks", checksPath, "--audit", auditPath], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return { exitCode: e.status ?? 1, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

/** Build a checks fixture from checkpoint fragments. */
function checksFile(checkpointBlocks) {
  return `export const CHECKPOINTS = [\n${checkpointBlocks.join(",\n")}\n];\n`;
}

/** A single checkpoint block with sensible valid defaults. */
function checkpoint(id, { expect: expectItems = ["Renders as expected"], extra = "" } = {}) {
  return `  {
    id: "${id}",
    scenario: "visual-audit",
    capture: { page: "mock", when: "after action" },
    expect: [${expectItems.map((t) => `"${t}"`).join(", ")}],${extra ? "\n    " + extra : ""}
  }`;
}

/** Build an audit fixture from a list of ids it captures. */
function auditFile(ids, { dynamic = false } = {}) {
  const body = ids.map((id) => `  await screenshotCheckpoint(page, "${id}");`).join("\n");
  const dyn = dynamic ? `\n  await screenshotCheckpoint(page, someVariable);\n` : "";
  return `import { screenshotCheckpoint } from "./setup.mjs";\n\nexport async function run(scope) {\n  const { page } = scope;\n${body}${dyn}\n}\n`;
}

describe("check-visual-checks", () => {
  it("catches a checkpoint with empty expect[]", () => {
    const { exitCode, out } = runCheck(
      checksFile([checkpoint("baseline-untranslated", { expect: [] }), checkpoint("after-google")]),
      auditFile(["baseline-untranslated", "after-google"])
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("expect");
  });

  it("catches a checkpoint with a missing expect field", () => {
    const broken = `  {\n    id: "baseline-untranslated",\n    scenario: "visual-audit",\n    capture: { page: "mock" }\n  }`;
    const { exitCode, out } = runCheck(checksFile([broken]), auditFile(["baseline-untranslated"]));
    expect(exitCode).toBe(1);
    expect(out).toContain("expect");
  });

  it("catches an empty-string expect[] item", () => {
    const { exitCode, out } = runCheck(
      checksFile([checkpoint("after-google", { expect: [""] })]),
      auditFile(["after-google"])
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("empty expect");
  });

  it("catches an invalid id format", () => {
    const { exitCode, out } = runCheck(
      checksFile([checkpoint("Bad_Id!")]),
      auditFile(["Bad_Id!"])
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("id");
  });

  it("catches duplicate checkpoint ids", () => {
    const { exitCode, out } = runCheck(
      checksFile([checkpoint("after-google"), checkpoint("after-google")]),
      auditFile(["after-google"])
    );
    expect(exitCode).toBe(1);
    expect(out.toLowerCase()).toContain("duplicate");
  });

  it("catches a declared checkpoint with no screenshot call site (bidirectional A)", () => {
    const { exitCode, out } = runCheck(
      checksFile([checkpoint("after-google"), checkpoint("hovered-group")]),
      auditFile(["after-google"])
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("hovered-group");
    expect(out.toLowerCase()).toContain("never captured");
  });

  it("catches a screenshot call site with no declaration (bidirectional B)", () => {
    const { exitCode, out } = runCheck(
      checksFile([checkpoint("after-google")]),
      auditFile(["after-google", "mystery-shot"])
    );
    expect(exitCode).toBe(1);
    expect(out).toContain("mystery-shot");
    expect(out.toLowerCase()).toContain("not declared");
  });

  it("catches a dynamic (non-literal) id passed to screenshotCheckpoint", () => {
    const { exitCode, out } = runCheck(
      checksFile([checkpoint("after-google")]),
      auditFile(["after-google"], { dynamic: true })
    );
    expect(exitCode).toBe(1);
    expect(out.toLowerCase()).toContain("static string");
  });

  it("catches a missing CHECKPOINTS export", () => {
    const { exitCode, out } = runCheck(`// no export here\n`, auditFile([]));
    expect(exitCode).toBe(1);
    expect(out).toContain("CHECKPOINTS");
  });

  it("passes a valid checks + audit pair", () => {
    const { exitCode, out } = runCheck(
      checksFile([checkpoint("baseline-untranslated"), checkpoint("after-google"), checkpoint("hovered-group")]),
      auditFile(["baseline-untranslated", "after-google", "hovered-group"])
    );
    expect(exitCode).toBe(0);
    expect(out).toContain("✅");
  });
});
