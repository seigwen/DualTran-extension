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

      it("contains every en key (locale ⊇ en — new keys must be synced, plan 35 hardening)", () => {
        // 硬化（plan 35）：新键加入 en 后必须经 `npm run i18n:sync` 填齐全 38 语言。
        // 缺键 = 该语言下相关 UI 回退失败/行为不一致；本格防「新键漏 sync」。
        const missingKeys = enKeys.filter(
          (k) => !Object.prototype.hasOwnProperty.call(messages, k)
        );
        expect(
          missingKeys,
          `Locale ${locale} is missing en keys: ${missingKeys.join(", ")}`
        ).toEqual([]);
      });
    });
  }
});

describe("context menu translate labels (Google/AI)", () => {
  // Guard for the page context menu's two items, which now label themselves
  // through dedicated keys (msgTranslateWithGoogle / msgTranslateWithAi), each
  // carrying the $LANGUAGE_NAME$ placeholder. A translation must never drop
  // the placeholder (the label silently loses the language name), drop or
  // break the $1 placeholder mapping (chrome.i18n stops substituting), or
  // render the two labels identically (users cannot tell Google from AI).
  const MENU_LABEL_KEYS = ["msgTranslateWithGoogle", "msgTranslateWithAi"];
  const locales = readdirSync(LOCALES_DIR).filter((entry) =>
    existsSync(join(LOCALES_DIR, entry, "messages.json"))
  );
  const enMessages = readMessages("en");

  it("en defines both keys with the language-name placeholder and the engine name", () => {
    expect(Object.keys(enMessages)).toEqual(expect.arrayContaining(MENU_LABEL_KEYS));
    expect(enMessages.msgTranslateWithGoogle.message).toContain("$LANGUAGE_NAME$");
    expect(enMessages.msgTranslateWithGoogle.message).toContain("Google");
    expect(enMessages.msgTranslateWithAi.message).toContain("$LANGUAGE_NAME$");
    expect(enMessages.msgTranslateWithAi.message).toContain("AI");
  });

  it("every locale keeps the $LANGUAGE_NAME$ placeholder and its $1 mapping in both keys", () => {
    const broken = [];
    for (const locale of locales) {
      const messages = readMessages(locale);
      for (const key of MENU_LABEL_KEYS) {
        const entry = messages[key];
        const keepsPlaceholder =
          typeof entry?.message === "string" &&
          entry.message.includes("$LANGUAGE_NAME$") &&
          entry.placeholders?.LANGUAGE_NAME?.content === "$1";
        if (!keepsPlaceholder) {
          broken.push(`${locale}:${key}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("no locale renders the Google and AI labels identically", () => {
    const identical = locales.filter((locale) => {
      const messages = readMessages(locale);
      return (
        messages.msgTranslateWithGoogle?.message ===
        messages.msgTranslateWithAi?.message
      );
    });
    expect(identical).toEqual([]);
  });
});
