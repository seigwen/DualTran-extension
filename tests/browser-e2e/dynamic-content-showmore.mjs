/**
 * DualTran E2E: 动态内容 — show-more 懒加载翻译
 *
 * 验证 MutationObserver 正确处理三种「展开后新内容」形态：
 * 1. Scenario A (childList append): 点击后 JS 把新 <span> 追加进容器（PR #7 已覆盖）
 * 2. Scenario B (characterData in-place): 站点原地改写既有文本节点
 *    （React nodeValue 赋值 = characterData 突变）—— x.com legacy 客户端、
 *    各类 React 文本更新
 * 3. Scenario C (childList replace): 站点移除截断 span、插入含完整文本的新
 *    span —— x.com x-web 客户端实测行为
 *
 * 用户报告的 bug（x.com 点击 Show more 后展开文字不翻译）对应 B/C 两类。
 * 每个 scenario 断言：展开后的完整文本必须获得译文覆盖（按译文长度单调增长
 * 判定，值无关）；且全程无重复译文。
 *
 * 显示模式：本场景跑默认 newLine 模式（译文新行显示）。replaceOriginal
 * 模式的同族动态内容行为由 observer-feedback-loop.mjs 双模式矩阵与
 * translation-replace-original.mjs 覆盖。
 */

import {
  setupFull,
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  writeStorage,
  assertNoDuplicateTranslations,
  assertTranslationCount,
} from "./setup.mjs";

export const name = "dynamic-content-showmore";

/** 不需要 Mock LLM 服务器（只测 Google 翻译） */
export const needsMock = false;

/** 不纳入 smoke 子集 */
export const smoke = false;

// ─── 辅助函数 ────────────────────────────────────────────────

/**
 * 等待容器内译文的「最长 google span」长度超过基线。
 * 值无关判据：译文覆盖了展开文本 ⇒ 至少一个译文 span 显著变长。
 * @param {import("playwright").Page} page
 * @param {string} containerSelector
 * @param {number} baseMax - 展开前的最长译文长度
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, maxLen: number, texts: string[]}>}
 */
async function waitForTranslationGrowth(page, containerSelector, baseMax, timeoutMs = 20000) {
  const start = Date.now();
  let last = { ok: false, maxLen: 0, texts: [] };
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate((sel) => {
      const container = document.querySelector(sel);
      if (!container) return { ok: false, maxLen: 0, texts: [], gone: true };
      const spans = [...container.querySelectorAll(".dualtran-google")];
      const texts = spans.map((s) => s.textContent || "");
      return { ok: false, maxLen: Math.max(0, ...texts.map((t) => t.length)), texts };
    }, containerSelector);
    if (last.gone) return last;
    if (last.maxLen > baseMax) {
      return { ...last, ok: true };
    }
    await page.waitForTimeout(500);
  }
  return last;
}

/**
 * 读取容器内最长 google 译文长度基线。
 */
async function readTranslationBaseline(page, containerSelector) {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (!container) return { maxLen: 0, texts: [] };
    const spans = [...container.querySelectorAll(".dualtran-google")];
    const texts = spans.map((s) => s.textContent || "");
    return { maxLen: Math.max(0, ...texts.map((t) => t.length)), texts };
  }, containerSelector);
}

