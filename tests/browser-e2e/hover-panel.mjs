/**
 * DualTran E2E — 悬停翻译框对齐划词框回归测试（plan 37）
 *
 * 用户需求（2026-09-30）：
 *   在设置页「在这些网站悬停显示译文」加入某网站后，悬停页面文字出现浮动翻译框；
 *   该框的样式与行为必须与划词翻译框一致（共享皮肤 + 共享状态实现）。
 *
 * 观测通道（与 selected-panel.mjs 同源）：closed shadow 经 CDP
 * `DOM.getDocument{pierce:true}` 穿透读取 + `DOM.resolveNode` +
 * `Runtime.callFunctionOn(this.click())` 合成点击；每次读取新鲜解析节点。
 *
 * 断言设计（哨兵色，不用默认字面量——#94 纪律）：
 *   A. hover 段落 → 框出现（host 计数 + pierce 读 #eDivResult 可见）且译文区为
 *      共享 loading 面（spinner + label）。确定性窗口：SW fetch 对
 *      translate.googleapis.com 注入 1800ms 延迟，保证「框先于译文出现」可观测
 *      （旧代码框延迟到译文到达才出现 → 本相位 RED）。
 *   B. Google 到达 → 译文非空 + computed 色 = 哨兵 translatedColor；
 *      部件齐备（标题栏 / 复制 / 「+」下拉 / 朗读）；G 激活实心蓝 / A 非激活浅紫；
 *      标签恒定（Google / AI），零装饰。
 *   C. CDP 点击 AI → 高亮翻转（AI 紫 / G 浅蓝）；aimock 译文进译文框（含 mock 标记）；
 *      色 = AI 哨兵；标签恒定、无 ✓/✕。
 *   D. 切回 Google → 色归位哨兵（跨引擎泄漏格）；标签恒定。
 *   E. 单词路由（Q-H1）：hover 单词「hello」→ AI 走单词路径（mock /request-log 按
 *      assistant 引导语 "…the word." 计数 ≥1）；多词段落 → AI 走文本路径
 *      （"…the text." 计数 ≥1）——正反两格。
 *
 * mode-symmetry-allow: 悬停浮动框为自有布局（不替换/插入页面文本），与
 * whereToDisplayTranslatedText 双模式语义无关——与 selected-panel.mjs 同豁免口径。
 *
 * @module hover-panel
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
} from "./setup.mjs";

export const name = "hover-panel";
export const needsMock = true;
export const smoke = false;

// ─── 哨兵色与色板规格（与 selected-panel.mjs 同组）────────────

const GOOGLE_SENTINEL_INLINE = "#123456";
const AI_SENTINEL_INLINE = "#654321";
const GOOGLE_SENTINEL_RGB = "rgb(18, 52, 86)";
const AI_SENTINEL_RGB = "rgb(101, 67, 33)";

const GOOGLE_ACTIVE = { bg: "rgb(29, 78, 216)", color: "rgb(255, 255, 255)", border: "rgb(29, 78, 216)" };
const GOOGLE_INACTIVE = { bg: "rgb(239, 246, 255)", color: "rgb(29, 78, 216)", border: "rgb(191, 219, 254)" };
const AI_ACTIVE = { bg: "rgb(124, 58, 237)", color: "rgb(255, 255, 255)", border: "rgb(124, 58, 237)" };
const AI_INACTIVE = { bg: "rgb(245, 243, 255)", color: "rgb(124, 58, 237)", border: "rgb(221, 214, 254)" };

/**
 * 通过 Service Worker 配置扩展：悬停场景专用存储。
 * AI 走 aimock（确定性 mock 标记）；Google 走真实网络（与 selected-panel 同依赖）。
 */
async function configureExtension(serviceWorker, mockServerConfig, hostname) {
  const openRouterApiBase = mockServerConfig.openRouterApiBase;
  await serviceWorker.evaluate(async ({ apiBase, google, ai, host }) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguages: ["fr", "en", "es"],
      targetLanguageTextTranslation: "fr",
      textTranslatorService: "google",
      translatedColor: google,
      aiTranslatedColor: ai,
      darkMode: "no",
      sitesToTranslateWhenHovering: [host],
      langsToTranslateWhenHovering: [],
      translateTextOverMouseWhenPressTwice: "no",
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      neverTranslateLangs: [],
      neverTranslateSites: [],
      alwaysTranslateSites: [],
      alwaysTranslateLangs: [],
    });
  }, { apiBase: openRouterApiBase, google: GOOGLE_SENTINEL_INLINE, ai: AI_SENTINEL_INLINE, host: hostname });
}

