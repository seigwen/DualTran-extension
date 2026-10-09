import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const configState = {};
  return {
    configState,
    configGet: vi.fn((key) => configState[key]),
    configSet: vi.fn((key, value) => {
      configState[key] = value;
    }),
    detectTextLanguage: vi.fn(async () => ({ lang: "en" })),
    fetchSSE: vi.fn(),
    codeToLanguageNameInEnglish: vi.fn((code) => {
      // Mock mirrors the real twpLang mapping (including the codes that matter
      // to the #151 word-path gate cells: sr must map to "Serbian" — the exact
      // name the user saw in the leaked dictionary role).
      const names = { en: "English", fr: "French", sr: "Serbian", "zh-CN": "Chinese (Simplified)" };
      return names[code] || code;
    }),
  };
});

vi.mock("../../src/lib/config.js", () => ({
  default: { get: mocks.configGet, set: mocks.configSet },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    otherConfigs: {},
    codeToLanguageNameInEnglish: mocks.codeToLanguageNameInEnglish,
  },
}));

vi.mock("../../src/util/detectTextLanguage.js", () => ({
  default: mocks.detectTextLanguage,
}));

vi.mock("../../src/lib/ai/sseClient.js", () => ({
  fetchSSE: mocks.fetchSSE,
}));

vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({
    getProvider: (id) => {
      const providers = {
        openai: { id: "openai", name: "OpenAI", responseFormat: "openai-sse", apiBase: "https://api.openai.com/v1/chat/completions", auth: { type: "bearer", header: "Authorization", prefix: "Bearer " } },
        openrouter: { id: "openrouter", name: "OpenRouter", responseFormat: "openai-sse", apiBase: "https://openrouter.ai/api/v1/chat/completions", auth: { type: "bearer", header: "Authorization", prefix: "Bearer " } },
        deepseek: { id: "deepseek", name: "DeepSeek", responseFormat: "openai-sse", apiBase: "https://api.deepseek.com/v1/chat/completions", auth: { type: "bearer", header: "Authorization", prefix: "Bearer " } },
        grok: { id: "grok", name: "xAI (Grok)", responseFormat: "openai-sse", apiBase: "https://api.x.ai/v1/chat/completions", auth: { type: "bearer", header: "Authorization", prefix: "Bearer " } },
        anthropic: { id: "anthropic", name: "Anthropic", responseFormat: "anthropic-sse", apiBase: "https://api.anthropic.com/v1/messages", auth: { type: "api-key-header", header: "x-api-key" } },
        "google-gemini": { id: "google-gemini", name: "Google Gemini", responseFormat: "gemini-json", apiBase: "https://generativelanguage.googleapis.com/v1beta", auth: { type: "query-param", header: "", queryParam: "key" } },
        "azure-openai": { id: "azure-openai", name: "Azure OpenAI", responseFormat: "openai-json", apiBase: "", auth: { type: "api-key-header", header: "api-key" } },
      };
      return providers[id] || undefined;
    },
    listProviders: () => [],
    _updateMerged: () => {},
    _getMerged: () => [],
  }),
  BUILT_IN_PROVIDERS: [],
  mergeRegistries: () => [],
}));

vi.mock("../../src/lib/ai/providerTypes.js", () => ({
  validateProviderDefinition: () => [],
}));

vi.mock("../../src/lib/i18n.js", () => ({}));

import { translateWithAI } from "../../src/contentScript/fetchSSE.js";

function setConfig(overrides) {
  Object.keys(mocks.configState).forEach((key) => { delete mocks.configState[key]; });
  Object.assign(mocks.configState, { aiProvider: "openai", targetLanguage: "fr", ...overrides });
}

// Helper: set up fetchSSE mock to deliver data via new object-style API callbacks
function mockSSESuccess(deliverChunks) {
  mocks.fetchSSE.mockImplementation(async (params) => {
    if (deliverChunks) deliverChunks(params);
    params.onFinished?.();
  });
}

function mockSSEError(errorPayload) {
  mocks.fetchSSE.mockImplementation(async (params) => {
    params.onError?.(errorPayload);
  });
}

