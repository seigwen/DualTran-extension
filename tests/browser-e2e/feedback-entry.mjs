/**
 * DualTran E2E — 用户反馈通道场景（plan 35）
 *
 * 覆盖 5 个步骤 (F1–F5)：
 *   F1: options#feedback 区块结构（nav 项/标题/按钮/链接，含裸键残留负向）
 *   F2: GitHub 按钮 → 新标签 URL 逐参数断言（template/version/browser/os；
 *       静态路径不得预填 service——不猜会误导）
 *   F3: 复制诊断 → 剪贴板内容 + 按钮文案切换 + 红线负向（假 key 标记不得出现）
 *   F4: popup 反馈行 → options.html#feedback（同款下划线行，tabs.create）
 *   F5: ⚠ 一步直达：apiBase 指向已释放端口（连接拒绝 → 确定性 AI 错误）
 *       → 等 .dualtran-block-error[data-type="ai"] → 点击 → URL 含
 *       service/additional（hostname + Error 行）→ finally 恢复配置
 *
 * 设计约束：
 *   - 只断言 GitHub URL 形态，不加载外网（hermetic）；URL 断言后立即关闭新标签。
 *   - F5 的确定性错误注入不依赖 mock 服务器（连接拒绝是即时终态）——
 *     但本场景注册 needsMock=false，用 setupBasic 的静态页面服务器。
 *   - 红线（plan 35 §3.6）：任何产物不得携带 API key / API base / 完整 URL。
 *
 * @module feedback-entry
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  readStorageMulti,
} from "./setup.mjs";

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 场景名称（用于 --scenario / --grep 筛选） */
export const name = "feedback-entry";

/** 不需要 Mock LLM 服务器（F5 用连接拒绝注入确定性错误） */
export const needsMock = false;

/** 不纳入 smoke 子集（F5 涉及真实错误注入 + 配置恢复） */
export const smoke = false;

/** bug_report.yml 的静态预填 URL 前缀（供逐参数断言） */
const ISSUE_URL_PREFIX = "https://github.com/seigwen/DualTran-extension/issues/new?";

/**
 * 已释放端口：绑定后立即关闭，连接必被拒绝（确定性错误注入配方）。
 * @returns {Promise<number>}
 */
async function findReleasedPort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * 从新标签的最终 URL 提取「我们点出去的预填 URL」。
 *
 * 两种形态都算通过：
 *   1. 直接命中预填 URL（保持登录态 / 网络未重定向）
 *   2. 未登录浏览器落 GitHub 登录墙（/login?return_to=…）——原 URL 以
 *      URL-encoded 形式乘载在 return_to 里，解码后仍可对预填逐参数断言。
 *      这正是真实用户的经历（计划 §8 登录墙边界），而不是测试妥协。
 *
 * @param {string} rawUrl
 * @returns {string|null} 可断言的预填 URL，或 null（不是我们的目标）
 */
function extractPrefillUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl === "") return null;
  if (rawUrl.startsWith(ISSUE_URL_PREFIX)) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.hostname === "github.com" && u.pathname === "/login") {
      const ret = u.searchParams.get("return_to");
      if (ret && ret.startsWith(ISSUE_URL_PREFIX)) return ret;
    }
  } catch {
    /* unparseable URL — not our target */
  }
  return null;
}

/**
 * 等待点击后新开的目标标签出现并解析出预填 URL（含登录墙重定向上限 8s）。
 *
 * @param {import("playwright").BrowserContext} context
 * @param {Set<import("playwright").Page>} beforeSet - 点击前的页面集合
 * @returns {Promise<{page: import("playwright").Page, url: string}|null>}
 */
