#!/usr/bin/env node
/**
 * i18n-translate.mjs — real-translation toolkit for the shipped UI locales
 * (plan 65; the spec 47 L4 "translation integrity" arm).
 *
 * The contract, enforced by scripts/check-i18n-translations.js:
 *   [mirror]    a non-exempt locale value must never equal the en text
 *               (whitespace-normalized, case-insensitive)
 *   [stale]     the value must be anchored to the CURRENT en text — the
 *               ledger (tests/shared/i18n-translation-ledger.json) stores,
 *               per (locale, key), the short hash of the en text the
 *               translation was made from
 *   [missing]   every non-exempt (locale, key) pair needs a ledger entry
 *   [empty]     blank message values are rejected
 *   [allowlist] tests/shared/i18n-translation-allowlist.mjs is EXACT:
 *               dangling / no-longer-identical entries fail the gate
 *   [format]    locale + ledger files must stay in canonical JSON form
 *               (`JSON.stringify(value, null, 2) + "\n"`, key order preserved)
 *
 * Subcommands:
 *   check     [--root R] [--json]
 *                             audit a tree (same engine as the lint)
 *   seed      [--root R] [--locales a,b] [--keys k1,k2] [--dry]
 *                             stamp the ledger for EXISTING non-mirror
 *                             translations (vouch-current bootstrap; mirrors
 *                             are reported, never stamped)
 *   restamp   --keys k1,k2 [--root R] [--locales a,b] [--dry]
 *                             re-anchor ledger entries to the current en text
 *                             after a reviewed "keep as-is" decision
 *   apply     --file <payload.json> [--root R] [--dry]
 *                             apply externally produced translations:
 *                             {"translations": {"<locale>": {"<key>": "<value>"}}}
 *                             full validation + canonical writes + stamping
 *   run       [--root R] [--locales a,b] [--keys k1,k2]
 *             [--base URL] [--model M] [--key K] [--batch N] [--sleep ms]
 *             [--reasoning none] [--dry]
 *                             translate mirror/stale pairs through an
 *                             OpenAI-compatible chat endpoint (defaults via
 *                             env I18N_TRANSLATE_BASE_URL / _MODEL / _API_KEY)
 *
 * Single implementation: the lint delegates to audit() here so the gate and
 * the tooling can never drift apart.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LOCALES_REL = path.join("src", "_locales");
export const ALLOWLIST_REL = path.join("tests", "shared", "i18n-translation-allowlist.mjs");
export const LEDGER_REL = path.join("tests", "shared", "i18n-translation-ledger.json");

/** English names for the shipped locale codes (used by the `run` prompts). */
export const LOCALE_NAMES = {
  af: "Afrikaans", ar: "Arabic", ca: "Catalan", cs: "Czech", da: "Danish",
  de: "German", el: "Greek", es: "Spanish", fa: "Persian", fi: "Finnish",
  fr: "French", he: "Hebrew", hi: "Hindi", hr: "Croatian", hu: "Hungarian",
  is: "Icelandic", it: "Italian", ja: "Japanese", ko: "Korean", lv: "Latvian",
  nl: "Dutch", no: "Norwegian", pl: "Polish", pt_BR: "Brazilian Portuguese",
  pt_PT: "European Portuguese", ro: "Romanian", ru: "Russian", sl: "Slovenian",
  sr: "Serbian", sv: "Swedish", th: "Thai", tr: "Turkish", ug: "Uyghur",
  uk: "Ukrainian", vi: "Vietnamese", zh_CN: "Simplified Chinese",
  zh_TW: "Traditional Chinese",
};

// ─── text + hashing ─────────────────────────────────────────────────

/** Collapse whitespace and trim — the normalization the gate compares on. */
export function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function normalizedLower(text) {
  return normalizeText(text).toLowerCase();
}

/** Short hash of the normalized en text a translation is anchored to. */
export function enHash(message) {
  return createHash("sha256").update(normalizeText(message)).digest("hex").slice(0, 12);
}

/** Clean a value for writing: LF line endings, outer whitespace trimmed
 *  (internal line breaks are preserved — several messages use "\n"). */
