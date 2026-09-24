/**
 * DualTran E2E 测试编排器
 *
 * 这是所有 E2E 测试场景的统一入口。它按需加载各场景模块，
 * 根据 needsMock 标志决定使用 setupFull() 还是 setupBasic()，
 * 并在 setupFull 失败时自动降级为仅运行不需要 Mock 服务器的场景。
 *
 * 用例：
 *   node tests/browser-e2e/run-all.mjs                           # 运行全部场景
 *   node tests/browser-e2e/run-all.mjs --scenario=translation     # 仅运行翻译场景
 *   node tests/browser-e2e/run-all.mjs --grep="暗黑模式"          # 按名称筛选场景
 *
 * @module run-all
 */

import { setupBasic, setupFull, teardown, captureFailureShot, resetScenarioState } from "./setup.mjs";
import { resolveMockModeConfig, parseBrowserE2eArgs } from "./browser-e2e-config.mjs";

// ═══════════════════════════════════════════════════════════════
// CLI 参数解析
// ═══════════════════════════════════════════════════════════════

/**
 * 解析 run-all.mjs 的专用 CLI 参数。
 *
 * 支持的参数：
 *   --scenario=<name>  — 仅运行指定名称的场景
 *   --grep=<pattern>   — 仅运行名称匹配指定模式的场景
 *   --mock-mode=<mode> — 透传给 setupFull / resolveMockModeConfig（legacy | aimock）
 *   --smoke            — 仅运行标记为 smoke 的快速场景子集（用于 CI 快速回归）
 *
 * 未知参数会被静默忽略。
 *
 * @param {string[]} argv - process.argv.slice(2) 的结果
 * @returns {{ scenario?: string, grep?: string, mockMode?: string, smoke?: boolean }} 解析后的参数对象
 */
function parseRunAllArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith("--scenario=")) {
      parsed.scenario = arg.slice("--scenario=".length).trim();
    } else if (arg.startsWith("--grep=")) {
      parsed.grep = arg.slice("--grep=".length).trim();
    } else if (arg.startsWith("--mock-mode=")) {
      parsed.mockMode = arg.slice("--mock-mode=".length).trim();
    } else if (arg === "--smoke") {
      parsed.smoke = true;
    }
  }
  return parsed;
}

// ═══════════════════════════════════════════════════════════════
// 场景加载
// ═══════════════════════════════════════════════════════════════

/**
 * 所有 E2E 场景模块的文件路径列表。
 * 每个条目对应 tests/browser-e2e/ 目录下的一个 .mjs 文件。
 * 新增场景时只需在这里添加一行。
 *
 * @type {string[]}
 */
const SCENARIO_MODULE_PATHS = [
  "./translation.mjs",
  "./install-firstrun.mjs",
  "./settings-translation.mjs",
  "./settings-appearance.mjs",
  "./settings-advanced.mjs",
  "./popup-controls.mjs",
  "./error-edge.mjs",
  "./popup-behavior.mjs",
  "./options-behavior.mjs",
  "./provider-migration.mjs",
  "./models-dev-cache.mjs",
  "./i18n-behavior.mjs",
  "./navigation-recovery.mjs",
  "./ai-nav-restore.mjs",
  "./dynamic-content-ai-translation.mjs",
  "./dynamic-content-showmore.mjs",
  "./translation-replace-original.mjs",
  "./observer-feedback-loop.mjs",
  "./floating-btn-three-state.mjs",
  "./self-heal-matrix.mjs",
  "./floating-btn-position-restore.mjs",
  "./cross-level-journey.mjs",
  "./ai-block-indicator.mjs",
  "./visual-audit.mjs",
];

/**
 * 动态加载所有场景模块。
 *
 * 每个模块应导出：
 *   - name: string  — 场景名称（用于 --scenario / --grep 筛选）
 *   - needsMock: boolean — 是否需要 Mock LLM 服务器
 *   - smoke: boolean — 是否纳入 smoke 快速回归子集（可选，默认 false）
 *   - run: (scope: Object) => Promise<void> — 场景的执行入口
 *
 * 如果某个模块文件不存在或导入失败，跳过该模块并输出警告。
 * 这确保尚未创建的场景文件不会阻塞整个编排器。
 *
 * @returns {Promise<Array<{ name: string, needsMock: boolean, smoke: boolean, run: Function }>>} 已加载的场景数组
 */
