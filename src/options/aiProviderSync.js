"use strict";

import { updateAIProviderUI } from "./aiProviderUI.js";

export const AI_SYNC_INPUT_IDS = [
  "apiKeyOpenAI",
  "openAiApiBase",
  "apiKeyGoogleGemini",
  "googleGeminiApiBase",
  "apiKeyAnthropic",
  "anthropicApiBase",
  "apiKeyAzureOpenAI",
  "azureOpenAIEndpoint",
  "apiKeyDeepSeek",
  "deepSeekApiBase",
  "apiKeyGrok",
  "grokApiBase",
  "apiKeyOpenRouter",
  "openRouterApiBase",
  "openRouterReferer",
  "openRouterTitle",
];

const CONFIG_CHANGE_TO_REFRESHER = {
  apiKeyOpenAI: "openai",
  apiKeyGoogleGemini: "googleGemini",
  apiKeyAnthropic: "anthropic",
  apiKeyAzureOpenAI: "azureOpenAI",
  azureOpenAIEndpoint: "azureOpenAI",
  apiKeyDeepSeek: "deepseek",
  apiKeyGrok: "grok",
  apiKeyOpenRouter: "openrouter",
  openRouterApiBase: "openrouter",
  openRouterModel: "openrouter",
};

function setElementValue(root, elementId, value) {
  const element = root?.querySelector?.(`#${elementId}`);
  if (element) {
    element.value = value || "";
  }
  return element;
}

export function syncAiProviderSelection({ root, aiProviderSelect, provider }) {
  const effectiveProvider = provider || "openai";
  if (aiProviderSelect) {
    aiProviderSelect.value = effectiveProvider;
  }
  return updateAIProviderUI(root, effectiveProvider);
}

export function handleAiConfigChange({
  name,
  newValue,
  root,
  aiProviderSelect,
  refreshers = {},
}) {
  if (name === "aiProvider") {
    syncAiProviderSelection({
      root,
      aiProviderSelect,
      provider: newValue || "openai",
    });
    return true;
  }

  if (AI_SYNC_INPUT_IDS.includes(name)) {
    setElementValue(root, name, newValue || "");
  }

  const refresherKey = CONFIG_CHANGE_TO_REFRESHER[name];
  if (refresherKey && typeof refreshers[refresherKey] === "function") {
    refreshers[refresherKey](newValue);
    return true;
  }

  if (AI_SYNC_INPUT_IDS.includes(name)) {
    return true;
  }

  return false;
}

export function syncAiStorageChanges({
  root,
  aiProviderSelect,
  changes,
}) {
  if (!changes) return;

  if (changes.aiProvider) {
    syncAiProviderSelection({
      root,
      aiProviderSelect,
      provider: changes.aiProvider.newValue || "openai",
    });
  }

  AI_SYNC_INPUT_IDS.forEach((id) => {
    if (changes[id]) {
      setElementValue(root, id, changes[id].newValue || "");
    }
  });
}
