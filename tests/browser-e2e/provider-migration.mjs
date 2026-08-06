/**
 * DualTran E2E Provider 迁移测试场景
 *
 * 验证 legacy flat keys → providerConfigs 的一次性迁移逻辑：
 *   M1: 写入 legacy 配置 → 触发迁移 → 验证 providerConfigs 结构正确
 *   M2: 验证 legacy key 仍可读取（向后兼容）
 *   M3: 验证迁移幂等性（刷新页面不会重复迁移）
 *   M4: 验证 activeProviderId 正确设置
 *
 * @module provider-migration
 */

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 测试场景名称 */
export const name = "provider-migration";

/** 此场景不需要 Mock LLM 服务器 */
export const needsMock = false;

/** 不纳入 smoke 子集（需要特定初始状态） */
export const smoke = false;

// ─── 从 setup.mjs 导入共享工具函数 ─────────────────────────────

import {
  readStorage,
  readStorageMulti,
  writeStorage,
} from "./setup.mjs";

// ═════════════════════════════════════════════════════════════════
// M1: legacy 配置写入 → 触发迁移 → 验证 providerConfigs
// ═════════════════════════════════════════════════════════════════

/**
 * [M1] 写入 legacy flat keys，导航到 options 页触发迁移，验证 providerConfigs 结构。
 *
 * 迁移逻辑在 options.js:2148 和 sw.js:197 中调用 migrateProviderConfig()，
 * 读取 legacy keys（如 apiKeyOpenAI、openAiModel）并写入 providerConfigs 对象。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 * @throws {Error} 迁移结果不符合预期时抛出
 */
async function m1LegacyToProviderConfigs(page, extensionId, serviceWorker) {
  console.log("[M1] Legacy → providerConfigs 迁移测试...");

  // ── 准备：清除迁移标记和 providerConfigs，写入 legacy keys ──
  console.log("  [M1] 清除迁移状态，写入 legacy 配置...");

  /** 保存原始值用于恢复 */
  const originalKeys = await readStorageMulti(serviceWorker, [
    "registryMigrated",
    "providerConfigs",
    "activeProviderId",
    "aiProvider",
    "apiKeyOpenAI",
    "openAiModel",
    "apiKeyOpenRouter",
    "openRouterModel",
    "openRouterApiBase",
  ]);

  // 清除迁移标记和 providerConfigs（模拟迁移前状态）
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.remove(["registryMigrated", "providerConfigs", "activeProviderId"]);
    // 写入 legacy flat keys
    await chrome.storage.local.set({
      aiProvider: "openrouter",
      apiKeyOpenAI: "test-openai-key-legacy",
      openAiModel: "gpt-4o-mini",
      apiKeyOpenRouter: "test-openrouter-key-legacy",
      openRouterModel: "openai/gpt-4o-mini",
      openRouterApiBase: "http://example.com/v1",
    });
  });

  // ── 触发迁移：导航到 options 页 ──
  console.log("  [M1] 导航到 options 页触发迁移...");
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
  // 等待 options.js 初始化完成（migrateProviderConfig 在初始化时调用）
  await page.waitForTimeout(2000);

  // ── 验证迁移结果 ──
  const migrated = await readStorageMulti(serviceWorker, [
    "registryMigrated",
    "providerConfigs",
    "activeProviderId",
  ]);

  // 验证 registryMigrated 已设置
  if (migrated.registryMigrated !== "true") {
    throw new Error(`[M1] registryMigrated 应为 "true"，实际为 "${migrated.registryMigrated}"`);
  }
  console.log('  [M1] registryMigrated = "true" ✓');

  // 验证 providerConfigs 包含迁移后的 OpenAI 配置
  const providerConfigs = migrated.providerConfigs;
  if (!providerConfigs || typeof providerConfigs !== "object") {
    throw new Error(`[M1] providerConfigs 应为对象，实际为 ${typeof providerConfigs}`);
  }

  // OpenAI 配置
  if (!providerConfigs.openai || providerConfigs.openai.apiKey !== "test-openai-key-legacy") {
    throw new Error(
      `[M1] providerConfigs.openai.apiKey 应为 "test-openai-key-legacy"，实际为 "${providerConfigs.openai?.apiKey}"`
    );
  }
  if (providerConfigs.openai.model !== "gpt-4o-mini") {
    throw new Error(
      `[M1] providerConfigs.openai.model 应为 "gpt-4o-mini"，实际为 "${providerConfigs.openai.model}"`
    );
  }
  console.log('  [M1] providerConfigs.openai: apiKey + model 正确 ✓');

  // OpenRouter 配置（含 apiBase）
  if (!providerConfigs.openrouter || providerConfigs.openrouter.apiKey !== "test-openrouter-key-legacy") {
    throw new Error(
      `[M1] providerConfigs.openrouter.apiKey 应为 "test-openrouter-key-legacy"，实际为 "${providerConfigs.openrouter?.apiKey}"`
    );
  }
  if (providerConfigs.openrouter.model !== "openai/gpt-4o-mini") {
    throw new Error(
      `[M1] providerConfigs.openrouter.model 应为 "openai/gpt-4o-mini"，实际为 "${providerConfigs.openrouter.model}"`
    );
  }
  if (providerConfigs.openrouter.apiBase !== "http://example.com/v1") {
    throw new Error(
      `[M1] providerConfigs.openrouter.apiBase 应为 "http://example.com/v1"，实际为 "${providerConfigs.openrouter.apiBase}"`
    );
  }
  console.log('  [M1] providerConfigs.openrouter: apiKey + model + apiBase 正确 ✓');

  // 保存迁移后状态供 M2/M3 使用
  return { originalKeys, migratedProviderConfigs: providerConfigs };
}

