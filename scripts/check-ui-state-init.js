#!/usr/bin/env node
/**
 * check-ui-state-init.js
 *
 * CI lint (D1 → S3b): UI state initialization & assignment audit.
 *
 * Two rules:
 *
 *  R1 (initialization) — UI components must NOT hardcode initial
 *  highlight/displayMode inside a closure (detected: `let highlight = "…"`,
 *  `let displayMode = "…"` at brace depth > 0). Initial state must come
 *  from the engine (pageTranslator.getState() / resolveInitialUiState /
 *  uiStateStore.resetForRebuild). SPA rebuild state-loss bug (PR #23).
 *
 *  R2 (assignment) — after the M3 SSOT migration, UI components must NOT
 *  bare-assign state variables (highlight/displayMode/intervention/
 *  googleInFlight/aiInFlight); all mutations go through
 *  uiStateStore.setState(). Detected: `highlight = …`, `displayMode = …`
 *  etc. as a bare identifier on the LHS (not a property access like
 *  s.highlight, not a DOM style assignment, not a comparison).
 *
 * Exemptions:
 *  - uiStateStore.js itself — the single source of truth owns the state
 *    and is the ONLY file allowed to assign these variables.
 *  - Lines marked with `// ui-state-init-allow` (documented exceptions,
 *    checked on the same line or the line above).
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

// State variables that must never be hardcoded in a closure or
// bare-assigned outside uiStateStore.js
const STATE_VARS = ["highlight", "displayMode", "intervention", "googleInFlight", "aiInFlight"];

// The single source of truth — the only file allowed to assign these.
const STORE_FILE = "uiStateStore.js";

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
    const isStore = path.basename(file) === STORE_FILE;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track brace depth (approximate: count { and } outside strings)
      // Only flag declarations at depth > 0 (inside a function/closure).
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;

      const allowed =
        line.includes("ui-state-init-allow") ||
        (i > 0 && lines[i - 1].includes("ui-state-init-allow"));

      if (braceDepth > 0 && !trimmed.startsWith("//") && !allowed) {
        // Strip string literals so `"highlight ="` inside console.log etc.
        // does not trigger the assignment rule.
        const stripped = line.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
        for (const varName of STATE_VARS) {
          // R1: let highlight = "…" / let displayMode = "…" inside a closure
          const reInit = new RegExp(`\\blet\\s+${varName}\\s*=\\s*"`);
          if (reInit.test(line)) {
            console.warn(
              `⚠️  ${rel}:${i + 1}: hardcoded initial state ` +
              `\`let ${varName} = "…"\` inside a closure — derive it from ` +
              `pageTranslator.getState() / resolveInitialUiState() / ` +
              `uiStateStore.resetForRebuild() instead ` +
              `(SPA rebuild state-loss bug, PR #23).`
            );
            violations++;
          }

          // R2: bare assignment `highlight = …` (LHS is exactly the var
          // name — not `s.highlight`, not `===`/`!==`, not a declaration,
          // not inside a string literal).
          // Skipped in uiStateStore.js (the single owner).
          if (!isStore) {
            const reAssign = new RegExp(`(^|[^.\\w])(${varName})\\s*=(?!=)`);
            // Exclude declarations (`const x =`, `let x =`, `var x =`) —
            // those are reads from another source, not bare writes.
            const isDeclaration = /^\s*(const|let|var)\s/.test(stripped);
            const m = stripped.match(reAssign);
            if (m && !isDeclaration && !/\.\w*\s*$/.test(stripped.slice(0, m.index + m[1].length))) {
              console.warn(
                `⚠️  ${rel}:${i + 1}: bare assignment \`${varName} = …\` — ` +
                `UI state must be mutated via uiStateStore.setState() ` +
                `(SSOT, M3).`
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
    console.log(`\n${violations} UI state initialization/assignment violation(s) found.`);
    console.log("UI state must be owned by uiStateStore and derived from engine state.");
    console.log("See CLAUDE.md 'UI 状态架构原则' and tests/CLAUDE.md '事件缺失场景测试'.");
    process.exit(1);
  } else {
    console.log(`✅ No hardcoded UI state init or bare assignments found (${files.length} files scanned).`);
    process.exit(0);
  }
}

main();
