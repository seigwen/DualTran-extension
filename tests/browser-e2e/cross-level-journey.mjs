/**
 * DualTran E2E — 跨层交互旅程（页面级 G → 悬停 A → 逐块语义断言）
 *
 * 来源：issue #70 逃逸分析（/root/DualTran-manage/21-test-system-escape-analysis-and-hardening-plan.md）
 * 与 issue #72/#73 加固。
 *
 * 为什么需要这个场景：
 *   #70（悬停 A 点击后停留 Google 译文）逃过了 20+ E2E 场景 —— 不是因为
 *   断言太弱，而是因为「页面级 Google 点击 → 块级悬停 A 点击」这个跨层
 *   序列从未被任何一个场景走过。既有场景要么只操作浮动按钮（页面级），
 *   要么只 hover 读调色板（#65 组）。跨层组合是覆盖空间里的真空。
 *   #73（newLine O→A 往返后容器仍隐藏）同理 —— 是矩阵在 jsdom 层先抓到，
 *   本场景把它钉在真实浏览器里。
 *
 * 场景结构（每个 display mode 各跑一遍，模式对称性规则）：
 *   1. 页面级点 Google → 整页 Google 译文
 *   2. 悬停某块 → 块级点 AI（mock 网络流式到达）→ 断言该块 AI 可见
 *   3. 悬停同块 → 点 O 恢复原文 → 断言该块显示原文（容器隐藏机制）
 *   4. 悬停同块 → 再点 A → 断言该块显示 AI（#73：容器必须被解除隐藏）
 *   5. 页面级点 AI（本地切换，零请求）→ 断言全页块 AI 可见
 *
 * 断言层：L2 可见真相（读真实可见性，不读状态字段）—— #70 的教训是
 * L1（状态字段）oracle 对这种失真结构性假绿。这里读取 DOM 可见性 + 文本，
 * 与期望的「用户看到什么」直接比对。
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  waitForVisualStability,
  screenshotCheckpoint,
} from "./setup.mjs";

export const name = "cross-level-journey";
export const needsMock = true;
export const smoke = false;

const EXPECTED_AI_SNIPPET_FALLBACK = "[aimock]";

/** 读取单个块的可见真相：可见模式 + 可见文本（L2 oracle，页面内实现）。 */
async function readBlockTruth(page, blockIndex) {
  return page.evaluate((idx) => {
    const blocks = document.querySelectorAll("[data-dualtran-block]");
    const el = blocks[idx];
    if (!el) return { error: `no block at index ${idx} (total ${blocks.length})` };

    const isVisible = (node) => {
      if (!node) return false;
      let n = node;
      while (n && n.style) {
        if (n.style.display === "none" || n.style.visibility === "hidden") return false;
        n = n.parentElement;
      }
      return true;
    };

    const googleSpan = el.querySelector(".dualtran-google");
    const aiSpan = el.querySelector(".dualtran-ai, .dualtran-aitranslatedtext-replacemode");
    const containerVisible = isVisible(el);

    const googleVisible = !!googleSpan && isVisible(googleSpan) && !!googleSpan.textContent.trim();
    const aiVisible = !!aiSpan && isVisible(aiSpan) && !!aiSpan.textContent.trim();

    let visibleMode;
    let visibleText = "";
    if (!containerVisible) {
      visibleMode = "original";
    } else if (aiVisible) {
      visibleMode = "ai";
      visibleText = aiSpan.textContent.trim();
    } else if (googleVisible) {
      visibleMode = "google";
      visibleText = googleSpan.textContent.trim();
    } else {
      // 没有 span 可见。两种形态：
      //   - replaceOriginal：译文携带在容器的文本节点里。恢复原文后文本节点
      //     回到源语言 —— 只有与源文对比才能区分（oracle 在 jsdom 层拿到
      //     originalText 才能分类；页面内读取器无法拿到源文，因此报
      //     "node-carried" 让调用方决定）。
      //   - newLine：没有 span 可见 = 用户读到原文。
      visibleMode = googleSpan ? "original" : "node-carried";
      visibleText = (el.innerText || "").trim().slice(0, 120);
    }

    return {
      visibleMode,
      visibleText,
      containerDisplay: el.style.display || "(unset)",
      totalBlocks: blocks.length,
      hasGoogleSpan: !!googleSpan,
      hasAiSpan: !!aiSpan,
    };
  }, blockIndex);
}

