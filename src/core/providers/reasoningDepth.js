/**
 * Reasoning depth — single source of truth for translating a user-selected
 * reasoning effort into AI SDK `providerOptions`, per dialect.
 *
 * Why this module exists (probe findings, 2026-09-28 — see
 * /root/DualTran-manage/probe-archive-2026-09-28-reasoning/):
 *
 *  1. `providerOptions` keys are dialect-specific, and an unknown key is
 *     dropped SILENTLY by the SDK. With the OpenAI-compatible fallback the
 *     correct key is `openaiCompatible` — passing `{ deepseek: {...} }` (a
 *     brand-name key) produces no request field at all and no warning.
 *
 *  2. Value domains differ per dialect and the SDK validates them with zod.
 *     An unaccepted value throws `invalid <provider> provider options` and
 *     kills the whole translation request. models.dev declares the union
 *     across the ecosystem (mistral declares `max`, xai declares `xhigh`,
 *     anthropic declares `none` …), so declaration values must be clipped
 *     per dialect before they are offered or sent.
 *
 *  3. models.dev declares which effort values a model supports
 *     (`reasoning_options`); the dropdown is therefore generated from
 *     `declared values ∩ dialect accept set`, never hardcoded.
 *
 * The npm → dialect table below mirrors `SDK_MAP` in `src/background/aiProxy.js`
 * (the createXxx dispatch). A unit test asserts the two stay aligned — this is
 * the issue #88 lesson: two independently maintained judgments about the same
 * thing drift, and the drift fails silently.
 */

/** Value meaning "do not send any reasoning parameter" (keeps the old behavior). */
export const REASONING_DEFAULT = "";

/** Canonical display order for known effort values. */
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "default"];

/** Display labels (English fallback; the options page localizes via the `translate` hook). */
const EFFORT_LABELS = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  // `default` is a real Groq value (provider default) — it must not be
  // confused with the "do not send" option, so it carries a distinct label.
  default: "Default (provider)",
};

/** i18n message keys for the effort values (consumed via the `translate` hook). */
const EFFORT_LABEL_KEYS = {
  none: "msgReasoningDepthNone",
  minimal: "msgReasoningDepthMinimal",
  low: "msgReasoningDepthLow",
  medium: "msgReasoningDepthMedium",
  high: "msgReasoningDepthHigh",
  xhigh: "msgReasoningDepthXHigh",
  max: "msgReasoningDepthMax",
  default: "msgReasoningDepthProviderDefault",
};

/**
 * Dialect table. `accepts === null` means the SDK passes the value through
 * without enum validation (verified by probe: openai-compatible wrappers,
 * perplexity, togetherai and deepinfra accept any string).
 */
const DIALECTS = Object.freeze({
  openai: { key: "openai", accepts: null, style: "reasoningEffort" },
  azure: { key: "azure", accepts: null, style: "reasoningEffort" },
  anthropic: { key: "anthropic", accepts: ["low", "medium", "high", "xhigh", "max"], style: "effort" },
  google: { key: "google", accepts: ["minimal", "low", "medium", "high"], style: "thinkingLevel" },
  xai: { key: "xai", accepts: ["none", "low", "medium", "high"], style: "reasoningEffort" },
  groq: { key: "groq", accepts: ["none", "low", "medium", "high", "default"], style: "reasoningEffort" },
  mistral: { key: "mistral", accepts: ["none", "high"], style: "reasoningEffort" },
  deepseek: { key: "deepseek", accepts: ["low", "medium", "high", "xhigh", "max"], style: "reasoningEffort" },
  cohere: { key: "cohere", accepts: ["none", "high"], style: "cohereThinking" },
  perplexity: { key: "perplexity", accepts: null, style: "reasoningEffort" },
  togetherai: { key: "togetherai", accepts: null, style: "reasoningEffort" },
  deepinfra: { key: "deepinfra", accepts: null, style: "reasoningEffort" },
  "openai-compatible": { key: "openaiCompatible", accepts: null, style: "reasoningEffort" },
});

/** npm package (models.dev `provider.npm`) → dialect. Mirrors aiProxy SDK_MAP. */
const NPM_TO_DIALECT = Object.freeze({
  "@ai-sdk/openai": "openai",
  "@ai-sdk/azure": "azure",
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/google": "google",
  "@ai-sdk/xai": "xai",
  "@ai-sdk/groq": "groq",
  "@ai-sdk/mistral": "mistral",
  "@ai-sdk/deepseek": "deepseek",
  "@ai-sdk/cohere": "cohere",
  "@ai-sdk/perplexity": "perplexity",
  "@ai-sdk/togetherai": "togetherai",
  "@ai-sdk/deepinfra": "deepinfra",
});

/** npm packages that have a dedicated dialect (must mirror aiProxy SDK_MAP). */
export const DIALECT_SDK_NPM_PACKAGES = Object.freeze(Object.keys(NPM_TO_DIALECT).sort());

