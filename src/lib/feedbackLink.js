"use strict";

/**
 * Feedback-link pure functions (plan 35 — user feedback channel).
 *
 * This module is the single source of truth for every artifact the user can
 * carry out of the extension:
 *
 *   - `buildIssueUrl`              — the prefilled GitHub issue-form URL
 *     (static options path + both error-icon paths)
 *   - `buildMailtoUrl`             — the no-GitHub-account fallback
 *   - `formatDiagnosticsBlock`     — the clipboard / email-body diagnostics
 *
 * Red line (hard, asserted negatively in tests): artifacts NEVER carry API
 * keys, API base configs, page content, translation source/target text, or
 * the full page URL — only the hostname (domain level). Everything this
 * module produces sits in a user-visible, user-editable container (a form
 * field / an email draft / the clipboard); there is no silent background
 * sending anywhere in the call chain.
 *
 * Field values that target GitHub issue-form dropdowns must match the
 * `bug_report.yml` option strings byte-for-byte, or GitHub silently ignores
 * the prefill.
 */

const ISSUE_FORM_BASE = "https://github.com/seigwen/DualTran-extension/issues/new";

/** GitHub issue-form file to select (the YAML form, not the .md template). */
const ISSUE_TEMPLATE_FILE = "bug_report.yml";

/** Practical safe length for a prefilled issue URL (browsers handle more, but
 * chat clients / GitHub itself get unreliable far beyond this). */
const MAX_URL_LENGTH = 2000;

/** Hard cap for the error text (provider-returned arbitrary text is clamped
 * on every path, including the diagnostics block). */
const MAX_ERROR_LENGTH = 500;

/** Contact address already public on the Chrome Web Store listing. */
const FEEDBACK_EMAIL = "seigwen@gmail.com";

// ── User-agent tables ────────────────────────────────────────────

/**
 * Map a User-Agent string to the exact `bug_report.yml` browser option.
 *
 * Known limitation (§8 of the plan): Brave's UA is indistinguishable from
 * Chrome's → "Chrome". The prefill is fully visible/editable, so the user
 * can correct it in the form.
 *
 * @param {string} [userAgent]
 * @returns {"Chrome"|"Edge"|"Firefox"|"Other"}
 */
export function detectBrowserFromUserAgent(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  // Edge must be checked BEFORE Chrome — Edge UAs contain "Chrome/".
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  return "Other";
}

/**
 * Map a User-Agent string to the exact `bug_report.yml` OS option.
 *
 * Ordering traps: Android UAs contain "Linux"; iPhone/iPad UAs contain
 * "Mac OS X" — the more specific platform must win.
 *
 * @param {string} [userAgent]
 * @returns {"Windows 10/11"|"Windows"|"macOS"|"ChromeOS"|"Linux"|"Android"|"iOS"|"Unknown"}
 */
export function detectOsFromUserAgent(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Windows NT 10/.test(ua)) return "Windows 10/11";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown";
}

// ── Service / provider mapping ───────────────────────────────────

/**
 * Map (serviceType, providerId) to the exact `bug_report.yml` service option.
 *
 * Only providers with a named dropdown entry keep their name; everything
 * else (including dynamic/custom providers) maps to "Other" — the user can
 * adjust the dropdown in the form.
 *
 * @param {"google"|"ai"|string} [serviceType]
 * @param {string} [providerId]
 * @returns {string} dropdown value, or "" when the service is unknown
 */
export function mapServiceToIssueValue(serviceType, providerId) {
  if (serviceType === "google") return "Google Translate";
  if (serviceType === "ai") {
    const namedProviders = {
      openai: "AI Translation (OpenAI)",
      deepseek: "AI Translation (DeepSeek)",
      anthropic: "AI Translation (Anthropic)",
      "google-gemini": "AI Translation (Google Gemini)",
    };
    return namedProviders[providerId] || "AI Translation (Other)";
  }
  return "";
}

