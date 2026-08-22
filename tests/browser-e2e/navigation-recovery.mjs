/**
 * DualTran E2E — SPA 导航后悬浮按钮恢复回归测试
 *
 * 使用 extra/e2e/spa-source.html 和 spa-target.html 两个
 * 真实模拟 Turbo Drive 行为的 SPA 页面进行测试。
 *
 * SPA 页面行为（与 GitHub Turbo Drive + turbo-cache-control=no-cache 一致）：
 *   1. 拦截同域链接点击 → fetch 获取目标 HTML → 替换 body.innerHTML → pushState
 *   2. 回退时 popstate → fetch 原页面 → 替换 body.innerHTML
 *   3. DOM 被替换后 content script 不会重新注入（同一页面上下文）
 *
 * Bug 描述：SPA 导航替换 DOM 后，浮动按钮 host 和 singleton host
 * 元素随旧 body 被移除，且不会自动重建。
 *
 * 修复文件：
 *   - src/contentScript/floatingBtn.js (popstate/pageshow 监听器)
 *   - src/contentScript/singletonBtnGroup.js (detached host 检测)
 *   - src/contentScript/pageTranslator.js (移除 singletonInitialized 守卫)
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  writeStorage,
  sendMessageToTab,
} from "./setup.mjs";

export const name = "navigation-recovery";
export const needsMock = false;
export const smoke = true;

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 验证浮动按钮（#dualtran-floating-btn-host）在 shadow DOM 中存在且可用。
 */
async function checkFloatingButton(page) {
  return page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    if (!host) return { exists: false, inDOM: false, hasButtons: false };
    const inDOM = document.body.contains(host);
    const root = host.shadowRoot;
    const btnOriginal = root?.getElementById("btnOriginal");
    const btnGoogle = root?.getElementById("btnGoogle");
    const btnAi = root?.getElementById("btnAi");
    return {
      exists: !!host,
      inDOM,
      hasButtons: !!(btnOriginal && btnGoogle && btnAi),
    };
  });
}

/**
 * 验证 singleton 按钮组（#dualtran-singleton-btn-host）是否存在。
 */
async function checkSingletonButtonGroup(page) {
  return page.evaluate(() => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    if (!host) return { exists: false, inDOM: false };
    return {
      exists: true,
      inDOM: document.body.contains(host),
    };
  });
}

/**
 * 等待浮动按钮出现（带超时重试）。
 */
async function waitForFloatingButton(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btn = await checkFloatingButton(page);
    if (btn.exists && btn.hasButtons && btn.inDOM) return btn;
    await page.waitForTimeout(200);
  }
  const last = await checkFloatingButton(page);
  throw new Error(
    `Floating button did not appear within ${timeoutMs}ms. Last check: exists=${last.exists}, hasButtons=${last.hasButtons}, inDOM=${last.inDOM}`
  );
}

/**
 * 等待 SPA 导航完成（body 中出现新的 H1 文本）。
 */
async function waitForSpaContent(page, h1Text, timeoutMs = 10000) {
  await page.waitForFunction(
    (text) => {
      const h1 = document.querySelector("h1");
      return h1 && h1.textContent.includes(text);
    },
    h1Text,
    { timeout: timeoutMs }
  );
}

/**
 * 从 testPageUrl 构造 SPA 页面 URL。
 */
function buildSpaUrl(testPageUrl, pageName) {
  const url = new URL(testPageUrl);
  url.pathname = url.pathname.replace(/[^/]+$/, pageName);
  return url.href;
}

// ═══════════════════════════════════════════════════════════════
// 场景 1：SPA 链接导航后浮动按钮恢复（核心场景）
//
// 模拟真实 SPA 导航流程：
//   source page 加载 → 浮动按钮显示
//   → 点击链接（SPA：fetch + body 替换 + pushState）→ target page
//   → 浏览器回退（popstate → SPA fetch + body 替换）
//   → source page 重新显示 → 浮动按钮应自动恢复
// ═══════════════════════════════════════════════════════════════

