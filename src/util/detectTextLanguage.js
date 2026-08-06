import twpLang from "../lib/languages.js"

/**
 * 检测文本的语言
 * @param {*} text 
 * @returns 
 */
export default async function detectTextLanguage(text) {
  if (!chrome.i18n.detectLanguage) return "und";

  return await new Promise((resolve) => {
    chrome.i18n.detectLanguage(text, (result) => {
      if (!result) return resolve({ lang: "und", isReliable: false });

      for (const langInfo of result.languages) {
        const langCode = twpLang.fixTLanguageCode(langInfo.language);
        if (langCode) {
          return resolve({ lang: langCode, isReliable: result.isReliable });
        }
      }

      return resolve({ lang: "und", isReliable: false });
    });
  });
}