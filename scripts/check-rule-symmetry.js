#!/usr/bin/env node
/**
 * check-rule-symmetry.js
 *
 * CI lint: rule symmetry check (issue #21, P1-2).
 *
 * Scans CLAUDE.md for documented business rules that carry an explicit
 * implementation-point list (marked with "实现点清单"), then verifies each
 * implementation point is referenced by at least one test file.
 *
 * A rule with multiple implementation points MUST have symmetric test
 * coverage — if one implementation point has a test and another doesn't,
 * the rule is asymmetric and a bug can hide in the untested point
 * (e.g. the translation-color rule: AI side guarded+tested, Google side
 * neither — PR #20).
 *
 * CLAUDE.md rule format:
 *
 *   **RULE: <rule name>** ...
 *   - **实现点清单（规则对称性）**：`funcA`（描述）、`funcB`（描述）、`funcC`（描述）
 *
 * Usage:
 *   node scripts/check-rule-symmetry.js
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
const TESTS_DIR = path.join(ROOT, "tests");

// Implementation-point marker in CLAUDE.md
const IMPL_POINT_MARKER = "实现点清单";

function collectTestFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
    } else if (/\.(test|integration\.test)\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function main() {
  const claudeMd = fs.readFileSync(CLAUDE_MD, "utf8");
  const lines = claudeMd.split("\n");

  // Find rule sections with implementation-point lists
  const rules = [];
  let currentRule = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\*\*RULE:/.test(line.trim())) {
      currentRule = { name: line.trim().replace(/^\*\*RULE:\s*/, "").replace(/\*\*.*$/, ""), implPoints: [] };
      rules.push(currentRule);
      continue;
    }
    if (currentRule && line.includes(IMPL_POINT_MARKER)) {
      // Parse backtick-quoted identifiers: `funcName`
      const matches = line.matchAll(/`([A-Za-z_$][\w$]*)`/g);
      for (const m of matches) {
        currentRule.implPoints.push(m[1]);
      }
    }
  }

  const rulesWithPoints = rules.filter((r) => r.implPoints.length > 0);
  if (rulesWithPoints.length === 0) {
    console.log("✅ No rules with implementation-point lists found in CLAUDE.md.");
    process.exit(0);
  }

  // Collect all test file contents
  const testFiles = [];
  collectTestFiles(TESTS_DIR, testFiles);
  const testContents = testFiles.map((f) => ({
    rel: path.relative(ROOT, f).replace(/\\/g, "/"),
    content: fs.readFileSync(f, "utf8"),
  }));

  let violations = 0;
  for (const rule of rulesWithPoints) {
    for (const implPoint of rule.implPoints) {
      const referenced = testContents.some((t) => t.content.includes(implPoint));
      if (!referenced) {
        console.warn(
          `⚠️  Rule "${rule.name}": implementation point \`${implPoint}\` has NO test reference — rule asymmetric`
        );
        violations++;
      }
    }
  }

  if (violations > 0) {
    console.log(`\n${violations} rule-symmetry violation(s) found.`);
    console.log("Every implementation point of a documented rule must have test coverage.");
    console.log("See issue #21 (rule symmetry) and CLAUDE.md 'Translation Invariants'.");
    process.exit(1);
  } else {
    console.log(`✅ All implementation points of ${rulesWithPoints.length} rule(s) have test references.`);
    process.exit(0);
  }
}

main();
