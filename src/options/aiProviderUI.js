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
  // Pin the locale: the default collator follows the OS locale, so the same extension would
  // order the list differently on a zh-CN and an en-US machine (and the tests would disagree
  // with production). A fixed locale keeps the dropdown stable everywhere.
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
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
 *
 * SPEC 2.1: an empty provider is a first-class state ("nothing selected yet") and
 * must stay empty — coercing it to "openai" is the silent fallback the spec bans.
 * @param {string} provider
 * @returns {string}
 */
export function getNormalizedAIProvider(provider) {
  return String(provider || "").trim().toLowerCase();
}

/**
 * Fill the provider <select> with the empty-state placeholder row: disabled,
 * empty value, selected only while no provider is configured (SPEC 2.1 #2/#6).
 *
 * It is NOT one of the real providers: it never participates in the alphabetical
 * sort (it is always the first row) and it cannot be picked again ("None" ban).
 *
 * @param {HTMLSelectElement} select
 * @param {{ label: string, selected?: boolean }} options
 * @returns {HTMLOptionElement|null}
 */
export function ensureProviderPlaceholderOption(select, { label, selected = false }) {
  if (!select || typeof select.insertBefore !== "function") return null;
  const ownerDocument = select.ownerDocument;
  const placeholder = ownerDocument.createElement("option");
  placeholder.value = "";
  placeholder.textContent = label;
  placeholder.disabled = true;
  placeholder.hidden = false;
  placeholder.setAttribute("data-dualtran-provider-placeholder", "true");
  placeholder.selected = selected === true;
  select.insertBefore(placeholder, select.firstChild || null);
  return placeholder;
}

/**
 * Render the model picker's unconfigured state: empty + disabled, telling the
 * user to pick a provider first (SPEC 2.1 #3).
 * @param {HTMLSelectElement} select
 * @param {string} message
 */
export function renderModelProviderRequiredState(select, message) {
  if (!select || select._isMissingElement) return;
  select.innerHTML = "";
  const placeholder = select.ownerDocument.createElement("option");
  placeholder.value = "";
  placeholder.textContent = message;
  placeholder.disabled = true;
  select.appendChild(placeholder);
  select.disabled = true;
}

/**
 * Render the reasoning picker's unconfigured state: disabled, but the stored
 * sentinel stays selected (the setting is not lost while no provider exists).
 * @param {HTMLSelectElement} select
 * @param {string} sentinel
 */
export function renderReasoningDisabledState(select, sentinel, label = sentinel) {
  if (!select || select._isMissingElement) return;
  select.innerHTML = "";
  const option = select.ownerDocument.createElement("option");
  option.value = sentinel;
  option.textContent = label;
  select.appendChild(option);
  select.value = sentinel;
  select.disabled = true;
}

/**
 * Show the generic settings panel (only one exists now).
 * @param {HTMLElement} root
 * @param {string} provider
 * @returns {string} provider id
 */
export function updateAIProviderUI(root, provider) {
  const effectiveProvider = String(provider || "");
  if (!root || typeof root.querySelectorAll !== "function") return effectiveProvider;

  // Hide all legacy panels (for backward compat during transition)
  root.querySelectorAll(".ai-provider-settings").forEach((el) => {
    el.style.display = "none";
  });

  // Show generic panel
  const panel = root.querySelector("#genericAiSettings");
  if (panel) panel.style.display = "block";

  return effectiveProvider;
}
