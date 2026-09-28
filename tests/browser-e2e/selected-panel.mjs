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
}
