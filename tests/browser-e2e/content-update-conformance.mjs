/**
 * DualTran E2E: 内容更新通道一致性套件（channel × display-mode 全矩阵）
 *
 * ── 这个场景取代了什么，为什么 ──
 *
 * 旧场景 dynamic-content-showmore.mjs 的名字对应症状（"showmore"），但它
 * 只模拟一种机制（childList append），且只跑 newLine 模式。x.com 真机两次
 * （#7、#98）用的是别的机制（characterData 原地改写 / childList 替换），
 * 于是同一个用户可见缺陷两度逃逸。名称正确的测试会吸收风险预算。
 *
 * 本套件按 tests/shared/content-update-channels.mjs（SSOT）的通道分类，
 * 对**每个 active 通道 × 每种显示模式**（DISPLAY_MODES 行为级遍历）执行
 * 三层 oracle：
 *
 *   L0 落地断言    —— 站点更新确实发生（容器文本达到 ground truth 的量级）
 *   L1 覆盖断言    —— 译文覆盖展开后文本的合理比例
 *   L2 通道证明    —— 语言无关：
 *                      newLine:        源文 sentinel 必须保留（原文未丢）
 *                      replaceOriginal: sentinel 与英文前缀必须从容器消失
 *                                       （被译文替换）——修复缺失时必红，
 *                                       即 #98 第二根因（容器过滤）回归信号
 *   L3 陈旧排除    —— soak 后复查：比例不回落、sentinel 不回归
 *
 * ground truth 的取值：优先 article[data-full-text]（模拟页声明的站点写入
 * 内容，永不被翻译）；无该属性时（append / css-only）用作用域元素在触发后
 * 立即快照的文本（此时尚无译文写入，是站点原样内容）。
 *
 * 负向格（css-only-reveal）：无突变、无写入——断言方向是「初始扫描必须
 * 不能跳过隐藏文本」，即展开前译文就已存在。
 *
 * 每通道 collect-then-throw：单格红不掩盖其它格（#98 已验证的模式）。
 *
 * 视觉层：本场景同时是两个视觉检查点（before/after expand）的捕获点，
 * 见 visual-checks.mjs；after 检查点带 programmatic 硬断言
 * （assertExpandedBlockShowsTranslation），使「展开后仍有英文残留」在
 * E2E 运行中硬失败，而不是只依赖 AI 视觉审查。
 *
 * @module content-update-conformance
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  writeStorage,
  readStorage,
  forEachDisplayMode,
  DISPLAY_MODES,
  screenshotCheckpoint,
  assertNoDuplicateTranslations,
  assertReplaceOriginalNoDuplicates,
} from "./setup.mjs";

// 通道 SSOT —— 与 lint（scripts/check-content-update-channels.js）同一份数据。
import { ACTIVE_CHANNELS } from "../shared/content-update-channels.mjs";

export const name = "content-update-conformance";

/** 纯 Google 翻译 + DOM 管道，不需要 Mock LLM 服务器 */
export const needsMock = false;

/** 不纳入 smoke 子集（双模式 × 7 通道，耗时较长） */
export const smoke = false;

/** 每个通道等待译文的最大时长（观察者 2s tick + 翻译往返） */
const CHANNEL_TIMEOUT_MS = 20_000;

/** 作用域内译文覆盖下限（google span 长度 / ground truth 长度） */
const SCOPE_RATIO_MIN = 0.3;
/** 文章级译文覆盖下限（兜底信号：译文元素落点可能不在容器内） */
const ARTICLE_RATIO_MIN = 0.6;

/**
 * 每个通道的浏览器侧驱动。
 *
 * - container:  站点更新落地的容器
 * - scope:      译文/文本的测量作用域（默认 = container）
 * - sentinel:   展开文本末尾的唯一英文尾句（语言无关判据的锚点）
 * - negativeCell: 负向格（无突变；断言「展开前译文已在」）
 * - targets:    属性通道的多目标读取表（每目标各自声明站点英文值）
 */
