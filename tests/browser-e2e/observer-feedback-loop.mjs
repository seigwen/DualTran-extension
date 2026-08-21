/**
 * DualTran E2E: Observer Feedback Loop Detector
 *
 * 系统性覆盖 MutationObserver 与翻译引擎交互的所有配置组合，
 * 确保不会产生正反馈循环（重复翻译元素）。
 *
 * 测试矩阵：
 *   {newLine, replaceOriginal} × {showOriginal=yes, no} = 4 组合
 *   每个组合：Google 翻译 → 5s soak → 断言元素数量不变
 *
 * 这是 issue #17 的核心防护措施：不再是"每个 bug 加一个回归测试"，
 * 而是对整个风险区域做系统性覆盖。
 *
 * @module observer-feedback-loop
 */

import {
  setupFull,
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  writeStorage,
  assertNoDuplicateTranslations,
  assertReplaceOriginalNoDuplicates,
} from "./setup.mjs";

export const name = "observer-feedback-loop";

/** 不需要 Mock LLM 服务器（只测 Google 翻译） */
export const needsMock = false;

/** 不纳入 smoke 子集 */
export const smoke = false;

// ─── 矩阵配置 ────────────────────────────────────────────────

const MATRIX = [
  { mode: "newLine",          showOriginal: "no",  label: "newLine + showOriginal=off" },
  { mode: "newLine",          showOriginal: "yes", label: "newLine + showOriginal=on"  },
  { mode: "replaceOriginal",  showOriginal: "no",  label: "replaceOriginal + showOriginal=off" },
  { mode: "replaceOriginal",  showOriginal: "yes", label: "replaceOriginal + showOriginal=on"  },
];

/** Soak 时间（毫秒） */
const SOAK_MS = 5000;

// ─── 辅助函数 ────────────────────────────────────────────────

/**
 * 计数当前页面中的翻译元素数量。
 * 根据模式选择不同的选择器。
 */
async function countTranslationElements(page, mode) {
  return page.evaluate((m) => {
    if (m === "replaceOriginal") {
      return document.querySelectorAll(".dualtran-aitranslatedtext-replacemode").length;
    }
    return document.querySelectorAll("translated").length;
  }, mode);
}

/**
 * 断言无重复翻译元素（模式感知）。
 */
async function assertNoDuplicates(page, mode) {
  if (mode === "replaceOriginal") {
    return assertReplaceOriginalNoDuplicates(page);
  }
  return assertNoDuplicateTranslations(page);
}

// ─── E2E 测试入口 ────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker, testPageUrl } = scope;
  const errors = [];

  for (const { mode, showOriginal, label } of MATRIX) {
    console.log(`\n[observer-loop] ═══ Testing: ${label} ═══`);

    try {
      // 配置
      await writeStorage(serviceWorker, "whereToDisplayTranslatedText", mode);
      await writeStorage(serviceWorker, "showOriginalTextWhenHovering", showOriginal);
      await writeStorage(serviceWorker, "targetLanguage", "fr");
      await writeStorage(serviceWorker, "translateDynamicallyCreatedContent", "yes");

      // 导航到测试页面（每个组合重新导航避免状态污染）
      await page.goto("about:blank");
      await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
      await waitForContentScriptInjected(serviceWorker, page.url());
      await waitForPageTranslatorReady(serviceWorker, page.url());

      // Google 翻译
      await sendMessageToTab(serviceWorker, page.url(), {
        action: "translatePage",
        targetLanguage: "fr",
      });

      // 等待翻译完成
      if (mode === "replaceOriginal") {
        await page.waitForFunction(() => {
          return document.querySelectorAll(".dualtran-result-container").length > 0;
        }, null, { timeout: 30000 });
      } else {
        await page.waitForFunction(() => {
          return document.querySelectorAll("translated").length > 0;
        }, null, { timeout: 30000 });
      }
      await page.waitForTimeout(1000);

      // 断言无重复（翻译刚完成时）
      await assertNoDuplicates(page, mode);
      const countBefore = await countTranslationElements(page, mode);
      console.log(`[observer-loop] ${label}: ${countBefore} elements, no duplicates ✓`);

      // Soak 测试
      console.log(`[observer-loop] ${label}: Soaking ${SOAK_MS}ms...`);
      await page.waitForTimeout(SOAK_MS);

      const countAfter = await countTranslationElements(page, mode);
      if (countAfter !== countBefore) {
        const msg = `[observer-loop] ${label}: FEEDBACK LOOP! Elements changed from ${countBefore} to ${countAfter} after ${SOAK_MS}ms soak`;
        console.error(msg);
        errors.push(msg);
      } else {
        console.log(`[observer-loop] ${label}: Soak passed — ${countAfter} elements stable ✓`);
      }

      // 再次断言无重复（belt-and-suspenders）
      await assertNoDuplicates(page, mode);

    } catch (e) {
      const msg = `[observer-loop] ${label}: ERROR — ${e.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  if (errors.length > 0) {
    throw new Error(`[observer-loop] ${errors.length} failure(s):\n${errors.join("\n")}`);
  }

  console.log("\n[observer-loop] All 4 matrix combinations passed ✓");
}
