/**
 * DualTran E2E: 动态内容 — show-more 懒加载翻译
 *
 * 验证 MutationObserver 正确处理 inline 元素（span）的懒加载：
 * 1. 翻译页面
 * 2. 点击 show-more（JS 懒加载 <span> 到 DOM）
 * 3. 断言隐藏内容被自动翻译
 * 4. 断言无重复译文
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

export async function run(scope) {
  const { context, page, serviceWorker, testPageUrl } = scope;

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

  // Step 3: 验证隐藏内容尚未被翻译
  const hiddenBefore = await page.evaluate(() => {
    const hidden = document.getElementById("showmore-hidden");
    return {
      exists: !!hidden,
      hasTranslated: hidden?.querySelector("translated") !== null,
    };
  });
  if (hiddenBefore.exists && hiddenBefore.hasTranslated) {
    throw new Error("[showmore] Hidden content should NOT be translated before show-more click");
  }
  console.log("[showmore] Step 3: Hidden content confirmed NOT translated yet.");

  // Step 4: 点击 show-more（懒加载 <span> 到 DOM）
  console.log("[showmore] Step 4: Clicking show-more...");
  await page.click("#showmore-btn");
  await page.waitForTimeout(500);

  // Step 5: 等待动态翻译（最多 10 秒）
  console.log("[showmore] Step 5: Waiting for dynamic translation...");
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
      console.log(`[showmore] Step 5: Dynamic translation appeared after ${(i + 1) * 500}ms`);
      translated = true;
      break;
    }
  }

  if (!translated) {
    throw new Error("[showmore] BUG: Hidden content NOT translated after show-more reveal (10s timeout)");
  }

  // Step 6: 最终负面断言 — 无重复译文
  await assertNoDuplicateTranslations(page);
  console.log("[showmore] Step 6: No duplicate translations after dynamic translation.");

}
