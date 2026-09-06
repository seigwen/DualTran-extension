/**
 * uiStateStore.js — single source of truth (SSOT, L1) for UI state +
 * runtime self-healing (L2).
 *
 * Background (08-ui-state-ssot-plan.md): "button state does not match
 * reality" has occurred 5 times (patterns 7/9/22/23/25). Common root
 * cause: UI components keep copies of engine state plus their own state
 * inside closures, synchronized by imperative event streams — a single
 * missed assignment/event corrupts the copy. This module consolidates
 * state into one carrier and provides:
 *
 *   1. setState(patch, source) — the only mutation entry (validate +
 *      log + broadcast)
 *   2. Change log (ring buffer, dumpLog()) — first diagnostic tool for
 *      state bugs
 *   3. Watchdog arbitration — without intervention, UI state must match
 *      engine-derived expectation; mismatch self-heals (corrected to the
 *      engine-derived value). User choices (intervention=true) are not
 *      overridden.
 *
 * State has two layers:
 *   - Engine mirrors (pageLanguageState/pageRenderState/aiRenderState/
 *     aiModeActive): driven by pageTranslator events; UI never mutates
 *     them directly.
 *   - UI decision state (highlight/displayMode/intervention/
 *     googleInFlight/aiInFlight): owned exclusively by this store.
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
 * Resolve what the UI state MUST be when no user intervention happened
 * (live event arbitration, conservative — mirrors floatingBtn's event
 * callback semantics):
 *
 *   - pageLanguageState === "original" → Original
 *   - pageLanguageState === "translated" → Google
 *
 * AI highlight is strictly a user choice (intervention=true, click on AI).
 * Live events never drive highlight to ai — the auto-translate path
 * highlights Google even when an AI result arrives (Q5: engine applies
 * the result via aiModeActive but the button stays Google until the user
 * clicks AI). Deriving ai here would change existing behavior.
 */
function deriveEngineDrivenUi(engine) {
  const mode = engine.pageLanguageState === "translated" ? "google" : "original";
  return { highlight: mode, displayMode: mode };
}

/**
 * Resolve the initial UI state after an SPA rebuild (resetForRebuild).
 * Full derivation INCLUDING the AI flow: on rebuild the page may already
 * show AI translations (user clicked AI before navigating), and the
 * rebuilt button group must restore that. Mirrors resolveInitialUiState
 * in floatingBtnClickResolver.js (keep in sync):
 *
 *   - page untranslated → Original
 *   - translated + AI flow started (aiRenderState !== "idle" AND
 *     aiModeActive) → AI
 *   - translated + otherwise → Google
 */
function deriveRebuildUi(engine) {
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
 * highlight/displayMode must match the engine-driven expectation
 * (conservative — AI highlight is a user choice, never derived live).
 * Returns the corrected patch (empty when consistent).
 */
function arbitrateEngineDrivenState(state) {
  if (state.intervention) return {};
  const expected = deriveEngineDrivenUi(state);
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
  const { highlight, displayMode } = deriveRebuildUi(engineState);
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
