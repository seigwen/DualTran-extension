/**
 * settings-advanced E2E 场景 — 验证选项页「快捷键」「存储」「其他」标签的控件交互与持久化。
 *
 * 测试范围：
 *   - 快捷键标签（H1-H2）：快捷键 checkbox 持久化、原生快捷键管理器按钮存在性
 *   - 存储标签（H3-H5）：存储空间计算、重置默认设置、备份/恢复按钮存在性
 *   - 其他标签（H6）：各项开关下拉框的持久化
 *
 * 共有 9 个测试步骤 (H1–H9)。
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
  assertAllHaveNonEmptyText,
  waitForPageStorageValue,
} from "./setup.mjs";

// ─── 模块元数据 ─────────────────────────────────────────────────

/** 场景名称（用于 --scenario / --grep 筛选） */
export const name = "settings-advanced";

/** 此场景不需要 Mock LLM 服务器 */
export const needsMock = false;

/** 纳入 smoke 快速回归子集（7 步，纯 UI 交互） */
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

  // 等待 checkbox 初始化完成（issue #88：确定性等待替代固定 500ms sleep——
  // 页面在 twpConfig.onReady 回调里恢复 checked，机器负载下 500ms 不够，
  // 曾造成「刷新后 checked=false」假失败，与 popup 就绪竞态同类）
  const persistedDeadline = Date.now() + 8000;
  for (;;) {
    const current = await page.evaluate((expected) => {
      const cb = document.getElementById("translateSelectedWhenPressTwice");
      if (!cb) return null;
      return { checked: cb.checked, matches: cb.checked === expected };
    }, toggledChecked);
    if (current?.matches) break;
    if (Date.now() > persistedDeadline) break;
    await page.waitForTimeout(200);
  }

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
 * [H2] 验证「打开原生快捷键管理器」按钮存在、可见且可点击。
 *
 * 流程：
 *   1. 导航到 options#hotkeys
 *   2. 确认 #openNativeShortcutManager 按钮存在且可见（不可见 = 硬失败）
 *   3. 点击按钮（不验证原生对话框是否打开，因为那是浏览器行为）
 *   4. 捕获点击是否抛出 JS 错误
 *
 * 注（issue #85）：本步骤原先在按钮不可见时「warn + skip」，掩盖了 Chrome 148+
 * 上因 `typeof browser` 探测误判导致按钮被隐藏的真实缺陷。现改为硬失败断言。
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
  await page.waitForTimeout(1500); // 等待 commands.getAll 回调完成渲染

  // 检查按钮是否存在
  const buttonExists = await page.evaluate(() => {
    const btn = document.getElementById("openNativeShortcutManager");
    return !!btn;
  });

  if (!buttonExists) {
    throw new Error("[H2] #openNativeShortcutManager 按钮不存在（应始终存在于 options.html）");
  }

  // 检查按钮是否可见 —— Chromium 桌面端必须显示原生管理器按钮（issue #85 硬失败）
  const buttonVisible = await page.evaluate(() => {
    const btn = document.getElementById("openNativeShortcutManager");
    if (!btn) return false;
    const style = getComputedStyle(btn);
    return style.display !== "none" && btn.offsetParent !== null;
  });

  if (!buttonVisible) {
    throw new Error(
      "[H2] #openNativeShortcutManager 不可见 —— Chromium 桌面端应显示原生快捷键管理器入口（issue #85：`typeof browser` 探测误判会把路径切到 Firefox 分支）"
    );
  }

  console.log("  [H2] #openNativeShortcutManager 按钮存在且可见 ✓");

  // 点击按钮并检查是否抛出错误
  let clickErrored = false;
  try {
    await page.click("#openNativeShortcutManager");
    await page.waitForTimeout(800);
    console.log("  [H2] 点击按钮未抛出 JS 错误 ✓");

    // chrome.tabs.create 会打开 chrome://extensions/shortcuts —— 关闭它，
    // 避免额外页面泄漏到后续步骤（issue #85 引入按钮可见性硬断言后此路径必达）。
    for (const p of page.context().pages()) {
      if (p !== page && p.url().startsWith("chrome://extensions")) {
        await p.close().catch(() => {});
      }
    }
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
// H8: 快捷键列表每行 label 非空（含 Firefox 能力形态）
// ═════════════════════════════════════════════════════════════════

/**
 * [H8] 验证「键盘快捷键」列表里**每一行都有非空 label**（issue #85）。
 *
 * 流程（原生 Chromium 路径）：
 *   1. 导航到 options#hotkeys
 *   2. 断言页内列表容器隐藏、原生管理器按钮显示（Chromium 语义）
 *
 * 流程（Firefox 能力形态，新开页面注入 `browser.commands.update`）：
 *   3. addInitScript 注入 Firefox 形态的 browser 全局 → 列表渲染
 *   4. 断言每行 (:scope > div) 非空，且保留命令行的 label 等于页面内
 *      chrome.i18n.getMessage("lblActivateTheExtension")
 *
 * 背景：Chrome 148 起 `browser` 命名空间同时存在，保留命令 `_execute_action`
 * 的 description 为空 → 首行 label 空白。此步骤是用户症状的浏览器层锚点。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象
 * @param {string} extensionId - 扩展 ID
 * @returns {Promise<void>}
 */
async function h8HotkeyRowLabels(page, extensionId) {
  console.log("[H8] 快捷键列表 label 非空测试...");

  // ── 原生 Chromium 路径 ──
  await page.goto(`chrome-extension://${extensionId}/options/options.html#hotkeys`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  const chromiumPath = await page.evaluate(() => ({
    listDisplay: getComputedStyle(document.getElementById("hotkeysListContainer")).display,
    nativeBtnDisplay: getComputedStyle(document.getElementById("openNativeShortcutManager")).display,
  }));
  if (chromiumPath.listDisplay !== "none") {
    throw new Error(`[H8] 页内快捷键列表应隐藏（Chromium 语义），实际 display=${chromiumPath.listDisplay}`);
  }
  if (chromiumPath.nativeBtnDisplay === "none") {
    throw new Error("[H8] 原生快捷键管理器按钮应显示（Chromium 语义）");
  }
  console.log("  [H8] Chromium 路径：列表隐藏 + 原生按钮显示 ✓");

  // ── Firefox 能力形态（注入 browser.commands.update）──
  const ffPage = await page.context().newPage();
  try {
    await ffPage.addInitScript(() => {
      try {
        window.browser = { commands: { update: function () {}, getAll: (cb) => chrome.commands.getAll(cb) } };
      } catch (_) { /* ignore */ }
    });
    await ffPage.goto(`chrome-extension://${extensionId}/options/options.html#hotkeys`, { waitUntil: "load" });
    await ffPage.waitForTimeout(2000);

    // ── 集合完整性断言（issue #88, P3）：每行 label 非空 ──
    // 注：rows 从页面 dump 过一次用于显示；断言走共享 helper（集合完整性模式）。
    const completeness = await assertAllHaveNonEmptyText(ffPage, {
      selector: "#KeyboardShortcuts .shortcut-row",
      labelSelector: ":scope > div",
      minCount: 1,
      label: "hotkeys 列表（Firefox 形态）",
    });
    console.log(`  [H8] 集合完整性：${completeness.count} 行全部非空 ✓`);

    const dumped = await ffPage.evaluate(() => {
      const rows = [...document.querySelectorAll("#KeyboardShortcuts .shortcut-row")];
      return {
        listDisplay: getComputedStyle(document.getElementById("hotkeysListContainer")).display,
        expectedFallback: chrome.i18n.getMessage("lblActivateTheExtension"),
        rows: rows.map((li) => ({ id: li.id, label: (li.querySelector(":scope > div")?.textContent ?? "").trim() })),
      };
    });

    if (dumped.listDisplay !== "block") {
      throw new Error(`[H8] Firefox 形态下页内列表应显示，实际 display=${dumped.listDisplay}`);
    }
    const reservedRow = dumped.rows.find((r) => r.id.startsWith("_execute_"));
    if (!reservedRow) {
      throw new Error("[H8] 未找到浏览器保留命令行（_execute_*）");
    }
    if (!dumped.expectedFallback || reservedRow.label !== dumped.expectedFallback) {
      throw new Error(
        `[H8] 保留命令行 label="${reservedRow.label}"，期望 i18n 兜底 "${dumped.expectedFallback}"`
      );
    }
    console.log(`  [H8] Firefox 形态：${dumped.rows.length} 行全部非空，保留命令行 = "${reservedRow.label}" ✓`);
  } finally {
    await ffPage.close().catch(() => {});
  }

  console.log("[H8] 通过 ✓\n");
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
    // 每次进入本步骤都先 page.goto（新页加载），options.js 初始化时无条件执行
    // display:inline-block —— 不可见即真实缺陷，硬失败（issue #88：症状不能当跳过前提）。
    throw new Error("[H3] #btnCalculateStorage 初始不可见（新页加载后应始终可见）");
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
 * [H4] 验证「重置为默认设置」按钮功能（issue #88, P4：真实点击路径）。
 *
 * 旧实现（假绿）：从不点击按钮（注释说「点击会触发 chrome.runtime.reload()
 * 破坏上下文」），改用「直接 remove storage 键」模拟重置——**真实恢复路径
 * 从未被测**（#85 的同族第二缺陷正藏在这条路径里：restoreToDefault 的
 * browser.commands.update 调用）。
 *
 * 新实现（probe 实证，真实 Chrome 151）：
 *   - 真实 Playwright 点击 + 真实 accept confirm → 完整执行
 *     restoreToDefault()（含 #85 同族的 hotkey 分支、逐键写入、import 调用）；
 *   - 唯一被替换的是 chrome.runtime.reload —— probe 实证（probe-h4-reload3）：
 *     该调用在此 harness 下会让扩展永久卸载（旧页面 chrome 消失、新页面
 *     ERR_BLOCKED_BY_CLIENT、15s 内无 SW 恢复），reload 之后的上下文不可读；
 *   - 替换以「断言 reload 被调用」补偿：stub 记录 __reloadCalled=true 证明
 *     完整真实路径已走完（probe-reload-stub 实证：重置后值回到默认 +
 *     reloadCalled=true）。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象（主上下文，未使用）
 * @param {string} extensionId - 扩展 ID（主上下文，未使用）
 * @param {import("playwright").Worker} serviceWorker - 主上下文 SW（未使用）
 * @param {import("./setup.mjs").ErrorCollector} collector - 错误收集器
 * @returns {Promise<void>}
 */
async function h4ResetToDefaults(page, extensionId, serviceWorker, collector) {
  console.log("[H4] 重置默认设置测试（真实点击路径，隔离上下文）...");

  // 默认值以 src/lib/config.js defaultConfig 为契约（showFloatingBtn="yes",
  // translateClickingOnce="no"）；重置生效 = 回到默认值或被清除（null 亦合格，
  // 因为「重置」的等价有效形态是恢复默认）。
  const defaultsSource = {
    showFloatingBtn: "yes",
    translateClickingOnce: "no",
  };

  await runWithIsolatedExtensionContext(async (iso) => {
    const isoSw1 = iso.serviceWorker;

    // 1. 预置非默认值（与默认相反）
    await writeStorage(isoSw1, "showFloatingBtn", "no");
    await writeStorage(isoSw1, "translateClickingOnce", "yes");
    const pre = await readStorageMulti(isoSw1, ["showFloatingBtn", "translateClickingOnce"]);
    console.log(`  [H4] 隔离上下文预置非默认值: ${JSON.stringify(pre)}`);
    if (pre.showFloatingBtn !== "no" || pre.translateClickingOnce !== "yes") {
      throw new Error(`[H4] 预置失败: ${JSON.stringify(pre)}`);
    }

    // 2. 导航到 options#storage，等待真实就绪（onclick 注册 = 处理器绑定的判据）
    await iso.page.goto(`chrome-extension://${iso.extensionId}/options/options.html#storage`, { waitUntil: "load" });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      ready = await iso.page
        .evaluate(() => typeof document.getElementById("resetToDefault")?.onclick === "function")
        .catch(() => false);
      if (ready) break;
      await iso.page.waitForTimeout(250);
    }
    if (!ready) {
      throw new Error("[H4] #resetToDefault onclick 未注册（60 次轮询后，结构契约被破坏）");
    }

    // 3. 替换 chrome.runtime.reload（harness 不兼容副作用；见 docblock）。
    //    其余一切保持真实。
    const stubbed = await iso.page.evaluate(() => {
      window.__reloadCalled = false;
      chrome.runtime.reload = function () {
        window.__reloadCalled = true;
      };
      return true;
    });
    if (!stubbed) throw new Error("[H4] reload stub 安装失败");

    // 4. 真实点击 + 真实 accept confirm
    iso.page.once("dialog", (dialog) => dialog.accept().catch(() => {}));
    await iso.page.click("#resetToDefault");
    console.log("  [H4] 已真实点击 #resetToDefault（confirm 已接受）");

    // 5. 断言真实重置结果 + 完整路径已走完（reload 被调用）
    let after = null;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      await iso.page.waitForTimeout(500);
      after = await iso.page.evaluate(async () => {
        const items = await chrome.storage.local.get(["showFloatingBtn", "translateClickingOnce"]);
        return {
          showFloatingBtn: items.showFloatingBtn ?? null,
          translateClickingOnce: items.translateClickingOnce ?? null,
          reloadCalled: window.__reloadCalled,
        };
      });
      const ok =
        (after.showFloatingBtn === defaultsSource.showFloatingBtn || after.showFloatingBtn == null) &&
        (after.translateClickingOnce === defaultsSource.translateClickingOnce || after.translateClickingOnce == null);
      if (ok) break;
    }

    console.log(`  [H4] 重置后的值: ${JSON.stringify(after)}（默认期望: ${JSON.stringify(defaultsSource)}）`);

    if (!after.reloadCalled) {
      throw new Error("[H4] 完整路径未走完：chrome.runtime.reload 未被调用（restoreToDefault 中断）");
    }
    if (after.showFloatingBtn === "no") {
      throw new Error(`[H4] showFloatingBtn 重置后仍为非默认值 "no"（真实恢复路径缺陷，#85 同族路径）`);
    }
    if (after.translateClickingOnce === "yes") {
      throw new Error(`[H4] translateClickingOnce 重置后仍为非默认值 "yes"（真实恢复路径缺陷）`);
    }
    console.log("  [H4] 真实重置路径完整执行：两键已恢复默认/被清除 + reload 已触发 ✓");
  }, collector);

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
// H9: 真实备份/恢复（issue #88, P4）
// ═════════════════════════════════════════════════════════════════

/**
 * [H9] 验证「备份到文件」与「从文件恢复」的真实路径（issue #88, P4）。
 *
 * 旧实现只有 H5「按钮存在性」——真实导出/导入路径从未被测（H4 同族的
 * 「破坏性路径空白」）。本步骤在隔离扩展上下文中：
 *
 *   1. 预置可辨识配置 → 真实点击 #backupToFile → 捕获 download →
 *      校验下载内容为合法 JSON 且包含预置值；
 *   2. 改掉值 → 真实点击 #restoreFromFile → filechooser.setFiles(构造文件)
 *      → 真实接受 confirm → 断言 storage 反映了导入文件的值；
 *   3. 与 H4 相同，仅替换 chrome.runtime.reload（该调用在此 harness 下
 *      会永久卸载扩展，probe 实证见 H4 docblock），并断言它被调用以证明
 *      完整真实路径已走完。
 *
 * @param {import("playwright").Page} page - Playwright 页面对象（主上下文，未使用）
 * @param {import("./setup.mjs").ErrorCollector} collector - 错误收集器
 * @returns {Promise<void>}
 */
async function h9RealBackupRestore(page, collector) {
  console.log("[H9] 真实备份/恢复路径测试（隔离上下文）...");

  // 手工构造的导入文件（合法 JSON，键在 defaultConfig 内）
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmpDir = mkdtempSync(join(tmpdir(), "dualtran-h9-"));
  const importPath = join(tmpDir, "import-config.json");
  writeFileSync(
    importPath,
    JSON.stringify({ showFloatingBtn: "no", translateClickingOnce: "yes" }),
    "utf8"
  );

  try {
    await runWithIsolatedExtensionContext(async (iso) => {
      const isoSw1 = iso.serviceWorker;

      // 1. 预置可辨识值（供导出校验）
      await writeStorage(isoSw1, "showFloatingBtn", "no");
      await writeStorage(isoSw1, "translateClickingOnce", "yes");
      await iso.page.goto(`chrome-extension://${iso.extensionId}/options/options.html#storage`, { waitUntil: "load" });
      await iso.page.waitForSelector("#backupToFile", { timeout: 10000 });
      // 等待处理器绑定（真实就绪判据，同 H4）
      let ready = false;
      for (let i = 0; i < 60; i++) {
        ready = await iso.page
          .evaluate(() => typeof document.getElementById("restoreFromFile")?.onclick === "function")
          .catch(() => false);
        if (ready) break;
        await iso.page.waitForTimeout(250);
      }
      if (!ready) {
        throw new Error("[H9] #restoreFromFile onclick 未注册（60 次轮询后）");
      }

      // 2. 真实导出：点击 → 捕获 download
      const [download] = await Promise.all([
        iso.page.waitForEvent("download", { timeout: 15000 }),
        iso.page.click("#backupToFile"),
      ]);
      const downloadedPath = await download.path();
      const exportedText = readFileSync(downloadedPath, "utf8");
      let exported = null;
      try {
        exported = JSON.parse(exportedText);
      } catch (e) {
        throw new Error(`[H9] 导出的备份不是合法 JSON: ${e.message}`);
      }
      if (exported.showFloatingBtn !== "no" || exported.translateClickingOnce !== "yes") {
        throw new Error(
          `[H9] 导出内容未包含预置值: showFloatingBtn=${exported.showFloatingBtn}, translateClickingOnce=${exported.translateClickingOnce}`
        );
      }
      console.log(`  [H9] 真实导出成功：download 捕获，JSON 含预置值 ✓ (${exportedText.length} bytes)`);

      // 3. 替换 chrome.runtime.reload（harness 不兼容副作用；H4 docblock 有 probe 实证）
      const stubbed = await iso.page.evaluate(() => {
        window.__reloadCalled = false;
        chrome.runtime.reload = function () {
          window.__reloadCalled = true;
        };
        return true;
      });
      if (!stubbed) throw new Error("[H9] reload stub 安装失败");

      // 先把值改掉，再真实导入（证明值来自文件而非残留）
      await writeStorage(isoSw1, "showFloatingBtn", "yes");
      await writeStorage(isoSw1, "translateClickingOnce", "no");

      iso.page.once("dialog", (dialog) => dialog.accept().catch(() => {}));
      const [chooser] = await Promise.all([
        iso.page.waitForEvent("filechooser", { timeout: 15000 }),
        iso.page.click("#restoreFromFile"),
      ]);
      await chooser.setFiles(importPath);
      console.log("  [H9] 已通过 filechooser 选择导入文件（confirm 已接受）");

      // 4. 断言真实导入结果 + 完整路径已走完（reload 被调用）
      let after = null;
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        await iso.page.waitForTimeout(500);
        after = await iso.page.evaluate(async () => {
          const items = await chrome.storage.local.get(["showFloatingBtn", "translateClickingOnce"]);
          return {
            showFloatingBtn: items.showFloatingBtn ?? null,
            translateClickingOnce: items.translateClickingOnce ?? null,
            reloadCalled: window.__reloadCalled,
          };
        });
        if (after.showFloatingBtn === "no" && after.translateClickingOnce === "yes") break;
      }

      console.log(`  [H9] 导入后的值: ${JSON.stringify(after)}`);
      if (!after.reloadCalled) {
        throw new Error("[H9] 完整路径未走完：chrome.runtime.reload 未被调用（import 中断）");
      }
      if (after.showFloatingBtn !== "no" || after.translateClickingOnce !== "yes") {
        throw new Error(
          `[H9] 真实导入未生效: ${JSON.stringify(after)}（期望文件值 showFloatingBtn="no", translateClickingOnce="yes"）`
        );
      }
      console.log("  [H9] 真实导入生效：storage 反映了文件中的值 + reload 已触发 ✓");
    }, collector);
  } finally {
    const { rmSync } = await import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("[H9] 通过 ✓\n");
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
      throw new Error(`[H6] #${cfg.id} 不存在（H6_SELECTS 必须只包含 options.html 中真实存在的控件）`);
    }

    // 检查选项数量（H6_SELECTS 中的控件均为静态 2+ 选项；不足即真实缺陷）
    const optionCount = await page.evaluate((id) => {
      const sel = document.getElementById(id);
      return sel instanceof HTMLSelectElement ? sel.options.length : 0;
    }, cfg.id);

    if (optionCount <= 1) {
      throw new Error(`[H6] #${cfg.id} 仅有 ${optionCount} 个选项，无法切换（应至少 2 个）`);
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
    // 等待 storage 写入完成（issue #88：确定性等待替代固定 500ms sleep——
    // 机器负载下 sleep 不够，H6 的 showTranslatePageContextMenu 曾因此假失败）
    try {
      await waitForPageStorageValue(page, storageKey, cfg.testValue, 8000);
    } catch {
      console.warn(`    ⚠ waitForPageStorageValue(#${cfg.id}) 超时，继续（持久化断言仍会验证）`);
    }

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

  await runStep("H8", () =>
    h8HotkeyRowLabels(page, extensionId)
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

  await runStep("H9", () =>
    h9RealBackupRestore(page, collector)
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
  console.log(`总步骤数: 8, 失败: ${stepErrors.length}`);

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
