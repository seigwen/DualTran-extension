#!/usr/bin/env node
/**
 * check-mock-fidelity-vitest.js
 *
 * CI lint #12 (issue #72, mechanism 4 — mock fidelity reversal at the vitest
 * layer).
 *
 * THE GAP THIS CLOSES (#70 escape)
 * The #70 escape was invisible to every existing mechanism because the test
 * harness silently stubbed the arrival-path parser:
 *
 *   vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
 *     parseOpenAiStyleStreamMessage: vi.fn(() => ({ type: "done" })),
 *     ...
 *   }));
 *
 * With that stub, the streaming path could not be observed at all — any stream
 * request parsed to nothing, and the harness's own "control" tests went red.
 * That is a test-double simplification that eats the signal. The E2E layer has
 * a mock-fidelity mechanism (check-mock-fidelity.js, branch enumeration on mock
 * pages, S3); the vitest layer had NO equivalent audit — hundreds of
 * `vi.mock(...)` inline factories repo-wide, zero declarations.
 *
 * ENFORCED RULES (hard failure)
 *   R1  Every `vi.mock()` of an ARRIVAL-PATH MODULE must either
 *       (a) pass `importOriginal` through (factory receives/awaits it), or
 *       (b) carry a `// mock-fidelity-allow: <non-empty reason>` marker on the
 *           mock statement's line or the line directly above it.
 *   R2  The exemption reason must be non-empty (≥ 3 chars after the colon) —
 *       a bare marker is bookkeeping, not an audit.
 *
 * SCOPE: tests/**<slash>*.test.js. Only the watched module list below is
 * checked — it is an INCREMENTAL list: a module joins it when a mock of that
 * module has ever eaten a signal. First members (the #70 lesson):
 * aiStreamMessage.js (stream parser) + fetchSSE.js (network transport).
 *
 * NOTE on `importOriginal` for stubbed deps: passing the real module through is
 * not always right (a test that wants zero network must stub fetchSSE), which
 * is exactly why (b) exists — the point is that SOMEONE stated the reason, so
 * the simplification is visible instead of silent.
 *
 * Usage:
 *   node scripts/check-mock-fidelity-vitest.js [--dir <path>] [--root <path>]
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// --dir <path> overrides the scan root; --root <path> overrides the path the
// resolved module names are reported against (self-test isolation).
const argDir = process.argv.indexOf("--dir");
const SCAN_DIR = argDir !== -1 ? path.resolve(process.argv[argDir + 1]) : path.join(ROOT, "tests");
const argRoot = process.argv.indexOf("--root");
const REPORT_ROOT = argRoot !== -1 ? path.resolve(process.argv[argRoot + 1]) : ROOT;

/**
 * Arrival-path modules whose mocks must declare fidelity.
 * INCREMENTAL list — append, with a comment naming the incident, when a mock of
 * a module has ever hidden a real signal. See issue #72 / doc 21.
 */
const WATCHED_MODULES = [
  "aiStreamMessage.js", // #70: stubbed parser made the stream path unobservable
  "fetchSSE.js",        // #70: stubbed transport hid arrival ordering
];

const EXEMPTION_RE = /\/\/\s*mock-fidelity-allow:\s*(.*)$/;

const MARKER_REASON_MIN = 3;

function collectTestFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
    } else if (entry.name.endsWith(".test.js")) {
      out.push(full);
    }
  }
}

/**
 * Find vi.mock() call sites of watched modules in a file.
 * Returns [{ line, module, snippetStart }].
 * The call may span multiple lines; we locate the opening line and then scan
 * forward a bounded window for the factory body.
 */
function findWatchedMocks(lines) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/vi\.mock\s*\(/.test(line)) continue;
    for (const mod of WATCHED_MODULES) {
      // The module name appears in the string literal argument.
      if (!line.includes(mod)) continue;
      hits.push({ line: i + 1, index: i, module: mod });
    }
  }
  return hits;
}

/**
 * A mock is fidelity-faithful when the real module participates within the
 * call's forward window: either the classic vitest `importOriginal` factory
 * parameter, or an in-factory `vi.importActual(...)` of the same module.
 */
function usesImportOriginal(lines, startIndex) {
  const WINDOW = 14;
  const end = Math.min(lines.length, startIndex + WINDOW);
  for (let i = startIndex; i < end; i++) {
    if (/importOriginal|importActual/.test(lines[i])) return true;
  }
  return false;
}

/** The exemption reason from the mock line or the line directly above it. */
function readExemption(lines, startIndex) {
  const own = lines[startIndex].match(EXEMPTION_RE);
  if (own) return own[1];
  if (startIndex > 0) {
    const prev = lines[startIndex - 1].match(EXEMPTION_RE);
    if (prev) return prev[1];
  }
  return null;
}

function scanFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const violations = [];

  for (const hit of findWatchedMocks(lines)) {
    if (usesImportOriginal(lines, hit.index)) continue;

    const reason = readExemption(lines, hit.index);
    if (reason === null) {
      violations.push({
        line: hit.line,
        rule: "R1",
        message:
          `vi.mock("${hit.module}") is a silent simplification — pass importOriginal ` +
          `or add "// mock-fidelity-allow: <reason>"`,
      });
      continue;
    }
    if (reason.trim().length < MARKER_REASON_MIN) {
      violations.push({
        line: hit.line,
        rule: "R2",
        message: `mock-fidelity-allow marker has an empty/too-short reason ("${reason.trim()}")`,
      });
    }
  }

  return violations;
}

function main() {
  const files = [];
  collectTestFiles(SCAN_DIR, files);

  let violations = 0;
  for (const file of files) {
    const errs = scanFile(file);
    if (!errs.length) continue;
    const rel = path.relative(REPORT_ROOT, file).replace(/\\/g, "/");
    for (const err of errs) {
      console.warn(`⚠️  ${rel}:${err.line} [${err.rule}] ${err.message}`);
    }
    violations += errs.length;
  }

  if (violations > 0) {
    console.log(`\n${violations} vitest mock-fidelity violation(s) found (${files.length} test file(s) scanned).`);
    console.log("Arrival-path mocks must declare fidelity (importOriginal) or an explicit exemption reason.");
    console.log("See issue #72 and tests/CLAUDE.md 'vitest mock 保真' authoring rules.");
    process.exit(1);
  }

  console.log(
    `✅ vitest mock fidelity OK (${files.length} test file(s) scanned; watched: ${WATCHED_MODULES.join(", ")}).`
  );
  process.exit(0);
}

main();
