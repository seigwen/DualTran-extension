#!/usr/bin/env node
/**
 * check-core-boundary.js — src/core must stay host-free (plan 59 M4-3).
 *
 * Rules enforced on src/core/**\/*.js:
 *   1. no host-global access in CODE (strings/comments are stripped first, so
 *      documentation may mention chrome.* without tripping this):
 *        chrome.  window.  document.  indexedDB  location.
 *        alert(  confirm(  prompt(
 *   2. relative imports must stay INSIDE src/core/ — no reaching into
 *      src/background | contentScript | options | popup | util (or anywhere
 *      else in the extension tree)
 *   3. no absolute / chrome-extension:// specifiers
 *
 * Usage:
 *   node scripts/check-core-boundary.js            # scans src/core (CI / verify)
 *   node scripts/check-core-boundary.js --dir <d>  # fixture calibration (tests)
 *
 * Exit code 1 when violations are found.
 *
 * Calibration: tests/manifest/coreBoundary.test.js runs this script against
 * both the clean tree (must PASS) and fixture dirs (violations must go RED,
 * string/comment mentions must NOT) — a guard never proven to fire is dead.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const dirArgIdx = process.argv.indexOf("--dir");
const CORE_DIR = dirArgIdx !== -1 ? path.resolve(process.argv[dirArgIdx + 1]) : path.join(ROOT, "src", "core");

/**
 * Replace string literals, template literals and comments with spaces —
 * newlines are preserved so reported line numbers stay accurate.
 *
 * Template interpolations (`${...}`) ARE scanned as code: a host-global
 * reference hidden inside an interpolation must still go RED (calibrated by
 * a fixture in tests/manifest/coreBoundary.test.js).
 */
function stripLiteralsAndComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const stack = []; // "template" | { interp: braceDepth }
  const inCode = () => stack.length === 0 || typeof stack[stack.length - 1] === "object";

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (!inCode()) {
      // template-literal content
      if (c === "\\") { i += 2; continue; }
      if (c === "$" && c2 === "{") { stack.push({ interp: 1 }); i += 2; continue; }
      if (c === "`") { stack.pop(); i++; out += " "; continue; }
      if (c === "\n") out += "\n";
      i++;
      continue;
    }

    // code (top level, or inside a ${...} interpolation)
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i = Math.min(i + 2, n);
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "\n") out += "\n";
        if (src[i] === quote) { i++; break; }
        i++;
      }
      out += " ";
      continue;
    }
    if (c === "`") { stack.push("template"); i++; continue; }
    if (c === "{") {
      const top = stack[stack.length - 1];
      if (top && typeof top === "object") top.interp++;
      out += c;
      i++;
      continue;
    }
    if (c === "}") {
      const top = stack[stack.length - 1];
      if (top && typeof top === "object") {
        top.interp--;
        if (top.interp === 0) { stack.pop(); i++; continue; } // back into the template
        out += c;
        i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

const HOST_GLOBAL_RULES = [
  { re: /\bchrome\s*\./, name: "chrome.* host API" },
  { re: /\bwindow\s*\./, name: "window.* host API" },
  { re: /\bdocument\s*\./, name: "document.* host API" },
  { re: /\bindexedDB\b/, name: "indexedDB" },
  { re: /\blocation\s*\./, name: "location.* host API" },
  { re: /\balert\s*\(/, name: "alert()" },
  { re: /\bconfirm\s*\(/, name: "confirm()" },
  { re: /\bprompt\s*\(/, name: "prompt()" },
];

function collectFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

function main() {
  const files = [];
  collectFiles(CORE_DIR, files);

  const violations = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const raw = fs.readFileSync(file, "utf8");
    const code = stripLiteralsAndComments(raw);

    // Rule 1 — host globals in code
    const codeLines = code.split("\n");
    for (let lineNo = 0; lineNo < codeLines.length; lineNo++) {
      for (const rule of HOST_GLOBAL_RULES) {
        if (rule.re.test(codeLines[lineNo])) {
          violations.push(`${rel}:${lineNo + 1}: forbidden host global — ${rule.name}`);
        }
      }
    }

    // Rule 2/3 — import specifiers (static + dynamic, raw text)
    const specifiers = [];
    for (const m of raw.matchAll(/\bfrom\s*["']([^"']+)["']/g)) specifiers.push({ spec: m[1], index: m.index });
    for (const m of raw.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push({ spec: m[1], index: m.index });
    const layerRe = /(^|\/)(background|contentScript|options|popup|util)\//;
    for (const { spec, index } of specifiers) {
      const at = `${rel}:${lineOf(raw, index)}:`;
      if (spec.startsWith("chrome-extension://") || spec.startsWith("/")) {
        violations.push(`${at} absolute/extension specifier is not allowed in core — "${spec}"`);
        continue;
      }
      if (spec.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), spec);
        const corePrefix = CORE_DIR.endsWith(path.sep) ? CORE_DIR : CORE_DIR + path.sep;
        if (!(resolved + path.sep).startsWith(corePrefix) && resolved !== CORE_DIR) {
          violations.push(`${at} relative import escapes src/core — "${spec}"`);
        }
      }
      if (layerRe.test(spec)) {
        violations.push(`${at} import reaches the extension layer — "${spec}"`);
      }
      // Bare specifiers (npm packages, node: builtins) are allowed here; a
      // stricter dependency allowlist is a deliberate non-goal for this round.
    }
  }

  if (violations.length > 0) {
    console.log("❌ core boundary violations:");
    for (const v of violations) console.log(`   ${v}`);
    console.log(`\n${violations.length} violation(s) across ${files.length} file(s).`);
    process.exit(1);
  }

  console.log(`✅ core boundary clean — ${files.length} file(s) scanned, no host globals, no escaping imports.`);
  process.exit(0);
}

main();
