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

describe("always-translate lists engine-explicit labels + AI lists (issue #145)", () => {
  // Guard for the always-translate family across popup and options: each
  // Google list label/value must now name its engine, and each new AI key
  // must exist in every locale carrying the AI engine name. A locale that
  // drops "Google"/"AI" silently re-creates the engine-ambiguity bug the
  // rename exists to fix.
  const GOOGLE_PAIRS = [
    ["btnAlwaysTranslateThisLanguage", "btnAlwaysTranslateThisLanguageWithAi"],
    ["btnAlwaysTranslate", "btnAlwaysTranslateWithAi"],
    ["optionsAlwaysTranslate", "optionsAlwaysTranslateWithAi"],
    ["lblAlwaysTranslateSites", "lblAlwaysTranslateSitesWithAi"],
  ];
  const locales = readdirSync(LOCALES_DIR).filter((entry) =>
    existsSync(join(LOCALES_DIR, entry, "messages.json"))
  );
  const enMessages = readMessages("en");

  it("en defines all four AI keys, and the Google-side values name Google or the engine pair", () => {
    for (const [googleKey, aiKey] of GOOGLE_PAIRS) {
      expect(enMessages[aiKey]?.message).toContain("AI");
      // The Google-side label must be distinguishable from its AI twin.
      expect(enMessages[googleKey]?.message).not.toBe(enMessages[aiKey]?.message);
      expect(enMessages[googleKey]?.message.toLowerCase()).toContain("google");
    }
  });

  it("every locale defines all four AI keys with the engine name (locale ⊇ en)", () => {
    const broken = [];
    for (const locale of locales) {
      const messages = readMessages(locale);
      for (const [, aiKey] of GOOGLE_PAIRS) {
        const value = messages[aiKey]?.message;
        if (typeof value !== "string" || !value.includes("AI")) {
          broken.push(`${locale}:${aiKey}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("no locale renders a Google label identical to its AI twin", () => {
    const identical = [];
    for (const locale of locales) {
      const messages = readMessages(locale);
      for (const [googleKey, aiKey] of GOOGLE_PAIRS) {
        if (
          messages[googleKey]?.message === messages[aiKey]?.message
        ) {
          identical.push(`${locale}:${googleKey}`);
        }
      }
    }
    expect(identical).toEqual([]);
  });
});

describe("popup always-translate language rows carry the language-name placeholder (issue #149)", () => {
  // The popup's two always-translate language rows must show WHICH language
  // (e.g. "Always translate this language with Google - English"). They reach
  // the name through the $LANGUAGE_NAME$ placeholder at runtime, exactly like
  // the hover row. A locale that drops the placeholder (or its $1 mapping)
  // silently loses the language name — the very defect this guard exists for.
  const LANGUAGE_ROW_KEYS = [
    "btnAlwaysTranslateThisLanguage",
    "btnAlwaysTranslateThisLanguageWithAi",
  ];
  const locales = readdirSync(LOCALES_DIR).filter((entry) =>
    existsSync(join(LOCALES_DIR, entry, "messages.json"))
  );
  const enMessages = readMessages("en");

  it("en defines both keys with the placeholder and keeps the engine-explicit wording", () => {
    for (const key of LANGUAGE_ROW_KEYS) {
      const value = enMessages[key]?.message;
      expect(typeof value).toBe("string");
      expect(value).toContain("$LANGUAGE_NAME$");
      expect(value.toLowerCase()).toContain("always translate");
    }
    expect(enMessages.btnAlwaysTranslateThisLanguage.message).toContain("Google");
    expect(enMessages.btnAlwaysTranslateThisLanguageWithAi.message).toContain("AI");
  });

  it("no locale has a language row that omits the language-name segment entirely", () => {
    // Sanity on shape: the value must END with the placeholder (the dash + name
    // is appended there) — a translation that moved or merged the placeholder
    // into unrelated text would render the name in the wrong place.
    const wrongShape = [];
    for (const locale of locales) {
      const messages = readMessages(locale);
      for (const key of LANGUAGE_ROW_KEYS) {
        const value = messages[key]?.message ?? "";
        if (!/\$LANGUAGE_NAME\$\s*$/.test(value.trimEnd()) && !value.trim().endsWith("$LANGUAGE_NAME$")) {
          wrongShape.push(`${locale}:${key}=${value.slice(-40)}`);
        }
      }
    }
    expect(wrongShape).toEqual([]);
  });
});

describe("AI options panel provider labels carry the $PROVIDER_NAME$ placeholder (#155)", () => {
  // Guard for the options page's provider-panel labels, which append the
  // provider's display name at runtime (e.g. "OpenAI API Key" / "OpenAI 模型").
  // A locale that drops the placeholder (or its $1 mapping) silently loses the
  // provider name — the label degrades to a bare "API Key" in that language.
  const PROVIDER_LABEL_KEYS = [
    "lblProviderApiKey",
    "lblProviderApiEndpoint",
    "lblProviderModel",
    "lblProviderReasoningDepth",
    "lblHowToGetProviderApiKey",
    "lblProviderDocumentation",
  ];
  const locales = readdirSync(LOCALES_DIR).filter((entry) =>
    existsSync(join(LOCALES_DIR, entry, "messages.json"))
  );
  const enMessages = readMessages("en");

  it("en defines all six keys with the provider-name placeholder and its $1 mapping", () => {
    for (const key of PROVIDER_LABEL_KEYS) {
      const entry = enMessages[key];
      expect(typeof entry?.message, `en is missing ${key}`).toBe("string");
      expect(entry.message).toContain("$PROVIDER_NAME$");
      expect(entry.placeholders?.PROVIDER_NAME?.content).toBe("$1");
    }
  });
});

// ── spec 47 P3-a: placeholder integrity, full enumeration ──────────────────
// Supersedes the former hand-listed preservation cells ($LANGUAGE_NAME$ /
// $PROVIDER_NAME$ families, retired above). Every en key containing a $TOKEN$
// placeholder must keep the same token SET (order-free — tokens substitute by
// NAME, a translation may reorder them) and a mapping for each token in every
// locale. Mapping style MIRRORS en: $-referencing keys must keep the exact same
// $N reference; keys whose en mapping is a literal (legacy style, e.g.
// SHORTCUT_KEY -> "[Ctrl]", HTML_TAG_NAME -> "<PRE>") need a non-empty literal.

const PLACEHOLDER_RE = /\$([A-Z0-9_]+)\$/g;

function placeholderTokens(message) {
  return [...String(message).matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

/**
 * Pure audit: token-set equality (by name) + mapping completeness for every
 * placeholder-bearing en key in every locale. Returns human-readable breaks.
 */
function auditPlaceholders(en, messagesByLocale) {
  const breaks = [];
  const keys = Object.keys(en).filter((k) => placeholderTokens(en[k].message).length > 0);
  for (const [locale, messages] of Object.entries(messagesByLocale)) {
    for (const key of keys) {
      const expected = placeholderTokens(en[key].message);
      const entry = messages[key];
      if (!entry || typeof entry.message !== "string") {
        breaks.push(`${locale}:${key}:missing`);
        continue;
      }
      const actual = placeholderTokens(entry.message);
      const sameSet =
        actual.length === expected.length &&
        [...actual].sort().join("|") === [...expected].sort().join("|");
      if (!sameSet) {
        breaks.push(`${locale}:${key}:tokens [${actual}] != [${expected}]`);
        continue;
      }
      for (const token of expected) {
        const content = entry.placeholders?.[token]?.content;
        const enContent = en[key].placeholders?.[token]?.content;
        if (typeof content !== "string" || content.length === 0) {
          breaks.push(`${locale}:${key}:${token} mapping content=missing`);
        } else if (/^\$\d+$/.test(String(enContent)) && content !== enContent) {
          breaks.push(`${locale}:${key}:${token} mapping content=${content} expected ${enContent}`);
        }
      }
    }
  }
  return breaks;
}

describe("placeholder integrity (full enumeration, spec 47 P3-a)", () => {
  const en = readMessages("en");
  const locales = readdirSync(LOCALES_DIR).filter((entry) =>
    existsSync(join(LOCALES_DIR, entry, "messages.json"))
  );

  it("en carries placeholder-bearing keys spanning the known families (sanity)", () => {
    const keys = Object.keys(en).filter((k) => placeholderTokens(en[k].message).length > 0);
    expect(keys.length).toBeGreaterThan(0);
    expect(en.lblProviderModel.message).toContain("$PROVIDER_NAME$");
    expect(en.msgTranslateWithGoogle.message).toContain("$LANGUAGE_NAME$");
  });

  it("every locale keeps every placeholder token set + mapping for every placeholder key", () => {
    const messagesByLocale = {};
    for (const locale of locales) messagesByLocale[locale] = readMessages(locale);
    expect(auditPlaceholders(en, messagesByLocale)).toEqual([]);
  });

  it("self-check: dropped token / dropped mapping / wrong $N reference are all flagged (negative calibration)", () => {
    const enFixture = { k: { message: "Go $LANGUAGE_NAME$ now", placeholders: { LANGUAGE_NAME: { content: "$1" } } } };
    const droppedToken = { loc: { k: { message: "Go now", placeholders: { LANGUAGE_NAME: { content: "$1" } } } } };
    const droppedMapping = { loc: { k: { message: "Go $LANGUAGE_NAME$ now" } } };
    const wrongRef = { loc: { k: { message: "Go $LANGUAGE_NAME$ now", placeholders: { LANGUAGE_NAME: { content: "$2" } } } } };
    expect(auditPlaceholders(enFixture, droppedToken)).toEqual(["loc:k:tokens [] != [LANGUAGE_NAME]"]);
    expect(auditPlaceholders(enFixture, droppedMapping)).toEqual(["loc:k:LANGUAGE_NAME mapping content=missing"]);
    expect(auditPlaceholders(enFixture, wrongRef)).toEqual(["loc:k:LANGUAGE_NAME mapping content=$2 expected $1"]);
  });

  it("self-check: legacy literal-content style is accepted when en uses it, rejected when en is positional", () => {
    const literalEn = { k: { message: "Press $SHORTCUT_KEY$ twice", placeholders: { SHORTCUT_KEY: { content: "[Ctrl]" } } } };
    const literalLoc = { loc: { k: { message: "Appuyez $SHORTCUT_KEY$ deux fois", placeholders: { SHORTCUT_KEY: { content: "[Ctrl]" } } } } };
    expect(auditPlaceholders(literalEn, literalLoc)).toEqual([]); // legacy style mirrors en — fine
    const positionalEn = { k: { message: "Press $KEY$ twice", placeholders: { KEY: { content: "$1" } } } };
    const locMapUnderDifferentName = {
      loc: { k: { message: "Appuyez $KEY$ deux fois", placeholders: { SHORTCUT_KEY: { content: "[Ctrl]" } } } },
    };
    expect(auditPlaceholders(positionalEn, locMapUnderDifferentName)).toEqual([
      "loc:k:KEY mapping content=missing",
    ]); // en is positional — a locale that kept only a stray literal mapping is flagged
  });
});