const CHANNEL_DRIVERS = {
  "childlist-append": {
    container: "#showmore-container",
    scope: "#showmore-hidden",
    sentinel: "once it becomes visible to the user",
    triggerSelector: "#showmore-btn",
    trigger: async (page) => {
      await page.click("#showmore-btn");
    },
  },

  "childlist-replace": {
    container: "#showmore-replace-container",
    scope: "#showmore-replace-container",
    sentinel: "trailing sentence for the replace channel",
    triggerSelector: "#showmore-replace-btn",
    trigger: async (page) => {
      await page.click("#showmore-replace-btn");
    },
  },

  "characterdata-rewrite": {
    container: "#showmore-inplace-container",
    scope: "#showmore-inplace-container",
    sentinel: "trailing sentence for the inplace channel",
    triggerSelector: "#showmore-inplace-btn",
    trigger: async (page) => {
      await page.click("#showmore-inplace-btn");
    },
  },

  "container-textcontent-rewrite": {
    container: "#showmore-textcontent-container",
    scope: "#showmore-textcontent-container",
    sentinel: "trailing sentence for the textcontent channel",
    triggerSelector: "#showmore-textcontent-btn",
    trigger: async (page) => {
      await page.click("#showmore-textcontent-btn");
    },
  },

  "attribute-rewrite": {
    container: "#attr-rewrite-wrap",
    scope: "#attr-rewrite-input",
    sentinel: null,
    triggerSelector: "#attr-rewrite-btn",
    targets: [
      {
        selector: "#attr-rewrite-input",
        siteValues: {
          placeholder: "Search topics, replies and direct messages across the whole site",
          title: "Search the whole site including private conversations",
        },
        initialValues: { placeholder: "Search topics", title: "Search the whole site" },
      },
    ],
    trigger: async (page) => {
      await page.click("#attr-rewrite-btn");
      // 属性翻译受屏幕门控（isInScreen）：必须把目标滚进视口，
      // 否则属性永远不会被加入待翻译批次（既有产品行为，非测试假设）。
      await page.evaluate(() => {
        document.getElementById("attr-rewrite-input")?.scrollIntoView({ block: "center" });
      });
      await page.waitForTimeout(300);
    },
  },

  "attribute-add": {
    container: "#attr-add-wrap",
    scope: "#attr-added-input",
    sentinel: null,
    triggerSelector: "#attr-add-btn",
    targets: [
      {
        selector: "#attr-added-input",
        siteValues: { placeholder: "Type to search members of this workspace" },
        initialValues: {},
      },
      {
        selector: "#attr-added-img",
        siteValues: { alt: "Preview thumbnail of the newly attached product photo" },
        initialValues: {},
      },
    ],
    trigger: async (page) => {
      await page.click("#attr-add-btn");
      await page.evaluate(() => {
        document.getElementById("attr-added-input")?.scrollIntoView({ block: "center" });
      });
      await page.waitForTimeout(300);
    },
  },

  "css-only-reveal": {
    container: "#css-reveal-container",
    scope: "#css-reveal-container",
    sentinel: "trailing sentence for the css reveal channel",
    negativeCell: true,
    triggerSelector: "#css-reveal-btn",
    trigger: async (page) => {
      await page.click("#css-reveal-btn");
      await page.waitForTimeout(300);
    },
  },
};

// ─── 页面侧测量 ──────────────────────────────────────────────

/**
 * 读取容器/作用域状态（一次 evaluate 取齐所有语言无关信号）。
 */
