/**
 * DualTran E2E — 段落按钮组显示模式设置（#171）
 *
 * 覆盖（plan 57 §4.4）：
 *   S1（触发模式 + 点击=是，touch 模拟）：tap 段落 → 组出现在文本下方；
 *      再 tap 收起；touchMove 滚动 → 不闪现；长按（pointercancel/超时）→ 不闪现。
 *   S2（常驻 + 徽标，双显示模式遍历）：每个注册块末尾出现徽标（内联锚点：
 *      newLine = <translated> 之前 / replaceOriginal = 块元素末尾）；点徽标 →
 *      弹层；Original 态恢复（newLine 下 <translated> 隐藏）后徽标仍可见可点
 *      （reachability）；再点徽标收起/展开（toggle）。
 *   S3（常驻 + 直接三按钮）：内联三按钮行标签 Original/Google/AI；点 AI →
 *      intent 高亮翻转为激活（单一意图渲染源）。
 *   S4（运行时切换）：storage 改写 display → 控件即时增删（无需刷新）；
 *      切回触发模式后悬停不再弹出（入口策略即时生效）。
 *   S5（options 页修订，#171 2026-10-12；label 文案 2026-10-15）：依赖组的
 *      显示/隐藏双向翻转（triggered → 常驻组隐藏、触发组可见；always → 反之），
 *      组为 **隐藏而非 disabled**，且两处 label 文案落地（"Always-visible
 *      style" / "When to display the paragraph button group"）。
 *
 * touch 模拟：Playwright CDP session → Emulation.setTouchEmulationEnabled +
 * Input.dispatchTouchEvent（真实输入管线：pointer 事件 + 点击合成由浏览器产生）。
 *
 * @module block-btn-group
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  forEachDisplayMode,
  writeStorage,
} from "./setup.mjs";

export const name = "block-btn-group";
export const needsMock = true;
export const smoke = false;

// 注册块 = 带 data-dualtran-block 的元素（registerBlock 的落印）。
// 注意：replaceOriginal 页面还存在 getPiecesToTranslate 双模式共用产生的
// **空 <translated> 占位元素**（display:none、未注册）——断言必须用注册标记
// 计数，而不是 "translated, [data-dualtran-block]" 并集（会把占位元素算进去）。
const BLOCK_SELECTOR = "[data-dualtran-block]";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── 配置 ────────────────────────────────────────────────────────

async function configureExtension(serviceWorker, mockServerConfig, overrides = {}) {
  const {
    mode = "newLine",
    display = "triggered",
    style = "badge",
    showOnHover = "yes",
    showOnClick = "no",
  } = overrides;
  await serviceWorker.evaluate(
    async ({ apiBase, whereToDisplay, displayValue, styleValue, hoverValue, clickValue }) => {
      await chrome.storage.local.set({
        targetLanguage: "fr",
        targetLanguages: ["fr", "en", "es"],
        whereToDisplayTranslatedText: whereToDisplay,
        aiProvider: "openrouter",
        apiKeyOpenRouter: "mock-openrouter-key",
        openRouterApiBase: apiBase,
        openRouterModel: "openai/gpt-4o-mini",
        autoImproveByAI: "no",
        aiImproveForLongerThan: 0,
        showFloatingBtn: "yes",
        translateDynamicallyCreatedContent: "yes",
        blockBtnGroupDisplay: displayValue,
        blockBtnGroupAlwaysStyle: styleValue,
        blockBtnGroupShowOnHover: hoverValue,
        blockBtnGroupShowOnClick: clickValue,
      });
    },
    {
      apiBase: mockServerConfig.openRouterApiBase,
      whereToDisplay: mode,
      displayValue: display,
      styleValue: style,
      hoverValue: showOnHover,
      clickValue: showOnClick,
    }
  );
}

/** 打开测试页 → 注入等待 → 点击浮动组 Google（整页翻译，注册块出现等）。 */
async function openTranslatedPage(page, serviceWorker, testPageUrl) {
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await page.waitForFunction(
    () => !!document.getElementById("dualtran-floating-btn-host")?.shadowRoot?.getElementById("btnGoogle"),
    null,
    { timeout: 15_000 }
  );
  await page.evaluate(() => {
    document
      .getElementById("dualtran-floating-btn-host")
      ?.shadowRoot?.getElementById("btnGoogle")
      ?.click();
  });
  await page.waitForFunction(
    () => document.querySelectorAll("translated, [data-dualtran-block]").length >= 1,
    null,
    { timeout: 30_000 }
  );
  await page.waitForTimeout(600);
}

