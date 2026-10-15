"use strict";

/**
 * Chromium still aliases the MV2 context names "browser_action"/"page_action"
 * to the MV3 action button, but Firefox MV3 rejects "browser_action" outright
 * ("Value browser_action must be one of [...]") and uses "action" instead.
 * Registering the legacy contexts un-mapped threw an uncaught error during
 * Firefox background startup (found by the plan 62 firefox smoke suite), which
 * aborted the rest of the startup wiring.
 *
 * @param {string[]} contexts
 * @param {{ isGecko?: boolean }} [platform]
 * @returns {string[]} contexts valid for the target platform
 */
export function resolveActionMenuContexts(contexts, { isGecko } = {}) {
  if (!isGecko) return contexts;
  return [
    ...new Set(
      contexts.map((context) =>
        context === "browser_action" || context === "page_action" ? "action" : context
      )
    ),
  ];
}

export function buildStaticActionContextMenuConfigs({
  showPopupLabel,
  neverTranslateLabel,
  moreOptionsLabel,
  pdfToHtmlLabel,
  isGecko = false,
}) {
  const ctx = (contexts) => resolveActionMenuContexts(contexts, { isGecko });
  return [
    {
      id: "browserAction-showPopup",
      title: showPopupLabel,
      contexts: ctx(["browser_action"]),
    },
    {
      id: "pageAction-showPopup",
      title: showPopupLabel,
      contexts: ctx(["page_action"]),
    },
    {
      id: "never-translate",
      title: neverTranslateLabel,
      contexts: ctx(["browser_action", "page_action"]),
    },
    {
      id: "more-options",
      title: moreOptionsLabel,
      contexts: ctx(["browser_action", "page_action"]),
    },
    {
      id: "browserAction-pdf-to-html",
      title: pdfToHtmlLabel,
      contexts: ctx(["browser_action"]),
    },
    {
      id: "pageAction-pdf-to-html",
      title: pdfToHtmlLabel,
      contexts: ctx(["page_action"]),
    },
  ];
}
