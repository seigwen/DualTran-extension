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
 * Resolve the INTENT-driven UI mode from the engine mirrors (the single
 * derivation rule, plan 30 / Q1a+Q4e — replaces the old
 * deriveEngineDrivenUi + deriveRebuildUi pair):
 *
 *   - pageLanguageState === "original" → "original"
 *   - translated + AI flow started (aiModeActive && aiRenderState !== "idle")
 *     → "ai"   (includes in-flight/loading and error: click = retry)
 *   - translated + otherwise → "google"
 *
 * The highlight follows the INTENT, not what the page currently shows: an
 * AI flow in flight keeps the AI button highlighted while the page still
 * shows Google + a spinner (legal midstate, plan 30 §〇).
 */
function deriveIntentUi(engine) {
  const aiIntent =
    engine.pageLanguageState === "translated" &&
    engine.aiModeActive &&
    engine.aiRenderState !== "idle"; // loading | success | error
  const mode =
    engine.pageLanguageState === "translated"
      ? aiIntent
        ? "ai"
        : "google"
      : "original";
  return { highlight: mode };
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
 * Watchdog arbitration (L2): the highlight must match the INTENT derivation
 * unless the intent latch (intervention) is set. displayMode is NOT
 * arbitrated — it is an actual-display record owned by the actual-display
 * event writers (plan 30 / Q4e).
 *
 * Latch (plan 30 / Q1b+Q4a): once an explicit intent is written, the latch
 * holds the highlight against derivation divergences until the derivation
 * converges to the same mode (then it auto-releases — no leak) or a
 * restore/rebuild clears it. Returns the corrected patch (empty when the
 * state is consistent or latched-and-divergent).
 */
function arbitrateEngineDrivenState(state) {
  const expected = deriveIntentUi(state);
  if (state.intervention) {
    // Auto-release: derivation caught up with the explicit intent.
    if (state.highlight === expected.highlight) {
      return { intervention: false };
    }
    // Latched divergence — keep the explicit intent.
    return {};
  }
  const patch = {};
  if (state.highlight !== expected.highlight) {
    patch.highlight = expected.highlight;
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
  if (corrected && correction.highlight !== undefined) {
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
  const { highlight } = deriveIntentUi(engineState);
  uiState.highlight = highlight;
  // displayMode is NOT derived on rebuild (intent model): the button group
  // re-registers blocks from actual display; the highlight comes from intent.
  pushLog("resetForRebuild", { reset: true }, uiState, uiState);
  subscribers.forEach((cb) => cb({ reset: true, highlight }));
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
