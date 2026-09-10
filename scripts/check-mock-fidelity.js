#!/usr/bin/env node
/**
 * check-mock-fidelity.js
 *
 * CI lint (M2, issue #32): E2E mock page fidelity audit.
 *
 * Rule: every mock page in extra/e2e/ that simulates framework navigation
 * behavior (pushState / popstate / replaceWith / body.innerHTML assignment
 * inside a script) MUST carry a MOCK FIDELITY declaration:
 *
 *   <!-- MOCK FIDELITY: 模拟了 X（来源：实测/文档）；未模拟 Y（风险：Z） -->
 *
 * Why: bug 7 (PR #30) — the spa mock pages simulated Turbo navigation with
 * document.body.innerHTML = ... (body element survives), while real Turbo
 * Drive replaces the <body> ELEMENT itself. The E2E suite was green while
 * the real site reproduced the bug. Mock fidelity is a quality attribute
 * of the test system itself and must be audited like code quality.
 *
 * Detection: a page is a "mock page" if any <script> block contains
 * navigation-simulation patterns (pushState / popstate / replaceWith /
 * body.innerHTML assignment). Static pages (no such patterns) are exempt.
 *
 * Declaration requirements (hard failure when missing):
 *  - contains "MOCK FIDELITY"
 *  - contains "模拟了" (what is simulated)
 *  - contains "未模拟" (what is NOT simulated — prevents empty declarations)
 *
 * Usage:
 *   node scripts/check-mock-fidelity.js
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// --dir <path> overrides the scan root (used by the self-test to run
// against isolated fixture directories).
const argDir = process.argv.indexOf("--dir");
const E2E_DIR = argDir !== -1 ? path.resolve(process.argv[argDir + 1]) : path.join(ROOT, "extra", "e2e");

// Navigation-simulation patterns inside <script> blocks
const NAV_PATTERNS = [
  /pushState\s*\(/,
  /popstate/,
  /replaceWith\s*\(/,
  /body\s*\.\s*innerHTML\s*=/,
];

function isMockPage(content) {
  // Only look inside <script> blocks
  const scripts = content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scripts) {
    for (const pattern of NAV_PATTERNS) {
      if (pattern.test(script)) return true;
    }
  }
  return false;
}

function main() {
  if (!fs.existsSync(E2E_DIR)) {
    console.log(`✅ No e2e mock pages directory found (${E2E_DIR}).`);
    process.exit(0);
  }

  const files = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith(".html"));
  let violations = 0;
  let mockPages = 0;

  for (const file of files) {
    const full = path.join(E2E_DIR, file);
    const content = fs.readFileSync(full, "utf8");
    if (!isMockPage(content)) continue;
    mockPages++;

    const hasDeclaration = content.includes("MOCK FIDELITY");
    const hasSimulated = content.includes("模拟了");
    const hasNotSimulated = content.includes("未模拟");

    if (!hasDeclaration || !hasSimulated || !hasNotSimulated) {
      console.warn(
        `⚠️  extra/e2e/${file}: mock page (navigation simulation detected) ` +
          `missing a complete MOCK FIDELITY declaration. ` +
          `Add: <!-- MOCK FIDELITY: 模拟了 X（来源：实测/文档）；未模拟 Y（风险：Z） --> ` +
          `(must contain "模拟了" and "未模拟").`
      );
      violations++;
    }
  }

  if (violations > 0) {
    console.log(`\n${violations} mock fidelity violation(s) found (${mockPages} mock pages scanned).`);
    console.log("Mock pages must declare what they simulate and what they do NOT simulate.");
    console.log("See issue #32 and tests/CLAUDE.md '模拟页 vs 真实框架对照表'.");
    process.exit(1);
  } else {
    console.log(`✅ All ${mockPages} mock page(s) carry MOCK FIDELITY declarations.`);
    process.exit(0);
  }
}

main();