export function cleanValue(raw) {
  return String(raw ?? "").replace(/\r\n?/g, "\n").trim();
}

/** Canonical serialization — byte-identical to every committed locale file. */
export function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Unique $PLACEHOLDER$ tokens used in a message (chrome.i18n `$NAME$` form). */
export function placeholderTokens(message) {
  return [...new Set(String(message).match(/\$[A-Za-z0-9_]+\$/g) || [])].sort();
}

export function pairKey(locale, key) {
  return `${locale}\u0000${key}`;
}

// ─── loading ────────────────────────────────────────────────────────

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function localesDir(root) {
  return path.join(root, LOCALES_REL);
}

export function loadLocales(root) {
  const dir = localesDir(root);
  const localeIds = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const messages = {};
  const raw = {};
  for (const locale of localeIds) {
    const file = path.join(dir, locale, "messages.json");
    if (!existsSync(file)) continue;
    raw[locale] = readFileSync(file, "utf8");
    messages[locale] = JSON.parse(raw[locale]);
  }
  return { locales: Object.keys(messages), messages, raw };
}

export async function loadAllowlist(root) {
  const file = path.join(root, ALLOWLIST_REL);
  const mod = await import(pathToFileURL(file).href);
  const entries = mod.I18N_TRANSLATION_ALLOWLIST;
  if (!Array.isArray(entries)) {
    throw new Error(`${ALLOWLIST_REL} must export I18N_TRANSLATION_ALLOWLIST array`);
  }
  const keyLevel = new Map();
  const pairLevel = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string" || entry.key === "") {
      throw new Error(`allowlist entry without key: ${JSON.stringify(entry)}`);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      throw new Error(`allowlist entry "${entry.key}" must carry a reason`);
    }
    if (entry.locale) pairLevel.set(pairKey(entry.locale, entry.key), entry);
    else keyLevel.set(entry.key, entry);
  }
  return { entries, keyLevel, pairLevel };
}

export function loadLedger(root) {
  const file = path.join(root, LEDGER_REL);
  if (!existsSync(file)) return { version: 1, locales: {} };
  const ledger = readJson(file);
  ledger.locales = ledger.locales || {};
  return ledger;
}

export function isExempt(allow, locale, key) {
  return allow.keyLevel.has(key) || allow.pairLevel.has(pairKey(locale, key));
}

/**
 * Shared pair validation — apply and run must agree on what is acceptable.
 * @returns {string|null} error message, or null when the value is acceptable.
 */
export function validatePair(allow, en, locale, key, value) {
  if (typeof value !== "string" || normalizeText(value) === "") {
    return `empty value: ${locale}:${key}`;
  }
  const expected = placeholderTokens(en[key].message);
  const got = placeholderTokens(value);
  if (JSON.stringify(expected) !== JSON.stringify(got)) {
    return `placeholder mismatch: ${locale}:${key} — expected [${expected.join(",")}], got [${got.join(",")}]`;
  }
  if (!isExempt(allow, locale, key) && normalizedLower(value) === normalizedLower(en[key].message)) {
    return `value equals en (mirror): ${locale}:${key} — translate it, or allowlist the pair with a reason`;
  }
  return null;
}

// ─── audit ──────────────────────────────────────────────────────────

/**
 * The single implementation of the real-translation gate.
 * @param {string} root — tree to audit (repo root, or a test fixture root).
 * @returns {Promise<{violations: Array, counts: Object, locales: number}>}
 */
