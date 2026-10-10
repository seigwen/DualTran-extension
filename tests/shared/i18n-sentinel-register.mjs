/**
 * i18n sentinel register — the written allowlist (spec 47 §2.2, layer 3 of 3).
 *
 * Every entry must carry a category (`legacy | data | platform | other`) and a
 * reason; `legacy` entries are counted debt burned down per issue #157. Entries
 * are EXACT-MATCH strings observed in the sentinel run (the sentinel locale
 * renders all i18n messages as `⟦<key>⟧`; anything else visible is either a
 * hardcoded string or a declared data-face value).
 *
 * Lifecycle contract:
 *   - added → only from a recorded RED-run audit item, with a batch reference;
 *   - removed → when the corresponding P2 batch fixes the site (the scenario's
 *     stale report names register entries that were never hit — over-staying
 *     entries are visible, not silent).
 *
 * @module i18n-sentinel-register
 */

/** @type {Array<{ text: string, category: string, reason: string }>} */
export const REGISTER = [
  // ── P1-b RED 审计收录（2026-10-10，run 2）— legacy：待 P2 批次修复后摘除 ──
  {
    text: "Original",
    category: "legacy",
    reason: "floating-group button label (hardcoded); localize-vs-token decision in #157 batch ③",
  },
  {
    text: "Google",
    category: "legacy",
    reason: "engine brand label (hardcoded in floating group); decision in #157 batch ③",
  },
  {
    text: "AI",
    category: "legacy",
    reason: "engine label token (hardcoded in floating group); decision in #157 batch ③",
  },
  {
    text: "Loading...",
    category: "legacy",
    reason: "panelShared loading label — key \"loading\" missing in all locales; fix to msgLoadingModels in #157 batch ①",
  },
  {
    text: "More languages",
    category: "legacy",
    reason: "panels' + button tooltip (hardcoded title, no key exists); add key + data-i18n-title in #157 batch ③",
  },
];