async function waitForPrefillTab(context, beforeSet, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const fresh = context.pages().filter((p) => !beforeSet.has(p));
    for (const p of fresh) {
      const extracted = extractPrefillUrl(p.url());
      if (extracted) return { page: p, url: extracted };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

// ─── F1: options#feedback 结构 ──────────────────────────────────

async function f1FeedbackSectionStructure(page, extensionId) {
  console.log("[F1] options#feedback 区块结构...");

  await page.goto(`chrome-extension://${extensionId}/options/options.html#feedback`, {
    waitUntil: "load",
  });
  await page.waitForTimeout(600);

  const r = await page.evaluate(() => {
    const section = document.getElementById("feedback");
    const navLink = document.querySelector('nav a[href="#feedback"]');
    return {
      sectionExists: !!section,
      sectionVisible: !!section && section.style.display !== "none",
      otherHidden: document.getElementById("languages")?.style.display === "none",
      navExists: !!navLink,
      navHighlighted: !!navLink && navLink.classList.contains("w3-light-grey"),
      headline: (section?.querySelector("b")?.textContent ?? "").trim(),
      issueLabel: (document.getElementById("btnOpenIssueForm")?.textContent ?? "").trim(),
      copyLabel: (document.getElementById("btnCopyDiagnostics")?.textContent ?? "").trim(),
      emailHref: document.getElementById("feedbackEmailLink")?.getAttribute("href") ?? "",
      storeHref: document.getElementById("feedbackStoreLink")?.getAttribute("href") ?? "",
    };
  });

  if (!r.sectionExists || !r.navExists) {
    throw new Error("[F1] #feedback 区块或导航项缺失");
  }
  if (!r.sectionVisible || !r.navHighlighted) {
    throw new Error(
      `[F1] #feedback 未随 hash 打开（visible=${r.sectionVisible}, highlighted=${r.navHighlighted}）`
    );
  }
  if (!r.otherHidden) {
    throw new Error("[F1] 打开 #feedback 时其他 tab 未隐藏（hash 切换机制不完整）");
  }
  for (const [field, text] of [
    ["headline", r.headline],
    ["issueLabel", r.issueLabel],
    ["copyLabel", r.copyLabel],
  ]) {
    if (text === "") {
      throw new Error(`[F1] ${field} 文本为空（#85 同族）`);
    }
    if (/^(lbl|btn|msg)[A-Z]/.test(text)) {
      // 裸键残留：可能是 en 回退（合法）或未本地化（缺陷）——此处只拒绝键串形态
      throw new Error(`[F1] ${field} 显示裸 i18n 键 "${text}"`);
    }
  }
  if (!r.emailHref.startsWith("mailto:seigwen@gmail.com")) {
    throw new Error(`[F1] 邮件链接形态错误: "${r.emailHref}"`);
  }
  if (!r.storeHref.includes("chromewebstore.google.com") || !r.storeHref.includes("/support")) {
    throw new Error(`[F1] 商店支持链接形态错误: "${r.storeHref}"`);
  }

  console.log(`[F1] 通过 ✓（headline="${r.headline}"）\n`);
}

// ─── F2: GitHub 按钮 → 预填 URL ─────────────────────────────────

async function f2IssueFormButton(page, context) {
  console.log("[F2] GitHub 反馈表单按钮...");

  const beforeSet = new Set(context.pages());
  await page.click("#btnOpenIssueForm");

  // 新标签可能落在两个形态之一：直连预填 URL，或未登录浏览器的 GitHub
  // 登录墙（/login?return_to=<预填 URL>）。两种形态都解析回预填 URL 断言。
  const found = await waitForPrefillTab(context, beforeSet);
  if (!found) {
    throw new Error("[F2] 点击后没有新标签打开预填表单（tabs.create 未生效）");
  }

  const { page: newPage, url } = found;

  try {
    const params = new URL(url).searchParams;
    if (params.get("template") !== "bug_report.yml") {
      throw new Error(`[F2] template 参数错误: "${params.get("template")}"`);
    }
    const version = params.get("extension-version");
    if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
      throw new Error(`[F2] extension-version 缺失或形态错误: "${version}"`);
    }
    if (!["Chrome", "Edge", "Brave", "Firefox", "Other"].includes(params.get("browser"))) {
      throw new Error(`[F2] browser 参数不在表单选项内: "${params.get("browser")}"`);
    }
    if (!params.get("os")) {
      throw new Error("[F2] os 参数缺失");
    }
    // 静态路径不得预填 service（无法可靠判定 —— 预填错误值会误导分诊）
    if (params.has("service")) {
      throw new Error(`[F2] 静态路径不应预填 service（实际 "${params.get("service")}"）`);
    }
    console.log(
      `[F2] URL 参数断言通过 ✓ (version=${version}, browser=${params.get("browser")}, os=${params.get("os")})`
    );
  } finally {
    // hermetic：不加载外网，断言后立即关闭新标签
    await newPage.close().catch(() => {});
  }

  console.log("[F2] 通过 ✓\n");
}

// ─── F3: 复制诊断信息 ────────────────────────────────────────────

async function f3CopyDiagnostics(page) {
  console.log("[F3] 复制诊断信息...");

  // 种入假哨兵（红线负向：任何产物不得含哨兵）
  await page.evaluate(() => {
    navigator.clipboard.writeText = (text) => {
      window.__copiedText = text;
      return Promise.resolve();
    };
  });

  const before = await page.evaluate(
    () => document.getElementById("btnCopyDiagnostics")?.textContent ?? ""
  );
  await page.click("#btnCopyDiagnostics");
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => ({
    copied: window.__copiedText ?? "",
    after: (document.getElementById("btnCopyDiagnostics")?.textContent ?? "").trim(),
  }));

  if (!result.copied) {
    throw new Error("[F3] 剪贴板写入未发生（clipboard.writeText 未被调用）");
  }
  if (!result.copied.includes("DualTran: ")) {
    throw new Error(`[F3] 诊断块缺少版本行: "${result.copied.slice(0, 200)}"`);
  }
  if (!/Browser: /.test(result.copied) || !/OS: /.test(result.copied)) {
    throw new Error(`[F3] 诊断块缺少 Browser/OS 行: "${result.copied.slice(0, 200)}"`);
  }
  if (result.copied.includes("SENTINEL")) {
    throw new Error("[F3] 红线违规：诊断块携带哨兵标记（API key / base 泄漏）");
  }
  if (result.after === before || result.after === "") {
    throw new Error(`[F3] 按钮文案未切换为「已复制」（before="${before}", after="${result.after}"）`);
  }

  // 还原剪贴板桩（避免污染后续场景）
  await page.evaluate(() => {
    delete window.__copiedText;
    delete navigator.clipboard.writeText;
  });

  console.log(`[F3] 通过 ✓（copied ${result.copied.length} chars, label "${result.after}"）\n`);
}

