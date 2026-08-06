"use strict";

console.log("textToSpeech.js is running")

import twpConfig from "../lib/config.js"

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
  /** @type {Map<string, string>} dataURL 缓存 */
      this.audios = new Map();
      // BUG: ttsSpeed 初始值从未从 config 读取，浏览器重启后速度重置为 1.0。
      // 应在 constructor 或 onReady 中读取 twpConfig.get("ttsSpeed")。
      // 当前仅在 onChanged listener 中更新（参见本文件 L266-271）。
      this.audioSpeed = 1.0;
      /** @type {Map<string, (value?: any) => void>} */
      this._pendingResolves = new Map();
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
      // 在 MV3 Service Worker 中没有 XMLHttpRequest，使用 fetch。
      const url = this.baseURL + this.cbGetExtraParameters(text, targetLanguage);
      console.log("text2speech request:", url, text, targetLanguage);
      const res = await fetch(url, { method: this.xhrMethod || "GET" });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const blob = await res.blob();
      // 转为 data:URL（Offscreen 使用 Audio(dataURL) 播放，避免跨域/CORS 与 referer 问题）
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
    async textToSpeech(fullText, targetLanguage) {
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
      return await this.play(sources);
    }

    /**
     * Play the audio or all the audio in the array.
     * @param {HTMLAudioElement | HTMLAudioElement[]} audios
     */
    /**
     * 通过 Offscreen 文档播放音频
     * @param {string[] | string} audios data:URL 列表或单个 data:URL
     */
    async play(audios) {
      // 在 SW 中通过 Offscreen 文档播放
      await this.ensureOffscreen();
      this.stopAll();
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await new Promise((resolve) => {
        this._pendingResolves.set(requestId, resolve);
        chrome.runtime.sendMessage({
          action: "offscreenPlay",
          sources: Array.isArray(audios) ? audios : [audios],
          requestId,
        });
      });
    }

    async ensureOffscreen() {
      const offscreen = chrome["offscreen"]; // 避免类型检查报错
      if (!offscreen) return; // 环境不支持则跳过（例如部分非 Chrome 浏览器）
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
          // 老版本缺少 hasDocument，就直接尝试创建，若已存在会异常，忽略即可
          try {
            await offscreen.createDocument({
              url: chrome.runtime.getURL("/background/offscreen-audio.html"),
              reasons: [offscreen.Reason.AUDIO_PLAYBACK],
              justification: "Play TTS audio from service worker",
            });
          } catch (_) {}
        }
        // 同步速度
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
      // 通知 Offscreen 更新速度
      chrome.runtime.sendMessage({ action: "offscreenSetSpeed", speed: this.audioSpeed });
    }

    /**
     * Pause all audio and reset audio time to start
     */
    stopAll() {
      // 通知 Offscreen 停止
      chrome.runtime.sendMessage({ action: "offscreenStop" });
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
        .textToSpeech(request.text, request.targetLanguage)
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

  // 等待 Offscreen 播放结束的通知
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