async function verifySpaBackNavigation(page, serviceWorker, testPageUrl) {
  console.log("[nav-recovery] Scene 1: SPA back-navigation floating button recovery");

  const spaSourceUrl = buildSpaUrl(testPageUrl, "spa-source.html");
  const spaTargetUrl = buildSpaUrl(testPageUrl, "spa-target.html");

  // ── 步骤 1：加载 source 页面 ──
  await page.goto(spaSourceUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());

  // 确保 floating button 启用
  await writeStorage(serviceWorker, "showFloatingBtn", "yes");
  await page.waitForTimeout(800);

  // 验证浮动按钮初始存在
  let btn = await checkFloatingButton(page);
  console.log(`  Step 1 (source page): exists=${btn.exists}, hasButtons=${btn.hasButtons}`);
  if (!btn.exists || !btn.hasButtons) {
    throw new Error("Scene 1 Step 1: Floating button not found on source page load");
  }

  // ── 步骤 2：点击链接进行 SPA 导航到 target 页面 ──
  // SPA 脚本拦截点击 → fetch target.html → 替换 body.innerHTML → pushState
  console.log("  Step 2: clicking SPA link to target page...");
  await page.click("a#test-link");
  await waitForSpaContent(page, "SPA Target Page", 5000);
  await page.waitForTimeout(500);

  // 验证 URL 已变为 target（pushState 生效）
  const targetUrl = page.url();
  console.log(`  After SPA nav, URL: ${targetUrl}`);

  // ── 步骤 3：浏览器回退 ──
  // popstate 事件触发 → SPA 的 popstate handler 重新 fetch source.html →
  // 替换 body.innerHTML → 浮动按钮的 popstate handler 检测 host 丢失并重建
  console.log("  Step 3: navigating back (popstate)...");
  await page.goBack();

  // 等待 SPA 回退完成（source 页面的 H1 出现）
  await waitForSpaContent(page, "SPA Source Page", 5000);
  console.log(`  After goBack, URL: ${page.url()}`);

  // 等待浮动按钮的 popstate handler 完成恢复（200ms debounce + 重建）
  await page.waitForTimeout(600);

  // ── 验证：浮动按钮已恢复 ──
  btn = await checkFloatingButton(page);
  console.log(`  Step 3 result: exists=${btn.exists}, hasButtons=${btn.hasButtons}, inDOM=${btn.inDOM}`);
  if (!btn.exists || !btn.hasButtons || !btn.inDOM) {
    throw new Error(
      `Scene 1 FAIL: Floating button NOT recovered after SPA back-navigation. ` +
      `exists=${btn.exists}, hasButtons=${btn.hasButtons}, inDOM=${btn.inDOM}`
    );
  }

  // ── 步骤 4：再次前进到 target 页面 ──
  console.log("  Step 4: navigating forward (popstate)...");
  await page.goForward();
  await waitForSpaContent(page, "SPA Target Page", 5000);
  await page.waitForTimeout(600);

  btn = await checkFloatingButton(page);
  console.log(`  Step 4 result: exists=${btn.exists}, hasButtons=${btn.hasButtons}, inDOM=${btn.inDOM}`);
  if (!btn.exists || !btn.hasButtons || !btn.inDOM) {
    throw new Error(
      `Scene 1 FAIL: Floating button NOT recovered after SPA forward-navigation. ` +
      `exists=${btn.exists}, hasButtons=${btn.hasButtons}, inDOM=${btn.inDOM}`
    );
  }

  console.log("  Scene 1 PASSED: floating button survives round-trip SPA navigation");
}

// ═══════════════════════════════════════════════════════════════
// 场景 2：多次 SPA 回退/前进 debounce 不重复创建
//
// source → target → back → forward → back → ...
// 每次 popstate 应触发一次重建，且 debounce 防止快速操作时重复创建。
// ═══════════════════════════════════════════════════════════════

