/**
 * reasoning-depth E2E 场景 — 推理深度端到端实锤。
 *
 * 这个场景证明的不是「控件渲染了」，而是**用户选的深度真的变成了 HTTP 请求体里的
 * 参数字段**：
 *
 *   1. 写配置（provider=openrouter → openai-compatible 回退；reasoningDepth=high）
 *   2. 走真实链路触发 AI 翻译（内容脚本 → port → SW → AI SDK → mock HTTP）
 *   3. 读 mock 服务器的 /request-log，断言请求体里出现 reasoning_effort: "high"
 *   4. 对照格：Default（""）下请求体**不得**含任何 reasoning 字段
 *      （证明该字段由我们的代码注入，而不是 mock 的固定行为）
 *
 * RED 能力：改动前请求体里没有任何 reasoning 字段 → RD1 必红。
 *
 * @module reasoning-depth
 */

import {
  readStorage,
  writeStorage,
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  assertNoDuplicateTranslationElements,
} from "./setup.mjs";

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 场景名称 */
export const name = "reasoning-depth";

/** 需要 Mock LLM 服务器（断言请求体） */
export const needsMock = true;

/** 不纳入 smoke 子集（含 AI 翻译全链路） */
export const smoke = false;

// ─── 常量 ────────────────────────────────────────────────────────

const PROVIDER = "openrouter";
const MODEL = "openai/gpt-4o-mini";

/** mock 服务器根 URL（去掉 provider 路径段） */
function mockBase(scope) {
  return scope.mockServerConfig.openRouterApiBase.replace(/\/openrouter\/v1$/, "");
}

async function fetchRequestLog(scope) {
  const resp = await fetch(`${mockBase(scope)}/request-log`);
  if (!resp.ok) throw new Error(`[reasoning-depth] /request-log 读取失败: HTTP ${resp.status}`);
  const payload = await resp.json();
  return Array.isArray(payload?.requests) ? payload.requests : [];
}

async function resetRequestLog(scope) {
  await fetch(`${mockBase(scope)}/request-log/reset`, { method: "POST" });
}

/** 提取 chat/completions 请求的 body（已解析对象） */
function chatBodies(requests) {
  return requests
    .filter((r) => r.method === "POST" && /chat\/completions/.test(r.pathname || ""))
    .map((r) => {
      if (r.body && typeof r.body === "object") return r.body;
      try { return JSON.parse(r.body); } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * 走真实用户链路触发一次 AI 翻译：
 *   Google 翻译 → 点击浮动按钮组的 AI 按钮 → 内容脚本发起 AI 请求。
 * 与 translation.mjs 的 verifyAiTranslation 同一路径。
 */
async function triggerAiTranslation(page, serviceWorker, testPageUrl) {
  // 拦截并关闭可能的 prompt（配置未及时传播时内容脚本会弹 prompt，阻塞 Playwright）
  if (!page.__reasoningDepthDialogHooked) {
    page.__reasoningDepthDialogHooked = true;
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
  }

  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());

  // 1) Google 翻译（AI 按钮附着在译文节点上）
  await sendMessageToTab(serviceWorker, page.url(), { action: "translatePage", targetLanguage: "fr" });
  await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 30000 });

  // 2) 点击 AI 按钮（触发真实 AI 请求）
  await page.waitForFunction(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    return !!host?.shadowRoot?.getElementById("btnAi");
  }, null, { timeout: 10000 });
  await page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    host?.shadowRoot?.getElementById("btnAi")?.click();
  });
}

/** 等待 mock 收到至少一个 chat/completions 请求，返回请求体数组 */
async function waitForChatBodies(page, scope, timeoutMs = 45_000) {
  const start = Date.now();
  let bodies = [];
  while (Date.now() - start < timeoutMs) {
    bodies = chatBodies(await fetchRequestLog(scope));
    if (bodies.length > 0) break;
    await page.waitForTimeout(500);
  }
  return bodies;
}

// ─── 步骤 ───────────────────────────────────────────────────────

/**
 * [RD1] 深度 high → mock 收到的请求体里必须有 reasoning_effort: "high"
 */
async function rd1DepthReachesRequestBody(page, serviceWorker, scope) {
  console.log("[RD1] 推理深度 high 必须出现在 mock 收到的请求体中...");

  const providerConfigs = (await readStorage(serviceWorker, "providerConfigs")) || {};
  providerConfigs[PROVIDER] = {
    ...(providerConfigs[PROVIDER] || {}),
    apiKey: "mock-...ey",
    apiBase: scope.mockServerConfig.openRouterApiBase,
    model: MODEL,
    reasoningDepth: "high",
  };
  await writeStorage(serviceWorker, "providerConfigs", providerConfigs);
  await writeStorage(serviceWorker, "aiProvider", PROVIDER);
  await writeStorage(serviceWorker, "enableAiTranslationCache", "no");

  await resetRequestLog(scope);
  await triggerAiTranslation(page, serviceWorker, scope.testPageUrl);

  const bodies = await waitForChatBodies(page, scope);
  if (bodies.length === 0) {
    throw new Error("[RD1] mock 服务器没有收到任何 chat/completions 请求（AI 翻译链路未打通）");
  }

  const withEffort = bodies.filter((b) => b.reasoning_effort === "high");
  if (withEffort.length === 0) {
    const seen = bodies.map((b) => Object.keys(b).join(",")).join(" | ");
    throw new Error(
      `[RD1] 没有任何请求体携带 reasoning_effort:"high" —— 推理深度没有到达 HTTP 层。已见请求体的字段: ${seen}`
    );
  }
  console.log(`  [RD1] ${withEffort.length}/${bodies.length} 个请求体携带 reasoning_effort:"high" ✓`);
  console.log("[RD1] 通过 ✓\n");
}

