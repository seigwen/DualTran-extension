#!/usr/bin/env node
/**
 * check-visual-checks.js
 *
 * CI lint (V1 visual judgment layer, issue #67; 20-plan module C).
 *
 * The visual review pipeline has two halves that MUST stay in sync:
 *
 *   - tests/browser-e2e/visual-checks.mjs — the declaration file: every
 *     checkpoint ({ id, scenario, capture, expect[] }) that the AI visual
 *     review consumes. `expect[]` is the criterion list; a checkpoint
 *     without expectations renders the review toothless.
 *
 *   - tests/browser-e2e/*.mjs (setup.mjs + visual-checks.mjs excluded) —
 *     the capture scenarios: every screenshotCheckpoint(page, "<id>") call
 *     site. Originally only visual-audit.mjs was scanned; #72 (escape
 *     analysis mechanism 5) widened the scan to every scenario module so a
 *     capture taken elsewhere cannot silently escape the review.
 *
 * This lint enforces BIDIRECTIONAL coverage between them:
 *
 *   A. Every declared checkpoint must be captured (a declared-but-never-
 *      captured checkpoint means the review waits for a screenshot that
 *      never exists → drift).
 *   B. Every capture call site must be declared (an undeclared capture is
 *      invisible to the review → silent blind spot, exactly the class of
 *      defect V1 exists to close).
 *
 * Plus format rules:
 *   1. Every checkpoint carries a non-empty `expect[]` array.
 *   2. `id` format is [a-z0-9-]+ (stable, issue-dedup friendly).
 *   3. `id` is unique across the file.
 *   4. screenshotCheckpoint ids are STATIC string literals (a dynamic id
 *      cannot be matched against the declaration → hard failure).
 *   5. The CHECKPOINTS export exists and is a non-empty array.
 *
 * Rule 6 (programmatic-assertion coverage, issue #75 — V2):
 *
 *   The fidelity defect proved that `expect[]` alone is not enough: a
 *   checkpoint can declare "no extension UI visible yet" and still capture
 *   a fully translated page. `expect[]` is consumed by the AI review —
 *   which cannot hard-fail a build. Any expectation that is MECHANICALLY
 *   checkable (element counts, text absence, cross-shot difference) must
 *   ALSO be asserted in the capture scenario so the E2E run itself fails.
 *
 *   A checkpoint declares its programmatic assertions via
 *   `programmatic: ["assertXxx", ...]`. This lint enforces:
 *
 *     6a. Every declared name has a call site in the scenario file that
 *         captured that checkpoint (declared-but-never-called ⇒ the
 *         assertion was dropped while the declaration still claims it).
 *     6b. Every id in FIDELITY_CRITICAL_IDS declares >= 1 programmatic
 *         assertion (these carry machine-checkable truth claims; losing
 *         their assertion silently reopens the #75 class of defect).
 *
 * Usage:
 *   node scripts/check-visual-checks.js
 *   node scripts/check-visual-checks.js --checks <fixture> --audit <fixture>
 *     (self-test mode: both paths overridden with isolated fixtures)
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");

const argChecks = process.argv.indexOf("--checks");
const CHECKS_PATH = argChecks !== -1
  ? path.resolve(process.argv[argChecks + 1])
  : path.join(ROOT, "tests", "browser-e2e", "visual-checks.mjs");

const argAudit = process.argv.indexOf("--audit");
const AUDIT_PATH = argAudit !== -1
  ? path.resolve(process.argv[argAudit + 1])
  : path.join(ROOT, "tests", "browser-e2e", "visual-audit.mjs");

// #72 (escape analysis, mechanism 5 — capture blind spots): captures may live in
// ANY scenario file, not only visual-audit.mjs. Before this, a screenshot taken
// in another scenario (e.g. cross-level-journey.mjs) was invisible to the
// review: the declaration ⇔ capture bidirectional rule only ever saw one half.
// We now scan every scenario module in tests/browser-e2e/ (setup.mjs excluded —
// it DEFINES screenshotCheckpoint, it does not call it).
const argAuditDir = process.argv.indexOf("--audit-dir");
const AUDIT_DIR = argAuditDir !== -1
  ? path.resolve(process.argv[argAuditDir + 1])
  : path.join(ROOT, "tests", "browser-e2e");

const ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Checkpoints whose truth claims are mechanically checkable AND were the
 * direct victims of the #75 fidelity defect. Losing their programmatic
 * assertion silently reopens that class of defect, so rule 6b requires
 * each of them to declare >= 1 `programmatic` entry.
 */
