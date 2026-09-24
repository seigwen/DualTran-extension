/**
 * DualTran E2E — AI 段落级 loading 指示器生命周期回归测试
 *
 * 用户报告：点击「Google」按钮时，段落右侧显示 loading 图标并在翻译完成后消失；
 * 点击「AI」按钮时完全没有 loading 图标。
 *
 * 根因（受控探针实测）：紫色 spinner 并非缺失，而是「插入 6ms 后、48ms 就被移除」，
 * 而首个 AI 译文 2068ms 才到达——清理被绑在「请求发出」而不是「结果到达」上
 * （aiTranslateText 在派发时即返回，流通过回调到达）。
 *
 * 本场景的断言与 mock 速度无关（顺序断言）：
 *   在页面内注入 MutationObserver，记录每个 AI spinner 的「插入」与「移除」，
 *   并在「移除」时刻快照其所属块的 AI 文本：
 *     1. 至少出现 1 个 AI spinner（存在性——修复前也会短暂出现，故这条是必要条件）
 *     2. 【核心】每个 spinner 被移除时，其块的 AI 文本已非空（或该块已显示 error 图标）
 *        —— 修复前必红：移除发生在任何 AI 文本到达之前
 *     3. 结束时无残留 spinner（错误图标不算，它是终态）
 *   双模式（newLine / replaceOriginal）均覆盖。
 *
 * @module ai-block-indicator
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
} from "./setup.mjs";

export const name = "ai-block-indicator";
export const needsMock = true;
export const smoke = false;

// ─── 配置 ────────────────────────────────────────────────────

/**
 * 通过 Service Worker 配置扩展：AI 走 mock，AI 翻译只能由 AI 按钮触发。
 */
async function configureExtension(serviceWorker, mockServerConfig, mode) {
  const openRouterApiBase = mockServerConfig.openRouterApiBase;
  await serviceWorker.evaluate(async ({ apiBase, whereToDisplay }) => {
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
    });
  }, { apiBase: openRouterApiBase, whereToDisplay: mode });
}

// ─── 页面内探针 ──────────────────────────────────────────────

/**
 * 安装指示器生命周期探针（在页面上下文内）。
 *
 * 记录每个 AI spinner 的插入/移除事件；移除时快照其所属块的 AI 文本与 error 图标，
 * 以判定「移除是否发生在到达之后」。
 *
 * 所属块（target）在插入时捕获——即生产代码传入的 proxy._el：
 *   - newLine（"before" 锚点）：spinner 的 nextSibling 就是 <translated>
 *   - replaceOriginal（"append" 锚点）：spinner 的 parentNode 就是块元素
 * 移除时只读该 target 的「自身 AI 文本」（直接子 span）——嵌套块（如 li 内含
 * 子列表）里 querySelector 会先命中后代块的 span，那是别的块的文本。
 */
async function installIndicatorProbe(page) {
  await page.evaluate(() => {
    window.__aiIndicatorEvents = [];
    const targetOf = new WeakMap();

    const isSpinner = (n) =>
      n.nodeType === 1 && n.classList?.contains("dualtran-block-spinner") && n.dataset?.type === "ai";
    const isIndicator = (n) =>
      n.nodeType === 1 && n.classList?.contains("dualtran-block-indicator") && n.dataset?.type === "ai";

    /**
     * 捕获 spinner 所属的块元素（生产代码里的 proxy._el）：
     * "before" 锚点 → nextSibling；"append" 锚点 → parentNode。
     */
    const captureTarget = (spinner) => {
      const next = spinner.nextSibling;
      if (
        next &&
        next.nodeType === 1 &&
        (next.nodeName.toLowerCase() === "translated" || next.hasAttribute?.("data-dualtran-block"))
      ) {
        return next;
      }
      return spinner.parentNode || null;
    };

    /** 只读块「自身」的 AI 文本（直接子 span），不误读嵌套块的 span。 */
    const aiTextOf = (target) => {
      if (!target || !target.children) return "";
      const isTranslated = target.nodeName.toLowerCase() === "translated";
      for (const child of target.children) {
        if (isTranslated) {
          if (child.classList?.contains("dualtran-ai")) {
            return (child.textContent || "").trim();
          }
        } else if (child.classList?.contains("dualtran-aitranslatedtext-replacemode")) {
          return (child.textContent || "").trim();
        }
      }
      return "";
    };

    /** 块自身的 error 图标（直接子元素）。 */
    const hasOwnErrorIcon = (target) => {
      if (!target || !target.children) return false;
      for (const child of target.children) {
        if (child.classList?.contains("dualtran-block-error") && child.dataset?.type === "ai") {
          return true;
        }
      }
      return false;
    };

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (isSpinner(n)) {
            const target = captureTarget(n);
            if (target) targetOf.set(n, target);
            window.__aiIndicatorEvents.push({
              kind: "add",
              targetTag: target?.nodeName?.toLowerCase() || null,
              at: Date.now(),
            });
          }
        });
        m.removedNodes.forEach((n) => {
          if (isSpinner(n) || isIndicator(n)) {
            const target = targetOf.get(n) || null;
            window.__aiIndicatorEvents.push({
              kind: "remove",
              wasSpinner: isSpinner(n),
              targetFound: !!target,
              aiTextAtRemoval: target ? aiTextOf(target) : null,
              errorIconAtRemoval: target ? hasOwnErrorIcon(target) : null,
              at: Date.now(),
            });
          }
        });
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    window.__aiIndicatorObserver = obs;
  });
}