async function measureChannel(page, { container, scope, sentinel }) {
  return page.evaluate(({ containerSel, scopeSel, needle }) => {
    const el = document.querySelector(containerSel);
    if (!el) return { ok: false, reason: `container ${containerSel} missing` };
    const article = el.closest("article") || el;
    const scopeEl = scopeSel ? document.querySelector(scopeSel) : el;
    const sumGoogle = (root) =>
      root
        ? [...root.querySelectorAll(".dualtran-google")].reduce(
            (a, s) => a + (s.textContent || "").length,
            0
          )
        : 0;
    const containerText = el.textContent || "";
    const declaredGt = article.getAttribute("data-full-text") || "";
    return {
      ok: true,
      declaredGt,
      scopeText: scopeEl ? scopeEl.textContent || "" : "",
      containerText,
      containerLen: containerText.length,
      scopeGoogleLen: sumGoogle(scopeEl),
      articleGoogleLen: sumGoogle(article),
      sentinelPresent: needle ? containerText.includes(needle) : null,
      scopeSentinelPresent: needle && scopeEl ? (scopeEl.textContent || "").includes(needle) : null,
      visible: window.getComputedStyle(el).display !== "none",
    };
  }, { containerSel: container, scopeSel: scope || container, needle: sentinel });
}

/** 轮询等待条件成立。返回 { ok, last } —— last 是最后一次测量（失败诊断用）。 */
async function waitUntil(page, predicate, timeoutMs = CHANNEL_TIMEOUT_MS) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await predicate();
    } catch (_) {
      last = null;
    }
    if (last) return { ok: true, last };
    await page.waitForTimeout(400);
  }
  return { ok: false, last };
}

/**
 * 触发站点动作，并防御扩展自身的悬浮按钮组遮挡（全量运行实测 flake）。
 *
 * 全量 E2E 上下文里，上一个通道点击后鼠标停在块上 → 扩展的悬停按钮组
 * （`div#dualtran-singleton-btn-host.notranslate`，position:fixed、
 * z-index 2147483646）覆盖站点触发按钮 → `page.click` 被「intercepts pointer
 * events」卡 30s 超时（单跑不出现：跨场景鼠标位置差异）。修复：
 *   1. 先把鼠标移到空白处并等待按钮组收起（真实用户等价语义）；
 *   2. 触发前做命中测试（elementFromPoint）：若站点按钮仍被扩展元素覆盖，
 *      直接走 DOM 级 `.click()`（站点监听器、事件目标均不变），
 *      避免 30s 超时空等。
 */
async function triggerSiteAction(page, driver) {
  // 1) 鼠标移开（视口左上角空白）→ 悬停组应收起
  await page.mouse.move(2, 2).catch(() => {});
  await page.waitForTimeout(250);

  const sel = driver.triggerSelector;
  if (!sel) {
    await driver.trigger(page);
    return;
  }

  // 2) 触发按钮滚入视口（属性通道的屏幕门控采集依赖此步；其余通道无害）
  await page
    .evaluate((s) => {
      document.querySelector(s)?.scrollIntoView({ block: "center" });
    }, sel)
    .catch(() => {});
  await page.waitForTimeout(200);

  // 3) 命中测试：按钮中心点上是谁？扩展覆盖 → DOM click 兜底
  const coveredByExtension = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || top === el || el.contains(top)) return false;
    // 扩展自产元素（悬停组/浮动按钮宿主）覆盖判定：这是 overlay 命中测试，
    // 不是宿主三态断言——宿主 shadowRoot 生命周期与本站点无关。
    const overlaySel = "#dualtran-singleton-btn-host, #dualtran-floating-btn-host"; // host-state-allow: overlay hit-test, not a host-lifecycle assertion
    return (
      top.classList.contains("notranslate") ||
      top.id === "dualtran-singleton-btn-host" ||
      top.id === "dualtran-floating-btn-host" ||
      !!top.closest(overlaySel)
    );
  }, sel);

  if (coveredByExtension) {
    const clicked = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.click();
      return true;
    }, sel);
    if (clicked) {
      await page.waitForTimeout(300);
      return;
    }
  }

  await driver.trigger(page);
}

// ─── 断言：文本通道 ──────────────────────────────────────────

