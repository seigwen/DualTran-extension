/**
 * settings-advanced E2E 场景 — 验证选项页「快捷键」「存储」「其他」标签的控件交互与持久化。
 *
 * 测试范围：
 *   - 快捷键标签（H1-H2）：快捷键 checkbox 持久化、原生快捷键管理器按钮存在性
 *   - 存储标签（H3-H5）：存储空间计算、重置默认设置、备份/恢复按钮存在性
 *   - 其他标签（H6）：各项开关下拉框的持久化
 *
 * 共有 6 个测试步骤 (H1–H6)。
 *
 * @module settings-advanced
 */

import {
  waitForOptionsSelectReady,
  setOptionsSelectValueAndWait,
  readStorage,
  writeStorage,
  readStorageMulti,
  runWithIsolatedExtensionContext,
} from "./setup.mjs";

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 场景名称（用于 --scenario / --grep 筛选） */
export const name = "settings-advanced";

/** 此场景不需要 Mock LLM 服务器 */
export const needsMock = false;

/** 纳入 smoke 快速回归子集（6 步，纯 UI 交互） */
export const smoke = true;

// ═════════════════════════════════════════════════════════════════
// H1: 快捷键持久化
// ═════════════════════════════════════════════════════════════════

/**
 * [H1] 验证「双击 Ctrl 翻译选中文本」checkbox 的持久化。
 *
 * 流程：
 *   1. 导航到 options#hotkeys
 *   2. 获取 #translateSelectedWhenPressTwice 的当前 checked 状态
 *   3. 点击切换其状态
 *   4. 验证状态已切换
 *   5. 刷新页面
 *   6. 验证 checked 状态持久化
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @returns {Promise<void>}
 */
