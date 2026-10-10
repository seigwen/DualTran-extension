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
  // ── #157 batch ③ decision: engine brand tokens stay untranslated BY DESIGN
  //    (identical across locales, single source: engineLabels.js). Not debt.
  {
    text: "Google",
    category: "platform",
    reason: "engine brand label — trademark, rendered identically across locales by design (#157 batch ③; single source engineLabels.js)",
  },
  {
    text: "AI",
    category: "platform",
    reason: "engine label initialism — identical across locales by design (#157 batch ③; single source engineLabels.js)",
  },
];