async function verifyMultipleSpaNavigations(page, serviceWorker, testPageUrl) {
  console.log("[nav-recovery] Scene 2: multiple SPA back/forward navigations");

  const spaSourceUrl = buildSpaUrl(testPageUrl, "spa-source.html");

  await page.goto(spaSourceUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await writeStorage(serviceWorker, "showFloatingBtn", "yes");
  await page.waitForTimeout(800);

  // source → target (click link)
  await page.click("a#test-link");
  await waitForSpaContent(page, "SPA Target Page", 5000);
  await page.waitForTimeout(300);

  // 执行 3 次来回导航
  for (let i = 0; i < 3; i++) {
    // back to source
    await page.goBack();
    await waitForSpaContent(page, "SPA Source Page", 5000);
    await page.waitForTimeout(600);

    let btn = await checkFloatingButton(page);
    if (!btn.exists || !btn.hasButtons) {
      throw new Error(
        `Scene 2 FAIL: Floating button missing after goBack #${i + 1}. ` +
        `exists=${btn.exists}, hasButtons=${btn.hasButtons}`
      );
    }

    // forward to target
    await page.goForward();
    await waitForSpaContent(page, "SPA Target Page", 5000);
    await page.waitForTimeout(600);

    btn = await checkFloatingButton(page);
    if (!btn.exists || !btn.hasButtons) {
      throw new Error(
        `Scene 2 FAIL: Floating button missing after goForward #${i + 1}. ` +
        `exists=${btn.exists}, hasButtons=${btn.hasButtons}`
      );
    }
  }

  // 验证没有重复的 host 元素
  const hostCount = await page.evaluate(
    () => document.querySelectorAll("#dualtran-floating-btn-host").length
  );
  console.log(`  After 3 round-trips: hostCount=${hostCount}`);
  if (hostCount > 1) {
    throw new Error(`Scene 2 FAIL: Found ${hostCount} floating button hosts (expected 1)`);
  }

  console.log("  Scene 2 PASSED: floating button survives 3 round-trip SPA navigations");
}

// ═══════════════════════════════════════════════════════════════
// 场景 3：singleton 按钮组在 SPA 导航 + 重翻译后恢复
//
// source page 翻译 → singleton 创建
// → SPA 导航到 target → DOM 替换（singleton 丢失）
// → 回退到 source → popstate → 重翻译
// → ensureSingletonInit → createSingletonButtonGroup 检测脱离 host 并重建
// ═══════════════════════════════════════════════════════════════

async function verifySingletonSpaRecovery(page, serviceWorker, testPageUrl) {
  console.log("[nav-recovery] Scene 3: singleton button group recovery in SPA");

  const spaSourceUrl = buildSpaUrl(testPageUrl, "spa-source.html");

  await page.goto(spaSourceUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await writeStorage(serviceWorker, "showFloatingBtn", "yes");
  await page.waitForTimeout(800);

  // 触发 Google 翻译 → ensureSingletonInit → singleton host 创建
  // 注意：内容脚本运行在隔离世界，页面主世界的 chrome.runtime 不可用，
  // 必须通过 SW 的 sendMessageToTab 转发（chrome.runtime.sendMessage 在
  // page.evaluate 中会抛 "Cannot read properties of undefined"）
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });

  // 等待翻译完成
  await page.waitForFunction(
    () => document.querySelectorAll("translated").length > 0,
    null,
    { timeout: 15000 }
  );
  await page.waitForTimeout(500);

  // 验证 singleton host 存在
  let singleton = await checkSingletonButtonGroup(page);
  console.log(`  After translation: singleton exists=${singleton.exists}, inDOM=${singleton.inDOM}`);
  if (!singleton.exists) {
    throw new Error("Scene 3 FAIL: Singleton button group not created after translation");
  }

  // SPA 导航到 target → DOM 替换 → singleton 丢失
  await page.click("a#test-link");
  await waitForSpaContent(page, "SPA Target Page", 5000);
  await page.waitForTimeout(300);

  // 回退到 source
  await page.goBack();
  await waitForSpaContent(page, "SPA Source Page", 5000);

  // popstate handler 在 floatingBtn 中已设置 shouldForceAiAfterPageTranslation
  // 等待 translation 自动触发
  await page.waitForTimeout(500);

  // 触发重新翻译 → ensureSingletonInit → createSingletonButtonGroup 检测并重建
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });

  // 等待翻译和 singleton 重建
  await page.waitForFunction(
    () => document.querySelectorAll("translated").length > 0,
    null,
    { timeout: 15000 }
  );
  await page.waitForTimeout(1000);

  singleton = await checkSingletonButtonGroup(page);
  console.log(`  After SPA back + retranslate: singleton exists=${singleton.exists}, inDOM=${singleton.inDOM}`);
  if (!singleton.exists || !singleton.inDOM) {
    throw new Error(
      `Scene 3 FAIL: Singleton button group NOT recovered after SPA navigation + retranslate. ` +
      `exists=${singleton.exists}, inDOM=${singleton.inDOM}`
    );
  }

  console.log("  Scene 3 PASSED: singleton button group recovers after SPA back + retranslate");
}

