"use strict";

console.log("languages.js is running")

import "./i18n.js"
import { allLanguagesNames, otherConfigs, codeToLanguageNameInEnglish } from "../core/languages/names.js"

const twpLang = (function () {
  /**
   * Ideally we would use the "iso-639-1" npm package.
   * ISO 639-1 is a language code standard defined by the International Organization for Standardization (ISO),
   * using two-letter codes for languages. The iso-639-1 npm package provides a simple interface for
   * language code ↔ name mapping.
   */
  // allLanguagesNames — moved to src/core/languages/names.js (plan 59 M3-7);
  // imported at the top of this file (the IIFE closes over the import).

  const twpLang = {};

  twpLang.SupportedLanguages = {
    google: [
      "af",
      "sq",
      "am",
      "ar",
      "hy",
      "as",
      "ay",
      "az",
      "bm",
      "eu",
      "be",
      "bn",
      "bho",
      "bs",
      "bg",
      "ca",
      "ceb",
      "ny",
      "zh-CN",
      "zh-TW",
      "co",
      "hr",
      "cs",
      "da",
      "dv",
      "doi",
      "nl",
      "en",
      "eo",
      "et",
      "ee",
      "tl",
      "fi",
      "fr",
      "fy",
      "gl",
      "ka",
      "de",
      "el",
      "gn",
      "gu",
      "ht",
      "ha",
      "haw",
      "he",
      "hi",
      "hmn",
      "hu",
      "is",
      "ig",
      "ilo",
      "id",
      "ga",
      "it",
      "ja",
      "jv",
      "kn",
      "kk",
      "km",
      "rw",
      "gom",
      "ko",
      "kri",
      "ku",
      "ckb",
      "ky",
      "lo",
      "la",
      "lv",
      "ln",
      "lt",
      "lg",
      "lb",
      "mk",
      "mai",
      "mg",
      "ms",
      "ml",
      "mt",
      "mi",
      "mr",
      "mni-Mtei",
      "lus",
      "mn",
      "my",
      "ne",
      "no",
      "or",
      "om",
      "ps",
      "fa",
      "pl",
      "pt",
      "pa",
      "qu",
      "ro",
      "ru",
      "sm",
      "sa",
      "gd",
      "nso",
      "sr",
      "st",
      "sn",
      "sd",
      "si",
      "sk",
      "sl",
      "so",
      "es",
      "su",
      "sw",
      "sv",
      "tg",
      "ta",
      "tt",
      "te",
      "th",
      "ti",
      "ts",
      "tr",
      "tk",
      "ak",
      "uk",
      "ur",
      "ug",
      "uz",
      "vi",
      "cy",
      "xh",
      "yi",
      "yo",
      "zu",
    ],
    yandex: [
      "af",
      "sq",
      "am",
      "ar",
      "hy",
      "az",
      "ba",
      "eu",
      "be",
      "bn",
      "bs",
      "bg",
      "my",
      "ca",
      "ceb",
      "zh-CN", // zh
      "cv",
      "hr",
      "cs",
      "da",
      "nl",
      "en",
      "eo",
      "et",
      "fi",
      "fr",
      "gl",
      "ka",
      "de",
      "el",
      "gu",
      "ht",
      "he",
      "mrj",
      "hi",
      "hu",
      "is",
      "id",
      "ga",
      "it",
      "ja",
      "jv",
      "kn",
      "kk",
      "kazlat",
      "km",
      "ko",
      "ky",
      "lo",
      "la",
      "lv",
      "lt",
      "lb",
      "mk",
      "mg",
      "ms",
      "ml",
      "mt",
      "mi",
      "mr",
      "mhr",
      "mn",
      "ne",
      "no",
      "pap",
      "fa",
      "pl",
      "pt",
      "pa",
      "ro",
      "ru",
      "gd",
      "sr",
      "si",
      "sk",
      "sl",
      "es",
      "su",
      "sw",
      "sv",
      "tl",
      "tg",
      "ta",
      "tt",
      "te",
      "th",
      "tr",
      "udm",
      "uk",
      "ur",
      "uz",
      "uzbcyr",
      "vi",
      "cy",
      "xh",
      "sah",
      "yi",
      "zu",
    ],
    bing: [
      "af",
      "sq",
      "am",
      "ar",
      "hy",
      "as",
      "az",
      "bn",
      "ba",
      "eu",
      "bs",
      "bg",
      "yue",
      "ca",
      "lzh",
      "zh-CN",
      "zh-TW",
      "hr",
      "cs",
      "da",
      "prs",
      "dv",
      "nl",
      "en",
      "et",
      "fo",
      "fj",
      "tl",
      "fi",
      "fr",
      "fr-CA",
      "gl",
      "ka",
      "de",
      "el",
      "gu",
      "ht",
      "he",
      "hi",
      "hmn",
      "hu",
      "is",
      "id",
      "ikt",
      "iu",
      "iu-Latn",
      "ga",
      "it",
      "ja",
      "kn",
      "kk",
      "km",
      "tlh-Latn",
      "ko",
      "ku",
      "ckb",
      "ky",
      "lo",
      "lv",
      "lt",
      "mk",
      "mg",
      "ms",
      "ml",
      "mt",
      "mi",
      "mr",
      "mn",
      "mn-Mong",
      "my",
      "ne",
      "no",
      "or",
      "ps",
      "fa",
      "pl",
      "pt",
      "pt-PT",
      "pa",
      "otq",
      "ro",
      "ru",
      "sm",
      "sr",
      "sr-Latn",
      "sk",
      "sl",
      "so",
      "es",
      "sw",
      "sv",
      "ty",
      "ta",
      "tt",
      "te",
      "th",
      "bo",
      "ti",
      "to",
      "tr",
      "tk",
      "uk",
      "hsb",
      "ur",
      "ug",
      "uz",
      "vi",
      "cy",
      "yua",
      "zu",
    ],
    deepl: [
      "bg",
      "zh-CN", // zh
      "cs",
      "da",
      "nl",
      "en", // en-US
      "en-US",
      "en-GB",
      "et",
      "fi",
      "fr",
      "de",
      "el",
      "hu",
      "id",
      "it",
      "ja",
      "lv",
      "lt",
      "pl",
      "pt", // pt-BR
      "pt-PT",
      "pt-BR",
      "ro",
      "ru",
      "sk",
      "sl",
      "es",
      "sv",
      "tr",
      "uk",
    ],
    microsoft: [
      "af",
      "sq",
      "am",
      "ar",
      "hy",
      "as",
      "az",
      "bn",
      "ba",
      "eu",
      "bs",
      "bg",
      "yue",
      "ca",
      "zh-CN",
      "zh-TW",
      "hr",
      "cs",
      "da",
      "prs",
      "dv",
      "nl",
      "en",
      "et",
      "fo",
      "fj",
      "tl",
      "fi",
      "fr",
      "fr-CA",
      "gl",
      "ka",
      "de",
      "el",
      "gu",
      "ht",
      "he",
      "hi",
      "hmn",
      "hu",
      "is",
      "id",
      "ikt",
      "iu",
      "iu-Latn",
      "ga",
      "it",
      "ja",
      "kn",
      "kk",
      "km",
      "ko",
      "ku",
      "ckb",
      "ky",
      "lo",
      "lv",
      "lt",
      "mk",
      "mg",
      "ms",
      "ml",
      "mt",
      "mi",
      "mr",
      "mn",
      "my",
      "ne",
      "no",
      "or",
      "ps",
      "fa",
      "pl",
      "pt",
      "pt-PT",
      "pa",
      "ro",
      "ru",
      "sm",
      "sr",
      "sr-Latn",
      "sk",
      "sl",
      "so",
      "es",
      "sw",
      "sv",
      "ty",
      "ta",
      "tt",
      "te",
      "th",
      "bo",
      "ti",
      "to",
      "tr",
      "tk",
      "uk",
      "ur",
      "ug",
      "uz",
      "vi",
      "cy",
      "zu",
    ],
  };

  twpLang.UILanguages = Object.keys(allLanguagesNames);
  twpLang.TargetLanguages = Object.keys(allLanguagesNames["en"]);

  /**
   * get the list of localized languages for the current browser language
   * @returns {string[]} languageList
   */
  twpLang.getLanguageList = function () {
    let uiLanguage = chrome.i18n.getUILanguage();
    uiLanguage = twpLang.fixUILanguageCode(uiLanguage) || "en";
    return allLanguagesNames[uiLanguage];
  };

  /** @type {Map<string, string>} */
  const alternatives = new Map();
  const pageTranslationServices = ["google", "yandex", "microsoft"];
  /**
   * gets an alternate translation service if the selected translation service does not support the current target language.
   * @param {string} lang
   * @param {string} serviceName
   * @param {boolean} forPageTranslation
   * @returns {string} alternativeServiceName
   */
  twpLang.getAlternativeService = function getAlternativeService(
    lang,
    serviceName,
    forPageTranslation = false
  ) {
    lang = twpLang.fixTLanguageCode(lang);
    if (!twpLang.SupportedLanguages[serviceName])
      return pageTranslationServices[0];
    if (
      forPageTranslation &&
      pageTranslationServices.indexOf(serviceName) === -1
    )
      serviceName = pageTranslationServices[0];
    if (twpLang.SupportedLanguages[serviceName].indexOf(lang) !== -1)
      return serviceName;
    for (const sn in twpLang.SupportedLanguages) {
      if (sn === serviceName) continue;
      if (forPageTranslation && pageTranslationServices.indexOf(sn) === -1)
        continue;
      const langs = twpLang.SupportedLanguages[sn];
      if (langs.indexOf(lang) !== -1) {
        alternatives.set(lang, sn);
        return sn;
      }
    }
    return pageTranslationServices[0];
  };

  /**
   * convert langCode to languageName
   * @example
   * twpLang.codeToLanguage("de")
   * // returns "German"
   * twpLang.codeToLanguage("und")
   * // returns "Unknown" -- chrome.i18n.getMessage("msgUnknownLanguage")
   * @param {string} langCode
   * @returns {string} languageName
   */
  twpLang.codeToLanguage = function (langCode) {
    if (langCode === "und") {
      return chrome.i18n.getMessage("msgUnknownLanguage");
    }

    const languageList = twpLang.getLanguageList();
    langCode = twpLang.fixTLanguageCode(langCode);

    return langCode ? languageList[langCode] : "";
  };

  twpLang.codeToLanguageNameInEnglish = codeToLanguageNameInEnglish;


  /**
   * fix the UI language code
   * @param {string} langCode
   * @returns {string} langCode
   */
  twpLang.fixUILanguageCode = function (langCode) {
    if (typeof langCode !== "string") return;

    function getReplacer(langCode) {
      switch (langCode) {
        case "pt":
          return "pt-BR";
        case "zh":
          return "zh-CN";
        default:
          return;
      }
    }

    if (twpLang.UILanguages.indexOf(langCode) === -1) {
      if (langCode.indexOf("-") !== -1) {
        langCode = langCode.split("-")[0];
        if (twpLang.UILanguages.indexOf(langCode) === -1) {
          return getReplacer(langCode);
        }
      } else {
        return getReplacer(langCode);
      }
    }

    return langCode;
  };

  /**
   * fix the target language code
   * @param {string} langCode
   * @returns {string} langCode
   */
  twpLang.fixTLanguageCode = function (langCode) {
    if (typeof langCode !== "string") return;

    if (langCode === "zh") {
      return "zh-CN";
    } else if (langCode === "zh-Hant") {
      return "zh-TW";
    } else if (langCode === "iw") {
      return "he";
    } else if (langCode === "jw") {
      return "jv";
    }

    if (twpLang.TargetLanguages.indexOf(langCode) === -1) {
      if (langCode.indexOf("-") !== -1) {
        langCode = langCode.split("-")[0];
        if (twpLang.TargetLanguages.indexOf(langCode) === -1) {
          return;
        }
      } else {
        return;
      }
    }

    return langCode;
  };

  /**
   * check if langCode is RTL
   * @example
   * twpLang.isRtlLanguage("ckb")
   * // returns true
   * twpLang.isRtlLanguage("en")
   * // returns false
   * @param {string} langCode
   * @returns {boolean} isRTL
   */
  twpLang.isRtlLanguage = function (langCode) {
    const rtl_langs = [
      "am",
      "ar",
      "ckb",
      "dv",
      "fa",
      "ha",
      "he",
      "ku",
      "ps",
      "ur",
      "yi",
    ];
    return rtl_langs.indexOf(langCode) !== -1;
  };

  /**
   * The following configuration is adapted from openai-translator, primarily using phoneticNotation
   */
  twpLang.otherConfigs = otherConfigs;

  return twpLang;
})();

export default twpLang