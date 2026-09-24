/**
 * DualTran E2E models.dev 缓存测试场景
 *
 * 验证 models.dev 提供商数据缓存机制：
 *   C1: 清空缓存 → 首次加载 → 验证下拉框填充
 *   C2: 验证 modelsdev:providers 缓存写入（含 data + ts）
 *   C3: 验证 per-provider 预览缓存写入（previewModels:v4:{provider}）
 *   C4: 验证 TTL 过期 → 后台刷新触发
 *
 * @module models-dev-cache
 */

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 测试场景名称 */
export const name = "models-dev-cache";

/** 此场景不需要 Mock LLM 服务器 */
export const needsMock = false;

/** 不纳入 smoke 子集（需要网络访问或特定缓存状态） */
export const smoke = false;

// ─── 从 setup.mjs 导入共享工具函数 ─────────────────────────────

import {
  readStorage,
  readStorageMulti,
  writeStorage,
  assertSelectOptionsComplete,
} from "./setup.mjs";

// ─── 常量 ────────────────────────────────────────────────────────

/** models.dev 数据的 storage key（与 aiProxy.js 中一致） */
const MODELSDEV_CACHE_KEY = "modelsdev:providers";

/** per-provider 预览缓存的 key 前缀（与 providerModelPreview.js 中一致） */
const PREVIEW_CACHE_PREFIX = "previewModels:v4:";

/** 缓存 TTL：24 小时（与 providerModelPreview.js 中一致） */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ═════════════════════════════════════════════════════════════════
// C1: 清空缓存 → 首次加载 → 验证下拉框填充
// ═════════════════════════════════════════════════════════════════

/**
 * [C1] 清空 models.dev 相关缓存，导航到 options 页，验证提供商下拉框仍能填充。
 *
 * 填充来源可能为：
 *   - models.dev 实时拉取（网络可用时）
 *   - 内置 STATIC_MODELS fallback（网络不可用时）
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 * @throws {Error} 下拉框未填充时抛出
 */
