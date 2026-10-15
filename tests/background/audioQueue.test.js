/**
 * Plan 62 M2 — shared sequential audio queue for TTS segments.
 *
 * Seam under test: scripts/../src/background/audioQueue.js — pure logic used
 * by BOTH playback backends (the Chrome offscreen document and the Firefox
 * background-page fallback). DOM access is injected via `createAudio`, so
 * these tests run in plain node with fake audio objects.
 *
 * Contract (frozen here, consumed by offscreen-audio.js):
 *   - segments play strictly sequentially; a segment starts only after the
 *     previous one fires `ended` (or its play() rejects);
 *   - natural completion calls onAllDone exactly once;
 *   - stopAll cancels the queue: queued segments are paused + rewound and
 *     onAllDone is NOT called anymore;
 *   - a new playAll supersedes the previous queue (previous onAllDone dead);
 *   - setSpeed applies to the queued segments and to later segments.
 */
import { describe, expect, it, vi } from "vitest";

import { createQueuePlayer } from "../../src/background/audioQueue.js";

function createFakeAudio(src) {
  const audio = {
    src,
    playbackRate: 1.0,
    currentTime: 0,
    pause: vi.fn(() => {
      audio.paused = true;
    }),
    paused: false,
    play: vi.fn(() => {
      audio.paused = false;
      return Promise.resolve();
    }),
    _handlers: {},
    addEventListener: vi.fn((event, handler) => {
      audio._handlers[event] = handler;
    }),
    removeEventListener: vi.fn((event) => {
      delete audio._handlers[event];
    }),
    fireEnded() {
      const handler = audio._handlers.ended;
      if (handler) handler();
    },
  };
  return audio;
}

function createPlayerWithRecorder() {
  const created = [];
  const completions = [];
  const player = createQueuePlayer({
    createAudio: (src) => {
      const audio = createFakeAudio(src);
      created.push(audio);
      return audio;
    },
  });
  return {
    player,
    created,
    done: (index = 0) => () => completions.push(index),
    completions,
  };
}

/** Flushes microtasks so a rejected play().catch chain settles. */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("audioQueue – sequential playback", () => {
  it("plays sources sequentially and reports completion exactly once", () => {
    const { player, created, done, completions } = createPlayerWithRecorder();

    player.playAll(["s1", "s2"], done());

    expect(created.map((a) => a.src)).toEqual(["s1", "s2"]);
    expect(created[0].play).toHaveBeenCalledTimes(1);
    expect(created[1].play).not.toHaveBeenCalled();

    created[0].fireEnded();
    expect(created[1].play).toHaveBeenCalledTimes(1);

    created[1].fireEnded();
    expect(completions).toEqual([0]);

    // Firing ended again must not double-report.
    created[1].fireEnded();
    expect(completions).toEqual([0]);
  });

  it("reports completion immediately for an empty source list", () => {
    const { player, done, completions } = createPlayerWithRecorder();
    player.playAll([], done());
    expect(completions).toEqual([0]);
  });

  it("skips a segment whose play() rejects and continues with the next one", async () => {
    const created = [];
    const completions = [];
    const player = createQueuePlayer({
      createAudio: (src) => {
        const audio = createFakeAudio(src);
        if (src === "bad") {
          audio.play = vi.fn(() => Promise.reject(new Error("blocked")));
        }
        created.push(audio);
        return audio;
      },
    });

    player.playAll(["bad", "good"], () => completions.push(0));

    await flushMicrotasks();
    expect(created[1].play).toHaveBeenCalledTimes(1);

    created[1].fireEnded();
    expect(completions).toEqual([0]);
  });
});

describe("audioQueue – cancellation and supersede", () => {
  it("stopAll pauses and rewinds queued audio and suppresses completion", () => {
    const { player, created, done, completions } = createPlayerWithRecorder();

    player.playAll(["s1", "s2"], done());
    player.stopAll();

    for (const audio of created) {
      expect(audio.pause).toHaveBeenCalledTimes(1);
      expect(audio.currentTime).toBe(0);
    }

    // The chain is dead: even firing ended now must not advance or complete.
    created[0].fireEnded();
    expect(created[1].play).not.toHaveBeenCalled();
    expect(completions).toEqual([]);
  });

  it("a new playAll supersedes the previous one (old completion never fires)", () => {
    const { player, created, done, completions } = createPlayerWithRecorder();

    player.playAll(["old1"], done(0));
    player.playAll(["new1"], done(1));

    expect(completions).toEqual([]);

    created[0].fireEnded(); // dead chain, must be ignored
    expect(completions).toEqual([]);

    created[1].fireEnded();
    expect(completions).toEqual([1]);
  });
});

describe("audioQueue – speed control", () => {
  it("setSpeed updates the queued segments and later segments start at that speed", () => {
    const { player, created } = createPlayerWithRecorder();

    player.playAll(["s1", "s2"], () => {});
    player.setSpeed(1.5);

    expect(created[0].playbackRate).toBe(1.5);

    created[0].fireEnded();
    expect(created[1].playbackRate).toBe(1.5);
  });

  it("invalid speed values fall back to 1.0", () => {
    const { player, created } = createPlayerWithRecorder();

    player.setSpeed("not-a-number");
    player.playAll(["s1"], () => {});

    expect(created[0].playbackRate).toBe(1.0);
  });
});