/**
 * [RD2] 对照组：Default（""）不得携带任何 reasoning 字段
 */
async function rd2DefaultSendsNoReasoningField(page, serviceWorker, scope) {
  console.log("[RD2] Default 深度不得携带 reasoning 字段（对照组）...");

  const providerConfigs = (await readStorage(serviceWorker, "providerConfigs")) || {};
  providerConfigs[PROVIDER] = { ...(providerConfigs[PROVIDER] || {}), reasoningDepth: "" };
  await writeStorage(serviceWorker, "providerConfigs", providerConfigs);
  await writeStorage(serviceWorker, "enableAiTranslationCache", "no");

  await resetRequestLog(scope);
  await triggerAiTranslation(page, serviceWorker, scope.testPageUrl);

  const bodies = await waitForChatBodies(page, scope);
  if (bodies.length === 0) {
    throw new Error("[RD2] 对照组没有收到请求（AI 翻译链路未打通）");
  }

  const withReasoningField = bodies.filter((b) => Object.keys(b).some((k) => /reasoning/i.test(k)));
  if (withReasoningField.length > 0) {
    throw new Error(
      `[RD2] Default 深度下仍有请求携带 reasoning 字段: ${JSON.stringify(withReasoningField[0]).slice(0, 300)}`
    );
  }
  console.log(`  [RD2] ${bodies.length} 个请求体均无 reasoning 字段 ✓`);
  console.log("[RD2] 通过 ✓\n");
}

/** Clean up after the scenario so the shared page is not left AI-translated.
 *
 * Why this is mandatory (learned in CI, not locally): this scenario leaves the
 * shared test page in a fully AI-translated state, and the content script records
 * a per-URL `dualtran:aiApplied:` sessionStorage marker. The runner's
 * `resetScenarioState` clears sessionStorage on `about:blank` — where the test
 * origin's storage is unreachable — so the marker survives, and the next scenario
 * that loads the same page (visual-audit) gets it auto-restored into a translated
 * state, failing its `baseline-untranslated` pristine check.
 *
 * The check at the end is deliberately hard: if a fresh visit is not pristine, the
 * blame belongs to THIS scenario (the one that dirtied the shared page), not to the
 * unrelated scenario that trips over it next.
 */
async function cleanupTranslationState(page, serviceWorker, testPageUrl) {
  // 1) Drop the per-URL AI-restore marker (the mechanism that re-translates the page).
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    try {
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith("dualtran:aiApplied:")) sessionStorage.removeItem(k);
      }
      sessionStorage.clear();
    } catch (_) { /* restricted context */ }
  });

  // 2) Restore the DOM (belt-and-braces: leaves the live page clean too).
  await sendMessageToTab(serviceWorker, page.url(), { action: "restorePage" }).catch(() => {});
  await page.waitForTimeout(500);

  // 3) Verify the invariant visual-audit depends on: a FRESH visit is pristine.
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const left = await page.evaluate(() => ({
    translated: document.querySelectorAll("translated").length,
    aiSpans: document.querySelectorAll(".dualtran-ai, .dualtran-aitranslatedtext-replacemode").length,
    resultContainers: document.querySelectorAll(".dualtran-result-container").length,
    bodyHasAiSnippet: document.body.innerText.includes("[aimock]"),
    markers: (() => { try { return Object.keys(sessionStorage).filter((k) => k.startsWith("dualtran:")); } catch { return []; } })(),
  }));
  const offenders = Object.entries(left).filter(([, v]) => (v === true ? true : Array.isArray(v) ? v.length > 0 : v > 0));
  if (offenders.length > 0) {
    throw new Error(
      `[reasoning-depth] 场景收尾失败：共享页在全新访问下仍非未翻译纯净态 ` +
        `${JSON.stringify(left)} —— 本场景必须自行清理，否则会污染后续场景（issue #75 家族）`
    );
  }
  console.log("  [cleanup] 全新访问下共享页保持未翻译纯净态 ✓");
}

// ─── 主入口 ─────────────────────────────────────────────────────

export async function run(scope) {
  const { page, serviceWorker } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  const stepErrors = [];
  async function runStep(stepName, fn) {
    try {
      await fn();
    } catch (err) {
      stepErrors.push({ step: stepName, error: err });
      console.error(`  [${stepName}] 失败: ${err.message}`);
    }
  }

  await runStep("RD1", () => rd1DepthReachesRequestBody(page, serviceWorker, scope));
  await runStep("RD2", () => rd2DefaultSendsNoReasoningField(page, serviceWorker, scope));

  // 翻译不变量：不得留下重复译文元素
  await assertNoDuplicateTranslationElements(page).catch((err) => {
    stepErrors.push({ step: "duplicate-elements", error: err });
  });

  // 场景边界复位（必须做——见 cleanupTranslationState 的注释）
  await cleanupTranslationState(page, serviceWorker, scope.testPageUrl);

  if (stepErrors.length > 0) {
    const summary = stepErrors.map((e) => `${e.step}: ${e.error.message}`).join("\n  ");
    throw new Error(`reasoning-depth 场景有 ${stepErrors.length} 个步骤失败:\n  ${summary}`);
  }

  console.log(`--- 场景通过: "${name}" ---`);
}
