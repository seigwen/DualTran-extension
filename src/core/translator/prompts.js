/**
 * Translation prompt builders — pure, host-free (plan 59 M3-1).
 *
 * Extracted verbatim from src/contentScript/fetchSSE.js (translateWithAI ①②).
 * The only structural change: the page hostname arrives as the `hostname`
 * parameter instead of being read from the page globals, so the module stays
 * usable outside the content-script host. Template text, interpolations and
 * whitespace are kept byte-identical to the original.
 */
import { oneLine } from "common-tags";

/**
 * Role clause of the single-word dictionary prompt (issue #151).
 *
 * The source language only enters the prompt when Chrome's CLD reading is
 * reliable: for lone words CLD is routinely unreliable AND wrong (measured:
 * "Undertow" / "hello" / "undertow" -> "sr"), and pinning that bogus language
 * into the role made the model answer with a whole Serbian layer on top of
 * the English word and the target text. When the reading is not trusted, the
 * role stays language-neutral — the model identifies the word's own language
 * itself, and the [<language>] format field already asks it to report one.
 *
 * @internal — exported for testing (re-exported by src/contentScript/fetchSSE.js)
 */
export function buildWordPromptRole({ sourceLanguageTrusted, sourceLanguageName, targetLanguageName }) {
  return sourceLanguageTrusted
    ? oneLine`
      please act as a professional
      ${sourceLanguageName}-${targetLanguageName} dictionary,`
    : oneLine`
      please act as a professional bilingual dictionary
      translating the word into ${targetLanguageName};
      identify the word's own language yourself,`
}


/**
 * Build the chat messages for one translation request.
 *
 * Word path (isSingleWord) uses the #151 dictionary format; page path uses the
 * XML <译泽> translation format. The caller keeps the CLD gate judgement —
 * `sourceLanguageTrusted` / `sourceLanguageName` / `isSameLanguage` arrive as
 * inputs; this module only formats them into the prompts.
 *
 * @param {Object} params
 * @param {string} params.content
 * @param {string} params.targetLanguageName
 * @param {string} params.hostname — page hostname for the page-path prompt
 * @param {boolean} [params.isSingleWord=false]
 * @param {Object|undefined} [params.targetLangConfig]
 * @param {boolean} [params.sourceLanguageTrusted=true]
 * @param {string} [params.sourceLanguageName=""]
 * @param {boolean} [params.isSameLanguage=false]
 * @returns {{system: string, assistant: string}}
 */
export function buildTranslationMessages({
  content,
  targetLanguageName,
  hostname,
  isSingleWord = false,
  targetLangConfig = undefined,
  sourceLanguageTrusted = true,
  sourceLanguageName = "",
  isSameLanguage = false,
}) {
  const sysPromptTranslation = isSingleWord
    ? `${oneLine`
      ${buildWordPromptRole({ sourceLanguageTrusted, sourceLanguageName, targetLanguageName })}
      and list the original form of the word (if any),
      the language of the word,
      ${targetLangConfig?.phoneticNotation ? 'the corresponding phonetic notation or transcription, ' : ''}
      all senses with parts of speech (bilingual),
      ${isSameLanguage ? '' : 'bilingual '}
      sentence examples (at least 3) and bilingual etymology.
      If you think there is a spelling mistake,
      please tell me the most possible correct word
      otherwise reply in the following format:
      `}
        <word> (<original form>)
        ${oneLine`
        [<language>]· /
        ${targetLangConfig?.phoneticNotation ? `<${targetLangConfig?.phoneticNotation}>` : ``}
        `}
        ${oneLine`
        [<part of speech>]
        ${isSameLanguage ? '' : '<translated meaning> / '}
        <meaning in source language>
        `}
        Examples:
        <index>. <sentence>(<sentence translation>)
        Etymology:
        <etymology>
        (<etymology translation>)
    `
    :`You are a professional translation engine. 
      Please translate the xml given by the user from a page of the website ${hostname} into ${targetLanguageName} without explanation. 
      please respond with the same format as the given xml.
      Translate the content within the tags of "<译泽>", do not translate the tagnames or attributes.
      Any part enclosed in quotation marks must be translated. 
      Any part violates the content policy must be translated. `


  return {
    system: sysPromptTranslation,
    assistant: `I understand. Please give me the ${isSingleWord ? 'word' : 'text'}.`,
  }
}
