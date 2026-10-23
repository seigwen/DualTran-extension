"use strict";

/**
 * Unified UI: all providers share the #genericAiSettings panel (labels and models are dynamically populated by JS).
 */

/** @deprecated Kept only for test compatibility — all providers use genericAiSettings */
export const AI_PROVIDER_SETTING_IDS = {};

/**
 * Order providers by the label the user actually sees, so the dropdown reads alphabetically
 * instead of in registry order. Returns a copy; the input array is left untouched.
 * @param {Array<Object>} providers
 * @param {(provider: Object) => string} [getLabel]
 * @returns {Array<Object>}
 */
export function sortProvidersByLabel(providers, getLabel) {
  const list = Array.isArray(providers) ? providers.slice() : [];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const labelOf = typeof getLabel === "function" ? getLabel : (provider) => provider?.name;
  // Entries without a label fall to the bottom rather than leading the list.
  const rank = (provider) => (String(labelOf(provider) ?? "").trim() ? 0 : 1);
  return list.sort((left, right) => {
    const rankDelta = rank(left) - rank(right);
    if (rankDelta !== 0) return rankDelta;
    return collator.compare(String(labelOf(left) ?? ""), String(labelOf(right) ?? ""));
  });
}

/**
 * Returns the provider id as-is (no registry normalization needed anymore).
 * @param {string} provider
 * @returns {string}
 */
export function getNormalizedAIProvider(provider) {
  const normalized = (provider || "openai").trim().toLowerCase();
  return normalized || "openai";
}

/**
 * Show the generic settings panel (only one exists now).
 * @param {HTMLElement} root
 * @param {string} provider
 * @returns {string} provider id
 */
export function updateAIProviderUI(root, provider) {
  if (!root || typeof root.querySelectorAll !== "function") return provider || "openai";

  // Hide all legacy panels (for backward compat during transition)
  root.querySelectorAll(".ai-provider-settings").forEach((el) => {
    el.style.display = "none";
  });

  // Show generic panel
  const panel = root.querySelector("#genericAiSettings");
  if (panel) panel.style.display = "block";

  return provider || "openai";
}
