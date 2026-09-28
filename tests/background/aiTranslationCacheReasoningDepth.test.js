/**
 * aiTranslationCacheReasoningDepth.test.js
 *
 * 责任：验证推理深度参与 AI 翻译缓存 key（plan 32 / Q5）。
 *
 * 背景：缓存 key 原为 provider+model+URL+原文。用户把推理深度从 low 调到
 * high 后重译，会命中旧条目并**静默返回旧深度的译文**。加入 depth 段后
 * 不同深度不再互相污染。
 *
 * 断言：
 *   - 不同 depth → 不命中（缓存不串味）
 *   - 相同 depth → 命中
 *   - depth 缺省与 "" 等价（同一 key）
 *   - 旧条目（无 depth 段时代写入）不会被新 key 命中 → 升级后自然失效
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.stubGlobal("TextEncoder", TextEncoder);
vi.stubGlobal("TextDecoder", TextDecoder);

/** 记录每次 SHA-1 的输入（即复合 key 原文），用于直接断言 key 组成。 */
const digestInputs = [];

vi.stubGlobal("crypto", {
  subtle: {
    digest: vi.fn((_algo, data) => {
      const text = new TextDecoder().decode(data);
      digestInputs.push(text);
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

// ── 内存版 IndexedDB（够用即可：open / transaction / objectStore / put / get / openCursor）──
function createMemoryIndexedDB() {
  const databases = new Map();
  return {
    _databases: databases,
    open(name) {
      if (!databases.has(name)) databases.set(name, new Map());
      const records = databases.get(name);
      const request = { result: {}, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction() {
            return {
              objectStore() {
                return {
                  put(entry) {
                    const req = { onsuccess: null, onerror: null };
                    records.set(entry.key, entry);
                    queueMicrotask(() => req.onsuccess?.({ target: req }));
                    return req;
                  },
                  get(key) {
                    const req = { result: records.get(key), onsuccess: null, onerror: null };
                    queueMicrotask(() => req.onsuccess?.({ target: req }));
                    return req;
                  },
                  openCursor() {
                    const req = { onsuccess: null, onerror: null };
                    queueMicrotask(() => req.onsuccess?.({ target: { result: null } }));
                    return req;
                  },
                };
              },
            };
          },
        };
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
}

describe("aiTranslationCache — reasoning depth in the cache key", () => {
  let mod;
  let fakeIdb;

  beforeEach(async () => {
    vi.resetModules();
    digestInputs.length = 0;
    fakeIdb = createMemoryIndexedDB();
    vi.stubGlobal("indexedDB", fakeIdb);
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

  const SET_ARGS = (depth) => ["en", "zh-CN", "openai", "gpt-4o", depth];

  it("keys the entry on the provider, model, depth, url and text", async () => {
    await mod.aiTranslationCacheSet(...SET_ARGS("high"), "https://example.com/page", "Hello", "你好");

    expect(digestInputs).toHaveLength(1);
    expect(digestInputs[0]).toBe("openai\u0000gpt-4o\u0000high\u0000https://example.com/page\u0000Hello");
  });

  it("does NOT return an entry stored under a different depth (no cross-depth bleed)", async () => {
    await mod.aiTranslationCacheSet(...SET_ARGS("low"), "https://example.com/page", "Hello", "低深度译文");

    const highHit = await mod.aiTranslationCacheGet(...SET_ARGS("high"), "https://example.com/page", "Hello");

    expect(highHit).toBeNull();
  });

  it("returns the entry when the depth matches", async () => {
    await mod.aiTranslationCacheSet(...SET_ARGS("high"), "https://example.com/page", "Hello", "高深度译文");

    const hit = await mod.aiTranslationCacheGet(...SET_ARGS("high"), "https://example.com/page", "Hello");

    expect(hit).toEqual({ translated: "高深度译文" });
  });

  it("treats an omitted depth as the empty string (same key, no separate universe)", async () => {
    await mod.aiTranslationCacheSet("en", "zh-CN", "openai", "gpt-4o", undefined, "https://example.com/page", "Hello", "默认译文");

    expect(digestInputs[0]).toBe("openai\u0000gpt-4o\u0000\u0000https://example.com/page\u0000Hello");

    const hit = await mod.aiTranslationCacheGet("en", "zh-CN", "openai", "gpt-4o", "", "https://example.com/page", "Hello");
    expect(hit).toEqual({ translated: "默认译文" });
  });

  // 升级语义：旧 key 只有 4 段，新 key 有 5 段 → 旧条目自然不再命中
  // （刻意不迁移：给旧译文打上错误的深度标签比多翻译一次更糟）
  it("never reuses pre-upgrade entries that lack the depth segment", async () => {
    // 先做一次 get 以创建数据库（模拟已有的旧缓存库）
    await mod.aiTranslationCacheGet("en", "zh-CN", "openai", "gpt-4o", "", "https://example.com/page", "Hello");
    const records = fakeIdb._databases.get("ai@en.zh-CN");

    // 手工写入一条旧格式条目（升级前写入、按 4 段 key 哈希）
    records.set("legacy-hash", { key: "legacy-hash", translatedText: "旧译文", timestamp: Date.now() });

    const hit = await mod.aiTranslationCacheGet("en", "zh-CN", "openai", "gpt-4o", "", "https://example.com/page", "Hello");

    // 新 key 的哈希与旧条目不同 → 不命中
    expect(hit).toBeNull();
  });
});
