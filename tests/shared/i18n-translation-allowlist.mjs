/**
 * i18n real-translation allowlist — pairs that MAY legally stay identical to
 * the English source text (plan 65, spec 47 L4).
 *
 * The gate (scripts/check-i18n-translations.js) requires every non-exempt
 * locale value to differ from the en text. Two classes of legal identity
 * exist and BOTH must be registered here explicitly:
 *
 *   { key }                    brand/token key — identical value allowed in
 *                              ANY locale (provider names, product name).
 *   { key, locale }            a single pair where the language's own word
 *                              happens to match the English one
 *                              (e.g. "No" is the Spanish word itself).
 *
 * Every entry carries a `reason`. The list is EXACT: an entry whose key is
 * gone, or whose pair no longer matches the en text, fails the gate — keep it
 * trimmed as translations land.
 *
 * @module i18n-translation-allowlist
 */

export const I18N_TRANSLATION_ALLOWLIST = [
  // ── Technical enum — same value in every locale ──
  {
    key: "uiDirection",
    reason: "LTR/RTL enum consumed by the layout; the ltr value is correct in every left-to-right locale",
  },
  // ── Brand / provider tokens — always kept in Latin script ──
  { key: "aiProviderAnthropic", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderAzureOpenAI", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderBaidu", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderBytedance", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderCerebras", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderCohere", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderDeepInfra", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderDeepSeek", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderGoogleGemini", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderGrok", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderGroq", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderIflytek", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderMistral", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderMoonshot", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderOpenAI", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderOpenRouter", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderPerplexity", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderQwen", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderTogether", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderVercel", reason: "Provider brand name — always kept in Latin script" },
  { key: "aiProviderZhipu", reason: "Provider brand name — always kept in Latin script" },
  { key: "msgAi", reason: "AI is the established term across the shipped locales" },
  { key: "serviceTranslateWebPages", reason: "Product name (DualTran) — never translated" },
  { key: "extensionName", reason: "Product name (DualTran) — never translated" },
  { key: "serviceGoogleTranslate", reason: "Service product name — international name; a few locales use a localized form instead (both acceptable)" },
  { key: "serviceMicrosoftTranslate", reason: "Service product name — Microsoft keeps Translator in most markets; localized variants exist elsewhere" },

  // ── Legal identities — the language's own word matches the English one ──
  { key: "msgNo", locale: "es", reason: "No is the Spanish word itself" },
  { key: "msgNo", locale: "it", reason: "No is the Italian word itself" },
  { key: "msgNo", locale: "ca", reason: "No is the Catalan word itself" },
  { key: "btnOriginal", locale: "ca", reason: "Original is the Catalan word itself" },
  { key: "btnOriginal", locale: "da", reason: "Original is the Danish word itself" },
  { key: "btnOriginal", locale: "de", reason: "Original is the German word itself" },
  { key: "btnOriginal", locale: "es", reason: "Original is the Spanish word itself" },
  { key: "btnOriginal", locale: "fr", reason: "Original is the French word itself" },
  { key: "btnOriginal", locale: "no", reason: "Original is the Norwegian word itself" },
  { key: "btnOriginal", locale: "pt_BR", reason: "Original is the Portuguese word itself" },
  { key: "btnOriginal", locale: "pt_PT", reason: "Original is the Portuguese word itself" },
  { key: "btnOriginal", locale: "ro", reason: "Original is the Romanian word itself" },
  { key: "btnOriginal", locale: "sv", reason: "Original is the Swedish word itself" },
  { key: "btnMobileOriginal", locale: "ca", reason: "Original is the Catalan word itself" },
  { key: "btnMobileOriginal", locale: "da", reason: "Original is the Danish word itself" },
  { key: "btnMobileOriginal", locale: "de", reason: "Original is the German word itself" },
  { key: "btnMobileOriginal", locale: "es", reason: "Original is the Spanish word itself" },
  { key: "btnMobileOriginal", locale: "fr", reason: "Original is the French word itself" },
  { key: "btnMobileOriginal", locale: "pt_BR", reason: "Original is the Portuguese word itself" },
  { key: "btnMobileOriginal", locale: "pt_PT", reason: "Original is the Portuguese word itself" },
  { key: "btnMobileOriginal", locale: "sv", reason: "Original is the Swedish word itself" },
  { key: "msgReasoningDepthMinimal", locale: "da", reason: "Minimal is the standard Danish severity word" },
  { key: "msgReasoningDepthMinimal", locale: "de", reason: "Minimal is the standard German severity word" },
  { key: "msgReasoningDepthMinimal", locale: "fr", reason: "Minimal is the standard French severity word" },
  { key: "msgReasoningDepthMinimal", locale: "no", reason: "Minimal is the standard Norwegian severity word" },
  { key: "msgReasoningDepthMinimal", locale: "sv", reason: "Minimal is the standard Swedish severity word" },
  { key: "msgReasoningDepthMax", locale: "fr", reason: "Max is the usual French abbreviation of maximum" },
  { key: "msgReasoningDepthMax", locale: "nl", reason: "Max is the usual Dutch abbreviation of maximum" },
  { key: "msgReasoningDepthMax", locale: "sv", reason: "Max is the usual Swedish abbreviation of maximum" },
  { key: "msgReasoningDepthMedium", locale: "af", reason: "Medium is the Afrikaans word itself" },
  { key: "lblProviderModel", locale: "da", reason: "Model is the Danish word itself" },
  { key: "lblProviderModel", locale: "hr", reason: "Model is the Croatian word itself" },
  { key: "lblProviderModel", locale: "nl", reason: "Model is the Dutch word itself" },
  { key: "msgSites", locale: "nl", reason: "Sites is the usual Dutch UI word" },
  { key: "msgSites", locale: "pt_BR", reason: "Sites is the usual Portuguese UI word" },
  { key: "msgSites", locale: "pt_PT", reason: "Sites is the usual Portuguese UI word" },
  { key: "msgRecents", locale: "ca", reason: "Recents is the Catalan word itself" },
  { key: "msgInterfaceSimple", locale: "fr", reason: "Simple is the French word itself" },
  { key: "msgStyle", locale: "fr", reason: "Style is the French word itself" },
];
