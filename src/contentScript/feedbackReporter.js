"use strict";

/**
 * Content-script feedback reporter (plan 35 — user feedback channel).
 *
 * Installs a document-level delegated click listener: clicking a block-level
 * error icon (`.dualtran-block-error`) — the one moment the user has "just
 * been hit by a bug" — sends a single `openFeedbackIssue` message to the
 * service worker, which opens the prefilled GitHub issue form.
 *
 * Design notes:
 *   - Delegation on `document` survives SPA body replacement (Turbo/pjax).
 *   - Installation is idempotent AND refreshable: a repeated call removes the
 *     previous listener and installs the fresh one (one listener at most, the
 *     newest `getContext`/`send` win) — module re-evaluation cannot leave a
 *     stale closure behind, and a single click can never double-send.
 *   - The payload is a CLOSED shape: action / serviceType / errorText /
 *     hostname / sourceLang / targetLang. Context extras a caller might
 *     spread (apiKey, apiBase, pageUrl, pageContent) are filtered out by
 *     construction — the red line is structural, not a convention.
 *   - The icon's `title` is the pure error text (the indicator contract keeps
 *     hints out of it), so it travels as the issue's `Error:` line verbatim.
 */

/** Document slots holding the live listener + install marker. */
const INSTALL_FLAG = "__dualtranFeedbackReporterInstalled";
const LISTENER_KEY = "__dualtranFeedbackReporterListener";

/**
 * @param {Object} deps
 * @param {() => {hostname?: string, sourceLang?: string, targetLang?: string}} deps.getContext
 *   Live page context — read at click time so language changes are picked up.
 * @param {(payload: Object) => void} deps.send
 *   Message sender (chrome.runtime.sendMessage in production).
 * @returns {boolean} true when a listener was installed by this call
 */
export function installFeedbackReporter({ getContext, send } = {}) {
  if (typeof document === "undefined") return false;
  if (typeof send !== "function") return false;

  // Replace any previous installation — at most one listener lives at a time.
  if (document[INSTALL_FLAG] && document[LISTENER_KEY]) {
    document.removeEventListener("click", document[LISTENER_KEY], true);
  }

  const handler = (event) => {
    const target = event.target;
    if (!target || target.nodeType !== 1) return;

    const icon = target.closest?.(".dualtran-block-error");
    if (!icon) return;

    const context = typeof getContext === "function" ? getContext() || {} : {};

    // Closed shape — exactly these keys, never a spread of `context`.
    const payload = {
      action: "openFeedbackIssue",
      serviceType: typeof icon.dataset?.type === "string" ? icon.dataset.type : "",
      errorText: typeof icon.title === "string" ? icon.title : icon.getAttribute?.("title") || "",
      hostname: typeof context.hostname === "string" ? context.hostname : "",
      sourceLang: typeof context.sourceLang === "string" ? context.sourceLang : "",
      targetLang: typeof context.targetLang === "string" ? context.targetLang : "",
    };

    try {
      send(payload);
    } catch (err) {
      // Feedback is best-effort — a send failure must never break the page.
      console.warn("[feedbackReporter] failed to send openFeedbackIssue:", err?.message || err);
    }
  };

  document[INSTALL_FLAG] = true;
  document[LISTENER_KEY] = handler;
  document.addEventListener("click", handler, true);

  return true;
}