// ─── E2E 测试入口 ────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker, testPageUrl } = scope;

  // 配置
  await writeStorage(serviceWorker, "translateDynamicallyCreatedContent", "yes");
  await writeStorage(serviceWorker, "targetLanguage", "fr");

  // 导航 + 等待
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // Step 1: 翻译页面
  console.log("[showmore] Step 1: Translating page...");
  await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
  await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1000);

  // Step 2: 负面断言 — 翻译后无重复
  const countBefore = await assertNoDuplicateTranslations(page);
  await assertTranslationCount(page, 3);
  console.log(`[showmore] Step 2: ${countBefore} translated elements, no duplicates.`);

  // 收集各 scenario 失败，最后统一抛出（单次 RED 不掩盖其它 scenario 状态）
  const failures = [];

  // ═══════════════════════════════════════════════════════════════
  // Scenario A: childList append（PR #7 既有覆盖）
  // ═══════════════════════════════════════════════════════════════
  try {
    console.log("[showmore] Scenario A: childList append...");
    const hiddenBefore = await page.evaluate(() => {
      const hidden = document.getElementById("showmore-hidden");
      return {
        exists: !!hidden,
        hasTranslated: hidden?.querySelector("translated") !== null,
      };
    });
    if (hiddenBefore.exists && hiddenBefore.hasTranslated) {
      throw new Error("[showmore] A: Hidden content should NOT be translated before show-more click");
    }

    await page.click("#showmore-btn");
    await page.waitForTimeout(500);

    let translated = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const check = await page.evaluate(() => {
        const hidden = document.getElementById("showmore-hidden");
        if (!hidden) return false;
        const t = hidden.querySelector("translated");
        return t?.textContent?.length > 0;
      });
      if (check) {
        console.log(`[showmore] A: Dynamic translation appeared after ${(i + 1) * 500}ms`);
        translated = true;
        break;
      }
    }
    if (!translated) {
      throw new Error("[showmore] A: BUG: appended content NOT translated after show-more reveal (10s timeout)");
    }
    await assertNoDuplicateTranslations(page);
    console.log("[showmore] A: PASS ✓");
  } catch (e) {
    failures.push(e.message);
    console.error(`[FAIL] ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Scenario B: characterData in-place update（用户报告的场景 1）
  // ═══════════════════════════════════════════════════════════════
  try {
    console.log("[showmore] Scenario B: characterData in-place update...");
    const bBase = await readTranslationBaseline(page, "#showmore-inplace-container");
    console.log(`[showmore] B: baseline translation max length = ${bBase.maxLen}`);

    await page.click("#showmore-inplace-btn");
    await page.waitForTimeout(500);

    // 确认展开确实发生（源码文本变长）
    const bExpanded = await page.evaluate(() => {
      const el = document.getElementById("showmore-inplace-container");
      return el ? el.textContent.length : 0;
    });
    if (bExpanded < 150) {
      throw new Error(`[showmore] B: expansion did not happen (container length=${bExpanded})`);
    }

    const bGrow = await waitForTranslationGrowth(page, "#showmore-inplace-container", bBase.maxLen + 40, 20000);
    if (!bGrow.ok) {
      throw new Error(
        `[showmore] B: BUG: in-place (characterData) expanded text NOT translated — ` +
          `translation stayed at max ${bGrow.maxLen} chars (baseline ${bBase.maxLen}) while the ` +
          `source container grew to ${bExpanded} chars (20s timeout)`
      );
    }
    console.log(`[showmore] B: PASS ✓ (translation grew to ${bGrow.maxLen} chars)`);
    await assertNoDuplicateTranslations(page);
  } catch (e) {
    failures.push(e.message);
    console.error(`[FAIL] ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Scenario C: childList replace（用户报告的场景 2，x-web 客户端实测形态）
  // ═══════════════════════════════════════════════════════════════
  try {
    console.log("[showmore] Scenario C: childList replace...");
    const cBase = await readTranslationBaseline(page, "#showmore-replace-container");
    console.log(`[showmore] C: baseline translation max length = ${cBase.maxLen}`);

    await page.click("#showmore-replace-btn");
    await page.waitForTimeout(500);

    const cExpanded = await page.evaluate(() => {
      const el = document.getElementById("showmore-replace-container");
      return el ? el.textContent.length : 0;
    });
    if (cExpanded < 150) {
      throw new Error(`[showmore] C: expansion did not happen (container length=${cExpanded})`);
    }

    const cGrow = await waitForTranslationGrowth(page, "#showmore-replace-container", cBase.maxLen + 40, 20000);
    if (!cGrow.ok) {
      throw new Error(
        `[showmore] C: BUG: replaced (childList) expanded text NOT translated — ` +
          `translation stayed at max ${cGrow.maxLen} chars (baseline ${cBase.maxLen}) while the ` +
          `source container grew to ${cExpanded} chars (20s timeout)`
      );
    }
    console.log(`[showmore] C: PASS ✓ (translation grew to ${cGrow.maxLen} chars)`);
    await assertNoDuplicateTranslations(page);
  } catch (e) {
    failures.push(e.message);
    console.error(`[FAIL] ${e.message}`);
  }

  if (failures.length > 0) {
    throw new Error(`[showmore] ${failures.length} scenario failure(s):\n${failures.join("\n")}`);
  }

  console.log("[showmore] All scenarios passed ✓");
}
