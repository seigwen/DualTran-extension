/**
 * i18n sentinel scenario (spec 47 §2.2, L3; issue #157) — the runtime
 * completeness guard.
 *
 * Under the sentinel locale `xx-XX` (a copy of the extension with an injected
 * `_locales/xx_XX` where every message is `⟦<key>⟧`), every legitimate
 * user-visible string must carry the sentinel mark. The scenario walks five
 * surfaces — options page, popup, floating button group, hover panel, selection
 * panel — collects visible text nodes + `title`/`placeholder`/`aria-label`
 * attributes, and fails on any string that is neither sentinelized nor an
 * allowed data-face value (auto-derived shapes + brand/provider tokens + the
 * written register in `tests/shared/i18n-sentinel-register.mjs`).
 *
 * Why it works (probe F1, 2026-10-10, 4/4): a custom `_locales` dir IS matched
 * by `--lang`; real locales are not disturbed; unknown tags still fall back to
 * en; injection is scenario-local (copy of the prepared ext dir) so the
 * `i18n-behavior` fallback premise (xx-XX → en) stays intact elsewhere.
 *
 * Scoping discipline: extension-owned UI only. The options/popup pages are all
 * ours (full-document collection); on the content page only the extension's
 * shadow hosts are collected (the mock page's own English content must never
 * be flagged).
 *
 * @module i18n-sentinel
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runWithIsolatedExtensionContext,
  waitForContentScriptInjected,
  waitForHostState,
  waitForPageTranslatorReady,
} from "./setup.mjs";
import { buildRegisterMap, classifyItems, DATA_SELECT_IDS, LANGUAGE_CODE_RE, SENTINEL_MARK, SENTINEL_MARK_CLOSE } from "../shared/i18n-sentinel-rules.mjs";
import { REGISTER } from "../shared/i18n-sentinel-register.mjs";
import { I18N_CHANNELS } from "../shared/i18n-channels.mjs";

// SSOT self-consistency read (spec 47 §2.4): this scenario's channel entry in
// tests/shared/i18n-channels.mjs must still name this file (the channels
// meta-lint owns the full three-way check; this is the scenario's own cheap
// read so a silent re-pointing is visible here too).
{
  const selfChannel = I18N_CHANNELS.find((c) => c.id === "l3-sentinel");
  if (!selfChannel || selfChannel.guard?.script !== "tests/browser-e2e/i18n-sentinel.mjs") {
    console.warn("⚠️  i18n-channels.mjs: the sentinel channel entry is missing or misdirected (spec 47 §2.4).");
  }
}

export const name = "i18n-sentinel";
export const needsMock = false;
export const smoke = false;

const SENTINEL_LOCALE = "xx-XX";
const SENTINEL_LOCALE_DIR = "xx_XX";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ─── 自动派生放行集（Q5 主层）────────────────────────────────────

/**
 * 品牌/提供商显示名 token —— 从数据源文件文本派生（providerRegistry.js 的
 * `name:` 字段），不是手工列表；数据源演进而这里自动跟随。
 */
async function deriveProviderNames() {
  const tokens = new Set(["DualTran"]); // brand
  try {
    const src = await fs.readFile(path.join(PROJECT_ROOT, "src/lib/ai/providerRegistry.js"), "utf8");
    for (const m of src.matchAll(/name:\s*"([^"]+)"/g)) tokens.add(m[1]);
  } catch (err) {
    console.warn(`[S] providerRegistry 读取失败（放行集将不含提供商名）: ${err.message}`);
  }
  return tokens;
}

// ─── 哨兵扩展目录注入 ────────────────────────────────────────────

/**
 * 复制基础扩展目录并注入 `_locales/xx_XX/messages.json`（en 全键 → ⟦key⟧）。
 * 仅用于本场景的隔离上下文；商店构建与其他场景的目录不受影响。
 */
