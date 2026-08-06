import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { chromeState } = vi.hoisted(() => ({
  chromeState: {
    getMessageMock: vi.fn((key) =>
      key === "msgUnknownLanguage" ? "Unknown language" : key
    ),
    getUILanguageMock: vi.fn(() => "en"),
  },
}));

vi.mock("../../src/lib/i18n.js", () => ({}));

function installChromeMock() {
  globalThis.chrome = {
    i18n: {
      getMessage: chromeState.getMessageMock,
      getUILanguage: chromeState.getUILanguageMock,
      translateDocument: vi.fn(),
    },
    tabs: undefined,
  };
}

async function loadLanguages() {
  const module = await import("../../src/lib/languages.js");
  return module.default;
}

describe("twpLang", () => {
  let twpLang;

  beforeEach(async () => {
    vi.resetModules();
    chromeState.getMessageMock.mockReset().mockImplementation((key) =>
      key === "msgUnknownLanguage" ? "Unknown language" : key
    );
    chromeState.getUILanguageMock.mockReset().mockImplementation(() => "en");
    installChromeMock();
    twpLang = await loadLanguages();
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  describe("fixTLanguageCode", () => {
    it("returns undefined for non-string values", () => {
      expect(twpLang.fixTLanguageCode(null)).toBeUndefined();
      expect(twpLang.fixTLanguageCode(123)).toBeUndefined();
    });

    it("maps zh to zh-CN", () => {
      expect(twpLang.fixTLanguageCode("zh")).toBe("zh-CN");
    });

    it("maps zh-Hant to zh-TW", () => {
      expect(twpLang.fixTLanguageCode("zh-Hant")).toBe("zh-TW");
    });

    it("maps iw to he", () => {
      expect(twpLang.fixTLanguageCode("iw")).toBe("he");
    });

    it("maps jw to jv", () => {
      expect(twpLang.fixTLanguageCode("jw")).toBe("jv");
    });

    it("keeps supported language codes unchanged", () => {
      expect(twpLang.fixTLanguageCode("en")).toBe("en");
      expect(twpLang.fixTLanguageCode("mni-Mtei")).toBe("mni-Mtei");
    });

    it("strips supported region codes to their base language", () => {
      expect(twpLang.fixTLanguageCode("en-US")).toBe("en");
      expect(twpLang.fixTLanguageCode("pt-BR")).toBe("pt");
    });

    it("returns undefined for unknown region codes", () => {
      expect(twpLang.fixTLanguageCode("xx-YY")).toBeUndefined();
    });

    it("returns undefined for unknown language codes", () => {
      expect(twpLang.fixTLanguageCode("xx")).toBeUndefined();
    });
  });

  describe("fixUILanguageCode", () => {
    it("returns undefined for non-string values", () => {
      expect(twpLang.fixUILanguageCode(undefined)).toBeUndefined();
      expect(twpLang.fixUILanguageCode({})).toBeUndefined();
    });

    it("maps pt to pt-BR", () => {
      expect(twpLang.fixUILanguageCode("pt")).toBe("pt-BR");
    });

    it("maps zh to zh-CN", () => {
      expect(twpLang.fixUILanguageCode("zh")).toBe("zh-CN");
    });

    it("keeps supported UI language codes unchanged", () => {
      expect(twpLang.fixUILanguageCode("en")).toBe("en");
      expect(twpLang.fixUILanguageCode("zh-TW")).toBe("zh-TW");
    });

    it("strips region codes for supported base UI languages", () => {
      expect(twpLang.fixUILanguageCode("en-US")).toBe("en");
      expect(twpLang.fixUILanguageCode("fr-CA")).toBe("fr");
    });

    it("returns undefined for unknown UI language codes", () => {
      expect(twpLang.fixUILanguageCode("xx")).toBeUndefined();
      expect(twpLang.fixUILanguageCode("xx-YY")).toBeUndefined();
    });
  });

  describe("getLanguageList", () => {
    it("returns the English language list by default", () => {
      const languageList = twpLang.getLanguageList();

      expect(chromeState.getUILanguageMock).toHaveBeenCalledOnce();
      expect(languageList.en).toBe("English");
      expect(languageList["zh-CN"]).toBe("Chinese (Simplified)");
    });

    it("uses the stripped browser UI language", () => {
      chromeState.getUILanguageMock.mockReturnValue("en-US");

      const languageList = twpLang.getLanguageList();

      expect(languageList.de).toBe("German");
    });

    it("uses pt-BR when browser UI language is pt", () => {
      chromeState.getUILanguageMock.mockReturnValue("pt");

      const languageList = twpLang.getLanguageList();

      expect(languageList.de).toBe("Alemão");
    });

    it("falls back to English when browser UI language is unknown", () => {
      chromeState.getUILanguageMock.mockReturnValue("xx-YY");

      const languageList = twpLang.getLanguageList();

      expect(languageList.de).toBe("German");
    });
  });

  describe("codeToLanguage", () => {
    it("returns the localized unknown-language message for und", () => {
      expect(twpLang.codeToLanguage("und")).toBe("Unknown language");
      expect(chromeState.getMessageMock).toHaveBeenCalledWith(
        "msgUnknownLanguage"
      );
    });

    it("returns a localized language name", () => {
      expect(twpLang.codeToLanguage("de")).toBe("German");
    });

    it("normalizes region codes before looking up names", () => {
      expect(twpLang.codeToLanguage("en-US")).toBe("English");
    });

    it("normalizes zh-Hant before looking up names", () => {
      expect(twpLang.codeToLanguage("zh-Hant")).toBe(
        "Chinese (Traditional)"
      );
    });

    it("uses the current UI language list for localized names", () => {
      chromeState.getUILanguageMock.mockReturnValue("pt");

      expect(twpLang.codeToLanguage("de")).toBe("Alemão");
    });

    it("returns an empty string for invalid language codes", () => {
      expect(twpLang.codeToLanguage("xx")).toBe("");
    });
  });

  describe("codeToLanguageNameInEnglish", () => {
    it("returns the English name for a standard code", () => {
      expect(twpLang.codeToLanguageNameInEnglish("de")).toBe("German");
    });

    it("returns the English name for a variant code", () => {
      expect(twpLang.codeToLanguageNameInEnglish("zh-CN")).toBe(
        "Chinese (Simplified)"
      );
    });

    it("returns undefined for unknown codes", () => {
      expect(twpLang.codeToLanguageNameInEnglish("xx")).toBeUndefined();
    });
  });

  describe("isRtlLanguage", () => {
    it("returns true for Arabic", () => {
      expect(twpLang.isRtlLanguage("ar")).toBe(true);
    });

    it("returns true for Hebrew", () => {
      expect(twpLang.isRtlLanguage("he")).toBe(true);
    });

    it("returns true for Sorani Kurdish", () => {
      expect(twpLang.isRtlLanguage("ckb")).toBe(true);
    });

    it("returns true for Urdu", () => {
      expect(twpLang.isRtlLanguage("ur")).toBe(true);
    });

    it("returns false for non-RTL languages", () => {
      expect(twpLang.isRtlLanguage("en")).toBe(false);
      expect(twpLang.isRtlLanguage("ba")).toBe(false);
    });
  });

  describe("getAlternativeService", () => {
    it("keeps the current service when it supports the language", () => {
      expect(twpLang.getAlternativeService("de", "deepl")).toBe("deepl");
    });

    it("falls back to google for an unknown service", () => {
      expect(twpLang.getAlternativeService("de", "unknown-service")).toBe(
        "google"
      );
    });

    it("finds another service that supports the language", () => {
      expect(twpLang.getAlternativeService("ba", "deepl")).toBe("yandex");
    });

    it("forces non-page services back to a page translation service", () => {
      expect(twpLang.getAlternativeService("de", "deepl", true)).toBe(
        "google"
      );
    });

    it("searches only page translation services for page translation", () => {
      expect(twpLang.getAlternativeService("ba", "deepl", true)).toBe(
        "yandex"
      );
    });

    it("falls back to google when the language cannot be normalized", () => {
      expect(twpLang.getAlternativeService("xx", "bing")).toBe("google");
    });
  });

  describe("language collections", () => {
    it("exports target languages with common entries", () => {
      expect(twpLang.TargetLanguages).toContain("en");
      expect(twpLang.TargetLanguages).toContain("zh-CN");
      expect(twpLang.TargetLanguages).toContain("mni-Mtei");
    });

    it("exports supported languages by service", () => {
      expect(twpLang.SupportedLanguages.google).toContain("en");
      expect(twpLang.SupportedLanguages.yandex).toContain("ba");
      expect(twpLang.SupportedLanguages.bing).toContain("yue");
      expect(twpLang.SupportedLanguages.deepl).toContain("en-US");
      expect(twpLang.SupportedLanguages.microsoft).toContain("fr-CA");
    });
  });
});