// ─── F4: popup 反馈行 ────────────────────────────────────────────

async function f4PopupEntry(page, extensionId, context) {
  console.log("[F4] popup 反馈行...");

  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
  await page.waitForTimeout(800);

  const rowExists = await page.evaluate(
    () => !!document.getElementById("cbReportProblem")
  );
  if (!rowExists) {
    throw new Error("[F4] popup 缺少 #cbReportProblem 反馈行");
  }
  const label = await page.evaluate(
    () => (document.getElementById("cbReportProblem")?.textContent ?? "").trim()
  );
  if (label === "" || /^(lbl|btn|msg)[A-Z]/.test(label)) {
    throw new Error(`[F4] 反馈行标签异常: "${label}"`);
  }

  const pagesBefore = context.pages().length;
  await page.click("#cbReportProblem");
  await page.waitForTimeout(1500);

  const pagesAfter = context.pages();
  if (pagesAfter.length <= pagesBefore) {
    throw new Error("[F4] 点击后没有新标签打开");
  }
  const newPage = pagesAfter[pagesAfter.length - 1];
  const url = newPage.url();
  try {
    if (!url.includes("/options/options.html#feedback")) {
      throw new Error(`[F4] 新标签 URL 错误: "${url}"`);
    }
    console.log(`[F4] 新标签 URL 正确 ✓ (${url})`);
  } finally {
    await newPage.close().catch(() => {});
  }

  console.log("[F4] 通过 ✓\n");
}

// ─── F5: ⚠ 一步直达（确定性错误 → 点击 → 预填 URL）─────────────────

