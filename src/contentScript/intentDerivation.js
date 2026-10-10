/**
 * intentDerivation.js — THE single implementation of the page-intent
 * derivation formula (plan 51 / intent-gate SSOT, C06–C08 convergence).
 *
 * Before this module the formula existed as three mirrored copies
 * (pageTranslator.currentPageIntentMode / uiStateStore.deriveIntentUi /
 * floatingBtnClickResolver.resolveInitialUiState) — deliberate mirrors, but
 * three places that can drift apart. The three consumers now call this one.
 *
 * Formula (frozen semantics, plan 30 / Q1a+Q4e):
 *   pageLanguageState !== "translated"                      -> "original"
 *   translated && aiModeActive && aiRenderState !== "idle" -> "ai"
 *   translated && otherwise                                -> "google"
 *
 * The highlight follows the INTENT, not what the page currently shows: an AI
 * flow in flight (loading) and an AI error both keep "ai" (click = retry).
 */
// [intent-gate:derivation-single-source]
export function derivePageIntent(engine) {
  if (engine.pageLanguageState !== "translated") return "original";
  return engine.aiModeActive && engine.aiRenderState !== "idle" ? "ai" : "google";
}
