#!/usr/bin/env node
/**
 * check-host-state-assertions.js
 *
 * CI lint (S4, issue #53): E2E host-class assertions must use the
 * tri-state assertion library — never raw existence booleans.
 *
 * A two-state `exists` boolean cannot distinguish a Turbo snapshot shell
 * (host present, shadow root absent) from a functional host. The Scene 3
 * false-green in navigation-recovery.mjs survived exactly this way: the
 * assertion checked existence, a shell passed, and a production-confirmed
 * failure state stayed invisible to the suite. Tri-state classification
 * lives in setup.mjs (`readHostState` / `waitForHostState` /
 * `assertHostState`); scenarios must consume it instead of re-deriving
 * booleans.
 *
 * Enforced rules (line-level grammar, hard failure):
 *   H1  a line containing a host selector literal
 *       ("dualtran-floating-btn-host" / "dualtran-singleton-btn-host")
 *       in a boolean context (`!!` / `Boolean(` / `!document.` /
 *       `.length`) is a violation — unless the same line contains
 *       `shadowRoot` (direct shadow-root reads are button-level /
 *       navigation-poking operations, not host classification) or a
 *       `// host-state-allow` marker.
 *   H2  the token `inDOM` anywhere is a violation (marked exemption
 *       allowed) — it is the fossil of the retired two-state vocabulary;
 *       after migration it must be extinct.
 *
 * Scope: tests/browser-e2e/*.mjs, excluding setup.mjs (the tool
 * implementation itself, unit-covered by
 * tests/scripts/hostStateAssertions.test.js).
 *
 * Honest limitation (by design): `exists:` field assignments and
 * indirect references (e.g. via HOST_IDS maps) are NOT auto-caught — a
 * line-level lint is a guard-rail, not a prover. Classification
 * vocabulary discipline + review + the assertion helpers back it up.
 *
 * Usage:
 *   node scripts/check-host-state-assertions.js [--dir <path>]
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// --dir <path> overrides the scan root (used by the self-test to run
// against isolated fixture directories).
const argDir = process.argv.indexOf("--dir");
const E2E_DIR = argDir !== -1 ? path.resolve(process.argv[argDir + 1]) : path.join(ROOT, "tests", "browser-e2e");

const HOST_LITERALS = ["dualtran-floating-btn-host", "dualtran-singleton-btn-host"];
const BOOLEAN_CONTEXT = /!!|Boolean\s*\(|!document\.|\.length/;
const ALLOW_MARKER = "host-state-allow";
const EXCLUDED_FILES = new Set(["setup.mjs"]);

function checkFile(full, display) {
  const content = fs.readFileSync(full, "utf8");
  const lines = content.split("\n");
  const violations = [];

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.includes(ALLOW_MARKER)) return; // explicit exemption marker (either rule)

    // H2: inDOM token — the retired two-state vocabulary.
    if (/\binDOM\b/.test(line)) {
      violations.push(
        `${display}:${lineNo}: [H2] "inDOM" token — the two-state vocabulary is retired; classify via readHostState/assertHostState (shadowRoot-aware tri-state). Explicit exemption: // ${ALLOW_MARKER}`
      );
    }

    // H1: host selector literal in a boolean context.
    const hasHostLiteral = HOST_LITERALS.some((lit) => line.includes(lit));
    if (hasHostLiteral && BOOLEAN_CONTEXT.test(line) && !line.includes("shadowRoot")) {
      violations.push(
        `${display}:${lineNo}: [H1] host selector literal in a boolean context — raw existence booleans cannot see a Turbo shell (host present, shadow root absent). Use waitForHostState/assertHostState from setup.mjs. shadowRoot reads and // ${ALLOW_MARKER} are exempt.`
      );
    }
  });

  return violations;
}

function main() {
  if (!fs.existsSync(E2E_DIR)) {
    console.log(`✅ No browser E2E directory found (${E2E_DIR}).`);
    process.exit(0);
  }

  const files = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith(".mjs") && !EXCLUDED_FILES.has(f));
  let violations = [];

  for (const file of files) {
    const full = path.join(E2E_DIR, file);
    const display = path.relative(ROOT, full);
    violations = violations.concat(checkFile(full, display));
  }

  if (violations.length > 0) {
    console.log("⚠️  Host state assertion violations:");
    for (const v of violations) console.log("  " + v);
    console.log(`\n${violations.length} violation(s) across ${files.length} E2E file(s).`);
    console.log("E2E scenarios must classify host state via the tri-state helpers (issue #53).");
    process.exit(1);
  } else {
    console.log(`✅ All ${files.length} browser E2E file(s) use tri-state host assertions.`);
    process.exit(0);
  }
}

main();
