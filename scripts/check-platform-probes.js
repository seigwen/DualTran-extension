#!/usr/bin/env node
/**
 * check-platform-probes.js
 *
 * CI lint (P1, issue #88 — escape analysis of #85): platform-shape probe audit.
 *
 * Rule: every environment probe in `src/` (a `typeof X` test against
 * `browser` / `chrome` / `browserApi`) must be covered by a Platform Shape
 * Matrix row in tests/CLAUDE.md, OR carry an explicit exemption.
 *
 * Why: #85 (Chrome 148+ provides the `browser` namespace as an alias of
 * `chrome`, WITHOUT `commands.update`) escaped the entire test system
 * because no environment in it ever presented that platform shape — the
 * probe `typeof browser !== "undefined"` could never take its broken
 * branch under test. Probes that switch on platform identity or capability
 * are shape-sensitive code: every shape they are sensitive to must be
 * enumerated with a test reference, or explicitly exempted with a reason.
 *
 * Detected probes (hard errors when uncovered):
 *  - `typeof browser...` / `typeof chrome...` / `typeof browserApi...`
 *    anywhere in src/**\/*.js (comments and `//`-tails are skipped).
 *    The probed member path is the token, normalized: `?.` → `.`,
 *    `!` stripped, whitespace removed. `typeof browser.commands?.update`
 *    yields token `browser.commands.update`; a bare `typeof chrome`
 *    yields `chrome`.
 *
 * Exemptions:
 *  - Lines marked with `// platform-probe-allow` (same line or the line
 *    above) are skipped.
 *
 * Matrix format (tests/CLAUDE.md, section 「平台形态矩阵」):
 *
 *   - **探测点：** `src/lib/config.js` tokens=`browser`, `browser.commands.update` → 测试：`tests/lib/config.test.js`「cell name」+ ...
 *
 *   · first backtick run = repo-relative src file path
 *   · backtick runs between the file path and `→ 测试：` = covered tokens
 *   · `→ 测试：` part must contain ≥1 backtick-quoted path under tests/ or
 *     scripts/ that resolves to an existing file; a row without a test
 *     reference is a violation.
 *   · multiple rows for the same file are unioned.
 *
 * Usage:
 *   node scripts/check-platform-probes.js
 *   node scripts/check-platform-probes.js --root <dir>   # self-test fixtures
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const argRoot = process.argv.indexOf("--root");
const ROOT = argRoot !== -1 ? path.resolve(process.argv[argRoot + 1]) : path.resolve(__dirname, "..");

const SRC_DIR = path.join(ROOT, "src");
const DOC_PATH = path.join(ROOT, "tests", "CLAUDE.md");
const SECTION_MARKER = "平台形态矩阵";
const ROW_MARKER = "- **探测点：**";
const TEST_REF_MARKER = "→ 测试：";
const EXEMPT_MARKER = "platform-probe-allow";

/** Roots of interest — only probes against these identifiers are audited. */
const PROBE_ROOTS = new Set(["browser", "chrome", "browserApi"]);

/** Normalize a probed member path: strip whitespace, `?.` → `.`, `?`/`!`. */
function normalizeToken(raw) {
  return raw
    .replace(/\s+/g, "")
    .replace(/\?\./g, ".")
    .replace(/[?!]+$/g, "");
}

/**
 * Extract probe tokens from one source line.
 * Returns [] for comment lines. Strips the `//` tail and string-literal
 * contents before matching so neither a commented-out probe nor a probe
 * quoted inside a string counts.
 */
function probeTokens(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("*") || trimmed.startsWith("//")) return [];
  const code = line
    .replace(/\/\/.*$/, "")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
  const tokens = [];
  const re = /\btypeof\s+([A-Za-z_$][\w$]*(?:\s*\??\s*\.\s*[A-Za-z_$][\w$]*)*)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const token = normalizeToken(m[1]);
    const root = token.split(".")[0];
    if (PROBE_ROOTS.has(root)) tokens.push(token);
  }
  return tokens;
}

function collectJsFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
}

