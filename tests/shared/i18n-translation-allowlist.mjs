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

  // ── Legal identities — the language's own word matches the English one ──
  { key: "msgNo", locale: "es", reason: "No is the Spanish word itself" },
  { key: "msgNo", locale: "it", reason: "No is the Italian word itself" },
  { key: "msgNo", locale: "ca", reason: "No is the Catalan word itself" },
];
