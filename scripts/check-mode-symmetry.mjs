#!/usr/bin/env node
/**
 * check-mode-symmetry.mjs
 *
 * CI lint 检查：翻译 E2E 场景文件是否同时覆盖 newLine 和 replaceOriginal 模式。
 * 如果一个翻译场景文件中出现 "newLine" 但不出现 "replaceOriginal"（或反之），发出警告。
 *
 * 参见 issue #17: 测试体系系统性改进 — 模式对称性规则。
 * 参见 issue #21: 测试体系系统性改进 — 颜色维度矩阵（P1-1）。
 *
 * 颜色维度检查（issue #21）：
 *   样式/颜色相关测试（含 style.color / getComputedStyle 断言）必须同时覆盖
 *   newLine 和 replaceOriginal 两种模式。若颜色断言只出现在一种模式，发出警告。
 *
 * Usage: node scripts/check-mode-symmetry.mjs
 * Exit codes: 0 = pass, 1 = warning (non-blocking in CI)
 */

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = join(__dirname, "..", "tests", "browser-e2e");
const CONTENT_SCRIPT_DIR = join(__dirname, "..", "tests", "contentScript");

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

// 内容脚本测试中非翻译行为测试（UI 组件/过滤/导航），不需要模式对称
const SKIP_CONTENT_SCRIPT_FILES = new Set([
  "floatingBtn.behavior.test.js", // 三态按钮 UI 测试（模式无关）
  "mutationObserver.translatedFilter.test.js", // observer 过滤（模式无关）
  "pageTranslator.navRestore.integration.test.js", // 导航恢复（模式无关）
]);

// 颜色断言正则：style.color / getComputedStyle(...).color
const COLOR_ASSERT_RE = /style\.color|getComputedStyle\([^)]*\)\.color/;

// 译文颜色规则适用的测试文件（涉及译文颜色的翻译行为测试）。
// UI 组件测试（aiUiState/blockTranslationIndicator/translateSelected/floatingBtn）
// 的颜色断言是组件自身颜色（按钮/指示器），与译文颜色规则无关，不检查。
// AI 流程测试（pageTranslator.test.js）的颜色断言是附带断言（mock button），
// 真正的译文颜色规则测试在 pageTranslator.integration.test.js（双模式覆盖）。
const TRANSLATION_COLOR_FILES = new Set([
  "pageTranslator.integration.test.js",
  "translation.mjs",
  "translation-replace-original.mjs",
  "dynamic-content-ai-translation.mjs",
  "dynamic-content-showmore.mjs",
  "observer-feedback-loop.mjs",
]);

let warnings = 0;

function checkFile(filePath, label, checkColor) {
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    return; // 文件不存在，跳过
  }

  const hasNewLine = content.includes("newLine");
  const hasReplaceOriginal = content.includes("replaceOriginal");

  if (hasNewLine && !hasReplaceOriginal) {
    console.warn(`⚠️  ${label}: references "newLine" but NOT "replaceOriginal" — mode asymmetric`);
    warnings++;
  } else if (!hasNewLine && hasReplaceOriginal) {
    console.warn(`⚠️  ${label}: references "replaceOriginal" but NOT "newLine" — mode asymmetric`);
    warnings++;
  }

  // 颜色维度检查（issue #21 P1-1）：译文颜色断言必须同时覆盖两种模式
  if (checkColor && COLOR_ASSERT_RE.test(content)) {
    if (!hasNewLine || !hasReplaceOriginal) {
      console.warn(
        `⚠️  ${label}: contains color assertions (style.color / getComputedStyle) ` +
        `but does NOT cover both newLine and replaceOriginal — color matrix asymmetric`
      );
      warnings++;
    }
  }
}

for (const file of TRANSLATION_SCENARIOS) {
  checkFile(join(E2E_DIR, file), file, true);
}

// 内容脚本测试文件（jsdom 层颜色断言）
const contentScriptFiles = readdirSync(CONTENT_SCRIPT_DIR).filter((f) =>
  /\.(test|integration\.test)\.js$/.test(f)
);
for (const file of contentScriptFiles) {
  if (SKIP_CONTENT_SCRIPT_FILES.has(file)) continue;
  checkFile(
    join(CONTENT_SCRIPT_DIR, file),
    `contentScript/${file}`,
    TRANSLATION_COLOR_FILES.has(file)
  );
}

if (warnings > 0) {
  console.log(`\n${warnings} mode-symmetry warning(s) found.`);
  console.log("Translation E2E scenarios should cover both newLine and replaceOriginal modes.");
  console.log("Color assertions must cover both modes (issue #21, style assertion layering).");
  console.log("See tests/CLAUDE.md '模式对称性规则' and '样式断言分层' for details.");
  process.exit(1);
} else {
  console.log("✅ All translation E2E scenarios cover both modes (incl. color assertions).");
  process.exit(0);
}
