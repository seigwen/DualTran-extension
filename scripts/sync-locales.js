/*
  Keep locale files aligned with src/_locales/en/messages.json.

  Plan 65 guard: missing keys are auto-filled ONLY for allowlisted brand
  keys. Any other missing key is reported as "needs a real translation" and
  fails the run — the silent English fill is gone (it is exactly the defect
  class the real-translation gate, scripts/check-i18n-translations.js,
  exists for). Fix path: `npm run i18n:translate`.

  Usage:
    node scripts/sync-locales.js
    node scripts/sync-locales.js --dry
    node scripts/sync-locales.js --prune-extras
    node scripts/sync-locales.js --dry --fail-on-extra
    node scripts/sync-locales.js --root <fixture>     (self-test)
*/

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const argRoot = process.argv.indexOf("--root");
const SCAN_ROOT = argRoot !== -1 ? path.resolve(process.argv[argRoot + 1]) : ROOT;
const LOCALES_DIR = path.join(SCAN_ROOT, "src", "_locales");
const EN_FILE = path.join(LOCALES_DIR, "en", "messages.json");

const isDryRun = process.argv.includes("--dry") || process.argv.includes("-n");
const pruneExtras = process.argv.includes("--prune-extras");
const failOnExtra = process.argv.includes("--fail-on-extra");

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read or parse JSON: ${filePath}\n${error.message}`);
  }
}

function writeJSON(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getLocaleDirs() {
  return fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Key-level allowlist entries are the only ones English fill may cover. */
async function loadFillableKeys() {
  const file = path.join(SCAN_ROOT, "tests", "shared", "i18n-translation-allowlist.mjs");
  const mod = await import(pathToFileURL(file).href);
  const entries = mod.I18N_TRANSLATION_ALLOWLIST || [];
  return new Set(entries.filter((entry) => !entry.locale).map((entry) => entry.key));
}

function buildSyncedMessages(baseMessages, localeMessages, fillableKeys) {
  const synced = {};
  for (const key of Object.keys(baseMessages)) {
    if (Object.prototype.hasOwnProperty.call(localeMessages, key)) {
      synced[key] = localeMessages[key];
    } else if (fillableKeys.has(key)) {
      synced[key] = deepClone(baseMessages[key]);
    }
    // Non-allowlisted missing keys stay absent — reported as blocked below.
  }

  if (!pruneExtras) {
    for (const key of Object.keys(localeMessages)) {
      if (!Object.prototype.hasOwnProperty.call(baseMessages, key)) {
        synced[key] = localeMessages[key];
      }
    }
  }

  return synced;
}

async function main() {
  if (!fs.existsSync(EN_FILE)) {
    console.error(`Base locale file not found: ${EN_FILE}`);
    process.exit(1);
  }

  const fillableKeys = await loadFillableKeys();
  const baseMessages = readJSON(EN_FILE);
  const baseKeys = Object.keys(baseMessages);
  const locales = getLocaleDirs().filter((locale) => locale !== "en");

  const summary = [];
  const blocked = [];
  let hasDiff = false;
  let hasExtraKeyIssue = false;

  for (const locale of locales) {
    const filePath = path.join(LOCALES_DIR, locale, "messages.json");
    if (!fs.existsSync(filePath)) {
      blocked.push({ locale, created: true, keys: baseKeys });
      summary.push({ locale, created: true, added: 0, blocked: baseKeys.length, extras: 0, changed: false });
      continue;
    }

    const localeMessages = readJSON(filePath);
    const localeKeys = Object.keys(localeMessages);
    const missingKeys = baseKeys.filter((key) => !Object.prototype.hasOwnProperty.call(localeMessages, key));
    const blockedKeys = missingKeys.filter((key) => !fillableKeys.has(key));
    const fillableMissing = missingKeys.filter((key) => fillableKeys.has(key));
    const extraKeys = localeKeys.filter((key) => !Object.prototype.hasOwnProperty.call(baseMessages, key));
    const syncedMessages = buildSyncedMessages(baseMessages, localeMessages, fillableKeys);
    const changed = JSON.stringify(localeMessages) !== JSON.stringify(syncedMessages);

    if (changed) {
      hasDiff = true;
      if (!isDryRun) {
        writeJSON(filePath, syncedMessages);
      }
    }

    if (extraKeys.length > 0 && failOnExtra) {
      hasExtraKeyIssue = true;
    }
    if (blockedKeys.length > 0) {
      blocked.push({ locale, created: false, keys: blockedKeys });
    }

    summary.push({
      locale,
      created: false,
      added: fillableMissing.length,
      blocked: blockedKeys.length,
      extras: extraKeys.length,
      changed,
    });
  }

  console.log(`Locale sync ${isDryRun ? "dry run" : "write"} complete.`);
  for (const item of summary) {
    if (item.created) {
      console.log(`  ${item.locale}: messages.json missing — creation refused (needs real translations)`);
      continue;
    }

    console.log(
      `  ${item.locale}: missing ${item.added}, blocked ${item.blocked}, extra ${item.extras}, changed ${item.changed ? "yes" : "no"}`
    );
  }

  if (isDryRun && hasDiff) {
    console.error("Locale files are out of sync. Run npm run i18n:sync.");
  }
  if (hasExtraKeyIssue) {
    console.error("Extra locale keys detected. Re-run sync with --prune-extras to remove them.");
  }
  if (blocked.length > 0) {
    console.error("Missing keys need REAL translations — English fill is not allowed (plan 65):");
    for (const item of blocked) {
      console.error(
        `  ${item.locale}${item.created ? " (messages.json missing)" : ""}: ${item.keys
          .slice(0, 8)
          .join(", ")}${item.keys.length > 8 ? `, ... (${item.keys.length} keys)` : ""}`
      );
    }
    console.error("Run `npm run i18n:translate` to fill them with real translations.");
  }

  if ((isDryRun && hasDiff) || hasExtraKeyIssue || blocked.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
