import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, "../../src/_locales");

function readMessages(locale) {
  const filePath = join(LOCALES_DIR, locale, "messages.json");
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

describe("i18n completeness", () => {
  const locales = readdirSync(LOCALES_DIR).filter((entry) =>
    existsSync(join(LOCALES_DIR, entry, "messages.json"))
  );

  it("has at least one locale", () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  it("includes the 'en' base locale", () => {
    expect(locales).toContain("en");
  });

  const enMessages = readMessages("en");
  const enKeys = Object.keys(enMessages).sort();

  it("base locale (en) has messages", () => {
    expect(enKeys.length).toBeGreaterThan(0);
  });

  it("every en message entry has a 'message' property", () => {
    const missing = enKeys.filter(
      (key) => typeof enMessages[key]?.message !== "string"
    );
    expect(missing).toEqual([]);
  });

  for (const locale of locales) {
    if (locale === "en") continue;

    describe(`locale: ${locale}`, () => {
      const messages = readMessages(locale);
      const keys = Object.keys(messages);

      it("has a valid messages.json (parseable)", () => {
        expect(messages).toBeDefined();
        expect(typeof messages).toBe("object");
      });

      it("does not have unexpected extra keys beyond known legacy ones", () => {
        const knownLegacyKeys = [
          "btnTryAgain",
          "btnOpenOnGoogleTranslate",
          "btnDonate",
          "btnNeverTranslate",
          "btnChangeLanguages",
        ];
        const extraKeys = keys.filter(
          (k) => !enMessages[k] && !knownLegacyKeys.includes(k)
        );
        expect(
          extraKeys,
          `Unexpected extra keys in ${locale}: ${extraKeys.join(", ")}`
        ).toEqual([]);
      });

      it("every entry has a 'message' property", () => {
        const broken = keys.filter(
          (k) => typeof messages[k]?.message !== "string"
        );
        expect(broken).toEqual([]);
      });
    });
  }
});
