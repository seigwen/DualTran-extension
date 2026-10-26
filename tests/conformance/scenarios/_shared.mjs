/**
 * Shared config for conformance scenarios.
 *
 * Everything here is what a user would have after finishing the options page: a target
 * language, the floating button, and one AI provider whose endpoint is under test.
 */
export const BASE_CONFIG = {
  targetLanguage: "zh-CN",
  targetLanguageTextTranslation: "zh-CN",
  targetLanguages: ["zh-CN", "en"],
  whereToDisplayTranslatedText: "newLine",
  showFloatingBtn: "yes",
  translateDynamicallyCreatedContent: "no",
  alwaysTranslateSites: [],
  alwaysTranslateSitesAI: [],
  neverTranslateSites: [],
  aiImproveForLongerThan: 0,
};

/**
 * @param {string} apiBase
 * @param {string} model
 */
export function aiConfig(apiBase, model = "mock-model") {
  // "deepseek" is a built-in registry provider, so the AI path resolves without the
  // models.dev cache; the endpoint is overridden to point at the mock.
  return {
    ...BASE_CONFIG,
    aiProvider: "deepseek",
    providerConfigs: { deepseek: { apiKey: "test-key", model, apiBase } },
  };
}

/** True when the text contains CJK characters (Google/mock translations land as Chinese). */
export function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}
