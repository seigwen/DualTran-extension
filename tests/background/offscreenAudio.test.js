import { beforeEach, describe, expect, it, vi } from "vitest";

describe("offscreen-audio", () => {
  let messageListeners;
  let mockAudioInstances;

  beforeEach(() => {
    vi.resetModules();
    messageListeners = [];
    mockAudioInstances = [];

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb) => messageListeners.push(cb)),
        },
        sendMessage: vi.fn(),
      },
    };

    globalThis.Audio = vi.fn((src) => {
      const audio = {
        src,
        playbackRate: 1.0,
        currentTime: 0,
        pause: vi.fn(),
        play: vi.fn(() => Promise.resolve()),
        addEventListener: vi.fn((event, handler) => {
          audio._handlers = audio._handlers || {};
          audio._handlers[event] = handler;
        }),
        removeEventListener: vi.fn((event) => {
          if (audio._handlers) delete audio._handlers[event];
        }),
        _handlers: {},
      };
      mockAudioInstances.push(audio);
      return audio;
    });

    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  async function loadModule() {
    await import("../../src/background/offscreen-audio.js");
  }

  function fireMessage(msg) {
    const sendResponse = vi.fn();
    for (const listener of messageListeners) {
      listener(msg, {}, sendResponse);
    }
    return sendResponse;
  }

  it("registers a message listener on load", async () => {
    await loadModule();
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });

  describe("offscreenPlay", () => {
    it("creates Audio objects from sources and starts playback", async () => {
      await loadModule();
      fireMessage({
        action: "offscreenPlay",
        sources: ["data:audio/mp3;base64,AAA", "data:audio/mp3;base64,BBB"],
        requestId: "req-1",
      });

      expect(mockAudioInstances).toHaveLength(2);
      expect(mockAudioInstances[0].play).toHaveBeenCalled();
    });

    it("plays audio sequentially by chaining 'ended' events", async () => {
      await loadModule();
      fireMessage({
        action: "offscreenPlay",
        sources: ["src1", "src2"],
        requestId: "req-2",
      });

      expect(mockAudioInstances[0].play).toHaveBeenCalled();
      expect(mockAudioInstances[1].play).not.toHaveBeenCalled();

      mockAudioInstances[0]._handlers.ended();

      expect(mockAudioInstances[1].play).toHaveBeenCalled();
    });

    it("sends offscreenAudioDone when all audio finishes", async () => {
      await loadModule();
      fireMessage({
        action: "offscreenPlay",
        sources: ["src1"],
        requestId: "req-3",
      });

      mockAudioInstances[0]._handlers.ended();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: "offscreenAudioDone",
        requestId: "req-3",
      });
    });

    it("skips to next audio if play() rejects", async () => {
      await loadModule();

      globalThis.Audio = vi.fn(() => {
        const audio = {
          playbackRate: 1.0,
          currentTime: 0,
          pause: vi.fn(),
          play: vi.fn(() => Promise.reject(new Error("blocked"))),
          addEventListener: vi.fn((event, handler) => {
            audio._handlers = audio._handlers || {};
            audio._handlers[event] = handler;
          }),
          removeEventListener: vi.fn(),
          _handlers: {},
        };
        mockAudioInstances.push(audio);
        return audio;
      });

      vi.resetModules();
      mockAudioInstances = [];
      messageListeners = [];
      await loadModule();

      fireMessage({
        action: "offscreenPlay",
        sources: ["bad-src"],
        requestId: "req-4",
      });

      await vi.waitFor(() => {
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
          action: "offscreenAudioDone",
          requestId: "req-4",
        });
      });
    });

    it("handles empty sources array", async () => {
      await loadModule();
      fireMessage({
        action: "offscreenPlay",
        sources: [],
        requestId: "req-5",
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: "offscreenAudioDone",
        requestId: "req-5",
      });
    });
  });

  describe("offscreenStop", () => {
    it("pauses and resets all queued audio", async () => {
      await loadModule();
      fireMessage({
        action: "offscreenPlay",
        sources: ["src1", "src2"],
        requestId: "req-6",
      });

      fireMessage({ action: "offscreenStop" });

      for (const audio of mockAudioInstances) {
        expect(audio.pause).toHaveBeenCalled();
        expect(audio.currentTime).toBe(0);
      }
    });
  });

  describe("offscreenSetSpeed", () => {
    it("sets playback rate on current queue", async () => {
      await loadModule();
      fireMessage({
        action: "offscreenPlay",
        sources: ["src1"],
        requestId: "req-7",
      });

      fireMessage({ action: "offscreenSetSpeed", speed: 1.5 });

      expect(mockAudioInstances[0].playbackRate).toBe(1.5);
    });

    it("defaults to 1.0 if speed is invalid", async () => {
      await loadModule();
      fireMessage({
        action: "offscreenPlay",
        sources: ["src1"],
        requestId: "req-8",
      });

      fireMessage({ action: "offscreenSetSpeed", speed: "invalid" });

      expect(mockAudioInstances[0].playbackRate).toBe(1.0);
    });

    it("applies speed to newly played audio", async () => {
      await loadModule();

      fireMessage({ action: "offscreenSetSpeed", speed: 2.0 });

      fireMessage({
        action: "offscreenPlay",
        sources: ["src1"],
        requestId: "req-9",
      });

      expect(mockAudioInstances[0].playbackRate).toBe(2.0);
    });
  });
});
