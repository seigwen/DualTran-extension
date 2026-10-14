"use strict";

/**
 * Refcounted keepalive timer for the Firefox background event page (plan 62 M2).
 *
 * Firefox unloads idle background event pages and does not treat a pending
 * runtime message response as "busy": an async translation request that
 * outlives the idle window dies mid-flight, the sender's callback never fires
 * and the translation is silently lost (reproduced by the firefox smoke suite
 * on a fresh session). The documented remedy for event pages is to touch an
 * extension API periodically; runtime.getPlatformInfo() is a safe no-op probe.
 *
 * Chrome's MV3 service worker does not need this — callers gate on the gecko
 * manifest marker (see translationService.js).
 */

/**
 * @param {{ runtime: { getPlatformInfo: (cb?: Function) => any }, intervalMs?: number }} deps
 */
export function createEventPageKeepalive({ runtime, intervalMs = 4000 }) {
  let holders = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  function touch() {
    try {
      runtime.getPlatformInfo(() => {});
    } catch (_) {
      // A failed probe must never break the pending work.
    }
  }

  function start() {
    holders++;
    if (!timer) {
      timer = setInterval(touch, intervalMs);
    }
  }

  function stop() {
    holders = Math.max(0, holders - 1);
    if (holders === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, isActive: () => timer !== null };
}