export async function audit(root) {
  const { locales, messages, raw } = loadLocales(root);
  const en = messages.en;
  if (!en) throw new Error(`en locale not found under ${localesDir(root)}`);
  const allow = await loadAllowlist(root);
  const ledger = loadLedger(root);
  const violations = [];

  for (const locale of locales) {
    if (locale === "en") continue;
    const msgs = messages[locale];
    const stamped = ledger.locales[locale] || {};
    for (const key of Object.keys(en)) {
      if (!(key in msgs)) continue; // key completeness is i18nCompleteness' job
      if (isExempt(allow, locale, key)) continue;
      const english = en[key].message;
      const value = msgs[key] ? msgs[key].message : "";
      if (normalizeText(value) === "") {
        violations.push({ type: "empty", locale, key });
        continue;
      }
      if (normalizedLower(value) === normalizedLower(english)) {
        violations.push({ type: "mirror", locale, key });
        continue;
      }
      const want = enHash(english);
      if (!(key in stamped)) {
        violations.push({ type: "missing", locale, key });
      } else if (stamped[key] !== want) {
        violations.push({ type: "stale", locale, key, from: stamped[key], want });
      }
    }
  }

  // Allowlist hygiene — the list must stay exact.
  for (const [key] of allow.keyLevel) {
    if (!(key in en)) violations.push({ type: "allowlist-dangling", key });
  }
  for (const pk of allow.pairLevel.keys()) {
    const [locale, key] = pk.split("\u0000");
    if (!(key in en) || !(locale in messages)) {
      violations.push({ type: "allowlist-dangling", locale, key });
      continue;
    }
    const value = messages[locale][key] ? messages[locale][key].message : "";
    if (normalizedLower(value) !== normalizedLower(en[key].message)) {
      violations.push({ type: "allowlist-stale", locale, key });
    }
  }

  // Canonical format — keeps diffs and future writes byte-stable.
  for (const locale of locales) {
    if (canonicalJson(messages[locale]) !== raw[locale]) {
      violations.push({ type: "format", locale });
    }
  }
  const ledgerFile = path.join(root, LEDGER_REL);
  if (existsSync(ledgerFile)) {
    if (canonicalJson(ledger) !== readFileSync(ledgerFile, "utf8")) {
      violations.push({ type: "format", locale: "ledger" });
    }
  }

  const counts = {};
  for (const v of violations) counts[v.type] = (counts[v.type] || 0) + 1;
  return { violations, counts, locales: locales.length };
}

// ─── writes (canonical + atomic) ────────────────────────────────────

export function writeCanonical(file, value) {
  const text = canonicalJson(value);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
  if (readFileSync(file, "utf8") !== text) {
    throw new Error(`write verification failed: ${file}`);
  }
}

// ─── seed / restamp ─────────────────────────────────────────────────

/**
 * Stamp ledger entries for existing translations.
 * Mirrors are reported (never stamped); with `strictMirrors` they are also
 * returned as refusals (the `restamp` flow must not restamp an untranslated
 * pair — translate it instead).
 */
export async function seed(root, opts = {}) {
  const { locales, messages } = loadLocales(root);
  const allow = await loadAllowlist(root);
  const ledger = loadLedger(root);
  const localeFilter = opts.locales ? new Set(opts.locales) : null;
  const keyFilter = opts.keys ? new Set(opts.keys) : null;
  const en = messages.en;
  const stampedKeys = [];
  const mirrors = [];
  let unchanged = 0;

  for (const locale of locales) {
    if (locale === "en") continue;
    if (localeFilter && !localeFilter.has(locale)) continue;
    const msgs = messages[locale];
    const stamped = (ledger.locales[locale] = ledger.locales[locale] || {});
    for (const key of Object.keys(en)) {
      if (keyFilter && !keyFilter.has(key)) continue;
      if (!(key in msgs)) continue;
      if (isExempt(allow, locale, key)) continue;
      const value = msgs[key].message;
      if (normalizedLower(value) === normalizedLower(en[key].message)) {
        mirrors.push(`${locale}:${key}`);
        continue;
      }
      const hash = enHash(en[key].message);
      if (stamped[key] !== hash) {
        stamped[key] = hash;
        stampedKeys.push(`${locale}:${key}`);
      } else {
        unchanged++;
      }
    }
  }

  if (stampedKeys.length > 0 && !opts.dry) {
    writeCanonical(path.join(root, LEDGER_REL), ledger);
  }
  return {
    stamped: stampedKeys.length,
    unchanged,
    mirrors,
    refused: opts.strictMirrors ? mirrors : [],
    wrote: stampedKeys.length > 0 && !opts.dry,
  };
}

// ─── apply ──────────────────────────────────────────────────────────

/**
 * Validate + write a { locale: { key: value } } translation map.
 * @returns {{ok: boolean, applied: number, errors: string[], notes: string[], updates?: Array}}
 */
