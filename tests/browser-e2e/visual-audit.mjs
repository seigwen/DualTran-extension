/**
 * DualTran E2E — 视觉审查场景（V1, issue #67）
 *
 * 按 visual-checks.mjs 的检查点清单走一遍完整用户旅程，在每个检查点
 * 等待视觉静止后截图。产物落 /tmp/e2e-shots/visual-audit/<id>.png，
 * 由 CI artifact 上传（14 天），供 Hermes 原生视觉按清单逐图审查
 * （VQ3 ①a + ②c）与失败取证。
 *
 * 覆盖：mock 页（未翻译基线 → Google → AI → 悬停组 → 悬停组 O 激活 →
 * 浮动按钮三态 → replaceOriginal）→ popup 默认态 → options（languages / ai）。
 *
 * 确定性：viewport 由 launchExtensionBrowser() 固定 1280×720 @ DSF=1；
 * 每张截图前 waitForVisualStability（等待动画静止）。
 *
 * 效度演练（VQ5 ②a）：VISUAL_SELFTEST=inject 时对指定检查点注入 CSS
 * 异常（遮挡/移位/隐藏），供分析侧阳性对照；clean 时不做任何注入。
 *
 * @module visual-audit
 */

import {
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  sendMessageToTab,
  screenshotCheckpoint,
  waitForHostState,
  waitForOptionsSelectReady,
  writeStorage,
} from "./setup.mjs";

export const name = "visual-audit";
export const needsMock = true;
export const smoke = false;

/** 效度演练注入形态：inject=注入异常；clean/未设=不注入。 */
const SELFTEST_MODE = process.env.VISUAL_SELFTEST || "clean";

/** 注入记录（ground truth）：分析侧对照用，落 _selftest-groundtruth.json。 */
const injections = [];

/**
 * 配置扩展使 AI 翻译指向 Mock LLM 服务器（与 ai-nav-restore 同款前置）。
 *
 * 不配置时点 AI 按钮不会产生 mock 译文（缺 provider/key → 配置引导路径），
 * after-ai-translation 检查点将拍到一个"AI 高亮但无 AI 文本"的中间态。
 */
async function configureExtensionForAi(serviceWorker, mockServerConfig) {
  await serviceWorker.evaluate(async (apiBase) => {
    await chrome.storage.local.set({
      targetLanguage: "fr",
      targetLanguageTextTranslation: "fr",
      targetLanguages: ["fr", "en", "es"],
      aiProvider: "openrouter",
      apiKeyOpenRouter: "mock-openrouter-key",
      openRouterApiBase: apiBase,
      openRouterModel: "openai/gpt-4o-mini",
      autoImproveByAI: "yes",
      aiImproveForLongerThan: 0,
      showFloatingBtn: "yes",
    });
  }, mockServerConfig.openRouterApiBase);
  console.log("[visual-audit] extension configured for mock AI (openrouter → aimock)");
}

/**
 * 效度演练：按模式向页面注入（或明确不注入）视觉异常。
 *
 * 注入形态与 ground truth 一一对应，记录在返回对象里供分析报告使用。
 * 三种形态轮流注入到三个检查点（遮挡/移位/隐藏各一例）：
 *   - occlude@popup-default:      视口中央不透明覆盖层（遮挡）
 *   - shift@options-languages:    主内容整体右移，左侧截断（错位）
 *   - hidden@after-google-translation: 全部 translated 块隐藏（内容消失）
 */
async function applySelfTestInjection(page, checkpointId) {
  if (SELFTEST_MODE !== "inject") return { injected: null };

  const spec = {
    "popup-default": {
      type: "occlude",
      groundTruth: "full-viewport red overlay occluding all popup content",
    },
    "options-languages": {
      type: "shift",
      groundTruth: "content area shifted 220px right (sidebar overlaps, left edge clipped)",
    },
    "after-google-translation": {
      type: "hidden",
      groundTruth: "all <translated> blocks hidden (translated content invisible)",
    },
  }[checkpointId];
  if (!spec) return { injected: null };

  const injection = await page.evaluate(({ type, cpId }) => {
    if (type === "occlude") {
      const layer = document.createElement("div");
      layer.id = "visual-selftest-injection";
      layer.style.cssText =
        "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(200,30,30,0.85);z-index:2147483647;";
      document.body.appendChild(layer);
    } else if (type === "shift") {
      const el = document.querySelector(".w3-main") || document.querySelector("#languages") || document.body;
      el.id = el.id || "visual-selftest-shifted";
      el.style.transform = "translateX(220px)";
    } else if (type === "hidden") {
      document.querySelectorAll("translated").forEach((t) => {
        t.style.display = "none";
      });
    }
    return { type, checkpoint: cpId };
  }, { type: spec.type, cpId: checkpointId });

  injection.groundTruth = spec.groundTruth;
  console.log(`[visual-selftest] injected ${injection.type} anomaly at "${checkpointId}"`);
  injections.push(injection);
  return { injected: injection };
}

