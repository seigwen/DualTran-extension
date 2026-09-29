/**
 * DualTran E2E — 划词翻译面板意图化 + 译文颜色回归测试（plan 31 / #106）
 *
 * 用户需求（2026-09-28）：
 *   1. 面板译文颜色遵守 options「样式」子页的 translatedColor / aiTranslatedColor；
 *   2. 底栏 Google / AI 按钮 = 悬浮组同款色板（Google 蓝 #1d4ed8 / AI 紫 #7c3aed）；
 *   3. 按钮文字恒为 "Google" / "AI"，任何状态不变；
 *   4. 按钮仅表意图——点击只切换高亮；状态（loading/译文/错误）永远在译文元素里。
 *
 * 观测通道（closed shadow）：CDP `DOM.getDocument{pierce:true}` 穿透读取 +
 * `DOM.resolveNode` + `Runtime.callFunctionOn(this.click())` 合成点击。均经探针实测。
 *
 * 关键流程决策（探针实测，2026-09-28）：
 *   `mouseup` 会在 +150ms 触发 onUp → init() 重建面板（仅为了显示选区图标），
 *   而 `TranslateSelectedText` 消息路径的翻译会落在重建前的旧面板上——旧面板
 *   随后被销毁，新面板永远没有译文（探针实锤：backendNodeId 172→1116，旧节点
 *   detached 但持有正确哨兵色的译文）。因此本场景走**真实用户流**：
 *   选中 → 等图标出现 → CDP 点击图标 → 面板翻译进最终存活的面板；
 *   且每次读取都**重新解析** backendNodeId（重建后 id 失效，缓存 = 读幽灵节点）。
 *
 * 断言设计（可机械断言优先；哨兵色，不用默认字面量——#94 纪律）：
 *   A. 打开面板 → Google 激活实心蓝 / AI 非激活浅紫（bg+字色+描边）；标签恒定；
 *      Google 译文到达译文框，computed 色 = translatedColor 哨兵（需求 1 Google 侧）
 *   B. CDP 点击 AI → 高亮翻转（AI 紫 / Google 浅蓝）；标签恒定、无 ✓/✕ 装饰（需求 4）
 *   C. aimock AI 译文进译文框（含 mock 标记；状态在译文元素）；色 = AI 哨兵（需求 1 AI 侧）
 *   D. 切回 Google → 译文色归位 Google 哨兵（跨引擎泄漏格）；标签恒定、无装饰
 *   E. 单词路径缓存解耦（plan 33）：选中单个单词连点两次 AI，两次都必须发出真实请求
 *      （旧代码第二次命中 aiCache 直接 0 请求——本相位即 RED 判别格）；请求计数经 mock
 *      /request-log 按 assistant 引导语（"…the word."）过滤，与文本路径严格区分
 *   F. 负向对照：句子二次点击仍命中内存缓存（零文本路径请求）——证明本次改动未波及
 *      文本路径的缓存复用（该相位在旧/新代码下均应为 GREEN）
 *
 * mode-symmetry-allow: 划词面板为自有布局，不使用 whereToDisplayTranslatedText
 * 双模式语义（面板译文永远单独显示，颜色无条件应用，plan 31 §2.1 Q1 决策）。
 *
 * @module selected-panel
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
} from "./setup.mjs";

export const name = "selected-panel";
export const needsMock = true;
export const smoke = false;

// ─── 哨兵色与色板规格 ────────────────────────────────────────

/** 场景哨兵色（不用默认字面量——默认色一变即静默失明，见 #94 纪律）。 */
const GOOGLE_SENTINEL_INLINE = "#123456";
const AI_SENTINEL_INLINE = "#654321";
const GOOGLE_SENTINEL_RGB = "rgb(18, 52, 86)";
const AI_SENTINEL_RGB = "rgb(101, 67, 33)";

const GOOGLE_ACTIVE = { bg: "rgb(29, 78, 216)", color: "rgb(255, 255, 255)", border: "rgb(29, 78, 216)" };
const GOOGLE_INACTIVE = { bg: "rgb(239, 246, 255)", color: "rgb(29, 78, 216)", border: "rgb(191, 219, 254)" };
const AI_ACTIVE = { bg: "rgb(124, 58, 237)", color: "rgb(255, 255, 255)", border: "rgb(124, 58, 237)" };
const AI_INACTIVE = { bg: "rgb(245, 243, 255)", color: "rgb(124, 58, 237)", border: "rgb(221, 214, 254)" };