async function assertTextChannel(page, channel, mode, driver) {
  const { sentinel } = driver;

  // 触发前快照（负向格要用；也是 site 写入内容快照的兜底源）
  const pre = await measureChannel(page, driver);
  if (!pre.ok) throw new Error(`[conformance] ${channel.id}@${mode}: ${pre.reason}`);

  await triggerSiteAction(page, driver);
  await page.waitForTimeout(300);

  // ground truth 快照：声明值优先；否则用作用域当前文本（此时尚无译文写入）
  const post = await measureChannel(page, driver);
  const gtText = post.declaredGt || post.scopeText || "";
  const gtLen = gtText.length;

  // ── L0: 站点更新落地（负向格跳过：它没有站点更新）──
  if (!driver.negativeCell) {
    const landed = await waitUntil(page, async () => {
      const m = await measureChannel(page, driver);
      if (!m.ok || gtLen <= 0) return false;
      return m.containerLen >= 0.5 * gtLen;
    }, 3_000);
    if (!landed.ok) {
      const m = await measureChannel(page, driver);
      throw new Error(
        `[conformance] ${channel.id}@${mode}: 站点更新未落地 — ` +
          `containerLen=${m.containerLen}, gtLen=${gtLen}（模拟页驱动或选择器失效）`
      );
    }
  }

  if (mode === "newLine") {
    // ── L1: 译文（google span）覆盖展开后文本的合理比例 ──
    const covered = await waitUntil(page, async () => {
      const m = await measureChannel(page, driver);
      if (!m.ok) return false;
      const scopeRatio = m.scopeGoogleLen / Math.max(1, gtLen);
      const articleRatio = m.articleGoogleLen / Math.max(1, gtLen);
      return scopeRatio >= SCOPE_RATIO_MIN || articleRatio >= ARTICLE_RATIO_MIN;
    });
    if (!covered.ok) {
      const m = (await measureChannel(page, driver)) || {};
      throw new Error(
        `[conformance] ${channel.id}@newLine: 展开后的内容未获得译文覆盖 — ` +
          `scopeGoogleLen=${m.scopeGoogleLen}, articleGoogleLen=${m.articleGoogleLen}, gtLen=${gtLen}, ` +
          `timeout=${CHANNEL_TIMEOUT_MS}ms` +
          (driver.negativeCell
            ? "（负向格：初始扫描必须不能跳过隐藏文本）"
            : "")
      );
    }
    // ── L2: 源文 sentinel 保留（原文未丢）；译文区不得含未翻译英文片段 ──
    if (sentinel) {
      const m = await measureChannel(page, driver);
      if (m.sentinelPresent !== true) {
        throw new Error(
          `[conformance] ${channel.id}@newLine: 源文 sentinel「${sentinel}」不在容器中 — 站点更新未落地或源文被误删`
        );
      }
      const leak = await page.evaluate(({ scopeSel, needle }) => {
        const root = document.querySelector(scopeSel);
        if (!root) return false;
        return [...root.querySelectorAll(".dualtran-google")].some((s) =>
          (s.textContent || "").includes(needle)
        );
      }, { scopeSel: driver.scope, needle: sentinel });
      if (leak) {
        throw new Error(
          `[conformance] ${channel.id}@newLine: 译文区含未翻译英文片段「${sentinel}」— 译文未覆盖展开文本`
        );
      }
    }
  } else {
    // ── replaceOriginal：译文写回源节点 —— sentinel + 英文前缀必须消失 ──
    const prefix = gtText.trim().split(/\s+/).slice(0, 5).join(" ");
    const replaced = await waitUntil(page, async () => {
      const m = await measureChannel(page, driver);
      if (!m.ok) return false;
      // 内容没被删除（长度仍在量级）
      if (m.scopeText.length < 0.3 * gtLen) return false;
      if (sentinel && m.sentinelPresent !== false) return false;
      if (prefix && m.containerText.includes(prefix)) return false;
      return true;
    });
    if (!replaced.ok) {
      const m = (await measureChannel(page, driver)) || {};
      throw new Error(
        `[conformance] ${channel.id}@replaceOriginal: 站点文本未被译文替换 — ` +
          `sentinelPresent=${m.sentinelPresent}, containerLen=${m.containerLen}, gtLen=${gtLen}, ` +
          `timeout=${CHANNEL_TIMEOUT_MS}ms。这正是 #98 第二根因（容器过滤吞站点更新）的回归信号。`
      );
    }
  }

  // ── L3: soak 后复查（比例不回落、sentinel 不回归）──
  await page.waitForTimeout(1_500);
  const soak = await measureChannel(page, driver);
  if (mode === "newLine") {
    const scopeRatio = soak.scopeGoogleLen / Math.max(1, gtLen);
    const articleRatio = soak.articleGoogleLen / Math.max(1, gtLen);
    if (!(scopeRatio >= SCOPE_RATIO_MIN || articleRatio >= ARTICLE_RATIO_MIN)) {
      throw new Error(
        `[conformance] ${channel.id}@newLine: soak 后译文覆盖率回落（scope=${scopeRatio.toFixed(2)}, article=${articleRatio.toFixed(2)}）— 陈旧译文残留或元素被替换`
      );
    }
  } else {
    const prefix = gtText.trim().split(/\s+/).slice(0, 5).join(" ");
    if (sentinel && soak.sentinelPresent !== false) {
      throw new Error(
        `[conformance] ${channel.id}@replaceOriginal: soak 后 sentinel 重新出现 — 反馈环把英文写回`
      );
    }
    if (prefix && soak.containerText.includes(prefix)) {
      throw new Error(
        `[conformance] ${channel.id}@replaceOriginal: soak 后英文前缀重新出现 — 反馈环把英文写回`
      );
    }
  }

  if (driver.negativeCell) {
    // 负向格附加断言：展开动作确实把容器变为可见（否则该格没有测试价值）
    const visible = await waitUntil(page, async () => {
      const m = await measureChannel(page, driver);
      return m.ok && m.visible === true;
    }, 5_000);
    if (!visible.ok) {
      throw new Error(`[conformance] ${channel.id}@${mode}: CSS reveal 未使容器可见 — 负向格未生效`);
    }
  }

  return { mode };
}

