#!/usr/bin/env node
/**
 * check-state-reachability.js
 *
 * CI lint (S1 state-reachability audit, issue #45; 14-plan PR 2).
 *
 * The S1 audit (13-plan §2) proved test capability is multiplicative:
 * reachability × assertion strength × timing fidelity × observation
 * timing. The 8th bug's zero factor was STATE REACHABILITY — the shell
 * state was structurally unreachable in the test environment, so no
 * amount of assertion strength could catch it. This lint keeps the
 * state-space audit honest:
 *
 *   Check A (matrix truthfulness): every row of the matrix section in
 *   tests/CLAUDE.md must carry a test reference that resolves to an
 *   existing test file. A reference to a deleted/renamed test — or a
 *   state row with no reference — is an unreachable state: hard failure.
 *
 *   Check B (attachShadow escape guard): every `attachShadow` call site
 *   under src/ must map either to a matrix component row or to an
 *   explicit transient exemption (with 理由 + 上游影响). A new host
 *   component that escapes the audit = hard failure (mechanism-driven
 *   enumeration, Q2 decision 2026-09-15).
 *
 * Matrix format (tests/CLAUDE.md):
 *
 *   ### 组件状态空间 → 可达性 → 测试引用矩阵（...）
 *   | 组件 | 状态 | 可达性（单元 / E2E） | 测试引用 |
 *   |---|---|---|---|
 *   | floatingBtn | absent | 单元 | `floatingBtn.behavior.test.js`「absent host」3 个 |
 *
 *   **豁免记录（transient 组件）：**
 *   - `showOriginal` — 理由：... 上游影响：...
 *
 * Usage:
 *   node scripts/check-state-reachability.js
 *   node scripts/check-state-reachability.js --claude-md <fixture doc> --src-dir <fixture src>
 *     (self-test mode: refs resolve against the fixture root = dirname
 *      of the given doc; the src scan runs against --src-dir)
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// --claude-md <path> overrides the matrix doc path (used by the self-test
// to run against isolated fixture files). When provided, the repo root
// for test-file existence checks is inferred as the fixture directory
// (fixture layout: <dir>/CLAUDE.md + <dir>/tests/...). Default target is
// tests/CLAUDE.md (the S1 matrix lives there).
const argDoc = process.argv.indexOf("--claude-md");
const DOC_PATH = argDoc !== -1 ? path.resolve(process.argv[argDoc + 1]) : path.join(ROOT, "tests", "CLAUDE.md");
const CHECK_ROOT = argDoc !== -1 ? path.dirname(DOC_PATH) : ROOT;

const argSrc = process.argv.indexOf("--src-dir");
const SRC_DIR = argSrc !== -1 ? path.resolve(process.argv[argSrc + 1]) : path.join(ROOT, "src");

const SECTION_MARKER = "组件状态空间";
const EXEMPTION_MARKER = "豁免记录";
const TEST_FILE_RE = /(\.test\.js|\.mjs)$/;

function collectFiles(dir, filter, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, filter, out);
    } else if (filter(entry.name)) {
      out.push(full);
    }
  }
}

function main() {
  const doc = fs.readFileSync(DOC_PATH, "utf8");
  const lines = doc.split("\n");

  // ── Locate the S1 matrix section ──────────────────────────────
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(SECTION_MARKER)) {
      sectionStart = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,3}\s/.test(lines[j])) {
          sectionEnd = j;
          break;
        }
      }
      break;
    }
  }

  if (sectionStart === -1) {
    console.warn(
      "⚠️  S1 state-space matrix section (组件状态空间) not found in tests/CLAUDE.md — " +
        "the audit artifact must exist; restore the matrix (issue #45)."
    );
    console.log("\n1 state-reachability violation(s) found.");
    process.exit(1);
  }

  const section = lines.slice(sectionStart, sectionEnd);

  // ── Parse matrix rows ─────────────────────────────────────────
  // Row: | component | state | reachability | test-ref |
  const matrixRows = [];
  let inMatrix = false;
  for (const raw of section) {
    const line = raw.trim();
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length >= 4 && cells[0] === "组件") {
        inMatrix = true;
        continue;
      }
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) {
        inMatrix = true;
        continue;
      }
      if (inMatrix && cells.length >= 4) {
        matrixRows.push({ component: cells[0], state: cells[1], reachability: cells[2], ref: cells[3] });
      }
    } else if (line !== "") {
      // Non-table content ends the matrix block
      inMatrix = false;
    }
  }

  // ── Parse exemption list ──────────────────────────────────────
  // Lines: - `componentName` — 理由：... 上游影响：...
  const exemptions = [];
  let inExemptions = false;
  for (const raw of section) {
    const line = raw.trim();
    if (line.includes(EXEMPTION_MARKER)) {
      inExemptions = true;
      continue;
    }
    if (!inExemptions) continue;
    if (line.startsWith("- ")) {
      const m = line.match(/^-\s*`?([A-Za-z_$][\w$]*)`?\s*[—-]/);
      if (!m) {
        console.warn(`⚠️  Unparsable exemption line: "${line.slice(0, 60)}…" — expected "- \`component\` — 理由：… 上游影响：…"`);
        exemptions.push({ name: null, line });
        continue;
      }
      exemptions.push({ name: m[1], line });
    } else if (line !== "" && !line.startsWith("**") && !line.startsWith("|")) {
      inExemptions = false;
    }
  }

  let violations = 0;

  // ── Check A: every row references an existing test ────────────
  if (matrixRows.length === 0) {
    console.warn("⚠️  S1 section found but no matrix rows parsed — the matrix is missing or malformed.");
    violations++;
  }

  // Bare-filename index: recursive search under <CHECK_ROOT>/tests if it
  // exists, else under CHECK_ROOT itself.
  const searchRoot = fs.existsSync(path.join(CHECK_ROOT, "tests")) ? path.join(CHECK_ROOT, "tests") : CHECK_ROOT;
  const byName = new Map();
  const allFiles = [];
  collectFiles(searchRoot, () => true, allFiles);
  for (const f of allFiles) byName.set(path.basename(f), f);

  for (const row of matrixRows) {
    const tokens = (row.ref.match(/`([^`]+)`/g) || []).map((t) => t.replace(/`/g, ""));
    const testTokens = tokens.filter((t) => TEST_FILE_RE.test(t));
    if (testTokens.length === 0) {
      console.warn(`⚠️  Matrix row [${row.component} / ${row.state}] has no test-file reference.`);
      violations++;
      continue;
    }
    for (const token of testTokens) {
      if (token.includes("/")) {
        const resolved = path.resolve(CHECK_ROOT, token);
        if (!fs.existsSync(resolved)) {
          console.warn(`⚠️  Matrix row [${row.component} / ${row.state}] references a missing test file: \`${token}\``);
          violations++;
        }
      } else if (!byName.has(token)) {
        console.warn(
          `⚠️  Matrix row [${row.component} / ${row.state}] references a missing test file: \`${token}\` ` +
            `(no file with this name under ${path.relative(ROOT, searchRoot) || "."})`
        );
        violations++;
      }
    }
  }

  // ── Exemption sanity: each must carry 理由 + 上游影响 ─────────
  for (const ex of exemptions) {
    if (!ex.name) {
      violations++;
      continue;
    }
    if (!ex.line.includes("理由") || !ex.line.includes("上游影响")) {
      console.warn(`⚠️  Exemption \`${ex.name}\` must state both 理由 and 上游影响 (reason + upstream impact).`);
      violations++;
    }
  }

  // ── Check B: attachShadow escape guard ────────────────────────
  const matrixComponents = new Set(matrixRows.map((r) => r.component));
  const exemptNames = new Set(exemptions.map((e) => e.name).filter(Boolean));
  const srcFiles = [];
  collectFiles(SRC_DIR, (n) => /\.js$/.test(n), srcFiles);
  let attachShadowSites = 0;
  for (const f of srcFiles) {
    const content = fs.readFileSync(f, "utf8");
    if (!content.includes("attachShadow")) continue;
    attachShadowSites++;
    const component = path.basename(f, ".js");
    if (!matrixComponents.has(component) && !exemptNames.has(component)) {
      console.warn(
        `⚠️  \`attachShadow\` call site in "${path.relative(ROOT, f)}" is not covered by the S1 matrix ` +
          `and not in the transient-exemption list — add matrix rows or an explicit exemption (理由 + 上游影响).`
      );
      violations++;
    }
  }

  if (violations > 0) {
    console.log(`\n${violations} state-reachability violation(s) found.`);
    console.log("Every host state must map to an existing test; every attachShadow site must be audited or exempted.");
    console.log("See issue #45 and tests/CLAUDE.md '组件状态空间 → 可达性 → 测试引用矩阵'.");
    process.exit(1);
  } else {
    console.log(
      `✅ S1 reachability: ${matrixRows.length} matrix row(s) reference real tests; ` +
        `${attachShadowSites} attachShadow site(s) audited (${matrixComponents.size} component(s) + ${exemptNames.size} exemption(s)).`
    );
    process.exit(0);
  }
}

main();