async function f5ErrorIconDirectPath(page, serviceWorker, extensionId, testPageUrl) {
  console.log("[F5] ⚠ 一步直达（连接拒绝 → 确定性错误 → 点击）...");

  // 0. 保存原配置（finally 恢复）
  const originalConfig = await readStorageMulti(serviceWorker, [
    "aiProvider",
    "apiKeyOpenRouter",
    "openRouterApiBase",
    "openRouterModel",
    "targetLanguage",
    "showFloatingBtn",
  ]);

  // 1. 已释放端口 → openrouter 指向它 → 连接必被拒绝
  const releasedPort = await findReleasedPort();
  await serviceWorker.evaluate(
    async ({ port }) => {
      await chrome.storage.local.set({
        targetLanguage: "fr",
        showFloatingBtn: "yes",
        aiProvider: "openrouter",
        apiKeyOpenRouter: "mock-openrouter-key",
        openRouterApiBase: `http://127.0.0.1:${port}`,
        openRouterModel: "openai/gpt-4o-mini",
      });
    },
    { port: releasedPort }
  );
  console.log(`  [F5] openrouter apiBase → http://127.0.0.1:${releasedPort}（已释放）`);

  try {
    // 2. 导航 + 等就绪
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
    await waitForContentScriptInjected(serviceWorker, page.url());
    await waitForPageTranslatorReady(serviceWorker, page.url());

    // 3. 点击页面级 AI 按钮（触发 AI 翻译 → 连接拒绝 → 错误图标）
    await page.waitForFunction(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      return !!host?.shadowRoot?.getElementById("btnAi");
    }, null, { timeout: 10_000 });
    const clicked = await page.evaluate(() => {
      const host = document.getElementById("dualtran-floating-btn-host");
      const btnAi = host?.shadowRoot?.getElementById("btnAi");
      if (!btnAi) return false;
      btnAi.click();
      return true;
    });
    if (!clicked) {
      throw new Error("[F5] 未找到 #btnAi");
    }

    // 4. 等确定性错误图标（连接拒绝是即时终态）
    await page.waitForFunction(
      () => !!document.querySelector('.dualtran-block-error[data-type="ai"]'),
      null,
      { timeout: 30_000 }
    );
    console.log("  [F5] AI 错误图标已出现");

    // 5. 点 ⚠ → 一步直达预填表单（新标签；同样可能落在登录墙 return_to）
    const beforeSet = new Set(page.context().pages());
    await page.evaluate(() => {
      const icon = document.querySelector('.dualtran-block-error[data-type="ai"]');
      if (!icon) throw new Error("no ai error icon");
      icon.click();
    });

    const found = await waitForPrefillTab(page.context(), beforeSet);
    if (!found) {
      throw new Error("[F5] 点击 ⚠ 后没有新标签打开预填表单（一步直达断链）");
    }
    const { page: newPage, url } = found;

    try {
      const params = new URL(url).searchParams;
      if (params.get("template") !== "bug_report.yml") {
        throw new Error(`[F5] template 错误: "${params.get("template")}"`);
      }
      if (params.get("service") !== "AI Translation (Other)") {
        // openrouter → Other（表单四选项外的 provider 归 Other）
        throw new Error(`[F5] service 错误: "${params.get("service")}"`);
      }
      const additional = params.get("additional") ?? "";
      if (!additional.includes("Hostname: ")) {
        throw new Error(`[F5] additional 缺少 Hostname 行: "${additional}"`);
      }
      if (!additional.includes("Language pair: ")) {
        throw new Error(`[F5] additional 缺少 Language pair 行: "${additional}"`);
      }
      if (!additional.includes("Error: ")) {
        throw new Error(`[F5] additional 缺少 Error 行: "${additional}"`);
      }
      if (!additional.includes("AI provider: ")) {
        throw new Error(`[F5] additional 缺少 AI provider 行: "${additional}"`);
      }
      console.log(`  [F5] 预填 URL 断言通过 ✓ (service="${params.get("service")}")`);
    } finally {
      await newPage.close().catch(() => {});
    }
  } finally {
    // 6. 恢复原配置
    await serviceWorker.evaluate(async (orig) => {
      const setObj = {};
      for (const k of [
        "aiProvider",
        "apiKeyOpenRouter",
        "openRouterApiBase",
        "openRouterModel",
        "targetLanguage",
        "showFloatingBtn",
      ]) {
        if (orig[k] !== null && orig[k] !== undefined) setObj[k] = orig[k];
      }
      await chrome.storage.local.set(setObj);
    }, originalConfig).catch((restoreErr) => {
      console.warn(`  [F5] ⚠ 恢复配置失败: ${restoreErr.message}`);
    });
    console.log("  [F5] 原配置已恢复");
  }

  console.log("[F5] 通过 ✓\n");
}

// ═══════════════════════════════════════════════════════════════
// run(scope) — 场景主入口
// ═══════════════════════════════════════════════════════════════

/**
 * @param {Object} scope - setupBasic() 返回的作用域对象
 * @param {import("playwright").Page} scope.page
 * @param {string} scope.extensionId
 * @param {import("playwright").Worker} scope.serviceWorker
 * @param {import("playwright").BrowserContext} scope.context
 * @param {string} scope.testPageUrl
 * @param {import("./setup.mjs").ErrorCollector} scope.collector
 */
export async function run(scope) {
  const { page, extensionId, serviceWorker, context, testPageUrl, collector } = scope;
  collector.attachPage(page, name);
  collector.attachServiceWorker(serviceWorker);

  console.log("┌────────────────────────────────────────────────┐");
  console.log("│  feedback-entry (plan 35 entry set + prefills) │");
  console.log("└────────────────────────────────────────────────┘");

  const stepErrors = [];
  async function runStep(stepName, fn) {
    try {
      await fn();
    } catch (err) {
      stepErrors.push({ step: stepName, error: err });
      console.error(`  [${stepName}] 失败: ${err.message}`);
      if (err.stack) console.error(`  [${stepName}] 堆栈: ${err.stack}`);
    }
  }

  await runStep("F1", () => f1FeedbackSectionStructure(page, extensionId));
  await runStep("F2", () => f2IssueFormButton(page, context));
  await runStep("F3", () => f3CopyDiagnostics(page));
  await runStep("F4", () => f4PopupEntry(page, extensionId, context));
  await runStep("F5", () => f5ErrorIconDirectPath(page, serviceWorker, extensionId, testPageUrl));

  console.log(`\n=== 场景 "feedback-entry" 执行完毕（失败 ${stepErrors.length}/5）===`);
  if (stepErrors.length > 0) {
    for (const { step, error } of stepErrors) {
      collector.record(`feedback-entry:${step}`, error.message);
    }
    throw new Error(
      `场景 "feedback-entry" 有 ${stepErrors.length} 个步骤失败: ${stepErrors
        .map((e) => e.step)
        .join(", ")}`
    );
  }
  console.log('=== 场景 "feedback-entry" 全部通过 ===\n');
}