// ─── 观测 / 交互 helper ──────────────────────────────────────────

const SINGLETON_BTN_SELECTOR = {
  original: ".dualtran-original-btn",
  google: ".dualtran-google-btn",
  ai: ".dualtran-ai-btn",
};

async function singletonVisible(page) {
  return page.evaluate(() => {
    const h = document.getElementById("dualtran-singleton-btn-host");
    return !!h && h.style.top !== "-9999px";
  });
}

async function clickSingletonButton(page, which) {
  const selector = SINGLETON_BTN_SELECTOR[which];
  assert(!!selector, `clickSingletonButton: unknown button "${which}"`);
  await page.evaluate((sel) => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    const btn = host?.shadowRoot?.querySelector(sel);
    if (!btn) throw new Error(`singleton button not found: ${sel}`);
    btn.click();
  }, selector);
}

/** 选择一个不含交互元素（链接/按钮）、有实际盒子的注册块并滚动到视口中央，返回索引。 */
async function pickLinkFreeBlock(page) {
  return page.evaluate((selector) => {
    const blocks = Array.from(document.querySelectorAll(selector));
    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      if (el.querySelector("a, button, input, select, textarea")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // display:none / 空占位不计
      el.scrollIntoView({ block: "center" });
      return i;
    }
    return -1;
  }, BLOCK_SELECTOR);
}

async function blockCenter(page, index) {
  return page.evaluate(({ selector, idx }) => {
    const el = document.querySelectorAll(selector)[idx];
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, { selector: BLOCK_SELECTOR, idx: index });
}

async function createTouchCdp(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return cdp;
}

async function touchTap(cdp, point) {
  // Explicit timestamps: without them the emulated pipeline can defer the
  // synthesized pointerup by seconds, distorting the gesture duration.
  const startTime = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: point.x, y: point.y }],
    timestamp: startTime,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: startTime + 0.08,
  });
}

async function touchSlowGesture(cdp, point, { holdMs, moveTo }) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: point.x, y: point.y }],
  });
  if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
  if (moveTo) {
    // 分段移动模拟真实滑动（触发原生 scroll / pointercancel）
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: Math.round(point.x + (moveTo.x - point.x) * (i / steps)),
            y: Math.round(point.y + (moveTo.y - point.y) * (i / steps)),
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}


// ─── 场景 S1：触发模式 + 点击=是（touch 模拟） ───────────────────

async function sceneTapByTouch(scope) {
  const { page, serviceWorker, mockServerConfig, testPageUrl } = scope;

  await forEachDisplayMode(scope, async (mode) => {
    console.log(`  [S1/${mode}] tap 显示 → 再 tap 收起 → 滚动不闪现 → 长按不闪现`);
    await configureExtension(serviceWorker, mockServerConfig, {
      mode,
      display: "triggered",
      showOnClick: "yes",
    });
    await openTranslatedPage(page, serviceWorker, testPageUrl);

    const cdp = await createTouchCdp(page);
    try {
      const idx = await pickLinkFreeBlock(page);
      assert(idx >= 0, `[S1/${mode}] no link-free block found`);

      // tap → 组出现
      let point = await blockCenter(page, idx);
      assert(!!point, `[S1/${mode}] block center not found`);
      await touchTap(cdp, point);
      await page.waitForTimeout(250);
      assert(await singletonVisible(page), `[S1/${mode}] tap did not show the button group`);

      // 再 tap → 收起（toggle）
      point = await blockCenter(page, idx);
      await touchTap(cdp, point);
      await page.waitForTimeout(250);
      assert(!(await singletonVisible(page)), `[S1/${mode}] second tap did not hide the group`);

      // touchMove 滚动 → 不闪现
      point = await blockCenter(page, idx);
      await touchSlowGesture(cdp, point, { moveTo: { x: point.x, y: point.y - 160 } });
      await page.waitForTimeout(300);
      assert(
        !(await singletonVisible(page)),
        `[S1/${mode}] scroll gesture flashed the button group`
      );

      // 长按 → 不闪现（时长门 + 触摸合成 mouseover 抑制两条防线都被本格钉住：
      // 探针实测该环境下长按后 Chrome 仍会补发 firesTouchEvents 的 mouseover）
      point = await blockCenter(page, idx);
      await touchSlowGesture(cdp, point, { holdMs: 800 });
      await page.waitForTimeout(250);
      assert(
        !(await singletonVisible(page)),
        `[S1/${mode}] long-press opened the button group`
      );
    } finally {
      await cdp.detach().catch(() => {});
    }
  });
}

