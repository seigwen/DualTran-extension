/**
 * i18n sentinel rules — shared classifier for the runtime completeness guard
 * (spec 47 §2.2, L3; grilling Q4/Q5).
 *
 * The sentinel locale (`xx_XX`) renders every message as `⟦<key>⟧`, so under
 * that locale **every legitimate user-visible string must contain the sentinel
 * mark**. Anything else is either a hardcoded string (the #155 defect class,
 * now runtime-visible) or an allowed data-face value. This module defines the
 * single classification function used by:
 *   - the E2E scenario `tests/browser-e2e/i18n-sentinel.mjs` (Node-side pass
 *     over the collected DOM items), and
 *   - the self-test `tests/shared/i18nSentinelRules.test.js` (positive/negative
 *     fixtures — a detector that is never proven to fire is no guard at all).
 *
 * Three allowlist layers (Q5):
 *   1. auto-derived (this module: non-text shapes, language options, data
 *      values via option text === value; the scenario adds brand/provider
 *      tokens from the repo's own data sources);
 *   2. `data-i18n-exempt` mechanism markers (reserved — none exist yet);
 *   3. the written register (`i18n-sentinel-register.mjs`) — every entry MUST
 *      carry a category + reason; legacy entries are burn-down debt (#157).
 */

/**
 * Sentinel mark — every sentinelized message contains it. Never localize text
 * may ever contain it, so its presence is a reliable "went through i18n" proof.
 * OPEN is also the detection char; CLOSE is used only when rendering messages.
 */
export const SENTINEL_MARK = "\u27E6";
export const SENTINEL_MARK_CLOSE = "\u27E7";

/** Pure punctuation / symbols / digits / whitespace — lexically non-text. */
const PUNCT_ONLY_RE = /^[\p{P}\p{S}\d\s]+$/u;

/** Language codes ("en", "zh-CN", "zh-Hans-CN", "und", "auto") — option value shape.
 *  Also covers the languages.js legacy keys ("kazlat", "uzbcyr") whose option
 *  values are not BCP47 but are still language-data values. Exported for the
 *  scenario's cross-surface language-name derivation. */
export const LANGUAGE_CODE_RE = /^(?:[a-z]{2,8}(?:[-_][A-Za-z]{2,8}){0,2}|und|auto)$/;

/**
 * Path markers for containers that hold USER CONTENT by definition (e.g. the
 * panels' `#eOrigText` shows the text being translated). Text inside them is
 * data, never UI copy.
 */
export const DATA_PATH_MARKERS = ["#eOrigText"];

/**
 * Selects whose option texts are registry data — provider display names and
 * model display names are proper nouns / version strings by design (bilingual,
 * same family as language names; `#aiProvider` and `#genericModel` are
 * populated wholesale from the merged models.dev registry). This keeps the
 * guard scoped: any option text OUTSIDE these selects still must be
 * sentinelized or match the other allowance layers.
 */
export const DATA_SELECT_IDS = new Set(["aiProvider", "genericModel"]);

const URL_RE = /^(?:https?:\/\/|mailto:)\S+$/i;
const EMAIL_RE = /^[\w.+-]+@[\w.-]+$/;

export const REGISTER_CATEGORIES = new Set(["legacy", "data", "platform", "other"]);

/**
 * Validate the written register: every entry must be an exact-match string
 * with a known category and a non-empty reason. Returns the entry map
 * (text → entry) used by the classifier. Throws on malformed entries — a
 * register that silently accepts junk is a hole, not a guard.
 *
 * @param {Array<{ text: string, category: string, reason: string }>} entries
 * @returns {Map<string, object>}
 */
export function buildRegisterMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (typeof entry.text !== "string" || entry.text.trim() === "") {
      throw new Error(`i18n sentinel register: entry without text: ${JSON.stringify(entry)}`);
    }
    if (!REGISTER_CATEGORIES.has(entry.category)) {
      throw new Error(
        `i18n sentinel register: entry "${entry.text}" has invalid category "${entry.category}" (allowed: legacy | data | platform | other)`
      );
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      throw new Error(`i18n sentinel register: entry "${entry.text}" must carry a reason`);
    }
    if (map.has(entry.text)) {
      throw new Error(`i18n sentinel register: duplicate entry "${entry.text}"`);
    }
    map.set(entry.text, entry);
  }
  return map;
}

/**
 * Classify one collected DOM item.
 *
 * @param {{ kind: string, text: string, optionValue?: string, path?: string }} item
 * @param {{ register?: Map<string, object>, allowTokens?: Set<string> }} ctx
 * @returns {{ verdict: "skip" } | { verdict: "pass", layer: string, entry?: object } | { verdict: "violation" }}
 */
export function classifyItem(item, ctx = {}) {
  const text = (item.text || "").trim();
  if (text === "") return { verdict: "skip" };

  // Layer 0 — sentinelized: went through chrome.i18n.getMessage().
  if (text.includes(SENTINEL_MARK)) return { verdict: "pass", layer: "sentinel" };

  // Layer 1a — user-content containers (data by definition, e.g. #eOrigText).
  if (item.path && DATA_PATH_MARKERS.some((m) => item.path.includes(m))) {
    return { verdict: "pass", layer: "data-container" };
  }

  // Layer 1b — option-shaped data: language options (value is a language code),
  // registry-data selects (provider display names), and pure data values
  // (option text identical to its value, e.g. model ids).
  if (item.kind === "option") {
    const value = (item.optionValue || "").trim();
    if (value && LANGUAGE_CODE_RE.test(value)) {
      return { verdict: "pass", layer: "lang-option" };
    }
    if (item.selectId && DATA_SELECT_IDS.has(item.selectId)) {
      return { verdict: "pass", layer: "data-select" };
    }
    if (value && text === value) return { verdict: "pass", layer: "data-value" };
  }

  // Layer 1c — non-text shapes (numbers, symbols, punctuation, URLs, emails).
  if (PUNCT_ONLY_RE.test(text)) return { verdict: "pass", layer: "non-text" };
  if (URL_RE.test(text) || EMAIL_RE.test(text)) return { verdict: "pass", layer: "non-text" };

  // Layer 1d — declared tokens (brand / provider / language names — scenario-derived).
  if (ctx.allowTokens && ctx.allowTokens.has(text)) {
    return { verdict: "pass", layer: "token" };
  }

  // Layer 3 — written register (exact match, category + reason enforced by build).
  const entry = ctx.register && ctx.register.get(text);
  if (entry) return { verdict: "pass", layer: `register:${entry.category}`, entry };

  return { verdict: "violation" };
}

/**
 * Run the classifier over a list of items; returns { violations, matchedRegister }.
 * `matchedRegister` tracks which register entries were actually hit (stale report).
 *
 * @param {Array<object>} items
 * @param {Map<string, object>} register
 * @param {Set<string>} allowTokens
 */
export function classifyItems(items, register, allowTokens) {
  const violations = [];
  const matchedRegister = new Set();
  const layerCounts = {};
  for (const item of items) {
    const res = classifyItem(item, { register, allowTokens });
    if (res.verdict === "violation") violations.push(item);
    if (res.verdict === "pass") {
      const key = res.layer.startsWith("register") ? "register" : res.layer;
      layerCounts[key] = (layerCounts[key] || 0) + 1;
    }
    if (res.verdict === "pass" && res.entry) matchedRegister.add(res.entry.text);
  }
  return { violations, matchedRegister, layerCounts };
}
