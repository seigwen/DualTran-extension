/**
 * Pure decision function for block-level singleton hover button clicks (#65).
 *
 * Maps (blockState, buttonId, ctx) → action descriptor. No side effects — the
 * caller (pageTranslator.js handleSingletonBtnClick) executes the returned
 * action. Mirrors floatingBtnClickResolver.js (Q28 20-scenario table): the
 * pure table is the single decision point, the executor stays thin.
 *
 * Semantics (doc 19 / NQ1, direct-select): click = "show that mode".
 *   - Clicking the already-displayed mode is a noop.
 *   - In-flight is a noop — never re-send a running/completed request.
 *   - Restore responsibility lives on the Original button ONLY.
 *   - Google restored earlier + stored text → local replay, zero network.
 *
 * Action descriptors:
 *   { type: "noop" }         — nothing to do
 *   { type: "restoreBlock" } — show original text for this block (+ requestEpoch++)
 *   { type: "showGoogle" }   — local switch to Google display, no requests
 *   { type: "fetchGoogle" }  — request Google translation (network)
 *   { type: "showAi" }       — local re-show of stored AI text, no requests
 *   { type: "fetchAi" }      — request AI translation (cache-backed)
 *   { type: "retryAi" }      — re-request AI after a failure (execute as fetchAi)
 *   { type: "promptConfig" } — no API key: show config prompt, no translation
 *
 * @param {Object|null} blockState — WeakMap block state
 *   { displayMode, googleBtnState, aiStatus, translationId, ... }
 * @param {"original"|"google"|"ai"} buttonId
 * @param {{ hasApiKey?: boolean, hasStoredGoogleText?: boolean }} [ctx]
 * @returns {{ type: string }}
 */
export function resolveSingletonBtnClick(blockState, buttonId, ctx = {}) {
  const { hasApiKey = false, hasStoredGoogleText = false } = ctx;

  // Defense: unknown button or unregistered block (main guard lives in
  // showButtonGroup — this is the second line).
  if (!blockState) return { type: "noop" };
  if (buttonId !== "original" && buttonId !== "google" && buttonId !== "ai") {
    return { type: "noop" };
  }

  // Legacy state fallback: blocks registered before displayMode existed.
  // Same derivation as the pre-#65 handlers.
  const displayMode =
    blockState.displayMode ||
    (blockState.aiStatus === "translated" ? "ai" : "google");
  const googleInFlight = blockState.googleBtnState === "translating";
  const aiInFlight =
    blockState.aiStatus === "queuing" || blockState.aiStatus === "translating";

  if (buttonId === "original") {
    // Showing original with nothing in flight → nothing to do.
    if (displayMode === "original" && !googleInFlight && !aiInFlight) {
      return { type: "noop" };
    }
    // Showing a translation, or a request in flight → restore (restore
    // also cancels in-flight requests via requestEpoch++).
    return { type: "restoreBlock" };
  }

  if (buttonId === "google") {
    // Google translation already displayed → no-op.
    if (displayMode === "google") return { type: "noop" };
    // Google request in flight → no-op (never re-send).
    if (googleInFlight) return { type: "noop" };
    // Showing AI → local switch to Google, zero requests.
    if (displayMode === "ai") return { type: "showGoogle" };
    // Showing original: stored Google text → local replay; else network.
    if (hasStoredGoogleText) return { type: "showGoogle" };
    return { type: "fetchGoogle" };
  }

  // buttonId === "ai"
  // AI translation already displayed → no-op.
  if (displayMode === "ai") return { type: "noop" };
  // AI request in flight → no-op (never re-send).
  if (aiInFlight) return { type: "noop" };
  // No API key → prompt config, no translation. Takes precedence over retry.
  if (!hasApiKey) return { type: "promptConfig" };
  // Failed earlier → retry (execute as fetchAi).
  if (blockState.aiStatus === "translationError") return { type: "retryAi" };
  // AI text already available (user switched away earlier) → local re-show.
  if (blockState.aiStatus === "translated") return { type: "showAi" };
  // Otherwise → request AI (original: Google+AI concurrent; Google shown: AI only).
  return { type: "fetchAi" };
}