/** 移除效度演练注入。 */
async function clearSelfTestInjection(page) {
  await page.evaluate(() => {
    document.getElementById("visual-selftest-injection")?.remove();
    document.querySelectorAll("translated").forEach((t) => {
      t.style.display = "";
    });
    const shifted = document.getElementById("visual-selftest-shifted");
    if (shifted) shifted.style.transform = "";
  });
}

// ═════════════════════════════════════════════════════════════════
// 保真度硬断言（issue #75 — V2）
//
// 背景：`expect[]` 由 AI 视觉审查消费，而审查**无法让构建失败**。
// 因此凡「机械可判」的期望，必须在捕获场景里同步写成真断言，让 E2E
// 自己失败。以下三个断言对应本次实证违规的三个检查点。
//
// 违规实证（run 35499329775）：baseline 拍到已翻译法语页 + 浮动组；
// replace-original 与 baseline 逐字节相同；after-google 拍到 AI 译文。
// 根因 = 场景间状态污染（cross-level-journey 收尾残留 + storage 未复位）。
// ═════════════════════════════════════════════════════════════════

/**
 * 断言页面处于「未翻译纯净态」（baseline-untranslated 的机械子集）。
 *
 * 判定：不得存在任何 DualTran 生成物 —— 块、译文元素、结果容器、AI span，
 * 且正文不含 mock AI 标记。任一命中即说明页面在上一个场景被污染。
 *
 * @param {import("playwright").Page} page
 */
async function assertBaselinePristine(page) {
  const r = await page.evaluate(() => ({
    blocks: document.querySelectorAll("[data-dualtran-block]").length,
    translated: document.querySelectorAll("translated").length,
    resultContainers: document.querySelectorAll(".dualtran-result-container").length,
    aiSpans: document.querySelectorAll(".dualtran-ai, .dualtran-aitranslatedtext-replacemode").length,
    bodyHasAiSnippet: document.body.innerText.includes("[aimock]"),
  }));
  const offenders = Object.entries(r).filter(([, v]) => (v === true ? true : v > 0));
  if (offenders.length > 0) {
    throw new Error(
      `baseline-untranslated 保真度违规：页面非未翻译纯净态 ` +
        `${JSON.stringify(r)} — 场景间状态污染（issue #75）`
    );
  }
}

/**
 * 断言悬停组 AI 按钮的标签不是被装饰污染的（#83 机械子集）。
 *
 * 用户报告：点 AI 后按钮标签右侧出现一个绿色的 ✓。修复后标签必须保持纯
 * 文本。判定分两层以避免假阳性：
 *   - **无条件**：按钮内不得出现 ✓ 字形，也不得有 success 装饰 span
 *     （任何状态下都成立的不变量）。
 *   - **成功态**：标签必须恰好是 `AI` 且无子元素（该状态的确切形状）。
 * 未处于成功态时不做标签形状断言（该检查点的截图不保证 AI 已到达）。
 *
 * @param {import("playwright").Page} page
 */
async function assertHoverAiButtonHasNoSuccessGlyph(page) {
  const r = await page.evaluate(() => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    const btn = host?.shadowRoot?.querySelector(".dualtran-ai-btn");
    if (!btn) return { missing: true };
    const label = btn.querySelector("span:not(.dualtran-ai-tooltip)");
    return {
      missing: false,
      isSuccess: btn.classList.contains("dualtran-ai-success"),
      labelText: (label?.textContent || "").trim(),
      hasGlyph: (btn.textContent || "").includes("\u2713"),
      checkSpans: btn.querySelectorAll(".dualtran-ai-success-check").length,
      childSpans: label ? label.children.length : -1,
    };
  });
  if (r.missing) throw new Error("#83 保真度违规：悬停组 AI 按钮不存在");
  if (r.hasGlyph || r.checkSpans > 0) {
    throw new Error(
      `#83 保真度违规：AI 按钮标签被 ✓ 装饰污染（用户已要求移除）— ${JSON.stringify(r)}`
    );
  }
  if (r.isSuccess && (r.labelText !== "AI" || r.childSpans !== 0)) {
    throw new Error(
      `#83 保真度违规：AI 成功态标签应为纯 "AI" — ${JSON.stringify(r)}`
    );
  }
}

