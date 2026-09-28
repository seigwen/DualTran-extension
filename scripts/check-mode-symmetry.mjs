#!/usr/bin/env node
/**
 * check-mode-symmetry.mjs
 *
 * CI lint：翻译 E2E 场景文件必须覆盖 newLine 与 replaceOriginal 两种模式，
 * 且判定必须是**行为级**（去注释 + 需真实遍历），而非文本存在性。
 *
 * ── 为什么从「文本存在性」改为「行为级」（#98 复发复盘）──
 *
 * 旧实现用 `content.includes("newLine")` 判定——**注释里出现模式词即算通过**。
 * 实测（去注释后）：`translation.mjs` 与 `dynamic-content-showmore.mjs` 代码中
 * 两个模式词零出现，lint 仍全绿——这个假绿让 #98 的 replaceOriginal 半边长期
 * 零门禁：修复只覆盖 newLine，而没有任何检查发现。
 *
 * ── 现行规则（硬失败，作用于 E2E 翻译场景清单）──
 *
 *   R1  先去注释（块 + 行）再做模式词检测——注释不提供覆盖证据。
 *   R2  通过需满足其一：
 *         a) 代码含行为级遍历 `forEachDisplayMode(` / `DISPLAY_MODES`（推荐，SSOT 单一来源）；或
 *         b) 代码含两个模式词 **且** 含真实循环（for / forEach），即场景自建的模式矩阵。
 *   R3  单边（只 newLine 或只 replaceOriginal）或零证据 → 失败，除非：
 *   R4  豁免标记 `// mode-symmetry-allow: <理由 ≥3 字符>`（同行或上一行）。
 *       用于「与另一单模式场景成对」「模式非该场景维度」等情形，理由必须书面化。
 *   R5  颜色维度（issue #21）：涉及译文颜色的断言必须双模式覆盖或行为级遍历。
 *
 * contentScript 单测文件只做颜色维度检查（issue #21 的原始作用域）——模式
 * 对称是场景/套件层的契约，jsdom 单测通过配置桩引用单个模式词不构成不对称。
 *
 * 自测：tests/scripts/checkModeSymmetry.test.js（本 lint 此前 0 自测）。
 *
 * Usage:
 *   node scripts/check-mode-symmetry.mjs
 *   node scripts/check-mode-symmetry.mjs --dir <fixture>   (self-test)
 * Exit codes: 0 = pass, 1 = violation (hard failure in CI)
 */

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const argDir = process.argv.indexOf("--dir");
const SCAN_ROOT = argDir !== -1 ? process.argv[argDir + 1] : join(__dirname, "..");
const E2E_DIR = join(SCAN_ROOT, "tests", "browser-e2e");
const CONTENT_SCRIPT_DIR = join(SCAN_ROOT, "tests", "contentScript");

// 翻译场景文件（需要模式对称的文件）
const TRANSLATION_SCENARIOS = [
  "translation.mjs",
  "translation-replace-original.mjs",
  "observer-feedback-loop.mjs",
  "content-update-conformance.mjs",
  "dynamic-content-ai-translation.mjs",
  // selected-panel.mjs：划词面板为自有布局（原文块 + 译文块，不替换页面文本），
  // 与 whereToDisplayTranslatedText 双模式语义无关——文件头带 mode-symmetry-allow 豁免。
  "selected-panel.mjs",
];

// 跳过检查的文件（不是翻译行为测试，不需要模式对称）
const SKIP_FILES = new Set([
  "setup.mjs",
  "run-all.mjs",
  "browser-e2e-config.mjs",
]);

// 颜色断言正则：style.color / getComputedStyle(...).color
const COLOR_ASSERT_RE = /style\.color|getComputedStyle\([^)]*\)\.color/;

// 译文颜色规则适用的内容脚本测试文件（涉及译文颜色的翻译行为测试）。
const TRANSLATION_COLOR_FILES = new Set([
  "pageTranslator.integration.test.js",
]);

const EXEMPT_MARKER_RE = /mode-symmetry-allow:\s*(.*)$/;
const MIN_REASON_LEN = 3;

/**
 * 去除块注释与行注释（保留 URL 中的 `://`）。
 * 注释不提供覆盖证据——本 lint 硬化的核心。
 */
function decomment(source) {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      if (idx > 0 && line[idx - 1] === ":") return line; // URL, not a comment
      return line.slice(0, idx);
    })
    .join("\n");
}

let violations = 0;
const messages = [];

/**
 * 豁免标记检测：同行或上一行，理由 ≥3 字符。
 * @returns {{ exempt: boolean }}
 */
