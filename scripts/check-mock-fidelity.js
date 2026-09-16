#!/usr/bin/env node
/**
 * check-mock-fidelity.js
 *
 * CI lint (M2 → S3, issues #32 / #51): E2E mock page fidelity audit.
 *
 * S3 upgrade: the MOCK FIDELITY declaration is a FORCED BRANCH ENUMERATION.
 * Framework behaviour is a branch tree, not a single path. The declaration
 * must enumerate branches per dimension, each branch either simulated or
 * explicitly exempted WITH an upstream-impact assessment. The upstream
 * control-flow check is what M2 lacked: "snapshot rendering not simulated"
 * was marked low-risk while it was in fact the upstream control flow of the
 * simulated fetch behaviour (the cache strategy decides which branch runs).
 *
 * Declaration syntax (multi-line block comment, line-level grammar):
 *
 *   <!-- MOCK FIDELITY
 *     分支：恢复路径
 *     - fetch 新文档（no-cache）：✅ 已模拟
 *     - bfcache（persisted）：⛔ 未模拟（豁免理由：Turbo 不用 bfcache；上游影响：无）
 *     分支：缓存策略
 *     - ...
 *   -->
 *
 * Enforced rules (hard failure):
 *   R1  declaration must contain >= 1 「分支：」 section header
 *   R2  every item line (trimmed, starts with "- ") must carry
 *       「✅ 已模拟」 or 「⛔ 未模拟」
 *   R3  every 「⛔ 未模拟」 item must carry BOTH 「豁免理由」and「上游影响」
 *       on the same line
 *   R4  items before any 「分支：」 header are orphan violations
 *   R5  the whole declaration must contain >= 1 「⛔ 未模拟」 item
 *       (no all-✅ whitewashing — enumerating everything as simulated
 *        means the audit did not happen)
 *   R6  every 「分支：」 section must contain >= 1 item (no empty sections)
 *
 * The old string checks (「模拟了」/「未模拟」) are REMOVED — the new
 * 「✅ 已模拟」 token is a different string; keeping both would be
 * double bookkeeping. Old single-line declarations are a hard failure:
 * both mock pages upgrade to the new format in the same PR (no transition
 * period, Q5 decision).
 *
 * Detection: a page is a "mock page" if any <script> block contains
 * navigation-simulation patterns (pushState / popstate / replaceWith /
 * body.innerHTML assignment). Static pages are exempt.
 *
 * Usage:
 *   node scripts/check-mock-fidelity.js [--dir <path>]
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

const MARK_SIMULATED = "✅ 已模拟";
const MARK_NOT_SIMULATED = "⛔ 未模拟";
const SECTION_HEADER = "分支：";

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

/**
 * Extract the MOCK FIDELITY declaration block (non-greedy up to the first
 * closing `-->`). Returns null when absent.
 */
function extractDeclaration(content) {
  const m = content.match(/<!--\s*MOCK FIDELITY([\s\S]*?)-->/);
  return m ? m[0] : null;
}

/**
 * Line-level validation of one declaration block.
 * Returns an array of violation messages (empty = pass).
 */
function validateDeclaration(declaration) {
  const violations = [];
  const lines = declaration.split("\n").map((l) => l.trim());

  let sectionCount = 0;
  let currentSection = null; // { name, itemCount }
  let totalNotSimulated = 0;
  let orphanItem = false;

  const closeSection = () => {
    if (currentSection && currentSection.itemCount === 0) {
      violations.push(`分支「${currentSection.name}」下无条目（空章节，R6）`);
    }
    currentSection = null;
  };

  for (const line of lines) {
    if (line.includes(SECTION_HEADER)) {
      closeSection();
      sectionCount++;
      currentSection = { name: line.replace(/^分支：/, "").trim(), itemCount: 0 };
      continue;
    }

    if (!line.startsWith("- ")) continue; // headers / prose lines ignored

    const isNotSimulated = line.includes(MARK_NOT_SIMULATED);
    const isSimulated = line.includes(MARK_SIMULATED);

    if (!isNotSimulated && !isSimulated) {
      violations.push(`条目缺标记（需「${MARK_SIMULATED}」或「${MARK_NOT_SIMULATED}」）：${line}（R2）`);
      continue;
    }

    if (isNotSimulated) {
      totalNotSimulated++;
      if (!line.includes("豁免理由") || !line.includes("上游影响")) {
        violations.push(`「${MARK_NOT_SIMULATED}」条目缺「豁免理由」或「上游影响」（R3）：${line}`);
      }
    }

    if (currentSection) {
      currentSection.itemCount++;
    } else {
      orphanItem = true;
      violations.push(`条目出现在任何「${SECTION_HEADER}」之前（孤儿条目，R4）：${line}`);
    }
  }

  closeSection();

  if (sectionCount === 0) {
    violations.push(`声明缺「${SECTION_HEADER}」章节（R1）——旧格式声明不受支持，请按分支枚举格式重写`);
  }
  if (orphanItem) {
    // already reported per item; nothing extra
  }
  if (totalNotSimulated === 0) {
    violations.push(`声明无任何「${MARK_NOT_SIMULATED}」条目（R5）—— 全 ✅ 声明视为审计未开展`);
  }

  return violations;
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

    const declaration = extractDeclaration(content);
    if (!declaration) {
      console.warn(
        `⚠️  ${path.relative(ROOT, full)}: mock page (navigation simulation detected) ` +
          `missing a MOCK FIDELITY declaration. Add a branch-enumeration block (see tests/CLAUDE.md).`
      );
      violations++;
      continue;
    }

    const errs = validateDeclaration(declaration);
    for (const err of errs) {
      console.warn(`⚠️  ${path.relative(ROOT, full)}: ${err}`);
    }
    violations += errs.length;
  }

  if (violations > 0) {
    console.log(`\n${violations} mock fidelity violation(s) found (${mockPages} mock pages scanned).`);
    console.log("Mock pages must enumerate framework branches with upstream-impact assessments.");
    console.log("See issue #51 and tests/CLAUDE.md '模拟页分支矩阵' authoring rules.");
    process.exit(1);
  } else {
    console.log(`✅ All ${mockPages} mock page(s) carry valid branch-enumeration declarations.`);
    process.exit(0);
  }
}

main();