/**
 * 断言 after-google-translation 拍到的是 Google 译文，**不是** AI 译文。
 *
 * 被 sessionStorage AI 标记污染时，第 2 步的 translatePage 会走 AI 路径，
 * 拍到 `🌐[aimock]` 全文（本次实证）。
 *
 * ⚠️ 关键区分（2026-09-20 实测校准）：newLine 模式下 `.dualtran-ai` span 是
 * **结构容器**——Google 翻译时也会为每个块预先创建（内容为空）。因此判定
 * 不能只看 span 存在（会假阳性），必须要求 **span 内有非空文本且可见**，
 * 或正文出现 mock AI 标记。
 *
 * @param {import("playwright").Page} page
 */
async function assertGoogleNotAi(page) {
  const r = await page.evaluate(() => {
    const aiSpans = [...document.querySelectorAll(".dualtran-ai, .dualtran-aitranslatedtext-replacemode")];
    const withText = aiSpans.filter((s) => (s.textContent || "").trim().length > 0);
    const isVisible = (node) => {
      let n = node;
      while (n && n.style) {
        if (n.style.display === "none" || n.style.visibility === "hidden") return false;
        n = n.parentElement;
      }
      return true;
    };
    return {
      translated: document.querySelectorAll("translated").length,
      aiSpans: aiSpans.length,
      aiSpansWithText: withText.length,
      aiVisibleWithText: withText.filter(isVisible).length,
      bodyHasAiSnippet: document.body.innerText.includes("[aimock]"),
    };
  });
  if (r.translated === 0) {
    throw new Error(
      `after-google-translation 保真度违规：页面无任何译文（translated=0）— ` +
        `Google 翻译未生效或页面被提前复位（issue #75）`
    );
  }
  if (r.aiVisibleWithText > 0 || r.bodyHasAiSnippet) {
    throw new Error(
      `after-google-translation 保真度违规：拍到 AI 译文而非 Google 译文 ` +
        `${JSON.stringify(r)} — sessionStorage AI 标记污染（issue #75）`
    );
  }
}

/**
 * 断言 replace-original-mode 的截图与 baseline-untranslated **不同**。
 *
 * 这是 #75 的直接指纹：污染时两者逐字节相同（页面早已是 replaceOriginal
 * 全译文态，第 7 步的操作产生了与 baseline 相同的结果）。
 *
 * 判定用文件 sha256 前 16 hex（与 scripts/visual-review.mjs 的 fileHash 同
 * 语义）。baseline 文件缺失时跳过（只 warning，不误报）。
 *
 * @param {string} baselinePath
 * @param {string} replacePath
 */
async function assertReplaceOriginalDiffersFromBaseline(baselinePath, replacePath) {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
  try {
    const [a, b] = [hash(baselinePath), hash(replacePath)];
    if (a === b) {
      throw new Error(
        `replace-original-mode 保真度违规：与 baseline-untranslated 截图逐字节相同 ` +
          `(sha256:${a}) — 该检查点未改变页面状态，场景间状态污染（issue #75）`
      );
    }
  } catch (err) {
    if (err.message?.includes("保真度违规")) throw err;
    console.warn(`[visual-audit] 保真度指纹跳过（文件不可读）：${err.message}`);
  }
}

/**
 * 场景入口。
 *
 * @param {Object} scope - setupFull() 返回的作用域对象
 */
