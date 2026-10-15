import { beforeEach, describe, expect, it, vi } from "vitest";

const { configCallbacks } = vi.hoisted(() => ({
  configCallbacks: [],
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    onReady: vi.fn((cb) => {
      if (typeof cb === "function") cb();
      return Promise.resolve();
    }),
    onChanged: vi.fn((cb) => configCallbacks.push(cb)),
  },
}));

describe("textToSpeech – Service.getRequests (pure logic)", () => {
  let textToSpeech;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
        getURL: vi.fn((p) => `chrome-extension://id${p}`),
      },
      offscreen: undefined,
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../../src/background/textToSpeech.js");
    textToSpeech = mod.default;
  });

  function getRequests(text) {
    return textToSpeech.google.getRequests(text);
  }

  it("splits text into chunks under 170 characters", () => {
    const longText = Array(30).fill("hello").join(" ");
    const requests = getRequests(longText);
    for (const chunk of requests) {
      expect(chunk.length).toBeLessThan(170);
    }
  });

  it("returns single chunk for short text", () => {
    const requests = getRequests("Hello world");
    expect(requests).toHaveLength(1);
    expect(requests[0].trim()).toBe("Hello world");
  });

  it("returns empty array for empty/whitespace text", () => {
    expect(getRequests("")).toEqual([]);
    expect(getRequests("   ")).toEqual([]);
  });

  it("handles words longer than 160 characters by slicing them", () => {
    const longWord = "a".repeat(400);
    const requests = getRequests(longWord);
    expect(requests.length).toBeGreaterThan(1);
    const reconstructed = requests.join("").replace(/ /g, "");
    expect(reconstructed).toBe(longWord);
  });

  it("preserves all words across chunks", () => {
    const words = [];
    for (let i = 0; i < 50; i++) words.push(`word${i}`);
    const text = words.join(" ");
    const requests = getRequests(text);
    const reconstructed = requests.join("").trim();
    for (const word of words) {
      expect(reconstructed).toContain(word);
    }
  });

  it("each chunk ends with a trailing space (for natural concatenation)", () => {
    const text = Array(20).fill("testing").join(" ");
    const requests = getRequests(text);
    for (const chunk of requests) {
      expect(chunk.endsWith(" ")).toBe(true);
    }
  });
});

describe("textToSpeech – message listeners", () => {
  let messageListeners;
  let textToSpeech;

  beforeEach(async () => {
    vi.resetModules();
    messageListeners = [];
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb) => messageListeners.push(cb)),
        },
        sendMessage: vi.fn(),
        getURL: vi.fn((p) => `chrome-extension://id${p}`),
      },
      offscreen: undefined,
    };
    globalThis.fetch = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../../src/background/textToSpeech.js");
    textToSpeech = mod.default;
  });

  it("registers multiple message listeners", () => {
    expect(messageListeners.length).toBeGreaterThanOrEqual(2);
  });

  it("handles 'stopAudio' message", () => {
    // Offscreen backend present: the stop message still goes out. The
    // without-offscreen fallback case is covered in the firefox describe below.
    chrome.offscreen = { Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" } };
    const sendResponse = vi.fn();
    for (const listener of messageListeners) {
      listener({ action: "stopAudio" }, {}, sendResponse);
    }
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: "offscreenStop",
    });
  });

  it("returns true for 'textToSpeech' action (async response)", () => {
    const sendResponse = vi.fn();
    let returnedTrue = false;
    for (const listener of messageListeners) {
      const result = listener(
        { action: "textToSpeech", text: "hi", targetLanguage: "en" },
        {},
        sendResponse
      );
      if (result === true) returnedTrue = true;
    }
    expect(returnedTrue).toBe(true);
  });

  it("reuses cached audio data without calling makeRequest again", async () => {
    const requestText = textToSpeech.google.getRequests("cached audio")[0];
    textToSpeech.google.audios.set("en, " + requestText, "data:audio/mock;base64,AAA=");
    const makeRequestSpy = vi.spyOn(textToSpeech.google, "makeRequest");
    const playSpy = vi.spyOn(textToSpeech.google, "play").mockResolvedValueOnce();

    await textToSpeech.google.textToSpeech("cached audio", "en");

    expect(makeRequestSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledWith(["data:audio/mock;base64,AAA="], {});
  });

  it("ensureOffscreen skips creation when a document already exists", async () => {
    chrome.offscreen = {
      hasDocument: vi.fn().mockResolvedValue(true),
      createDocument: vi.fn(),
      Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
    };

    await textToSpeech.google.ensureOffscreen();

    expect(chrome.offscreen.hasDocument).toHaveBeenCalledOnce();
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: "offscreenSetSpeed",
      speed: 1,
    });
  });

  it("ensureOffscreen falls back to direct creation when hasDocument is unavailable", async () => {
    chrome.offscreen = {
      createDocument: vi.fn().mockResolvedValue(undefined),
      Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
    };

    await textToSpeech.google.ensureOffscreen();

    expect(chrome.offscreen.createDocument).toHaveBeenCalledWith({
      url: "chrome-extension://id/background/offscreen-audio.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play TTS audio from service worker",
    });
  });

  it("setAudioSpeed stores the new speed and notifies offscreen playback", () => {
    chrome.offscreen = { Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" } };
    textToSpeech.google.setAudioSpeed(1.75);

    expect(textToSpeech.google.audioSpeed).toBe(1.75);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: "offscreenSetSpeed",
      speed: 1.75,
    });
  });

  it("resolves play after the offscreen completion listener receives matching requestId", async () => {
    chrome.offscreen = { Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" } };
    vi.spyOn(textToSpeech.google, "ensureOffscreen").mockResolvedValueOnce();

    const playPromise = textToSpeech.google.play(["data:audio/mock;base64,AAA="]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const requestId = [...textToSpeech.google._pendingResolves.keys()][0];
    expect(requestId).toEqual(expect.any(String));

    for (const listener of messageListeners) {
      listener({ action: "offscreenAudioDone", requestId }, {}, vi.fn());
    }

    await expect(playPromise).resolves.toBeUndefined();
    expect(textToSpeech.google._pendingResolves.has(requestId)).toBe(false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "offscreenPlay", requestId })
    );
  });

  it("makeRequest converts fetched audio blobs into data URLs", async () => {
    const bytes = Uint8Array.from([65, 66, 67]);
    const blob = {
      type: "audio/mpeg",
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    };
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
    });

    const result = await textToSpeech.google.makeRequest("abc", "en");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("q=abc"),
      { method: "GET" }
    );
    expect(result).toBe("data:audio/mpeg;base64,QUJD");
  });
});