// ─── CDP 通道（closed shadow 穿透 + 合成点击 + 每次新鲜解析） ──

/** 快照元素 computed 状态（closed shadow 穿透读取）。 */
const READ_STATE_FN = `function() {
  const cs = getComputedStyle(this);
  return {
    text: (this.textContent || "").trim(),
    color: cs.color,
    bg: cs.backgroundColor,
    border: cs.borderTopColor,
    html: this.innerHTML.slice(0, 400),
    display: cs.display,
  };
}`;

/** 新鲜解析：每次调用重新穿透 DOM，返回 id → backendNodeId 映射。 */
async function findPanelNodes(cdp, ids) {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const hits = {};
  (function walk(node) {
    const attrs = {};
    for (let i = 0; i < (node.attributes || []).length; i += 2) {
      attrs[node.attributes[i]] = node.attributes[i + 1];
    }
    if (attrs.id && ids.includes(attrs.id)) {
      hits[attrs.id] = node.backendNodeId;
    }
    for (const c of node.children || []) walk(c);
    for (const sr of node.shadowRoots || []) walk(sr);
  })(root);
  return hits;
}

/** 新鲜读取某元素状态；元素不在树中 = 硬失败。 */
async function freshRead(cdp, id) {
  const hits = await findPanelNodes(cdp, [id]);
  if (!hits[id]) {
    throw new Error(`悬停框节点 ${id} 不在 DOM 树中（closed shadow 穿透失败）`);
  }
  const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: hits[id] });
  const res = await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: READ_STATE_FN,
    returnByValue: true,
  });
  return res.result.value;
}

/** 新鲜合成点击（页面主世界派发 → 内容脚本监听器照常触发）。 */
async function freshClick(cdp, id) {
  const hits = await findPanelNodes(cdp, [id]);
  if (!hits[id]) {
    throw new Error(`悬停框节点 ${id} 不在 DOM 树中，无法点击`);
  }
  const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: hits[id] });
  await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: `function() { this.click(); return "clicked"; }`,
    returnByValue: true,
  });
}

/**
 * 轮询等待（每次读取都新鲜解析节点）。
 * 「节点尚未存在」视作「还没到」继续轮询；超时 = 硬失败（含最后快照）。
 */
async function waitForFresh(cdp, id, predicate, timeoutMs, label) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    const hits = await findPanelNodes(cdp, [id]);
    if (hits[id]) {
      const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: hits[id] });
      const res = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: READ_STATE_FN,
        returnByValue: true,
      });
      last = res.result.value;
      if (predicate(last)) return last;
    } else {
      last = null;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `${label}: ${timeoutMs}ms 超时。最后快照: ${last === null ? "节点不在树中" : JSON.stringify(last)}`
  );
}

/** 断言按钮色板规格（bg / 字色 / 描边三件套）。 */
function assertButtonSpec(snapshot, spec, label) {
  if (snapshot.bg !== spec.bg) {
    throw new Error(`${label} 底色应为 ${spec.bg}，实为 ${snapshot.bg}`);
  }
  if (snapshot.color !== spec.color) {
    throw new Error(`${label} 字色应为 ${spec.color}，实为 ${snapshot.color}`);
  }
  if (snapshot.border !== spec.border) {
    throw new Error(`${label} 描边色应为 ${spec.border}，实为 ${snapshot.border}`);
  }
}

/** 断言按钮无任何状态装饰（意图模型：纯标签）。 */
function assertNoDecoration(snapshot, expectedLabel) {
  if (snapshot.text !== expectedLabel) {
    throw new Error(`按钮标签应恒为 ${JSON.stringify(expectedLabel)}，实为 ${JSON.stringify(snapshot.text)}`);
  }
  if (snapshot.html.includes("✓") || snapshot.html.includes("✕")) {
    throw new Error(`按钮 HTML 不得含 ✓/✕ 状态装饰: ${snapshot.html}`);
  }
}

// ─── mock 请求日志通道（相位 E：单词 / 文本路径请求计数） ──

