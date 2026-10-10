#!/usr/bin/env node
/**
 * check-intent-gates.js
 *
 * CI lint (18th architecture check, plan 51 — read-side single-source,
 * #152 family). This is the enforcement arm of the intent-gate SSOT
 * (tests/shared/intent-gates.mjs):
 *
 *   I0  SSOT contract — every registered gate is well-formed (id / file /
 *       refs counts / semantics / reason for typed exemptions / provenance),
 *       files and declared lock files exist on disk.
 *   I1  marker <-> registry — `// [intent-gate:<id>]` markers partition each
 *       scanned file into segments; every marker must be registered and every
 *       registered gate must have exactly one marker (no stale entries).
 *   I2  no orphan refs — every code reference (comments, string literals and
 *       regex literals masked out, template `${...}` interpolations kept) of
 *       the intent tokens must lie inside some segment; refs before a file's first
 *       marker are a hard failure.
 *   I3  count sentinel — each segment's per-token reference counts must
 *       equal the counts declared in the SSOT. Any edit that adds/removes a
 *       reference inside a segment fails until the registry is updated in
 *       the same change (the family-board counter drift lesson, mechanized).
 *   I4  scan-file completeness — every src file containing intent tokens must
 *       be listed in INTENT_SCAN_FILES (a new reader cannot stay silently
 *       untracked).
 *
 * Why this exists: the "highlight / display mismatch" family (M1–M13,
 * 12 incidents) kept recurring at seams where the SAME "effective run intent"
 * was read from different sources by different gates (M11/plan-30 D6 and
 * M13/#152 are the same formula re-split 12 days apart). The derivation
 * formula itself lived as three mirrored copies (C06–C08) until plan 51
 * converged it into intentDerivation.derivePageIntent. This lint keeps both
 * properties from silently eroding.
 *
 * Usage:
 *   node scripts/check-intent-gates.js
 *   node scripts/check-intent-gates.js --probe          (print segments+counts)
 *   node scripts/check-intent-gates.js --root <fixture> (self-test)
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const argRoot = process.argv.indexOf("--root");
const SCAN_ROOT = argRoot !== -1 ? path.resolve(process.argv[argRoot + 1]) : ROOT;
const PROBE = process.argv.includes("--probe");

const SSOT_PATH = path.join(SCAN_ROOT, "tests", "shared", "intent-gates.mjs");
const SRC_DIR = path.join(SCAN_ROOT, "src");

const SEMANTICS = new Set(["level", "edge", "display", "write", "internal", "exempt"]);

/**
 * Mask comments AND string/template literal contents (replaced by spaces,
 * newlines preserved — output length and line structure equal the input).
 * Template `${...}` interpolations are CODE and stay visible.
 * Regex literals are masked via a standard regex-position heuristic
 * (division vs regex); see isRegexStart below.
 */
function maskNonCode(source) {
  let out = "";
  const stack = [];
  let state = "code";
  let quote = null;
  let i = 0;
  const n = source.length;
  let prevSig = ""; // last significant code char (regex-position heuristic)
  let prevWord = ""; // last identifier-shaped run in code
  const REGEX_PRECEDERS = new Set([
    "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "^", "~",
  ]);
  const REGEX_KEYWORDS = new Set([
    "return", "typeof", "instanceof", "case", "in", "of", "new", "delete", "void", "do", "else", "yield", "await",
  ]);
  const isRegexStart = () =>
    prevSig === "" || REGEX_PRECEDERS.has(prevSig) || REGEX_KEYWORDS.has(prevWord);
  const noteCode = (ch) => {
    if (ch === " " || ch === "\t" || ch === "\n") return;
    prevSig = ch;
    prevWord = /[A-Za-z0-9_$]/.test(ch) ? prevWord + ch : "";
  };
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += "\n";
      } else out += " ";
      i++;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (state === "string") {
      if (ch === "\\") {
        out += "  ";
        i += 2;
        continue;
      }
      if (quote === "`" && ch === "$" && next === "{") {
        state = "code";
        out += "${";
        stack.push({ brace: 1 });
        i += 2;
        continue;
      }
      if (ch === quote) {
        state = "code";
        out += " ";
        prevSig = "x";
        prevWord = "";
        i++;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    // state === "code"
    if (ch === "/" && next === "*") {
      state = "block";
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      state = "line";
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && isRegexStart()) {
      // Lookahead within the line: a real regex literal closes on an
      // unescaped "/" outside a character class; otherwise it is division.
      let j = i + 1;
      let cls = false;
      let closes = -1;
      while (j < n) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "\n") break;
        if (c === "[") cls = true;
        else if (c === "]") cls = false;
        else if (c === "/" && !cls) {
          closes = j;
          break;
        }
        j++;
      }
      if (closes !== -1) {
        out += " ".repeat(closes - i + 1);
        i = closes + 1;
        prevSig = "x";
        prevWord = "";
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      state = "string";
      quote = ch;
      out += " ";
      i++;
      continue;
    }
    if (stack.length && ch === "{") stack[stack.length - 1].brace++;
    if (stack.length && ch === "}") {
      stack[stack.length - 1].brace--;
      if (stack[stack.length - 1].brace === 0) {
        stack.pop();
        state = "string";
        quote = "`";
        out += " ";
        i++;
        continue;
      }
    }
    out += ch;
    noteCode(ch);
    i++;
  }
  return out;
}

function collectJsFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
}

function rel(p) {
  return path.relative(SCAN_ROOT, p).replace(/\\/g, "/");
}

/** Analyze one file: markers + per-segment masked token counts + orphan refs. */
function analyzeFile(tokens, fileRel) {
  const abs = path.join(SCAN_ROOT, fileRel);
  if (!fs.existsSync(abs)) {
    return { missing: true, markers: [], segments: [], orphans: [] };
  }
  const src = fs.readFileSync(abs, "utf8");
  const masked = maskNonCode(src);
  if (
    masked.length !== src.length ||
    (masked.match(/\n/g) || []).length !== (src.match(/\n/g) || []).length
  ) {
    throw new Error(`maskNonCode invariant broken on ${fileRel}`);
  }
  const srcLines = src.split("\n");
  const maskedLines = masked.split("\n");
  const markers = [];
  srcLines.forEach((ln, idx) => {
    const m = ln.match(/\/\/\s*\[intent-gate:([a-z0-9-]+)\]/);
    if (m) markers.push({ id: m[1], line: idx + 1 });
  });
  markers.sort((a, b) => a.line - b.line);
  const refs = [];
  maskedLines.forEach((ln, idx) => {
    for (const t of tokens) {
      const c = (ln.match(new RegExp("\\b" + t + "\\b", "g")) || []).length;
      for (let k = 0; k < c; k++) refs.push({ token: t, line: idx + 1, text: srcLines[idx].trim() });
    }
  });
  const segments = [];
  const orphans = [];
  const firstLine = markers.length ? markers[0].line : Infinity;
  for (const r of refs) {
    if (r.line < firstLine) orphans.push(r);
  }
  markers.forEach((m, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].line - 1 : Infinity;
    const counts = {};
    for (const t of tokens) counts[t] = 0;
    const lines = [];
    for (const r of refs) {
      if (r.line >= m.line && r.line <= end) {
        counts[r.token]++;
        lines.push(r);
      }
    }
    const nonZero = {};
    for (const t of tokens) if (counts[t] > 0) nonZero[t] = counts[t];
    segments.push({ id: m.id, line: m.line, end, counts: nonZero, refLines: lines });
  });
  return { missing: false, markers, segments, orphans };
}

