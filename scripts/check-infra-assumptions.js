#!/usr/bin/env node
/**
 * check-infra-assumptions.js
 *
 * CI lint (M3, issue #33): infrastructure assumption coverage audit.
 *
 * Rule: every entry in the CLAUDE.md「基础设施假设清单」(Infrastructure
 * Assumptions) section MUST carry a `→ 测试：` reference pointing to an
 * existing test file. An infrastructure assumption without a test
 * reference is an undocumented risk — e.g. the observer mount point was
 * an undocumented assumption until bug 7 (PR #30): both observers were
 * mounted on document.body and died when Turbo Drive replaced the
 * <body> ELEMENT on back-nav.
 *
 * Format (in CLAUDE.md):
 *
 *   **基础设施假设清单（Infrastructure Assumptions，...）—— ...：**
 *   - **假设：** <assumption text> → 测试：`tests/.../file.test.js`「test name」+ `tests/.../other.test.js`
 *
 * Checks:
 *  1. Every `- **假设：**` line inside the section contains `→ 测试：`
 *  2. Every backtick-quoted path in the `→ 测试：` part resolves to an
 *     existing file under the repo root
 *
 * Usage:
 *   node scripts/check-infra-assumptions.js
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// --claude-md <path> overrides the CLAUDE.md path (used by the self-test
// to run against isolated fixture files). When provided, the repo root
// for test-file existence checks is inferred as the fixture directory
// (fixture layout: <dir>/CLAUDE.md + <dir>/tests/...).
const argClaude = process.argv.indexOf("--claude-md");
const CLAUDE_MD = argClaude !== -1 ? path.resolve(process.argv[argClaude + 1]) : path.join(ROOT, "CLAUDE.md");
const CHECK_ROOT = argClaude !== -1 ? path.dirname(CLAUDE_MD) : ROOT;

const SECTION_MARKER = "基础设施假设清单";
const ASSUMPTION_MARKER = "- **假设：**";
const TEST_REF_MARKER = "→ 测试：";

function main() {
  const claudeMd = fs.readFileSync(CLAUDE_MD, "utf8");
  const lines = claudeMd.split("\n");

  // Find the assumptions section
  let inSection = false;
  const assumptions = [];
  for (const line of lines) {
    if (line.includes(SECTION_MARKER)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      // Section ends at the next top-level rule or heading
      if (/^\*\*RULE:/.test(line.trim()) || /^#{1,3}\s/.test(line)) {
        break;
      }
      if (line.trim().startsWith(ASSUMPTION_MARKER)) {
        assumptions.push(line);
      }
    }
  }

  if (assumptions.length === 0) {
    console.log("✅ No infrastructure assumptions found in CLAUDE.md.");
    process.exit(0);
  }

  let violations = 0;

  for (const line of assumptions) {
    // Check 1: must have a test reference
    if (!line.includes(TEST_REF_MARKER)) {
      console.warn(
        `⚠️  Infrastructure assumption without test reference: "${line.trim().slice(0, 80)}…" — ` +
          `add "→ 测试：\`tests/...\`「test name」" (M3, issue #33).`
      );
      violations++;
      continue;
    }

    // Check 2: every backtick-quoted path in the test reference must exist
    const refPart = line.split(TEST_REF_MARKER)[1] || "";
    const paths = refPart.match(/`([^`]+)`/g) || [];
    for (const p of paths) {
      const clean = p.replace(/`/g, "");
      // Only check paths that look like test files (contain "tests/" or "scripts/")
      if (!clean.includes("tests/") && !clean.includes("scripts/")) continue;
      const resolved = path.resolve(CHECK_ROOT, clean);
      if (!fs.existsSync(resolved)) {
        console.warn(
          `⚠️  Infrastructure assumption test reference points to a missing file: \`${clean}\` — ` +
            `fix the path or create the test (M3, issue #33).`
        );
        violations++;
      }
    }
  }

  if (violations > 0) {
    console.log(`\n${violations} infrastructure assumption violation(s) found.`);
    console.log("Every infrastructure assumption must have a test reference to an existing file.");
    console.log("See issue #33 and CLAUDE.md '基础设施假设清单'.");
    process.exit(1);
  } else {
    console.log(`✅ All ${assumptions.length} infrastructure assumption(s) have test references.`);
    process.exit(0);
  }
}

main();
