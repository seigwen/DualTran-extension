/**
 * journey-explorer.mjs — 种子化旅程探索器（plan 51 P2-C 落地；探针报告见
 * DualTran-manage/52 号，落地报告 54 号）。
 *
 * 目标：把「高亮/显示不符」家族的发现渠道从「用户实机」前移到「机器常规」——
 * 对 mock SPA 对（spa-source ↔ spa-target，Turbo 语义）执行有界旅程：每步动作
 * 后等收敛，再用 assertUiStateMatchesEngine（v3：SSOT/派生 + DOM 高亮 + 可见
 * 真相交叉核对）检查「静止不变量」；持久违反即场景失败并留档。
 *
 * ── 校准纪律（修改本文件前必读）──
 * 定向种子集（tests/shared/journeyPlanner.mjs 的 DIRECTED_SEEDS）中的 S1 是
 * #152 校准锚：pre-fix 构建上必红（持久分裂：高亮 google / 页面 AI），master
 * 上必绿。任何行为改动（收敛判定 / 动作 / 断言）必须先做双构建校准再合并
 * （doc 52 §3/§6；证据范本 evidence/plan51、plan52）。
 *
 * ── 运行 ──
 *   npm run test:e2e:explorer                          # 默认：定向种子 S1–S4
 *   EXPLORER_DIRECTED=full npm run test:e2e:explorer   # 全部六条定向种子
 *   EXPLORER_DIRECTED=off EXPLORER_SEEDS=11,22 EXPLORER_DEPTH=8 ...  # 纯加权随机
 *   EXPLORER_SCRIPT="click:ai,advance,click:google,back" ...  # 临时脚本（| 分隔多条）
 *
 * 产物：<e2e-shots>/journey-explorer-<tag>.json（全量轨迹 + 摘要）；违反时另含
 * store 日志尾部与可见真相 dump。
 */
import fs from "node:fs";
import path from "node:path";
import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  readVisibleTruthInPage,
  dumpUiStateLog,
  assertUiStateMatchesEngine,
  resetScenarioState,
  shotsRootDir,
} from "./setup.mjs";
import {
  DIRECTED_SEEDS,
  DEFAULT_SEED_IDS,
  planRandomJourney,
  isValidPlan,
} from "../shared/journeyPlanner.mjs";

export const name = "journey-explorer";
export const needsMock = true;
export const smoke = false;

const SETTLE_BUDGET_MS = parseInt(process.env.EXPLORER_SETTLE_MS || "12000", 10);
const DEPTH = parseInt(process.env.EXPLORER_DEPTH || "8", 10);
const DIRECTED_MODE = process.env.EXPLORER_DIRECTED || "default"; // default | full | off
const RANDOM_SEEDS = (process.env.EXPLORER_SEEDS || "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !Number.isNaN(n));
const SCRIPTS = (process.env.EXPLORER_SCRIPT || "")
  .split("|")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.split(",").map((x) => x.trim()).filter(Boolean));
const TAG = process.env.EXPLORER_TAG || `run-${Date.now()}`;

const shortUrl = (u) => {
  try {
    return new URL(u).pathname;
  } catch {
    return String(u).slice(0, 40);
  }
};

/** 扩展配置：AI 走 mock、目标语言 fr、newLine 模式（与 ai-nav-restore 同款）。 */
async function configureExtensionForExplorer(serviceWorker, mockServerConfig) {
  await serviceWorker.evaluate(async (apiBase) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguageTextTranslation: "fr",
      targetLanguages: ["fr", "en", "es"],
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      aiImproveForLongerThan: 0,
      showFloatingBtn: "yes",
      whereToDisplayTranslatedText: "newLine",
    });
  }, mockServerConfig.openRouterApiBase);
  console.log("  Extension configured: provider=openrouter (mock), targetLanguage=fr, newLine mode");
}

/** 点击悬浮按钮组（shadow root 内按 id）。 */
async function clickFloating(page, id) {
  const ok = await page
    .evaluate((btnId) => {
      const el = document
        .getElementById("dualtran-floating-btn-host")
        ?.shadowRoot?.getElementById(btnId);
      if (!el) return false;
      el.click();
      return true;
    }, id)
    .catch(() => false);
  await page.waitForTimeout(300);
  return ok;
}