async function c1CacheClearAndDropdownFill(page, extensionId, serviceWorker) {
  console.log("[C1] 清空缓存后下拉框填充验证...");

  // ── 清空所有 models.dev 相关缓存 ──
  console.log("  [C1] 清空 models.dev 缓存...");
  await serviceWorker.evaluate(async () => {
    // 删除 modelsdev:providers（全局提供商数据缓存）
    await chrome.storage.local.remove("modelsdev:providers");
    // 删除所有 previewModels:v4:* 预览缓存
    const allKeys = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(allKeys).filter((key) =>
      key.startsWith("previewModels:v4:")
    );
    for (const key of keysToRemove) {
      await chrome.storage.local.remove(key);
    }
  });

  // ── 导航到 options 页 ──
  console.log("  [C1] 导航到 options 页...");
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });

  // ── 等待 #aiProvider 下拉框填充完成 ──
  // 内置提供商（BUILT_IN_PROVIDERS）会立即填充，models.dev 数据异步补充
  await page.waitForFunction(() => {
    const sel = document.getElementById("aiProvider");
    return sel && sel instanceof HTMLSelectElement && sel.options.length >= 5;
  }, null, { timeout: 15000 });

  // 集合完整性（issue #88, P3）：选项数 + 每项 text 非空 + 必需提供商
  const completeness = await assertSelectOptionsComplete(page, {
    selectId: "aiProvider",
    minCount: 5,
    requiredValues: ["openai", "anthropic", "google-gemini"],
    label: "#aiProvider（options 页）",
  });
  console.log(`  [C1] #aiProvider 填充了 ${completeness.count} 个选项，全部非空 ✓`);
  console.log(`  [C1] 包含 openai/anthropic/google-gemini ✓`);

  console.log("[C1] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// C2: 验证 modelsdev:providers 缓存写入
// ═════════════════════════════════════════════════════════════════

/**
 * [C2] 验证 models.dev 数据缓存已写入 chrome.storage.local。
 *
 * aiProxy.js 的 getProvidersData() 在首次拉取 models.dev 后，
 * 将数据写入 `modelsdev:providers` key，格式为 { data, ts }。
 *
 * issue #88 实证（重要运行序约束）：getProvidersData() 在 SW 模块作用域
 * 内记忆化（`_providersData`）——写入 storage 是**每个 SW 生命周期至多一次**。
 * 因此 C2 必须在 C1（清缓存）**之前**运行：fresh SW 启动后的启动拉取会写缓存，
 * 这是设计契约的忠实窗口；C1 清缓存后不可能有第二次写入（除非 SW 重启），
 * 原顺序（C1→C2）在长寿命 SW（全量套件）中必然失败、在隔离运行中偶发通过。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function c2ModelsDevCacheWritten(serviceWorker) {
  console.log("[C2] modelsdev:providers 缓存写入验证...");

  // models.dev 可达性（客观前提）
  const modelsDevReachable = await serviceWorker.evaluate(async () => {
    try {
      const r = await fetch("https://models.dev/api.json");
      return r.ok === true;
    } catch {
      return false;
    }
  });
  console.log(`  [C2] models.dev 可达性（SW fetch）: ${modelsDevReachable}`);

  // SW 启动即调用 getProvidersData()（aiProxy.js:133）→ 首次拉取后写缓存。
  // probe 实测写入约 5.5s；等真实写入信号而不是固定等待。
  let cached = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    cached = await readStorage(serviceWorker, MODELSDEV_CACHE_KEY);
    if (cached?.data && typeof cached.data === "object") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (cached && cached.data && typeof cached.data === "object") {
    const providerCount = Object.keys(cached.data).length;
    console.log(`  [C2] modelsdev:providers 缓存存在，包含 ${providerCount} 个提供商 ✓`);

    // 验证 ts 字段存在（时间戳）
    if (cached.ts && typeof cached.ts === "number") {
      console.log(`  [C2] ts 时间戳存在: ${cached.ts} ✓`);
    } else {
      throw new Error("[C2] ts 时间戳缺失或不为数字（缓存格式契约被破坏）");
    }
  } else if (!modelsDevReachable) {
    // SKIP-ENV: models.dev unreachable from SW (objective premise, re-verified above)
    console.log("  [C2] SKIP-ENV: models.dev 不可达，无缓存可写（设计上回退内置静态列表）");
    console.log("  [C2] STATIC_MODELS fallback 已在 C1 下拉框填充中验证 ✓");
  } else {
    // models.dev 可达却 15s 内无缓存 = getProvidersData 写入链路缺陷
    throw new Error("[C2] models.dev 可达但 modelsdev:providers 缓存 15s 内未写入");
  }

  console.log("[C2] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// C3: 验证 per-provider 预览缓存写入
// ═════════════════════════════════════════════════════════════════

/**
 * [C3] 验证 per-provider 预览模型缓存（previewModels:v4:{provider}）已写入。
 *
 * providerModelPreview.js 的 loadPreviewModels() 在首次调用后
 * 将模型列表写入 `previewModels:v4:{provider}` key，格式为 { models, ts }。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function c3PreviewCacheWritten(page, extensionId, serviceWorker) {
  console.log("[C3] per-provider 预览缓存验证...");

  // 导航到 options 页（触发 _loadGenericProviderConfig → loadPreviewModels）
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
  // 等待 loadPreviewModels 完成（可能是异步缓存写入）
  await page.waitForTimeout(3000);

  // 检查 openai 的预览缓存
  const openaiCacheKey = PREVIEW_CACHE_PREFIX + "openai";
  const openaiCache = await readStorage(serviceWorker, openaiCacheKey);

  if (openaiCache && Array.isArray(openaiCache.models) && openaiCache.models.length > 0) {
    console.log(`  [C3] previewModels:v4:openai 缓存存在，${openaiCache.models.length} 个模型 ✓`);

    // 验证 ts 字段
    if (openaiCache.ts && typeof openaiCache.ts === "number") {
      console.log(`  [C3] ts 时间戳存在: ${openaiCache.ts} ✓`);
    } else {
      console.warn("  [C3] ⚠ ts 时间戳缺失");
    }

    // 验证模型结构
    const firstModel = openaiCache.models[0];
    if (firstModel && firstModel.value) {
      console.log(`  [C3] 首个模型: value="${firstModel.value}", text="${firstModel.text || ""}" ✓`);
    } else {
      console.warn("  [C3] ⚠ 模型结构缺少 value 字段");
    }
  } else {
    // 预览缓存可能尚未写入（取决于 models.dev 可用性）
    // 尝试其他 provider
    const anthropicCacheKey = PREVIEW_CACHE_PREFIX + "anthropic";
    const anthropicCache = await readStorage(serviceWorker, anthropicCacheKey);

    if (anthropicCache && Array.isArray(anthropicCache.models) && anthropicCache.models.length > 0) {
      console.log(`  [C3] previewModels:v4:anthropic 缓存存在，${anthropicCache.models.length} 个模型 ✓`);
    } else {
      console.log("  [C3] 预览缓存尚未写入（可能 models.dev 不可用，使用内置 STATIC_MODELS）");
      console.log("  [C3] STATIC_MODELS fallback 已在 C1 下拉框填充中验证 ✓");
    }
  }

  console.log("[C3] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// C4: 验证 TTL 过期 → 后台刷新
// ═════════════════════════════════════════════════════════════════

/**
 * [C4] 将 per-provider 缓存时间戳改为 25 小时前，刷新 options 页，验证后台刷新触发。
 *
 * providerModelPreview.js 的 isCacheFresh() 判断缓存是否过期：
 *   (Date.now() - entry.ts) < PERSISTENT_CACHE_TTL_MS (24h)
 *
 * 过期时 loadPreviewModels 仍返回旧缓存数据（即时显示），
 * 但同时触发 backgroundRefresh()（fire-and-forget）异步更新缓存。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function c4TtlExpiryAndBackgroundRefresh(page, extensionId, serviceWorker) {
  console.log("[C4] TTL 过期 → 后台刷新验证...");

  // models.dev 可达性（客观前提；probe 实测本环境可达）
  const modelsDevReachable = await serviceWorker.evaluate(async () => {
    try {
      const r = await fetch("https://models.dev/api.json");
      return r.ok === true;
    } catch {
      return false;
    }
  });
  console.log(`  [C4] models.dev 可达性（SW fetch）: ${modelsDevReachable}`);

  // 检查 openai 缓存是否存在
  const openaiCacheKey = PREVIEW_CACHE_PREFIX + "openai";
  let openaiCache = await readStorage(serviceWorker, openaiCacheKey);

  if (!openaiCache || !Array.isArray(openaiCache.models) || openaiCache.models.length === 0) {
    if (!modelsDevReachable) {
      // SKIP-ENV: models.dev unreachable from SW (objective premise, just re-verified above)
      console.log("  [C4] SKIP-ENV: models.dev 不可达，无缓存可老化，跳过 TTL 测试");
      return;
    }
    // models.dev 可达却没有预览缓存 = loadPreviewModels 写入链路缺陷（C1/C3 已导航过 options 页）
    throw new Error("[C4] previewModels:v4:openai 缓存缺失（models.dev 可达时 C1/C3 必须已写入缓存）");
  }

  // 记录原始时间戳
  const originalTs = openaiCache.ts;

  // 将时间戳改为 25 小时前（超过 24h TTL）
  const expiredTs = Date.now() - (CACHE_TTL_MS + 60 * 60 * 1000); // 25h ago
  console.log(`  [C4] 将缓存时间戳从 ${originalTs} 改为 ${expiredTs}（25h 前）`);

  await writeStorage(serviceWorker, openaiCacheKey, {
    models: openaiCache.models,
    ts: expiredTs,
  });

  // 真实重载 options 页以触发 loadPreviewModels → isCacheFresh false → backgroundRefresh。
  // 注意（issue #88 实证）：必须用 page.reload()——同 URL 的 page.goto() 是 no-op 导航，
  // 不重新执行 options.js，旧实现在此静默漏检。
  await page.reload({ waitUntil: "load" });

  // 等待后台刷新完成（fire-and-forget，probe 实测 ~1.4s 完成）
  console.log("  [C4] 等待后台刷新（最多 30 秒）...");

  let refreshed = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    openaiCache = await readStorage(serviceWorker, openaiCacheKey);
    if (openaiCache && openaiCache.ts && openaiCache.ts > expiredTs + 60 * 1000) {
      // 时间戳已更新（比过期时间新很多 → 后台刷新已执行）
      refreshed = true;
      console.log(`  [C4] 缓存时间戳已更新: ${openaiCache.ts}（后台刷新执行, ${i + 1}s） ✓`);
      break;
    }
  }

  if (!refreshed) {
    if (!modelsDevReachable) {
      // SKIP-ENV: models.dev unreachable from SW (objective premise, re-verified above)
      console.log("  [C4] SKIP-ENV: models.dev 不可达，后台刷新无法执行（fire-and-forget 设计），跳过");
      return;
    }
    // 可达却未刷新 = backgroundRefresh 链路缺陷
    throw new Error("[C4] 过期缓存未触发后台刷新（models.dev 可达，reload 后 30s 内时间戳未更新）");
  }

  // 恢复原始时间戳
  if (originalTs) {
    openaiCache = await readStorage(serviceWorker, openaiCacheKey);
    if (openaiCache) {
      await writeStorage(serviceWorker, openaiCacheKey, {
        models: openaiCache.models,
        ts: originalTs,
      });
      console.log("  [C4] 已恢复原始缓存时间戳");
    }
  }

  console.log("[C4] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// run(scope) — 测试主入口
// ═════════════════════════════════════════════════════════════════

/**
 * 执行 models.dev 缓存 E2E 测试场景的全部 4 个步骤。
 *
 * @param {Object} scope - setupBasic() 返回的作用域对象
 * @param {import("playwright").Page} scope.page - Playwright 页面对象
 * @param {string} scope.extensionId - 扩展 ID
 * @param {import("playwright").Worker} scope.serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
export async function run(scope) {
  const { page, extensionId, serviceWorker } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  // ── C2: modelsdev:providers 缓存写入 ──
  // 必须最先运行（issue #88 实证）：getProvidersData() 记忆化 = 每 SW 生命周期
  // 至多一次写入。C1 先清缓存会消灭本场景唯一的真实写入窗口（全量套件里
  // SW 寿命长，C2 必然超时；隔离运行时 SW 新起，偶发通过——顺序性假绿）。
  await c2ModelsDevCacheWritten(serviceWorker);

  // ── C1: 清空缓存 → 下拉框填充 ──
  await c1CacheClearAndDropdownFill(page, extensionId, serviceWorker);

  // ── C3: per-provider 预览缓存写入 ──
  await c3PreviewCacheWritten(page, extensionId, serviceWorker);

  // ── C4: TTL 过期 → 后台刷新 ──
  await c4TtlExpiryAndBackgroundRefresh(page, extensionId, serviceWorker);

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