// ─── 断言：属性通道 ──────────────────────────────────────────

/** 读取属性通道的全部目标（每个目标返回其存在的可翻译属性）。 */
async function readAttributeTargets(page, targets) {
  return page.evaluate((selList) => {
    return selList.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { selector: sel, missing: true };
      const values = {};
      for (const name of ["placeholder", "title", "alt", "value"]) {
        const v = el.getAttribute(name);
        if (v !== null) values[name] = v;
      }
      return { selector: sel, values };
    });
  }, targets.map((t) => t.selector));
}

/** 语言无关判据：值必须已变、非空，且不等于任一站点英文值。 */
function isLocalized(value, englishValues) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !englishValues.includes(value)
  );
}

async function assertAttributeChannel(page, channel, mode, driver) {
  await triggerSiteAction(page, driver);
  await page.waitForTimeout(300);

  const initial = await readAttributeTargets(page, driver.targets);
  const missing = initial.filter((r) => r.missing);
  if (missing.length > 0) {
    throw new Error(
      `[conformance] ${channel.id}@${mode}: 站点更新未发生（目标元素缺失: ${missing
        .map((m) => m.selector)
        .join(", ")}）`
    );
  }

  const allLocalized = (results) =>
    driver.targets.every((target, idx) => {
      const values = results[idx]?.values || {};
      return Object.entries(target.siteValues).every(([field, english]) =>
        isLocalized(values[field], [english, target.initialValues?.[field]].filter(Boolean))
      );
    });

  const localized = await waitUntil(page, async () => {
    const results = await readAttributeTargets(page, driver.targets);
    return allLocalized(results);
  });

  if (!localized.ok) {
    const results = await readAttributeTargets(page, driver.targets);
    throw new Error(
      `[conformance] ${channel.id}@${mode}: 站点更新后的属性未被翻译 — ` +
        `实测 ${JSON.stringify(results)}；期望每个目标字段变为非英文译文` +
        `（修复前 observer 无 attributes 观察，本格必红）`
    );
  }

  // soak 稳定复查
  await page.waitForTimeout(1_500);
  const afterSoak = await readAttributeTargets(page, driver.targets);
  if (!allLocalized(afterSoak)) {
    throw new Error(
      `[conformance] ${channel.id}@${mode}: 属性译文在 soak 后回落 — ${JSON.stringify(afterSoak)}（反馈环或重复写入）`
    );
  }

  return { mode };
}