// ─── 场景 S2：常驻 + 徽标（双显示模式） ──────────────────────────

async function sceneBadge(scope) {
  const { page, serviceWorker, mockServerConfig, testPageUrl } = scope;

  await forEachDisplayMode(scope, async (mode) => {
    console.log(`  [S2/${mode}] 徽标注入 / 锚点 / 弹层 / Original 态可达性 / toggle`);
    await configureExtension(serviceWorker, mockServerConfig, {
      mode,
      display: "always",
      style: "badge",
    });
    await openTranslatedPage(page, serviceWorker, testPageUrl);

    await page.waitForFunction(
      () => document.querySelectorAll(".dualtran-block-badge").length >= 1,
      null,
      { timeout: 10_000 }
    );

    // ① 数量与锚点
    const anchorCheck = await page.evaluate(({ displayMode, selector }) => {
      const badges = Array.from(document.querySelectorAll(".dualtran-block-badge"));
      const blocks = Array.from(document.querySelectorAll(selector));
      const badgeSet = new Set(badges);
      const hasAdjacentBadge = (el) => {
        if (displayMode === "newLine") {
          return !!el.nextElementSibling && badgeSet.has(el.nextElementSibling);
        }
        return Array.from(el.children).some((c) => badgeSet.has(c));
      };
      const noBadge = blocks.filter((el) => !hasAdjacentBadge(el));
      const nested = blocks.filter((el) => blocks.some((other) => other !== el && other.contains(el)));
      const badge = badges[0];
      let anchorOk = false;
      if (displayMode === "newLine") {
        anchorOk = badge?.nextElementSibling?.nodeName?.toLowerCase() === "translated";
      } else {
        const parent = badge?.parentElement;
        anchorOk = !!parent?.hasAttribute?.("data-dualtran-block") && parent.lastElementChild === badge;
      }
      return {
        badges: badges.length,
        blocks: blocks.length,
        anchorOk,
        nestedCount: nested.length,
        noBadgeCount: noBadge.length,
        noBadgeSample: noBadge.slice(0, 5).map((el) => ({
          tag: el.tagName,
          cls: String(el.className || "").slice(0, 40),
          kids: el.children.length,
          text: (el.textContent || "").replace(/\s+/g, " ").slice(0, 60),
          parentTag: el.parentElement?.tagName,
        })),
      };
    }, { displayMode: mode, selector: BLOCK_SELECTOR });
    if (anchorCheck.badges !== anchorCheck.blocks) {
      console.log(`  [dbg S2/${mode}] ${JSON.stringify(anchorCheck)}`);
    }
    assert(
      anchorCheck.badges === anchorCheck.blocks,
      `[S2/${mode}] badge count ${anchorCheck.badges} != block count ${anchorCheck.blocks}`
    );
    assert(anchorCheck.anchorOk, `[S2/${mode}] badge is not anchored inline at the block end`);

    // ② 点徽标 → 弹层（单例组）显示
    await page.evaluate(() => document.querySelector(".dualtran-block-badge").click());
    await page.waitForTimeout(250);
    assert(await singletonVisible(page), `[S2/${mode}] badge click did not open the popover`);

    // ③ Original 恢复 → 徽标仍可见（reachability 核心格）
    await clickSingletonButton(page, "original");
    await page.waitForTimeout(400);
    const reachability = await page.evaluate(() => {
      const b = document.querySelector(".dualtran-block-badge");
      return {
        connected: !!b?.isConnected,
        displayed: !!b && b.getBoundingClientRect().height > 0,
      };
    });
    assert(
      reachability.connected && reachability.displayed,
      `[S2/${mode}] badge lost visibility after restoring the original (${JSON.stringify(reachability)})`
    );

    // ④ 再点徽标 → 收起；再点 → 展开（toggle）
    await page.evaluate(() => document.querySelector(".dualtran-block-badge").click());
    await page.waitForTimeout(250);
    assert(!(await singletonVisible(page)), `[S2/${mode}] badge re-click did not close the popover`);
    await page.evaluate(() => document.querySelector(".dualtran-block-badge").click());
    await page.waitForTimeout(250);
    assert(await singletonVisible(page), `[S2/${mode}] badge re-open failed`);
  });
}