async function main() {
  const violations = [];

  // ── Load the SSOT ──
  let mod;
  try {
    mod = await import(pathToFileURL(SSOT_PATH).href);
  } catch (err) {
    console.warn(`⚠️  Cannot load ${rel(SSOT_PATH)}: ${err.message}`);
    console.log("\n1 intent-gate violation(s) found.");
    process.exit(1);
  }
  const tokens = mod.INTENT_TOKENS;
  const scanFiles = mod.INTENT_SCAN_FILES;
  const gates = mod.INTENT_GATES;

  // ── I0: SSOT contract ──
  if (!Array.isArray(tokens) || tokens.length === 0) {
    violations.push("I0: INTENT_TOKENS must be a non-empty array");
  }
  if (!Array.isArray(scanFiles) || scanFiles.length === 0) {
    violations.push("I0: INTENT_SCAN_FILES must be a non-empty array");
  }
  const seenIds = new Map();
  const declaredByFileId = new Map();
  for (const g of gates || []) {
    const where = `gate "${g.id}"`;
    if (typeof g.id !== "string" || !/^[a-z0-9-]+$/.test(g.id)) {
      violations.push(`I0: ${where} has an invalid id`);
      continue;
    }
    if (seenIds.has(g.id)) violations.push(`I0: duplicate gate id "${g.id}"`);
    seenIds.set(g.id, true);
    if (!scanFiles.includes(g.file)) {
      violations.push(`I0: ${where} references file "${g.file}" not in INTENT_SCAN_FILES`);
    }
    const refsKeys = Object.keys(g.refs || {});
    if (refsKeys.length === 0) violations.push(`I0: ${where} declares no refs`);
    for (const k of refsKeys) {
      if (!tokens.includes(k)) violations.push(`I0: ${where} refs unknown token "${k}"`);
      if (!Number.isInteger(g.refs[k]) || g.refs[k] < 1) {
        violations.push(`I0: ${where} refs["${k}"] must be a positive integer`);
      }
    }
    if (!SEMANTICS.has(g.semantics)) violations.push(`I0: ${where} has invalid semantics "${g.semantics}"`);
    if ((g.semantics === "edge" || g.semantics === "exempt") && !(typeof g.reason === "string" && g.reason.trim())) {
      violations.push(`I0: ${where} (${g.semantics}) requires a written reason`);
    }
    if (!Array.isArray(g.locks)) violations.push(`I0: ${where} locks must be an array`);
    for (const l of g.locks || []) {
      if (!fs.existsSync(path.join(SCAN_ROOT, l))) {
        violations.push(`I0: ${where} lock file missing on disk: ${l}`);
      }
    }
    if (!(typeof g.provenance === "string" && g.provenance.trim())) {
      violations.push(`I0: ${where} requires provenance`);
    }
    declaredByFileId.set(`${g.file}::${g.id}`, g);
  }
  for (const f of scanFiles || []) {
    if (!fs.existsSync(path.join(SCAN_ROOT, f))) {
      violations.push(`I0: INTENT_SCAN_FILES entry missing on disk: ${f}`);
    }
  }

  // ── Analyze declared files: I1/I2/I3 ──
  const analysis = new Map();
  for (const f of scanFiles || []) {
    const a = analyzeFile(tokens, f);
    analysis.set(f, a);
    const idsSeen = new Set();
    for (const m of a.markers) {
      if (idsSeen.has(m.id)) violations.push(`I1: ${f} has duplicate marker "${m.id}"`);
      idsSeen.add(m.id);
      const key = `${f}::${m.id}`;
      if (!declaredByFileId.has(key)) {
        violations.push(`I1: ${f}:${m.line} marker [intent-gate:${m.id}] is not registered in the SSOT`);
      }
    }
  }
  for (const [key, g] of declaredByFileId) {
    const [f, id] = key.split("::");
    const a = analysis.get(f);
    if (!a) continue; // file-level issues already reported
    const hits = a.markers.filter((m) => m.id === id);
    if (hits.length === 0) {
      violations.push(`I1: registered gate "${id}" (${f}) has no marker — stale registry entry`);
    }
    if (hits.length > 1) {
      violations.push(`I1: registered gate "${id}" (${f}) has ${hits.length} markers — must be exactly one`);
    }
  }
  for (const [f, a] of analysis) {
    for (const o of a.orphans) {
      violations.push(
        `I2: ${f}:${o.line} has a "${o.token}" reference outside any segment (before the first marker): ${o.text}`
      );
    }
    for (const seg of a.segments) {
      const key = `${f}::${seg.id}`;
      const g = declaredByFileId.get(key);
      if (!g) {
        for (const r of seg.refLines) {
          violations.push(
            `I1: ${f}:${r.line} ref "${r.token}" sits in unregistered segment [intent-gate:${seg.id}]: ${r.text}`
          );
        }
        continue;
      }
      for (const t of tokens) {
        const actual = seg.counts[t] || 0;
        const declared = g.refs[t] || 0;
        if (actual !== declared) {
          violations.push(`I3: ${f} segment "${seg.id}": "${t}" declared ${declared}, actual ${actual}`);
          for (const r of seg.refLines.filter((x) => x.token === t)) {
            violations.push(`      … actual ref at line ${r.line}: ${r.text}`);
          }
        }
      }
    }
  }

  // ── I4: scan-file completeness sweep ──
  if (Array.isArray(scanFiles) && Array.isArray(tokens)) {
    const all = [];
    collectJsFiles(SRC_DIR, all);
    for (const abs of all) {
      const r = rel(abs);
      if (scanFiles.includes(r)) continue;
      let masked;
      try {
        masked = maskNonCode(fs.readFileSync(abs, "utf8"));
      } catch {
        continue;
      }
      for (const t of tokens) {
        if (new RegExp("\\b" + t + "\\b").test(masked)) {
          violations.push(
            `I4: ${r} references "${t}" but is not listed in INTENT_SCAN_FILES (register it + markers, or route through the single source)`
          );
          break;
        }
      }
    }
  }

  if (violations.length > 0) {
    for (const v of violations) console.warn(`⚠️  ${v}`);
    console.log(`\n${violations.length} intent-gate violation(s) found.`);
    console.log("See plan 51 (read-side single-source) / tests/shared/intent-gates.mjs.");
    if (!PROBE) process.exit(1);
  }

  if (PROBE) {
    for (const f of scanFiles) {
      const a = analysis.get(f);
      console.log(`\n── ${f} ──`);
      for (const seg of a.segments) {
        const span = seg.end === Infinity ? "EOF" : seg.end;
        console.log(`  [intent-gate:${seg.id}] lines ${seg.line}-${span} → ${JSON.stringify(seg.counts)}`);
        for (const r of seg.refLines) console.log(`      ${r.line}: ${r.token} — ${r.text}`);
      }
    }
    process.exit(violations.length > 0 ? 1 : 0);
  }

  let segCount = 0;
  let refCount = 0;
  for (const a of analysis.values()) {
    segCount += a.segments.length;
    for (const seg of a.segments) refCount += Object.values(seg.counts).reduce((x, y) => x + y, 0);
  }
  console.log(
    `✅ intent-gate check passed — ${scanFiles.length} files, ${segCount} segments, ${refCount} registered refs.`
  );
  process.exit(0);
}

main();