// ─── 视觉检查点硬断言（visual-checks.mjs programmatic 声明）──

/**
 * 视觉检查点 `content-update-after-expand` 的机械真值断言（newLine 趟）。
 *
 * 复刻 #98 用户可见症状的机械内核：「展开后整段仍是英文」。逐通道检查：
 *   - 译文已覆盖展开后文本（比例 ≥ 阈值）
 *   - 译文区不含 sentinel 原文（未翻译英文片段泄漏）
 *   - 属性通道：目标属性已非英文原值
 * 任一不成立即 throw —— E2E 运行硬失败，而不是等待 AI 视觉审查。
 */
async function assertExpandedBlockShowsTranslation(page) {
  const failures = [];

  for (const channel of ACTIVE_CHANNELS) {
    const driver = CHANNEL_DRIVERS[channel.id];
    if (!driver) {
      failures.push(`${channel.id}: 无驱动器（SSOT 与套件脱节）`);
      continue;
    }

    if (channel.kind === "attribute") {
      const results = await readAttributeTargets(page, driver.targets);
      driver.targets.forEach((target, idx) => {
        const r = results[idx];
        if (!r || r.missing) {
          failures.push(`${channel.id}: 目标元素缺失（${target.selector}）`);
          return;
        }
        for (const [field, english] of Object.entries(target.siteValues)) {
          const v = r.values[field];
          if (!isLocalized(v, [english, target.initialValues?.[field]].filter(Boolean))) {
            failures.push(`${channel.id}.${field}: 未翻译或为空（"${v}"）`);
          }
        }
      });
      continue;
    }

    const m = await measureChannel(page, driver);
    if (!m.ok) {
      failures.push(`${channel.id}: ${m.reason}`);
      continue;
    }
    const gtLen = (m.declaredGt || m.scopeText || "").length;
    if (gtLen <= 0) {
      failures.push(`${channel.id}: ground truth 为空（模拟页声明或驱动失效）`);
      continue;
    }
    const scopeRatio = m.scopeGoogleLen / Math.max(1, gtLen);
    const articleRatio = m.articleGoogleLen / Math.max(1, gtLen);
    if (!(scopeRatio >= SCOPE_RATIO_MIN || articleRatio >= ARTICLE_RATIO_MIN)) {
      failures.push(
        `${channel.id}: 译文未覆盖展开文本（scopeRatio=${scopeRatio.toFixed(2)}, articleRatio=${articleRatio.toFixed(2)}）`
      );
    }
    // 英文泄漏判据只针对译文 span：newLine 模式下源文本来就保留 sentinel
    // （那是正确行为），所以不能拿作用域整体 textContent 判定。
    if (driver.sentinel) {
      const leak = await page.evaluate(({ scopeSel, needle }) => {
        const root = document.querySelector(scopeSel);
        if (!root) return false;
        return [...root.querySelectorAll(".dualtran-google")].some((s) =>
          (s.textContent || "").includes(needle)
        );
      }, { scopeSel: driver.scope, needle: driver.sentinel });
      if (leak) {
        failures.push(`${channel.id}: 译文区含未翻译英文片段「${driver.sentinel}」`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `[conformance] assertExpandedBlockShowsTranslation 失败（${failures.length} 处）：\n${failures.join("\n")}`
    );
  }
}

// ─── 场景入口 ────────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker, testPageUrl } = scope;

  // #94: 场景收尾恢复初始值，防止泄漏进后续场景
  const initialDisplayMode = await readStorage(serviceWorker, "whereToDisplayTranslatedText");

  await writeStorage(serviceWorker, "translateDynamicallyCreatedContent", "yes");
  await writeStorage(serviceWorker, "targetLanguage", "fr");
  await writeStorage(serviceWorker, "dontSortResults", "yes");

  const failures = [];
  // 视觉检查点对：两图必须真实不同（mustDifferFrom），同滚动锚点、同视口。
  const scrollAnchor = async () => {
    await page.evaluate(() => {
      const anchor = document.getElementById("showmore-article");
      if (anchor) anchor.scrollIntoView({ block: "start" });
      window.scrollBy(0, -8);
    });
    await page.waitForTimeout(300);
  };

  try {
    await forEachDisplayMode(scope, async (mode) => {
      console.log(`\n[conformance] ═════ 显示模式: ${mode} ═════`);

      // 每个模式独立导航（避免上一个模式的 DOM/状态污染）
      await page.goto("about:blank");
      await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
      await waitForContentScriptInjected(serviceWorker, page.url());
      await waitForPageTranslatorReady(serviceWorker, page.url());

      // 初始整页翻译
      await sendMessageToTab(serviceWorker, page.url(), {
        action: "translatePage",
        targetLanguage: "fr",
      });

      const ready = await waitUntil(page, async () => {
        if (mode === "replaceOriginal") {
          return (await page.evaluate(() => document.querySelectorAll(".dualtran-result-container").length)) > 0;
        }
        return (await page.evaluate(() => document.querySelectorAll("translated").length)) > 0;
      }, 30_000);
      if (!ready.ok) {
        throw new Error(`[conformance] 初始翻译未完成（mode=${mode}）— 套件前置失效`);
      }
      await page.waitForTimeout(800);

      // ── 视觉检查点：展开前（仅 newLine 一趟，控制时长）──
      if (mode === "newLine") {
        await scrollAnchor();
        await screenshotCheckpoint(page, "content-update-before-expand", { scenario: name });
      }

      // ── 逐通道 × 双模式矩阵 ──
      for (const channel of ACTIVE_CHANNELS) {
        const driver = CHANNEL_DRIVERS[channel.id];
        if (!driver) {
          failures.push(`通道「${channel.id}」没有驱动器 —— SSOT 与套件脱节`);
          continue;
        }
        console.log(`[conformance] ── ${channel.id} @ ${mode}`);
        try {
          if (channel.kind === "attribute") {
            await assertAttributeChannel(page, channel, mode, driver);
          } else {
            await assertTextChannel(page, channel, mode, driver);
          }
          console.log(`[conformance] ${channel.id}@${mode} 通过 ✓`);
        } catch (e) {
          failures.push(e.message);
          console.error(`[FAIL] ${e.message}`);
        }
      }

      // ── 视觉检查点：展开后（仅 newLine 一趟）+ 机械硬断言 ──
      // collect-then-throw（与通道矩阵同纪律）：视觉断言失败不得中断
      // forEachDisplayMode 循环——否则 replaceOriginal 半边整个漏跑，
      // 单格红掩盖其它格（RED 校准实测暴露此缺陷）。
      if (mode === "newLine") {
        try {
          await assertExpandedBlockShowsTranslation(page);
        } catch (e) {
          failures.push(e.message);
          console.error(`[FAIL] ${e.message}`);
        }
        await scrollAnchor();
        await screenshotCheckpoint(page, "content-update-after-expand", { scenario: name });
      }

      // ── 全程无重复（模式感知）──
      try {
        if (mode === "replaceOriginal") {
          await assertReplaceOriginalNoDuplicates(page);
        } else {
          await assertNoDuplicateTranslations(page);
        }
        console.log(`[conformance] ${mode}: 无重复译文 ✓`);
      } catch (e) {
        failures.push(e.message);
        console.error(`[FAIL] ${e.message}`);
      }
    });
  } finally {
    // 场景收尾恢复显示模式（防止泄漏进后续场景）
    await writeStorage(
      serviceWorker,
      "whereToDisplayTranslatedText",
      initialDisplayMode ?? "newLine"
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `[conformance] ${failures.length} 处失败（通道 × 模式矩阵）：\n${failures.join("\n")}`
    );
  }

  console.log(
    `[conformance] 全部通过 ✓（${ACTIVE_CHANNELS.length} 通道 × ${DISPLAY_MODES.length} 模式）`
  );
}
