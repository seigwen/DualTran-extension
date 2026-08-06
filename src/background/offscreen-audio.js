"use strict";

console.log("offscreen-audio.js is running");

// Playback state
let currentQueue = [];
let isPlaying = false;
let audioSpeed = 1.0;

function stopAll() {
  try {
    currentQueue.forEach((a) => {
      a.pause();
      a.currentTime = 0;
    });
  } catch {}
  currentQueue = [];
  isPlaying = false;
}

async function playAll(audios, requestId) {
  stopAll();
  currentQueue = audios;
  isPlaying = true;

  const playNext = (idx) => {
    if (!isPlaying) return;
    const audio = currentQueue[idx];
    if (!audio) {
      isPlaying = false;
      chrome.runtime.sendMessage({ action: "offscreenAudioDone", requestId });
      return;
    }
    audio.playbackRate = audioSpeed;
    const onEnded = () => {
      audio.removeEventListener("ended", onEnded);
      playNext(idx + 1);
    };
    audio.addEventListener("ended", onEnded);
    audio.play().catch(() => {
      // Skip faulty segment
      audio.removeEventListener("ended", onEnded);
      playNext(idx + 1);
    });
  };

  playNext(0);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === "offscreenPlay") {
    const { sources, requestId } = msg;
    const audios = (sources || []).map((src) => new Audio(src));
    playAll(audios, requestId);
    sendResponse();
    return true;
  }
  if (msg?.action === "offscreenStop") {
    stopAll();
    sendResponse();
  }
  if (msg?.action === "offscreenSetSpeed") {
    audioSpeed = Number(msg.speed) || 1.0;
    currentQueue.forEach((a) => (a.playbackRate = audioSpeed));
    sendResponse();
  }
});