describe("textToSpeech – config listener", () => {
  beforeEach(async () => {
    vi.resetModules();
    configCallbacks.length = 0;
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
        getURL: vi.fn((p) => `chrome-extension://id${p}`),
      },
      offscreen: undefined,
    };
    vi.spyOn(console, "log").mockImplementation(() => {});

    await import("../../src/background/textToSpeech.js");
  });

  it("updates audio speed when ttsSpeed config changes", () => {
    chrome.offscreen = { Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" } };
    expect(configCallbacks.length).toBeGreaterThan(0);
    const cb = configCallbacks[configCallbacks.length - 1];
    cb("ttsSpeed", 1.5);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: "offscreenSetSpeed",
      speed: 1.5,
    });
  });

  it("ignores unrelated config changes", () => {
    chrome.runtime.sendMessage.mockClear();
    const cb = configCallbacks[configCallbacks.length - 1];
    cb("targetLanguage", "fr");
    const speedCalls = chrome.runtime.sendMessage.mock.calls.filter(
      (c) => c[0]?.action === "offscreenSetSpeed"
    );
    expect(speedCalls).toHaveLength(0);
  });
});


describe("textToSpeech – firefox fallback (no chrome.offscreen)", () => {
  let messageListeners;
  let textToSpeech;
  let audioInstances;

  beforeEach(async () => {
    vi.resetModules();
    messageListeners = [];
    audioInstances = [];
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb) => messageListeners.push(cb)),
        },
        sendMessage: vi.fn(),
        getURL: vi.fn((p) => `chrome-extension://id${p}`),
      },
      offscreen: undefined,
      tabs: { connect: vi.fn(() => ({ disconnect: vi.fn() })) },
    };
    globalThis.Audio = vi.fn((src) => {
      const audio = {
        src,
        playbackRate: 1.0,
        currentTime: 0,
        pause: vi.fn(),
        play: vi.fn(() => Promise.resolve()),
        _handlers: {},
        addEventListener: vi.fn((event, handler) => {
          audio._handlers[event] = handler;
        }),
        removeEventListener: vi.fn((event) => {
          delete audio._handlers[event];
        }),
      };
      audioInstances.push(audio);
      return audio;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../../src/background/textToSpeech.js");
    textToSpeech = mod.default;
  });

  function offscreenCalls() {
    return chrome.runtime.sendMessage.mock.calls.filter((c) =>
      String(c[0]?.action || "").startsWith("offscreen")
    );
  }

  it("plays through background audio instead of the offscreen bridge", async () => {
    const playPromise = textToSpeech.google.play(["data:audio/x;base64,AAA="]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].src).toBe("data:audio/x;base64,AAA=");
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
    expect(offscreenCalls()).toHaveLength(0);

    audioInstances[0]._handlers.ended();
    await expect(playPromise).resolves.toBeUndefined();
  });

  it("holds a keepalive port for the requesting tab while playing and releases it on completion", async () => {
    const playPromise = textToSpeech.google.play(["src-a"], { keepaliveTabId: 42 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chrome.tabs.connect).toHaveBeenCalledWith(42, { name: "tts-keepalive" });
    const port = chrome.tabs.connect.mock.results[0].value;

    audioInstances[0]._handlers.ended();
    await expect(playPromise).resolves.toBeUndefined();
    expect(port.disconnect).toHaveBeenCalledTimes(1);
  });

  it("skips keepalive when no requesting tab is known (popup-originated playback)", async () => {
    const playPromise = textToSpeech.google.play(["src-b"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chrome.tabs.connect).not.toHaveBeenCalled();

    audioInstances[0]._handlers.ended();
    await expect(playPromise).resolves.toBeUndefined();
  });

  it("stopAudio cancels local playback without messaging the offscreen backend", () => {
    textToSpeech.google.play(["src-c"]);
    const sendResponse = vi.fn();
    for (const listener of messageListeners) {
      listener({ action: "stopAudio" }, {}, sendResponse);
    }

    expect(audioInstances[0].pause).toHaveBeenCalled();
    expect(offscreenCalls()).toHaveLength(0);
  });
});
