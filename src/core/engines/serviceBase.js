/**
 * Translation service base class — host-free (plan 59 M3-4).
 *
 * Extracted from src/background/translationService.js. Host capabilities are
 * injected through `serviceRuntime` — this module never touches chrome.*:
 *   - cache: translation cache ({get, set}); null = run uncached (Node CLI)
 *   - fetchImpl: fetch override (tests / CLI fixtures); null = global fetch
 *   - isServiceWorkerContext: diagnostic probe for the makeRequest log; the
 *     extension host injects the chrome.runtime.id check (kept out of core)
 */

/** Host-injected runtime. The extension wires it in src/background/translationService.js. */
export const serviceRuntime = {
  /** @type {{get: Function, set: Function}|null} */
  cache: null,
  /** @type {Function|null} */
  fetchImpl: null,
  /** @type {() => boolean} */
  isServiceWorkerContext: () => false,
};

/**
 * Base class to create new translation services.
 */
export class Service {
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
        const cacheEntry = serviceRuntime.cache
          ? await serviceRuntime.cache.get(
            this.serviceName,
            sourceLanguage,
            targetLanguage,
            requestString
          )
          : undefined;
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
        inServiceWorker: serviceRuntime.isServiceWorkerContext(),
      });

      const response = await (serviceRuntime.fetchImpl || fetch)(url, {
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
                transInfo.translatedText &&
                serviceRuntime.cache
              ) {
                serviceRuntime.cache.set(
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

