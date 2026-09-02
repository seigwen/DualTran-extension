#!/usr/bin/env node
/**
 * check-assertion-strength.js
 *
 * CI lint: assertion-strength ladder enforcement (issue #21, P0-1).
 *
 * Detects two dangerous test patterns:
 *   1. L1 conditional assertions (false-green): `if (x) { expect(...) }`
 *      — when the condition is always false, the expect never runs and the
 *        test passes forever without verifying anything.
 *   2. L0 tests with no assertions: `it("...", () => { ... })` blocks that
 *      contain no expect()/assert() call at all.
 *
 * Legitimate patterns that are NOT flagged:
 *   - expect() inside try/catch (not a conditional)
 *   - expect() inside for/while loops
 *   - it.todo / it.skip blocks
 *   - helper-wrapped assertions: `expectDistFile(...)` / `expectFileExists(...)`
 *     (functions whose name starts with "expect" count as assertions)
 *   - conditional test registration: `if (provider) { it(...) }` — the if
 *     block contains it()/describe() but no expect()
 *   - single-line ifs without a block: `if (!csp) return;`
 *   - property access: `plan.assert(...)` (assert preceded by a dot)
 *   - template-literal fixture strings (content inside backticks)
 *   - explicit exemption marker: `// assertion-strength-allow` on the if line
 *
 * Usage:
 *   node scripts/check-assertion-strength.js            # scan tests/ recursively
 *   node scripts/check-assertion-strength.js --dir <d> # scan a specific dir
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DIR = path.join(ROOT, "tests");

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (/\.test\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
}

/**
 * Scan a test file for assertion-strength violations.
 * Returns an array of { line, type, name } violations.
 */
function scanFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const violations = [];

  const ifStack = []; // { ifLine, ifDepth, hasExpect, hasTestReg, name, allowed }
  const testStack = []; // { startLine, depth, hasExpect, name, isTodo }
  let depth = 0;
  let inTemplate = false; // inside a backtick template literal

  const stripComment = (line) => {
    const idx = line.indexOf("//");
    return idx === -1 ? line : line.slice(0, idx);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = stripComment(raw);
    const trimmed = code.trim();

    // Track template-literal state (naive backtick counting — adequate for linting)
    for (const ch of code) {
      if (ch === "`") inTemplate = !inTemplate;
    }
    if (inTemplate) continue; // skip fixture strings entirely

    // Count braces (ignore braces inside strings — naive but adequate)
    for (const ch of code) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }

    // Detect `if (` at statement level, with a block `{`, not single-line
    const ifMatch = code.match(/^\s*if\s*\(/);
    const hasBlock = code.includes("{");
    const isSingleLineIf = /^\s*if\s*\(.*\)\s*[^;{]*;/.test(code);
    if (ifMatch && hasBlock && !isSingleLineIf) {
      // Exemption marker may sit on the if line or the line above it
      const allowed =
        raw.includes("assertion-strength-allow") ||
        (i > 0 && lines[i - 1].includes("assertion-strength-allow"));
      ifStack.push({
        ifLine: i + 1,
        ifDepth: depth,
        hasExpect: false,
        hasTestReg: false,
        name: trimmed.slice(0, 80),
        allowed,
      });
    }

    // Detect it()/test() block starts
    const testMatch = code.match(/^\s*(it|test)\s*\(\s*["'`]([^"'`]*)["'`]/);
    if (testMatch) {
      const isTodo = /\.todo\s*\(/.test(code) || /\.skip\s*\(/.test(code) || /\.only\s*\(/.test(code);
      testStack.push({
        startLine: i + 1,
        depth: depth,
        hasExpect: false,
        name: testMatch[2],
        isTodo,
      });
    }

    // Detect assertion calls:
    //   - expect(...) / expect.fail(...)
    //   - expectXxx(...) helper functions (expectDistFile, expectFileExists)
    //   - assert(...) NOT preceded by a dot (plan.assert is property access)
    const hasAssert =
      /expect\s*\(/.test(code) ||
      /expect\.fail\s*\(/.test(code) ||
      /expect[A-Z]\w*\s*\(/.test(code) ||
      /(^|[^.\w])assert\s*\(/.test(code);
    if (hasAssert) {
      for (const f of ifStack) f.hasExpect = true;
      for (const t of testStack) t.hasExpect = true;
    }

    // Detect it()/describe() inside if blocks (conditional test registration)
    if (/^\s*(it|test|describe)\s*\(/.test(code)) {
      for (const f of ifStack) f.hasTestReg = true;
    }

    // Close if-blocks whose depth has returned below the opening depth.
    // Note: `<` (not `<=`) — the if() line's `{` is already counted in depth,
    // so the block body sits AT f.ifDepth; only the closing `}` drops below it.
    while (ifStack.length > 0 && depth < ifStack[ifStack.length - 1].ifDepth) {
      const f = ifStack.pop();
      if (f.allowed) continue;
      // Conditional test registration (if { it(...) }) is legitimate — the
      // expects inside belong to the registered tests, not to the if.
      if (f.hasTestReg) continue;
      if (f.hasExpect) {
        violations.push({
          line: f.ifLine,
          type: "L1-conditional-assertion",
          name: f.name,
        });
      }
    }

    // Close test blocks
    while (testStack.length > 0 && depth < testStack[testStack.length - 1].depth) {
      const t = testStack.pop();
      if (!t.isTodo && !t.hasExpect) {
        violations.push({
          line: t.startLine,
          type: "L0-no-assertion",
          name: t.name,
        });
      }
    }
  }

  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf("--dir");
  const scanDir = dirIdx !== -1 ? args[dirIdx + 1] : DEFAULT_DIR;

  const files = [];
  collectFiles(scanDir, files);

  const allViolations = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const violations = scanFile(file);
    for (const v of violations) {
      allViolations.push({ file: rel, ...v });
    }
  }

  if (allViolations.length > 0) {
    console.error("Assertion-strength violations found:");
    for (const v of allViolations) {
      console.error(`  ${v.file}:${v.line} [${v.type}] ${v.name}`);
    }
    console.error("");
    console.error(
      "L1 conditional assertions (`if (x) { expect(...) }`) are the false-green pattern: " +
        "when the condition is always false the test passes forever without verifying anything. " +
        "L0 tests with no assertions verify nothing. " +
        "See issue #21 (assertion strength ladder) and tests/CLAUDE.md."
    );
    process.exit(1);
  }

  console.log(`✅ Assertion strength OK (${files.length} test files scanned).`);
  process.exit(0);
}

main();
