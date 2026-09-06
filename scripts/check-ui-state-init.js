#!/usr/bin/env node
/**
 * check-ui-state-init.js
 *
 * CI lint (D1): UI state initialization lint.
 *
 * Detects UI components that hardcode their initial highlight/displayMode
 * state instead of deriving it from the engine's live state. This is the
 * exact pattern that caused the SPA back-nav highlight bug (PR #23):
 * floatingBtn.show() rebuilt the button group with hardcoded
 * "highlight = \"original\"" while the page was actually translated.
 *
 * Rule: in src/contentScript/, any `let highlight = "<literal>"` or
 * `let displayMode = "<literal>"` inside a function (closure) is a
 * violation — the initial state must come from a query (pageTranslator
 * getState) or a pure function (resolveInitialUiState).
 *
 * Exemptions:
 * - Module-level declarations (engine state lives at module scope and is
 *   legitimately initialized once, e.g. pageTranslator's
 *   `let pageLanguageState = "original"`).
 * - Lines marked with `// ui-state-init-allow` (documented exceptions).
 *
 * Usage:
 *   node scripts/check-ui-state-init.js
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src", "contentScript");

// State variables that must never be hardcoded inside a closure
const STATE_VARS = ["highlight", "displayMode"];

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
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track brace depth (approximate: count { and } outside strings)
      // Only flag declarations at depth > 0 (inside a function/closure).
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;

      if (braceDepth > 0 && !trimmed.startsWith("//")) {
        for (const varName of STATE_VARS) {
          // Match: let highlight = "..." or let displayMode = "..."
          const re = new RegExp(`\\blet\\s+${varName}\\s*=\\s*"`);
          if (re.test(line)) {
            // Exemption marker on the same line or the line above
            const allowed =
              line.includes("ui-state-init-allow") ||
              (i > 0 && lines[i - 1].includes("ui-state-init-allow"));
            if (!allowed) {
              console.warn(
                `⚠️  ${path.relative(ROOT, file)}:${i + 1}: hardcoded initial state ` +
                `\`let ${varName} = \"...\"\` inside a closure — derive it from ` +
                `pageTranslator.getState() / resolveInitialUiState() instead ` +
                `(SPA rebuild state-loss bug, PR #23).`
              );
              violations++;
            }
          }
        }
      }

      braceDepth += opens - closes;
      if (braceDepth < 0) braceDepth = 0;
    }
  }

  if (violations > 0) {
    console.log(`\n${violations} UI state initialization violation(s) found.`);
    console.log("UI state must be derived from engine state, never hardcoded in a closure.");
    console.log("See CLAUDE.md 'SPA 导航重建状态规则' and tests/CLAUDE.md '事件缺失场景测试'.");
    process.exit(1);
  } else {
    console.log(`✅ No hardcoded UI state initialization found (${files.length} files scanned).`);
    process.exit(0);
  }
}

main();
