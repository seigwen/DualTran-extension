/**
 * Tests for scripts/check-mock-fidelity.js (S3, issue #51)
 *
 * The lint now enforces FORCED BRANCH ENUMERATION in MOCK FIDELITY
 * declarations (line-level grammar):
 *   R1  >= 1 「分支：」 section header
 *   R2  every item line carries ✅ 已模拟 or ⛔ 未模拟
 *   R3  every ⛔ 未模拟 item carries BOTH 豁免理由 and 上游影响 (same line)
 *   R4  items before any 「分支：」 header are orphan violations
 *   R5  >= 1 ⛔ 未模拟 item overall (no all-✅ whitewashing)
 *   R6  every 「分支：」 section has >= 1 item (no empty sections)
 *
 * Covered cases:
 *   1.  mock page with NO declaration                → exit 1
 *   2.  declaration without any 「分支：」 (old format) → exit 1 (R1)
 *   3.  item missing its mark (no ✅/⛔)               → exit 1 (R2)
 *   4.  ⛔ item missing 豁免理由                       → exit 1 (R3)
 *   5.  ⛔ item missing 上游影响                       → exit 1 (R3)
 *   6.  item before any 「分支：」 (orphan)             → exit 1 (R4)
 *   7.  「分支：」 section with no items (empty)        → exit 1 (R6)
 *   8.  all-✅ declaration (whitewashing)             → exit 1 (R5)
 *   9.  complete valid declaration                    → exit 0
 *   10. static page (no navigation simulation)        → exit 0 (exempt)
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

function pageWithDeclaration(declaration) {
  return `<!DOCTYPE html><html><head><title>t</title>\n${declaration}\n</head><body>${MOCK_SCRIPT}</body></html>`;
}

// A complete valid declaration: 2 sections, simulated + not-simulated items
// with both assessments.
const VALID_DECLARATION = `<!-- MOCK FIDELITY
  分支：恢复路径
  - fetch 新文档：✅ 已模拟
  - bfcache：⛔ 未模拟（豁免理由：Turbo 不用 bfcache；上游影响：无）
  分支：脚本语义
  - 替换的 script 不执行：⛔ 未模拟（豁免理由：测试不依赖；上游影响：无）
-->`;

describe("check-mock-fidelity (S3 branch matrix)", () => {
  it("case 1: mock page with NO declaration → exit 1", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": `<!DOCTYPE html><html><head><title>t</title></head><body>${MOCK_SCRIPT}</body></html>`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("MOCK FIDELITY");
  });

  it("case 2: declaration without any 分支： section (old format) → exit 1 (R1)", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": pageWithDeclaration(
        `<!-- MOCK FIDELITY: 模拟了 X（来源：实测）；未模拟 Y（风险：低） -->`
      ),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("R1");
  });

  it("case 3: item missing its mark (no ✅/⛔) → exit 1 (R2)", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": pageWithDeclaration(`<!-- MOCK FIDELITY
  分支：恢复路径
  - fetch 新文档（来源：实测）
  - bfcache：⛔ 未模拟（豁免理由：Turbo 不用；上游影响：无）
-->`),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("R2");
  });

  it("case 4: ⛔ item missing 豁免理由 → exit 1 (R3)", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": pageWithDeclaration(`<!-- MOCK FIDELITY
  分支：恢复路径
  - fetch 新文档：✅ 已模拟
  - bfcache：⛔ 未模拟（上游影响：无）
-->`),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("豁免理由");
  });

  it("case 5: ⛔ item missing 上游影响 → exit 1 (R3)", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": pageWithDeclaration(`<!-- MOCK FIDELITY
  分支：恢复路径
  - fetch 新文档：✅ 已模拟
  - bfcache：⛔ 未模拟（豁免理由：Turbo 不用）
-->`),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("上游影响");
  });

  it("case 6: item before any 分支： (orphan) → exit 1 (R4)", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": pageWithDeclaration(`<!-- MOCK FIDELITY
  - fetch 新文档：✅ 已模拟
  分支：恢复路径
  - bfcache：⛔ 未模拟（豁免理由：Turbo 不用；上游影响：无）
-->`),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("R4");
  });

  it("case 7: 分支： section with no items (empty) → exit 1 (R6)", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": pageWithDeclaration(`<!-- MOCK FIDELITY
  分支：恢复路径
  - fetch 新文档：✅ 已模拟
  分支：脚本语义
  分支：缓存策略
  - no-cache：⛔ 未模拟（豁免理由：另一页覆盖；上游影响：无）
-->`),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("R6");
  });

  it("case 8: all-✅ declaration (whitewashing) → exit 1 (R5)", () => {
    const { exitCode, out } = runCheck({
      "spa-source.html": pageWithDeclaration(`<!-- MOCK FIDELITY
  分支：恢复路径
  - fetch 新文档：✅ 已模拟
  - 快照渲染：✅ 已模拟
-->`),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("R5");
  });

  it("case 9: complete valid declaration → exit 0", () => {
    const { exitCode } = runCheck({
      "spa-source.html": pageWithDeclaration(VALID_DECLARATION),
    });
    expect(exitCode).toBe(0);
  });

  it("case 10: static page (no navigation simulation) → exit 0 (exempt)", () => {
    const { exitCode } = runCheck({
      "test-page.html": `<!DOCTYPE html><html><head><title>t</title></head><body><p>static content</p></body></html>`,
    });
    expect(exitCode).toBe(0);
  });
});
