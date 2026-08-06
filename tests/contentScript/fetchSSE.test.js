/**
 * fetchSSE — _resolveProviderSettings 测试
 *
 * 验证 AI provider 的 API key 解析、model 选择和 baseURL 计算。
 * 这是 AI 翻译请求管道的核心逻辑，覆盖 legacy key 回退、providerConfigs
 * 优先、OpenRouter 特殊处理等关键路径。
 *
 * P5.1 — 发现于 /qa on 2026-07-03
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const configValues = {
    aiProvider: "openai",
    providerConfigs: {},
    apiKeyOpenAI: "",
    openAiModel: "",
    openRouterApiBase: "",
    azureOpenAIEndpoint: "",
    azureOpenAIModel: "",
  };
  return { configValues };
});

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: vi.fn((key) => mockState.configValues[key]),
    set: vi.fn((key, value) => { mockState.configValues[key] = value; }),
    onReady: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../../src/lib/ai/providerRegistry.js", () => {
  const providers = {
    openai: { id: "openai", name: "OpenAI", apiBase: "https://api.openai.com/v1/chat/completions", responseFormat: "openai-sse" },
    openrouter: { id: "openrouter", name: "OpenRouter", apiBase: "https://openrouter.ai/api/v1/chat/completions", responseFormat: "openai-sse" },
    anthropic: { id: "anthropic", name: "Anthropic", apiBase: "https://api.anthropic.com/v1/messages", responseFormat: "anthropic-messages" },
    "azure-openai": { id: "azure-openai", name: "Azure OpenAI", apiBase: "https://example.openai.azure.com/openai/deployments/gpt-4/chat/completions?api-version=2024-02-01", responseFormat: "openai-sse" },
    deepseek: { id: "deepseek", name: "DeepSeek", apiBase: "https://api.deepseek.com/v1/chat/completions", responseFormat: "openai-sse" },
    grok: { id: "grok", name: "Grok", apiBase: "https://api.x.ai/v1/chat/completions", responseFormat: "openai-sse" },
    "google-gemini": { id: "google-gemini", name: "Google Gemini", apiBase: "https://generativelanguage.googleapis.com/v1beta", responseFormat: "gemini-json" },
    google: null, // models.dev ID "google" 在 registry 中不存在，模拟真实行为
  };
  return {
    createProviderRegistry: () => ({
      getProvider: (id) => providers[id] || null,
    }),
    BUILT_IN_PROVIDERS: Object.values(providers),
  };
});

vi.mock("../../src/lib/ai/providerTypes.js", () => ({}));
vi.mock("../../src/lib/ai/providerModelPreview.js", () => ({}));

// Mock chrome API
vi.stubGlobal("chrome", {
  runtime: { sendMessage: vi.fn(), id: "test-id" },
  i18n: { getMessage: vi.fn((k) => k) },
});

let _resolveProviderSettings, shouldIgnoreTransportError, deliverTransformed, isDeliverableRawStreamChunk;
const ensureConfigString = vi.fn(() => ""); // default: no key available

beforeAll(async () => {
  const mod = await import("../../src/contentScript/fetchSSE.js");
  _resolveProviderSettings = mod._resolveProviderSettings;
  shouldIgnoreTransportError = mod.shouldIgnoreTransportError;
  deliverTransformed = mod.deliverTransformed;
  isDeliverableRawStreamChunk = mod.isDeliverableRawStreamChunk;
});

describe("_resolveProviderSettings — API key resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.configValues.providerConfigs = {};
    mockState.configValues.apiKeyOpenAI = "";
    mockState.configValues.openAiModel = "";
  });

  it("resolves API key from providerConfigs (new format)", () => {
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-new-format-key", model: "gpt-4o" },
    };

    const result = _resolveProviderSettings("openai", ensureConfigString);
    expect(result).not.toBeNull();
    expect(result.apiKey).toBe("sk-new-format-key");
    expect(result.model).toBe("gpt-4o");
  });

  it("returns null when no API key is configured and user cancels prompt", () => {
    // ensureConfigString returns "" (simulating user cancel)
    const result = _resolveProviderSettings("openai", ensureConfigString);
    expect(result).toBeNull();
  });
});

describe("_resolveProviderSettings — model resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.configValues.providerConfigs = {};
    mockState.configValues.openAiModel = "";
  });

  it("uses model from providerConfigs first", () => {
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-test", model: "gpt-4-turbo" },
    };

    const result = _resolveProviderSettings("openai", ensureConfigString);
    expect(result.model).toBe("gpt-4-turbo");
  });
});

describe("_resolveProviderSettings — baseURL computation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-test", model: "gpt-4o" },
    };
  });

  it("computes baseURL from provider definition apiBase for OpenAI-compatible providers", () => {
    const result = _resolveProviderSettings("openai", ensureConfigString);
    // OpenAI: origin + "/v1"
    expect(result.extra.baseURL).toBe("https://api.openai.com/v1");
  });

  it("computes baseURL for Anthropic", () => {
    mockState.configValues.providerConfigs = {
      anthropic: { apiKey: "sk-ant-test", model: "claude-haiku" },
    };
    const result = _resolveProviderSettings("anthropic", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://api.anthropic.com/v1");
  });

  it("uses user-custom API base from providerConfigs", () => {
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-test", model: "gpt-4o", apiBase: "https://my-proxy.example.com/v1/chat/completions" },
    };
    const result = _resolveProviderSettings("openai", ensureConfigString);
    // 用户自定义 base：去掉 /chat/completions 后缀，保留 /v1
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1");
  });

  it("为 google-gemini 设置用户自定义 baseURL（gemini-json 格式也应传递 baseURL）", () => {
    // 回归测试：修复 Google 自定义 endpoint URL 不生效的 bug
    mockState.configValues.providerConfigs = {
      "google-gemini": { apiKey: "AIza-test", model: "gemini-2.5-flash", apiBase: "https://api.teamorouter.com/" },
    };
    const result = _resolveProviderSettings("google-gemini", ensureConfigString);
    // 用户输入无版本路径 → 自动补全 /v1beta
    expect(result.extra.baseURL).toBe("https://api.teamorouter.com/v1beta");
  });

  it("为 models.dev ID 'google' 设置用户自定义 baseURL", () => {
    // 当 provider 来自 models.dev 时，providerDef 可能不存在
    mockState.configValues.providerConfigs = {
      google: { apiKey: "AIza-test", model: "gemini-2.5-flash", apiBase: "https://api.teamorouter.com/v1beta" },
    };
    const result = _resolveProviderSettings("google", ensureConfigString);
    // 用户输入已含 /v1beta → 不变
    expect(result.extra.baseURL).toBe("https://api.teamorouter.com/v1beta");
  });

  it("google-gemini 无自定义 URL 时不设置 extra.baseURL（交由 SDK 使用默认值）", () => {
    mockState.configValues.providerConfigs = {
      "google-gemini": { apiKey: "AIza-test", model: "gemini-2.5-flash" },
    };
    const result = _resolveProviderSettings("google-gemini", ensureConfigString);
    expect(result.extra.baseURL).toBeUndefined();
  });

  // ── 版本路径自动补全测试 ──────────────────────────────

  it("OpenAI + 无版本路径 URL → 自动补全 /v1", () => {
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-test", model: "gpt-4o", apiBase: "https://my-proxy.example.com/" },
    };
    const result = _resolveProviderSettings("openai", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1");
  });

  it("OpenAI + 无尾部斜杠 URL → 自动补全 /v1", () => {
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-test", model: "gpt-4o", apiBase: "https://my-proxy.example.com" },
    };
    const result = _resolveProviderSettings("openai", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1");
  });

  it("OpenAI + 已含 /v1 → 不变", () => {
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-test", model: "gpt-4o", apiBase: "https://my-proxy.example.com/v1" },
    };
    const result = _resolveProviderSettings("openai", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1");
  });

  it("OpenAI + 含 /v1/chat/completions → 去除后缀后保留 /v1", () => {
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-test", model: "gpt-4o", apiBase: "https://my-proxy.example.com/v1/chat/completions" },
    };
    const result = _resolveProviderSettings("openai", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1");
  });

  it("Anthropic + 无版本路径 URL → 自动补全 /v1", () => {
    mockState.configValues.providerConfigs = {
      anthropic: { apiKey: "sk-ant-test", model: "claude-haiku", apiBase: "https://my-proxy.example.com/" },
    };
    const result = _resolveProviderSettings("anthropic", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1");
  });

  it("Anthropic + 含 /messages 后缀 → 去除后缀并补全 /v1", () => {
    mockState.configValues.providerConfigs = {
      anthropic: { apiKey: "sk-ant-test", model: "claude-haiku", apiBase: "https://my-proxy.example.com/v1/messages" },
    };
    const result = _resolveProviderSettings("anthropic", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1");
  });

  it("Google + 无版本路径 URL → 自动补全 /v1beta", () => {
    mockState.configValues.providerConfigs = {
      "google-gemini": { apiKey: "AIza-test", model: "gemini-2.5-flash", apiBase: "https://my-proxy.example.com/" },
    };
    const result = _resolveProviderSettings("google-gemini", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1beta");
  });

  it("Google (models.dev ID) + 无版本路径 URL → 自动补全 /v1beta", () => {
    // providerDef 不存在时（models.dev ID），通过 providerId 判断 Google 类型
    mockState.configValues.providerConfigs = {
      google: { apiKey: "AIza-test", model: "gemini-2.5-flash", apiBase: "https://my-proxy.example.com" },
    };
    const result = _resolveProviderSettings("google", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1beta");
  });

  it("Google + 已含 /v1beta → 不变", () => {
    mockState.configValues.providerConfigs = {
      "google-gemini": { apiKey: "AIza-test", model: "gemini-2.5-flash", apiBase: "https://my-proxy.example.com/v1beta" },
    };
    const result = _resolveProviderSettings("google-gemini", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1beta");
  });

  it("DeepSeek + 无版本路径 URL → 自动补全 /v1", () => {
    mockState.configValues.providerConfigs = {
      deepseek: { apiKey: "sk-ds-test", model: "deepseek-chat", apiBase: "https://my-proxy.example.com/" },
    };
    const result = _resolveProviderSettings("deepseek", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v1");
  });

  it("已有 /v2 版本路径 → 不追加 /v1", () => {
    // 假设未来某个 provider 使用 /v2 路径
    mockState.configValues.providerConfigs = {
      openai: { apiKey: "sk-test", model: "gpt-4o", apiBase: "https://my-proxy.example.com/v2" },
    };
    const result = _resolveProviderSettings("openai", ensureConfigString);
    expect(result.extra.baseURL).toBe("https://my-proxy.example.com/v2");
  });
});

describe("_resolveProviderSettings — OpenRouter special handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.configValues.providerConfigs = {};
    mockState.configValues.openRouterApiBase = "";
  });

  it("strips openrouter/ prefix from model", () => {
    mockState.configValues.providerConfigs = {
      openrouter: { apiKey: "sk-or-test", model: "openrouter/openai/gpt-4o-mini" },
    };

    const result = _resolveProviderSettings("openrouter", ensureConfigString);
    expect(result.model).toBe("openai/gpt-4o-mini"); // prefix stripped
  });

  it("defaults model to openai/gpt-4o-mini when no model configured", () => {
    mockState.configValues.providerConfigs = {
      openrouter: { apiKey: "sk-or-test", model: "" },
    };

    const result = _resolveProviderSettings("openrouter", ensureConfigString);
    expect(result.model).toBe("openai/gpt-4o-mini");
  });
});

// ── P1 #3: translateWithAI 助手函数测试 ──

describe("shouldIgnoreTransportError", () => {
  it("returns true for AbortError", () => {
    expect(shouldIgnoreTransportError({ name: "AbortError" })).toBe(true);
  });

  it("returns true for CanceledError", () => {
    expect(shouldIgnoreTransportError({ name: "CanceledError" })).toBe(true);
  });

  it("returns true when error name is nested in error.error.name", () => {
    expect(shouldIgnoreTransportError({ error: { name: "AbortError" } })).toBe(true);
  });

  it("returns false for regular errors", () => {
    expect(shouldIgnoreTransportError({ name: "NetworkError" })).toBe(false);
    expect(shouldIgnoreTransportError(new Error("timeout"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(shouldIgnoreTransportError(null)).toBe(false);
    expect(shouldIgnoreTransportError(undefined)).toBe(false);
  });
});

describe("isDeliverableRawStreamChunk", () => {
  it("returns true for [DONE]", () => {
    expect(isDeliverableRawStreamChunk("[DONE]")).toBe(true);
  });

  it("returns true for valid JSON", () => {
    expect(isDeliverableRawStreamChunk('{"choices":[{"delta":{"content":"hi"}}]}')).toBe(true);
  });

  it("returns false for non-JSON plain text", () => {
    expect(isDeliverableRawStreamChunk("plain text not json")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isDeliverableRawStreamChunk("")).toBe(false);
    expect(isDeliverableRawStreamChunk("   ")).toBe(false);
  });

  it("returns true for non-string (e.g., already parsed object)", () => {
    expect(isDeliverableRawStreamChunk({ choices: [] })).toBe(true);
  });
});

describe("deliverTransformed", () => {
  it("calls onMessage with string payload", () => {
    const onMessage = vi.fn();
    deliverTransformed("hello", onMessage);
    expect(onMessage).toHaveBeenCalledWith("hello");
  });

  it("converts non-string to string", () => {
    const onMessage = vi.fn();
    deliverTransformed(42, onMessage);
    expect(onMessage).toHaveBeenCalledWith("42");
  });

  it("recursively delivers array payloads", () => {
    const onMessage = vi.fn();
    deliverTransformed(["a", "b", "c"], onMessage);
    expect(onMessage).toHaveBeenCalledTimes(3);
    expect(onMessage).toHaveBeenCalledWith("a");
    expect(onMessage).toHaveBeenCalledWith("b");
    expect(onMessage).toHaveBeenCalledWith("c");
  });

  it("skips null and empty strings", () => {
    const onMessage = vi.fn();
    deliverTransformed(null, onMessage);
    deliverTransformed("", onMessage);
    deliverTransformed(undefined, onMessage);
    expect(onMessage).not.toHaveBeenCalled();
  });
});