/** 悬停一个块（冒泡 delegation 路径；优先 [data-dualtran-block]，#65 保真纪律）。 */
async function hoverBlock(page, blockIndex) {
  await page.evaluate((idx) => {
    const el = document.querySelectorAll("[data-dualtran-block]")[idx];
    if (!el) throw new Error(`hover: no block at index ${idx}`);
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }, blockIndex);
  await page.waitForTimeout(200);
}

/**
 * 点击按钮组的某个按钮，不重新悬停。
 *
 * O 恢复后 newLine 块是 display:none —— 真实指针无法再悬停它（#65 的保真
 * 教训：隐藏目标不可达）。真实用户路径是：指针停在按钮组上时组不会消失
 * （_onMouseover 进入组时取消隐藏定时器），因此 O → A 是同一组内的两次点击。
 * 本助手模拟这条真实路径：直接点组内按钮（组仍指向块 0）。
 */
async function clickGroupButtonWithoutHover(page, which) {
  const selector = {
    original: ".dualtran-original-btn",
    google: ".dualtran-google-btn",
    ai: ".dualtran-ai-btn",
  }[which];
  if (!selector) throw new Error(`clickGroupButtonWithoutHover: unknown button "${which}"`);
  const visible = await page.evaluate(() => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    return host?.style.top !== "-9999px";
  });
  if (!visible) throw new Error("button group not visible — cannot click without hover (group should persist while pointer is on it)");
  await page.evaluate((sel) => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    const btn = host?.shadowRoot?.querySelector(sel);
    if (!btn) throw new Error(`singleton button not found: ${sel}`);
    btn.click();
  }, selector);
}

/** 点悬停按钮组的某个按钮（shadow root 内）。 */
async function clickSingletonButton(page, which) {
  const selector = {
    original: ".dualtran-original-btn",
    google: ".dualtran-google-btn",
    ai: ".dualtran-ai-btn",
  }[which];
  if (!selector) throw new Error(`clickSingletonButton: unknown button "${which}"`);
  await page.evaluate((sel) => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    const btn = host?.shadowRoot?.querySelector(sel);
    if (!btn) throw new Error(`singleton button not found: ${sel}`);
    btn.click();
  }, selector);
}

/** 点页面级浮动按钮组的按钮。 */
async function clickFloatingButton(page, id) {
  await page.evaluate((btnId) => {
    const host = document.getElementById("dualtran-floating-btn-host");
    const btn = host?.shadowRoot?.getElementById(btnId);
    if (!btn) throw new Error(`floating button not found: ${btnId}`);
    btn.click();
  }, id);
}

/**
 * 断言悬停组 AI 按钮到达成功态后标签是纯 `AI`、无 ✓ 装饰（#83）。
 *
 * 为什么要先重悬停（2026-09-22 探针实测）：悬停组**不是活体绑定**——块级 AI
 * 到达写的是 `createSingletonBlockProxy` 的分离代理，真实按钮只在交互入口
 * （悬停/点击）经 `updateSingletonUI` 重渲染。实测时序：点 AI 后 15s 内按钮
 * class 一直不变（到达期间的重渲染发生在请求刚发出时，那时还是 queuing/
 * translating 态），而指针回到译文（复刻本报告的真实用户动作：点完 AI 回头
 * 读译文）触发一次 mouseover → success + 激活高亮立即落地。因此断言必须先
 * 模拟「指针回到译文」，否则等到超时也等不到这次重渲染（首版断言即栽在这）。
 *
 * 轮询重发 mouseover 的意图：到达完成前重渲染出的是 translating 态，完成后
 * 同一动作重渲染出 success——轮询让两种时序都能收敛，且最终读取的仍是
 * DOM 真相（按钮的实际形状），不是状态字段。
 *
 * @param {import("playwright").Page} page
 * @param {number} timeoutMs
 */
