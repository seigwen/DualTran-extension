/**
 * Intent-reader gate SSOT (plan 51 — read-side single-source, #152 family).
 *
 * ── Why this exists ──
 *
 * The "highlight / display mismatch" family has 12 incidents (M1–M13). The
 * pattern behind the last two: the SAME "effective run intent" is read by
 * several gates (announcement / flag restore / AI loop / arrival / derive /
 * rebuild / display), and a fix that only closes the gate where the incident
 * happened leaves sibling gates reading a different source — M11 (plan 30 /
 * D6, announcement gate) and M13 (#152, flag restore) are the same formula
 * re-split 12 days apart. The derivation formula itself had drifted into
 * THREE mirrored copies (pageTranslator.currentPageIntentMode /
 * uiStateStore.deriveIntentUi / floatingBtnClickResolver.resolveInitialUiState)
 * until plan 51 converged them into intentDerivation.derivePageIntent.
 *
 * This file is the reader registry. scripts/check-intent-gates.js (18th
 * architecture lint) enforces:
 *
 *   I0  contract — entries well-formed, files/lock files exist
 *   I1  marker <-> registry — single-line markers `// [intent-gate:<id>]`
 *       partition each scanned file into segments (a segment runs from its
 *       marker to the next marker / EOF); no unknown and no stale segments
 *   I2  no orphan refs — every code reference (comments + string literals
 *       masked) of the tokens below must lie inside some segment
 *   I3  count sentinel — per-segment per-token reference counts must equal
 *       `refs` declared here; adding/removing a reference fails the lint
 *       until this registry is updated in the same change
 *   I4  scan-file completeness — any src file with token references must be
 *       listed in INTENT_SCAN_FILES
 *
 * Field contract (enforced by the lint):
 *   id         — lowercase-dash, unique across all files
 *   file       — path relative to repo root; must be in INTENT_SCAN_FILES
 *   refs       — { token: count } for this segment (positive integers)
 *   semantics  — "level"    : reads the (single-source) effective intent
 *                "edge"     : arrival-time epoch comparison (M10 contract)
 *                "display"  : UI/engine mirror + rendering only
 *                "write"    : arming-flag state-machine write site
 *                "internal" : declaration / internal plumbing
 *                "exempt"   : test-only or written-reason exemption
 *   reason     — REQUIRED for "edge" and "exempt"
 *   locks      — probe/test files pinning this site (files must exist)
 *   provenance — REQUIRED: plan/issue reference
 *
 * Refreshing counts after an intentional edit: run
 * `node scripts/check-intent-gates.js --probe` and update `refs` here.
 */

export const INTENT_TOKENS = [
  "aiModeActive",
  "shouldForceAiForThisRun",
  "shouldForceAiAfterPageTranslation",
];

export const INTENT_SCAN_FILES = [
  "src/contentScript/pageTranslator.js",
  "src/contentScript/floatingBtn.js",
  "src/contentScript/uiStateStore.js",
  "src/contentScript/aiUiState.js",
  "src/contentScript/intentDerivation.js",
];

