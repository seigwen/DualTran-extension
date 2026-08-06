import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { indexedDBMocks } = vi.hoisted(() => ({
  indexedDBMocks: {
    deletedDatabases: [],
  },
}));

// Mock crypto.subtle.digest for SHA-1
vi.stubGlobal("crypto", {
  subtle: {
    digest: vi.fn((_algo, data) => {
      const text = new TextDecoder().decode(data);
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
      }
      const bytes = new Uint8Array(20);
      new DataView(bytes.buffer).setInt32(0, hash);
      return Promise.resolve(bytes.buffer);
    }),
  },
});

// Mock indexedDB for deleteAiTranslationCache (simple enough to work without timers)
vi.stubGlobal("indexedDB", {
  databases: vi.fn(() => Promise.resolve([
    { name: "ai@en.zh-CN" },
    { name: "google@en.zh-CN" },
    { name: "ai@ja.en" },
  ])),
  deleteDatabase: vi.fn((name) => {
    indexedDBMocks.deletedDatabases.push(name);
  }),
});

vi.stubGlobal("TextEncoder", TextEncoder);
vi.stubGlobal("TextDecoder", TextDecoder);

describe("aiTranslationCache", () => {
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    indexedDBMocks.deletedDatabases.length = 0;

    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        reload: vi.fn(),
      },
    });

    mod = await import("../../src/background/aiTranslationCache.js");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("deleteAiTranslationCache deletes only ai@ prefixed databases", async () => {
    await mod.deleteAiTranslationCache();
    expect(indexedDBMocks.deletedDatabases).toEqual([
      "ai@en.zh-CN",
      "ai@ja.en",
    ]);
    expect(indexedDBMocks.deletedDatabases).not.toContain("google@en.zh-CN");
  });
});