async function loadScenarios() {
  /** 加载成功的场景数组 */
  const scenarios = [];
  /** 加载失败（非「可选文件缺失」）的场景 — 不得静默丢弃 */
  const fatalLoadErrors = [];

  for (const modulePath of SCENARIO_MODULE_PATHS) {
    try {
      // 动态导入场景模块
      const mod = await import(modulePath);
      // 验证模块是否正确导出必需的元数据
      if (typeof mod.name !== "string" || typeof mod.run !== "function") {
        fatalLoadErrors.push(`${modulePath}: 缺少 name/run 导出`);
        continue;
      }
      scenarios.push({
        name: mod.name,
        needsMock: mod.needsMock === true,
        smoke: mod.smoke === true,
        run: mod.run,
      });
      console.log(`[OK] 已加载场景: "${mod.name}" (needsMock=${mod.needsMock}, smoke=${mod.smoke === true})`);
    } catch (err) {
      const notFound =
        err?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module|ENOENT/.test(err?.message || "");
      if (notFound) {
        // SKIP-DATA: 可选场景文件尚未创建（ENOENT）——按设计不阻塞编排器。
        console.warn(`[WARN] 跳过（可选场景文件不存在）: ${modulePath}`);
        continue;
      }
      fatalLoadErrors.push(`${modulePath}: ${err.message}`);
    }
  }

  if (fatalLoadErrors.length > 0) {
    for (const message of fatalLoadErrors) {
      console.error(`[FATAL] 场景模块加载失败: ${message}`);
    }
    throw new Error(`场景模块加载失败 ${fatalLoadErrors.length} 个——不得静默丢弃场景（issue #88）`);
  }

  return scenarios;
}

// ═══════════════════════════════════════════════════════════════
// 场景筛选
// ═══════════════════════════════════════════════════════════════

/**
 * 根据 --scenario 和 --grep 参数筛选场景。
 *
 * --scenario 要求精确匹配场景的 name 字段。
 * --grep 使用子字符串匹配（不区分大小写）。
 * 两者同时指定时，取交集（两者都匹配的场景）。
 *
 * @param {Array<{ name: string, needsMock: boolean, smoke: boolean, run: Function }>} scenarios - 全部已加载的场景
 * @param {{ scenario?: string, grep?: string, smoke?: boolean }} options - CLI 筛选参数
 * @returns {Array<{ name: string, needsMock: boolean, smoke: boolean, run: Function }>} 筛选后的场景数组
 */
function filterScenarios(scenarios, options) {
  let filtered = scenarios;

  // smoke 模式：只保留标记为 smoke 的快速场景
  if (options.smoke) {
    filtered = filtered.filter((s) => s.smoke === true);
    console.log(`[SMOKE MODE] 筛选后保留 ${filtered.length} 个 smoke 场景`);
  }

  if (options.scenario) {
    // 按场景名称精确筛选
    filtered = filtered.filter((s) => s.name === options.scenario);
    if (filtered.length === 0) {
      console.warn(`[WARN] 未找到名为 "${options.scenario}" 的场景`);
    }
  }

  if (options.grep) {
    // 按名称子字符串筛选（不区分大小写）
    const pattern = options.grep.toLowerCase();
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(pattern));
    if (filtered.length === 0) {
      console.warn(`[WARN] 没有场景名称包含 "${options.grep}"`);
    }
  }

  return filtered;
}

// ═══════════════════════════════════════════════════════════════
// 场景执行
// ═══════════════════════════════════════════════════════════════

/**
 * 执行一组需要 Mock 服务器的场景。
 *
 * 使用 setupFull() 启动完整环境（Mock 服务器 + 静态页面服务器 + 浏览器）。
 * 如果 setupFull() 抛出异常（例如 Mock 服务器启动失败），
 * 记录错误后跳过该组所有场景，但不会阻止 basic 场景继续执行。
 *
 * @param {Array<{ name: string, run: Function }>} scenarios - 需要 Mock 的场景列表
 * @param {Object} cliOptions - CLI 参数（用于透传 mock-mode）
 * @returns {Promise<number>} 本组中失败的场景数
 */
