/**
 * DualTran E2E — 三态悬浮按钮完整旅程（Original / Google / AI）
 *
 * 验证 Q28 行为表的核心场景：
 *   1. 初始状态：Original 高亮
 *   2. 点 Google → Google 高亮 + 页面翻译
 *   3. 点 AI → AI 高亮 + AI 翻译（Google 已翻译过，不重复调）
 *   4. AI 译文显示后点 Google → 本地切回 Google 译文（不发请求）
 *   5. 点 Original → 恢复原文 + Original 高亮
 *   6. 自动翻译（未介入）→ Google 高亮（内容驱动）
 *   7. 外部操作（右键菜单路径 → translate-page-ai）→ AI 高亮 + AI 译文落地（D1/D2）
 *
 * D6 回归格：replaceOriginal 次的步骤 2 同时充当 D6 格——步骤 7（或步骤 3）
 * 的成功已在 sessionStorage 武装 AI marker，下一次导航即在「已武装」页面
 * 上执行显式 Google 点击：显式意图必须压过武装的 AI 自动恢复（高亮 Google）。
 *
 * 模式对称性：newLine + replaceOriginal 各跑一遍（测试套件规则）。
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  assertUiStateMatchesEngine,
  dumpUiStateLog,
} from "./setup.mjs";

export const name = "floating-btn-three-state";
export const needsMock = true;
export const smoke = false;

async function getButtonState(page) {
  return page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    const root = host?.shadowRoot || null;
    const read = (id) => {
      const el = root?.getElementById(id) || null;
      if (!el) return { exists: false, highlighted: false };
      return {
        exists: true,
        highlighted: el.classList.contains("dualtran-floating-btn-active"),
        text: (el.textContent || "").trim(),
      };
    };
    return {
      original: read("btnOriginal"),
      google: read("btnGoogle"),
      ai: read("btnAi"),
    };
  });
}

function assertHighlighted(state, key, label) {
  if (!state[key].exists) throw new Error(`${label}: button missing`);
  if (!state[key].highlighted) {
    throw new Error(`${label}: expected ${key} highlighted, got ${JSON.stringify(state)}`);
  }
}

function assertNotHighlighted(state, key, label) {
  if (state[key].highlighted) {
    throw new Error(`${label}: expected ${key} NOT highlighted, got ${JSON.stringify(state)}`);
  }
}

async function clickButton(page, id) {
  await page.evaluate((btnId) => {
    const host = document.getElementById("dualtran-floating-btn-host");
    host?.shadowRoot?.getElementById(btnId)?.click();
  }, id);
}

async function runThreeStateJourney(page, serviceWorker, testPageUrl, mockServerConfig, mode, collector) {
  const expectedAiSnippet = mockServerConfig.expectedAiSnippet;
  // replaceOriginal 模式没有 <translated> 元素：
  // - Google 翻译完成 → .dualtran-result-container 出现
  // - AI 翻译完成 → .dualtran-aitranslatedtext-replacemode 出现
  // - 恢复原文 → 两者都消失
  const translatedSelector =
    mode === "replaceOriginal"
      ? ".dualtran-result-container"
      : "translated";
  const aiSpanSelector =
    mode === "replaceOriginal"
      ? ".dualtran-aitranslatedtext-replacemode"
      : "translated";

  async function waitForTranslationApplied(timeoutMs = 15000) {
    await page.waitForFunction((sel) => {
      return document.querySelectorAll(sel).length > 0;
    }, translatedSelector, { timeout: timeoutMs });
  }

  async function waitForNoTranslation(timeoutMs = 15000) {
    // replaceOriginal 模式：.dualtran-result-container 是加在原文父节点上的
    // class，restorePage 不会移除它——用 AI span 消失判断恢复完成
    // （restorePage 会移除所有 .dualtran-aitranslatedtext-replacemode span）
    const noTranslationSelector =
      mode === "replaceOriginal"
        ? ".dualtran-aitranslatedtext-replacemode"
        : "translated";
    await page.waitForFunction((sel) => {
      return document.querySelectorAll(sel).length === 0;
    }, noTranslationSelector, { timeout: timeoutMs });
  }

  async function waitForAiApplied(timeoutMs = 45000) {
    await page.waitForFunction((sel) => {
      return document.querySelectorAll(sel).length > 0;
    }, aiSpanSelector, { timeout: timeoutMs });
  }

  try {
    // 设置显示模式
    await serviceWorker.evaluate(async (m) => {
      await chrome.storage.local.set({ whereToDisplayTranslatedText: m });
    }, mode);
    await page.waitForTimeout(300);

    // ── 步骤 1：导航 + 初始状态 ──
    console.log(`  [${mode}] Step 1: navigate, expect Original highlighted`);
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    await page.waitForFunction(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      return !!host?.shadowRoot?.getElementById("btnOriginal");
    }, null, { timeout: 10000 });

    let state = await getButtonState(page);
    assertHighlighted(state, "original", `[${mode}] initial`);
    assertNotHighlighted(state, "google", `[${mode}] initial`);
    assertNotHighlighted(state, "ai", `[${mode}] initial`);
    console.log(`  [${mode}] Initial: Original highlighted ✓`);

    // ── 步骤 2：点 Google → 翻译 + Google 高亮 ──
    console.log(`  [${mode}] Step 2: click Google → translate + Google highlighted`);
    await clickButton(page, "btnGoogle");
    await waitForTranslationApplied();
    state = await getButtonState(page);
    assertHighlighted(state, "google", `[${mode}] after Google click`);
    assertNotHighlighted(state, "original", `[${mode}] after Google click`);
    console.log(`  [${mode}] Google highlighted after click ✓`);

    // ── 步骤 3：点 AI → AI 高亮 + AI 翻译 ──
    console.log(`  [${mode}] Step 3: click AI → AI highlighted + AI translation`);
    await clickButton(page, "btnAi");
    await waitForAiApplied();
    state = await getButtonState(page);
    assertHighlighted(state, "ai", `[${mode}] after AI click`);
    assertNotHighlighted(state, "google", `[${mode}] after AI click`);
    console.log(`  [${mode}] AI highlighted after click ✓`);

    // ── 步骤 4：点 Google → 本地切回 Google 译文（不发请求）──
    console.log(`  [${mode}] Step 4: click Google → local switch back (no re-request)`);
    await clickButton(page, "btnGoogle");
    await page.waitForTimeout(500);
    state = await getButtonState(page);
    assertHighlighted(state, "google", `[${mode}] after Google re-click`);
    assertNotHighlighted(state, "ai", `[${mode}] after Google re-click`);
    console.log(`  [${mode}] Google highlighted after re-click ✓`);

    // ── 步骤 5：点 Original → 恢复原文 + Original 高亮 ──
    console.log(`  [${mode}] Step 5: click Original → restore + Original highlighted`);
    await clickButton(page, "btnOriginal");
    await waitForNoTranslation();
    state = await getButtonState(page);
    assertHighlighted(state, "original", `[${mode}] after Original click`);
    assertNotHighlighted(state, "google", `[${mode}] after Original click`);
    assertNotHighlighted(state, "ai", `[${mode}] after Original click`);
    console.log(`  [${mode}] Original highlighted after restore ✓`);

    // ── 步骤 6：自动翻译（未介入）→ Google 高亮（内容驱动）──
    console.log(`  [${mode}] Step 6: auto-translate (no intervention) → Google highlighted`);
    await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
    await waitForTranslationApplied();
    state = await getButtonState(page);
    assertHighlighted(state, "google", `[${mode}] after auto-translate`);
    assertNotHighlighted(state, "original", `[${mode}] after auto-translate`);
    console.log(`  [${mode}] Google highlighted after auto-translate ✓`);

    // ── 步骤 7：外部操作（右键菜单 / popup / 快捷键 → translate-page-ai）──
    // D1/D2 修复（plan 30）：外部意图必须移动高亮。此前这条路径只调引擎、
    // 不通知 UI —— 页面已 Google 翻译时用外部入口发起 AI 翻译，按钮停在旧态。
    // 现在 E3 意图事件把 "ai" 送到 floatingBtn（highlight + aiModeActive 闩锁）。
    console.log(`  [${mode}] Step 7: external AI op (context-menu path) → AI highlighted (D1/D2)`);
    await sendMessageToTab(serviceWorker, page.url(), { action: "translate-page-ai" });
    await page.waitForFunction(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btn = host?.shadowRoot?.getElementById("btnAi") || null;
      return !!btn?.classList.contains("dualtran-floating-btn-active");
    }, null, { timeout: 10000 });
    // Wait for the AI translation to actually LAND (text in the page): the
    // success arms the sessionStorage AI-restore marker, and the NEXT pass
    // must then load on an armed page — that is the deterministic D6 setup
    // (an explicit Google click on an armed page must win over the armed
    // AI auto-restore; the button must show Google, not AI).
    await page.waitForFunction(({ snippet, m }) => {
      if (m === "replaceOriginal") {
        return [...document.querySelectorAll(".dualtran-aitranslatedtext-replacemode")]
          .some((el) => (el.textContent || "").trim().length > 0);
      }
      return [...document.querySelectorAll(".dualtran-ai")]
        .some((el) => (el.textContent || "").includes(snippet));
    }, { snippet: expectedAiSnippet, m: mode }, { timeout: 45000 });
    state = await getButtonState(page);
    assertHighlighted(state, "ai", `[${mode}] after external AI op`);
    assertNotHighlighted(state, "google", `[${mode}] after external AI op`);
    // Cross-module consistency: the actual highlight must equal the intent
    // SSOT (with the derivation fallback), latched or not.
    await assertUiStateMatchesEngine(page, serviceWorker);
    console.log(`  [${mode}] AI highlighted after external op ✓`);

    console.log(`  [${mode}] Three-state journey PASSED`);
  } catch (err) {
    collector?.record?.(`three-state-${mode}`, err.message);
    // Failure diagnostic (plan 30 / D6; shared helper since plan 40 part C /
    // #141): dump the floating UI store's change log so a failure names the
    // writer that moved the highlight (the store is the SSOT; "which writer"
    // is the first question for state bugs).
    await dumpUiStateLog(serviceWorker, page.url(), `three-state-${mode}`);
    throw err;
  }
}

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, mockServerConfig, collector } = scope;

  console.log("┌──────────────────────────────────────────────────┐");
  console.log("│  floating-btn-three-state                       │");
  console.log("└──────────────────────────────────────────────────┘");

  collector?.attachPage?.(page, "floating-btn-three-state");

  // 场景自含 AI 前置（#94 原则）：步骤 3/7 依赖真实 AI 翻译落地（落地才武装
  // sessionStorage AI marker → 下一趟导航才是「已武装」页面）。此前该前置靠
  // storage 残留：全套运行时前序场景恰好配过 AI（绿），孤立运行时无 key 静默
  // 降级（无 AI 译文、marker 不武装，D6 格根本触不到）——两套运行方式行为不同。
  // 显式写入 mock AI 配置，两种运行方式完全一致。
  const apiBase = mockServerConfig?.openRouterApiBase || "http://localhost:8788";
  await serviceWorker.evaluate(async (config) => {
    await chrome.storage.local.set({
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: config.apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      aiImproveForLongerThan: 0,
      showFloatingBtn: "yes",
    });
  }, { apiBase });

  // newLine 模式
  await runThreeStateJourney(page, serviceWorker, testPageUrl, mockServerConfig, "newLine", collector);

  // replaceOriginal 模式（模式对称性规则）
  await runThreeStateJourney(page, serviceWorker, testPageUrl, mockServerConfig, "replaceOriginal", collector);

  console.log("\n  PASS: three-state journey passed in both modes");
}
