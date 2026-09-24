#!/usr/bin/env node
/**
 * check-assertion-strength.js
 *
 * CI lint: assertion-strength ladder enforcement (issue #21, P0-1) +
 * E2E skip typing (issue #88, P2 — the #85 escape).
 *
 * Detects three dangerous test patterns:
 *   1. L1 conditional assertions (false-green): `if (x) { expect(...) }`
 *      — when the condition is always false, the expect never runs and the
 *        test passes forever without verifying anything.
 *   2. L0 tests with no assertions: `it("...", () => { ... })` blocks that
 *      contain no expect()/assert() call at all.
 *   3. UNTYPED E2E SKIP (issue #88): a skip branch in `tests/browser-e2e/*.mjs`
 *      that reports success without stating an objective environment premise.
 *      #85 walked exactly this path: "the button is invisible" was recorded as
 *      `跳过 ✓` — the symptom was accepted as the premise, and the bug hid
 *      behind a green summary. Rule: every skip must say WHY it is legitimate
 *      in a machine-checkable form:
 *        - SKIP-ENV: <objective premise>   (environment premise, e.g. a
 *          browser capability that structurally cannot exist in this harness)
 *        - SKIP-DATA: <objective premise>  (fixture/data premise, e.g. the
 *          scenario intentionally runs without a mock LLM server)
 *      Otherwise → hard failure. A skip whose premise is a *symptom*
 *      ("invisible", "missing", "not found", "did not complete") is never a
 *      valid premise — make the step fail instead (see the #88 rewrites).
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
 *   - `SKIP-ENV:` / `SKIP-DATA:` typed skips (E2E)
 *   - loader resilience logs marked with the `// skip-typing-allow` marker
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
 * Collect E2E scenario modules (`.mjs`) — these are scanned by the skip-typing
 * pass only (the assertion-strength ladder applies to vitest test files).
 */
function collectE2eFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectE2eFiles(full, out);
    } else if (entry.name.endsWith(".mjs")) {
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

/**
 * Skip-typing pass (issue #88, P2). Scans E2E scenario `.mjs` files for skip
 * branches that must declare an objective premise.
 *
 * A "skip site" is a line that announces a skipped step. Because #85 taught us
 * skips come in several dialects, this matches both English and Chinese forms:
 *   - any `console.log/warn/info(` line containing `跳过` or `skipped`/`skipping`
 *     that is not itself a typed declaration
 * A site is typed when the SAME line or either of the two lines above it
 * carries `SKIP-ENV: <premise>` / `SKIP-DATA: <premise>` (≥3 chars of premise).
 *
 * Exemptions:
 *   - `// skip-typing-allow` on the same/adjacent line — for loader resilience
 *     logs that are not step skips (e.g. optional scenario modules).
 *   - Comments lines themselves (they carry no runtime semantics).
 *
 * Returns violations: { line, text }.
 */
const SKIP_TYPED_RE = /\bSKIP-(ENV|DATA):\s*(.+)/;
const SKIP_PREMISE_MIN = 3;
const SKIP_EXEMPT_MARKER = "skip-typing-allow";

function scanE2eSkipTyping(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const violations = [];
  const isE2eScenario = /[\\/]browser-e2e[\\/]/.test(filePath);

  if (!isE2eScenario) return violations;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = stripCommentPortion(line);
    const trimmed = code.trim();
    if (trimmed === "") continue;
    // Only actual logging calls that report a skip count as skip sites.
    const isLogCall = /console\.(log|warn|info|error)\s*\(/.test(code);
    if (!isLogCall) continue;
    const reportsSkip = /跳过|skipped|skipping/i.test(code);
    if (!reportsSkip) continue;

    // Typed on the same line, or the two lines above it?
    const neighbourhood = [lines[i], lines[i - 1] ?? "", lines[i - 2] ?? ""];
    const typedOk = neighbourhood.some((l) => {
      const m = l.match(SKIP_TYPED_RE);
      return Boolean(m) && m[2].trim().length >= SKIP_PREMISE_MIN;
    });
    if (typedOk) continue;

    const exempt = neighbourhood.some((l) => l.includes(SKIP_EXEMPT_MARKER));
    if (exempt) continue;

    violations.push({ line: i + 1, text: trimmed.slice(0, 100) });
  }
  return violations;
}

/** Strip a `//` comment tail while ignoring `//` inside quotes (naive). */
function stripCommentPortion(line) {
  let inS = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inS) {
      if (ch === "\\") i++;
      else if (ch === inS) inS = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inS = ch;
    } else if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
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

  // ── Skip-typing pass (issue #88, P2) ──
  const e2eFiles = [];
  collectE2eFiles(scanDir, e2eFiles);
  for (const file of e2eFiles) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    for (const v of scanE2eSkipTyping(file)) {
      allViolations.push({ file: rel, line: v.line, type: "UNSKIPPED-TYPE", name: v.text });
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
        "UNTYPED SKIPS accept a symptom as a premise (#85 escaped exactly there): " +
        "type every skip as `SKIP-ENV: <objective premise>` or `SKIP-DATA: <objective premise>`, " +
        "or make the step fail. " +
        "See issue #21 (assertion strength ladder), issue #88 (P2 skip typing) and tests/CLAUDE.md."
    );
    process.exit(1);
  }

  console.log(`✅ Assertion strength OK (${files.length} test files + ${e2eFiles.length} E2E modules scanned).`);
  process.exit(0);
}

main();
