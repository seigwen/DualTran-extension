/**
 * Background translation service
 */

"use strict";

console.log("translationService.js is running")

import twpLang from "../lib/languages.js"
import translationCache from "../background/translationCache.js"

const translationService = (function () {
  const translationService = {};

  // Avoid outputting the error message "Receiving end does not exist" in the Console.
  function checkedLastError() {
    if (chrome && chrome.runtime) {
      // Accessing lastError clears it without throwing
      // eslint-disable-next-line no-unused-expressions
      chrome.runtime.lastError;
    }
  }

  class Utils {
    /**
     * Replace the characters `& < > " '` with `&amp; &lt; &gt; &quot; &#39;`.
     * @param {string} unsafe
     * @returns {string} escapedString
     */
    static escapeHTML(unsafe) {
      return unsafe
        .replace(/\&/g, "&amp;")
        .replace(/\</g, "&lt;")
        .replace(/\>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/\'/g, "&#39;");
    }

    /**
     * Replace the characters `&amp; &lt; &gt; &quot; &#39;` with `& < > " '`.
     * @param {string} unsafe
     * @returns {string} unescapedString
     */
    static unescapeHTML(unsafe) {
      return unsafe
        .replace(/\&amp;/g, "&")
        .replace(/\&lt;/g, "<")
        .replace(/\&gt;/g, ">")
        .replace(/\&quot;/g, '"')
        .replace(/\&\#39;/g, "'");
    }
  }

  // GoogleHelper removed — the old client=te endpoint with TKK hash is no longer accessible.
  // Google Translate now uses the free client=gtx endpoint (GET, no hash required).

  class YandexHelper {
    /** @type {number} */
    static #lastRequestSidTime = null;
    /** @type {string} */
    static #translateSid = null;
    /** @type {boolean} */
    static #SIDNotFound = false;
    /** @type {Promise<void>} */
    static #findPromise = null;

    static get translateSid() {
      return YandexHelper.#translateSid;
    }

    /**
     * Find the SID of Yandex Translator. The SID value is used in translation requests.
     * @returns {Promise<void>}
     */
    static async findSID() {
      if (YandexHelper.#findPromise) return await YandexHelper.#findPromise;
      YandexHelper.#findPromise = new Promise((resolve) => {
        let updateYandexSid = false;
        if (YandexHelper.#lastRequestSidTime) {
          const date = new Date();
          if (YandexHelper.#translateSid) {
            date.setHours(date.getHours() - 12);
          } else if (YandexHelper.#SIDNotFound) {
            date.setMinutes(date.getMinutes() - 30);
          } else {
            date.setMinutes(date.getMinutes() - 2);
          }
          if (date.getTime() > YandexHelper.#lastRequestSidTime) {
            updateYandexSid = true;
          }
        } else {
          updateYandexSid = true;
        }

        if (updateYandexSid) {
          YandexHelper.#lastRequestSidTime = Date.now();

          const http = new XMLHttpRequest();
          http.open(
            "GET",
            "https://translate.yandex.net/website-widget/v1/widget.js?widgetId=ytWidget&pageLang=es&widgetTheme=light&autoMode=false"
          );
          http.send();
          http.onload = (e) => {
            const result = http.responseText.match(/sid\:\s\'[0-9a-f\.]+/);
            if (result && result[0] && result[0].length > 7) {
              YandexHelper.#translateSid = result[0].substring(6);
              YandexHelper.#SIDNotFound = false;
            } else {
              YandexHelper.#SIDNotFound = true;
            }
            resolve();
          };
          http.onerror =
            http.onabort =
            http.ontimeout =
            (e) => {
              console.error(e);
              resolve();
            };
        } else {
          resolve();
        }
      });

      YandexHelper.#findPromise.finally(() => {
        YandexHelper.#findPromise = null;
      });

      return await YandexHelper.#findPromise;
    }
  }

  class BingHelper {
    /** @type {number} */
    static #lastRequestSidTime = null;
    /** @type {string} */
    static #translateSid = null;
    /** @type {string} */
    static #translate_IID_IG = null;
    /** @type {boolean} */
    static #SIDNotFound = false;
    /** @type {Promise<void>} */
    static #sidPromise = null;

    static get translateSid() {
      return BingHelper.#translateSid;
    }

    static get translate_IID_IG() {
      return BingHelper.#translate_IID_IG;
    }
    /**
     * Find the SID (IID and IG) of Bing Translator. The SID value is used in translation requests.
     * @returns {Promise<void>}
     */
    static async findSID() {
      if (BingHelper.#sidPromise) return await BingHelper.#sidPromise;
      BingHelper.#sidPromise = new Promise((resolve) => {
        let updateYandexSid = false;
        if (BingHelper.#lastRequestSidTime) {
          const date = new Date();
          if (BingHelper.#translateSid) {
            date.setHours(date.getHours() - 12);
          } else if (BingHelper.#SIDNotFound) {
            date.setMinutes(date.getMinutes() - 30);
          } else {
            date.setMinutes(date.getMinutes() - 2);
          }
          if (date.getTime() > BingHelper.#lastRequestSidTime) {
            updateYandexSid = true;
          }
        } else {
          updateYandexSid = true;
        }

        if (updateYandexSid) {
          BingHelper.#lastRequestSidTime = Date.now();

          const http = new XMLHttpRequest();
          http.open("GET", "https://www.bing.com/translator");
          http.send();
          http.onload = (e) => {
            const result = http.responseText.match(
              /params_RichTranslateHelper\s=\s\[[^\]]+/
            );
            const data_iid_r = http.responseText.match(
              /data-iid\=\"[a-zA-Z0-9\.]+/
            );
            const IG_r = http.responseText.match(/IG\:\"[a-zA-Z0-9\.]+/);
            if (
              result &&
              result[0] &&
              result[0].length > 50 &&
              data_iid_r &&
              data_iid_r[0] &&
              IG_r &&
              IG_r[0]
            ) {
              const params_RichTranslateHelper = result[0]
                .substring("params_RichTranslateHelper = [".length)
                .split(",");
              const data_iid = data_iid_r[0].substring('data-iid="'.length);
              const IG = IG_r[0].substring('IG:"'.length);
              if (
                params_RichTranslateHelper &&
                params_RichTranslateHelper[0] &&
                params_RichTranslateHelper[1] &&
                parseInt(params_RichTranslateHelper[0]) &&
                data_iid &&
                IG
              ) {
                BingHelper.#translateSid = `&token=${params_RichTranslateHelper[1].substring(
                  1,
                  params_RichTranslateHelper[1].length - 1
                )}&key=${parseInt(params_RichTranslateHelper[0])}`;
                BingHelper.#translate_IID_IG = `IG=${IG}&IID=${data_iid}`;
                BingHelper.#SIDNotFound = false;
              } else {
                BingHelper.#SIDNotFound = true;
              }
            } else {
              BingHelper.#SIDNotFound = true;
            }
            resolve();
          };
          http.onerror =
            http.onabort =
            http.ontimeout =
            (e) => {
              console.error(e);
              resolve();
            };
        } else {
          resolve();
        }
      });

      BingHelper.#sidPromise.finally(() => {
        BingHelper.#sidPromise = null;
      });

      return await BingHelper.#sidPromise;
    }
  }

  /**
   * Base class to create new translation services.
   */
  class Service {
    /**
     * Returns a string with additional parameters to be concatenated to the request URL.
     * @callback callback_cbParameters
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @param {Array<TranslationInfo>} requests
     * @returns {string}
     */

    /**
     * Takes `sourceArray` and returns a request string to the translation service.
     * @callback callback_cbTransformRequest
     * @param {string[]} sourceArray
     * @returns {string}
     */

    /**
     * @typedef {{text: string, detectedLanguage: string}} Service_Single_Result_Response
     */

    /**
     * Receives the response from the *http request* and returns `Service_Single_Result_Response[]`.
     *
     * Returns a string with the body of a request of type **POST**.
     * @callback callback_cbParseResponse
     * @param {Object} response
     * @returns {Array<Service_Single_Result_Response>}
     */

    /**
     * Takes a string formatted with the translated text and returns a `resultArray`.
     * @callback callback_cbTransformResponse
     * @param {String} response
     * @param {boolean} dontSortResults
     * @returns {string[]} resultArray
     */

    /** @typedef {"complete" | "translating" | "error"} TranslationStatus */
    /**
     * @typedef {Object} TranslationInfo
     * @property {String} originalText
     * @property {String} translatedText
     * @property {String} detectedLanguage
     * @property {TranslationStatus} status
     * @property {Promise<void>} waitTranlate
     */

    /**
     * Initializes the **Service** class with information about the new translation service.
     * @param {string} serviceName
     * @param {string} baseURL
     * @param {"GET" | "POST"} xhrMethod
     * @param {callback_cbTransformRequest} cbTransformRequest Takes `sourceArray` and returns a request string to the translation service.
     * @param {callback_cbParseResponse} cbParseResponse Receives the response from the *http request* and returns `Service_Single_Result_Response[]`.
     * @param {callback_cbTransformResponse} cbTransformResponse Takes a string formatted with the translated text and returns a `resultArray`.
     * @param {callback_cbParameters} cbGetExtraParameters Returns a string with additional parameters to be concatenated to the request URL.
     * @param {callback_cbParameters} cbGetRequestBody Returns a string with the body of a request of type **POST**.
     */
    constructor(
      serviceName,
      baseURL,
      xhrMethod = "GET",
      cbTransformRequest,
      cbParseResponse,
      cbTransformResponse,
      cbGetExtraParameters = null,
      cbGetRequestBody = null
    ) {
      this.serviceName = serviceName;
      this.baseURL = baseURL;
      this.xhrMethod = xhrMethod;
      this.cbTransformRequest = cbTransformRequest;
      this.cbParseResponse = cbParseResponse;
      this.cbTransformResponse = cbTransformResponse;
      this.cbGetExtraParameters = cbGetExtraParameters;
      this.cbGetRequestBody = cbGetRequestBody;
      /**
       * @type {Map<string, TranslationInfo>}
       *
       * It works as an in-memory translation cache.
       * Ensures that two identical requests share the same `XMLHttpRequest`.
       * */
      this.translationsInProgress = new Map();
    }

    /**
     * Removes all translations with `status` **error** and are in `translationsInProgress`.
     *
     * Sometimes there is a device translation error due to internet connection problems.
     * Clearing translationsInProgress ensures that the translation will be retried.
     */
    removeTranslationsWithError() {
      this.translationsInProgress.forEach((transInfo, key) => {
        if (transInfo.status === "error") {
          this.translationsInProgress.delete(key);
        }
      });
    }

    /**
     * Receives the `sourceArray2d` parameter and prepares the requests.
     * Calls `cbTransformRequest` for each `sourceArray` of `sourceArray2d`.
     * The `currentTranslationsInProgress` array will be the **final result** with requests already completed or in progress. 
     * And the `requests` array will only contain the new requests that need to be made.
     *
     * Checks if there is already an identical request in progress or if it is already in the translation cache.
     * If it doesn't exist, add it to `requests` to make a new *http request*.
     *
     * Requests longer than **800 characters** will be split into new requests.
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @param {Array<string[]>} sourceArray2d
     * @returns {Promise<[Array<TranslationInfo[]>, TranslationInfo[]]>} `requests`, `currentTranslationsInProgress`
     */
    async getRequests(sourceLanguage, targetLanguage, sourceArray2d) {

      /** @type {Array<TranslationInfo[]>} */
      const requests = [];
      /** @type {TranslationInfo[]} */
      const currentTranslationsInProgress = [];

      let currentRequest = [];
      let currentSize = 0;

      for (const sourceArray of sourceArray2d) {
        const requestString = this.fixString(
          // Takes `sourceArray` and returns a request string to the translation service.
          this.cbTransformRequest(sourceArray)
        );
        // requestHash is a string: `sourceLanguage + "," + targetLanguage + "," + requestString`
        const requestHash = [
          sourceLanguage,
          targetLanguage,
          requestString,
        ].join(", ");

        // progressInfo: TranslationInfo
        // Format: {originalText: '<pre>YouTube</pre>', translatedText: '<pre>YouTube</pre>', detectedLanguage: 'en', waitTranlate: Promise}
        const progressInfo = this.translationsInProgress.get(requestHash);
        // Identical request already in progress
        if (progressInfo) {
          currentTranslationsInProgress.push(progressInfo);
        }
        // No matching request in progress
        else {
          /** @type {TranslationStatus} */
          let status = "translating";
          /** @type {() => void} */
          let promise_resolve = null;

          /** @type {TranslationInfo} */
          const progressInfo = {
            originalText: requestString,
            translatedText: null,
            detectedLanguage: null,
            get status() {
              return status;
            },
            set status(_status) {
              status = _status;
              promise_resolve();
            },
            waitTranlate: new Promise((resolve) => (promise_resolve = resolve)),
          };

          currentTranslationsInProgress.push(progressInfo);
          this.translationsInProgress.set(requestHash, progressInfo);

          //cast
          const cacheEntry = await translationCache.get(
            this.serviceName,
            sourceLanguage,
            targetLanguage,
            requestString
          );
          if (cacheEntry) {
            progressInfo.translatedText = cacheEntry.translatedText;
            progressInfo.detectedLanguage = cacheEntry.detectedLanguage;
            progressInfo.status = "complete";
            //this.translationsInProgress.delete([sourceLanguage, targetLanguage, requestString])
          } else {
            currentRequest.push(progressInfo);
            currentSize += progressInfo.originalText.length;
            if (currentSize > 800) {
              requests.push(currentRequest);
              currentSize = 0;
              currentRequest = [];
            }
          }
        }
      }

      if (currentRequest.length > 0) {
        requests.push(currentRequest);
        currentRequest = [];
        currentSize = 0;
      }

      return [requests, currentTranslationsInProgress];
    }

    /**
     * Makes a request using the *XMLHttpRequest* API. Returns a promise that will be resolved with the result of the request. If the request fails, the promise will be rejected.
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @param {Array<TranslationInfo>} requests
     * @returns {Promise<*>}
     */
    async makeRequest(sourceLanguage, targetLanguage, requests) {
      // // using Fetch instead of XMLHttpRequest
      // let headers = new Headers()
      // headers.append("Content-Type", "application/x-www-form-urlencoded")
      // let response = await fetch(
      //   this.baseURL +
      //   (this.cbGetExtraParameters
      //     ? this.cbGetExtraParameters(
      //       sourceLanguage,
      //       targetLanguage,
      //       requests
      //     )
      //     : ""),
      //   {
      //     method: this.xhrMethod,
      //     headers: headers,
      //     body: this.cbGetExtraParameters ? this.cbGetRequestBody(sourceLanguage, targetLanguage, requests) : undefined
      //   }
      // )
      // return response.json()

      // Build request URL
      const url = this.baseURL + (this.cbGetExtraParameters
        ? this.cbGetExtraParameters(sourceLanguage, targetLanguage, requests)
        : "");

      // Build headers only when needed (POST with body)
      const headers = new Headers();
      const hasBody = !!this.cbGetRequestBody;
      if (hasBody && this.xhrMethod === "POST") {
        headers.append("Content-Type", "application/x-www-form-urlencoded");
      }

      // Prepare request body (only if a body builder exists)
      const body = hasBody
        ? this.cbGetRequestBody(sourceLanguage, targetLanguage, requests)
        : undefined;

      // Abort on timeout to surface hanging requests
      const controller = new AbortController();
      const timeoutMs = 15000; // 15s
      const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

      // Helpful diagnostics
      try {
        console.debug("[makeRequest]", {
          service: this.serviceName,
          method: this.xhrMethod,
          url,
          hasBody,
          bodyLength: typeof body === "string" ? body.length : 0,
          requestsCount: Array.isArray(requests) ? requests.length : 0,
          inServiceWorker: typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id ? true : false,
        });

        const response = await fetch(url, {
          method: this.xhrMethod,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const text = await response.text().catch(() => "<failed to read body>");
          const err = new Error(`HTTP ${response.status} ${response.statusText}`);
          console.error("[makeRequest] Non-OK response", {
            service: this.serviceName,
            url,
            status: response.status,
            statusText: response.statusText,
            bodySample: text.slice(0, 500),
          });
          throw err;
        }

        // Read body as text first, then try JSON parse.
        // Calling response.json() consumes the body stream; if it fails
        // response.text() would also fail. So always read text first.
        const rawText = await response.text();
        try {
          return JSON.parse(rawText);
        } catch (jsonErr) {
          console.warn("[makeRequest] JSON parse failed, returning text", {
            service: this.serviceName,
            url,
            textSample: rawText.slice(0, 500),
          });
          return rawText;
        }
      } catch (e) {
        clearTimeout(timeoutId);
        console.error("[makeRequest] Failed to fetch", {
          service: this.serviceName,
          method: this.xhrMethod,
          url,
          hasBody,
          bodyLength: typeof body === "string" ? body.length : 0,
          name: e?.name,
          message: e?.message,
          cause: e?.cause,
        });
        throw e; // rethrow so callers can handle and mark status=error
      }
    }

    /**
     * Translates the `sourceArray2d`.
     *
     * If `dontSaveInPersistentCache` is **true** then the translation result will not be saved in the on-disk translation cache, only in the in-memory cache.
     *
     * The `dontSortResults` parameter is only valid when using the ***google*** translation service, if its value is **true** then the translation result will not be sorted.
     * 
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @param {Array<string[]>} sourceArray2d
     * @param {boolean} dontSaveInPersistentCache
     * @param {boolean} dontSortResults 
     * @returns {Promise<string[][]>}
     */
    async translate(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache = false,
      dontSortResults = false
    ) {

      // Build requests array
      const [requests, currentTranslationsInProgress] = await this.getRequests(
        sourceLanguage,
        targetLanguage,
        sourceArray2d
      );
      /** @type {Promise<void>[]} */
      const promises = [];
      // Dispatch all requests
      for (const request of requests) {
        promises.push(
          this.makeRequest(sourceLanguage, targetLanguage, request)
            .then((response) => {

              // Parse response to get results
              const results = this.cbParseResponse(response);

              for (const idx in request) {
                const result = results[idx];
                if (!result || typeof result.text !== "string") {
                  throw new Error(
                    `[${this.serviceName}] Missing translation result for request index ${idx}. Parsed results: ${Array.isArray(results) ? results.length : "non-array"}`
                  );
                }
                this.cbTransformResponse(result.text, dontSortResults); // just to generate error
                const transInfo = request[idx];
                transInfo.detectedLanguage = result.detectedLanguage || "und";
                transInfo.translatedText = result.text;
                transInfo.status = "complete";

                if (
                  dontSaveInPersistentCache === false &&
                  transInfo.translatedText
                ) {
                  translationCache.set(
                    this.serviceName,
                    sourceLanguage,
                    targetLanguage,
                    transInfo.originalText,
                    transInfo.translatedText,
                    transInfo.detectedLanguage
                  );
                }
              }
            })
            .catch((e) => {
              console.error(e);
              for (const transInfo of request) {
                transInfo.status = "error";
                //this.translationsInProgress.delete([sourceLanguage, targetLanguage, transInfo.originalText])
              }
            })
        );
      }
      await Promise.all(
        currentTranslationsInProgress.map((transInfo) => transInfo.waitTranlate)
      );
      return currentTranslationsInProgress.map((transInfo) =>
        this.cbTransformResponse(transInfo.translatedText, dontSortResults)
      );
    }

    /**
     * @param {string} str
     * @returns {string} fixedStr
     */
    fixString(str) {
      return str.replace(/\u200b/g, " ");
    }
  }

  /**
   * Google Translate service using the free client=gtx endpoint.
   * Uses GET requests with no hash/TKK calculation required.
   * Response format: nested JSON array, translated text at response[0][i][0].
   */
  const googleService = new (class extends Service {
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

        const cacheEntry = await translationCache.get(
          this.serviceName,
          sourceLanguage,
          targetLanguage,
          requestString
        );

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

  const yandexService = new (class extends Service {
    constructor() {
      super(
        "yandex",
        "https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-url-widget",
        "GET",
        function cbTransformRequest(sourceArray) {
          return sourceArray
            .map((value) => Utils.escapeHTML(value))
            .join("<wbr>");
        },
        function cbParseResponse(response) {
          const lang = response.lang;
          const detectedLanguage = lang ? lang.split("-")[0] : null;
          return response.text.map(
            /** @return {Service_Single_Result_Response} */(
              /** @type {string} */ text
          ) => ({ text, detectedLanguage })
          );
        },
        function cbTransformResponse(result, dontSortResults) {
          return result
            .split("<wbr>")
            .map((value) => Utils.unescapeHTML(value));
        },
        function cbGetExtraParameters(
          sourceLanguage,
          targetLanguage,
          requests
        ) {
          return `&id=${YandexHelper.translateSid}-0-0&format=html&lang=${sourceLanguage === "auto" ? "" : sourceLanguage + "-"
            }${targetLanguage}${requests
              .map((info) => `&text=${encodeURIComponent(info.originalText)}`)
              .join("")}`;
        },
        function cbGetRequestBody(sourceLanguage, targetLanguage, requests) {
          return undefined;
        }
      );
    }

    /**
     * @param {boolean} dontSortResults This parameter is not needed in this translation service
     */
    async translate(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache,
      dontSortResults = false
    ) {
      await YandexHelper.findSID();
      if (!YandexHelper.translateSid) return;
      if (sourceLanguage.startsWith("zh")) sourceLanguage = "zh";
      if (targetLanguage.startsWith("zh")) targetLanguage = "zh";
      return await super.translate(
        sourceLanguage,
        targetLanguage,
        sourceArray2d,
        dontSaveInPersistentCache,
        dontSortResults
      );
    }
  })();

  const bingService = new (class extends Service {
    constructor() {
      super(
        "bing",
        "https://www.bing.com/ttranslatev3?isVertical=1",
        "POST",
        function cbTransformRequest(sourceArray) {
          return sourceArray
            .map((value) => Utils.escapeHTML(value))
            .join("<wbr>");
        },
        function cbParseResponse(response) {
          return [
            {
              text: response[0].translations[0].text,
              detectedLanguage: response[0].detectedLanguage.language,
            },
          ];
        },
        function cbTransformResponse(result, dontSortResults) {
          return [Utils.unescapeHTML(result)];
        },
        function cbGetExtraParameters(
          sourceLanguage,
          targetLanguage,
          requests
        ) {
          return `&${BingHelper.translate_IID_IG}`;
        },
        function cbGetRequestBody(sourceLanguage, targetLanguage, requests) {
          return `&fromLang=${sourceLanguage}${requests
            .map((info) => `&text=${encodeURIComponent(info.originalText)}`)
            .join("")}&to=${targetLanguage}${BingHelper.translateSid}`;
        }
      );
    }

    /**
     * @param {string[][]} sourceArray2d - Only the string `sourceArray2d[0][0]` will be translated.
     * @param {boolean} dontSortResults - This parameter is not needed in this translation service 
     */
    async translate(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache,
      dontSortResults = false 
    ) {
      /** @type {{search: string, replace: string}[]} */
      const replacements = [
        {
          search: "auto",
          replace: "auto-detect",
        },
        {
          search: "zh-CN",
          replace: "zh-Hans",
        },
        {
          search: "zh-TW",
          replace: "zh-Hant",
        },
        {
          search: "tl",
          replace: "fil",
        },
        {
          search: "hmn",
          replace: "mww",
        },
        {
          search: "ckb",
          replace: "kmr",
        },
        {
          search: "mn",
          replace: "mn-Cyrl",
        },
        {
          search: "no",
          replace: "nb",
        },
        {
          search: "sr",
          replace: "sr-Cyrl",
        },
      ];
      replacements.forEach((r) => {
        if (targetLanguage === r.search) {
          targetLanguage = r.replace;
        }
        if (sourceLanguage === r.search) {
          sourceLanguage = r.replace;
        }
      });

      await BingHelper.findSID();
      if (!BingHelper.translate_IID_IG) return;

      return await super.translate(
        sourceLanguage,
        targetLanguage,
        sourceArray2d,
        dontSaveInPersistentCache,
        dontSortResults 
      );
    }
  })();

  const deeplService = new (class {
    constructor() {
      this.DeepLTab = null;
    }
    /**
     *
     * @param {string} sourceLanguage - This parameter is not used
     * @param {*} targetLanguage
     * @param {*} sourceArray2d - Only the string `sourceArray2d[0][0]` will be translated.
     * @param {*} dontSaveInPersistentCache - This parameter is not used
     * @param {*} dontSortResults - This parameter is not used 
     * @returns
     */
    async translate(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache,
      dontSortResults = false 
    ) {
      return await new Promise((resolve) => {
        const waitFirstTranslationResult = () => {
          const listener = (request, sender, sendResponse) => {
            if (request.action === "DeepL_firstTranslationResult") {
              resolve([[request.result]]);
              chrome.runtime.onMessage.removeListener(listener);
            }
          };
          chrome.runtime.onMessage.addListener(listener);

          setTimeout(() => {
            chrome.runtime.onMessage.removeListener(listener);
            resolve([[""]]);
          }, 8000);
        };

        if (this.DeepLTab) {
          chrome.tabs.get(this.DeepLTab.id, (tab) => {
            checkedLastError();
            if (tab) {
              //chrome.tabs.update(tab.id, {active: true})
              chrome.tabs.sendMessage(
                tab.id,
                {
                  action: "translateTextWithDeepL",
                  text: sourceArray2d[0][0],
                  targetLanguage,
                },
                {
                  frameId: 0,
                },
                (response) => resolve([[response]])
              );
            } else {
              chrome.tabs.create(
                {
                  url: `https://www.deepl.com/#!${targetLanguage}!#${encodeURIComponent(
                    sourceArray2d[0][0]
                  )}`,
                },
                (tab) => {
                  this.DeepLTab = tab;
                  waitFirstTranslationResult();
                }
              );
              // resolve([[""]])
            }
          });
        } else {
          chrome.tabs.create(
            {
              url: `https://www.deepl.com/#!${targetLanguage}!#${encodeURIComponent(
                sourceArray2d[0][0]
              )}`,
            },
            (tab) => {
              this.DeepLTab = tab;
              waitFirstTranslationResult();
            }
          );
          // resolve([[""]])
        }
      });
    }
  })();

  /**
   * Microsoft Edge Translate API helper.
   * Manages JWT token acquisition and caching from edge.microsoft.com/translate/auth.
   */
  class MicrosoftEdgeHelper {
    /** @type {string|null} */
    static #token = null;
    /** @type {number|null} */
    static #tokenExpiresAt = null;
    /** @type {Promise<string|null>|null} */
    static #fetchPromise = null;

    /**
     * Decode JWT payload to read the exp field.
     * @param {string} token
     * @returns {number} expiration timestamp in ms
     */
    static #getTokenExpiry(token) {
      try {
        const parts = token.split(".");
        if (parts.length < 2) return 0;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        return (payload.exp || 0) * 1000; // convert to ms
      } catch {
        return 0;
      }
    }

    /**
     * Get a valid auth token. Caches and auto-refreshes.
     * @returns {Promise<string|null>}
     */
    static async getToken() {
      // Return cached token if still valid (with 60s safety margin)
      if (MicrosoftEdgeHelper.#token && MicrosoftEdgeHelper.#tokenExpiresAt && Date.now() < MicrosoftEdgeHelper.#tokenExpiresAt - 60000) {
        return MicrosoftEdgeHelper.#token;
      }

      // Deduplicate concurrent requests
      if (MicrosoftEdgeHelper.#fetchPromise) return await MicrosoftEdgeHelper.#fetchPromise;

      MicrosoftEdgeHelper.#fetchPromise = new Promise((resolve) => {
        try {
          const http = new XMLHttpRequest();
          http.open("GET", "https://edge.microsoft.com/translate/auth");
          http.timeout = 10000;
          http.onload = () => {
            if (http.status >= 200 && http.status < 300 && http.responseText) {
              const token = http.responseText.trim();
              MicrosoftEdgeHelper.#token = token;
              MicrosoftEdgeHelper.#tokenExpiresAt = MicrosoftEdgeHelper.#getTokenExpiry(token);

              // Fallback: if we can't parse expiry, assume 8 minutes.
              if (!MicrosoftEdgeHelper.#tokenExpiresAt) {
                MicrosoftEdgeHelper.#tokenExpiresAt = Date.now() + 8 * 60 * 1000;
              }

              resolve(MicrosoftEdgeHelper.#token);
            } else {
              console.error("[MicrosoftEdgeHelper] Token fetch failed:", http.status, http.statusText);
              resolve(null);
            }
          };
          http.onerror = http.onabort = http.ontimeout = () => {
            console.error("[MicrosoftEdgeHelper] Token fetch error:", http.statusText || "network-error");
            resolve(null);
          };
          http.send();
        } catch (e) {
          console.error("[MicrosoftEdgeHelper] Token fetch error:", e?.message);
          resolve(null);
        }
      });

      const result = await MicrosoftEdgeHelper.#fetchPromise;
      MicrosoftEdgeHelper.#fetchPromise = null;
      return result;
    }

    /**
     * Microsoft language code mapping from DualTran codes to Microsoft API codes.
     * @param {string} lang
     * @returns {string}
     */
    static mapLanguageCode(lang) {
      const map = {
        "auto": "",
        "zh-CN": "zh-Hans",
        "zh-TW": "zh-Hant",
        "yue": "yue",
        "bs": "bs-Latn",
        "sr-Latn": "sr-Latn",
        "sr-Cyrl": "sr-Cyrl",
        "sr": "sr-Cyrl",
        "no": "nb",
        "bn": "bn",
        "hmn": "mww",
        "mn": "mn-Cyrl",
        "tl": "fil",
        "ckb": "kmr",
      };
      return map[lang] !== undefined ? map[lang] : lang;
    }
  }

  /**
   * Microsoft Edge Translate service.
   * Uses the free Microsoft Edge cognitive translator API.
   * Custom translate() method (does not use Service base class) — similar to deeplService.
   */
  const microsoftService = new (class {
    constructor() {
      this.serviceName = "microsoft";
      /** @type {Map<string, any>} */
      this.translationsInProgress = new Map();
    }

    /**
     * Build request headers for the free Edge translator endpoint.
     * These values mirror the working Edge-based implementation used elsewhere
     * in this repository and avoid the stripped-down request shape that can be
     * rejected intermittently.
     * @param {string} token
     * @returns {Record<string, string>}
     */
    buildRequestHeaders(token) {
      return {
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Authorization": `Bearer ${token}`,
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        "Pragma": "no-cache",
      };
    }

    /**
     * Edge free endpoint occasionally fails to acquire a token or rejects requests outright.
     * In those cases, fall back to the existing Bing implementation so “Microsoft Translate”
     * still produces bilingual output.
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @param {Array<string[]>} sourceArray2d
     * @param {boolean} dontSaveInPersistentCache
     * @param {boolean} dontSortResults
     * @param {string} reason
     * @param {Record<string, any>=} extra
     * @returns {Promise<string[][]>}
     */
    async translateWithBingFallback(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache = false,
      dontSortResults = false,
      reason = "unknown",
      extra = {}
    ) {
      console.warn("[microsoftService] Falling back to Bing translator", {
        reason,
        sourceLanguage,
        targetLanguage,
        pieceCount: Array.isArray(sourceArray2d) ? sourceArray2d.length : 0,
        ...extra,
      });

      try {
        const fallbackResults = await bingService.translate(
          sourceLanguage,
          targetLanguage,
          sourceArray2d,
          dontSaveInPersistentCache,
          dontSortResults
        );

        if (Array.isArray(fallbackResults) && fallbackResults.length > 0) {
          return fallbackResults;
        }
      } catch (fallbackError) {
        console.error("[microsoftService] Bing fallback failed:", fallbackError?.message);
      }

      throw new Error(`Microsoft translator fallback failed (${reason})`);
    }

    removeTranslationsWithError() {
      this.translationsInProgress.forEach((transInfo, key) => {
        if (transInfo.status === "error") {
          this.translationsInProgress.delete(key);
        }
      });
    }

    /**
     * Translate sourceArray2d using Microsoft Edge Translate API.
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @param {Array<string[]>} sourceArray2d
     * @param {boolean} dontSaveInPersistentCache
     * @param {boolean} dontSortResults - not used
     * @returns {Promise<string[][]>}
     */
    async translate(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache = false,
      dontSortResults = false
    ) {
      const token = await MicrosoftEdgeHelper.getToken();
      if (!token) {
        console.error("[microsoftService] Failed to get auth token");
        return await this.translateWithBingFallback(
          sourceLanguage,
          targetLanguage,
          sourceArray2d,
          dontSaveInPersistentCache,
          dontSortResults,
          "token-unavailable"
        );
      }

      const msSourceLang = MicrosoftEdgeHelper.mapLanguageCode(sourceLanguage);
      const msTargetLang = MicrosoftEdgeHelper.mapLanguageCode(targetLanguage);

      const results = [];

      for (const sourceArray of sourceArray2d) {
        // Match the working Edge translator request shape used in the sibling
        // Translate-Web-Page project to maximize compatibility.
        const body = sourceArray.map((text) => ({ text }));

        let url = `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&includeSentenceLength=true&to=${encodeURIComponent(msTargetLang)}`;
        if (msSourceLang) {
          url += `&from=${encodeURIComponent(msSourceLang)}`;
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort("timeout"), 15000);

          const response = await fetch(url, {
            method: "POST",
            headers: this.buildRequestHeaders(token),
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errText = await response.text().catch(() => "");
            console.error("[microsoftService] API error:", response.status, errText);
            return await this.translateWithBingFallback(
              sourceLanguage,
              targetLanguage,
              sourceArray2d,
              dontSaveInPersistentCache,
              dontSortResults,
              "http-error",
              { status: response.status, responseText: errText.slice(0, 300) }
            );
          }

          const data = await response.json();
          // Response format: [{translations: [{text: "...", to: "..."}], detectedLanguage: {language: "...", score: 1.0}}, ...]
          const translated = data.map((item) => {
            if (item && item.translations && item.translations[0]) {
              return item.translations[0].text;
            }
            return "";
          });

          // If the response array shape is wrong or all non-empty inputs mapped to empty strings,
          // the API returned 200 but the results are unusable.
          if (
            !Array.isArray(data) ||
            data.length !== sourceArray.length ||
            translated.every((text, index) => !text && String(sourceArray[index] || "").trim().length > 0)
          ) {
            return await this.translateWithBingFallback(
              sourceLanguage,
              targetLanguage,
              sourceArray2d,
              dontSaveInPersistentCache,
              dontSortResults,
              "empty-or-malformed-response",
              {
                expectedLength: sourceArray.length,
                actualLength: Array.isArray(data) ? data.length : null,
              }
            );
          }

          // Cache the results
          if (!dontSaveInPersistentCache) {
            for (let i = 0; i < sourceArray.length; i++) {
              const detectedLang = data[i]?.detectedLanguage?.language || sourceLanguage;
              translationCache.set(
                this.serviceName,
                sourceLanguage,
                targetLanguage,
                sourceArray[i],
                translated[i] || "",
                detectedLang
              );
            }
          }

          results.push(translated);
        } catch (e) {
          console.error("[microsoftService] Request failed:", e?.message);
          return await this.translateWithBingFallback(
            sourceLanguage,
            targetLanguage,
            sourceArray2d,
            dontSaveInPersistentCache,
            dontSortResults,
            "request-failed",
            { errorMessage: e?.message, errorName: e?.name }
          );
        }
      }

      return results;
    }
  })();

  /** @type {Map<string, Service>} */
  const serviceList = new Map();

  serviceList.set("google", googleService);
  serviceList.set("yandex", yandexService);
  serviceList.set("bing", bingService);
  serviceList.set(
    "deepl",
    /** @type {Service} */ /** @type {?} */(deeplService)
  );
  serviceList.set(
    "microsoft",
    /** @type {Service} */ /** @type {?} */(microsoftService)
  );

  /**
   * Translate element list (2D array)
   * 
   * @param {*} serviceName 
   * @param {*} sourceLanguage 
   * @param {*} targetLanguage 
   * @param {*} sourceArray2d 
   * @param {*} dontSaveInPersistentCache 
   * @param {*} dontSortResults  
   * @returns 
   */
  translationService.translateHTML = async (
    serviceName,
    sourceLanguage,
    targetLanguage,
    sourceArray2d,
    dontSaveInPersistentCache = false,
    dontSortResults = false 
  ) => {

    serviceName = twpLang.getAlternativeService(
      targetLanguage,
      serviceName,
      true
    );
    const service = serviceList.get(serviceName) || serviceList.get("google");
    return await service.translate(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache,
      dontSortResults 
    );
  };

  /**
   * Translate text array (1D array)
   * @param {*} serviceName 
   * @param {*} sourceLanguage 
   * @param {*} targetLanguage 
   * @param {*} sourceArray 
   * @param {*} dontSaveInPersistentCache 
   * @returns 
   */
  translationService.translateText = async (
    serviceName,
    sourceLanguage,
    targetLanguage,
    sourceArray,
    dontSaveInPersistentCache = false
  ) => {

    serviceName = twpLang.getAlternativeService(
      targetLanguage,
      serviceName,
      false
    );
    const service = serviceList.get(serviceName) || serviceList.get("google");
    return (
      await service.translate(
        sourceLanguage,
        targetLanguage,
        [sourceArray], // Wrap in array to form a 2D array
        dontSaveInPersistentCache
      )
    )[0];
  };

  /**
   * Translate a single string
   * @param {*} serviceName 
   * @param {*} sourceLanguage 
   * @param {*} targetLanguage 
   * @param {*} originalText 
   * @param {*} dontSaveInPersistentCache 
   * @returns 
   */
  translationService.translateSingleText = async (
    serviceName,
    sourceLanguage,
    targetLanguage,
    originalText,
    dontSaveInPersistentCache = false
  ) => {

    serviceName = twpLang.getAlternativeService(
      targetLanguage,
      serviceName,
      false
    );
    const service = serviceList.get(serviceName) || serviceList.get("google");
    return (
      await service.translate(
        sourceLanguage,
        targetLanguage,
        [[originalText]], // Wrap text into 2D array
        dontSaveInPersistentCache
      )
    )[0][0];
  };

  // Listen for translation requests from content scripts
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(222222222, request)
    // If the translation request came from an incognito window, the translation should not be cached on disk.
    const dontSaveInPersistentCache = sender.tab ? sender.tab.incognito : false;
    if (request.action === "translateHTML") {
      console.log(333333333333)
      translationService
        .translateHTML(
          request.translationService,
          "auto",
          request.targetLanguage,
          request.sourceArray2d,
          dontSaveInPersistentCache,
          request.dontSortResults 
        )
        .then((results) => sendResponse(results))
        .catch((e) => {
          console.error("[DualTran][BackgroundTranslateHTMLCatch]", {
            translationService: request.translationService,
            targetLanguage: request.targetLanguage,
            pieceCount: Array.isArray(request.sourceArray2d) ? request.sourceArray2d.length : 0,
            errorMessage: e?.message,
            errorName: e?.name,
          });
          console.error(e);
          sendResponse();
        });

      return true;
    } else if (request.action === "translateText") {
      translationService
        .translateText(
          request.translationService,
          "auto",
          request.targetLanguage,
          request.sourceArray,
          dontSaveInPersistentCache
        )
        .then((results) => sendResponse(results))
        .catch((e) => {
          sendResponse();
          console.error(e);
        });

      return true;
    } else if (request.action === "translateSingleText") {
      translationService
        .translateSingleText(
          request.translationService,
          "auto",
          request.targetLanguage,
          request.source,
          dontSaveInPersistentCache
        )
        .then((results) => sendResponse(results))
        .catch((e) => {
          sendResponse();
          console.error(e);
        });

      return true;
    } else if (request.action === "removeTranslationsWithError") {
      serviceList.forEach((service) => {
        if (service.removeTranslationsWithError) {
          service.removeTranslationsWithError();
        }
      });
    } else if (request.action === "debugTranslationConnectivity") {
      // Quick probes to common translation hosts to surface concrete errors
      const targets = [
        { name: "googleapis", url: "https://translate.googleapis.com/robots.txt" },
        { name: "yandex", url: "https://translate.yandex.net/robots.txt" },
        { name: "bing", url: "https://www.bing.com/robots.txt" },
        { name: "deepl", url: "https://www.deepl.com/robots.txt" },
      ];

      const timeoutMs = 8000;
      const probe = async (url) => {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort("timeout"), timeoutMs);
        const started = Date.now();
        try {
          const res = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
          const elapsed = Date.now() - started;
          clearTimeout(to);
          return { ok: res.ok, status: res.status, statusText: res.statusText, timeMs: elapsed };
        } catch (e) {
          const elapsed = Date.now() - started;
          clearTimeout(to);
          return { ok: false, error: e?.name || "Error", message: e?.message, timeMs: elapsed };
        }
      };

      (async () => {
        const results = {};
        for (const t of targets) {
          results[t.name] = await probe(t.url);
        }
        sendResponse({
          environment: {
            inServiceWorker: !!(chrome && chrome.runtime && chrome.runtime.id),
            userAgent: (typeof navigator !== "undefined" && navigator.userAgent) || "",
          },
          results,
        });
      })();
      return true;
    }
  });

  return translationService;
})();

export default translationService