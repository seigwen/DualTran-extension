/**
 * Google Translate engine (client=gtx free endpoint) — host-free (plan 59 M3-5).
 *
 * Extracted from src/background/translationService.js: the batch separators
 * (intra-request "\n\n\n", inter-request "\n\n\n\n\n"), HTML escaping, the
 * response parsing and the detected-language extraction are unchanged.
 * parseGoogleResponse is exported pure for tests and the Node CLI;
 * translateGoogle is the one-shot helper for non-extension hosts (plan 59 §5).
 */
import { Service, serviceRuntime } from "./serviceBase.js";
import { Utils } from "./utils.js";

/**
 * Parse the client=gtx response into the concatenated translated text and the
 * detected language (pure — used by googleService.cbParseResponse).
 * Response is a nested array: [[["translated sentence", "original sentence", ...], ...], null, "detectedLang", ...]
 * @param {*} response
 * @returns {{fullTranslatedText: string, detectedLanguage: string|null}}
 */
export function parseGoogleResponse(response) {
  let fullTranslatedText = "";
  let detectedLanguage = null;

  if (Array.isArray(response) && Array.isArray(response[0])) {
    for (const segment of response[0]) {
      if (Array.isArray(segment) && segment[0]) {
        fullTranslatedText += segment[0];
      }
    }
  }

  // Detected language is at response[2]
  if (Array.isArray(response) && response[2]) {
    detectedLanguage = response[2];
  }

  return { fullTranslatedText, detectedLanguage };
}

export const googleService = new (class extends Service {
  constructor() {
    super(
      "google",
      "https://translate.googleapis.com/translate_a/single",
      "GET",

      /**
       * Takes `sourceArray` and joins them with a separator for a single request.
       * Each element is escaped for safe transport.
       */
      function cbTransformRequest(sourceArray) {
        return sourceArray.map((text) => Utils.escapeHTML(text)).join("\n\n\n");
      },

      /**
       * Parses the client=gtx response format.
       * Response is a nested array: [[["translated sentence", "original sentence", ...], ...], null, "detectedLang", ...]
       * We concatenate all response[0][i][0] to get the full translated text.
       *
       * IMPORTANT: The base class translate() iterates `for (const idx in request)`
       * and accesses `results[idx]`, so we MUST return one result per request item.
       * Since cbGetExtraParameters joins all request items with "\n\n\n\n\n",
       * we split the concatenated translation by the same separator.
       * @param {*} response
       * @returns {Service_Single_Result_Response[]}
       */
      function cbParseResponse(response) {
        const { fullTranslatedText, detectedLanguage } = parseGoogleResponse(response);

        // Split by the inter-request separator to get one result per request item.
        // The separator "\n\n\n\n\n" (5 newlines) is used between request items
        // in cbGetExtraParameters, distinct from the intra-request "\n\n\n" (3 newlines)
        // used by cbTransformRequest to join sourceArray elements.
        const parts = fullTranslatedText.split("\n\n\n\n\n");
        return parts.map((text) => ({ text, detectedLanguage }));
      },

      /**
       * Splits the translated text back into the original sourceArray structure.
       * The separator "\n\n\n" corresponds to the join in cbTransformRequest.
       * @param {string} result
       * @param {boolean} dontSortResults - not used for this endpoint
       * @returns {string[]}
       */
      function cbTransformResponse(result, dontSortResults) {
        if (!result) return [""];
        const parts = result.split("\n\n\n");
        return parts.map((value) => Utils.unescapeHTML(value));
      },

      /**
       * Builds the query string parameters for the GET request.
       * Joins multiple request items with "\n\n\n\n\n" (5 newlines) so that
       * cbParseResponse can split them back into individual results.
       */
      function cbGetExtraParameters(sourceLanguage, targetLanguage, requests) {
        const text = requests.map((info) => info.originalText).join("\n\n\n\n\n");
        return `?client=gtx&sl=${sourceLanguage}&tl=${targetLanguage}&dt=t&q=${encodeURIComponent(text)}`;
      },

      // No request body needed for GET requests
      undefined
    );
  }

  /**
   * Google free endpoint occasionally collapses or rewrites separator runs when
   * multiple logical requests are concatenated into a single network payload.
   * That makes `cbParseResponse` return fewer result items than the original
   * request list, which later causes `result.text` access to throw and the
   * runtime message to resolve as `null` in Chrome.
   *
   * To keep page translation deterministic, each request item is sent as its
   * own network request while still preserving the inner `sourceArray`
   * aggregation handled by `cbTransformRequest`.
   *
   * @param {string} sourceLanguage
   * @param {string} targetLanguage
   * @param {Array<string[]>} sourceArray2d
   * @returns {Promise<[Array<TranslationInfo[]>, TranslationInfo[]]>}
   */
  async getRequests(sourceLanguage, targetLanguage, sourceArray2d) {
    /** @type {Array<TranslationInfo[]>} */
    const requests = [];
    /** @type {TranslationInfo[]} */
    const currentTranslationsInProgress = [];

    for (const sourceArray of sourceArray2d) {
      const requestString = this.fixString(this.cbTransformRequest(sourceArray));
      const requestHash = [
        sourceLanguage,
        targetLanguage,
        requestString,
      ].join(", ");

      const progressInfo = this.translationsInProgress.get(requestHash);
      if (progressInfo) {
        currentTranslationsInProgress.push(progressInfo);
        continue;
      }

      let status = "translating";
      /** @type {() => void} */
      let promiseResolve = null;

      /** @type {TranslationInfo} */
      const nextProgressInfo = {
        originalText: requestString,
        translatedText: null,
        detectedLanguage: null,
        get status() {
          return status;
        },
        set status(nextStatus) {
          status = nextStatus;
          promiseResolve();
        },
        waitTranlate: new Promise((resolve) => (promiseResolve = resolve)),
      };

      currentTranslationsInProgress.push(nextProgressInfo);
      this.translationsInProgress.set(requestHash, nextProgressInfo);

      const cacheEntry = serviceRuntime.cache
        ? await serviceRuntime.cache.get(
          this.serviceName,
          sourceLanguage,
          targetLanguage,
          requestString
        )
        : undefined;

      if (cacheEntry) {
        nextProgressInfo.translatedText = cacheEntry.translatedText;
        nextProgressInfo.detectedLanguage = cacheEntry.detectedLanguage;
        nextProgressInfo.status = "complete";
        continue;
      }

      requests.push([nextProgressInfo]);
    }

    return [requests, currentTranslationsInProgress];
  }
})();