const PANEL_IDS = ["sGoogle", "sOpenAI", "btnAiTxtNode", "eSelTextTrans", "eButtonTransSelText"];

/**
 * 通过 Service Worker 配置扩展：面板场景专用存储。
 * AI 走 aimock（确定性 mock 标记）；Google 走真实网络（translation.mjs 同依赖）。
 */
async function configureExtension(serviceWorker, mockServerConfig) {
  const openRouterApiBase = mockServerConfig.openRouterApiBase;
  await serviceWorker.evaluate(async ({ apiBase, google, ai }) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguages: ["fr", "en", "es"],
      targetLanguageTextTranslation: "fr",
      textTranslatorService: "google",
      translatedColor: google,
      aiTranslatedColor: ai,
      darkMode: "no",
      showTranslateSelectedButton: "yes",
      expandPanelTranslateSelectedText: "yes",
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      neverTranslateLangs: [],
      neverTranslateSites: [],
      alwaysTranslateSites: [],
      alwaysTranslateLangs: [],
    });
  }, { apiBase: openRouterApiBase, google: GOOGLE_SENTINEL_INLINE, ai: AI_SENTINEL_INLINE });
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
    html: this.innerHTML.slice(0, 300),
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
    throw new Error(`面板节点 ${id} 不在 DOM 树中（closed shadow 穿透失败）`);
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
    throw new Error(`面板节点 ${id} 不在 DOM 树中，无法点击`);
  }
  const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: hits[id] });
  await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: `function() { this.click(); return "clicked"; }`,
    returnByValue: true,
  });
}

/**
 * 轮询等待（每次读取都新鲜解析节点——面板重建后旧 backendNodeId 失效）。
 * 「节点尚未存在」视作「还没到」继续轮询（如选区图标在 init 后才创建）；
 * 超时 = 硬失败（含最后快照或 absent 状态，便于取证）。
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

/** 断言按钮无任何状态装饰（需求 3+4：纯标签）。 */
function assertNoDecoration(snapshot, expectedLabel) {
  if (snapshot.text !== expectedLabel) {
    throw new Error(`按钮标签应恒为 ${JSON.stringify(expectedLabel)}，实为 ${JSON.stringify(snapshot.text)}`);
  }
  if (snapshot.html.includes("✓") || snapshot.html.includes("✕")) {
    throw new Error(`按钮 HTML 不得含 ✓/✕ 状态装饰: ${snapshot.html}`);
  }
}

// ─── mock 请求日志通道（阶段 E/F：单词路径请求计数；先例 reasoning-depth.mjs） ──

/** mock 服务器根 URL（去掉 provider 路径段）。 */
function mockBase(scope) {
  return scope.mockServerConfig.openRouterApiBase.replace(/\/openrouter\/v1$/, "");
}

async function fetchRequestLog(scope) {
  const resp = await fetch(`${mockBase(scope)}/request-log`);
  if (!resp.ok) throw new Error(`[selected-panel] /request-log 读取失败: HTTP ${resp.status}`);
  const payload = await resp.json();
  return Array.isArray(payload?.requests) ? payload.requests : [];
}

