"use strict";

/**
 * Shared sequential playback queue for TTS audio segments (plan 62 M2).
 *
 * Used by both playback backends:
 *   - the Chrome offscreen document (background/offscreen-audio.js), and
 *   - the Firefox background-page fallback (Firefox has no chrome.offscreen).
 *
 * Kept DOM-free: callers inject `createAudio` so the queue logic stays
 * unit-testable in plain node (tests/background/audioQueue.test.js).
 */

/**
 * @param {{ createAudio: (src: string) => any }} deps
 */
export function createQueuePlayer({ createAudio }) {
  /** @type {any[]} */
  let queue = [];
  let playing = false;
  let speed = 1.0;
  // Generation fence: a supersede/stop invalidates continuations of the old
  // queue even if a stale "ended" event still fires (shared-flag aliasing bug
  // caught by tests/background/audioQueue.test.js).
  let generation = 0;

  function stopAll() {
    generation++;
    try {
      queue.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
    } catch {}
    queue = [];
    playing = false;
  }

  function playNext(index, onAllDone, gen) {
    if (!playing || gen !== generation) return;
    const audio = queue[index];
    if (!audio) {
      playing = false;
      if (onAllDone) onAllDone();
      return;
    }
    audio.playbackRate = speed;
    const onEnded = () => {
      audio.removeEventListener("ended", onEnded);
      playNext(index + 1, onAllDone, gen);
    };
    audio.addEventListener("ended", onEnded);
    audio.play().catch(() => {
      // Skip faulty segment
      audio.removeEventListener("ended", onEnded);
      playNext(index + 1, onAllDone, gen);
    });
  }

  /**
   * Play the sources in order. Supersedes any queue already playing.
   * @param {string[]} sources audio data: URLs
   * @param {() => void} [onAllDone] fires once when the queue exhausts naturally
   */
  function playAll(sources, onAllDone) {
    stopAll();
    const gen = generation;
    queue = (sources || []).map((src) => createAudio(src));
    playing = true;
    playNext(0, onAllDone, gen);
  }

  /**
   * @param {number} newSpeed
   */
  function setSpeed(newSpeed) {
    speed = Number(newSpeed) || 1.0;
    queue.forEach((audio) => {
      audio.playbackRate = speed;
    });
  }

  return { playAll, stopAll, setSpeed };
}
