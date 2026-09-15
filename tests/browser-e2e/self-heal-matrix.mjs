/**
 * DualTran E2E — 失败态自愈矩阵（S2, issue #49）
 *
 * 目的：把「失败态 → 触发 → 自愈」证明为**矩阵**，而不是一次性 bug 回归。
 * 注入用 DOM 形状直造（injectHostState），不重放多步导航旅程——快一个数量级，
 * 且被测触发点可显式 poke。
 *
 * 矩阵（每格独立导航加载，互不污染）：
 *   floating  × {absent, detached, shell, duplicate} × {popstate 显式 / 静默 observer 被动}
 *           + healthy 对照（popstate → 同实例不重建，标记属性法）
 *   singleton × {absent, detached, shell, duplicate} × {悬停显式 / 静默负向控制}
 *           + healthy 对照（悬停 → 同实例不重建，标记属性法）
 *
 * 统一断言：
 *   显式行   → count===1 ∧ healthy（singleton 另加「已定位」）
 *   floating 静默行 → observer 被动触发 → count===1 ∧ healthy
 *   singleton 静默行 → 负向控制：无交互 → **不鬼重建**，状态保持注入态
 *                      （锁定 singleton 的懒触发契约）
 *
 * 层次分工：E2E 证「态可达 + 可愈」；路径级归因在单元层
 * （E2E 里 observer 必被注入 mutation 被动触发，无法与显式触发严格分离）。
 *
 * 边界：句柄状态（null / 陈旧）无法从页面注入——absent 与 detached 在 DOM
 * 层同形（无 host），两行各自成行验证「无 host → 触发 → 恢复」；句柄维度
 * 归单元层（jsdom）。
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  writeStorage,
  sendMessageToTab,
  readHostState,
  injectHostState,
} from "./setup.mjs";

export const name = "self-heal-matrix";
export const needsMock = false;
export const smoke = false;

const HOST_IDS = {
  floating: "dualtran-floating-btn-host",
  singleton: "dualtran-singleton-btn-host",
};

/** 注入后 DOM 形状期望：count + 首匹配三态分类。 */
const INJECTED_SHAPE = {
  absent: { count: 0, state: "absent" },
  detached: { count: 0, state: "absent" },
  shell: { count: 1, state: "shell" },
  duplicate: { count: 2, state: "healthy" },
};

function fail(label, message) {
  throw new Error(`[self-heal] ${label}: ${message}`);
}

function assertShape(label, actual, expected) {
  if (actual.count !== expected.count || actual.state !== expected.state) {
    fail(
      label,
      `injection produced unexpected DOM shape — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

/**
 * 断言「恢复后」的单实例健康态。
 * @param {string} label
 * @param {{count: number, state: string}} host
 * @param {boolean} requirePositioned singleton 额外要求（-9999px 停驻 = 未定位）
 */
function assertRecovered(label, host, requirePositioned) {
  if (host.count !== 1) fail(label, `expected exactly 1 host after recovery, got ${host.count}`);
  if (host.state !== "healthy") fail(label, `expected healthy host after recovery, got state="${host.state}"`);
  if (!host.hasButtons) fail(label, "recovered host has no buttons inside its shadow root");
}

async function waitForTranslator(page, serviceWorker, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
}

/** 加载页面并等待 floating host 就绪（showFloatingBtn 已在 storage 中启用）。 */
async function loadWithFloatingHost(page, serviceWorker, url) {
  await waitForTranslator(page, serviceWorker, url);
  await page.waitForFunction(
    (id) => {
      const host = document.querySelector(id);
      return !!(host && host.shadowRoot);
    },
    `#${HOST_IDS.floating}`,
    { timeout: 15000 }
  );
}

/** 加载并翻译页面，等待 singleton host 就绪（翻译完成 → ensureSingletonInit）。 */
async function loadWithSingletonHost(page, serviceWorker, url) {
  await waitForTranslator(page, serviceWorker, url);
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });
  await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    (id) => {
      const host = document.querySelector(id);
      return !!(host && host.shadowRoot);
    },
    `#${HOST_IDS.singleton}`,
    { timeout: 15000 }
  );
}

/** floating 的显式触发：popstate（200ms debounce）。 */
async function pokePopstate(page) {
  await page.evaluate(() => window.dispatchEvent(new Event("popstate")));
}