export async function run(scope) {
  const { page, serviceWorker, testPageUrl, extensionId, mockServerConfig, collector } = scope;

  // ── 阶段 0：配置 mock AI（provider/apiBase/key）──────────
  await configureExtensionForAi(serviceWorker, mockServerConfig);

  // ── 阶段 1：mock 页视觉旅程 ─────────────────────────────
  await page.goto("about:blank");
  await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await page.waitForTimeout(300);

  // checkpoint 1: 未翻译基线
  await assertBaselinePristine(page);
  const baselineShot = await screenshotCheckpoint(page, "baseline-untranslated", { scenario: name });

  // checkpoint 2: Google 译文
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });
  await page.waitForFunction(() => document.querySelectorAll("translated").length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await assertGoogleNotAi(page);
  await applySelfTestInjection(page, "after-google-translation");
  await screenshotCheckpoint(page, "after-google-translation", { scenario: name });
  await clearSelfTestInjection(page);

  // checkpoint 3: AI 译文（mock provider）
  await page.evaluate(() => {
    document.getElementById("dualtran-floating-btn-host")?.shadowRoot?.getElementById("btnAi")?.click();
  });
  // mock 输出标记（aimock 固定响应）出现即 AI 完成
  await page
    .waitForFunction(
      (snippet) => document.body.innerText.includes(snippet),
      mockServerConfig?.expectedAiSnippet || "[aimock]",
      { timeout: 60000 }
    )
    .catch(() => console.warn("[visual-audit] AI snippet wait timed out; capturing anyway"));
  await page.waitForTimeout(500);
  await screenshotCheckpoint(page, "after-ai-translation", { scenario: name });

  // checkpoint 4: 悬停组可见（悬停已注册块）
  await page.evaluate(() => {
    const el = document.querySelector("[data-dualtran-block]") || document.querySelector("translated");
    if (!el) throw new Error("visual-audit: no translated block to hover");
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  await waitForHostState(page, "singleton", "healthy", { label: "visual-audit: hover group" });
  await page.waitForTimeout(250);
  // #83：悬停组 AI 按钮标签不得带 ✓ 成功装饰（用户报告场景的机械子集）
  await assertHoverAiButtonHasNoSuccessGlyph(page);
  await screenshotCheckpoint(page, "hover-group-visible", { scenario: name });

  // checkpoint 5: 悬停组 → 点 Original（组仍显示，O 激活）
  await page.evaluate(() => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    host?.shadowRoot?.querySelector(".dualtran-original-btn")?.click();
    // 点击后重新悬停以保组可见
    const el = document.querySelector("[data-dualtran-block]") || document.querySelector("translated");
    el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await screenshotCheckpoint(page, "hover-group-original-mode", { scenario: name });

  // checkpoint 6: 浮动按钮三态循环后停在 AI（O → G → A）
  for (const btnId of ["btnOriginal", "btnGoogle", "btnAi"]) {
    await page.evaluate((id) => {
      document.getElementById("dualtran-floating-btn-host")?.shadowRoot?.getElementById(id)?.click();
    }, btnId);
    await page.waitForTimeout(600);
  }
  await screenshotCheckpoint(page, "floating-three-state", { scenario: name });

  // checkpoint 7: replaceOriginal 模式
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "restorePage",
  }).catch(() => {});
  await page.waitForTimeout(300);
  await writeStorage(serviceWorker, "whereToDisplayTranslatedText", "replaceOriginal");
  await sendMessageToTab(serviceWorker, page.url(), {
    action: "translatePage",
    targetLanguage: "fr",
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".dualtran-result-container").length > 0,
    null,
    { timeout: 30000 }
  ).catch(() => console.warn("[visual-audit] replaceOriginal wait timed out; capturing anyway"));
  await page.waitForTimeout(500);
  const replaceShot = await screenshotCheckpoint(page, "replace-original-mode", { scenario: name });
  // 保真度指纹：replaceOriginal 必须与 baseline 不同（#75 直接指纹）
  if (baselineShot?.path && replaceShot?.path) {
    await assertReplaceOriginalDiffersFromBaseline(baselineShot.path, replaceShot.path);
  } else {
    console.warn("[visual-audit] 保真度指纹跳过：截图路径不可用（screenshotCheckpoint 返回 null）");
  }

  // ── 效度演练注入（如启用）───────────────────────────────
  // 在 popup 截图上做注入演示（不影响 mock 页检查点的干净产物）
  // （注入的 checkpoint 与 ground truth 会写入报告供阳性对照）

  // ── 阶段 2：popup 默认态 ────────────────────────────────
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
  await waitForOptionsSelectReady(page, "selectTargetLanguage").catch(() => {});
  await page.waitForTimeout(600);
  await applySelfTestInjection(page, "popup-default");
  await screenshotCheckpoint(page, "popup-default", { scenario: name });
  await clearSelfTestInjection(page);

  // ── 阶段 3：options ────────────────────────────────────
  await page.goto(`chrome-extension://${extensionId}/options/options.html#languages`, { waitUntil: "load" });
  await waitForOptionsSelectReady(page, "selectTargetLanguage").catch(() => {});
  await page.waitForTimeout(600);
  await applySelfTestInjection(page, "options-languages");
  await screenshotCheckpoint(page, "options-languages", { scenario: name });
  await clearSelfTestInjection(page);

  await page.goto(`chrome-extension://${extensionId}/options/options.html#ai`, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await screenshotCheckpoint(page, "options-ai", { scenario: name });

  // 效度演练 ground truth 落盘（分析侧对照：注入的位置/类型/期望）
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { shotsRootDir } = await import("./setup.mjs");
  const shotsDir = join(shotsRootDir(), name);
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(
    join(shotsDir, "_selftest-groundtruth.json"),
    JSON.stringify({ mode: SELFTEST_MODE, injections }, null, 2)
  );

  console.log(`--- visual-audit: all checkpoints captured (selftest=${SELFTEST_MODE}) ---`);
}