async function prepareSentinelExtDir(baseDir) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dualtran-sentinel-ext-"));
  await fs.cp(baseDir, dir, { recursive: true });
  const enPath = path.join(dir, "_locales", "en", "messages.json");
  const en = JSON.parse(await fs.readFile(enPath, "utf8"));
  const sentinel = {};
  for (const key of Object.keys(en)) {
    sentinel[key] = { message: `${SENTINEL_MARK}${key}${SENTINEL_MARK_CLOSE}` };
  }
  const dirPath = path.join(dir, "_locales", SENTINEL_LOCALE_DIR);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(path.join(dirPath, "messages.json"), JSON.stringify(sentinel, null, 2));
  console.log(`[S] 哨兵扩展目录已注入 ${SENTINEL_LOCALE_DIR}（${Object.keys(sentinel).length} 键）: ${dir}`);
  return dir;
}

/** attachShadow closed → open 补丁（与主 harness launchExtensionBrowser 同款）。 */
const SHADOW_OPEN_PATCH = () => {
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return orig.call(this, { ...init, mode: "open" });
  };
};

// ─── 页面内收集器 ────────────────────────────────────────────────

/**
 * 收集收集范围内所有可见文本 + title/placeholder/aria-label。
 * mode "document"：整棵文档树（扩展页面——全部内容归扩展所有）。
 * mode "hosts"：仅扩展注入的 shadow 宿主（内容页——宿主页面自身文本不属扩展）。
 * 收集器须自包含（经 page.evaluate 序列化执行）。
 */
/* eslint-disable no-undef */
function collectVisibleTexts(options) {
  const { mode } = options || { mode: "document" };
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "HTML", "BODY"]);
  const items = [];

  function visible(el) {
    if (el.tagName === "OPTION") return true;
    try {
      return typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
    } catch (_) {
      return true;
    }
  }

  function pathOf(el) {
    const parts = [];
    let cur = el;
    for (let i = 0; i < 4 && cur && cur.tagName; i++) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) s += "#" + cur.id;
      else if (cur.classList && cur.classList.length) {
        s += "." + Array.from(cur.classList).slice(0, 2).join(".");
      }
      parts.unshift(s);
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
    return parts.join(">");
  }

  function push(el, kind, text, optionValue, prefix) {
    const t = (text || "").trim();
    if (!t) return;
    let selectId;
    if (kind === "option") {
      try {
        selectId = (el.closest("select") || {}).id || "";
      } catch (_) {
        selectId = "";
      }
    }
    items.push({
      kind,
      text: t.slice(0, 300),
      optionValue: optionValue,
      selectId: selectId,
      path: prefix + "|" + pathOf(el),
      tag: el.tagName,
    });
  }

  function walkTree(root, prefix) {
    let els;
    try {
      els = root.querySelectorAll("*");
    } catch (_) {
      return;
    }
    for (const el of els) {
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (!visible(el)) continue;
      const isOption = el.tagName === "OPTION";
      if (el.firstElementChild === null) {
        push(el, isOption ? "option" : "text", el.textContent, isOption ? el.value || "" : undefined, prefix);
        if (isOption) continue;
      }
      for (const attr of ["title", "placeholder", "aria-label"]) {
        const v = el.getAttribute(attr);
        if (v) push(el, attr, v, undefined, prefix);
      }
      if (el.shadowRoot) walkTree(el.shadowRoot, prefix + "/shadow(" + pathOf(el) + ")");
    }
  }

  if (mode === "hosts") {
    const hosts = [];
    for (const id of ["dualtran-floating-btn-host", "dualtran-singleton-btn-host"]) {
      const el = document.getElementById(id);
      if (el) hosts.push(el);
    }
    // 面板宿主（悬停框 / 划词面板）：shadow 内含 #eDivResult 的宿主
    for (const el of document.querySelectorAll("*")) {
      try {
        if (el.shadowRoot && el.shadowRoot.getElementById("eDivResult")) hosts.push(el);
      } catch (_) {}
    }
    const seen = new Set();
    for (const host of hosts) {
      if (seen.has(host)) continue;
      seen.add(host);
      if (host.shadowRoot) walkTree(host.shadowRoot, "shadow(" + pathOf(host) + ")");
    }
  } else {
    walkTree(document, "doc");
  }
  return items;
}
/* eslint-enable no-undef */