// ─── 场景 S3：常驻 + 直接三按钮 ──────────────────────────────────

async function sceneInlineButtons(scope) {
  const { page, serviceWorker, mockServerConfig, testPageUrl } = scope;

  console.log("  [S3] 内联三按钮行：标签 / 点击 AI → intent 高亮");
  await configureExtension(serviceWorker, mockServerConfig, {
    mode: "newLine",
    display: "always",
    style: "buttons",
  });
  await openTranslatedPage(page, serviceWorker, testPageUrl);

  await page.waitForFunction(
    () => document.querySelectorAll(".dualtran-block-btn-row").length >= 1,
    null,
    { timeout: 10_000 }
  );

  const labels = await page.evaluate(() =>
    Array.from(document.querySelector(".dualtran-block-btn-row").querySelectorAll("button")).map(
      (b) => b.textContent
    )
  );
  assert(
    JSON.stringify(labels) === JSON.stringify(["Original", "Google", "AI"]),
    `[S3] inline row labels are ${JSON.stringify(labels)}`
  );

  await page.evaluate(() =>
    document.querySelector('.dualtran-block-btn-row [data-button-id="ai"]').click()
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('.dualtran-block-btn-row [data-button-id="ai"]')
        .classList.contains("dualtran-btn-active"),
    null,
    { timeout: 5_000 }
  );
}

// ─── 场景 S4：运行时切换 ─────────────────────────────────────────

async function sceneRuntimeSwitch(scope) {
  const { page, serviceWorker } = scope;

  console.log("  [S4] 运行时切换：控件即时增删 + 悬停门控即时生效");

  // 前置：S3 结束时为 always+buttons；切到 triggered → 控件即时移除（无需刷新）
  await writeStorage(serviceWorker, "blockBtnGroupDisplay", "triggered");
  await page.waitForFunction(
    () => document.querySelectorAll(".dualtran-block-badge, .dualtran-block-btn-row").length === 0,
    null,
    { timeout: 5_000 }
  );

  // 悬停门控即时生效：showOnHover=no → 悬停不弹
  await writeStorage(serviceWorker, "blockBtnGroupShowOnHover", "no");
  await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }, BLOCK_SELECTOR);
  await page.waitForTimeout(350);
  assert(!(await singletonVisible(page)), "[S4] hover showed the group while showOnHover=no");

  // showOnHover=yes → 悬停弹（触发模式的正常路径，策略读取即时生效）
  await writeStorage(serviceWorker, "blockBtnGroupShowOnHover", "yes");
  await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }, BLOCK_SELECTOR);
  await page.waitForTimeout(350);
  assert(await singletonVisible(page), "[S4] hover did not show the group while showOnHover=yes");

  // 切回 always → 徽标即时注入（无需刷新）；同时悬停组被收起
  await writeStorage(serviceWorker, "blockBtnGroupDisplay", "always");
  await writeStorage(serviceWorker, "blockBtnGroupAlwaysStyle", "badge");
  await page.waitForFunction(
    () => document.querySelectorAll(".dualtran-block-badge").length >= 1,
    null,
    { timeout: 5_000 }
  );
  assert(!(await singletonVisible(page)), "[S4] mode switch to always did not close the hover group");
}

// ─── 场景 S5：options 页依赖项隐藏（#171 修订 2026-10-12） ──────────