// ═════════════════════════════════════════════════════════════════
// M2: legacy key 向后兼容
// ═════════════════════════════════════════════════════════════════

/**
 * [M2] 验证迁移后 legacy flat keys 仍可读取（迁移不删除原始 key）。
 *
 * migrateProviderConfig 只读取 legacy keys 并写入 providerConfigs，
 * 不删除原始 key，确保向后兼容。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 * @throws {Error} legacy key 丢失时抛出
 */
async function m2LegacyKeysPreserved(serviceWorker) {
  console.log("[M2] Legacy key 向后兼容验证...");

  const legacyKeys = await readStorageMulti(serviceWorker, [
    "apiKeyOpenAI",
    "openAiModel",
    "apiKeyOpenRouter",
    "openRouterModel",
    "openRouterApiBase",
  ]);

  // 验证 legacy key 仍存在且值未变
  if (legacyKeys.apiKeyOpenAI !== "test-openai-key-legacy") {
    throw new Error(
      `[M2] apiKeyOpenAI 应仍为 "test-openai-key-legacy"，实际为 "${legacyKeys.apiKeyOpenAI}"`
    );
  }
  console.log('  [M2] apiKeyOpenAI 保留不变 ✓');

  if (legacyKeys.openAiModel !== "gpt-4o-mini") {
    throw new Error(
      `[M2] openAiModel 应仍为 "gpt-4o-mini"，实际为 "${legacyKeys.openAiModel}"`
    );
  }
  console.log('  [M2] openAiModel 保留不变 ✓');

  if (legacyKeys.apiKeyOpenRouter !== "test-openrouter-key-legacy") {
    throw new Error(
      `[M2] apiKeyOpenRouter 应仍为 "test-openrouter-key-legacy"，实际为 "${legacyKeys.apiKeyOpenRouter}"`
    );
  }
  console.log('  [M2] apiKeyOpenRouter 保留不变 ✓');

  console.log("[M2] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// M3: 迁移幂等性
// ═════════════════════════════════════════════════════════════════

/**
 * [M3] 验证迁移幂等性——刷新 options 页不会重复迁移。
 *
 * migrateProviderConfig 首先检查 registryMigrated 标记，
 * 如果已设置则直接返回 null，不执行任何操作。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {Object} migratedProviderConfigs - M1 中迁移后的 providerConfigs 快照
 * @returns {Promise<void>}
 * @throws {Error} 重复迁移导致 providerConfigs 变化时抛出
 */
async function m3MigrationIdempotent(page, extensionId, serviceWorker, migratedProviderConfigs) {
  console.log("[M3] 迁移幂等性验证...");

  // 记录刷新前的 providerConfigs 快照
  const beforeRefresh = JSON.stringify(migratedProviderConfigs);

  // 刷新 options 页（再次触发 options.js 初始化 → migrateProviderConfig）
  await page.goto(`chrome-extension://${extensionId}/options/options.html#translations`, { waitUntil: "load" });
  await page.waitForTimeout(2000);

  // 读取刷新后的 providerConfigs
  const afterRefresh = await readStorage(serviceWorker, "providerConfigs");
  const afterRefreshStr = JSON.stringify(afterRefresh);

  if (beforeRefresh !== afterRefreshStr) {
    throw new Error(
      `[M3] 刷新后 providerConfigs 发生了变化（幂等性失败）:\n  刷新前: ${beforeRefresh}\n  刷新后: ${afterRefreshStr}`
    );
  }
  console.log("  [M3] 刷新后 providerConfigs 未变化 ✓");

  // 验证 registryMigrated 仍为 "true"
  const migrationFlag = await readStorage(serviceWorker, "registryMigrated");
  if (migrationFlag !== "true") {
    throw new Error(`[M3] registryMigrated 仍应为 "true"，实际为 "${migrationFlag}"`);
  }
  console.log('  [M3] registryMigrated = "true" 保持不变 ✓');

  console.log("[M3] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// M4: activeProviderId 正确设置
// ═════════════════════════════════════════════════════════════════

/**
 * [M4] 验证迁移后 activeProviderId 等于原始 aiProvider 值。
 *
 * migrateProviderConfig 读取 config.get("aiProvider") 并写入 activeProviderId。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 * @throws {Error} activeProviderId 不正确时抛出
 */
async function m4ActiveProviderId(serviceWorker) {
  console.log("[M4] activeProviderId 验证...");

  const activeProviderId = await readStorage(serviceWorker, "activeProviderId");
  const aiProvider = await readStorage(serviceWorker, "aiProvider");

  if (activeProviderId !== aiProvider) {
    throw new Error(
      `[M4] activeProviderId 应等于 aiProvider ("${aiProvider}")，实际为 "${activeProviderId}"`
    );
  }
  console.log(`  [M4] activeProviderId = "${activeProviderId}" 与 aiProvider 一致 ✓`);

  console.log("[M4] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// 清理函数
// ═════════════════════════════════════════════════════════════════

/**
 * 恢复测试前的原始配置状态。
 *
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {Object} originalKeys - M1 中保存的原始 key 快照
 * @returns {Promise<void>}
 */
async function cleanup(serviceWorker, originalKeys) {
  console.log("[Cleanup] 恢复原始配置...");

  // 恢复每个 key 的原始值（null 表示原始不存在，删除它）
  const keysToRestore = [
    "registryMigrated",
    "providerConfigs",
    "activeProviderId",
    "aiProvider",
    "apiKeyOpenAI",
    "openAiModel",
    "apiKeyOpenRouter",
    "openRouterModel",
    "openRouterApiBase",
  ];

  await serviceWorker.evaluate(async ({ keys, originals }) => {
    for (const key of keys) {
      const originalValue = originals[key];
      if (originalValue === undefined || originalValue === null) {
        await chrome.storage.local.remove(key);
      } else {
        await chrome.storage.local.set({ [key]: originalValue });
      }
    }
  }, { keys: keysToRestore, originals: originalKeys });

  console.log("[Cleanup] 恢复完成 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// run(scope) — 测试主入口
// ═════════════════════════════════════════════════════════════════

/**
 * 执行 Provider 迁移 E2E 测试场景的全部 4 个步骤。
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

  /** 保存原始配置用于恢复 */
  let originalKeys = null;

  try {
    // ── M1: Legacy → providerConfigs 迁移 ──
    const m1Result = await m1LegacyToProviderConfigs(page, extensionId, serviceWorker);
    originalKeys = m1Result.originalKeys;
    console.log("[M1] 通过 ✓\n");

    // ── M2: Legacy key 向后兼容 ──
    await m2LegacyKeysPreserved(serviceWorker);

    // ── M3: 迁移幂等性 ──
    await m3MigrationIdempotent(page, extensionId, serviceWorker, m1Result.migratedProviderConfigs);

    // ── M4: activeProviderId 正确设置 ──
    await m4ActiveProviderId(serviceWorker);

    console.log(`=== 场景 "${name}" 全部通过 ===\n`);
  } finally {
    // 确保无论测试是否通过都恢复原始配置
    if (originalKeys) {
      await cleanup(serviceWorker, originalKeys);
    }
  }
}