// ─── CDP 穿透（closed shadow 的既定通道，与 hover-panel/selected-panel 同源）───
// showTranslated / translateSelected 的面板 shadow 是 `mode: "closed"`，主世界
// 不可遍历；CDP `DOM.getDocument{pierce:true}` 是仓库既有的穿透读取通道。

async function getPiercedRoot(cdp) {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  return root;
}

function cdpAttr(node, name) {
  const attrs = node.attributes || [];
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) return attrs[i + 1];
  }
  return null;
}

function cdpFindAllByAttr(node, name, value, out = []) {
  if (node.nodeType === 1 && cdpAttr(node, name) === value) out.push(node);
  for (const child of node.children || []) cdpFindAllByAttr(child, name, value, out);
  // CDP DOM 树的 shadow root 挂在 `shadowRoots`（不在 children 里）——必须一并下钻
  for (const sr of node.shadowRoots || []) cdpFindAllByAttr(sr, name, value, out);
  return out;
}

/** 沿 pierce 树从目标节点向上找第一个 shadow-root（#document-fragment）祖先。 */
function cdpClosestFragment(root, targetNodeId) {
  const parents = new Map();
  (function walk(node, parent) {
    if (parent) parents.set(node.nodeId, parent);
    for (const child of node.children || []) walk(child, node);
    for (const sr of node.shadowRoots || []) walk(sr, node);
  })(root, null);
  let cur = parents.get(targetNodeId);
  while (cur) {
    if (cur.nodeName === "#document-fragment") return cur;
    cur = parents.get(cur.nodeId);
  }
  return null;
}

async function cdpComputedDisplay(cdp, nodeId) {
  const { object } = await cdp.send("DOM.resolveNode", { nodeId });
  const { result } = await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function () { return getComputedStyle(this).display; }",
    returnByValue: true,
  });
  return result.value;
}

/** 等待 pierce 树中出现 id=… 且任一实例 computed display ≠ none 的节点。 */
async function waitForPiercedVisible(cdp, id, timeoutMs = 15000) {
  const t0 = Date.now();
  let lastDiag = `#${id} not found`;
  while (Date.now() - t0 < timeoutMs) {
    const root = await getPiercedRoot(cdp);
    const nodes = cdpFindAllByAttr(root, "id", id);
    for (const node of nodes) {
      const display = await cdpComputedDisplay(cdp, node.nodeId).catch(() => "block");
      if (display !== "none") return node;
      lastDiag = `#${id} display=${display}`;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`[S] pierce 等待超时（${timeoutMs}ms）：${lastDiag}`);
}

/** CDP 合成点击（closed shadow 内元素——this.click() 用户级点击）。 */
async function cdpClickById(cdp, id) {
  const root = await getPiercedRoot(cdp);
  const nodes = cdpFindAllByAttr(root, "id", id);
  if (nodes.length === 0) throw new Error(`[S] pierce 未找到 #${id}`);
  const { object } = await cdp.send("DOM.resolveNode", { nodeId: nodes[0].nodeId });
  await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function () { this.click(); }",
    returnByValue: true,
  });
}

/** 收集 marker 所在 closed-shadow 整棵子树的文本与 title/placeholder/aria-label。
 *  option 元素以 kind "option" + optionValue/selectId 上报（语言/数据面规则依赖）；
 *  不下钻 user-agent shadow（如 option 渲染内部，避免重复文本）。 */
