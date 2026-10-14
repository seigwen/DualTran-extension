"use strict";

import { createQueuePlayer } from "./audioQueue.js";

console.log("offscreen-audio.js is running");

// Shared queue logic lives in audioQueue.js (also used by the Firefox
// background-page fallback in textToSpeech.js). This file stays the thin
// message bridge for the Chrome offscreen document.
const player = createQueuePlayer({ createAudio: (src) => new Audio(src) });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === "offscreenPlay") {
    const { sources, requestId } = msg;
    player.playAll(sources, () => {
      chrome.runtime.sendMessage({ action: "offscreenAudioDone", requestId });
    });
    sendResponse();
    return true;
  }
  if (msg?.action === "offscreenStop") {
    player.stopAll();
    sendResponse();
  }
  if (msg?.action === "offscreenSetSpeed") {
    player.setSpeed(Number(msg.speed) || 1.0);
    sendResponse();
  }
});
