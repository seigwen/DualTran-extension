/**
 * Plan 62 M2 — Firefox event-page keepalive for pending async work.
 *
 * Seam under test: src/background/eventPageKeepalive.js — a refcounted timer
 * that touches chrome.runtime.getPlatformInfo() periodically while async
 * message work is pending. Firefox unloads idle background event pages and
 * does not treat a pending sendMessage response as "busy", so a translation
 * request that outlives the idle window dies mid-flight (found by the firefox
 * smoke suite: the first translation of a fresh session returned nothing).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventPageKeepalive } from "../../src/background/eventPageKeepalive.js";

describe("eventPageKeepalive – refcounted timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make() {
    const runtime = { getPlatformInfo: vi.fn() };
    const keepalive = createEventPageKeepalive({ runtime, intervalMs: 4000 });
    return { runtime, keepalive };
  }

  it("touches getPlatformInfo on every tick while active", () => {
    const { runtime, keepalive } = make();
    keepalive.start();

    vi.advanceTimersByTime(12000);
    expect(runtime.getPlatformInfo).toHaveBeenCalledTimes(3);

    keepalive.stop();
    vi.advanceTimersByTime(12000);
    expect(runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
    expect(keepalive.isActive()).toBe(false);
  });

  it("shares a single timer across concurrent holders", () => {
    const { runtime, keepalive } = make();
    keepalive.start();
    keepalive.start();
    keepalive.start();

    vi.advanceTimersByTime(4000);
    expect(runtime.getPlatformInfo).toHaveBeenCalledTimes(1);

    keepalive.stop();
    vi.advanceTimersByTime(4000);
    expect(runtime.getPlatformInfo).toHaveBeenCalledTimes(2);

    keepalive.stop();
    keepalive.stop();
    expect(keepalive.isActive()).toBe(false);
    vi.advanceTimersByTime(8000);
    expect(runtime.getPlatformInfo).toHaveBeenCalledTimes(2);
  });

  it("tolerates stop() without start() and runtime errors", () => {
    const { runtime, keepalive } = make();
    keepalive.stop();
    expect(keepalive.isActive()).toBe(false);

    runtime.getPlatformInfo.mockImplementation(() => {
      throw new Error("wake failed");
    });
    keepalive.start();
    expect(() => vi.advanceTimersByTime(4000)).not.toThrow();
    keepalive.stop();
  });
});
