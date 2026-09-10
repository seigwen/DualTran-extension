/**
 * Tests for scripts/check-mock-fidelity.js
 *
 * Verifies the mock-fidelity linter catches:
 *   1. Mock page (navigation simulation) with NO declaration
 *   2. Mock page with empty/partial declaration (missing 未模拟)
 *   3. Passes mock pages with complete declarations
 *   4. Passes static pages (no navigation simulation — exempt)
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-mock-fidelity.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mock-fidelity-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function runCheck(files) {
  // Isolated subdir per call — files from one test must not leak into another
  const testDir = join(tmpDir, `case-${counter++}`, "extra", "e2e");
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

const MOCK_SCRIPT = `
<script>
  document.addEventListener("click", function (e) {
    e.preventDefault();
    fetch("target.html").then(function (res) { return res.text(); }).then(function (html) {
      var newBody = document.createElement("body");
      newBody.innerHTML = html;
      document.body.replaceWith(newBody);
      history.pushState({}, "", "target.html");
    });
  });
  window.addEventListener("popstate", function () { location.reload(); });
</script>
`;

describe("check-mock-fidelity", () => {
  it("catches mock pages with NO declaration", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": `<!DOCTYPE html><html><head><title>t</title></head><body>${MOCK_SCRIPT}</body></html>`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("MOCK FIDELITY");
  });

  it("catches mock pages with partial declaration (missing 未模拟)", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": `<!DOCTYPE html><html><head><title>t</title><!-- MOCK FIDELITY: 模拟了 X（来源：实测） --></head><body>${MOCK_SCRIPT}</body></html>`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("未模拟");
  });

  it("passes mock pages with complete declarations", () => {
    const { exitCode } = runCheck({
      "spa-source.html": `<!DOCTYPE html><html><head><title>t</title><!-- MOCK FIDELITY: 模拟了 X（来源：实测）；未模拟 Y（风险：低） --></head><body>${MOCK_SCRIPT}</body></html>`,
    });
    expect(exitCode).toBe(0);
  });

  it("passes static pages (no navigation simulation — exempt)", () => {
    const { exitCode } = runCheck({
      "test-page.html": `<!DOCTYPE html><html><head><title>t</title></head><body><p>static content</p></body></html>`,
    });
    expect(exitCode).toBe(0);
  });
});