function findExemption(content, label) {
  const lines = content.split("\n");
  let exempt = false;
  for (const line of lines) {
    const m = line.match(EXEMPT_MARKER_RE);
    if (!m) continue;
    const reason = (m[1] || "").trim();
    if (reason.length >= MIN_REASON_LEN) {
      exempt = true;
    } else {
      messages.push(
        `⚠️  ${label}: mode-symmetry-allow 理由过短（需 ≥${MIN_REASON_LEN} 字符）：${line.trim()}`
      );
      violations++;
    }
  }
  return { exempt };
}

/** 真实循环（for / forEach）——场景自建模式矩阵的证据。 */
const LOOP_RE = /\bfor\s*\(|\.forEach\s*\(|\.map\s*\(/;

/**
 * E2E 翻译场景检查。
 */
function checkScenarioFile(filePath, label) {
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    return; // 文件不存在，跳过
  }
  const code = decomment(content);
  const { exempt } = findExemption(content, label);
  if (exempt) return;

  const hasNewLine = code.includes("newLine");
  const hasReplaceOriginal = code.includes("replaceOriginal");
  const hasBehavioralIteration =
    code.includes("forEachDisplayMode(") || code.includes("DISPLAY_MODES");

  if (!hasBehavioralIteration) {
    if (hasNewLine && hasReplaceOriginal) {
      // 两个模式词都在代码里——还必须有真实循环（否则是零散的字符串引用）
      if (!LOOP_RE.test(code)) {
        messages.push(
          `⚠️  ${label}: 两个模式词均出现但无真实遍历（for/forEach）——模式覆盖不是行为级，改为 forEachDisplayMode/DISPLAY_MODES 或加豁免标记`
        );
        violations++;
      }
    } else if (hasNewLine || hasReplaceOriginal) {
      const which = hasNewLine ? "newLine" : "replaceOriginal";
      const other = hasNewLine ? "replaceOriginal" : "newLine";
      messages.push(
        `⚠️  ${label}: 代码引用 "${which}" 但无 "${other}"，且无行为级模式遍历（forEachDisplayMode/DISPLAY_MODES）— mode asymmetric`
      );
      violations++;
    } else {
      messages.push(
        `⚠️  ${label}: 代码中无任何模式证据（去注释后两模式词均不出现，也无行为级遍历）` +
          ` — 若该场景确实与显示模式无关，请加 // mode-symmetry-allow: <理由>`
      );
      violations++;
    }
  }

  // R5: 颜色维度（issue #21）——译文颜色断言必须双模式覆盖
  if (COLOR_ASSERT_RE.test(code)) {
    if (!(hasNewLine && hasReplaceOriginal) && !hasBehavioralIteration) {
      messages.push(
        `⚠️  ${label}: 含颜色断言（style.color / getComputedStyle）但未双模式覆盖 — color matrix asymmetric`
      );
      violations++;
    }
  }
}

/**
 * contentScript 单测文件检查（只做颜色维度——issue #21 原始作用域）。
 */
function checkContentScriptFile(filePath, label) {
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    return;
  }
  if (!TRANSLATION_COLOR_FILES.has(label)) return;

  const code = decomment(content);
  const { exempt } = findExemption(content, label);
  if (exempt) return;

  if (COLOR_ASSERT_RE.test(code)) {
    const hasNewLine = code.includes("newLine");
    const hasReplaceOriginal = code.includes("replaceOriginal");
    const hasBehavioralIteration =
      code.includes("forEachDisplayMode(") || code.includes("DISPLAY_MODES");
    if (!(hasNewLine && hasReplaceOriginal) && !hasBehavioralIteration) {
      messages.push(
        `⚠️  ${label}: 含颜色断言（style.color / getComputedStyle）但未双模式覆盖 — color matrix asymmetric`
      );
      violations++;
    }
  }
}

for (const file of TRANSLATION_SCENARIOS) {
  if (SKIP_FILES.has(file)) continue;
  checkScenarioFile(join(E2E_DIR, file), file);
}

let contentScriptFiles = [];
try {
  contentScriptFiles = readdirSync(CONTENT_SCRIPT_DIR).filter((f) =>
    /\.(test|integration\.test)\.js$/.test(f)
  );
} catch (e) {
  // fixture 目录（自测）可能没有 contentScript 子目录
}
for (const file of contentScriptFiles) {
  checkContentScriptFile(join(CONTENT_SCRIPT_DIR, file), file);
}

for (const m of messages) console.warn(m);

if (violations > 0) {
  console.log(`\n${violations} mode-symmetry violation(s) found.`);
  console.log("Translation E2E scenarios must iterate BOTH modes behaviorally (forEachDisplayMode/DISPLAY_MODES),");
  console.log("or declare a written exemption (// mode-symmetry-allow: <reason>).");
  console.log("See tests/CLAUDE.md '模式对称性规则' and issue #98 (recurrence review).");
  process.exit(1);
} else {
  console.log("✅ All translation E2E scenarios carry behavioral mode coverage (or a written exemption).");
  process.exit(0);
}