describe("translateWithAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfig({});
    vi.spyOn(console, "log").mockImplementation(() => {});
    globalThis.window = { confirm: vi.fn(() => false) };
    globalThis.prompt = vi.fn(() => "");
    globalThis.alert = vi.fn();
    globalThis.location = { hostname: "dualtran.example" };
    globalThis.fetch = vi.fn();
    globalThis.chrome = {
      i18n: { getMessage: vi.fn(() => "") },
      runtime: {
        getManifest: vi.fn(() => ({ homepage_url: "https://dualtran.example", name: "DualTran" })),
        sendMessage: vi.fn(),
      },
    };
  });

  // ── OpenRouter ──

  it("sends OpenRouter requests with custom baseURL through the new fetchSSE API", async () => {
    setConfig({
      aiProvider: "openrouter",
      apiKeyOpenRouter: "openrouter-key",
      openRouterModel: "openrouter/openai/gpt-4o-mini",
      openRouterApiBase: "http://127.0.0.1:8787/openrouter/v1/chat/completions",
    });
    const delivered = [];

    const expectedChunk = '{"choices":[{"delta":{"content":"bonjour chunk"},"finish_reason":null}]}';

    mocks.fetchSSE.mockImplementation(async (params) => {
      params.onMessage?.("bonjour chunk");
      params.onFinished?.();
    });

    await translateWithAI("hello world", (msg) => delivered.push(msg), vi.fn(), vi.fn());

    expect(mocks.fetchSSE).toHaveBeenCalledTimes(1);
    const params = mocks.fetchSSE.mock.calls[0][0];
    expect(params.provider).toBe("openrouter");
    expect(params.apiKey).toBe("openrouter-key");
    expect(params.model).toBe("openai/gpt-4o-mini");
    expect(params.extra.baseURL).toBe("http://127.0.0.1:8787/openrouter/v1/chat/completions");
    expect(params.messages).toBeDefined();
    expect(delivered).toEqual([expectedChunk, "[DONE]"]);
  });

  it("uses the default OpenAI branch when no provider is configured", async () => {
    setConfig({ aiProvider: "", apiKeyOpenAI: "openai-key", openAiModel: "gpt-4o-mini" });

    mocks.fetchSSE.mockImplementation(async (params) => { params.onFinished?.(); });
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    const params = mocks.fetchSSE.mock.calls[0][0];
    expect(params.provider).toBe("openai");
    expect(params.apiKey).toBe("openai-key");
    expect(params.model).toBe("gpt-4o-mini");
  });

  it("opens the AI options page when the key is missing and user confirms", async () => {
    setConfig({ aiProvider: "openai", apiKeyOpenAI: "", openAiModel: "gpt-4o-mini" });
    globalThis.window.confirm.mockReturnValue(true);

    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "openOptionsPage", hash: "#ai" })
    );
    expect(mocks.fetchSSE).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("aborts silently when the key is missing and the user cancels", async () => {
    setConfig({ aiProvider: "openai", apiKeyOpenAI: "", openAiModel: "gpt-4o-mini" });
    const onError = vi.fn();
    globalThis.window.confirm.mockReturnValue(false);

    await translateWithAI("hello", vi.fn(), onError, vi.fn());

    expect(onError).not.toHaveBeenCalled();
    expect(mocks.fetchSSE).not.toHaveBeenCalled();
  });

  // ── DeepSeek ──

  it("builds the DeepSeek request through the new fetchSSE API", async () => {
    setConfig({ aiProvider: "deepseek", apiKeyDeepSeek: "deepseek-key", deepSeekModel: "deepseek-chat" });

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    const params = mocks.fetchSSE.mock.calls[0][0];
    expect(params.provider).toBe("deepseek");
    expect(params.apiKey).toBe("deepseek-key");
    expect(params.model).toBe("deepseek-chat");
    expect(params.extra.baseURL).toBe("https://api.deepseek.com/v1");
  });

  // ── Grok ──

  it("builds the Grok request through the new fetchSSE API", async () => {
    setConfig({ aiProvider: "grok", apiKeyGrok: "grok-key", grokModel: "grok-2-latest" });

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    const params = mocks.fetchSSE.mock.calls[0][0];
    expect(params.provider).toBe("grok");
    expect(params.apiKey).toBe("grok-key");
    expect(params.model).toBe("grok-2-latest");
    expect(params.extra.baseURL).toBe("https://api.x.ai/v1");
  });

  // ── Anthropic ──

  it("builds the Anthropic request with correct apiBase through the new fetchSSE API", async () => {
    setConfig({ aiProvider: "anthropic", apiKeyAnthropic: "anthropic-key", anthropicModel: "claude-sonnet-4-20250514" });

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    const params = mocks.fetchSSE.mock.calls[0][0];
    expect(params.provider).toBe("anthropic");
    expect(params.apiKey).toBe("anthropic-key");
    expect(params.model).toBe("claude-sonnet-4-20250514");
    expect(params.extra.baseURL).toBe("https://api.anthropic.com/v1");
  });

  // ── 自定义 API Base URL（通过 providerConfigs） ──

  it("uses user-custom apiBase from providerConfigs for DeepSeek", async () => {
    setConfig({
      aiProvider: "deepseek",
      apiKeyDeepSeek: "deepseek-key",
      deepSeekModel: "deepseek-chat",
      providerConfigs: {
        deepseek: { apiBase: "https://my-proxy.example.com/api" },
      },
    });

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    const params = mocks.fetchSSE.mock.calls[0][0];
    expect(params.provider).toBe("deepseek");
    // 用户自定义端点应保留完整路径结构，仅去除 /chat/completions 后缀
    expect(params.extra.baseURL).toBe("https://my-proxy.example.com/api");
  });

  it("strips /chat/completions suffix from user-custom apiBase", async () => {
    setConfig({
      aiProvider: "deepseek",
      apiKeyDeepSeek: "deepseek-key",
      deepSeekModel: "deepseek-chat",
      providerConfigs: {
        deepseek: { apiBase: "https://my-proxy.example.com/api/chat/completions" },
      },
    });

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    const params = mocks.fetchSSE.mock.calls[0][0];
    // 应去除 /chat/completions 后缀
    expect(params.extra.baseURL).toBe("https://my-proxy.example.com/api");
  });

  it("falls back to built-in apiBase when user-custom apiBase is empty", async () => {
    setConfig({
      aiProvider: "deepseek",
      apiKeyDeepSeek: "deepseek-key",
      deepSeekModel: "deepseek-chat",
      providerConfigs: {
        deepseek: { apiBase: "" },
      },
    });

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    const params = mocks.fetchSSE.mock.calls[0][0];
    // 内置默认 apiBase → origin + "/v1"
    expect(params.extra.baseURL).toBe("https://api.deepseek.com/v1");
  });

  it("uses user-custom apiBase for OpenAI-compatible providers", async () => {
    setConfig({
      aiProvider: "openai",
      apiKeyOpenAI: "openai-key",
      openAiModel: "gpt-4o-mini",
      providerConfigs: {
        openai: { apiBase: "https://custom-openai.example.com/v1/chat/completions" },
      },
    });

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    const params = mocks.fetchSSE.mock.calls[0][0];
    // OpenAI 兼容类：用户自定义端点不使用 origin + "/v1"，而是保留路径
    expect(params.extra.baseURL).toBe("https://custom-openai.example.com/v1");
  });

  // ── SSE transport error handling ──

  it("forwards SSE transport errors through onError", async () => {
    setConfig({ aiProvider: "openai", apiKeyOpenAI: "openai-key", openAiModel: "gpt-4o-mini" });
    const onError = vi.fn();

    mockSSEError({ error: { message: "SSE transport failed", code: 502 } });
    await translateWithAI("hello", vi.fn(), onError, vi.fn());

    expect(onError).toHaveBeenCalledWith({ error: { message: "SSE transport failed", code: 502 } });
  });

  it("suppresses AbortError from SSE transport", async () => {
    setConfig({ aiProvider: "openai", apiKeyOpenAI: "openai-key", openAiModel: "gpt-4o-mini" });
    const onError = vi.fn();

    mockSSEError(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    await translateWithAI("hello", vi.fn(), onError, vi.fn());

    expect(onError).not.toHaveBeenCalled();
  });

  it("suppresses CanceledError from SSE transport", async () => {
    setConfig({ aiProvider: "openai", apiKeyOpenAI: "openai-key", openAiModel: "gpt-4o-mini" });
    const onError = vi.fn();

    mockSSEError({ error: { name: "CanceledError", message: "Canceled" } });
    await translateWithAI("hello", vi.fn(), onError, vi.fn());

    expect(onError).not.toHaveBeenCalled();
  });

  // ── Google Gemini (now handled through fetchSSE like all other providers) ──

  it("sends Gemini requests through fetchSSE with provider and model", async () => {
    setConfig({ aiProvider: "google-gemini", apiKeyGoogleGemini: "gemini-key", googleGeminiModel: "gemini-2.0-flash" });
    const delivered = [];
    const onFinished = vi.fn();

    mocks.fetchSSE.mockImplementation(async (params) => {
      params.onMessage?.("bonjour");
      params.onFinished?.();
    });

    await translateWithAI("hello", (msg) => delivered.push(msg), vi.fn(), onFinished);

    expect(mocks.fetchSSE).toHaveBeenCalledTimes(1);
    const params = mocks.fetchSSE.mock.calls[0][0];
    expect(params.provider).toBe("google-gemini");
    expect(params.apiKey).toBe("gemini-key");
    expect(params.model).toBe("gemini-2.0-flash");
    expect(delivered).toEqual([
      '{"choices":[{"delta":{"content":"bonjour"},"finish_reason":null}]}',
      "[DONE]",
    ]);
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("suppresses AbortError from Gemini path", async () => {
    setConfig({ aiProvider: "google-gemini", apiKeyGoogleGemini: "gemini-key", googleGeminiModel: "gemini-2.0-flash" });
    const onError = vi.fn();
    mockSSEError(Object.assign(new Error("Aborted"), { name: "AbortError" }));

    await translateWithAI("hello", vi.fn(), onError, vi.fn());
    expect(onError).not.toHaveBeenCalled();
  });

  it("suppresses CanceledError from Gemini path", async () => {
    setConfig({ aiProvider: "google-gemini", apiKeyGoogleGemini: "gemini-key", googleGeminiModel: "gemini-2.0-flash" });
    const onError = vi.fn();
    mockSSEError({ error: { name: "CanceledError", message: "Canceled" } });

    await translateWithAI("hello", vi.fn(), onError, vi.fn());
    expect(onError).not.toHaveBeenCalled();
  });

  it("forwards non-abort Gemini errors through onError", async () => {
    setConfig({ aiProvider: "google-gemini", apiKeyGoogleGemini: "gemini-key", googleGeminiModel: "gemini-2.0-flash" });
    const onError = vi.fn();
    mockSSEError({ error: { message: "socket hang up" } });

    await translateWithAI("hello", vi.fn(), onError, vi.fn());
    expect(onError).toHaveBeenCalledWith({ error: { message: "socket hang up" } });
  });

  it("forwards Gemini error payloads through onError", async () => {
    setConfig({ aiProvider: "google-gemini", apiKeyGoogleGemini: "gemini-key", googleGeminiModel: "gemini-2.0-flash" });
    const onError = vi.fn();
    mockSSEError({ error: { message: "Gemini rate limit", status: 429 } });

    await translateWithAI("hello", vi.fn(), onError, vi.fn());
    expect(onError).toHaveBeenCalledWith({ error: { message: "Gemini rate limit", status: 429 } });
  });

  it("falls back to HTTP status error for Gemini", async () => {
    setConfig({ aiProvider: "google-gemini", apiKeyGoogleGemini: "gemini-key", googleGeminiModel: "gemini-2.0-flash" });
    const onError = vi.fn();
    mockSSEError({ error: { message: "HTTP 503", status: 503 } });

    await translateWithAI("hello", vi.fn(), onError, vi.fn());
    expect(onError).toHaveBeenCalledWith({ error: { message: "HTTP 503", status: 503 } });
  });

  it("reports empty Gemini responses as provider errors", async () => {
    setConfig({ aiProvider: "google-gemini", apiKeyGoogleGemini: "gemini-key", googleGeminiModel: "gemini-2.0-flash" });
    const onError = vi.fn();
    mockSSEError({ error: { message: "Empty response from AI provider" } });

    await translateWithAI("hello", vi.fn(), onError, vi.fn());
    expect(onError).toHaveBeenCalledWith({ error: { message: "Empty response from AI provider" } });
  });

  // ── Azure OpenAI ──

  it("reports missing Azure OpenAI endpoint before any request", async () => {
    setConfig({ aiProvider: "azure-openai", apiKeyAzureOpenAI: "azure-key", azureOpenAIEndpoint: "", azureOpenAIModel: "gpt-4o-mini" });
    const onError = vi.fn();
    globalThis.prompt.mockReturnValue("");

    await translateWithAI("hello", vi.fn(), onError, vi.fn());

    expect(onError).toHaveBeenCalledWith({ error: { message: "Azure OpenAI endpoint is not configured." } });
    expect(mocks.fetchSSE).not.toHaveBeenCalled();
  });

  it("sanitizes Azure endpoint before sending", async () => {
    setConfig({ aiProvider: "azure-openai", apiKeyAzureOpenAI: "azure-key", azureOpenAIEndpoint: "https://dualtran.openai.azure.com///", azureOpenAIModel: "gpt-4o-mini" });

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    expect(mocks.configSet).toHaveBeenCalledWith("azureOpenAIEndpoint", "https://dualtran.openai.azure.com");
    const params = mocks.fetchSSE.mock.calls[0][0];
    expect(params.provider).toBe("azure-openai");
    expect(params.apiKey).toBe("azure-key");
  });

  it("reports missing Azure deployment before sending", async () => {
    setConfig({ aiProvider: "azure-openai", apiKeyAzureOpenAI: "azure-key", azureOpenAIEndpoint: "https://dualtran.openai.azure.com", azureOpenAIModel: "" });
    const onError = vi.fn();
    globalThis.prompt.mockReturnValue("   ");

    await translateWithAI("hello", vi.fn(), onError, vi.fn());
    expect(onError).toHaveBeenCalledWith({ error: { message: "Azure OpenAI deployment is required." } });
  });

  it("prompts for missing Azure deployment and persists it", async () => {
    setConfig({ aiProvider: "azure-openai", apiKeyAzureOpenAI: "azure-key", azureOpenAIEndpoint: "https://dualtran.openai.azure.com", azureOpenAIModel: "" });
    globalThis.prompt.mockReturnValue("gpt-4o-prod");

    mockSSESuccess();
    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());

    expect(mocks.configSet).toHaveBeenCalledWith("azureOpenAIModel", "gpt-4o-prod");
  });

  // ── Target language ──

  it("alerts and returns early when no target language is configured", async () => {
    setConfig({ aiProvider: "openai", apiKeyOpenAI: "openai-key", targetLanguage: null });

    const result = await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());
    expect(result).toBe(true);
    expect(globalThis.alert).toHaveBeenCalledOnce();
  });

  it("opens AI settings instead of prompting when Gemini key is missing", async () => {
    setConfig({ aiProvider: "google-gemini", apiKeyGoogleGemini: "", googleGeminiModel: "gemini-2.0-flash" });
    globalThis.window.confirm.mockReturnValue(true);

    await translateWithAI("hello", vi.fn(), vi.fn(), vi.fn());
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "openOptionsPage", hash: "#ai" })
    );
    expect(mocks.fetchSSE).not.toHaveBeenCalled();
  });
});