/**
 * Resolve a provider ID to the display name used in the diagnostics block.
 * Unknown / custom providers pass through unchanged (still a stable
 * searchable token).
 *
 * @param {string} [providerId]
 * @returns {string}
 */
export function resolveProviderDisplayName(providerId) {
  if (typeof providerId !== "string" || providerId === "") return "";
  const names = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    "google-gemini": "Google Gemini",
    deepseek: "DeepSeek",
    openrouter: "OpenRouter",
    mistral: "Mistral AI",
    cohere: "Cohere",
    together: "Together AI",
    groq: "Groq",
    "azure-openai": "Azure OpenAI",
    zhipu: "Zhipu",
    moonshot: "Moonshot",
    qwen: "Qwen",
    baidu: "Baidu ERNIE",
    bytedance: "Doubao",
    iflytek: "iFlytek Spark",
    perplexity: "Perplexity",
    grok: "xAI (Grok)",
    deepinfra: "Deep Infra",
    cerebras: "Cerebras",
    vercel: "Vercel AI Gateway",
  };
  return names[providerId] || providerId;
}

/** Page-translator service names for the diagnostics block. */
function pageServiceDisplayName(pageService) {
  const names = {
    google: "Google",
    microsoft: "Microsoft",
    yandex: "Yandex",
  };
  return names[pageService] || (typeof pageService === "string" ? pageService : "");
}

// ── Diagnostics block ────────────────────────────────────────────

/**
 * Build the diagnostics block used by the clipboard button and the mailto
 * fallback. Line names are stable English tokens (searchable during triage).
 *
 * The first six lines are always present; hostname / language pair / error
 * lines appear only when the corresponding data exists (error path). An
 * "und" source language is treated as absent — it is a non-detection
 * marker, not information.
 *
 * @param {Object} [data]
 * @param {string} [data.version]
 * @param {string} [data.userAgent]
 * @param {string} [data.pageService]
 * @param {string} [data.providerName] - provider display name (already resolved)
 * @param {string} [data.targetLang]
 * @param {string} [data.hostname]
 * @param {string} [data.sourceLang]
 * @param {string} [data.errorText]
 * @returns {string}
 */
export function formatDiagnosticsBlock(data = {}) {
  const {
    version,
    userAgent,
    pageService,
    providerName,
    targetLang,
    hostname,
    sourceLang,
    errorText,
  } = data;

  const lines = [
    `DualTran: ${version || ""}`,
    `Browser: ${detectBrowserFromUserAgent(userAgent)}`,
    `OS: ${detectOsFromUserAgent(userAgent)}`,
    `Page translation: ${pageServiceDisplayName(pageService)}`,
    `AI translation: ${typeof providerName === "string" ? providerName : ""}`,
    `Target language: ${targetLang || ""}`,
  ];

  const cleanHostname = typeof hostname === "string" ? hostname.trim() : "";
  if (cleanHostname) lines.push(`Hostname: ${cleanHostname}`);

  const src = typeof sourceLang === "string" && sourceLang !== "und" ? sourceLang.trim() : "";
  const tgt = typeof targetLang === "string" ? targetLang.trim() : "";
  if (src && tgt) lines.push(`Language pair: ${src} → ${tgt}`);

  const err = typeof errorText === "string" ? errorText.trim() : "";
  if (err) lines.push(`Error: ${err.slice(0, MAX_ERROR_LENGTH)}`);

  return lines.join("\n");
}

// ── Issue URL ────────────────────────────────────────────────────