/** goBack 之后可能落在 about:blank（无历史时）——恢复到 SPA 源页。 */
async function recoverIfBlank(c) {
  if (!c.page.url().startsWith("about:")) return false;
  await c.page.goto(c.scope.spaSourceUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  await waitForContentScriptInjected(c.serviceWorker, c.page.url()).catch(() => {});
  await waitForPageTranslatorReady(c.serviceWorker, c.page.url()).catch(() => {});
  return true;
}

const ACTIONS = {
  "click:ai": { run: async (c) => ({ clicked: await clickFloating(c.page, "btnAi") }) },
  "click:google": { run: async (c) => ({ clicked: await clickFloating(c.page, "btnGoogle") }) },
  "click:original": { run: async (c) => ({ clicked: await clickFloating(c.page, "btnOriginal") }) },
  advance: {
    run: async (c) => {
      const before = c.page.url();
      const clicked = await c.page
        .evaluate(() => {
          const link = document.getElementById("test-link") || document.getElementById("back-link");
          if (!link) return null;
          link.click();
          return link.id;
        })
        .catch(() => null);
      await c.page.waitForFunction((prev) => location.href !== prev, before, { timeout: 8000 }).catch(() => {});
      await c.page.waitForTimeout(500);
      await recoverIfBlank(c);
      await waitForContentScriptInjected(c.serviceWorker, c.page.url()).catch(() => {});
      return { clicked };
    },
  },
  back: {
    run: async (c) => {
      const before = c.page.url();
      await c.page.goBack({ timeout: 8000 }).catch(() => null);
      await c.page.waitForFunction((prev) => location.href !== prev, before, { timeout: 8000 }).catch(() => {});
      await c.page.waitForTimeout(500);
      const recovered = await recoverIfBlank(c);
      return { recovered };
    },
  },
  forward: {
    run: async (c) => {
      const before = c.page.url();
      await c.page.goForward({ timeout: 8000 }).catch(() => null);
      await c.page.waitForFunction((prev) => location.href !== prev, before, { timeout: 8000 }).catch(() => {});
      await c.page.waitForTimeout(500);
      const recovered = await recoverIfBlank(c);
      return { recovered };
    },
  },
  reload: {
    run: async (c) => {
      await c.page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await waitForContentScriptInjected(c.serviceWorker, c.page.url()).catch(() => {});
      await waitForPageTranslatorReady(c.serviceWorker, c.page.url()).catch(() => {});
      await c.page.waitForTimeout(400);
      return {};
    },
  },
};

/**
 * 收敛判定（稳定性三读）：动作后 800ms 起轮询，签名（页语言态|AI 态|意图|块数）
 * 连续三次相同才算静止；loading 不收敛；预算 12s 超时 → 由 check 归入 stuck。
 * 初版「双读即收敛」曾在跨页后抓到瞬态窗假阳性（doc 52 §4）——勿简化回去。
 */
async function settle(c) {
  await c.page.waitForTimeout(800);
  const t0 = Date.now();
  let prevSig = null;
  let stableCount = 0;
  let last = null;
  while (Date.now() - t0 < SETTLE_BUDGET_MS) {
    let st = null;
    let blocks = -1;
    try {
      st = await sendMessageToTab(c.serviceWorker, c.page.url(), { action: "getCurrentUiState" });
    } catch (_) {}
    try {
      blocks = await c.page.evaluate(() => document.querySelectorAll("translated,[data-dualtran-block]").length);
    } catch (_) {}
    last = st;
    const busy = !st || st.aiRenderState === "loading" || st.pageRenderState === "loading";
    const sig = st ? `${st.pageLanguageState}|${st.aiRenderState}|${st.aiModeActive}|${blocks}` : null;
    if (!busy && sig && sig === prevSig) {
      stableCount += 1;
      if (stableCount >= 2) return { settled: true, state: st };
    } else {
      stableCount = 0;
    }
    prevSig = sig;
    await c.page.waitForTimeout(450);
  }
  return { settled: false, state: last };
}

/** 把 assert 失败消息归入 premise（前提未满足）/ stuck（无法收敛）/ invariant。 */
function classifyError(msg) {
  if (/needs >=3 visible blocks/.test(msg)) return "premise";
  if (/still (loading|error) after 8s/.test(msg)) return "stuck";
  return "invariant";
}

/** 静止不变量：translated 页走可见真相交叉核对；original 页走基础一致性。 */
async function check(c) {
  const u = c.page.url();
  if (u.startsWith("about:") || !u.startsWith("http")) return { ok: true, kind: "skip-offsite" };
  let engine = null;
  try {
    engine = await sendMessageToTab(c.serviceWorker, u, { action: "getCurrentUiState" });
  } catch (e) {
    return { ok: false, kind: "engine-read", detail: String((e && e.message) || e), engine: null };
  }
  if (!engine || typeof engine.pageLanguageState !== "string") {
    return { ok: false, kind: "engine-read", detail: JSON.stringify(engine), engine: null };
  }
  try {
    if (engine.pageLanguageState === "translated") {
      await assertUiStateMatchesEngine(c.page, c.serviceWorker, { expectTranslated: true, expectVisible: true });
    } else {
      await assertUiStateMatchesEngine(c.page, c.serviceWorker, {});
    }
    return { ok: true, engine };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { ok: false, kind: classifyError(msg), detail: msg, engine };
  }
}

/**
 * 读取悬浮按钮组当前高亮（与 ai-nav-restore 同实现；A3 契约要求导航场景
 * 读取真实高亮而非仅断言 SSOT）。
 */
async function getFloatingBtnHighlight(page) {
  return page
    .evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const root = host?.shadowRoot || null;
      const read = (id) => !!root?.getElementById(id)?.classList.contains("dualtran-floating-btn-active");
      if (read("btnOriginal")) return "original";
      if (read("btnGoogle")) return "google";
      if (read("btnAi")) return "ai";
      return null;
    })
    .catch(() => null);
}

