#!/usr/bin/env node
/**
 * check-i18n-translations.js — the real-translation gate (20th architecture
 * lint; plan 65 / the spec 47 L4 "translation integrity" arm).
 *
 * Every shipped UI locale must carry REAL translations: a non-exempt value
 * may never equal the en text, it must be anchored to the CURRENT en text
 * (the ledger), and the allowlist of legal identities must stay exact.
 * Rules (single implementation lives in scripts/i18n-translate.mjs):
 *   [mirror]            locale value equals the en text (whitespace/case
 *                       normalized) and the pair is not allowlisted
 *   [stale]             translation anchored to an older en version (ledger
 *                       hash mismatch) — re-translate, or restamp after a
 *                       reviewed keep-as-is decision
 *   [missing]           no ledger entry for a non-exempt pair (run seed)
 *   [empty]             blank message value
 *   [allowlist-*]       allowlist entries that no longer match reality —
 *                       dangling (key gone) or stale (pair no longer identical)
 *   [format]            locale/ledger files outside canonical JSON form
 *
 * Exit code 1 on violations (hard failure in CI + pre-push).
 *
 * Usage:
 *   node scripts/check-i18n-translations.js
 *   node scripts/check-i18n-translations.js --root <fixture>   (self-test)
 *   node scripts/check-i18n-translations.js --json             (full report)
 */
const path = require("path");
const { pathToFileURL } = require("url");

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const rootIndex = process.argv.indexOf("--root");
const SCAN_ROOT = rootIndex !== -1 ? path.resolve(process.argv[rootIndex + 1]) : REPO_ROOT;
const asJson = process.argv.includes("--json");
const LIMIT = 100;

function formatViolation(violation) {
  switch (violation.type) {
    case "mirror":
      return `[mirror] ${violation.locale}: ${violation.key} — value equals en (translate it, or allowlist the pair with a reason)`;
    case "stale":
      return `[stale] ${violation.locale}: ${violation.key} — anchored to older en text (${violation.from} → ${violation.want}; run: npm run i18n:translate, or restamp after a reviewed keep)`;
    case "missing":
      return `[missing] ${violation.locale}: ${violation.key} — no ledger entry (run: node scripts/i18n-translate.mjs seed)`;
    case "empty":
      return `[empty] ${violation.locale}: ${violation.key} — blank message value`;
    case "allowlist-dangling":
      return `[allowlist-dangling] ${violation.locale ? `(${violation.locale}, ${violation.key})` : violation.key} — not present in the tree (remove the entry)`;
    case "allowlist-stale":
      return `[allowlist-stale] (${violation.locale}, ${violation.key}) — no longer identical to en (remove the entry)`;
    case "format":
      return `[format] ${violation.locale} — not in canonical JSON form (re-write it through the tool)`;
    default:
      return `[${violation.type}] ${JSON.stringify(violation)}`;
  }
}

async function checkI18nTranslations() {
  let auditTranslations;
  try {
    ({ auditTranslations } = await import(pathToFileURL(path.join(SCRIPT_DIR, "i18n-translate.mjs")).href));
  } catch (error) {
    console.error(`⚠️  Cannot load scripts/i18n-translate.mjs: ${error.message}`);
    process.exit(1);
  }
  const report = await auditTranslations(SCAN_ROOT);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.violations.length > 0 ? 1 : 0);
  }

  if (report.violations.length === 0) {
    console.log("✅ i18n translations OK (no mirrors, ledger fresh, allowlist exact).");
    process.exit(0);
  }

  console.error(`i18n translation violations found (${report.violations.length}):`);
  console.error(
    `  counts: ${Object.entries(report.counts)
      .map(([type, count]) => `${type}=${count}`)
      .join(", ")}`
  );
  for (const violation of report.violations.slice(0, LIMIT)) {
    console.error("  " + formatViolation(violation));
  }
  if (report.violations.length > LIMIT) {
    console.error(`  ... and ${report.violations.length - LIMIT} more (use --json for the full report)`);
  }
  console.error("");
  console.error(
    "Fix: npm run i18n:translate (translate missing/stale pairs) / node scripts/i18n-translate.mjs seed (vouch existing translations) / edit tests/shared/i18n-translation-allowlist.mjs (legal identities only, each with a reason)."
  );
  process.exit(1);
}

module.exports = { checkI18nTranslations };

if (require.main === module) {
  checkI18nTranslations().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
