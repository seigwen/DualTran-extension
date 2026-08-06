"use strict";

/**
 * Unified UI: all providers share the #genericAiSettings panel (labels and models are dynamically populated by JS).
 */

/** @deprecated Kept only for test compatibility — all providers use genericAiSettings */
export const AI_PROVIDER_SETTING_IDS = {};

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
