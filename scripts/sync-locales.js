/*
  Keep locale files aligned with src/_locales/en/messages.json.
  Usage:
    node scripts/sync-locales.js
    node scripts/sync-locales.js --dry
    node scripts/sync-locales.js --prune-extras
    node scripts/sync-locales.js --dry --fail-on-extra
*/

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "src", "_locales");
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

function buildSyncedMessages(baseMessages, localeMessages) {
  const synced = {};
  for (const key of Object.keys(baseMessages)) {
    synced[key] = Object.prototype.hasOwnProperty.call(localeMessages, key)
      ? localeMessages[key]
      : deepClone(baseMessages[key]);
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

function main() {
  if (!fs.existsSync(EN_FILE)) {
    console.error(`Base locale file not found: ${EN_FILE}`);
    process.exit(1);
  }

  const baseMessages = readJSON(EN_FILE);
  const baseKeys = Object.keys(baseMessages);
  const locales = getLocaleDirs().filter((locale) => locale !== "en");

  const summary = [];
  let hasDiff = false;
  let hasExtraKeyIssue = false;

  for (const locale of locales) {
    const filePath = path.join(LOCALES_DIR, locale, "messages.json");
    if (!fs.existsSync(filePath)) {
      hasDiff = true;
      summary.push({ locale, created: true, added: baseKeys.length, extras: 0, changed: true });
      if (!isDryRun) {
        writeJSON(filePath, deepClone(baseMessages));
      }
      continue;
    }

    const localeMessages = readJSON(filePath);
    const localeKeys = Object.keys(localeMessages);
    const missingKeys = baseKeys.filter((key) => !Object.prototype.hasOwnProperty.call(localeMessages, key));
    const extraKeys = localeKeys.filter((key) => !Object.prototype.hasOwnProperty.call(baseMessages, key));
    const syncedMessages = buildSyncedMessages(baseMessages, localeMessages);
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

    summary.push({
      locale,
      created: false,
      added: missingKeys.length,
      extras: extraKeys.length,
      changed,
    });
  }

  console.log(`Locale sync ${isDryRun ? "dry run" : "write"} complete.`);
  for (const item of summary) {
    if (item.created) {
      console.log(`  ${item.locale}: missing messages.json${isDryRun ? " (would create)" : " (created)"} with ${item.added} key(s)`);
      continue;
    }

    console.log(
      `  ${item.locale}: missing ${item.added}, extra ${item.extras}, changed ${item.changed ? "yes" : "no"}`
    );
  }

  if (isDryRun && hasDiff) {
    console.error("Locale files are out of sync. Run npm run i18n:sync.");
  }
  if (hasExtraKeyIssue) {
    console.error("Extra locale keys detected. Re-run sync with --prune-extras to remove them.");
  }

  if ((isDryRun && hasDiff) || hasExtraKeyIssue) {
    process.exit(1);
  }
}

main();