async function collectPiercedPanel(cdp, markerId, surfaceName) {
  const root = await getPiercedRoot(cdp);
  const markers = cdpFindAllByAttr(root, "id", markerId);
  if (markers.length === 0) throw new Error(`[S] pierce 未找到 #${markerId}（无法收集 ${surfaceName}）`);
  // 取「可见」实例所属的 shadow 子树（多面板并存时锚定正确的一个）
  let fragment = null;
  for (const marker of markers) {
    const f = cdpClosestFragment(root, marker.nodeId);
    if (f) {
      fragment = f;
      break;
    }
  }
  const startNode = fragment || markers[0];
  const items = [];
  const collect = (node, path, ctx) => {
    const isOptionCtx = ctx.optionValue !== undefined;
    if (node.nodeType === 3) {
      const t = (node.nodeValue || "").trim();
      if (t) {
        items.push({
          kind: isOptionCtx ? "option" : "text",
          text: t.slice(0, 300),
          optionValue: isOptionCtx ? ctx.optionValue : undefined,
          selectId: isOptionCtx ? ctx.selectId : undefined,
          path,
          tag: "#text",
        });
      }
      return;
    }
    let childCtx = ctx;
    if (node.nodeType === 1) {
      const tag = (node.nodeName || "").toLowerCase();
      if (["script", "style", "noscript", "template"].includes(tag)) return;
      if (!isOptionCtx) {
        for (const a of ["title", "placeholder", "aria-label"]) {
          const v = cdpAttr(node, a);
          if (v && v.trim()) items.push({ kind: a, text: v.trim().slice(0, 300), path, tag: node.nodeName });
        }
      }
      if (tag === "option") {
        childCtx = { selectId: ctx.selectId, optionValue: cdpAttr(node, "value") || "" };
      } else if (tag === "select") {
        childCtx = { selectId: cdpAttr(node, "id") || "", optionValue: undefined };
      }
    }
    for (const child of node.children || []) {
      let p = path;
      if (child.nodeType === 1) {
        let s = (child.nodeName || "").toLowerCase();
        const cid = cdpAttr(child, "id");
        if (cid) s += "#" + cid;
        p = path + ">" + s;
      }
      collect(child, p, childCtx);
    }
    const inOption = node.nodeType === 1 && (node.nodeName || "").toLowerCase() === "option";
    for (const sr of node.shadowRoots || []) {
      if (sr.shadowRootType === "user-agent") continue; // option/input 渲染内部——重复文本
      if (inOption) continue;
      collect(sr, path + "::shadow", childCtx);
    }
  };
  collect(startNode, `pierce(${surfaceName})`, {});
  return items;
}

// ─── 审计与报告 ─────────────────────────────────────────────────

/**
 * 对一面收集结果做分类审计并打印；违规计入汇总（带面名）。
 * @returns {Array<object>} 该面的违规条目
 */
function auditSurface(surface, items, registerMap, allowTokens, matchedRegister) {
  const { violations, matchedRegister: matched, layerCounts } = classifyItems(items, registerMap, allowTokens);
  for (const t of matched) matchedRegister.add(t);
  const layers = Object.entries(layerCounts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `[S] ${surface}: 收集 ${items.length} 条（文本/属性），违规 ${violations.length} 条｜分层：${layers}`
  );
  if (process.env.SENTINEL_DEBUG === "1") {
    for (const it of items) console.log(`    · [${surface}] ${it.kind} "${it.text.slice(0, 60)}" @ ${it.path}`);
  }
  for (const v of violations) {
    console.log(`    ✗ [${surface}] ${v.kind} "${v.text.slice(0, 80)}" @ ${v.path}`);
  }
  return violations.map((v) => ({ surface, ...v }));
}

// ─── 各面步骤 ───────────────────────────────────────────────────

async function configureSentinelStorage(serviceWorker, testPageUrl) {
  const host = new URL(testPageUrl).hostname;
  await serviceWorker.evaluate(async (hostname) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguages: ["fr", "en", "es"],
      targetLanguageTextTranslation: "fr",
      textTranslatorService: "google",
      darkMode: "no",
      translateTextOverMouseWhenPressTwice: "no",
      sitesToTranslateWhenHovering: [hostname],
      langsToTranslateWhenHovering: [],
      showTranslateSelectedButton: "yes",
      expandPanelTranslateSelectedText: "yes",
    });
  }, host);
  console.log(`[S] 内容面存储已配置（hover 站点=${host}）`);
}

/** SW 层挡箭牌：google 翻译请求永不完成 → 面板停留在 loading 面（确定性）。 */
async function gateGoogleFetches(serviceWorker) {
  await serviceWorker.evaluate(() => {
    if (!globalThis.__sentinelOriginalFetch) {
      globalThis.__sentinelOriginalFetch = globalThis.fetch;
    }
    const original = globalThis.__sentinelOriginalFetch;
    globalThis.fetch = (...args) => {
      const url = String((args[0] && args[0].url) || args[0] || "");
      if (/translate\.googleapis\.com|translate\.google\.com|clients5\.google\.com/.test(url)) {
        return new Promise(() => {}); // blackhole：请求挂起 → loading 恒可见
      }
      return original(...args);
    };
  });
  console.log("[S] Google 翻译请求已上闸（面板保持 loading 面）");
}

