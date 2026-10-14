/**
 * Background translation service
 */

"use strict";

console.log("translationService.js is running")

import twpLang from "../lib/languages.js"
import translationCache from "../background/translationCache.js"
import { Service, serviceRuntime } from "../core/engines/serviceBase.js"
import { Utils } from "../core/engines/utils.js"
import { googleService } from "../core/engines/google.js"
import { createEventPageKeepalive } from "./eventPageKeepalive.js"

// ── Host wiring for the shared engine (plan 59 M3) ──
// src/core/engines/* is host-free: the translation cache and the SW-context
// probe are injected here, where the extension host owns them.
serviceRuntime.cache = translationCache
serviceRuntime.isServiceWorkerContext = () => !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id)

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

  // Utils — moved to src/core/engines/utils.js (plan 59 M3-3)

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

  // Service — base class moved to src/core/engines/serviceBase.js (plan 59 M3-4)

  /**
   * Google Translate service using the free client=gtx endpoint.
   * Uses GET requests with no hash/TKK calculation required.
   * Response format: nested JSON array, translated text at response[0][i][0].
   */
  // googleService — moved to src/core/engines/google.js (plan 59 M3-5)

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

  // Firefox keeps the background event page alive only while it is "busy"; a
  // pending runtime message response does NOT count (plan 62 M2 smoke finding:
  // the first translation of a fresh session died mid-flight and was lost
  // silently). While translation work is pending, touch an extension API
  // periodically so the event page is not unloaded. No-op on Chromium.
  const keepalive = chrome.runtime.getManifest?.()?.browser_specific_settings?.gecko
    ? createEventPageKeepalive({ runtime: chrome.runtime })
    : null;
  const trackAsync = (promise) => {
    if (!keepalive) return promise;
    keepalive.start();
    return promise.finally(() => keepalive.stop());
  };

  // Listen for translation requests from content scripts
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(222222222, request)
    // If the translation request came from an incognito window, the translation should not be cached on disk.
    const dontSaveInPersistentCache = sender.tab ? sender.tab.incognito : false;
    if (request.action === "translateHTML") {
      console.log(333333333333)
      trackAsync(
        translationService.translateHTML(
          request.translationService,
          "auto",
          request.targetLanguage,
          request.sourceArray2d,
          dontSaveInPersistentCache,
          request.dontSortResults 
        )
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
      trackAsync(
        translationService.translateText(
          request.translationService,
          "auto",
          request.targetLanguage,
          request.sourceArray,
          dontSaveInPersistentCache
        )
      )
        .then((results) => sendResponse(results))
        .catch((e) => {
          sendResponse();
          console.error(e);
        });

      return true;
    } else if (request.action === "translateSingleText") {
      trackAsync(
        translationService.translateSingleText(
          request.translationService,
          "auto",
          request.targetLanguage,
          request.source,
          dontSaveInPersistentCache
        )
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