async function runMockScenarios(scenarios, cliOptions) {
  if (scenarios.length === 0) {
    return 0;
  }

  console.log(`\n=== 阶段 1: 需要 Mock 服务器的场景 (${scenarios.length} 个) ===`);

  /** 记录所有致命的 setup/场景错误 */
  let fatalCount = 0;

  // ── 启动完整环境 ──
  let scope;
  try {
    scope = await setupFull({ mockMode: cliOptions.mockMode });
  } catch (setupErr) {
    // setupFull 失败（如 Mock 服务器启动超时）— 降级处理
    fatalCount++;
    console.error(`\n[FATAL] setupFull() 失败: ${setupErr.message}`);
    // skip-typing-allow: 这是 fatal 分支（fatalCount 已计入，最终退出码非零），不是成功跳过
    console.error("[FATAL] 跳过所有需要 Mock 服务器的场景。");
    console.error("[FATAL] 将仅运行不需要 Mock 的基本场景。\n");
    scope = null;
  }

  if (!scope) {
    // setupFull 失败，所有 mock 场景都被跳过
    return fatalCount;
  }

  // ── 逐个执行 mock 场景 ──
  try {
    for (const scenario of scenarios) {
      console.log(`\n--- 开始场景: "${scenario.name}" ---`);
      // V2（issue #75）：场景边界状态复位。22 个场景共享同一 page 与同一份
      // storage，上个场景的残留会成为下个场景的隐式前置（实证：cross-level
      // 残留 replaceOriginal + AI 全译态污染 visual-audit 的未翻译基线）。
      // best-effort：复位失败不阻塞场景，真实泄漏由保真度断言/lint 兜住。
      await resetScenarioState(scope).catch((e) =>
        console.warn(`[WARN] resetScenarioState 失败（不阻塞场景）: ${e.message}`)
      );
      try {
        await withSkipCapture(scenario.name, () => scenario.run(scope));
        console.log(`--- 场景通过: "${scenario.name}" ---`);
      } catch (scenarioErr) {
        // 单个场景失败不影响后续场景
        fatalCount++;
        console.error(`[FAIL] 场景 "${scenario.name}" 执行失败: ${scenarioErr.message}`);
        if (scenarioErr.stack) {
          console.error(scenarioErr.stack);
        }
        // V1（issue #67）：失败现场截图（最佳努力，绝不掩盖原始错误）
        await captureFailureShot(scope, scenario.name);
      }
    }
  } finally {
    // 确保无论场景是否成功，都清理资源
    await teardown(scope);
  }

  return fatalCount;
}

/**
 * 执行一组不需要 Mock 服务器的基本场景。
 *
 * 使用 setupBasic() 启动最小环境（静态页面服务器 + 浏览器）。
 * 这些场景不依赖 Mock LLM 服务器，即使 setupFull 失败也会运行。
 *
 * @param {Array<{ name: string, run: Function }>} scenarios - 不需要 Mock 的场景列表
 * @returns {Promise<number>} 本组中失败的场景数
 */
async function runBasicScenarios(scenarios) {
  if (scenarios.length === 0) {
    return 0;
  }

  console.log(`\n=== 阶段 2: 基本场景 (${scenarios.length} 个) ===`);

  /** 记录所有致命的 setup/场景错误 */
  let fatalCount = 0;

  // ── 启动基本环境 ──
  let scope;
  try {
    scope = await setupBasic();
  } catch (setupErr) {
    // setupBasic 失败（浏览器启动失败等）— 致命错误
    fatalCount++;
    console.error(`\n[FATAL] setupBasic() 失败: ${setupErr.message}`);
    console.error("[FATAL] 跳过所有基本场景。\n"); // skip-typing-allow: 致命分支——返回 fatalCount + scenarios.length（非零退出），不是成功跳过
    return fatalCount + scenarios.length;
  }

  // ── 逐个执行 basic 场景 ──
  try {
    for (const scenario of scenarios) {
      console.log(`\n--- 开始场景: "${scenario.name}" ---`);
      // V2（issue #75）：场景边界状态复位（同 mock 场景，见上）。
      await resetScenarioState(scope).catch((e) =>
        console.warn(`[WARN] resetScenarioState 失败（不阻塞场景）: ${e.message}`)
      );
      try {
        await withSkipCapture(scenario.name, () => scenario.run(scope));
        console.log(`--- 场景通过: "${scenario.name}" ---`);
      } catch (scenarioErr) {
        fatalCount++;
        console.error(`[FAIL] 场景 "${scenario.name}" 执行失败: ${scenarioErr.message}`);
        if (scenarioErr.stack) {
          console.error(scenarioErr.stack);
        }
        // V1（issue #67）：失败现场截图（最佳努力，绝不掩盖原始错误）
        await captureFailureShot(scope, scenario.name);
      }
    }
  } finally {
    // 确保无论场景是否成功，都清理资源
    await teardown(scope);
  }

  return fatalCount;
}

// ═══════════════════════════════════════════════════════════════
// Skip 统计（issue #88, P2）
// ═══════════════════════════════════════════════════════════════

/**
 * 全编排器累计的类型化跳过记录。
 *
 * issue #88 P2 的设计意图：类型化跳过（SKIP-ENV/SKIP-DATA）是合法退出，
 * 但「合法的跳过」与「被吞掉的失败」在最终日志里必须可区分——否则下一次
 * 假绿仍然无声。编排器在场景运行时旁路 console.log/warn，收集所有
 * `SKIP-ENV:` / `SKIP-DATA:` 行，并在执行摘要中逐条列出。
 *
 * @type {Array<{ scenario: string, type: string, premise: string }>}
 */
const skipRecords = [];