async function releaseGoogleFetches(serviceWorker) {
  await serviceWorker
    .evaluate(() => {
      if (globalThis.__sentinelOriginalFetch) {
        globalThis.fetch = globalThis.__sentinelOriginalFetch;
        delete globalThis.__sentinelOriginalFetch;
      }
    })
    .catch(() => {});
}

// ─── run(scope) ─────────────────────────────────────────────────

/**
 * @param {Object} scope - setupBasic() 返回的作用域对象
 */
export async function run(scope) {
  const { collector, testPageUrl } = scope;
  console.log(`\n=== 开始场景: "${name}" ===\n`);
  console.log(`[S] 哨兵 locale ${SENTINEL_LOCALE}：所有 i18n 消息渲染为 ${SENTINEL_MARK}key${SENTINEL_MARK_CLOSE}`);

  const registerMap = buildRegisterMap(REGISTER);
  const allowTokens = await deriveProviderNames();
  const matchedRegister = new Set();
  const allViolations = [];
  const collected = []; // { surface, items } —— 收集先行、分类在后（跨面派生需要全量）
  const sentinelExtDirs = [];

  try {
    await runWithIsolatedExtensionContext(
      async ({ context, page, extensionId, serviceWorker }) => {
      // ── S1: options 页（扩展页面——整库归扩展所有）──
      await page.goto(`chrome-extension://${extensionId}/options/options.html`, { waitUntil: "load" });
      // translateDocument 自动执行 + AI 面板等异步初始化落定
      await page.waitForTimeout(2500);
      await page
        .waitForFunction(() => {
          const el = document.getElementById("genericModelLabel");
          return el && el.textContent && el.textContent.trim() !== "Model";
        }, null, { timeout: 15000 })
        .catch(() => {
          console.warn("[S] AI 面板就绪信号未出现——继续收集（可能是降级态）");
        });
      await page.waitForTimeout(1500);
      const optionsItems = await page.evaluate(collectVisibleTexts, { mode: "document" });
      collected.push({ surface: "options", items: optionsItems });

      // ── S2: popup 页 ──
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
      await popup.waitForTimeout(2500);
      const popupItems = await popup.evaluate(collectVisibleTexts, { mode: "document" });
      collected.push({ surface: "popup", items: popupItems });
      await popup.close();

      // ── S3–S5: 内容页（仅收集扩展注入的 shadow 宿主）──
      // 配置与闸门必须先于页面加载（内容脚本初始化时读取存储；滞后写入
      // 不会送达 hover/选区处理器——hover-panel.mjs 同款时序）。
      const contentPage = await context.newPage();
      await configureSentinelStorage(serviceWorker, testPageUrl);
      await gateGoogleFetches(serviceWorker);
      await contentPage.goto(testPageUrl, { waitUntil: "domcontentloaded" });
      await waitForContentScriptInjected(serviceWorker, contentPage.url());
      await waitForPageTranslatorReady(serviceWorker, contentPage.url());
      await contentPage.waitForTimeout(1500);

      // S3: 悬浮按钮组（页面加载后自动出现；三态助手——host-state-assertions 纪律）
      await waitForHostState(contentPage, "floating", "healthy", { timeoutMs: 20000, label: "i18n-sentinel" });
      await contentPage.waitForTimeout(500);
      const floatingItems = await contentPage.evaluate(collectVisibleTexts, { mode: "hosts" });
      collected.push({ surface: "floating-group", items: floatingItems });

      // S4: 悬停翻译框（配置已先行；hover 触发）
      // 面板 shadow 为 closed——等待与收集走 CDP pierce（既定通道）
      const cdp = await contentPage.context().newCDPSession(contentPage);
      await cdp.send("DOM.enable");
      await contentPage.hover("p#paragraph-1", { timeout: 5000 });
      await waitForPiercedVisible(cdp, "eDivResult", 15000).catch(async (err) => {
        const hosts = await contentPage
          .evaluate(() => document.querySelectorAll("div.notranslate:not([id])").length)
          .catch(() => -1);
        throw new Error(`${err.message}；hover 宿主计数=${hosts}`);
      });
      await contentPage.waitForTimeout(500);
      const hoverItems = await collectPiercedPanel(cdp, "eDivResult", "hover-panel");
      collected.push({ surface: "hover-panel", items: hoverItems });

      // S5: 划词面板（选中 → 图标 → CDP 点击 → 面板）
      await contentPage.evaluate(() => {
        const el = document.getElementById("selection-target");
        if (!el) throw new Error("selection-target not found");
        const selection = window.getSelection();
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200, clientY: 260 }));
      });
      await waitForPiercedVisible(cdp, "eButtonTransSelText", 10000);
      await cdpClickById(cdp, "eButtonTransSelText");
      await waitForPiercedVisible(cdp, "eDivResult", 10000);
      await contentPage.waitForTimeout(500);
      const selectionItems = await collectPiercedPanel(cdp, "eButtonTransSelText", "selection-panel");
      collected.push({ surface: "selection-panel", items: selectionItems });

      await releaseGoogleFetches(serviceWorker);
    },
    collector,
    {
      locale: SENTINEL_LOCALE,
      prepareExtDir: async (baseDir) => {
        const dir = await prepareSentinelExtDir(baseDir);
        sentinelExtDirs.push(dir);
        return dir;
      },
      initScripts: [SHADOW_OPEN_PATCH],
    }
  );

  // 清理哨兵扩展目录（含失败路径）
  } finally {
    for (const dir of sentinelExtDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ── 跨面派生放行集（Q5 主层）：语言名 = option 值为语言码的 option 文本 ──
  // 语言下拉在多个面出现（options 全列表 / 面板 #selectMoreTargetLang），
  // 其文本即语言名的权威运行时来源——派生后供 li/title 等非 option 面放行。
  const langNameTexts = new Set();
  for (const { items } of collected) {
    for (const it of items) {
      if (it.kind !== "option" || !it.optionValue) continue;
      // 数据面 select（provider/model 注册表）不是语言下拉——其单段小写 id
      // （"google"/"openai"/…）会匹配语言码形状，不能进语言名派生集
      if (it.selectId && DATA_SELECT_IDS.has(it.selectId)) continue;
      if (LANGUAGE_CODE_RE.test(it.optionValue.trim())) langNameTexts.add(it.text);
    }
  }
  console.log(`[S] 派生语言名 ${langNameTexts.size} 条（供 li/title 等非 option 面放行）`);
  const tokens = new Set([...allowTokens, ...langNameTexts]);

  // ── 分类与报告 ──
  for (const { surface, items } of collected) {
    allViolations.push(...auditSurface(surface, items, registerMap, tokens, matchedRegister));
  }

  // ── stale register 报告（非阻塞）──
  const stale = [...registerMap.values()].filter((e) => !matchedRegister.has(e.text));
  if (stale.length > 0) {
    console.warn(
      `[S] register stale 报告：${stale.length} 条放行项本次运行未被命中（复核并删除）: ${stale
        .map((e) => `"${e.text}"`)
        .join(", ")}`
    );
  }

  // ── 汇总 ──
  const legacyRegister = [...registerMap.values()].filter((e) => e.category === "legacy").length;
  console.log(
    `[S] 汇总：违规 ${allViolations.length} 条｜register ${registerMap.size} 条（legacy ${legacyRegister} 条，清零目标）｜命中 ${matchedRegister.size} 条: ${[...matchedRegister].join(", ")}`
  );

  if (allViolations.length > 0) {
    throw new Error(
      `[i18n-sentinel] 运行时哨兵发现 ${allViolations.length} 条未走 i18n 的可见文本/属性：\n` +
        allViolations
          .slice(0, 40)
          .map((v) => `  [${v.surface}] ${v.kind} "${v.text}" @ ${v.path}`)
          .join("\n") +
        (allViolations.length > 40 ? `\n  ...（其余 ${allViolations.length - 40} 条见日志）` : "")
    );
  }
  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