async function resetRequestLog(scope) {
  const resp = await fetch(`${mockBase(scope)}/request-log/reset`, { method: "POST" });
  if (!resp.ok) throw new Error(`[selected-panel] /request-log/reset 失败: HTTP ${resp.status}`);
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

/** 单词路径的确定性 mock 响应（fixture #8："hello" → "aimock mock result"）。 */
const WORD_AI_SNIPPET = "aimock mock result";

/** 页面文本到达谓词：非空、非 loading、非 AI mock 文本。 */
function isSettledGoogleText(snapshot, aiSnippet) {
  return snapshot.text.length > 0
    && !snapshot.text.includes("Loading")
    && !snapshot.text.includes(aiSnippet);
}

// ─── 场景主流程 ──────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, mockServerConfig } = scope;
  const aiSnippet = mockServerConfig.expectedAiSnippet;

  await configureExtension(serviceWorker, mockServerConfig);

  // 1) 导航 + 选中文本（mouseup 触发 onUp → +150ms 显示选区图标）
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const element = document.getElementById("selection-target");
    if (!element) throw new Error("selection-target not found");
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200, clientY: 260 }));
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");

  // 2) 等选区图标出现（onUp 的 init 重建完成），然后 CDP 点击图标 → 真实用户流：
  //    onClick → translateSelText → 最终存活面板 + 翻译请求
  await waitForFresh(
    cdp,
    "eButtonTransSelText",
    (s) => s.display === "block",
    10000,
    "选区图标出现"
  );
  await freshClick(cdp, "eButtonTransSelText");

  // 3) 阶段 A：打开面板 → 色板 + 标签恒定 + Google 译文哨兵色
  {
    const google = await waitForFresh(
      cdp,
      "sGoogle",
      (s) => s.bg === GOOGLE_ACTIVE.bg,
      10000,
      "面板打开后的 Google 激活态"
    );
    assertButtonSpec(google, GOOGLE_ACTIVE, "Google 激活态");
    const ai = await freshRead(cdp, "sOpenAI");
    assertButtonSpec(ai, AI_INACTIVE, "AI 非激活态");
    assertNoDecoration(google, "Google");

    const aiLabel = await freshRead(cdp, "btnAiTxtNode");
    if (aiLabel.text !== "AI") {
      throw new Error(`AI 按钮标签应恒为 "AI"，实为 ${JSON.stringify(aiLabel.text)}`);
    }
    console.log("  [A1] 面板打开 = Google 激活实心蓝 / AI 非激活浅紫；标签恒定 ✓");

    const landed = await waitForFresh(
      cdp,
      "eSelTextTrans",
      (s) => isSettledGoogleText(s, aiSnippet) && s.color === GOOGLE_SENTINEL_RGB,
      30000,
      "初始 Google 译文（文本 + 哨兵色）"
    );
    console.log(`  [A2] Google 译文框到达且 computed 色 = 哨兵 translatedColor；文本: ${JSON.stringify(landed.text.slice(0, 60))} ✓`);
  }

  // 4) 阶段 B：CDP 点击 AI → 高亮翻转（需求 4：只切换高亮，零状态装饰）
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
    console.log("  [B] 点击 AI = 高亮翻转（AI 激活紫 / Google 浅蓝）；标签恒定、无 ✓/✕ ✓");
  }

  // 5) 阶段 C：aimock AI 译文到达译文框（状态在译文元素）；色 = AI 哨兵
  {
    const landed = await waitForFresh(
      cdp,
      "eSelTextTrans",
      (s) => s.text.includes(aiSnippet),
      30000,
      "AI 译文到达译文框"
    );
    console.log(`  [C1] AI 译文进译文框（含 "${aiSnippet}"）: ${JSON.stringify(landed.text.slice(0, 60))} ✓`);

    await waitForFresh(
      cdp,
      "eSelTextTrans",
      (s) => s.color === AI_SENTINEL_RGB,
      10000,
      "AI 译文哨兵色"
    );
    console.log("  [C2] AI 译文框 computed 色 = 哨兵 aiTranslatedColor ✓");

    // 运行中标签仍恒定（流已结束，但按钮从未被写状态）
    const aiRunning = await freshRead(cdp, "sOpenAI");
    assertNoDecoration(aiRunning, "AI");
  }

  // 6) 阶段 D：切回 Google → 译文色归位（跨引擎泄漏格：AI 色不得残留）
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
    console.log(`  [D] 切回 Google = 译文色归位哨兵 translatedColor（无残留泄漏）；标签恒定 ✓；文本: ${JSON.stringify(landed.text.slice(0, 60))}`);
  }

  // 7) 阶段 E：单词路径缓存解耦（plan 33）——同一单词连点两次，两次都必须发出真实请求
  //    （旧代码第二次命中 aiCache → 0 请求 → 本相位即 RED 判别格）
  await resetRequestLog(scope);
  await page.evaluate(() => {
    const element = document.getElementById("selection-word");
    if (!element) throw new Error("selection-word not found");
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 200, clientY: 300 }));
  });
  await waitForFresh(
    cdp,
    "eButtonTransSelText",
    (s) => s.display === "block",
    10000,
    "单词选区图标出现"
  );
  await freshClick(cdp, "eButtonTransSelText");
  {
    // 面板重建 → 原文必须是单词 "hello"（路由走单词路径的前提）
    await waitForFresh(cdp, "eOrigText", (s) => s.text === "hello", 10000, "面板原文 = 单词 hello");

    // 等 Google 首翻落定（消除 Google 迟到覆盖 AI 文本的竞态；
    // 与阶段 A 同策略，但此处不锁哨兵色——本相位不考察 Google 网络质量）
    await waitForFresh(
      cdp,
      "eSelTextTrans",
      (s) => s.text.length > 0 && !s.text.includes("Loading") && !s.text.includes(WORD_AI_SNIPPET),
      30000,
      "单词 Google 译文落定"
    );

    // 第一次点击 AI
    await freshClick(cdp, "sOpenAI");
    await waitForFresh(
      cdp,
      "eSelTextTrans",
      (s) => s.text.includes(WORD_AI_SNIPPET),
      30000,
      "单词首次 AI 译文到达"
    );

    // 防 RED 假绿窗口：等旧代码 onFinished 的缓存写入链先完成（mock 流 <100ms；
    // 250ms 轮询通常已覆盖，此处显式兜底）
    await page.waitForTimeout(1200);
    let log = await fetchRequestLog(scope);
    const firstCount = countByAssistantNeedle(log, WORD_PATH_NEEDLE);
    if (firstCount !== 1) {
      throw new Error(`[E1] 单词首次点击应恰发出 1 个单词路径请求，实为 ${firstCount}`);
    }
    console.log("  [E1] 单词首次点击 = 1 个真实请求 ✓");

    // 第二次点击 AI → 必须再发请求（旧代码此处命中缓存 = 0 请求 → RED 判别点）
    await freshClick(cdp, "sOpenAI");
    const deadline = Date.now() + 15000;
    let wordCount = firstCount;
    while (Date.now() < deadline) {
      log = await fetchRequestLog(scope);
      wordCount = countByAssistantNeedle(log, WORD_PATH_NEEDLE);
      if (wordCount >= 2) break;
      await page.waitForTimeout(250);
    }
    if (wordCount !== 2) {
      throw new Error(
        `[E2] 单词第二次点击必须再发真实请求（单词路径不得读缓存）；期望累计 2 个单词路径请求，实为 ${wordCount}`
      );
    }
    console.log("  [E2] 单词二次点击 = 再发 1 个真实请求（累计 2）——缓存解耦生效 ✓");

    // 等第二次流落地（保持场景收尾干净）
    await waitForFresh(
      cdp,
      "eSelTextTrans",
      (s) => s.text.includes(WORD_AI_SNIPPET),
      15000,
      "单词第二次 AI 译文到达"
    );
  }

  // 8) 阶段 F：负向对照——句子二次点击仍命中内存缓存（零文本路径请求）
  //    证明本次改动未波及文本路径的缓存复用；同时守护文本路径的缓存写入存在
  //    （写入若被破坏，AI 会发请求 → 本格红）。前后代码均应为 GREEN。
  await resetRequestLog(scope);
  await page.evaluate(() => {
    const element = document.getElementById("selection-target");
    if (!element) throw new Error("selection-target not found");
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 200, clientY: 260 }));
  });
  await waitForFresh(
    cdp,
    "eButtonTransSelText",
    (s) => s.display === "block",
    10000,
    "句子选区图标出现（阶段 F）"
  );
  await freshClick(cdp, "eButtonTransSelText");
  {
    // 面板重建 → 等 Google 落定（消除竞态）
    await waitForFresh(
      cdp,
      "eSelTextTrans",
      (s) => isSettledGoogleText(s, aiSnippet),
      30000,
      "句子 Google 译文落定（阶段 F）"
    );

    // 点击 AI → 应为缓存命中（瞬达），零文本路径请求
    await freshClick(cdp, "sOpenAI");
    await waitForFresh(
      cdp,
      "eSelTextTrans",
      (s) => s.text.includes(aiSnippet),
      10000,
      "句子 AI 缓存译文到达"
    );

    // 2s 观察窗：缓存命中场景不得出现任何文本路径请求
    await page.waitForTimeout(2000);
    const log = await fetchRequestLog(scope);
    const textPathCount = countByAssistantNeedle(log, TEXT_PATH_NEEDLE);
    if (textPathCount !== 0) {
      throw new Error(`[F] 句子二次点击应命中内存缓存（0 请求），实为 ${textPathCount} 个文本路径请求`);
    }
    console.log("  [F] 句子二次点击 = 缓存命中 0 请求（文本路径缓存复用未受影响）✓");
  }
}