export const INTENT_GATES = [
  {
    id: "state-decls",
    file: "src/contentScript/pageTranslator.js",
    refs: { aiModeActive: 1, shouldForceAiAfterPageTranslation: 1 },
    semantics: "internal",
    locks: ["tests/contentScript/pageTranslator.navRestore.integration.test.js"],
    provenance: "plan 30 / #70 (flag semantics comment above the declarations)",
  },
  {
    id: "arrival-gate",
    file: "src/contentScript/pageTranslator.js",
    refs: { aiModeActive: 4 },
    semantics: "edge",
    reason: "M10 contract: capture-at-start + compare-at-arrival; also the 3 applyAiSuccessWithModeCheck call sites pass aiModeActive through (C09 param pass-through)",
    locks: [
      "tests/contentScript/aiBlockIndicator.integration.test.js",
      "tests/contentScript/hoverBtnBehavior.integration.test.js",
    ],
    provenance: "M10 / #70; C09 param pass-through (plan 51)",
  },
  {
    id: "page-intent-derive",
    file: "src/contentScript/pageTranslator.js",
    refs: { aiModeActive: 1 },
    semantics: "level",
    locks: ["tests/contentScript/intentDerivation.test.js"],
    provenance: "plan 30 / Q4d; plan 51 (converged to derivePageIntent)",
  },
  {
    id: "flag-restore-handlers",
    file: "src/contentScript/pageTranslator.js",
    refs: { shouldForceAiAfterPageTranslation: 2 },
    semantics: "write",
    locks: [
      "tests/contentScript/pageTranslator.navRestore.integration.test.js",
      "tests/browser-e2e/ai-nav-restore.mjs",
    ],
    provenance: "#152 (popstate/pageshow dual-channel arming restore)",
  },
  {
    id: "ai-loop-gate",
    file: "src/contentScript/pageTranslator.js",
    refs: { shouldForceAiAfterPageTranslation: 1 },
    semantics: "level",
    locks: [
      "tests/contentScript/pageTranslator.aiContinuousMode.integration.test.js",
      "tests/browser-e2e/dynamic-content-ai-translation.mjs",
    ],
    provenance: "plan 30 / #134 (AI loop reads the arming flag — the projection of the effective run intent)",
  },
  {
    id: "flag-reset-stop",
    file: "src/contentScript/pageTranslator.js",
    refs: { shouldForceAiAfterPageTranslation: 1 },
    semantics: "write",
    locks: ["tests/contentScript/pageTranslator.navRestore.integration.test.js"],
    provenance: "plan 30 (stopAiAutoTranslate)",
  },
  {
    id: "intent-accessors",
    file: "src/contentScript/pageTranslator.js",
    refs: { aiModeActive: 4 },
    semantics: "level",
    locks: ["tests/contentScript/pageTranslator.navRestore.integration.test.js"],
    provenance: "#70 (setAiModeActive + epoch bump) / B2 getState accessors",
  },
  {
    id: "show-only-writes",
    file: "src/contentScript/pageTranslator.js",
    refs: { shouldForceAiAfterPageTranslation: 2 },
    semantics: "write",
    locks: ["tests/contentScript/hoverBtnBehavior.integration.test.js"],
    provenance: "Q10a/Q17 (showGoogleOnly / showAiOnly local switches)",
  },
  {
    id: "translate-page-ai-flag",
    file: "src/contentScript/pageTranslator.js",
    refs: { shouldForceAiAfterPageTranslation: 2 },
    semantics: "write",
    locks: ["tests/contentScript/pageTranslator.aiContinuousMode.integration.test.js"],
    provenance: "plan 30 / E3 (translatePageAi no-key early return + arm)",
  },
  {
    id: "run-arm-restore",
    file: "src/contentScript/pageTranslator.js",
    refs: { aiModeActive: 1, shouldForceAiForThisRun: 2, shouldForceAiAfterPageTranslation: 3 },
    semantics: "level",
    locks: [
      "tests/contentScript/pageTranslator.navRestore.integration.test.js",
      "tests/browser-e2e/ai-nav-restore.mjs",
    ],
    provenance: "#152 (the disarm line — flag restore must read the same intent as the E1 announcement)",
  },
  {
    id: "announce-e1",
    file: "src/contentScript/pageTranslator.js",
    refs: { aiModeActive: 1, shouldForceAiForThisRun: 1 },
    semantics: "level",
    locks: [
      "tests/contentScript/floatingBtnClickResolver.test.js",
      "tests/contentScript/hoverBtnBehavior.integration.test.js",
    ],
    provenance: "plan 30 / D6 (E1 announcement gate)",
  },
  {
    id: "restore-page-reset",
    file: "src/contentScript/pageTranslator.js",
    refs: { shouldForceAiAfterPageTranslation: 1 },
    semantics: "write",
    locks: ["tests/contentScript/pageTranslator.navRestore.integration.test.js"],
    provenance: "plan 30 (restorePage resets the arming flag)",
  },
  {
    id: "test-hooks",
    file: "src/contentScript/pageTranslator.js",
    refs: { shouldForceAiAfterPageTranslation: 2 },
    semantics: "exempt",
    reason: "test-only accessors (_setForceAiTranslation / _getForceAiTranslation) pinning the #152 disarm contract",
    locks: ["tests/contentScript/pageTranslator.navRestore.integration.test.js"],
    provenance: "#152",
  },
  {
    id: "engine-payload",
    file: "src/contentScript/pageTranslator.js",
    refs: { aiModeActive: 1 },
    semantics: "display",
    locks: ["tests/browser-e2e/popup-behavior.mjs"],
    provenance: "A2 (full engine state for E2E state-consistency assertions; mirrors getState)",
  },
  {
    id: "init-restore",
    file: "src/contentScript/pageTranslator.js",
    refs: { shouldForceAiAfterPageTranslation: 1 },
    semantics: "write",
    locks: ["tests/contentScript/pageTranslator.navRestore.integration.test.js"],
    provenance: "plan 30 (sessionStorage marker restore fallback at init)",
  },
  {
    id: "btn-state-default",
    file: "src/contentScript/floatingBtn.js",
    refs: { aiModeActive: 1 },
    semantics: "display",
    locks: ["tests/contentScript/floatingBtn.behavior.test.js"],
    provenance: "plan 30 / B2 (UI initializes from engine state)",
  },
  {
    id: "btn-click-intent-writes",
    file: "src/contentScript/floatingBtn.js",
    refs: { aiModeActive: 2 },
    semantics: "display",
    locks: ["tests/contentScript/floatingBtn.behavior.test.js"],
    provenance: "plan 30 (atomic intent write = highlight + latch + mirror in ONE setState)",
  },
  {
    id: "store-engine-defaults",
    file: "src/contentScript/uiStateStore.js",
    refs: { aiModeActive: 1 },
    semantics: "display",
    locks: ["tests/contentScript/uiStateStore.test.js"],
    provenance: "Q5 (engine mirror default — engine applies results by default)",
  },
  {
    id: "store-test-reset",
    file: "src/contentScript/uiStateStore.js",
    refs: { aiModeActive: 1 },
    semantics: "exempt",
    reason: "test-only reset helper (__resetForTest)",
    locks: ["tests/contentScript/uiStateStore.test.js"],
    provenance: "#98 store test discipline",
  },
  {
    id: "ai-apply-param",
    file: "src/contentScript/aiUiState.js",
    refs: { aiModeActive: 2 },
    semantics: "display",
    locks: ["tests/contentScript/aiBlockIndicator.integration.test.js"],
    provenance: "M10 (arrival apply signature: aiModeActive + arrivalAllowed)",
  },
  {
    id: "derivation-single-source",
    file: "src/contentScript/intentDerivation.js",
    refs: { aiModeActive: 1 },
    semantics: "level",
    locks: ["tests/contentScript/intentDerivation.test.js"],
    provenance: "plan 51 (C06–C08 convergence — the one canonical derivation read)",
  },
];