/**
 * Resolve the dialect for a request.
 *
 * The provider id participates because `createModelClient` routes Azure by
 * provider id (special case) and everything else by npm — keeping both
 * judgments in one function prevents the two from drifting apart.
 *
 * @param {{ provider?: string, npm?: string }} params
 * @returns {string} dialect key (see DIALECTS)
 */
export function resolveDialect({ provider, npm } = {}) {
  if (provider === "azure" || provider === "azure-openai") return "azure";
  return NPM_TO_DIALECT[npm] || "openai-compatible";
}

function _accepts(dialectName, value) {
  const dialect = DIALECTS[dialectName] || DIALECTS["openai-compatible"];
  if (!dialect.accepts) return true;
  return dialect.accepts.includes(value);
}

/**
 * Build the reasoning-depth dropdown options for the current provider + model.
 *
 * Rules (plan 32, Q1/Q2/Q3):
 *  - `Default` (value "") is always first and always present.
 *  - `effort` declaration → declared values clipped to the dialect accept set,
 *    deduplicated, sorted by EFFORT_ORDER. An empty intersection means the
 *    model gets only `Default` (e.g. every declared value is rejected by the SDK).
 *  - `toggle`-only declaration → expanded to `Default` + `High` (the dialect's
 *    "on" value). `budget_tokens` is intentionally not supported in this round.
 *  - No `reasoning_options` at all → only `Default`.
 *
 * Labels go through the optional `translate(key, fallback)` hook so callers can
 * localize them (the options page passes `chrome.i18n`); the default identity
 * hook keeps the English fallback labels.
 *
 * @param {{ provider?: string, npm?: string, reasoningOptions?: Array<Object>, translate?: Function }} params
 * @returns {Array<{value: string, label: string}>}
 */
export function buildReasoningDepthOptions({ provider, npm, reasoningOptions, translate = (_key, fallback) => fallback } = {}) {
  const dialectName = resolveDialect({ provider, npm });
  const options = [{ value: REASONING_DEFAULT, label: translate("msgDefault", "Default") }];

  const declared = Array.isArray(reasoningOptions) ? reasoningOptions.filter(Boolean) : [];
  const effort = declared.find((o) => o.type === "effort");
  const declaredValues = Array.isArray(effort?.values) ? effort.values : [];

  let candidates;
  if (declaredValues.length) {
    const seen = new Set();
    candidates = declaredValues.filter((v) => {
      if (typeof v !== "string" || !v || seen.has(v)) return false;
      if (!_accepts(dialectName, v)) return false;
      seen.add(v);
      return true;
    });
    candidates.sort((a, b) => {
      const ai = EFFORT_ORDER.indexOf(a);
      const bi = EFFORT_ORDER.indexOf(b);
      return (ai === -1 ? EFFORT_ORDER.length : ai) - (bi === -1 ? EFFORT_ORDER.length : bi);
    });
  } else if (declared.some((o) => o.type === "toggle")) {
    // Toggle semantics → expose "off" (Default) and "on" (High).
    candidates = _accepts(dialectName, "high") ? ["high"] : [];
  } else {
    candidates = []; // budget_tokens only, or no declaration at all
  }

  for (const value of candidates) {
    const labelKey = EFFORT_LABEL_KEYS[value];
    options.push({
      value,
      label: labelKey ? translate(labelKey, EFFORT_LABELS[value] || value) : value,
    });
  }
  return options;
}

/**
 * Map a selected depth onto AI SDK `providerOptions`.
 *
 * Returns `null` when there is nothing to send (empty depth) or when the
 * dialect would reject the value — sending an unaccepted value makes the SDK
 * throw `invalid provider options`, which aborts the entire translation, so
 * dropping the parameter is the safe degradation (the request still succeeds,
 * just without the reasoning hint).
 *
 * @param {{ provider?: string, npm?: string, depth?: string }} params
 * @returns {Object|null} providerOptions object, or null
 */
export function buildProviderOptions({ provider, npm, depth } = {}) {
  if (!depth) return null;
  const dialectName = resolveDialect({ provider, npm });
  if (!_accepts(dialectName, depth)) {
    console.warn(
      `[reasoning-depth] "${depth}" is not accepted by the ${dialectName} dialect — dropping provider options to keep the request valid`
    );
    return null;
  }
  const dialect = DIALECTS[dialectName];
  switch (dialect.style) {
    case "effort":
      return { [dialect.key]: { effort: depth } };
    case "thinkingLevel":
      return { [dialect.key]: { thinkingConfig: { thinkingLevel: depth } } };
    case "cohereThinking":
      return { [dialect.key]: { thinking: { type: depth === "none" ? "disabled" : "enabled" } } };
    default:
      return { [dialect.key]: { reasoningEffort: depth } };
  }
}