/**
 * 在 fn 执行期间旁路 console.log/console.warn，收集类型化跳过行（不影响输出）。
 *
 * @param {string} scenarioName - 当前场景名
 * @param {Function} fn - 场景执行函数
 * @returns {Promise<*>} fn 的返回值
 */
async function withSkipCapture(scenarioName, fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const capture = (original) => (...args) => {
    const line = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    const m = line.match(/\bSKIP-(ENV|DATA):\s*(.+)/);
    if (m) {
      skipRecords.push({
        scenario: scenarioName,
        type: `SKIP-${m[1]}`,
        premise: m[2].trim().replace(/，.*$/, "").slice(0, 120),
      });
    }
    original.apply(console, args);
  };
  console.log = capture(originalLog);
  console.warn = capture(originalWarn);
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

/**
 * 编排器主函数。
 *
 * 执行流程：
 *   1. 加载所有可用的场景模块
 *   2. 根据 CLI 参数筛选场景
 *   3. 按 needsMock 拆分场景
 *   4a. 先执行需要 Mock 的场景（setupFull）
 *   4b. 无论 4a 是否成功，都执行基本场景（setupBasic）
 *   5. 汇总错误，设置退出码
 *
 * @returns {Promise<void>}
 */
async function main() {
  console.log("=== DualTran E2E 测试编排器 ===\n");

  // ── 解析 CLI 参数 ──
  const cliOptions = parseRunAllArgs(process.argv.slice(2));
  console.log("CLI 参数:", JSON.stringify(cliOptions));
  if (cliOptions.smoke) {
    console.log(">>> [SMOKE MODE] 仅运行快速回归子集 <<<\n");
  }

  // ── 加载场景模块 ──
  const scenarios = await loadScenarios();
  console.log(`\n共加载 ${scenarios.length} 个场景模块。`);

  if (scenarios.length === 0) {
    console.error("[FATAL] 没有可用的场景模块。请确认 tests/browser-e2e/ 下存在有效的 .mjs 场景文件。");
    process.exitCode = 1;
    return;
  }

  // ── 筛选场景 ──
  const selected = filterScenarios(scenarios, cliOptions);
  console.log(`筛选后共 ${selected.length} 个场景待执行。`);

  if (selected.length === 0) {
    console.log("没有需要执行的场景。退出。");
    return;
  }

  // 列出待执行的场景
  for (const s of selected) {
    console.log(`  - "${s.name}" (needsMock=${s.needsMock})`);
  }

  // ── 按 needsMock 分组 ──
  const mockScenarios = selected.filter((s) => s.needsMock);
  const basicScenarios = selected.filter((s) => !s.needsMock);

  console.log(`\n分组结果: 需要 Mock=${mockScenarios.length} 个, 基本=${basicScenarios.length} 个`);

  // ── 执行各阶段 ──
  /** 累计的致命错误数 */
  let totalFatalCount = 0;

  // 阶段 1: 需要 Mock 服务器的场景
  const mockFatalCount = await runMockScenarios(mockScenarios, cliOptions);
  totalFatalCount += mockFatalCount;

  // 阶段 2: 基本场景（无论阶段 1 是否失败，都执行）
  const basicFatalCount = await runBasicScenarios(basicScenarios);
  totalFatalCount += basicFatalCount;

  // ── 最终汇总 ──
  console.log("\n========================================");
  console.log("       编排器执行摘要");
  console.log("========================================");
  console.log(`总场景数: ${selected.length}`);
  console.log(`Mock 场景: ${mockScenarios.length} (失败: ${mockFatalCount})`);
  console.log(`基本场景: ${basicScenarios.length} (失败: ${basicFatalCount})`);
  console.log(`致命错误总数: ${totalFatalCount}`);

  // ── 类型化跳过明细（issue #88, P2）：合法的跳过必须可见 ──
  // skip-typing-allow: 汇总渲染行（统计输出），非跳过分支
  if (skipRecords.length > 0) {
    console.log(`类型化跳过: ${skipRecords.length} 处`); // skip-typing-allow: 汇总渲染行
    for (const rec of skipRecords) {
      console.log(`  - [${rec.scenario}] ${rec.type}: ${rec.premise}`);
    }
  } else {
    console.log("类型化跳过: 0 处（全部步骤实际执行）"); // skip-typing-allow: 汇总渲染行
  }

  if (totalFatalCount > 0) {
    console.error(`\n[FAIL] ${totalFatalCount} 个场景报告了致命错误。`);
    process.exitCode = 1;
  } else {
    console.log("\n[OK] 所有场景均通过。");
  }
  console.log("========================================\n");
}

// ── 启动编排器 ──
main().catch((err) => {
  // 顶层未捕获异常（加载 setup.mjs 失败等）
  console.error("[FATAL] 编排器自身崩溃:", err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exitCode = 1;
});