/** mock 服务器根 URL（去掉 provider 路径段）。 */
function mockBase(scope) {
  return scope.mockServerConfig.openRouterApiBase.replace(/\/openrouter\/v1$/, "");
}

async function fetchRequestLog(scope) {
  const resp = await fetch(`${mockBase(scope)}/request-log`);
  if (!resp.ok) throw new Error(`[hover-panel] /request-log 读取失败: HTTP ${resp.status}`);
  const payload = await resp.json();
  return Array.isArray(payload?.requests) ? payload.requests : [];
}

async function resetRequestLog(scope) {
  const resp = await fetch(`${mockBase(scope)}/request-log/reset`, { method: "POST" });
  if (!resp.ok) throw new Error(`[hover-panel] /request-log/reset 失败: HTTP ${resp.status}`);
}

/** 解析请求日志中的 chat/completions 请求体。 */
function chatBodies(requests) {
  return requests
    .filter((r) => r.method === "POST" && /chat\/completions/.test(r.pathname || ""))
    .map((r) => {
      if (r.body && typeof r.body === "object") return r.body;
      try { return JSON.parse(r.body); } catch { return null; }
    })
    .filter(Boolean);
}

/** 按第二条消息（assistant 引导语）过滤请求——单词路径 / 文本路径的唯一区分标记。 */
function countByAssistantNeedle(requests, needle) {
  return chatBodies(requests).filter((b) => {
    const assistant = Array.isArray(b.messages) ? b.messages[1] : null;
    return assistant && assistant.role === "assistant" && assistant.content === needle;
  }).length;
}

const WORD_PATH_NEEDLE = "I understand. Please give me the word.";
const TEXT_PATH_NEEDLE = "I understand. Please give me the text.";

/** 页面文本到达谓词：非空、非 loading、非 AI mock 文本。 */
function isSettledGoogleText(snapshot, aiSnippet) {
  return snapshot.text.length > 0
    && !snapshot.text.includes("Loading")
    && !snapshot.text.includes(aiSnippet);
}

/** 等悬停框宿主出现（div.notranslate 且无 id —— 与 singleton 宿主区分）。 */
async function waitForHoverHost(page, timeoutMs = 10000) {
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("div.notranslate:not([id])").length > 0,
      null,
      { timeout: timeoutMs, polling: "raf" }
    );
  } catch (err) {
    throw new Error(`悬停框宿主未出现（${timeoutMs}ms）：${err.message}`);
  }
}