const FIDELITY_CRITICAL_IDS = [
  "baseline-untranslated",
  "after-google-translation",
  "replace-original-mode",
];

/**
 * Extract function call-site names from a scenario source.
 *
 * Used by rule 6a: a `programmatic: ["assertXxx"]` declaration must have a
 * matching call site in the scenario that captured the checkpoint. We match
 * `assertXxx(` occurrences so a stale declaration (assertion deleted, or
 * renamed) is caught rather than silently trusted.
 *
 * @param {string} source — scenario module source
 * @returns {Set<string>} called names
 */
function extractCalledNames(source) {
  const called = new Set();
  const CALL = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = CALL.exec(source)) !== null) {
    called.add(m[1]);
  }
  return called;
}

/**
 * Extract screenshotCheckpoint call-site ids from the audit scenario text.
 *
 * Returns { literals: string[], dynamic: number } where `dynamic` counts
 * call sites whose id argument is not a string literal.
 */
function extractCaptureSites(auditSource) {
  const literals = [];
  let dynamic = 0;

  const CALL = /screenshotCheckpoint\s*\(([^)]*)\)/g;
  let m;
  while ((m = CALL.exec(auditSource)) !== null) {
    const args = m[1].split(",");
    if (args.length < 2) continue; // not a capture call shape
    const idArg = args[1].trim();
    const lit = /^(["'])(.*)\1$/.exec(idArg);
    if (lit) {
      literals.push(lit[2]);
    } else {
      dynamic++;
    }
  }

  return { literals, dynamic };
}

async function main() {
  const violations = [];

  // ── Load the declaration file (dynamic import: it is pure data ESM) ──
  let checkpoints;
  try {
    const mod = await import(pathToFileURL(CHECKS_PATH).href);
    checkpoints = mod.CHECKPOINTS;
  } catch (err) {
    console.warn(`⚠️  Cannot load ${path.relative(ROOT, CHECKS_PATH)}: ${err.message}`);
    violations.push("load-failure");
    checkpoints = undefined;
  }

  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    console.warn(
      `⚠️  ${path.relative(ROOT, CHECKS_PATH)} must export a non-empty CHECKPOINTS array ` +
        `(every visual checkpoint declares its id + expect[] criteria).`
    );
    violations.push("missing-export");
  }

  const declared = new Map(); // id → checkpoint

  if (Array.isArray(checkpoints)) {
    for (const cp of checkpoints) {
      const id = cp && cp.id;

      // Rule 2: id format
      if (typeof id !== "string" || !ID_PATTERN.test(id)) {
        console.warn(
          `⚠️  checkpoint id ${JSON.stringify(id)} has an invalid format — ` +
            `id must match [a-z0-9-]+ (stable ids are the issue-dedup key).`
        );
        violations.push("bad-id");
        continue;
      }

      // Rule 3: uniqueness
      if (declared.has(id)) {
        console.warn(`⚠️  duplicate checkpoint id "${id}" — ids must be unique across CHECKPOINTS.`);
        violations.push("duplicate");
        continue;
      }
      declared.set(id, cp);

      // Rule 1: non-empty expect[] with non-empty string items
      if (!Array.isArray(cp.expect) || cp.expect.length === 0) {
        console.warn(
          `⚠️  checkpoint "${id}" has no expect[] entries — ` +
            `every visual checkpoint must declare ≥1 expectation (criterion list for the review).`
        );
        violations.push("empty-expect");
      } else if (cp.expect.some((item) => typeof item !== "string" || item.trim() === "")) {
        console.warn(
          `⚠️  checkpoint "${id}" has an empty expect[] item — ` +
            `every expectation must be a non-empty string (an empty item carries no criterion).`
        );
        violations.push("empty-expect-item");
      }
    }
  }

  // ── Scan the capture scenario(s) ──
  // When --audit is given explicitly, scan exactly that file (self-test mode).
  // Otherwise scan every scenario module under AUDIT_DIR.
  const auditFiles = [];
  if (argAudit !== -1) {
    auditFiles.push(AUDIT_PATH);
  } else if (fs.existsSync(AUDIT_DIR)) {
    for (const entry of fs.readdirSync(AUDIT_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".mjs")) continue;
      if (entry.name === "setup.mjs") continue; // defines the helper
      if (entry.name === "visual-checks.mjs") continue; // declaration file
      auditFiles.push(path.join(AUDIT_DIR, entry.name));
    }
  } else {
    auditFiles.push(AUDIT_PATH);
  }

  const captured = new Set();
  const captureSites = []; // { id, file } for precise messages
  let dynamic = 0;

  for (const file of auditFiles) {
    const source = fs.readFileSync(file, "utf8");
    const { literals, dynamic: dyn } = extractCaptureSites(source);
    dynamic += dyn;
    for (const id of literals) {
      captured.add(id);
      captureSites.push({ id, file });
    }
  }

  // Rule 4: static ids only
  if (dynamic > 0) {
    console.warn(
      `⚠️  ${auditFiles.map((f) => path.relative(ROOT, f)).join(", ")}: ${dynamic} screenshotCheckpoint() ` +
        `call(s) with a non-literal id — ids must be a static string literal so they can be matched against the declaration.`
    );
    violations.push("dynamic-id");
  }

  // Coverage A: declared but never captured
  for (const id of declared.keys()) {
    if (!captured.has(id)) {
      console.warn(
        `⚠️  checkpoint "${id}" is declared in visual-checks.mjs but never captured — ` +
          `no screenshotCheckpoint(page, "${id}") call site exists in visual-audit.mjs.`
      );
      violations.push("never-captured");
    }
  }

  // Coverage B: captured but not declared
  for (const site of captureSites) {
    if (!declared.has(site.id)) {
      console.warn(
        `⚠️  screenshot capture "${site.id}" (${path.relative(ROOT, site.file)}) is not declared in ` +
          `visual-checks.mjs — undeclared captures are invisible to the visual review.`
      );
      violations.push("not-declared");
    }
  }

  // ── Rule 6: programmatic-assertion coverage (issue #75) ──
  // 6a: every declared `programmatic` name must have a call site in a file
  //     that actually captured that checkpoint.
  // 6b: FIDELITY_CRITICAL_IDS must declare >= 1 programmatic assertion.
  const filesById = new Map(); // id → Set<file>
  for (const site of captureSites) {
    if (!filesById.has(site.id)) filesById.set(site.id, new Set());
    filesById.get(site.id).add(site.file);
  }

  const calledByFile = new Map(); // file → Set<name>
  const calledNamesIn = (file) => {
    if (!calledByFile.has(file)) {
      calledByFile.set(file, extractCalledNames(fs.readFileSync(file, "utf8")));
    }
    return calledByFile.get(file);
  };

  for (const [id, cp] of declared.entries()) {
    const declaredProg = Array.isArray(cp.programmatic) ? cp.programmatic : [];

    // 6a — declared names must be called where the checkpoint is captured
    for (const fnName of declaredProg) {
      const owners = filesById.get(id);
      const hasCallSite =
        owners && [...owners].some((file) => calledNamesIn(file).has(fnName));
      if (!hasCallSite) {
        console.warn(
          `⚠️  checkpoint "${id}" declares programmatic: ["${fnName}"] but no ` +
            `${fnName}() call site exists in a file capturing it — ` +
            `the assertion was dropped while the declaration still claims it.`
        );
        violations.push("programmatic-uncalled");
      }
    }

    // 6b — fidelity-critical checkpoints must declare at least one
    if (FIDELITY_CRITICAL_IDS.includes(id) && declaredProg.length === 0) {
      console.warn(
        `⚠️  checkpoint "${id}" carries mechanically checkable truth claims but ` +
          `declares no programmatic assertion — a mechanically checkable ` +
          `expectation must ALSO be asserted in the capture scenario so the E2E ` +
          `run itself fails (issue #75). Declare programmatic: ["assertXxx"].`
      );
      violations.push("missing-programmatic");
    }
  }

  if (violations.length > 0) {
    console.log(`\n${violations.length} visual-checks violation(s) found.`);
    console.log("Every declared checkpoint must be captured; every capture must be declared with expect[] criteria.");
    console.log("See issue #67 and tests/CLAUDE.md '视觉检查点（Visual Checkpoints）'.");
    process.exit(1);
  } else {
    console.log(
      `✅ Visual checks: ${declared.size} checkpoint(s) declared, all captured, ` +
        `all with non-empty expect[] (bidirectional coverage verified).`
    );
    process.exit(0);
  }
}

main();