// ═══════════════════════════════════════════════════════════════
// 场景 4：SPA 链接点击导航（前进，非回退）后浮动按钮恢复
//
// source → 点击 SPA 链接 → target（body 替换，非 popstate）
// 此场景下浮动按钮通过 popstate 监听器不会触发（因为不是回退操作），
// 但若 MutationObserver 或后续翻译触发了 ensureSingletonInit，
// 则 singleton 能够恢复。本场景记录当前行为。
// ═══════════════════════════════════════════════════════════════

async function verifySpaForwardLinkNavigation(page, serviceWorker, testPageUrl) {
  console.log("[nav-recovery] Scene 4: SPA link-click navigation (forward)");

  const spaSourceUrl = buildSpaUrl(testPageUrl, "spa-source.html");

  await page.goto(spaSourceUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await writeStorage(serviceWorker, "showFloatingBtn", "yes");
  await page.waitForTimeout(800);

  // 验证初始浮动按钮存在
  let btn = await checkFloatingButton(page);
  console.log(`  Before SPA nav: exists=${btn.exists}, hasButtons=${btn.hasButtons}`);
  if (!btn.exists || !btn.hasButtons) {
    throw new Error("Scene 4 FAIL: Floating button not found on source page");
  }

  // 点击 SPA 链接前进到 target（非 popstate，仅 pushState）
  await page.click("a#test-link");
  await waitForSpaContent(page, "SPA Target Page", 5000);
  // MutationObserver 需要 300ms debounce
  await page.waitForTimeout(600);

  btn = await checkFloatingButton(page);
  console.log(`  After SPA link nav: exists=${btn.exists}, hasButtons=${btn.hasButtons}, inDOM=${btn.inDOM}`);

  // MutationObserver 应检测到 body 替换 → host 丢失 → 自动重建
  if (!btn.exists || !btn.hasButtons) {
    throw new Error(
      `Scene 4 FAIL: Floating button not recovered after SPA link-navigation. ` +
      `exists=${btn.exists}, hasButtons=${btn.hasButtons}`
    );
  }

  // 回退验证（确保 popstate 恢复仍然有效）
  await page.goBack();
  await waitForSpaContent(page, "SPA Source Page", 5000);
  await page.waitForTimeout(600);

  btn = await checkFloatingButton(page);
  console.log(`  After goBack: exists=${btn.exists}, hasButtons=${btn.hasButtons}, inDOM=${btn.inDOM}`);
  if (!btn.exists || !btn.hasButtons || !btn.inDOM) {
    throw new Error("Scene 4 FAIL: Floating button NOT recovered after goBack from SPA target");
  }

  console.log("  Scene 4 PASSED: floating button survives SPA link-nav and goBack");
}

// ═══════════════════════════════════════════════════════════════
// 主运行入口
// ═══════════════════════════════════════════════════════════════

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, collector } = scope;

  console.log("\n════════════════════════════════════════════");
  console.log("  Navigation Recovery E2E (SPA Pages)");
  console.log("════════════════════════════════════════════\n");

  await collector.collectExtensionErrors(page, scope.extensionId);

  try {
    // 场景 1：SPA 回退/前进 — 浮动按钮恢复
    await verifySpaBackNavigation(page, serviceWorker, testPageUrl);

    // 场景 2：多次来回 — debounce 防止重复创建
    await verifyMultipleSpaNavigations(page, serviceWorker, testPageUrl);

    // 场景 3：singleton 按钮组 SPA 恢复
    await verifySingletonSpaRecovery(page, serviceWorker, testPageUrl);

    // 场景 4：链接点击（非回退）导航行为
    await verifySpaForwardLinkNavigation(page, serviceWorker, testPageUrl);

    console.log("\n  All SPA navigation recovery tests passed.\n");
  } catch (err) {
    console.error(`\n  NAVIGATION RECOVERY TEST FAILED: ${err.message}\n`);
    throw err;
  }
}