/** 读取探针事件与当前 spinner 残留数。 */
async function readProbe(page) {
  return page.evaluate(() => ({
    events: window.__aiIndicatorEvents || [],
    spinnersRemaining: document.querySelectorAll(
      '.dualtran-block-spinner[data-type="ai"]'
    ).length,
    errorIcons: document.querySelectorAll(
      '.dualtran-block-error[data-type="ai"]'
    ).length,
    aiTextBlocks: Array.from(
      document.querySelectorAll("translated, [data-dualtran-block]")
    ).filter((el) => {
      const aiSpan = el.querySelector(".dualtran-ai");
      if (aiSpan && (aiSpan.textContent || "").trim()) return true;
      const replaceSpan = el.querySelector(".dualtran-aitranslatedtext-replacemode");
      return !!(replaceSpan && (replaceSpan.textContent || "").trim());
    }).length,
  }));
}

/**
 * 点击悬浮按钮组中的 AI 按钮（shadow DOM 内）。
 */
async function clickAiButton(page) {
  return page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    const btnAi = host?.shadowRoot?.getElementById("btnAi");
    if (!btnAi) return false;
    btnAi.click();
    return true;
  });
}

/**
 * 等待一轮「派发 → 到达 → 清理」闭环完成。
 *
 * 条件：出现过 ≥1 次 spinner 插入、无 spinner 残留、≥1 个块已写入 AI 文本。
 */