export async function applyTranslations(root, translations, opts = {}) {
  const { locales, messages, raw } = loadLocales(root);
  const en = messages.en;
  const allow = await loadAllowlist(root);
  const ledger = loadLedger(root);
  const errors = [];
  const notes = [];
  const updates = [];

  for (const [locale, pairs] of Object.entries(translations || {})) {
    if (!locales.includes(locale) || locale === "en") {
      errors.push(`unknown locale: ${locale}`);
      continue;
    }
    for (const [key, valueRaw] of Object.entries(pairs)) {
      if (!(key in en)) {
        errors.push(`unknown key: ${locale}:${key}`);
        continue;
      }
      const value = cleanValue(valueRaw);
      const invalid = validatePair(allow, en, locale, key, value);
      if (invalid) {
        errors.push(invalid);
        continue;
      }
      const ratio = value.length / Math.max(en[key].message.length, 1);
      if (ratio > 3 || ratio < 0.3) {
        notes.push(
          `length note: ${locale}:${key} — en=${en[key].message.length}, value=${value.length}`
        );
      }
      updates.push({ locale, key, value });
    }
  }

  if (errors.length > 0) {
    return { ok: false, applied: 0, errors, notes };
  }
  if (opts.dry) {
    return { ok: true, applied: updates.length, errors: [], notes, dry: true, updates };
  }

  const byLocale = {};
  for (const update of updates) {
    (byLocale[update.locale] = byLocale[update.locale] || []).push(update);
  }
  for (const [locale, list] of Object.entries(byLocale)) {
    if (canonicalJson(messages[locale]) !== raw[locale]) {
      errors.push(`format drift before write: ${locale} — refusing to touch the file`);
      continue;
    }
    for (const update of list) {
      messages[locale][update.key].message = update.value;
    }
    writeCanonical(path.join(localesDir(root), locale, "messages.json"), messages[locale]);
    const stamped = (ledger.locales[locale] = ledger.locales[locale] || {});
    for (const update of list) {
      stamped[update.key] = enHash(en[update.key].message);
    }
  }
  if (errors.length > 0) {
    return { ok: false, applied: 0, errors, notes };
  }
  writeCanonical(path.join(root, LEDGER_REL), ledger);
  return { ok: true, applied: updates.length, errors: [], notes };
}

export async function apply(root, payloadFile, opts = {}) {
  const payload = readJson(payloadFile);
  return applyTranslations(root, payload.translations || {}, opts);
}

