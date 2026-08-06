/**
 * createModelClient apiBase 优先级链测试。
 *
 * 验证 apiBase 的三级 fallback 逻辑：
 *   C4.1: extra.baseURL 优先于 models.dev api
 *   C4.2: 无 extra.baseURL 时使用 models.dev api
 *   C4.3: 所有来源均无 apiBase 时抛出错误
 *
 * createModelClient 函数位于 src/background/aiProxy.js，动态映射 models.dev
 * npm 字段到 AI SDK 客户端工厂函数，优先级链为：
 *   extra.baseURL → models.dev api → lookupKnownApiBase() → 抛出错误
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock 容器（由 vi.mock 工厂在每次 import 时重新赋值）──

const $ = vi.hoisted(() => ({}));

// 工具函数：创建 SDK 工厂 mock（返回一个可配置的模拟语言模型）
function makeSdkFactory() {
  return vi.fn((opts) => (model) => ({ ...opts, model }));
}

// ── Mock 所有 @ai-sdk/* 包 ────────────────────────────
// 各 mock 工厂在模块导入时运行，将创建的 vi.fn() 存入 $.xxx
// vi.resetModules() 后下次 import 会重新触发工厂，生成全新 mock 实例

vi.mock("@ai-sdk/deepseek", () => {
  const fn = makeSdkFactory();
  $.createDeepSeek = fn;
  return { createDeepSeek: fn };
});

vi.mock("@ai-sdk/openai", () => {
  const fn = makeSdkFactory();
  $.createOpenAI = fn;
  return { createOpenAI: fn };
});

vi.mock("@ai-sdk/openai-compatible", () => {
  const fn = makeSdkFactory();
  $.createOpenAICompatible = fn;
  return { createOpenAICompatible: fn };
});

vi.mock("@ai-sdk/anthropic", () => {
  $.createAnthropic = makeSdkFactory();
  return { createAnthropic: $.createAnthropic };
});

vi.mock("@ai-sdk/google", () => {
  $.createGoogleGenerativeAI = makeSdkFactory();
  return { createGoogleGenerativeAI: $.createGoogleGenerativeAI };
});

vi.mock("@ai-sdk/xai", () => {
  $.createXai = makeSdkFactory();
  return { createXai: $.createXai };
});

vi.mock("@ai-sdk/azure", () => {
  $.createAzure = makeSdkFactory();
  return { createAzure: $.createAzure };
});

vi.mock("@ai-sdk/mistral", () => {
  $.createMistral = makeSdkFactory();
  return { createMistral: $.createMistral };
});

vi.mock("@ai-sdk/cohere", () => {
  $.createCohere = makeSdkFactory();
  return { createCohere: $.createCohere };
});

vi.mock("@ai-sdk/togetherai", () => {
  $.createTogetherAI = makeSdkFactory();
  return { createTogetherAI: $.createTogetherAI };
});

vi.mock("@ai-sdk/groq", () => {
  $.createGroq = makeSdkFactory();
  return { createGroq: $.createGroq };
});

vi.mock("@ai-sdk/perplexity", () => {
  $.createPerplexity = makeSdkFactory();
  return { createPerplexity: $.createPerplexity };
});

vi.mock("@ai-sdk/deepinfra", () => {
  $.createDeepInfra = makeSdkFactory();
  return { createDeepInfra: $.createDeepInfra };
});

vi.mock("ai", () => ({
  streamText: vi.fn(),
}));

// ── 辅助函数 ──────────────────────────────────────────

/** 构建至少 12 条填充条目以确保通过 getProvidersData 的 >10 门槛 */
function buildModelsDevCache(overrides = {}) {
  const base = {};
  for (let i = 0; i < 12; i++) {
    base[`_pad_${i}`] = {
      npm: "@ai-sdk/openai",
      api: `https://pad${i}.example.com/v1`,
    };
  }
  return { ...base, ...overrides };
}

// ── 共享的 mock storage 对象 ──────────────────────────

const mockStorage = {};

// ── 测试套件 ──────────────────────────────────────────

describe("createModelClient apiBase priority chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 清空 mock storage
    for (const k of Object.keys(mockStorage)) {
      delete mockStorage[k];
    }
    vi.resetModules();

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn((key) => Promise.resolve({ [key]: mockStorage[key] })),
          set: vi.fn((obj) => {
            Object.assign(mockStorage, obj);
            return Promise.resolve();
          }),
        },
      },
      runtime: {
        onConnect: {
          addListener: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 动态导入 createModelClient，确保每次测试使用全新模块状态 */
  async function loadModule() {
    const mod = await import("../../src/background/aiProxy.js");
    return mod.createModelClient;
  }

  // ── C4.1 ────────────────────────────────────────────

  it("C4.1: extra.baseURL takes priority over models.dev api when both are available", async () => {
    mockStorage["modelsdev:providers"] = {
      data: buildModelsDevCache({
        deepseek: {
          npm: "@ai-sdk/deepseek",
          api: "https://models-dev-deepseek.example.com/v1",
        },
      }),
      ts: Date.now(),
    };

    const createModelClient = await loadModule();

    await createModelClient({
      provider: "deepseek",
      apiKey: "sk-test-key",
      model: "deepseek-chat",
      extra: { baseURL: "https://custom-base.example.com/v1" },
    });

    // 应使用 extra.baseURL，而非 models.dev 的 api
    expect($.createDeepSeek).toHaveBeenCalledTimes(1);
    expect($.createDeepSeek).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test-key",
        baseURL: "https://custom-base.example.com/v1",
      })
    );
  });

  // ── C4.2 ────────────────────────────────────────────

  it("C4.2: falls back to models.dev api when extra has no baseURL", async () => {
    mockStorage["modelsdev:providers"] = {
      data: buildModelsDevCache({
        deepseek: {
          npm: "@ai-sdk/deepseek",
          api: "https://models-dev-deepseek.example.com/v1",
        },
      }),
      ts: Date.now(),
    };

    const createModelClient = await loadModule();

    await createModelClient({
      provider: "deepseek",
      apiKey: "sk-test-key",
      model: "deepseek-chat",
      extra: {}, // 无 baseURL，应回退到 models.dev api
    });

    expect($.createDeepSeek).toHaveBeenCalledTimes(1);
    expect($.createDeepSeek).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test-key",
        baseURL: "https://models-dev-deepseek.example.com/v1",
      })
    );
  });

  // ── C4.3 ────────────────────────────────────────────

  it("C4.3: throws when models.dev has no data for provider and no baseURL is set", async () => {
    // 缓存中有 12+ 条目（通过 >10 门槛），但不包含 "unknown-provider"
    mockStorage["modelsdev:providers"] = {
      data: buildModelsDevCache(),
      ts: Date.now(),
    };

    const createModelClient = await loadModule();

    // 未知 provider + 无 extra.baseURL → 应抛出错误
    await expect(
      createModelClient({
        provider: "unknown-provider",
        apiKey: "sk-test-key",
        model: "some-model",
      })
    ).rejects.toThrow(/Unknown AI provider/);
  });
});
