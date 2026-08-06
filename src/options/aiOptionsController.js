"use strict";

import { handleAiConfigChange, syncAiProviderSelection, syncAiStorageChanges } from "./aiProviderSync.js";

export function createAiOptionsController({
  root,
  aiProviderSelect,
  config,
  refreshCurrentProvider,
  refreshers = {},
  onWarn = console.warn,
}) {
  function getCurrentProvider() {
    return config?.get?.("aiProvider") || aiProviderSelect?.value || "openai";
  }

  function initialize() {
    syncAiProviderSelection({
      root,
      aiProviderSelect,
      provider: getCurrentProvider(),
    });
  }

  function handleProviderChange(provider) {
    const nextProvider = provider || "openai";
    // 同步维护新旧两个活动提供商键，避免旧迁移字段在页面重开时覆盖最新选择。
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