// ─── run (OpenAI-compatible endpoint) ───────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonBlock(text) {
  const cleaned = String(text).replace(/```[a-zA-Z]*\n?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function chatJson({ base, model, apiKey, system, user, maxTokens = 6000, attempts = 3, reasoning }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${String(base).replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey || "not-needed"}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: maxTokens,
          ...(reasoning ? { reasoning_effort: reasoning } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = await res.json();
      const content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";
      return parseJsonBlock(content || "");
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

function buildSystemPrompt(locale) {
  const name = LOCALE_NAMES[locale] || locale;
  return [
    `You are a professional localization engine for a browser translation extension (options page, popup, tooltips, buttons, error messages).`,
    `Translate the given English UI strings into ${name} (${locale}).`,
    `Rules:`,
    `- Output ONLY one strict JSON object: {"<key>": "<translation>"} covering exactly the provided keys. Keep the JSON keys EXACTLY as given (never translate the keys). No markdown fences, no commentary, no extra keys.`,
    `- Keep placeholders such as $PROVIDER_NAME$ / $LANGUAGE_NAME$ exactly as-is.`,
    `- Keep product and brand names untranslated: DualTran, OpenAI, Google Gemini, DeepL, GitHub, Chrome Web Store, Microsoft, API, URL, AI.`,
    `- Concise UI register: short labels stay short; sentences stay natural; keep the trailing punctuation style of the English source.`,
    `- Use the terminology established in the reference translations below.`,
    `- Never leave the English wording unless it is a brand name or a token.`,
  ].join("\n");
}

function buildUser(referenceBlock, locale, payload) {
  return [
    referenceBlock ? `Reference translations already used in this locale:\n${referenceBlock}\n` : "",
    `Translate these UI strings (English → ${LOCALE_NAMES[locale] || locale}):`,
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

/**
 * Translate mirror/stale pairs via an OpenAI-compatible chat endpoint.
 * Writes with the same validation + stamping path as apply().
 * Per-pair problems split into `failures` (model/endpoint problems, retried
 * key-by-key) and `flagged` (valid-looking but rejected pairs — e.g. a
 * translator output identical to en that should be allowlisted or retried).
 */
export async function run(root, opts = {}) {
  const base = opts.base || process.env.I18N_TRANSLATE_BASE_URL || "";
  const model = opts.model || process.env.I18N_TRANSLATE_MODEL || "";
  const apiKey = opts.key || process.env.I18N_TRANSLATE_API_KEY || "not-needed";
  if (!base || !model) {
    throw new Error(
      "run: pass --base/--model (or set I18N_TRANSLATE_BASE_URL / I18N_TRANSLATE_MODEL / I18N_TRANSLATE_API_KEY)"
    );
  }
  const batchSize = opts.batch || 12;
  const pauseMs = opts.sleep === undefined ? 250 : opts.sleep;
  const reasoning = opts.reasoning;

  const { locales, messages } = loadLocales(root);
  const en = messages.en;
  const allow = await loadAllowlist(root);
  const ledger = loadLedger(root);

  const targetsByLocale = {};
  for (const locale of locales) {
    if (locale === "en") continue;
    if (opts.locales && !opts.locales.includes(locale)) continue;
    const stamped = ledger.locales[locale] || {};
    for (const key of Object.keys(en)) {
      if (opts.keys && !opts.keys.includes(key)) continue;
      if (!(key in messages[locale])) continue;
      if (isExempt(allow, locale, key)) continue;
      const value = messages[locale][key].message;
      const mirror = normalizedLower(value) === normalizedLower(en[key].message);
      const stale = !mirror && key in stamped && stamped[key] !== enHash(en[key].message);
      if (mirror || stale) (targetsByLocale[locale] = targetsByLocale[locale] || []).push(key);
    }
  }

  const failures = [];
  const flagged = [];
  const translations = {};
  let planned = 0;

  for (const [locale, keys] of Object.entries(targetsByLocale)) {
    // Reference pairs: earlier real translations of this locale (style memory).
    const references = [];
    for (const key of Object.keys(en)) {
      if (references.length >= 6) break;
      if (!(key in messages[locale])) continue;
      const value = messages[locale][key].message;
      if (normalizedLower(value) === normalizedLower(en[key].message)) continue;
      if (isExempt(allow, locale, key)) continue;
      references.push({ key, value });
    }
    const referenceBlock = references
      .map((ref) => `- "${ref.key}": ${JSON.stringify(ref.value)}`)
      .join("\n");

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      planned += batch.length;
      const payload = {};
      for (const key of batch) {
        payload[key] = { en: en[key].message };
        if (en[key].description) payload[key].note = en[key].description;
      }
      console.log(`  [run] ${locale}: batch ${Math.floor(i / batchSize) + 1} (${batch.length} keys)...`);
      let result = null;
      try {
        result = await chatJson({
          base,
          model,
          apiKey,
          reasoning,
          system: buildSystemPrompt(locale),
          user: buildUser(referenceBlock, locale, payload),
          maxTokens: opts.maxTokens || 6000,
        });
      } catch (error) {
        console.log(`  [run] ${locale}: batch failed (${error.message}) — retrying key by key`);
      }
      if (result === null) {
        result = {};
        for (const key of batch) {
          try {
            const one = await chatJson({
              base,
              model,
              apiKey,
              reasoning,
              system: buildSystemPrompt(locale),
              user: buildUser(referenceBlock, locale, { [key]: payload[key] }),
              maxTokens: opts.maxTokens || 6000,
            });
            if (typeof one[key] === "string") result[key] = one[key];
            else failures.push(`${locale}:${key} — model returned no translation`);
          } catch (error) {
            failures.push(`${locale}:${key} — ${error.message}`);
          }
          if (pauseMs > 0) await sleep(pauseMs);
        }
      }
      for (const key of batch) {
        const raw = result[key];
        if (typeof raw !== "string" || normalizeText(raw) === "") {
          const note = `${locale}:${key} — model returned no translation`;
          if (!failures.includes(note)) failures.push(note);
          continue;
        }
        const value = cleanValue(raw);
        const invalid = validatePair(allow, en, locale, key, value);
        if (invalid) {
          flagged.push(`${locale}:${key} — ${invalid}`);
          continue;
        }
        (translations[locale] = translations[locale] || {})[key] = value;
      }
      if (pauseMs > 0) await sleep(pauseMs);
    }
  }

  if (planned === 0) {
    return { ok: true, applied: 0, planned: 0, failures: [], flagged: [], note: "nothing to translate" };
  }
  if (opts.dry) {
    return { ok: true, dry: true, planned, failures, flagged, translations };
  }
  const applied = await applyTranslations(root, translations, {});
  return {
    ok: applied.ok && failures.length === 0,
    planned,
    applied: applied.applied,
    errors: applied.errors,
    notes: applied.notes,
    failures,
    flagged,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[name] = true;
      else {
        args[name] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0] || "check";
  const root = args.root ? path.resolve(args.root) : REPO_ROOT;
  const locales = typeof args.locales === "string" ? args.locales.split(",").filter(Boolean) : null;
  const keys = typeof args.keys === "string" ? args.keys.split(",").filter(Boolean) : null;

  if (command === "check") {
    const report = await audit(root);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `audit: ${report.violations.length} violation(s) across ${report.locales} locales — ${JSON.stringify(report.counts)}`
      );
      for (const v of report.violations.slice(0, 40)) console.log("  " + JSON.stringify(v));
      if (report.violations.length > 40) console.log(`  ... and ${report.violations.length - 40} more`);
    }
    process.exit(report.violations.length === 0 ? 0 : 1);
  }

  if (command === "seed" || command === "restamp") {
    if (command === "restamp" && !keys) {
      console.error("restamp requires --keys k1,k2 (the reviewed keep-as-is keys)");
      process.exit(2);
    }
    const result = await seed(root, {
      locales,
      keys,
      dry: Boolean(args.dry),
      strictMirrors: command === "restamp",
    });
    console.log(
      `${command}: stamped ${result.stamped}, unchanged ${result.unchanged}, mirrors skipped ${result.mirrors.length}` +
        (result.wrote ? " — ledger written" : " — nothing to write")
    );
    if (result.mirrors.length > 0) {
      console.log(
        `  mirrors (translate these — never stamped): ${result.mirrors.slice(0, 20).join(", ")}${
          result.mirrors.length > 20 ? " ..." : ""
        }`
      );
    }
    process.exit(command === "restamp" && result.refused.length > 0 ? 1 : 0);
  }

  if (command === "apply") {
    if (!args.file) {
      console.error("apply requires --file <payload.json>");
      process.exit(2);
    }
    const result = await apply(root, path.resolve(args.file), { dry: Boolean(args.dry) });
    if (!result.ok) {
      console.error(`apply: REJECTED (${result.errors.length} error(s))`);
      for (const error of result.errors.slice(0, 40)) console.error("  " + error);
      process.exit(1);
    }
    console.log(
      `apply: ${result.dry ? "dry-run planned" : "applied"} ${result.applied} translation(s)` +
        (result.notes.length ? `, ${result.notes.length} length note(s)` : "")
    );
    for (const note of result.notes.slice(0, 20)) console.log("  " + note);
    process.exit(0);
  }

  if (command === "run") {
    const result = await run(root, {
      base: typeof args.base === "string" ? args.base : undefined,
      model: typeof args.model === "string" ? args.model : undefined,
      key: typeof args.key === "string" ? args.key : undefined,
      reasoning: typeof args.reasoning === "string" ? args.reasoning : undefined,
      locales,
      keys,
      batch: args.batch ? Number(args.batch) : undefined,
      sleep: args.sleep !== undefined ? Number(args.sleep) : undefined,
      dry: Boolean(args.dry),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok || result.dry || result.planned === 0 ? 0 : 1);
  }

  console.error(`unknown subcommand: ${command}`);
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
