/**
 * aiProxyReasoningDepth.test.js
 *
 * 责任：验证推理深度从 port 消息 → streamText providerOptions 的整条映射链
 * （plan 32）。SDK 用 zod 校验 providerOptions：值/键不对会抛
 * `invalid provider options` 并**中断整个翻译请求**，而键不对会被**静默丢弃**
 * （探针实锤）。因此本文件同时锁定「发什么」和「不发什么」。
 *
 * 关键断言：
 *   - 深度为空 → 不发 providerOptions（保持现状行为）
 *   - 每个方言的 providerOptions 形状（与 reasoningDepth.js 的金值一致）
 *   - 方言由 models.dev 的 npm 决定（与 createModelClient 同一判据，防 #88 漂移）
 *   - 会被 SDK 拒绝的值 → 不发（请求仍成功，只是没有推理提示）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const $ = vi.hoisted(() => ({}));

function makeSdkFactory() {
  return vi.fn((opts) => (model) => ({ ...opts, model, __sdkOpts: opts }));
}

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: makeSdkFactory() }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: makeSdkFactory() }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: makeSdkFactory() }));
vi.mock("@ai-sdk/deepseek", () => ({ createDeepSeek: makeSdkFactory() }));
vi.mock("@ai-sdk/xai", () => ({ createXai: makeSdkFactory() }));
vi.mock("@ai-sdk/azure", () => ({ createAzure: makeSdkFactory() }));
vi.mock("@ai-sdk/mistral", () => ({ createMistral: makeSdkFactory() }));
vi.mock("@ai-sdk/cohere", () => ({ createCohere: makeSdkFactory() }));
vi.mock("@ai-sdk/togetherai", () => ({ createTogetherAI: makeSdkFactory() }));
vi.mock("@ai-sdk/groq", () => ({ createGroq: makeSdkFactory() }));
vi.mock("@ai-sdk/perplexity", () => ({ createPerplexity: makeSdkFactory() }));
vi.mock("@ai-sdk/deepinfra", () => ({ createDeepInfra: makeSdkFactory() }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: makeSdkFactory() }));

// streamText 捕获调用参数；fullStream 直接完成（0 chunk → 代理会报 "No response"，
// 但我们只断言 streamText 收到的参数，与流结果无关）。
vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    fullStream: (async function* () {})(),
  })),
}));

function buildModelsDevCache(overrides = {}) {
  const base = {};
  for (let i = 0; i < 12; i++) {
    base[`_pad_${i}`] = { npm: "@ai-sdk/openai", api: `https://pad${i}.example.com/v1` };
  }
  return { ...base, ...overrides };
}

const mockStorage = {};

describe("aiProxy — reasoning depth → streamText providerOptions", () => {
  let streamTextMock;
  let aiProxy;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockStorage)) delete mockStorage[k];
    vi.resetModules();

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn((key) => Promise.resolve({ [key]: mockStorage[key] })),
          set: vi.fn((obj) => { Object.assign(mockStorage, obj); return Promise.resolve(); }),
        },
      },
      runtime: {
        onConnect: { addListener: vi.fn() },
      },
    });

    const aiMod = await import("ai");
    streamTextMock = aiMod.streamText;
    aiProxy = await import("../../src/background/aiProxy.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * aiProxy 目前只通过 chrome.runtime.onConnect 暴露入口。测试需要直接调用
   * 注册的 listener —— 用 onConnect.addListener 捕获。
   */
  async function loadWithListener() {
    const mod = await import("../../src/background/aiProxy.js");
    const addListener = chrome.runtime.onConnect.addListener;
    const onConnect = addListener.mock.calls.at(-1)?.[0];
    return { mod, onConnect };
  }

  const BASE_MSG = {
    type: "start",
    id: "req-1",
    apiKey: "k",
    messages: [{ role: "user", content: "hi" }],
    model: "some-model",
  };

  async function runStart(extraMsg, npm) {
    mockStorage["modelsdev:providers"] = {
      data: buildModelsDevCache(npm ? { [extraMsg.provider]: { npm } } : {}),
      ts: Date.now(),
    };
    const { onConnect } = await loadWithListener();
    const listeners = { message: [] };
    const port = {
      name: "ai-sse",
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn((fn) => listeners.message.push(fn)) },
      onDisconnect: { addListener: vi.fn() },
    };
    onConnect(port);
    for (const fn of listeners.message) {
      await fn({ ...BASE_MSG, ...extraMsg });
    }
    return streamTextMock.mock.calls.at(-1)?.[0];
  }

  it("sends NO providerOptions when the depth is empty (legacy behavior preserved)", async () => {
    const args = await runStart({ provider: "openai", reasoningDepth: "" }, "@ai-sdk/openai");
    expect(args).toBeTruthy();
    expect(args).not.toHaveProperty("providerOptions");
  });

  it("sends NO providerOptions when the depth field is absent entirely", async () => {
    const args = await runStart({ provider: "openai" }, "@ai-sdk/openai");
    expect(args).not.toHaveProperty("providerOptions");
  });

  it("maps openai depth to { openai: { reasoningEffort } }", async () => {
    const args = await runStart({ provider: "openai", reasoningDepth: "high" }, "@ai-sdk/openai");
    expect(args.providerOptions).toEqual({ openai: { reasoningEffort: "high" } });
  });

  it("maps anthropic depth to { anthropic: { effort } } via the models.dev npm", async () => {
    const args = await runStart({ provider: "anthropic", reasoningDepth: "xhigh" }, "@ai-sdk/anthropic");
    expect(args.providerOptions).toEqual({ anthropic: { effort: "xhigh" } });
  });

  it("maps google-gemini depth to { google: { thinkingConfig: { thinkingLevel } } } through the alias (#88)", async () => {
    // models.dev keys google as "google" while the internal id is "google-gemini"
    mockStorage["modelsdev:providers"] = {
      data: buildModelsDevCache({ google: { npm: "@ai-sdk/google" } }),
      ts: Date.now(),
    };
    const { onConnect } = await loadWithListener();
    const listeners = { message: [] };
    const port = {
      name: "ai-sse",
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn((fn) => listeners.message.push(fn)) },
      onDisconnect: { addListener: vi.fn() },
    };
    onConnect(port);
    for (const fn of listeners.message) {
      await fn({ ...BASE_MSG, provider: "google-gemini", reasoningDepth: "medium" });
    }
    const args = streamTextMock.mock.calls.at(-1)?.[0];
    expect(args.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: "medium" } } });
  });

  it("uses the openaiCompatible key for dynamically discovered providers, never a brand name", async () => {
    const args = await runStart({ provider: "zhipu", reasoningDepth: "high" }, "@ai-sdk/openai-compatible");
    expect(args.providerOptions).toEqual({ openaiCompatible: { reasoningEffort: "high" } });
    expect(args.providerOptions).not.toHaveProperty("zhipu");
  });

  // 防「把非法值送进 SDK → zod 抛错 → 整个请求崩掉」
  it("omits providerOptions for a value the dialect rejects (request must still go out)", async () => {
    const args = await runStart({ provider: "mistral", reasoningDepth: "max" }, "@ai-sdk/mistral");
    expect(args).toBeTruthy(); // 请求仍然发出
    expect(args).not.toHaveProperty("providerOptions");
  });

  it("still passes temperature, topP and messages unchanged alongside providerOptions", async () => {
    const args = await runStart({ provider: "openai", reasoningDepth: "low" }, "@ai-sdk/openai");
    expect(args.messages).toEqual(BASE_MSG.messages);
    expect(args.temperature).toBe(0.1);
    expect(args.topP).toBe(0.1);
    expect(args.maxRetries).toBe(0);
  });
});