// ─── 场景主流程 ──────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, mockServerConfig } = scope;
  const aiSnippet = mockServerConfig.expectedAiSnippet;
  const hostname = new URL(testPageUrl).hostname;

  await configureExtension(serviceWorker, mockServerConfig, hostname);

  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await page.waitForTimeout(1500);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");

  // ─── 确定性 loading 窗口：SW fetch 对 Google 端点注入 1800ms 延迟 ──
  // hover 触发后 1250ms 框出现（此时请求刚发出且被挂起）→ loading 面必然可观测。
  await serviceWorker.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.__hoverPanelOriginalFetch = originalFetch;
    globalThis.fetch = async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : (args[0]?.url || "");
      if (url.includes("translate.googleapis.com")) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
      }
      return originalFetch.call(globalThis, ...args);
    };
  });

  try {
    // ═══ 相位 A：hover 段落 → 框先于译文出现，且译文区为共享 loading 面 ═══
    {
      const baselineHosts = await page.evaluate(
        () => document.querySelectorAll("div.notranslate:not([id])").length
      );
      await page.hover("p#paragraph-1", { timeout: 5000 });
      await waitForHoverHost(page, 10000);

      const hostsAfter = await page.evaluate(
        () => document.querySelectorAll("div.notranslate:not([id])").length
      );
      if (!(hostsAfter > baselineHosts)) {
        throw new Error(`[A] hover 后悬停框宿主计数未增长（${baselineHosts} → ${hostsAfter}）`);
      }

      const panel = await waitForFresh(cdp, "eDivResult", () => true, 3000, "悬停框容器快照");
      if (panel.display !== "block") {
        throw new Error(`[A] 悬停框应已可见（display:block），实为 ${JSON.stringify(panel.display)}`);
      }

      const trans = await waitForFresh(cdp, "eSelTextTrans", () => true, 3000, "悬停框译文区快照");
      if (!trans.html.includes("dualtran-loading-spinner") || !trans.html.includes("dualtran-loading-label")) {
        throw new Error(
          `[A] 框出现时应显示共享 loading 面（spinner + label，且发生在译文到达之前），实为: ${trans.html}`
        );
      }
      console.log("  [A] hover → 框先出现 + 共享 loading 面（spinner + label）✓");
    }

    // ═══ 相位 B：Google 到达 → 哨兵色 + 部件齐备 + 色板 + 标签恒定 ═══
    {
      const landed = await waitForFresh(
        cdp,
        "eSelTextTrans",
        (s) => isSettledGoogleText(s, aiSnippet) && s.color === GOOGLE_SENTINEL_RGB,
        30000,
        "Google 译文到达（文本 + 哨兵色）"
      );
      console.log(`  [B1] Google 译文进框且 computed 色 = 哨兵 translatedColor；文本: ${JSON.stringify(landed.text.slice(0, 60))} ✓`);

      // 部件齐备：标题栏 / 复制 / 「+」下拉 / 朗读（与划词同词汇）
      const drag = await freshRead(cdp, "drag");
      if (drag.text !== "DualTran") {
        throw new Error(`[B2] 标题栏文本应为 "DualTran"，实为 ${JSON.stringify(drag.text)}`);
      }
      for (const id of ["copy", "btnMoreTargetLang", "listenTranslated"]) {
        const node = await freshRead(cdp, id);
        if (id === "btnMoreTargetLang" && node.text !== "+") {
          throw new Error(`[B2] 「+」下拉按钮文本应为 "+"，实为 ${JSON.stringify(node.text)}`);
        }
      }
      console.log("  [B2] 部件齐备：标题栏 DualTran / 复制 / 「+」下拉 / 朗读 ✓");

      // 引擎色板：G 激活实心蓝 / A 非激活浅紫；标签恒定
      const google = await waitForFresh(
        cdp,
        "sGoogle",
        (s) => s.bg === GOOGLE_ACTIVE.bg,
        5000,
        "Google 激活态"
      );
      assertButtonSpec(google, GOOGLE_ACTIVE, "Google 激活态");
      const ai = await freshRead(cdp, "sOpenAI");
      assertButtonSpec(ai, AI_INACTIVE, "AI 非激活态");
      assertNoDecoration(google, "Google");
      const aiLabel = await freshRead(cdp, "btnAiTxtNode");
      if (aiLabel.text !== "AI") {
        throw new Error(`[B3] AI 按钮标签应恒为 "AI"，实为 ${JSON.stringify(aiLabel.text)}`);
      }
      console.log("  [B3] G 激活实心蓝 / A 非激活浅紫；标签恒定（Google / AI）、零装饰 ✓");
    }

    // ═══ 相位 C：CDP 点击 AI → 高亮翻转 + aimock 到达 + AI 哨兵色 ═══
    await freshClick(cdp, "sOpenAI");
    {
      const ai = await waitForFresh(
        cdp,
        "sOpenAI",
        (s) => s.bg === AI_ACTIVE.bg,
        5000,
        "点击 AI 后 AI 激活态"
      );
      assertButtonSpec(ai, AI_ACTIVE, "AI 激活态");
      const google = await freshRead(cdp, "sGoogle");
      assertButtonSpec(google, GOOGLE_INACTIVE, "Google 非激活态");
      assertNoDecoration(ai, "AI");

      const landed = await waitForFresh(
        cdp,
        "eSelTextTrans",
        (s) => s.text.includes(aiSnippet) && s.color === AI_SENTINEL_RGB,
        30000,
        "AI 译文到达译文框（含 mock 标记 + 哨兵色）"
      );
      console.log(`  [C] 点击 AI = 高亮翻转（AI 紫 / G 浅蓝）；AI 译文进框（含 "${aiSnippet}"）+ 哨兵 aiTranslatedColor；标签恒定 ✓`);

      // 流收尾稳定（tagged-echo 流很快；settle 后复读确认无装饰）
      await page.waitForTimeout(500);
      const aiFinal = await freshRead(cdp, "sOpenAI");
      assertNoDecoration(aiFinal, "AI");
      void landed;
    }

    // ═══ 相位 D：切回 Google → 色归位（跨引擎泄漏格） ═══
    await freshClick(cdp, "sGoogle");
    {
      const google = await waitForFresh(
        cdp,
        "sGoogle",
        (s) => s.bg === GOOGLE_ACTIVE.bg,
        5000,
        "点击 Google 后 Google 激活态"
      );
      assertButtonSpec(google, GOOGLE_ACTIVE, "Google 激活态");
      const ai = await freshRead(cdp, "sOpenAI");
      assertButtonSpec(ai, AI_INACTIVE, "AI 非激活态");
      assertNoDecoration(google, "Google");

      const landed = await waitForFresh(
        cdp,
        "eSelTextTrans",
        (s) => isSettledGoogleText(s, aiSnippet) && s.color === GOOGLE_SENTINEL_RGB,
        30000,
        "Google 重译（文本 + 哨兵色归位）"
      );
      console.log(`  [D] 切回 Google = 译文色归位哨兵 translatedColor（无残留泄漏）；文本: ${JSON.stringify(landed.text.slice(0, 60))} ✓`);
    }

    // ═══ 相位 E：单词路由（Q-H1）——单词走词典路径，多词走文本路径 ═══
    await resetRequestLog(scope);
    {
      // E1: hover 单词「hello」→ AI 点击必须发出单词路径请求
      await page.hover("#selection-word", { timeout: 5000 });
      await waitForHoverHost(page, 10000);
      await waitForFresh(
        cdp,
        "eSelTextTrans",
        (s) => isSettledGoogleText(s, aiSnippet),
        30000,
        "单词 Google 译文落定"
      );

      await freshClick(cdp, "sOpenAI");
      const deadline = Date.now() + 15000;
      let wordCount = 0;
      while (Date.now() < deadline) {
        const log = await fetchRequestLog(scope);
        wordCount = countByAssistantNeedle(log, WORD_PATH_NEEDLE);
        if (wordCount >= 1) break;
        await page.waitForTimeout(250);
      }
      if (wordCount < 1) {
        throw new Error("[E1] 悬停单词点击 AI 应发出 ≥1 个单词路径请求（词典路径），实为 0");
      }
      const logAfterWord = await fetchRequestLog(scope);
      const textWhileWord = countByAssistantNeedle(logAfterWord, TEXT_PATH_NEEDLE);
      if (textWhileWord !== 0) {
        throw new Error(`[E1] 单词悬停点击 AI 不得发出文本路径请求，实为 ${textWhileWord}`);
      }
      console.log("  [E1] 单词悬停 → AI = 单词路径请求（词典），零文本路径请求 ✓");

      // E2: hover 多词段落 → AI 点击走文本路径（负向对照）。
      // 注意用 paragraph-2（paragraph-1 的 AI 结果已在相位 C 进 aiCache——
      // 二次点击命中缓存是合法零请求，见 selected-panel 相位 F）。
      await resetRequestLog(scope);
      await page.hover("p#paragraph-2", { timeout: 5000 });
      await waitForHoverHost(page, 10000);
      await waitForFresh(
        cdp,
        "eSelTextTrans",
        (s) => isSettledGoogleText(s, aiSnippet),
        30000,
        "段落 Google 译文落定（E2）"
      );

      await freshClick(cdp, "sOpenAI");
      const deadline2 = Date.now() + 15000;
      let textCount = 0;
      while (Date.now() < deadline2) {
        const log = await fetchRequestLog(scope);
        textCount = countByAssistantNeedle(log, TEXT_PATH_NEEDLE);
        if (textCount >= 1) break;
        await page.waitForTimeout(250);
      }
      if (textCount < 1) {
        throw new Error("[E2] 悬停多词段落点击 AI 应发出 ≥1 个文本路径请求，实为 0");
      }
      console.log("  [E2] 多词段落悬停 → AI = 文本路径请求（负向对照）✓");

      // 等 AI 到达收尾（保持场景干净）
      await waitForFresh(
        cdp,
        "eSelTextTrans",
        (s) => s.text.includes(aiSnippet),
        20000,
        "段落 AI 译文到达（E2 收尾）"
      );
    }
  } finally {
    // 恢复 SW fetch（无论成败——不得把延迟泄漏给后续场景）
    await serviceWorker
      .evaluate(() => {
        if (globalThis.__hoverPanelOriginalFetch) {
          globalThis.fetch = globalThis.__hoverPanelOriginalFetch;
          delete globalThis.__hoverPanelOriginalFetch;
        }
      })
      .catch(() => {});
  }
}
