"use strict";

/**
 * 统一 UI：所有供应商共用 #genericAiSettings 面板（标签和模型由 JS 动态填充）。
 */

/** @deprecated 保留仅用于测试兼容 — 所有供应商统一走 genericAiSettings */
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