async function assertAiButtonSuccessLabelIsPlainAi(page, timeoutMs = 30000) {
  const start = Date.now();
  let landed = false;
  while (Date.now() - start < timeoutMs) {
    await hoverBlock(page, 0); // 指针回到译文 → showButtonGroup → updateSingletonUI
    landed = await page.evaluate(() => {
      const host = document.getElementById("dualtran-singleton-btn-host");
      const btn = host?.shadowRoot?.querySelector(".dualtran-ai-btn");
      return !!btn && btn.classList.contains("dualtran-ai-success");
    });
    if (landed) break;
    await page.waitForTimeout(250);
  }

  const r = await page.evaluate(() => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    const btn = host?.shadowRoot?.querySelector(".dualtran-ai-btn");
    if (!btn) return { missing: true };
    const label = btn.querySelector("span:not(.dualtran-ai-tooltip)");
    return {
      missing: false,
      isSuccess: btn.classList.contains("dualtran-ai-success"),
      labelText: (label?.textContent || "").trim(),
      hasGlyph: (btn.textContent || "").includes("\u2713"),
      checkSpans: btn.querySelectorAll(".dualtran-ai-success-check").length,
      childSpans: label ? label.children.length : -1,
    };
  });
  if (r.missing) throw new Error("#83 断言失败：悬停组 AI 按钮不存在");
  if (!r.isSuccess) {
    throw new Error(
      `#83 断言失败：AI 按钮在 ${timeoutMs}ms 内未到达成功态（到达未完成或状态未落地）— ${JSON.stringify(r)}`
    );
  }
  if (r.hasGlyph || r.checkSpans > 0 || r.labelText !== "AI" || r.childSpans !== 0) {
    throw new Error(
      `#83 断言失败：AI 按钮标签被装饰污染（应为纯 "AI"）— ${JSON.stringify(r)}`
    );
  }
}

/**
 * 配置扩展指向 Mock LLM 服务器（AI provider + key + apiBase）。
 *
 * 必需：hover AI 点击走 fetchAi → aiTranslateText；若 hasApiKey() 为 false，
 * resolver 返回 promptConfig（弹配置确认框、不发请求）—— 场景会静默卡住。
 * 既有 AI 场景（ai-nav-restore / dynamic-content-ai-translation）都自行配置。
 */
async function configureExtensionForAi(serviceWorker, mockServerConfig) {
  await serviceWorker.evaluate(async (apiBase) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguageTextTranslation: "fr",
      targetLanguages: ["fr", "en", "es"],
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      showFloatingBtn: "yes",
    });
  }, mockServerConfig.openRouterApiBase);
}

/** 等待块达到期望的可见模式（轮询，带超时）。 */
async function waitForBlockMode(page, blockIndex, expectedMode, timeoutMs = 45000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await readBlockTruth(page, blockIndex);
    if (last.visibleMode === expectedMode) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `block[${blockIndex}] did not reach visible mode "${expectedMode}" within ${timeoutMs}ms ` +
      `(last: ${JSON.stringify(last)})`
  );
}

