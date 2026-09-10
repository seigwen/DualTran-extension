/**
 * Tests for scripts/check-observer-mount.js
 *
 * Verifies the observer-mount linter catches:
 *   1. Direct body mount: observe(document.body, ...)
 *   2. Variable named body: observe(body, ...)
 *   3. Passes clean files (getObserverRoot mount)
 *   4. Passes exempted lines (// observer-mount-allow)
 *   5. Ignores body mounts inside string literals / comments
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-observer-mount.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "observer-mount-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function runCheck(files) {
  // Isolated subdir per call — files from one test must not leak into another
  const testDir = join(tmpDir, `case-${counter++}`, "src", "contentScript");
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

describe("check-observer-mount", () => {
  it("catches direct body mount: observe(document.body, ...)", () => {
    const { exitCode, out } = runCheck({
      "bad.js": `
const observer = new MutationObserver(() => {});
observer.observe(document.body, { childList: true, subtree: true });
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("document.body");
  });

  it("catches variable named body: observe(body, ...)", () => {
    const { exitCode, out } = runCheck({
      "bad.js": `
const body = document.body;
const observer = new MutationObserver(() => {});
observer.observe(body, { childList: true });
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("variable named");
  });

  it("passes clean files with getObserverRoot mount", () => {
    const { exitCode } = runCheck({
      "good.js": `
// getObserverRoot() returns document.documentElement (src/lib/dom.js)
const observer = new MutationObserver(() => {});
observer.observe(getObserverRoot(), { childList: true, subtree: true });
`,
    });
    expect(exitCode).toBe(0);
  });

  it("passes exempted lines with // observer-mount-allow", () => {
    const { exitCode } = runCheck({
      "exempt.js": `
const observer = new MutationObserver(() => {});
// observer-mount-allow: legacy code, body guaranteed stable here
observer.observe(document.body, { childList: true });
`,
    });
    expect(exitCode).toBe(0);
  });

  it("ignores body mounts inside string literals and comments", () => {
    const { exitCode } = runCheck({
      "strings.js": `
// comment mentioning observe(document.body) is fine
const msg = "observe(document.body) is forbidden";
const observer = new MutationObserver(() => {});
observer.observe(getObserverRoot(), { childList: true });
`,
    });
    expect(exitCode).toBe(0);
  });
});
