#!/usr/bin/env node
/**
 * check-observer-mount.js
 *
 * CI lint (M1, issue #31): MutationObserver mount point audit.
 *
 * Rule: MutationObservers must be mounted on getObserverRoot()
 * (document.documentElement) — NEVER on document.body.
 *
 * Why: real Turbo Drive (GitHub) replaces the <body> ELEMENT itself on
 * back-nav (verified live 2026-09-10: document.body !== oldBody after
 * goBack). An observer mounted on document.body dies with the old body —
 * the floating button group and dynamic translation both stop working
 * after SPA back-nav (bug 7, PR #30). The <html> element survives Turbo
 * navigation, so observing it with subtree:true catches body replacement.
 *
 * Detected patterns (hard errors):
 *  - `observe(document.body` — direct body mount
 *  - `observe(body` — variable named body (heuristic; may be a local
 *    variable holding document.body — still a violation of the rule)
 *
 * Exemptions:
 *  - Lines marked with `// observer-mount-allow` (documented exceptions,
 *    checked on the same line or the line above).
 *
 * Usage:
 *   node scripts/check-observer-mount.js
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// --dir <path> overrides the scan root (used by the self-test to run
// against isolated fixture directories).
const argDir = process.argv.indexOf("--dir");
const SRC_DIR = argDir !== -1 ? path.resolve(process.argv[argDir + 1]) : path.join(ROOT, "src");

function collectJsFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(full, out);
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
}

function main() {
  const files = [];
  collectJsFiles(SRC_DIR, files);

  let violations = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) continue;

      const allowed =
        line.includes("observer-mount-allow") ||
        (i > 0 && lines[i - 1].includes("observer-mount-allow"));

      // Strip string literals so `"observe(document.body"` inside a
      // comment or console.log does not trigger the rule.
      const stripped = line.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");

      // Direct body mount: observe(document.body
      if (/observe\(\s*document\.body\b/.test(stripped) && !allowed) {
        console.warn(
          `⚠️  ${rel}:${i + 1}: MutationObserver mounted on document.body — ` +
            `Turbo Drive replaces the <body> ELEMENT on back-nav and the ` +
            `observer dies with it (bug 7, PR #30). Use getObserverRoot() ` +
            `(document.documentElement) instead.`
        );
        violations++;
      }

      // Variable named body: observe(body
      if (/observe\(\s*body\s*[,)]/.test(stripped) && !allowed) {
        console.warn(
          `⚠️  ${rel}:${i + 1}: MutationObserver mounted on a variable named ` +
            `\`body\` — if it holds document.body, the observer dies when ` +
            `Turbo Drive replaces the <body> ELEMENT (bug 7, PR #30). ` +
            `Use getObserverRoot() instead.`
        );
        violations++;
      }
    }
  }

  if (violations > 0) {
    console.log(`\n${violations} observer mount violation(s) found.`);
    console.log("MutationObservers must mount on getObserverRoot() (document.documentElement).");
    console.log("See CLAUDE.md 'observer mount rule' and issue #31.");
    process.exit(1);
  } else {
    console.log(`✅ No observer mount violations found (${files.length} files scanned).`);
    process.exit(0);
  }
}

main();