async function sceneOptionsVisibility(scope) {
  const { page, serviceWorker, extensionId } = scope;

  console.log("  [S5] options 页：依赖组隐藏双向 + label 文案");

  // 前置：triggered → 常驻组应隐藏、触发组应可见。
  // 注①：options 页必须在 storage 写入之后新开——陈旧 in-memory config 陷阱
  // （setup.mjs 注释有载：hash 导航不触发重载，select 会显示旧值）。
  // 注②：等待信号必须选「存储值 ≠ HTML 默认首选项」的字段——hover/click 的
  // HTML 默认首选项都是 "yes"，用默认值相等的字段做等待会在 init 前即通过、
  // 断言读到 init 之前的 DOM（实测竞态）。visibility 在 init 中先于 hover/click
  // 赋值执行，hover/click 到位即证明 visibility 已执行。
  await writeStorage(serviceWorker, "blockBtnGroupDisplay", "triggered");
  await writeStorage(serviceWorker, "blockBtnGroupShowOnHover", "no");
  await writeStorage(serviceWorker, "blockBtnGroupShowOnClick", "no");
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
  await page.waitForFunction(
    () => {
      const hover = document.querySelector("#blockBtnGroupShowOnHover");
      const click = document.querySelector("#blockBtnGroupShowOnClick");
      return hover?.value === "no" && click?.value === "no";
    },
    null,
    { timeout: 5_000 }
  );

  const snap = () =>
    page.evaluate(() => {
      const probe = (sel) => {
        const el = document.querySelector(sel);
        return { display: getComputedStyle(el).display, disabled: el.hasAttribute("disabled") };
      };
      return {
        always: probe("#blockBtnGroupAlwaysOptions"),
        trigger: probe("#blockBtnGroupTriggerOptions"),
        styleLabel: (document.querySelector('b[data-i18n="lblBlockBtnGroupAlwaysStyle"]')?.textContent || "").trim(),
        displayLabel: (document.querySelector('b[data-i18n="lblBlockBtnGroupDisplay"]')?.textContent || "").trim(),
      };
    });

  let v = await snap();
  if (v.always.display !== "none") {
    const diag = await page.evaluate(async () => {
      const stored = await new Promise((r) => chrome.storage.local.get("blockBtnGroupDisplay", r));
      const el = document.querySelector("#blockBtnGroupAlwaysOptions");
      return {
        storedDisplay: stored.blockBtnGroupDisplay,
        selectDisplay: document.querySelector("#blockBtnGroupDisplay")?.value,
        styleAttr: el?.getAttribute("style"),
      };
    });
    throw new Error(`[S5] triggered: the always-style group must be hidden: ${JSON.stringify(diag)}`);
  }
  assert(v.trigger.display !== "none", "[S5] triggered: the trigger group must be visible");
  assert(
    !v.always.disabled && !v.trigger.disabled,
    "[S5] revision: the groups must be hidden, not disabled (grey-out dropped)"
  );
  assert(v.styleLabel === "Always-visible style", `[S5] label text mismatch: ${v.styleLabel}`);
  assert(
    v.displayLabel === "When to display the paragraph button group",
    `[S5] display label text mismatch: ${v.displayLabel}`
  );

  // 页内切换 triggered → always：可见性立即翻转
  await page.selectOption("#blockBtnGroupDisplay", "always");
  await page.waitForTimeout(150);
  v = await snap();
  assert(v.always.display !== "none", "[S5] always: the always-style group must become visible");
  assert(v.trigger.display === "none", "[S5] always: the trigger group must become hidden");

  // 切回 triggered：双向
  await page.selectOption("#blockBtnGroupDisplay", "triggered");
  await page.waitForTimeout(150);
  v = await snap();
  assert(v.always.display === "none", "[S5] back to triggered: the always-style group must hide again");
  assert(v.trigger.display !== "none", "[S5] back to triggered: the trigger group must reappear");
}

// ─── 场景入口 ────────────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker, collector } = scope;
  collector.attachPage(page, "block-btn-group");
  collector.attachServiceWorker(serviceWorker);

  console.log("┌──────────────────────────────────────────────────────┐");
  console.log("│  block-btn-group (#171 display settings / tap / badge) │");
  console.log("└──────────────────────────────────────────────────────┘");

  await sceneTapByTouch(scope);
  await sceneBadge(scope);
  await sceneInlineButtons(scope);
  await sceneRuntimeSwitch(scope);
  await sceneOptionsVisibility(scope);

  console.log("  [block-btn-group] ALL SCENES PASS");
}