async function runJourney(page, serviceWorker, mockServerConfig, mode, collector) {
  const expectedAiSnippet = mockServerConfig?.expectedAiSnippet || EXPECTED_AI_SNIPPET_FALLBACK;
  const label = `[cross-level/${mode}]`;

  try {
    // 显示模式
    await serviceWorker.evaluate(async (m) => {
      await chrome.storage.local.set({ whereToDisplayTranslatedText: m });
    }, mode);
    await page.waitForTimeout(300);

    // ── 步骤 1：页面级点 Google → 整页 Google 译文 ──
    console.log(`  ${label} Step 1: page-level Google click → Google translation`);
    await clickFloatingButton(page, "btnGoogle");
    await page.waitForFunction(
      () => document.querySelectorAll("[data-dualtran-block]").length > 0,
      null,
      { timeout: 20000 }
    );
    await page.waitForTimeout(800);

    const afterGoogle = await readBlockTruth(page, 0);
    if (afterGoogle.error) throw new Error(`${label} no blocks after Google: ${afterGoogle.error}`);
    if (afterGoogle.visibleMode !== "google" && afterGoogle.visibleMode !== "node-carried") {
      throw new Error(`${label} step1: block0 should show Google text, got ${JSON.stringify(afterGoogle)}`);
    }
    console.log(`  ${label} Step 1 PASSED: block0 visible=${afterGoogle.visibleMode}`);

    // ── 步骤 2：悬停块 0 → 点 A → AI 流式到达 → 断言 AI 可见（#70 场景）──
    console.log(`  ${label} Step 2: hover block0 → block-level AI click → AI must become VISIBLE (#70)`);
    await hoverBlock(page, 0);
    await clickSingletonButton(page, "ai");

    const afterArrival = await waitForBlockMode(page, 0, "ai", 45000);
    if (!afterArrival.visibleText.includes(expectedAiSnippet) && mode !== "replaceOriginal") {
      // newLine：aiSpan 携带 mock 译文
      throw new Error(
        `${label} step2: AI visible but text lacks mock snippet "${expectedAiSnippet}" — ${JSON.stringify(afterArrival)}`
      );
    }
    console.log(`  ${label} Step 2 PASSED: block0 visible=ai (the #70 assertion)`);

    // #83: the user-reported moment — hover block → click AI → arrival. The
    // AI button must be in its success state with a PLAIN "AI" label (the ✓
    // decoration was removed by user request). Asserted here because this is
    // the exact journey the report describes.
    await assertAiButtonSuccessLabelIsPlainAi(page);
    console.log(`  ${label} Step 2 PASSED: AI button label is a plain "AI" (no ✓ decoration, #83)`);

    // 静态 id（V1 lint 规则 4）：id 必须是字面量，才能与 visual-checks.mjs
    // 的声明双向匹配。
    if (mode === "newLine") {
      await screenshotCheckpoint(page, "cross-level-newline-after-hover-ai", { scenario: name });
    } else {
      await screenshotCheckpoint(page, "cross-level-replace-original-after-hover-ai", { scenario: name });
    }

    // ── 步骤 3：悬停块 0 → 点 O 恢复原文 ──
    console.log(`  ${label} Step 3: hover block0 → O click → original must be visible`);
    await hoverBlock(page, 0);
    await clickSingletonButton(page, "original");
    const afterRestore = await waitForBlockMode(page, 0, "original", 15000).catch(async (err) => {
      // replaceOriginal：恢复后译文从文本节点消失、AI span 隐藏，容器本身无
      // display 切换 —— 读取器报 "node-carried"。此时恢复的判据是「可见文本
      // 不再是 AI 译文」。newLine 则必须严格回到 "original"。
      const last = await readBlockTruth(page, 0);
      if (mode === "replaceOriginal" && last.visibleMode === "node-carried") {
        if ((last.visibleText || "").includes(expectedAiSnippet)) {
          throw new Error(
            `${label} step3: replaceOriginal restored but the AI text is still visible — ${JSON.stringify(last)}`
          );
        }
        return { ...last, visibleMode: "original" };
      }
      throw err;
    });
    if (afterRestore.visibleMode !== "original") {
      throw new Error(`${label} step3: expected original visible, got ${JSON.stringify(afterRestore)}`);
    }
    console.log(`  ${label} Step 3 PASSED: block0 visible=original (containerDisplay=${afterRestore.containerDisplay})`);

    // ── 步骤 4：同一按钮组内再点 A → 断言 AI 重新可见（#73 回归锚点）──
    // 真实可达路径：指针停在按钮组上，组持续展示；O 恢复后块本身 display:none，
    // 指针无法重新悬停它（#65 教训）。组内二次点击 = 真实用户路径。
    console.log(`  ${label} Step 4: A again from the same group → AI must become visible again (#73)`);
    await clickGroupButtonWithoutHover(page, "ai");
    const afterRoundTrip = await waitForBlockMode(page, 0, "ai", 30000);
    if (afterRoundTrip.visibleMode !== "ai") {
      throw new Error(
        `${label} step4 (#73): expected AI visible after O→A round trip, got ${JSON.stringify(afterRoundTrip)}`
      );
    }
    console.log(`  ${label} Step 4 PASSED: block0 visible=ai after O→A round trip (#73 held)`);

    // ── 步骤 5：页面级点 A → 全页块最终显示 AI（#73 的页面级路径）──
    // 语义（Q10a）：页面级 A 点击时只有已有 AI 结果的块走本地切换
    // （showAiOnly，零请求），其余块重新发起 AI 翻译 —— 因此需要等待整页
    // AI 完成，而不是瞬时断言。所有块最终都必须显示 AI（这正是 #73 的
    // 页面级路径：showAiOnly 对 O 恢复过的块也必须解除容器隐藏）。
    console.log(`  ${label} Step 5: page-level AI click → all blocks must eventually show AI`);
    await clickFloatingButton(page, "btnAi");

    const sweepStart = Date.now();
    let sweep = null;
    while (Date.now() - sweepStart < 90000) {
      sweep = await page.evaluate(() => {
        const blocks = document.querySelectorAll("[data-dualtran-block]");
        if (!blocks.length) return { total: 0, aiVisible: 0, modes: [] };
        const isVisible = (node) => {
          let n = node;
          while (n && n.style) {
            if (n.style.display === "none" || n.style.visibility === "hidden") return false;
            n = n.parentElement;
          }
          return true;
        };
        let aiVisible = 0;
        const modes = [];
        blocks.forEach((el) => {
          const aiSpan = el.querySelector(".dualtran-ai, .dualtran-aitranslatedtext-replacemode");
          const vis = isVisible(el) && !!aiSpan && isVisible(aiSpan) && !!aiSpan.textContent.trim();
          if (vis) aiVisible++;
          modes.push(vis ? "ai" : (isVisible(el) ? "other" : "hidden"));
        });
        return { total: blocks.length, aiVisible, modes };
      });
      if (sweep.total > 0 && sweep.aiVisible === sweep.total) break;
      await page.waitForTimeout(1000);
    }

    if (sweep.total > 0 && sweep.aiVisible !== sweep.total) {
      throw new Error(
        `${label} step5: after page-level AI switch, only ${sweep.aiVisible}/${sweep.total} blocks show AI — ` +
          `modes=${JSON.stringify(sweep.modes)}`
      );
    }
    console.log(`  ${label} Step 5 PASSED: ${sweep.aiVisible}/${sweep.total} blocks show AI`);

    await waitForVisualStability(page);
    if (mode === "newLine") {
      await screenshotCheckpoint(page, "cross-level-newline-final", { scenario: name });
    } else {
      await screenshotCheckpoint(page, "cross-level-replace-original-final", { scenario: name });
    }

    console.log(`  ${label} Cross-level journey PASSED`);
  } catch (err) {
    collector?.record?.(`cross-level-${mode}`, err.message);
    throw err;
  }
}

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, mockServerConfig, collector } = scope;

  console.log("┌──────────────────────────────────────────────────┐");
  console.log("│  cross-level-journey (#70/#73 regression anchor) │");
  console.log("└──────────────────────────────────────────────────┘");

  collector?.attachPage?.(page, "cross-level-journey");

  // AI provider/key/base 必须先配置：hover AI → fetchAi 需要 hasApiKey()=true，
  // 否则 resolver 走 promptConfig（确认框）而永不发请求。
  await configureExtensionForAi(serviceWorker, mockServerConfig);
  console.log("  Extension configured for mock AI (provider=openrouter, key=mock)");

  for (const mode of ["newLine", "replaceOriginal"]) {
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());
    await runJourney(page, serviceWorker, mockServerConfig, mode, collector);
  }

  console.log("\n  PASS: cross-level journey passed in both display modes");
}
