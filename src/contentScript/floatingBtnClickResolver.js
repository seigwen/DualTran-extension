/**
 * Pure decision function for floating button clicks (three-state model).
 *
 * Maps (uiState, buttonId) → action descriptor. No side effects — the caller
 * (floatingBtn.js) executes the returned action. This is the highest test
 * seam for the 20-scenario behavior table (Q28).
 *
 * Action descriptors:
 *   { type: "noop" }                          — nothing to do
 *   { type: "translatePage" }                 — Google page translation
 *   { type: "translatePageAi" }                — Google+AI parallel page translation
 *   { type: "restorePage" }                   — restore original text
 *   { type: "showGoogleOnly" }                — local switch to Google display, no requests
 *   { type: "showAiOnly" }                    — local switch to AI display (newLine), no requests
 *   { type: "retryAi" }                       — re-request AI for failed blocks
 *   { type: "promptConfig" }                  — no API key: show config prompt, no translation
 */

export function resolveFloatingBtnClick(uiState, buttonId) {
  const {
    pageLanguageState,
    displayMode,
    highlight,
    googleInFlight,
    aiInFlight,
    hasGoogleFailedBlocks,
    hasAiFailedBlocks,
    aiResultAvailable,
    hasApiKey,
    whereToDisplayTranslatedText,
  } = uiState;

  if (buttonId === "original") {
    return resolveOriginalClick(uiState);
  }
  if (buttonId === "google") {
    return resolveGoogleClick(uiState);
  }
  if (buttonId === "ai") {
    return resolveAiClick(uiState);
  }
  return { type: "noop" };
}

function resolveOriginalClick(uiState) {
  const { pageLanguageState, displayMode, googleInFlight, aiInFlight } = uiState;
  // Page already shows original and no request in-flight → nothing to do.
  if (
    pageLanguageState === "original" &&
    displayMode === "original" &&
    !googleInFlight &&
    !aiInFlight
  ) {
    return { type: "noop" };
  }
  // Page shows Google/AI translation, or a request is in-flight → restore
  // (restorePage also cancels in-flight requests — scenario 15).
  return { type: "restorePage" };
}

function resolveGoogleClick(uiState) {
  const { pageLanguageState, displayMode, googleInFlight, hasGoogleFailedBlocks } = uiState;

  // Google translation already displayed → no-op (Q16-revised).
  if (displayMode === "google") {
    return { type: "noop" };
  }
  // Google request in-flight → no-op (Q16-revised: in-flight counts as "already requested").
  if (googleInFlight) {
    return { type: "noop" };
  }
  // Page original → start Google translation.
  if (pageLanguageState === "original") {
    return { type: "translatePage" };
  }
  // Page translated but showing AI (or original) → local switch to Google, no requests (Q9).
  return { type: "showGoogleOnly" };
}

function resolveAiClick(uiState) {
  const {
    pageLanguageState,
    displayMode,
    aiInFlight,
    hasAiFailedBlocks,
    aiResultAvailable,
    hasApiKey,
    whereToDisplayTranslatedText,
  } = uiState;

  // AI translation already displayed → no-op (Q16-revised).
  if (displayMode === "ai") {
    return { type: "noop" };
  }
  // AI request in-flight → no-op (Q16-revised).
  if (aiInFlight) {
    return { type: "noop" };
  }
  // No API key → prompt config, no translation (Q4).
  if (!hasApiKey) {
    return { type: "promptConfig" };
  }
  // Failed blocks exist → retry them (Q8/Q14).
  if (hasAiFailedBlocks) {
    return { type: "retryAi" };
  }
  // Page original → Google+AI parallel (Q4/Q16-revised: even if AI already highlighted).
  if (pageLanguageState === "original") {
    return { type: "translatePageAi" };
  }
  // Page translated, showing Google:
  //   newLine + AI result available → local switch, zero requests (Q10a)
  //   replaceOriginal (or no AI result) → re-request AI (cache-backed) (Q10a/Q17)
  if (whereToDisplayTranslatedText === "newLine" && aiResultAvailable) {
    return { type: "showAiOnly" };
  }
  return { type: "translatePageAi" };
}