/** 单条旅程：重置状态 → 落到源页 → 逐步执行 + 收敛 + 不变量检查。 */
async function runJourney(c, label, plan) {
  const steps = [];
  let violation = null;
  await resetScenarioState(c.scope);
  await c.page.goto(c.scope.spaSourceUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  await waitForContentScriptInjected(c.serviceWorker, c.page.url()).catch(() => {});
  await waitForPageTranslatorReady(c.serviceWorker, c.page.url()).catch(() => {});
  await c.page.waitForTimeout(400);

  for (let i = 0; i < plan.length; i++) {
    const actionName = plan[i];
    const action = ACTIONS[actionName];
    if (!action) continue;
    let runErr = null;
    let runInfo = null;
    try {
      runInfo = await action.run(c);
    } catch (e) {
      runErr = String((e && e.message) || e);
    }
    const settled = await settle(c);
    const chk = await check(c);
    const step = {
      i,
      action: actionName,
      url: shortUrl(c.page.url()),
      settled: settled.settled,
      ok: chk.ok,
      kind: chk.kind || null,
      detail: chk.detail ? String(chk.detail).slice(0, 600) : null,
      runErr,
      runInfo: runInfo || null,
      highlight: await getFloatingBtnHighlight(c.page),
      engineAfter: chk.engine || settled.state || null,
    };
    steps.push(step);
    console.log(
      `  [${label} ${i + 1}/${plan.length}] ${actionName} @${step.url} settled=${step.settled} hl=${step.highlight} ${
        chk.ok ? "✓" : "✗(" + step.kind + ") " + (step.detail || "").slice(0, 200)
      }`
    );
    if (!chk.ok && chk.kind !== "premise" && chk.kind !== "skip-offsite") {
      // 稳定性复核：+5s 后重查——区分「持久性分裂」与「瞬时采样窗」（doc 52 §4）。
      await c.page.waitForTimeout(5000);
      const recheck = await check(c);
      step.recheckAfter5s = {
        ok: recheck.ok,
        kind: recheck.kind || null,
        detail: recheck.detail ? String(recheck.detail).slice(0, 300) : null,
      };
      if (recheck.ok) {
        step.ok = true;
        step.kind = "transient-recovered";
        step.detail = (step.detail || "") + " [recovered after +5s recheck]";
        console.log(`  [${label} ${i + 1}] ⚠ transient window: recovered after +5s — not counted as violation`);
      } else if (!violation) {
        violation = step;
      }
    }
  }

  if (violation) {
    try {
      await dumpUiStateLog(c.serviceWorker, c.page.url(), `journey-explorer/${label}`);
    } catch (_) {}
    try {
      violation.visibleTruth = await c.page.evaluate(readVisibleTruthInPage);
    } catch (_) {}
    try {
      violation.storeLogTail = (
        await sendMessageToTab(c.serviceWorker, c.page.url(), { action: "getFloatingUiStateLog" })
      )?.slice(-25);
    } catch (_) {}
  }
  return { seed: label, plan, steps, violation };
}

/** 组装旅程清单：定向种子（default/full/off）+ 临时脚本 + 加权随机种子。 */
function buildJourneyList() {
  const journeys = [];
  if (DIRECTED_MODE !== "off") {
    const seeds =
      DIRECTED_MODE === "full"
        ? DIRECTED_SEEDS
        : DIRECTED_SEEDS.filter((s) => DEFAULT_SEED_IDS.includes(s.id));
    for (const s of seeds) journeys.push({ label: s.id, plan: s.plan });
  }
  SCRIPTS.forEach((plan, i) => journeys.push({ label: `script-${i + 1}`, plan }));
  for (const seed of RANDOM_SEEDS) {
    journeys.push({ label: `seed-${seed}`, plan: planRandomJourney(seed, DEPTH) });
  }
  for (const j of journeys) {
    if (!isValidPlan(j.plan)) {
      throw new Error(`journey-explorer: invalid plan for "${j.label}": ${JSON.stringify(j.plan)}`);
    }
  }
  return journeys;
}

/** 场景入口（run-all 接口：name/needsMock/smoke/run）。 */
export async function run(scope) {
  const { page, serviceWorker } = scope;
  await configureExtensionForExplorer(serviceWorker, scope.mockServerConfig);

  const c = { page, serviceWorker, scope };
  const journeys = buildJourneyList();
  console.log(`[journey-explorer] ${journeys.length} journey(s): ${journeys.map((j) => j.label).join(", ")}`);
  if (journeys.length === 0) {
    throw new Error("journey-explorer: no journeys configured (DIRECTED_MODE=off and no seeds/scripts)");
  }

  const result = { tag: TAG, startedAt: new Date().toISOString(), journeys: [], summary: {} };
  for (const j of journeys) {
    console.log(`\n▶ ${j.label}: [${j.plan.join(" → ")}]`);
    const journey = await runJourney(c, j.label, j.plan);
    result.journeys.push(journey);
    console.log(
      `  ${j.label} verdict: ${journey.violation ? "VIOLATION" : "clean"} (${journey.steps.length} steps)`
    );
  }

  const violations = result.journeys.filter((j) => j.violation);
  const totalSteps = result.journeys.reduce((s, j) => s + j.steps.length, 0);
  const settledSteps = result.journeys.reduce((s, j) => s + j.steps.filter((x) => x.settled).length, 0);
  result.summary = {
    journeys: result.journeys.length,
    totalSteps,
    settleRate: totalSteps ? +(settledSteps / totalSteps).toFixed(3) : 0,
    violations: violations.length,
    violationDetails: violations.map((j) => ({
      seed: j.seed,
      kind: j.violation.kind,
      detail: j.violation.detail,
      plan: j.plan,
    })),
  };
  console.log("\n──── journey-explorer SUMMARY ────");
  console.log(JSON.stringify(result.summary, null, 2));

  fs.mkdirSync(shotsRootDir(), { recursive: true });
  const artifactPath = path.join(shotsRootDir(), `journey-explorer-${TAG}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2));
  console.log(`full trace → ${artifactPath}`);

  if (violations.length > 0) {
    const digest = violations
      .map((j) => `${j.seed}@step${j.violation.i}(${j.violation.kind}): ${String(j.violation.detail || "").slice(0, 220)}`)
      .join(" | ");
    throw new Error(
      `journey-explorer: ${violations.length} persistent violation(s) — ${digest} — artifact: ${artifactPath}`
    );
  }
}
