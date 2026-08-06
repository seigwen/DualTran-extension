/*
  Verify locale integrity and managed translation coverage.
  Usage:
    node scripts/check-i18n-equals-en.js --strict
    node scripts/check-i18n-equals-en.js someKey otherKey
*/

const fs = require("fs");
const path = require("path");

const {
  TRANSLATION_UPDATES,
  MANAGED_KEYS,
  BANNED_HARDCODED_STRINGS,
} = require("./i18n-managed-translations.js");

const ROOT = path.resolve(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "src", "_locales");
const EN_FILE = path.join(LOCALES_DIR, "en", "messages.json");
const SOURCE_DIR = path.join(ROOT, "src");

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const keys = args.filter((arg) => !arg.startsWith("--"));

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getLocaleDirs() {
  return fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function collectSourceFiles(dirPath, files = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_locales") {
        continue;
      }
      collectSourceFiles(fullPath, files);
      continue;
    }

    if (/\.(js|html)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function runLegacyCompare(compareKeys) {
  if (!compareKeys.length) {
    console.log("Provide at least one key. Example: node scripts/check-i18n-equals-en.js lblReset");
    process.exit(0);
  }

  const englishMessages = readJSON(EN_FILE);
  const locales = getLocaleDirs().filter((locale) => locale !== "en");

  for (const locale of locales) {
    const localeMessages = readJSON(path.join(LOCALES_DIR, locale, "messages.json"));
    const status = compareKeys
      .map((key) => {
        const englishMessage = (englishMessages[key] || {}).message;
        const localeMessage = (localeMessages[key] || {}).message;
        return `${key}=${englishMessage === localeMessage ? "SAME" : "DIFF"}`;
      })
      .join(" ");
    console.log(`${locale}: ${status}`);
  }
}

function main() {
  if (keys.length > 0) {
    runLegacyCompare(keys);
    return;
  }

  const strictMode = flags.has("--strict") || flags.size === 0;
  const englishMessages = readJSON(EN_FILE);
  const englishKeys = Object.keys(englishMessages);
  const locales = getLocaleDirs();
  const errors = [];

  for (const locale of locales) {
    const localeFile = path.join(LOCALES_DIR, locale, "messages.json");
    if (!fs.existsSync(localeFile)) {
      errors.push(`${locale}: missing messages.json`);
      continue;
    }

    const localeMessages = readJSON(localeFile);
    const localeKeys = Object.keys(localeMessages);
    const missingKeys = englishKeys.filter((key) => !Object.prototype.hasOwnProperty.call(localeMessages, key));
    const extraKeys = localeKeys.filter((key) => !Object.prototype.hasOwnProperty.call(englishMessages, key));

    if (missingKeys.length > 0) {
      errors.push(`${locale}: missing keys ${missingKeys.join(", ")}`);
    }
    if (extraKeys.length > 0) {
      errors.push(`${locale}: extra keys ${extraKeys.join(", ")}`);
    }

    for (const key of MANAGED_KEYS) {
      const expectedValue = TRANSLATION_UPDATES[key][locale];
      const actualValue = localeMessages[key];
      if (!expectedValue) {
        errors.push(`${locale}: managed key ${key} has no expected translation`);
        continue;
      }
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        errors.push(`${locale}: managed key ${key} does not match expected translation`);
      }

      if (
        strictMode &&
        locale !== "en" &&
        actualValue &&
        englishMessages[key] &&
        actualValue.message === englishMessages[key].message
      ) {
        errors.push(`${locale}: managed key ${key} is still identical to English`);
      }
    }
  }

  const sourceFiles = collectSourceFiles(SOURCE_DIR);
  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const bannedString of BANNED_HARDCODED_STRINGS) {
      if (content.includes(bannedString)) {
        errors.push(`hardcoded i18n string found in ${path.relative(ROOT, filePath)}: ${bannedString}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("i18n verification failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log("i18n verification passed.");
}

main();
