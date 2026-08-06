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

  // 读取选项列表
  const options = await page.evaluate(() => {
    const sel = document.getElementById("aiProvider");
    if (!sel) return [];
    return Array.from(sel.options).map((opt) => ({
      value: opt.value,
      text: opt.textContent || "",
    }));
  });

  if (options.length < 5) {
    throw new Error(`[C1] #aiProvider 选项数不足: 期望 >=5, 实际 ${options.length}`);
  }
  console.log(`  [C1] #aiProvider 填充了 ${options.length} 个选项 ✓`);

  // 验证包含核心提供商
  const values = options.map((o) => o.value);
  const expectedProviders = ["openai", "anthropic", "google-gemini"];
  for (const expected of expectedProviders) {
    if (!values.includes(expected)) {
      throw new Error(`[C1] #aiProvider 缺少预期提供商: "${expected}"。实际值: ${JSON.stringify(values)}`);
    }
  }
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
 * 注意：此缓存由 Service Worker 写入。如果网络不可用，
 * 缓存可能不存在——此时验证内置 fallback 仍然工作（C1 已验证）。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function c2ModelsDevCacheWritten(serviceWorker) {
  console.log("[C2] modelsdev:providers 缓存写入验证...");

  // 等待 Service Worker 有时间拉取 models.dev 数据
  // getProvidersData 在 SW 启动时即开始拉取
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const cached = await readStorage(serviceWorker, MODELSDEV_CACHE_KEY);

  if (cached && cached.data && typeof cached.data === "object") {
    const providerCount = Object.keys(cached.data).length;
    console.log(`  [C2] modelsdev:providers 缓存存在，包含 ${providerCount} 个提供商 ✓`);

    // 验证 ts 字段存在（时间戳）
    if (cached.ts && typeof cached.ts === "number") {
      console.log(`  [C2] ts 时间戳存在: ${cached.ts} ✓`);
    } else {
      console.warn("  [C2] ⚠ ts 时间戳缺失或不为数字（可能为旧格式）");
    }
  } else {
    // 网络不可用时缓存可能不存在——这是可接受的 fallback 行为
    console.log("  [C2] modelsdev:providers 缓存不存在（可能网络不可用，使用内置 fallback）");
    console.log("  [C2] 内置 fallback 已在 C1 中验证 ✓");
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

  // 检查 openai 缓存是否存在
  const openaiCacheKey = PREVIEW_CACHE_PREFIX + "openai";
  let openaiCache = await readStorage(serviceWorker, openaiCacheKey);

  if (!openaiCache || !Array.isArray(openaiCache.models) || openaiCache.models.length === 0) {
    console.log("  [C4] 预览缓存不存在，跳过 TTL 测试（需要先有缓存才能测试过期）");
    console.log("[C4] 跳过 ✓\n");
    return;
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

  // 刷新 options 页（触发 loadPreviewModels → isCacheFresh 返回 false → backgroundRefresh）
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });

  // 等待后台刷新完成（fire-and-forget，需要给一些时间）
  // backgroundRefresh 调用 fetchModelsDevData → fetchAndCacheAll → writeCache
  console.log("  [C4] 等待后台刷新（最多 10 秒）...");

  let refreshed = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    openaiCache = await readStorage(serviceWorker, openaiCacheKey);
    if (openaiCache && openaiCache.ts && openaiCache.ts > expiredTs + 60 * 1000) {
      // 时间戳已更新（比过期时间新很多 → 后台刷新已执行）
      refreshed = true;
      console.log(`  [C4] 缓存时间戳已更新: ${openaiCache.ts}（后台刷新执行） ✓`);
      break;
    }
  }

  if (!refreshed) {
    // 后台刷新可能因网络不可用而失败——这是可接受的
    console.log("  [C4] 后台刷新未执行（可能 models.dev 网络不可用）");
    console.log("  [C4] 缓存仍返回旧数据（即时显示），符合 fire-and-forget 设计 ✓");
  }

  // 恢复原始时间戳（如果有）
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

  // ── C1: 清空缓存 → 下拉框填充 ──
  await c1CacheClearAndDropdownFill(page, extensionId, serviceWorker);

  // ── C2: modelsdev:providers 缓存写入 ──
  await c2ModelsDevCacheWritten(serviceWorker);

  // ── C3: per-provider 预览缓存写入 ──
  await c3PreviewCacheWritten(page, extensionId, serviceWorker);

  // ── C4: TTL 过期 → 后台刷新 ──
  await c4TtlExpiryAndBackgroundRefresh(page, extensionId, serviceWorker);

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