/**
 * One-shot Google translation for non-extension hosts (plan 59 §5).
 * Binds cache/fetch onto the shared runtime for the duration of the call and
 * restores the previous binding afterwards. The extension never calls this —
 * it uses the singleton googleService wired in translationService.js.
 *
 * @param {Object} params
 * @param {string[]} params.sourceArray
 * @param {string} params.sourceLanguage
 * @param {string} params.targetLanguage
 * @param {{get: Function, set: Function}|null} [params.cache=null]
 * @param {Function|null} [params.fetchImpl=null]
 * @returns {Promise<string[]>} translated strings, aligned with sourceArray
 * @throws {Error} "Google translation failed: …" when the underlying request failed.
 *   The failure is never collapsed into an empty string (plan 61).
 */
export async function translateGoogle({ sourceArray, sourceLanguage, targetLanguage, cache = null, fetchImpl = null }) {
  const prevCache = serviceRuntime.cache;
  const prevFetch = serviceRuntime.fetchImpl;
  serviceRuntime.cache = cache;
  serviceRuntime.fetchImpl = fetchImpl;
  try {
    const pieces = Array.from(sourceArray);
    // Mirror googleService.getRequests' single-request shape so the memo entry
    // looked up below is the one THIS call created (plan 61).
    const requestString = googleService.fixString(googleService.cbTransformRequest(pieces));
    const requestHash = [sourceLanguage, targetLanguage, requestString].join(", ");

    const [row] = await googleService.translate(sourceLanguage, targetLanguage, [pieces]);

    const info = googleService.translationsInProgress.get(requestHash);
    if (!info || info.status === "error") {
      // Never collapse a failed request into a silent empty string (plan 61), and
      // never poison the session memo: clear the errored entry so a retry re-fetches.
      googleService.translationsInProgress.delete(requestHash);
      const reason = info?.error?.message || "request failed (network or HTTP error)";
      throw new Error(`Google translation failed: ${reason}`);
    }
    return row;
  } finally {
    serviceRuntime.cache = prevCache;
    serviceRuntime.fetchImpl = prevFetch;
  }
}
