/**
 * uiStateStore.js — UI 状态单一事实源（SSOT, L1）与运行时自愈（L2）。
 *
 * 背景（08-ui-state-ssot-plan.md）：「按钮状态与实际不符」已出现 5 次
 * 同类事故（pattern 7/9/22/23/25），共性根因：UI 组件在闭包内维护
 * 引擎状态副本 + 自有状态，靠命令式事件流同步，漏一个赋值点/事件即
 * 失真。本模块把状态收拢到唯一载体，并提供：
 *
 *   1. setState(patch, source) —— 唯一变更入口（校验 + 日志 + 广播）
 *   2. 变更日志（环形缓冲，dumpLog() 导出）—— 状态 bug 诊断第一工具
 *   3. watchdog 仲裁 —— 无 intervention 时 UI 态必须与引擎态一致，
 *      不一致则自愈（纠正为引擎派生值），用户选择（intervention=true）
 *      不干预
 *
 * 状态字段分两层：
 *   - 引擎镜像（pageLanguageState/pageRenderState/aiRenderState/
 *     aiModeActive）：由 pageTranslator 事件驱动，UI 不在本层修改
 *   - UI 决策态（highlight/displayMode/intervention/googleInFlight/
 *     aiInFlight）：唯一所有者是本 store
 */
const MAX_LOG_ENTRIES = 50;

const engineState = {
  pageLanguageState: "original", // "original" | "translated"
  pageRenderState: "idle", // "idle" | "loading" | "success" | "error"
  aiRenderState: "idle", // "idle" | "loading" | "success" | "error"
  aiModeActive: true, // Q5: default true — engine applies results by default
};

const uiState = {
  highlight: "original", // "original" | "google" | "ai" — user selection
  displayMode: "original", // what the page actually shows
  intervention: false, // user has clicked a button on this page
  googleInFlight: false,
  aiInFlight: false,
};

const changeLog = []; // { ts, source, patch, before, after }
const subscribers = new Set();

/**
 * Resolve what the UI state MUST be when no user intervention happened.
 * Mirrors resolveInitialUiState in floatingBtnClickResolver.js (single
 * derivation rule — keep in sync).
 */
function deriveExpectedUi(engine) {
  const aiFlowStarted = engine.aiRenderState !== "idle" && engine.aiModeActive;
  const mode =
    engine.pageLanguageState === "translated"
      ? aiFlowStarted
        ? "ai"
        : "google"
      : "original";
  return { highlight: mode, displayMode: mode };
}

function pushLog(source, patch, before, after) {
  changeLog.push({
    ts: Date.now(),
    source: source || "unknown",
    patch,
    before: { ...engineState, ...uiState, ...before },
    after: { ...engineState, ...uiState, ...after },
  });
  if (changeLog.length > MAX_LOG_ENTRIES) changeLog.shift();
}

/**
 * Watchdog arbitration (L2): when the user has NOT intervened, the UI
 * highlight/displayMode must match the engine-derived expectation.
 * Returns the corrected patch (empty when consistent).
 */
function arbitrateEngineDrivenState(state) {
  if (state.intervention) return {};
  const expected = deriveExpectedUi(state);
  const patch = {};
  if (state.highlight !== expected.highlight) {
    patch.highlight = expected.highlight;
  }
  if (state.displayMode !== expected.displayMode) {
    patch.displayMode = expected.displayMode;
  }
  return patch;
}

/**
 * Apply a state patch. THE only mutation entry point.
 *
 * @param {Object} patch - partial state ({ engineState fields } and/or
 *   { uiState fields }). Field names are flattened (e.g. pageLanguageState,
 *   highlight).
 * @param {string} [source] - who is changing the state ("handleButtonClick",
 *   "onPageLanguageStateChange", ...). Logged for diagnostics.
 * @returns {Object} the applied patch (including any watchdog correction)
 */
export function setState(patch, source) {
  const validEngine = new Set(Object.keys(engineState));
  const validUi = new Set(Object.keys(uiState));
  const applied = {};
  const before = { ...engineState, ...uiState };

  for (const [key, value] of Object.entries(patch || {})) {
    if (validEngine.has(key)) {
      engineState[key] = value;
      applied[key] = value;
    } else if (validUi.has(key)) {
      uiState[key] = value;
      applied[key] = value;
    } else {
      throw new Error(`uiStateStore: unknown state field "${key}"`);
    }
  }

  // Watchdog: correct engine-driven inconsistencies (never user choices).
  const after1 = { ...engineState, ...uiState };
  const correction = arbitrateEngineDrivenState(after1);
  let corrected = false;
  if (Object.keys(correction).length > 0) {
    for (const [key, value] of Object.entries(correction)) {
      if (uiState[key] !== value) {
        uiState[key] = value;
        applied[key] = value;
        corrected = true;
      }
    }
  }
  if (corrected) {
    console.warn(
      "[uiStateStore] watchdog corrected engine-driven UI state mismatch:",
      { correction, engineState: { ...engineState }, uiState: { ...uiState } }
    );
  }

  pushLog(source, { ...applied }, before, { ...engineState, ...uiState });
  if (Object.keys(applied).length > 0) {
    subscribers.forEach((cb) => cb({ ...applied }));
  }
  return applied;
}

/** Full state snapshot (engine mirrors + UI state). */
export function getState() {
  return { ...engineState, ...uiState };
}

/** Subscribe to state changes; returns an unsubscribe function. */
export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/** Reset UI decision state from the engine (SPA rebuild path). */
export function resetForRebuild() {
  uiState.intervention = false;
  uiState.googleInFlight = false;
  uiState.aiInFlight = false;
  const { highlight, displayMode } = deriveExpectedUi(engineState);
  uiState.highlight = highlight;
  uiState.displayMode = displayMode;
  pushLog("resetForRebuild", { reset: true }, uiState, uiState);
  subscribers.forEach((cb) => cb({ reset: true, highlight, displayMode }));
}

/** Export the change log (diagnostic tool for state bugs). */
export function dumpLog() {
  return changeLog.map((e) => ({ ...e }));
}

/** Test-only: clear all state and logs. */
export function __resetForTest() {
  Object.assign(engineState, {
    pageLanguageState: "original",
    pageRenderState: "idle",
    aiRenderState: "idle",
    aiModeActive: true,
  });
  Object.assign(uiState, {
    highlight: "original",
    displayMode: "original",
    intervention: false,
    googleInFlight: false,
    aiInFlight: false,
  });
  changeLog.length = 0;
  subscribers.clear();
}
