#!/usr/bin/env node
/**
 * check-mode-symmetry.mjs
 *
 * CI lint 检查：翻译 E2E 场景文件是否同时覆盖 newLine 和 replaceOriginal 模式。
 * 如果一个翻译场景文件中出现 "newLine" 但不出现 "replaceOriginal"（或反之），发出警告。
 *
 * 参见 issue #17: 测试体系系统性改进 — 模式对称性规则。
 *
 * Usage: node scripts/check-mode-symmetry.mjs
 * Exit codes: 0 = pass, 1 = warning (non-blocking in CI)
 */

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = join(__dirname, "..", "tests", "browser-e2e");

// 翻译场景文件（需要模式对称的文件）
const TRANSLATION_SCENARIOS = [
  "translation.mjs",
  "translation-replace-original.mjs",
  "observer-feedback-loop.mjs",
  "dynamic-content-showmore.mjs",
  "dynamic-content-ai-translation.mjs",
];

// 跳过检查的文件（不是翻译行为测试，不需要模式对称）
const SKIP_FILES = new Set([
  "setup.mjs",
  "run-all.mjs",
  "browser-e2e-config.mjs",
]);

let warnings = 0;

for (const file of TRANSLATION_SCENARIOS) {
  const filePath = join(E2E_DIR, file);
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    // 文件不存在，跳过
    continue;
  }

  const hasNewLine = content.includes("newLine");
  const hasReplaceOriginal = content.includes("replaceOriginal");

  if (hasNewLine && !hasReplaceOriginal) {
    console.warn(`⚠️  ${file}: references "newLine" but NOT "replaceOriginal" — mode asymmetric`);
    warnings++;
  } else if (!hasNewLine && hasReplaceOriginal) {
    console.warn(`⚠️  ${file}: references "replaceOriginal" but NOT "newLine" — mode asymmetric`);
    warnings++;
  }
}

if (warnings > 0) {
  console.log(`\n${warnings} mode-symmetry warning(s) found.`);
  console.log("Translation E2E scenarios should cover both newLine and replaceOriginal modes.");
  console.log("See tests/CLAUDE.md '模式对称性规则' for details.");
  process.exit(1);
} else {
  console.log("✅ All translation E2E scenarios cover both modes.");
  process.exit(0);
}