// ── P1 #151: 单词路径源语言闸门（plan 43） ──────────────────────────
//
// 用户症状：选中 "Undertow" 走 AI 单词路径，输出在英文/中文之上叠加一整层
// 塞尔维亚语（西里尔 + 拉丁混排）。根因：单词词典提示词把
// chrome.i18n.detectLanguage 的读数直接写死为
// "professional <source>-<target> dictionary"——孤立单词的 CLD 读数常年
// 不可信且错误（实测 Undertow / hello -> "sr"），模型随即按角色要求补出该语言。
// 规则：只有 isReliable === true 且语言码 ≠ "und" 的读数才允许进入提示词；
// 否则走语言中立句（模型自识词语言，[<language>] 字段本就要求自报）。

describe("word-path source-language gate (#151)", () => {
  const NEUTRAL_MARKER = "professional bilingual dictionary translating the word";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    globalThis.window = { confirm: vi.fn(() => false) };
    globalThis.prompt = vi.fn(() => "");
    globalThis.alert = vi.fn();
    globalThis.location = { hostname: "dualtran.example" };
    globalThis.fetch = vi.fn();
    globalThis.chrome = {
      i18n: { getMessage: vi.fn(() => "") },
      runtime: {
        getManifest: vi.fn(() => ({ homepage_url: "https://dualtran.example", name: "DualTran" })),
        sendMessage: vi.fn(),
      },
    };
  });

  /** 走单词路径发一次请求，返回实际发给传输层的 system prompt（messages[0]）。 */
  async function captureWordPrompt(content, targetLanguage = "zh-CN") {
    setConfig({
      aiProvider: "openai",
      apiKeyOpenAI: "openai-key",
      openAiModel: "gpt-4o-mini",
      targetLanguage,
    });
    mockSSESuccess();
    await translateWithAI(content, vi.fn(), vi.fn(), vi.fn(), undefined, true);
    expect(mocks.fetchSSE).toHaveBeenCalledTimes(1);
    return mocks.fetchSSE.mock.calls[0][0].messages[0].content;
  }

  it("W1: an unreliable CLD reading must not pin the bogus language into the prompt", async () => {
    // 用户实测：CLD("Undertow") -> { language: "sr", isReliable: false }
    mocks.detectTextLanguage.mockResolvedValue({ lang: "sr", isReliable: false });

    const system = await captureWordPrompt("Undertow");

    expect(system).not.toContain("Serbian");
    expect(system).toContain(NEUTRAL_MARKER);
  });

  it("W2: an 'und' reading no longer falls back to a hardcoded English source", async () => {
    mocks.detectTextLanguage.mockResolvedValue({ lang: "und", isReliable: false });

    const system = await captureWordPrompt("Undertow");

    expect(system).not.toContain("English-");
    expect(system).toContain(NEUTRAL_MARKER);
  });

  it("W3: a reliable reading still names the source language (control)", async () => {
    mocks.detectTextLanguage.mockResolvedValue({ lang: "en", isReliable: true });

    const system = await captureWordPrompt("Undertow");

    expect(system).toContain("English-Chinese (Simplified) dictionary");
    expect(system).not.toContain(NEUTRAL_MARKER);
  });

  it("W4: an unreliable reading must not drive the isSameLanguage formatting branch", async () => {
    // 目标语言恰为被误判的语言码（sr）时，低置信读数不得让提示词误走「同语言」
    // 分支（isSameLanguage）——否则双语分隔符被丢、格式破（同源缺陷）。
    mocks.detectTextLanguage.mockResolvedValue({ lang: "sr", isReliable: false });

    const system = await captureWordPrompt("Undertow", "sr");

    expect(system).toContain("<translated meaning> / ");
    expect(system).toContain(NEUTRAL_MARKER);
  });

  it("W5: buildWordPromptRole truth table", async () => {
    const mod = await import("../../src/contentScript/fetchSSE.js");
    const buildWordPromptRole = mod.buildWordPromptRole;
    expect(typeof buildWordPromptRole).toBe("function");

    const trusted = buildWordPromptRole({
      sourceLanguageTrusted: true,
      sourceLanguageName: "English",
      targetLanguageName: "French",
    });
    expect(trusted).toContain("English-French dictionary");

    const neutral = buildWordPromptRole({
      sourceLanguageTrusted: false,
      sourceLanguageName: "",
      targetLanguageName: "French",
    });
    expect(neutral).toContain(`${NEUTRAL_MARKER} into French`);
    expect(neutral).not.toContain("English");
  });
});
