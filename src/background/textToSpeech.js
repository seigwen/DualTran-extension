"use strict";

console.log("textToSpeech.js is running")

import twpConfig from "../lib/config.js"
import { createQueuePlayer } from "./audioQueue.js";

const textToSpeech = (function () {
  const textToSpeech = {};

  /**
   * @callback Callback_Speech_cbGetExtraParameters
   * @param {string} text
   * @param {string} targetLanguage
   * @return {string} urlParamsString
   */

  class Service {
    /**
     * Defines the Service class for the text-to-speech service.
     * @param {string} serviceName
     * @param {string} baseURL
     * @param {"GET" | "POST"} xhrMethod
     * @param {Callback_Speech_cbGetExtraParameters} cbGetExtraParameters
     */
    constructor(serviceName, baseURL, xhrMethod, cbGetExtraParameters) {
      this.serviceName = serviceName;
      this.baseURL = baseURL;
      this.xhrMethod = xhrMethod;
      this.cbGetExtraParameters = cbGetExtraParameters;
  /** @type {Map<string, string>} dataURL cache */
      this.audios = new Map();
      // BUG: ttsSpeed initial value is never read from config; speed resets to 1.0 after browser restart.
      // Should read twpConfig.get("ttsSpeed") in constructor or onReady.
      // Currently only updated via onChanged listener (see L266-271 in this file).
      this.audioSpeed = 1.0;
      /** @type {Map<string, (value?: any) => void>} */
      this._pendingResolves = new Map();
      /**
       * Firefox fallback (plan 62 M2): Firefox has no chrome.offscreen, so the
       * background event page plays the audio itself through this queue.
       * @type {ReturnType<typeof createQueuePlayer> | null}
       */
      this._localPlayer = null;
      /** @type {{disconnect: () => void} | null} keepalive port held during local playback */
      this._keepalivePort = null;
    }

    /** @returns {boolean} whether the Chrome offscreen playback backend is available */
    hasOffscreen() {
      return !!chrome["offscreen"];
    }

    /** Lazily create the in-background playback queue (Firefox path). */
    getLocalPlayer() {
      if (!this._localPlayer) {
        this._localPlayer = createQueuePlayer({ createAudio: (src) => new Audio(src) });
      }
      return this._localPlayer;
    }

    /**
     * Keep the background event page alive during local playback (Firefox
     * unloads event pages when idle; an open runtime port counts as activity).
     * @param {number=} tabId the tab that requested playback, when known
     */
    _startKeepalive(tabId) {
      this._stopKeepalive();
      if (typeof tabId !== "number" || !chrome.tabs?.connect) return;
      try {
        this._keepalivePort = chrome.tabs.connect(tabId, { name: "tts-keepalive" });
      } catch (_) {
        this._keepalivePort = null;
      }
    }

    _stopKeepalive() {
      try {
        this._keepalivePort?.disconnect();
      } catch (_) {}
      this._keepalivePort = null;
    }

    /**
     * Takes a long text and splits the text into an array of strings. Each string will be less than 170 characters.
     *
     * The goal is not to exceed the quota for text-to-speech services.
     * @param {string} fullText
     * @returns {string[]} requestStrings
     */
    getRequests(fullText) {
      /** @type {string[]} */
      const fullTextSplitted = [];
      fullText
        .trim()
        .split(" ")
        .forEach((word) => {
          if (word.length > 160) {
            while (word.length > 160) {
              fullTextSplitted.push(word.slice(0, 160));
              word = word.slice(160);
            }
            if (word.trim().length > 0) {
              fullTextSplitted.push(word);
            }
          } else if (word.trim().length > 0) {
            fullTextSplitted.push(word);
          }
        });

      /** @type {string[]} */
      const requests = [];
      let requestString = "";
      for (let text of fullTextSplitted) {
        text += " ";
        if (requestString.length + text.length < 170) {
          requestString += text;
        } else {
          requests.push(requestString);
          requestString = text;
        }
      }
      if (requestString.trim().length > 0) {
        requests.push(requestString);
        requestString = "";
      }

      return requests;
    }

    /**
     * Makes the request to the text-to-speech service and returns a promise that resolves with the result of the request.
     *
     * The promise is rejected if there is an error.
     * @param {string} text
     * @param {string} targetLanguage
     * @returns {Promise<any>} Promise\<blob\>
     */
    async makeRequest(text, targetLanguage) {
      // MV3 Service Workers have no XMLHttpRequest; use fetch.
      const url = this.baseURL + this.cbGetExtraParameters(text, targetLanguage);
      console.log("text2speech request:", url, text, targetLanguage);
      const res = await fetch(url, { method: this.xhrMethod || "GET" });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const blob = await res.blob();
      // Convert to data:URL (Offscreen uses Audio(dataURL) to avoid cross-origin/CORS/referer issues)
      const buf = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const dataUrl = `data:${blob.type};base64,${base64}`;
      return dataUrl;
    }

    /**
     * Transform text into audio and play then.
     * @param {string} fullText
     * @param {string} targetLanguage
     * @returns {Promise<void>} Promise\<void\>
     */
    /**
     * @param {string} fullText
     * @param {string} targetLanguage
     * @param {{ keepaliveTabId?: number }} [opts]
     */
    async textToSpeech(fullText, targetLanguage, opts = {}) {
      const requests = this.getRequests(fullText);
      const promises = [];

      for (const requestText of requests) {
        const audioKey = [targetLanguage, requestText].join(", ");
        if (!this.audios.get(audioKey)) {
          promises.push(
            this.makeRequest(requestText, targetLanguage)
              .then(
                /** @type {string} */ (dataUrl) => {
                  this.audios.set(audioKey, dataUrl);
                  return dataUrl;
                }
              )
              .catch((e) => {
                console.error(e);
                return null;
              })
          );
        }
      }

      await Promise.all(promises);
      const sources = requests
        .map((text) => this.audios.get([targetLanguage, text].join(", ")))
        .filter(Boolean);
      return await this.play(sources, opts);
    }

    /**
     * Play the audio or all the audio in the array.
     * @param {HTMLAudioElement | HTMLAudioElement[]} audios
     */
    /**
     * Play audio via Offscreen document
     * @param {string[] | string} audios data:URL list or single data:URL
     */
    /**
     * Play audio via the available backend: the Chrome offscreen document, or
     * (Firefox: no chrome.offscreen) the background event page itself.
     * @param {string[] | string} audios data:URL list or single data:URL
     * @param {{ keepaliveTabId?: number }} [opts]
     */
    async play(audios, opts = {}) {
      const sources = Array.isArray(audios) ? audios : [audios];
      if (this.hasOffscreen()) {
        // Play via Offscreen document from SW
        await this.ensureOffscreen();
        this.stopAll();
        const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await new Promise((resolve) => {
          this._pendingResolves.set(requestId, resolve);
          chrome.runtime.sendMessage({
            action: "offscreenPlay",
            sources,
            requestId,
          });
        });
      } else {
        // Firefox fallback: play in the background page and hold a keepalive
        // port so the event page is not unloaded mid-playback (plan 62 M2).
        this.stopAll();
        this._startKeepalive(opts.keepaliveTabId);
        await new Promise((resolve) => {
          this.getLocalPlayer().playAll(sources, () => {
            this._stopKeepalive();
            resolve();
          });
        });
      }
    }

    async ensureOffscreen() {
      const offscreen = chrome["offscreen"]; // Bypass type-checker complaints
      if (!offscreen) return; // Skip if unsupported (e.g. non-Chrome browsers)
      try {
        if (offscreen.hasDocument) {
          const has = await offscreen.hasDocument();
          if (!has) {
            await offscreen.createDocument({
              url: chrome.runtime.getURL("/background/offscreen-audio.html"),
              reasons: [offscreen.Reason.AUDIO_PLAYBACK],
              justification: "Play TTS audio from service worker",
            });
          }
        } else {
          // Older versions lack hasDocument; try creating directly and ignore errors if already exists
          try {
            await offscreen.createDocument({
              url: chrome.runtime.getURL("/background/offscreen-audio.html"),
              reasons: [offscreen.Reason.AUDIO_PLAYBACK],
              justification: "Play TTS audio from service worker",
            });
          } catch (_) {}
        }
        // Sync playback speed
        chrome.runtime.sendMessage({ action: "offscreenSetSpeed", speed: this.audioSpeed });
      } catch (e) {
        console.error("ensureOffscreen failed", e);
      }
    }

    /**
     * Sets the audio speed
     * @param {number} speed
     */
    setAudioSpeed(speed) {
      this.audioSpeed = speed;
      if (this.hasOffscreen()) {
        // Notify Offscreen to update speed
        chrome.runtime.sendMessage({ action: "offscreenSetSpeed", speed: this.audioSpeed });
      }
      this._localPlayer?.setSpeed(this.audioSpeed);
    }

    /**
     * Pause all audio and reset audio time to start
     */
    stopAll() {
      if (this.hasOffscreen()) {
        // Notify Offscreen to stop
        chrome.runtime.sendMessage({ action: "offscreenStop" });
      }
      this._localPlayer?.stopAll();
      this._stopKeepalive();
    }
  }

  // Create a Service instance based on google's text-to-speech service.
  const googleService = new Service(
    "google",
    "https://translate.google.com/translate_tts?ie=UTF-8",
    "GET",
    function getExtraParameters(text, targetLanguage) {
      return `&tl=${targetLanguage}&client=dict-chrome-ex&ttsspeed=0.5&q=${encodeURIComponent(
        text
      )}`;
    }
  );

  // Listen for messages coming from contentScript or other scripts.
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("textToSpeech received message", request);
    // request example: { action: "textToSpeech", text: "Hello world", targetLanguage: "en" }
    if (request.action === "textToSpeech") {
      googleService
        .textToSpeech(request.text, request.targetLanguage, {
          keepaliveTabId: sender?.tab?.id,
        })
        .catch((e) => {
          console.error("text2speech failed: ", e);
        })
        .finally(() => {
          sendResponse();
        });

      return true;
    } else if (request.action === "stopAudio") {
      googleService.stopAll();
    }
  });

  // Wait for Offscreen playback-done notification
  chrome.runtime.onMessage.addListener((request, _sender, _sendResponse) => {
    if (request?.action === "offscreenAudioDone" && request?.requestId) {
      try {
        const resolve = textToSpeech.google?._pendingResolves?.get(request.requestId);
        if (resolve) {
          textToSpeech.google._pendingResolves.delete(request.requestId);
          resolve();
        }
      } catch (e) {
        console.error(e);
      }
    }
  });

  // Listen for changes to the audio speed setting and apply it immediately.
  twpConfig.onReady(async () => {
    twpConfig.onChanged((name, newvalue) => {
      if (name === "ttsSpeed") {
        googleService.setAudioSpeed(newvalue);
      }
    });
  });

  textToSpeech.google = googleService;

  return textToSpeech;
})();

export default textToSpeech