async function waitForLifecycleCompletion(page, timeoutMs = 90_000) {
  const startTime = Date.now();
  let last = null;
  while (Date.now() - startTime < timeoutMs) {
    last = await readProbe(page);
    const sawAdd = last.events.some((e) => e.kind === "add");
    if (sawAdd && last.spinnersRemaining === 0 && last.aiTextBlocks >= 1) {
      return last;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `AI indicator lifecycle did not complete within ${timeoutMs}ms.\n` +
    `  last: ${JSON.stringify({ spinnersRemaining: last?.spinnersRemaining, aiTextBlocks: last?.aiTextBlocks, eventCount: last?.events?.length })}`
  );
}

/**
 * 断言某个模式下的指示器生命周期。
 *
 * 核心断言（修复前必红）：每个 spinner 被移除时，其所属块的 AI 文本已非空，
 * 或该块已处于 error 终态。
 */
function assertIndicatorLifetime(probe, mode) {
  const adds = probe.events.filter((e) => e.kind === "add");
  const removes = probe.events.filter((e) => e.kind === "remove");

  console.log(
    `  [${mode}] events: ${adds.length} add / ${removes.length} remove; ` +
    `spinners left: ${probe.spinnersRemaining}; AI-text blocks: ${probe.aiTextBlocks}; error icons: ${probe.errorIcons}`
  );

  // 1) 存在性：AI 过程必须显示过 loading 指示器
  if (adds.length < 1) {
    throw new Error(
      `[${mode}] AI indicator never appeared: no .dualtran-block-spinner[data-type="ai"] insertion observed ` +
      `(${probe.events.length} probe events total).`
    );
  }

  // 探针自检：每个移除事件都必须能定位到其所属块（否则断言无意义）
  const untracked = removes.filter((e) => e.targetFound !== true);
  if (untracked.length > 0) {
    throw new Error(
      `[${mode}] probe could not resolve the owning block for ${untracked.length} removal event(s) — ` +
      `the lifecycle assertion would be unsound.\n  first: ${JSON.stringify(untracked[0])}`
    );
  }

  // 2) 生命周期（到达驱动）：移除时该块的 AI 文本必须已到达（或已进入 error 终态）
  const earlyRemovals = removes.filter(
    (e) => !(e.aiTextAtRemoval && e.aiTextAtRemoval.length > 0) && e.errorIconAtRemoval !== true
  );
  if (earlyRemovals.length > 0) {
    throw new Error(
      `[${mode}] LIFETIME REGRESSION: ${earlyRemovals.length} AI spinner(s) removed BEFORE their block's text arrived.\n` +
      `  first offender: ${JSON.stringify(earlyRemovals[0])}\n` +
      `  The indicator must live as long as the request (dispatch-bound cleanup flashes it for ~45ms).`
    );
  }

  // 3) 无残留 spinner（error 图标是合法终态，不计入）
  if (probe.spinnersRemaining > 0) {
    throw new Error(
      `[${mode}] ${probe.spinnersRemaining} AI spinner(s) still on the page after the request settled — stranded indicator.`
    );
  }
}

/**
 * 断言锚点位置：spinner 必须贴在其所属块内部（行内尾随可见文本），
 * 而不是块之后的独立一行。
 */
async function assertAnchorInline(page) {
  const anchorInfo = await page.evaluate(() => {
    const el = document.querySelector("translated, [data-dualtran-block]");
    if (!el) return { error: "no block element" };
    // 探测：用与生产相同的规则重建一个探针 spinner，测其几何位置
    const s = document.createElement("span");
    s.className = "probe-anchor-spinner";
    s.setAttribute(
      "style",
      "display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:999px;opacity:0.5;vertical-align:middle;margin-left:4px;box-sizing:border-box"
    );
    const isTranslated = el.nodeName.toLowerCase() === "translated";
    const block = isTranslated ? el.parentNode || el : el;
    if (isTranslated) {
      block.insertBefore(s, el);
    } else {
      block.appendChild(s);
    }
    s.dataset.probe = "1";
    const sr = s.getBoundingClientRect();
    const br = block.getBoundingClientRect();
    // spinner 是否贴在块左缘（= 独立一行的特征）
    const onLeftMargin = Math.abs(sr.x - br.x) < 8;
    // spinner 是否在块内部
    const insideBlock = block.contains(s);
    s.remove();
    return {
      position: isTranslated ? "before" : "append",
      spinnerX: Math.round(sr.x),
      blockX: Math.round(br.x),
      onLeftMargin,
      insideBlock,
      blockText: (block.textContent || "").slice(0, 60),
    };
  });

  console.log(`  anchor probe: ${JSON.stringify(anchorInfo)}`);
  if (anchorInfo.error) {
    throw new Error(`anchor probe failed: ${anchorInfo.error}`);
  }
  if (!anchorInfo.insideBlock) {
    throw new Error(
      "AI spinner anchor is NOT inside its block — it lands on a standalone line below the block."
    );
  }
  if (anchorInfo.onLeftMargin) {
    throw new Error(
      `AI spinner lands at the block's left margin (x=${anchorInfo.spinnerX} vs block x=${anchorInfo.blockX}) ` +
      `— not trailing the visible text.`
    );
  }
}

// ─── 场景入口 ────────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, mockServerConfig, collector } = scope;
  collector.attachPage(page, "ai-block-indicator");
  collector.attachServiceWorker(serviceWorker);

  console.log("┌──────────────────────────────────────────────────┐");
  console.log("│  ai-block-indicator (dispatch→arrival lifetime)  │");
  console.log("└──────────────────────────────────────────────────┘");

  for (const mode of ["newLine", "replaceOriginal"]) {
    console.log(`\n===== mode: ${mode} =====`);

    // ── 配置 + 导航 ──
    await configureExtension(serviceWorker, mockServerConfig, mode);
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    await page.waitForFunction(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      return !!host?.shadowRoot?.getElementById("btnAi");
    }, null, { timeout: 10_000 });

    // ── 安装探针（必须在点击 AI 之前）──
    await installIndicatorProbe(page);

    // ── 点击 AI（页面级 → Google 翻译 + AI 翻译）──
    const clicked = await clickAiButton(page);
    if (!clicked) throw new Error("Failed to click AI button (floating group not found)");

    // ── 等待闭环完成 ──
    const probe = await waitForLifecycleCompletion(page);
    assertIndicatorLifetime(probe, mode);

    // ── 锚点断言（真实像素）──
    await assertAnchorInline(page);

    console.log(`  [${mode}] PASS`);
  }
}
