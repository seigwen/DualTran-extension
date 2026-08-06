const fs = require("fs");
const path = require("path");

const { TRANSLATION_UPDATES, MANAGED_KEYS } = require("./i18n-managed-translations.js");

const ROOT = path.resolve(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "src", "_locales");

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function main() {
  const locales = getLocaleDirs();
  const missingTranslations = [];
  const summary = [];

  for (const key of MANAGED_KEYS) {
    const localeMap = TRANSLATION_UPDATES[key] || {};
    for (const locale of locales) {
      if (!localeMap[locale]) {
        missingTranslations.push(`${key}:${locale}`);
      }
    }
  }

  if (missingTranslations.length > 0) {
    console.error("Missing managed translations:");
    for (const item of missingTranslations) {
      console.error(`  - ${item}`);
    }
    process.exit(1);
  }

  for (const locale of locales) {
    const filePath = path.join(LOCALES_DIR, locale, "messages.json");
    const messages = readJSON(filePath);
    let updatedCount = 0;

    for (const key of MANAGED_KEYS) {
      const nextValue = deepClone(TRANSLATION_UPDATES[key][locale]);
      const previousValue = messages[key];
      if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
        messages[key] = nextValue;
        updatedCount += 1;
      }
    }

    if (updatedCount > 0) {
      writeJSON(filePath, messages);
    }

    summary.push({ locale, updatedCount });
  }

  console.log("Managed i18n translations applied.");
  for (const item of summary) {
    console.log(`  ${item.locale}: updated ${item.updatedCount} key(s)`);
  }
}

main();