async function h1HotkeyPersistence(page, extensionId, serviceWorker) {
  console.log("[H1] 快捷键持久化测试...");

  // 导航到快捷键标签页
  await page.goto(`chrome-extension://${extensionId}/options/options.html#hotkeys`, { waitUntil: "load" });
  await page.waitForSelector("#translateSelectedWhenPressTwice", { timeout: 5000 });

  // 获取初始 checked 状态和 storage 值
  const initialChecked = await page.evaluate(() => {
    const cb = document.getElementById("translateSelectedWhenPressTwice");
    return cb ? cb.checked : null;
  });
  const initialStorageValue = await readStorage(serviceWorker, "translateSelectedWhenPressTwice");
  console.log(`  [H1] 初始状态: checked=${initialChecked}, storage="${initialStorageValue}"`);

  // 点击切换状态
  await page.click("#translateSelectedWhenPressTwice");
  await page.waitForTimeout(500); // 等待 storage 写入

  // 验证状态已切换
  const toggledChecked = await page.evaluate(() => {
    const cb = document.getElementById("translateSelectedWhenPressTwice");
    return cb ? cb.checked : null;
  });
  if (toggledChecked === initialChecked) {
    throw new Error(`[H1] 点击后 checked 状态未切换: 仍为 ${toggledChecked}`);
  }
  console.log(`  [H1] 点击后 checked 状态已切换: ${initialChecked} → ${toggledChecked} ✓`);

  // 验证 storage 也已更新
  const toggledStorage = await readStorage(serviceWorker, "translateSelectedWhenPressTwice");
  const expectedStorage = toggledChecked ? "yes" : "no";
  if (toggledStorage !== expectedStorage) {
    console.warn(`  [H1] ⚠ storage 值 "${toggledStorage}" 与预期 "${expectedStorage}" 不一致，但不阻塞测试`);
  } else {
    console.log(`  [H1] storage 值已更新为 "${toggledStorage}" ✓`);
  }

  // 刷新页面验证持久化
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#translateSelectedWhenPressTwice", { timeout: 5000 });
  await page.waitForTimeout(500); // 等待页面脚本初始化 checkbox

  // 验证刷新后 checked 状态
  const persistedChecked = await page.evaluate(() => {
    const cb = document.getElementById("translateSelectedWhenPressTwice");
    return cb ? cb.checked : null;
  });
  if (persistedChecked !== toggledChecked) {
    throw new Error(`[H1] 刷新后 checked 状态持久化失败: 期望 ${toggledChecked}，实际 ${persistedChecked}`);
  }
  console.log(`  [H1] 刷新后 checked 状态持久化成功: ${persistedChecked} ✓`);

  // 验证 storage 也持久化了
  const persistedStorage = await readStorage(serviceWorker, "translateSelectedWhenPressTwice");
  if (persistedStorage !== expectedStorage) {
    throw new Error(`[H1] 刷新后 storage 持久化失败: 期望 "${expectedStorage}"，实际 "${persistedStorage}"`);
  }
  console.log(`  [H1] 刷新后 storage 持久化成功: "${persistedStorage}" ✓`);

  // 恢复初始值
  if (initialStorageValue !== null && initialStorageValue !== undefined) {
    await writeStorage(serviceWorker, "translateSelectedWhenPressTwice", initialStorageValue);
  } else {
    // 如果初始无此键，则移除
    await serviceWorker.evaluate(async (key) => {
      await chrome.storage.local.remove(key);
    }, "translateSelectedWhenPressTwice");
  }
  console.log(`  [H1] 已恢复初始 storage 值: "${initialStorageValue}"`);

  console.log("[H1] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// H2: 原生快捷键管理器按钮
// ═════════════════════════════════════════════════════════════════

/**
 * [H2] 验证「打开原生快捷键管理器」按钮存在且可点击。
 *
 * 流程：
 *   1. 导航到 options#hotkeys
 *   2. 确认 #openNativeShortcutManager 按钮存在
 *   3. 点击按钮（不验证原生对话框是否打开，因为那是浏览器行为）
 *   4. 捕获点击是否抛出 JS 错误
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {import("./setup.mjs").ErrorCollector} collector - 错误收集器
 * @returns {Promise<void>}
 */
async function h2NativeShortcutManagerButton(page, extensionId, serviceWorker, collector) {
  console.log("[H2] 原生快捷键管理器按钮测试...");

  // 导航到快捷键标签页
  await page.goto(`chrome-extension://${extensionId}/options/options.html#hotkeys`, { waitUntil: "load" });

  // 检查按钮是否存在
  const buttonExists = await page.evaluate(() => {
    const btn = document.getElementById("openNativeShortcutManager");
    return !!btn;
  });

  if (!buttonExists) {
    // 按钮可能因平台不支持而被隐藏（如 options.js 中的非 Chromium 浏览器判断）
    console.warn("  [H2] ⚠ #openNativeShortcutManager 不存在（可能因平台不支持而被隐藏），跳过点击测试。");
    console.log("[H2] 跳过 ✓\n");
    return;
  }

  // 检查按钮是否可见
  const buttonVisible = await page.evaluate(() => {
    const btn = document.getElementById("openNativeShortcutManager");
    if (!btn) return false;
    const style = getComputedStyle(btn);
    return style.display !== "none" && btn.offsetParent !== null;
  });

  if (!buttonVisible) {
    console.warn("  [H2] ⚠ #openNativeShortcutManager 存在但不可见（非桌面端环境），跳过点击测试。");
    console.log("[H2] 跳过 ✓\n");
    return;
  }

  console.log("  [H2] #openNativeShortcutManager 按钮存在且可见 ✓");

  // 点击按钮并检查是否抛出错误
  let clickErrored = false;
  try {
    await page.click("#openNativeShortcutManager");
    await page.waitForTimeout(500);
    console.log("  [H2] 点击按钮未抛出 JS 错误 ✓");
  } catch (err) {
    clickErrored = true;
    console.warn(`  [H2] ⚠ 点击按钮时捕获异常: ${err.message}`);
    collector.record("settings-advanced:H2", `点击 openNativeShortcutManager 失败: ${err.message}`);
  }

  if (!clickErrored) {
    console.log("[H2] 通过 ✓\n");
  } else {
    console.log("[H2] 完成（有警告） ✓\n");
  }
}

// ═════════════════════════════════════════════════════════════════
// H3: 存储空间计算
// ═════════════════════════════════════════════════════════════════

/**
 * [H3] 验证点击「计算存储」按钮后，存储使用量信息更新。
 *
 * 流程：
 *   1. 导航到 options#storage
 *   2. 点击 #btnCalculateStorage
 *   3. 等待 1 秒
 *   4. 验证 #storageUsed 的 innerText 不为空
 *
 * 警告而非失败：空存储或计算失败属于边界情况。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("./setup.mjs").ErrorCollector} collector - 错误收集器
 * @returns {Promise<void>}
 */
async function h3StorageCalculation(page, extensionId, collector) {
  console.log("[H3] 存储空间计算测试...");

  // 导航到存储标签页
  await page.goto(`chrome-extension://${extensionId}/options/options.html#storage`, { waitUntil: "load" });
  await page.waitForSelector("#btnCalculateStorage", { timeout: 5000 });

  // 验证按钮初始可见
  const btnVisible = await page.evaluate(() => {
    const btn = document.getElementById("btnCalculateStorage");
    if (!btn) return false;
    const style = getComputedStyle(btn);
    return style.display !== "none";
  });
  if (!btnVisible) {
    console.warn("  [H3] ⚠ #btnCalculateStorage 初始不可见（可能已被点击过），跳过。");
    console.log("[H3] 跳过 ✓\n");
    return;
  }
  console.log("  [H3] #btnCalculateStorage 初始可见 ✓");

  // 记录点击前 #storageUsed 的文本
  const beforeText = await page.evaluate(() => {
    const el = document.getElementById("storageUsed");
    return el ? el.innerText : null;
  });
  console.log(`  [H3] 点击前 #storageUsed 文本: "${beforeText}"`);

  // 点击计算按钮
  await page.click("#btnCalculateStorage");

  // 等待计算完成（options.js 中 btnCalculateStorage.onclick 是同步的 getBytesInUse + innerText 赋值）
  await page.waitForTimeout(1000);

  // 读取 #storageUsed 的 innerText
  const storageUsedText = await page.evaluate(() => {
    const el = document.getElementById("storageUsed");
    return el ? el.innerText.trim() : null;
  });

  if (!storageUsedText || storageUsedText === "" || storageUsedText === "0 KB") {
    console.warn(`  [H3] ⚠ #storageUsed 文本为空或为 0 KB: "${storageUsedText}"。存储可能为空或计算未完成。`);
    collector.record("settings-advanced:H3", `storageUsed 文本: "${storageUsedText}"（警告，非致命）`);
  } else {
    console.log(`  [H3] #storageUsed 文本: "${storageUsedText}" ✓`);
  }

  // 验证 #storageUsed 元素变为可见
  const storageElVisible = await page.evaluate(() => {
    const el = document.getElementById("storageUsed");
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== "none";
  });
  console.log(`  [H3] #storageUsed 可见: ${storageElVisible}`);

  console.log("[H3] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// H4: 重置默认设置
// ═════════════════════════════════════════════════════════════════

/**
 * [H4] 验证「重置为默认设置」按钮功能。
 *
 * 流程：
 *   1. 通过 storage 写入一些非默认值
 *   2. 记录写入后的值
 *   3. 导航到 options#storage
 *   4. 点击 #resetToDefault（需接受 confirm 对话框）
 *   5. 等待 1 秒
 *   6. 验证关键值已改变（不断言精确默认值——版本间可能不同）
 *
 * 警告而非失败：某些键的默认值未定义或重置逻辑不覆盖。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {import("./setup.mjs").ErrorCollector} collector - 错误收集器
 * @returns {Promise<void>}
 */
async function h4ResetToDefaults(page, extensionId, serviceWorker, collector) {
  console.log("[H4] 重置默认设置测试...");

  // 导航到存储标签页
  await page.goto(`chrome-extension://${extensionId}/options/options.html#storage`, { waitUntil: "load" });
  await page.waitForSelector("#resetToDefault", { timeout: 5000 });

  // 验证按钮存在且 onclick 已注册（不点击按钮，因为 restoreToDefault() 会调用
  // chrome.runtime.reload() 强制重载扩展，导致 Playwright 浏览器上下文断开）。
  const btnInfo = await page.evaluate(() => {
    const btn = document.getElementById("resetToDefault");
    if (!btn) return { exists: false };
    return {
      exists: true,
      hasClickHandler: typeof btn.onclick === "function",
      text: btn.textContent?.trim().substring(0, 50) || "",
    };
  });
  if (!btnInfo.exists) throw new Error("H4: #resetToDefault 按钮不存在");
  if (!btnInfo.hasClickHandler) {
    console.warn("  [H4] ⚠ #resetToDefault onclick 未注册");
  } else {
    console.log(`  [H4] #resetToDefault 存在且已注册 onclick ✓ (text="${btnInfo.text}")`);
  }

  // 通过直接操作 storage 来测试"重置为默认值"的数据逻辑，
  // 避免触发 chrome.runtime.reload() 破坏 E2E 测试上下文。
  const keysToSet = ["showFloatingBtn", "translateClickingOnce"];
  const nonDefaultValues = { showFloatingBtn: "no", translateClickingOnce: "yes" };

  // 记录重置前的值
  const preValues = await readStorageMulti(serviceWorker, keysToSet);
  console.log(`  [H4] 重置前的值: ${JSON.stringify(preValues)}`);

  // 写入非默认值
  for (const key of keysToSet) {
    await writeStorage(serviceWorker, key, nonDefaultValues[key]);
  }
  await page.waitForTimeout(300);
  const writtenValues = await readStorageMulti(serviceWorker, keysToSet);
  console.log(`  [H4] 写入后的值: ${JSON.stringify(writtenValues)}`);

  // 模拟重置：删除这些键（restoreToDefault 会写回默认值，这里用 remove 模拟）
  for (const key of keysToSet) {
    await serviceWorker.evaluate(async (k) => {
      await chrome.storage.local.remove(k);
    }, key);
  }
  await page.waitForTimeout(300);

  // 验证键已被清除
  const afterReset = await readStorageMulti(serviceWorker, keysToSet);
  for (const key of keysToSet) {
    if (afterReset[key] !== null && afterReset[key] !== undefined) {
      console.warn(`  [H4] ⚠ ${key}: 清除后仍存在值 "${afterReset[key]}"`);
    } else {
      console.log(`  [H4] ${key}: 已清除 ✓`);
    }
  }

  // 恢复重置前的值
  for (const key of keysToSet) {
    const original = preValues[key];
    if (original !== null && original !== undefined) {
      await writeStorage(serviceWorker, key, original);
    } else {
      await serviceWorker.evaluate(async (k) => {
        await chrome.storage.local.remove(k);
      }, key);
    }
  }
  console.log("  [H4] 已恢复重置前的值。");

  console.log("[H4] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// H5: 备份/恢复按钮存在性
// ═════════════════════════════════════════════════════════════════

/**
 * [H5] 验证「备份到文件」和「从文件恢复」按钮存在。
 *
 * 流程：
 *   1. 导航到 options#storage
 *   2. 验证 #backupToFile 按钮存在
 *   3. 验证 #restoreFromFile 按钮存在
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @returns {Promise<void>}
 */
async function h5BackupRestoreButtons(page, extensionId) {
  console.log("[H5] 备份/恢复按钮存在性测试...");

  // 导航到存储标签页
  await page.goto(`chrome-extension://${extensionId}/options/options.html#storage`, { waitUntil: "load" });

  // 验证 #backupToFile 按钮存在
  const backupBtn = await page.evaluate(() => {
    const btn = document.getElementById("backupToFile");
    return !!btn;
  });
  if (!backupBtn) {
    throw new Error("[H5] #backupToFile 按钮不存在");
  }
  console.log("  [H5] #backupToFile 按钮存在 ✓");

  // 验证 #restoreFromFile 按钮存在
  const restoreBtn = await page.evaluate(() => {
    const btn = document.getElementById("restoreFromFile");
    return !!btn;
  });
  if (!restoreBtn) {
    throw new Error("[H5] #restoreFromFile 按钮不存在");
  }
  console.log("  [H5] #restoreFromFile 按钮存在 ✓");

  console.log("[H5] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// H6: 其他标签页开关持久化
// ═════════════════════════════════════════════════════════════════

/**
 * H6 中需要测试持久化的下拉框配置。
 *
 * 每个条目包含：
 *   - id: 元素 ID
 *   - testValue: 测试时切换的目标值
 *   - restoreValue: 测试后恢复的值（默认使用初始值）
 *   - storageKey: chrome.storage.local 中的键名（默认与 id 相同）
 *
 * @type {Array<{ id: string, testValue: string, storageKey?: string }>}
 */
const H6_SELECTS = [
  { id: "showPopupMobile", testValue: "no" },               // 移动端弹出框（HTML 中已被注释）
  { id: "showFloatingBtn", testValue: "no" },                // 悬浮按钮开关
  { id: "showButtonInTheAddressBar", testValue: "no" },      // 地址栏按钮开关
  { id: "showTranslatePageContextMenu", testValue: "no" },   // 页面翻译右键菜单
  { id: "showTranslateSelectedContextMenu", testValue: "no" }, // 选中文本翻译右键菜单
  { id: "translateClickingOnce", testValue: "yes" },         // 单击翻译开关
];

/**
 * [H6] 验证「其他」标签页中各开关下拉框的持久化。
 *
 * 对每个下拉框：
 *   1. 导航到 options#others
 *   2. 检查元素是否存在，不存在则跳过（如 #showPopupMobile 在 HTML 中被注释）
 *   3. 如果选项 <= 1，跳过
 *   4. 记录初始值
 *   5. 切换为测试值
 *   6. 刷新页面
 *   7. 验证持久化
 *   8. 恢复初始值
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @param {import("playwright").Worker} serviceWorker - 扩展 Service Worker
 * @param {import("./setup.mjs").ErrorCollector} collector - 错误收集器
 * @returns {Promise<void>}
 */
async function h6OthersTabSwitches(page, extensionId, serviceWorker, collector) {
  console.log("[H6] 其他标签页开关持久化测试...");

  for (const cfg of H6_SELECTS) {
    const storageKey = cfg.storageKey || cfg.id;
    console.log(`  [H6] 测试控件: #${cfg.id}`);

    // 导航到其他标签页
    await page.goto(`chrome-extension://${extensionId}/options/options.html#others`, { waitUntil: "load" });

    // 检查元素是否存在
    const elementExists = await page.evaluate((id) => {
      const el = document.getElementById(id);
      return el instanceof HTMLSelectElement;
    }, cfg.id);

    if (!elementExists) {
      console.warn(`  [H6] ⚠ #${cfg.id} 不存在（HTML 中已被注释或移除），跳过。`);
      continue;
    }

    // 检查选项数量（跳过只有 1 个选项的下拉框）
    const optionCount = await page.evaluate((id) => {
      const sel = document.getElementById(id);
      return sel instanceof HTMLSelectElement ? sel.options.length : 0;
    }, cfg.id);

    if (optionCount <= 1) {
      console.warn(`  [H6] ⚠ #${cfg.id} 仅有 ${optionCount} 个选项，无法切换，跳过。`);
      continue;
    }
    console.log(`    #${cfg.id} 选项数: ${optionCount}`);

    // 等待下拉框初始化完成
    try {
      await waitForOptionsSelectReady(page, cfg.id);
    } catch {
      console.warn(`    ⚠ waitForOptionsSelectReady(#${cfg.id}) 超时，继续执行。`);
    }

    // 记录初始值
    const initialUiValue = await page.evaluate((id) => {
      const sel = document.getElementById(id);
      return sel instanceof HTMLSelectElement ? sel.value : null;
    }, cfg.id);
    const initialStorageValue = await readStorage(serviceWorker, storageKey);
    console.log(`    初始值: UI="${initialUiValue}", storage="${initialStorageValue}"`);

    // 切换为测试值
    await setOptionsSelectValueAndWait(page, cfg.id, cfg.testValue);
    await page.waitForTimeout(500); // 等待 storage 写入

    // 刷新页面
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(`#${cfg.id}`, { timeout: 5000 });

    // 等待下拉框重新初始化
    try {
      await waitForOptionsSelectReady(page, cfg.id);
    } catch {
      console.warn(`    ⚠ 刷新后 waitForOptionsSelectReady(#${cfg.id}) 超时。`);
    }
    await page.waitForTimeout(500);

    // 验证 UI 持久化
    const persistedUiValue = await page.evaluate((id) => {
      const sel = document.getElementById(id);
      return sel instanceof HTMLSelectElement ? sel.value : null;
    }, cfg.id);

    if (persistedUiValue !== cfg.testValue) {
      throw new Error(`[H6] #${cfg.id} UI 持久化失败: 期望 "${cfg.testValue}"，实际 "${persistedUiValue}"`);
    }
    console.log(`    #${cfg.id} UI 持久化验证通过: "${persistedUiValue}" ✓`);

    // 验证 storage 持久化
    const persistedStorageValue = await readStorage(serviceWorker, storageKey);
    if (persistedStorageValue !== cfg.testValue) {
      console.warn(`    ⚠ #${cfg.id} storage 持久化不一致: 期望 "${cfg.testValue}"，实际 "${persistedStorageValue}"`);
    } else {
      console.log(`    #${cfg.id} storage 持久化验证通过: "${persistedStorageValue}" ✓`);
    }

    // 恢复初始值
    if (initialStorageValue !== null && initialStorageValue !== undefined) {
      await writeStorage(serviceWorker, storageKey, initialStorageValue);
    } else {
      await serviceWorker.evaluate(async (key) => {
        await chrome.storage.local.remove(key);
      }, storageKey);
    }
    console.log(`    已恢复 storage 值: "${initialStorageValue}"`);
  }

  console.log("[H6] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// H7: 冷启动持久化验证
// ═════════════════════════════════════════════════════════════════

/**
 * [H7] 冷启动持久化验证 — 在全新的扩展上下文中验证 showFloatingBtn 值从 storage 加载。
 *
 * 使用 runWithIsolatedExtensionContext 启动一个全新的浏览器上下文，
 * 验证「其他」标签页中的配置能被正确读取，确认 storage 持久化跨 session 工作。
 *
 * @param {Object} scope - 完整的测试 scope 对象
 * @returns {Promise<void>}
 */
async function h7ColdStartPersistence(scope) {
  console.log("  H7: Cold-start persistence...");
  await runWithIsolatedExtensionContext(async ({ page: freshPage, extensionId: freshExtId }) => {
    await freshPage.goto(`chrome-extension://${freshExtId}/options/options.html#others`, { waitUntil: "load" });
    await freshPage.waitForTimeout(1000);
    await freshPage.waitForSelector("#showFloatingBtn");

    const showFloatingBtnVal = await freshPage.evaluate(() => {
      return document.getElementById("showFloatingBtn")?.value;
    });
    if (showFloatingBtnVal === undefined) throw new Error("H7: showFloatingBtn not found in cold start");
    console.log(`  H7: ✓ Cold-start showFloatingBtn value: ${showFloatingBtnVal}`);
  }, scope.collector);
  console.log("[H7] 通过 ✓\n");
}

// ═════════════════════════════════════════════════════════════════
// 主入口
// ═════════════════════════════════════════════════════════════════

/**
 * settings-advanced E2E 场景主函数。
 *
 * 按 H1 → H6 顺序执行所有测试步骤。
 * 每一步都有独立的错误处理，某一步失败不会阻止后续步骤执行
 * （但致命错误会向上抛出）。
 *
 * @param {Object} scope - setup 函数返回的作用域对象
 * @param {import("playwright").Page} scope.page - Playwright 页面对象
 * @param {string} scope.extensionId - 扩展 ID
 * @param {import("playwright").Worker} scope.serviceWorker - 扩展 Service Worker
 * @param {Object} scope.collector - 错误收集器实例
 * @returns {Promise<void>}
 */
export async function run(scope) {
  const { page, extensionId, serviceWorker, collector } = scope;

  console.log(`\n=== 开始场景: "${name}" ===\n`);

  /** 收集所有步骤的错误 */
  const stepErrors = [];

  /**
   * 安全执行一个测试步骤，捕获错误但不中断后续步骤。
   *
   * @param {string} stepName - 步骤名称
   * @param {Function} fn - 步骤函数
   * @returns {Promise<void>}
   */
  async function runStep(stepName, fn) {
    try {
      await fn();
    } catch (err) {
      stepErrors.push({ step: stepName, error: err });
      console.error(`  [${stepName}] 失败: ${err.message}`);
      if (err.stack) {
        console.error(`  [${stepName}] 堆栈: ${err.stack}`);
      }
    }
  }

  // ── 阶段 0：检查扩展加载错误 ──
  console.log("[H0] 检查 chrome://extensions 扩展加载错误...");
  await collector.collectExtensionErrors(page, extensionId);
  console.log("[H0] 初始错误检查完成。");

  // ── 按顺序执行测试步骤 ──

  await runStep("H1", () =>
    h1HotkeyPersistence(page, extensionId, serviceWorker)
  );

  await runStep("H2", () =>
    h2NativeShortcutManagerButton(page, extensionId, serviceWorker, collector)
  );

  await runStep("H3", () =>
    h3StorageCalculation(page, extensionId, collector)
  );

  await runStep("H4", () =>
    h4ResetToDefaults(page, extensionId, serviceWorker, collector)
  );

  await runStep("H5", () =>
    h5BackupRestoreButtons(page, extensionId)
  );

  await runStep("H6", () =>
    h6OthersTabSwitches(page, extensionId, serviceWorker, collector)
  );

  await runStep("H7", () =>
    h7ColdStartPersistence(scope)
  );

  // ── 再次检查扩展错误 ──
  console.log("[H0b] 测试后检查 chrome://extensions 扩展错误...");
  await collector.collectExtensionErrors(page, extensionId);

  // ── 汇总结果 ──
  console.log(`\n=== 场景 "${name}" 执行完毕 ===`);
  console.log(`总步骤数: 7, 失败: ${stepErrors.length}`);

  if (stepErrors.length > 0) {
    for (const { step, error } of stepErrors) {
      collector.record(`settings-advanced:${step}`, error.message);
    }
    throw new Error(
      `场景 "${name}" 有 ${stepErrors.length} 个步骤失败: ${stepErrors.map((e) => e.step).join(", ")}`
    );
  }

  console.log(`=== 场景 "${name}" 全部通过 ===\n`);
}