/** Scan src → Map<relPath, Map<token, lineNo[]>>. */
function scanProbes() {
  const files = [];
  collectJsFiles(SRC_DIR, files);
  const byFile = new Map();
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const exempt =
        lines[i].includes(EXEMPT_MARKER) || (i > 0 && lines[i - 1].includes(EXEMPT_MARKER));
      if (exempt) continue;
      for (const token of probeTokens(lines[i])) {
        if (!byFile.has(rel)) byFile.set(rel, new Map());
        const m = byFile.get(rel);
        if (!m.has(token)) m.set(token, []);
        m.get(token).push(i + 1);
      }
    }
  }
  return byFile;
}

/** Parse the matrix section of tests/CLAUDE.md → Array<{file, tokens[], refs[], lineNo}>. */
function parseMatrix() {
  if (!fs.existsSync(DOC_PATH)) {
    console.warn(`⚠️  ${path.relative(process.cwd(), DOC_PATH)} not found — cannot verify platform shape matrix.`);
    return null;
  }
  const lines = fs.readFileSync(DOC_PATH, "utf8").split("\n");
  let inSection = false;
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(SECTION_MARKER)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    // Section ends at the next markdown heading.
    if (/^#{1,4}\s/.test(line)) break;
    if (!line.trim().startsWith(ROW_MARKER)) continue;

    const body = line.trim().slice(ROW_MARKER.length);
    const refIdx = body.indexOf(TEST_REF_MARKER);
    const filesPart = refIdx === -1 ? body : body.slice(0, refIdx);
    const refsPart = refIdx === -1 ? "" : body.slice(refIdx + TEST_REF_MARKER.length);

    const backticks = [...filesPart.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const file = backticks[0];
    const tokens = backticks.slice(1);

    const refs = [...refsPart.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1])
      .filter((p) => p.includes("tests/") || p.includes("scripts/"));

    rows.push({ file, tokens, refs, lineNo: i + 1, hasRefMarker: refIdx !== -1 });
  }
  return rows;
}

function main() {
  const probes = scanProbes();
  const rows = parseMatrix();

  let violations = 0;

  if (rows === null) {
    // No doc available — cannot audit. Fail loudly (a missing matrix is
    // exactly the condition this lint exists to prevent).
    process.exit(1);
  }

  // ── Check matrix rows themselves: test refs must resolve ──
  for (const row of rows) {
    if (!row.hasRefMarker || row.refs.length === 0) {
      console.warn(
        `⚠️  tests/CLAUDE.md:${row.lineNo}: platform shape row has no usable test reference — ` +
          `add "→ 测试：\`tests/...\`「cell name」" (P1, issue #88).`
      );
      violations++;
      continue;
    }
    for (const ref of row.refs) {
      const resolved = path.resolve(ROOT, ref);
      if (!fs.existsSync(resolved)) {
        console.warn(
          `⚠️  tests/CLAUDE.md:${row.lineNo}: test reference \`${ref}\` does not resolve to an existing file.`
        );
        violations++;
      }
    }
  }

  // ── Check every probe token is covered by a row ──
  for (const [file, tokenMap] of probes) {
    for (const [token, lineNos] of tokenMap) {
      const covered = rows.some(
        (row) => row.file === file && row.tokens.includes(token)
      );
      if (!covered) {
        for (const lineNo of lineNos) {
          console.warn(
            `⚠️  ${file}:${lineNo}: platform probe \`${token}\` has no platform-shape matrix row — ` +
              `add one to tests/CLAUDE.md 「${SECTION_MARKER}」 with test references, ` +
              `or exempt the line with "// ${EXEMPT_MARKER}" (P1, issue #88).`
          );
        }
        violations += lineNos.length;
      }
    }
  }

  if (violations > 0) {
    console.log(`\n${violations} platform-probe violation(s) found.`);
    console.log("Every environment probe must enumerate its shapes with test references.");
    console.log("See tests/CLAUDE.md '平台形态矩阵' and issue #88 (escape analysis of #85).");
    process.exit(1);
  } else {
    const probeCount = [...probes.values()].reduce((n, m) => n + m.size, 0);
    console.log(
      `✅ Platform shape matrix OK (${probeCount} probe token(s) across ${probes.size} file(s), ${rows.length} matrix row(s)).`
    );
    process.exit(0);
  }
}

main();