/** singleton 的显式触发：在 <translated> 上派发冒泡 mouseover（hover 委托）。 */
async function pokeHover(page) {
  await page.evaluate(() => {
    const el = document.querySelector("translated");
    if (!el) throw new Error("no <translated> element to hover");
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

/** 在 host 上留标记属性，用于断言「同一实例、未重建」。 */
async function markHost(page, component) {
  return page.evaluate((id) => {
    const host = document.getElementById(id);
    if (!host) throw new Error(`markHost: #${id} not found`);
    host.setAttribute("data-e2e-marker", "keep-me");
  }, HOST_IDS[component]);
}

async function markerSurvived(page, component) {
  return page.evaluate(
    ({ id, attr }) => document.getElementById(id)?.getAttribute(attr) === "keep-me",
    { id: HOST_IDS[component], attr: "data-e2e-marker" }
  );
}

/**
 * floating：4 失败态 × {显式 popstate / 静默 observer 被动} + healthy 对照。
 */
async function runFloatingMatrix(page, serviceWorker, url) {
  console.log("[self-heal] floating matrix (4 states × 2 triggers + healthy control)");

  for (const state of ["absent", "detached", "shell", "duplicate"]) {
    // ── 显式 popstate 行 ──
    let label = `floating/${state}/popstate`;
    await loadWithFloatingHost(page, serviceWorker, url);
    let injected = await injectHostState(page, "floating", state);
    assertShape(label, injected, INJECTED_SHAPE[state]);
    await pokePopstate(page);
    await page.waitForTimeout(800); // 200ms debounce + rebuild margin
    let host = await readHostState(page, "floating");
    assertRecovered(label, host);
    console.log(`  ${label}: recovered → 1 healthy ✓`);

    // ── 静默 observer 被动行（注入本身是 mutation，observer 300ms debounce） ──
    label = `floating/${state}/observer-passive`;
    await loadWithFloatingHost(page, serviceWorker, url);
    injected = await injectHostState(page, "floating", state);
    assertShape(label, injected, INJECTED_SHAPE[state]);
    await page.waitForTimeout(1200); // no explicit poke — observer must notice
    host = await readHostState(page, "floating");
    assertRecovered(label, host);
    console.log(`  ${label}: recovered → 1 healthy ✓`);
  }

  // ── healthy 对照组：功能完好 → 触发不得重建（同一实例） ──
  const label = "floating/healthy/popstate-no-rebuild";
  await loadWithFloatingHost(page, serviceWorker, url);
  const before = await readHostState(page, "floating");
  assertShape(`${label}/precondition`, before, { count: 1, state: "healthy" });
  await markHost(page, "floating");
  await pokePopstate(page);
  await page.waitForTimeout(800);
  const after = await readHostState(page, "floating");
  assertShape(`${label}/count`, after, { count: 1, state: "healthy" });
  if (!(await markerSurvived(page, "floating"))) {
    fail(label, "healthy host was rebuilt even though it was functional (marker attribute lost)");
  }
  console.log(`  ${label}: same instance kept ✓`);
}

/**
 * singleton：4 失败态 × {悬停显式 / 静默负向控制} + healthy 对照。
 */
async function runSingletonMatrix(page, serviceWorker, url) {
  console.log("[self-heal] singleton matrix (4 states × 2 triggers + healthy control)");

  for (const state of ["absent", "detached", "shell", "duplicate"]) {
    // ── 显式悬停行 ──
    let label = `singleton/${state}/hover`;
    await loadWithSingletonHost(page, serviceWorker, url);
    let injected = await injectHostState(page, "singleton", state);
    assertShape(label, injected, INJECTED_SHAPE[state]);
    await pokeHover(page);
    await page.waitForTimeout(600);
    let host = await readHostState(page, "singleton");
    assertRecovered(label, host);
    const positioned = await page.evaluate(
      (id) => document.getElementById(id)?.style.top !== "-9999px",
      HOST_IDS.singleton
    );
    if (!positioned) fail(label, "recovered singleton host was not positioned (still parked at -9999px)");
    console.log(`  ${label}: recovered → 1 healthy + positioned ✓`);

    // ── 静默负向控制行：无交互 → 必须保持注入态（懒触发契约，不鬼重建） ──
    label = `singleton/${state}/silent-no-ghost-rebuild`;
    await loadWithSingletonHost(page, serviceWorker, url);
    injected = await injectHostState(page, "singleton", state);
    assertShape(label, injected, INJECTED_SHAPE[state]);
    await page.waitForTimeout(1000); // no hover — nothing may self-heal
    host = await readHostState(page, "singleton");
    assertShape(label, host, INJECTED_SHAPE[state]);
    console.log(`  ${label}: state preserved (no ghost rebuild) ✓`);
  }

  // ── healthy 对照组：功能完好 → 悬停不得重建（同一实例） ──
  const label = "singleton/healthy/hover-no-rebuild";
  await loadWithSingletonHost(page, serviceWorker, url);
  const before = await readHostState(page, "singleton");
  assertShape(`${label}/precondition`, before, { count: 1, state: "healthy" });
  await markHost(page, "singleton");
  await pokeHover(page);
  await page.waitForTimeout(600);
  const after = await readHostState(page, "singleton");
  assertShape(`${label}/count`, after, { count: 1, state: "healthy" });
  if (!(await markerSurvived(page, "singleton"))) {
    fail(label, "healthy singleton host was rebuilt even though it was functional (marker attribute lost)");
  }
  console.log(`  ${label}: same instance kept ✓`);
}

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, collector } = scope;

  console.log("\n════════════════════════════════════════════");
  console.log("  Failure-State Self-Heal Matrix E2E (S2)");
  console.log("════════════════════════════════════════════\n");

  await collector.collectExtensionErrors(page, scope.extensionId);

  // 两组件的 host 都需要显式开启浮动按钮 + 真实翻译
  await writeStorage(serviceWorker, "showFloatingBtn", "yes");

  try {
    await runFloatingMatrix(page, serviceWorker, testPageUrl);
    await runSingletonMatrix(page, serviceWorker, testPageUrl);
    console.log("\n  All self-heal matrix cells passed.\n");
  } catch (err) {
    console.error(`\n  SELF-HEAL MATRIX FAILED: ${err.message}\n`);
    throw err;
  }
}
