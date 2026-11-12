"use strict";

import { handleAiConfigChange, syncAiProviderSelection, syncAiStorageChanges } from "./aiProviderSync.js";

export function createAiOptionsController({
  root,
  aiProviderSelect,
  config,
  refreshCurrentProvider,
  refreshers = {},
  onWarn = (message, error) => console.warn(message, error),
}) {
  function getCurrentProvider() {
    // SPEC 2.1: "" = unconfigured. Only fall back to the select's own value when
    // the config has no entry at all (not when it explicitly says "none yet").
    const stored = config?.get?.("aiProvider");
    if (typeof stored === "string") return stored;
    return aiProviderSelect?.value || "";
  }

  function initialize() {
    syncAiProviderSelection({
      root,
      aiProviderSelect,
      provider: getCurrentProvider(),
    });
  }

  function handleProviderChange(provider) {
    // The empty placeholder is disabled, but a programmatic "" must never be
    // persisted as a selection either (spec 2.1 #6: cannot return to empty).
    const nextProvider = String(provider || "");
    if (!nextProvider) return;
    // Sync both old and new active provider keys to prevent stale migration fields from overwriting the latest selection when the page reopens.
    config?.set?.("aiProvider", nextProvider);
    config?.set?.("activeProviderId", nextProvider);
    syncAiProviderSelection({
      root,
      aiProviderSelect,
      provider: nextProvider,
    });
    try {
      refreshCurrentProvider?.(nextProvider);
    } catch (error) {
      onWarn?.("Failed to refresh models after aiProvider change:", error);
    }
  }

  function handleConfigChanged(name, newValue) {
    try {
      return handleAiConfigChange({
        name,
        newValue,
        root,
        aiProviderSelect,
        refreshers,
      });
    } catch (error) {
      onWarn?.("twpConfig.onChanged handler error:", error);
      return false;
    }
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") return;
    syncAiStorageChanges({
      root,
      aiProviderSelect,
      changes,
    });
  }

  return {
    initialize,
    handleProviderChange,
    handleConfigChanged,
    handleStorageChanged,
  };
}