/**
 * Build the prefilled GitHub issue-form URL.
 *
 * Three caller states:
 *   - static (options button):  version / browser / OS only — no `service`
 *     claim (the page context is not known there; a wrong guess misleads
 *     triage). serviceType omitted.
 *   - error path (google):      + service=Google Translate + context block
 *   - error path (ai):          + mapped service + context block with the
 *     AI provider line
 *
 * Returns "" when the version is missing — an issue without a version is
 * noise, and the form's version field is required.
 *
 * Length budget: the final URL is kept ≤ 2000 chars by shrinking ONLY the
 * error text; every other context field is never dropped (asserted in
 * tests). The error text is capped at 500 chars even when the budget would
 * allow more.
 *
 * @param {Object} [data]
 * @param {string} [data.version]
 * @param {string} [data.userAgent]
 * @param {"google"|"ai"} [data.serviceType]
 * @param {string} [data.providerId]
 * @param {string} [data.errorText]
 * @param {string} [data.hostname]
 * @param {string} [data.sourceLang]
 * @param {string} [data.targetLang]
 * @returns {string} prefilled URL, or "" when it cannot be built
 */
export function buildIssueUrl(data = {}) {
  // Whitelist destructuring — caller extras (apiKey / apiBase / pageUrl /
  // pageContent …) can never leak into the URL.
  const {
    version,
    userAgent,
    serviceType,
    providerId,
    errorText,
    hostname,
    sourceLang,
    targetLang,
  } = data;

  const cleanVersion = typeof version === "string" ? version.trim() : "";
  if (!cleanVersion) return "";

  const params = new URLSearchParams();
  params.set("template", ISSUE_TEMPLATE_FILE);
  params.set("extension-version", cleanVersion);
  params.set("browser", detectBrowserFromUserAgent(userAgent));
  params.set("os", detectOsFromUserAgent(userAgent));

  const service = mapServiceToIssueValue(serviceType, providerId);
  if (service) params.set("service", service);

  // Error text: hard cap first; the budget loop may shrink it further.
  const fullError = typeof errorText === "string" ? errorText.trim() : "";
  const cappedError = fullError.slice(0, MAX_ERROR_LENGTH);

  const cleanHostname = typeof hostname === "string" ? hostname.trim() : "";
  const cleanSource =
    typeof sourceLang === "string" && sourceLang !== "und" ? sourceLang.trim() : "";
  const cleanTarget = typeof targetLang === "string" ? targetLang.trim() : "";

  const buildAdditional = (err) => {
    const lines = [];
    if (cleanHostname) lines.push(`Hostname: ${cleanHostname}`);
    if (cleanSource && cleanTarget) lines.push(`Language pair: ${cleanSource} → ${cleanTarget}`);
    if (serviceType === "ai") {
      const name = resolveProviderDisplayName(providerId);
      if (name) lines.push(`AI provider: ${name}`);
    }
    if (err) lines.push(`Error: ${err}`);
    return lines.join("\n");
  };

  const compose = (err) => {
    const additional = buildAdditional(err);
    if (additional) {
      params.set("additional", additional);
    } else {
      params.delete("additional");
    }
    return `${ISSUE_FORM_BASE}?${params.toString()}`;
  };

  let err = cappedError;
  let url = compose(err);

  // Budget convergence: only the error text shrinks; other fields never drop.
  // A single CJK char percent-encodes to up to 9 chars, so shrink at least
  // one char per pass and estimate using the worst-case factor.
  while (url.length > MAX_URL_LENGTH && err.length > 0) {
    const excess = url.length - MAX_URL_LENGTH;
    const shrink = Math.max(1, Math.ceil(excess / 9));
    err = err.slice(0, Math.max(0, err.length - shrink));
    url = compose(err);
  }

  return url;
}

// ── Mailto fallback ──────────────────────────────────────────────

/**
 * Build the mailto fallback URL (no-GitHub-account path).
 *
 * Subject is version-stamped for triage filtering; the body carries the
 * diagnostics block (the user can delete it in their mail client before
 * sending — it is a visible draft, never a silent send).
 *
 * @param {Object} [data]
 * @param {string} [data.version]
 * @param {string} [data.body]
 * @returns {string} mailto URL
 */
export function buildMailtoUrl(data = {}) {
  const { version, body } = data;
  const subject = `[DualTran v${version || ""}]`;
  let url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}`;
  if (typeof body === "string" && body !== "") {
    url += `&body=${encodeURIComponent(body)}`;
  }
  return url;
}
