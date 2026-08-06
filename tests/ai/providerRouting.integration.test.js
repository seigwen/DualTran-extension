/**
 * 全量提供商路由集成测试。
 * 启动 aimock mock 服务器，对 BUILT_IN_PROVIDERS 中的每个提供商验证：
 *   1. 模型列表端点返回 200 + 有效 JSON
 *   2. 聊天端点含 <译泽> 标签时通过自动检测返回 🌐[aimock] 响应
 *   3. auth-error / rate-limit 场景返回正确状态码
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  startAimockLlmServer,
  stopAimockLlmServer,
  resetAimockRequestLog,
} from "../mock-server/mock-llm-server-aimock.js";
import { BUILT_IN_PROVIDERS } from "../../src/lib/ai/providerRegistry.js";

// ── npm 包 → 端点路径映射 ──────────────────────────────────
// 根据 BUILT_IN_PROVIDERS 的 npm 字段推导每个提供商应使用的端点路径

const NPM_TO_ENDPOINTS = {
  "@ai-sdk/anthropic": {
    chat: "/v1/messages",
    models: "/v1/models",
    bodyBuilder: (content) => JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 100,
      messages: [{ role: "user", content }],
    }),
  },
  "@ai-sdk/google": {
    chat: "/v1beta/models/gemini-2.0-flash:generateContent",
    models: "/v1beta/models",
    bodyBuilder: (content) => JSON.stringify({
      contents: [{ role: "user", parts: [{ text: content }] }],
    }),
  },
  "@ai-sdk/cohere": {
    chat: "/v2/chat",
    models: "/v1/models",
    bodyBuilder: (content) => JSON.stringify({
      model: "command-r",
      messages: [{ role: "user", content }],
    }),
  },
};

/** OpenAI 兼容格式（大多数提供商的默认格式） */
const DEFAULT_ENDPOINTS = {
  chat: "/v1/chat/completions",
  models: "/v1/models",
  bodyBuilder: (content) => JSON.stringify({
    model: "default-model",
    messages: [{ role: "user", content }],
  }),
};

/**
 * 根据提供商的 npm 字段获取端点配置。
 * 无匹配时 fallback 到 OpenAI 兼容格式（通配路由会处理）。
 */
function getEndpoints(provider) {
  return NPM_TO_ENDPOINTS[provider.npm] || DEFAULT_ENDPOINTS;
}

// ── 测试常量 ──
const TAGGED_CONTENT = '翻译以下内容：<译泽 id="t1">Hello world</译泽>';
const EXPECTED_MARKER = "🌐[aimock]";

// ── 服务器生命周期 ──

let server;
let baseUrl;

beforeAll(async () => {
  server = await startAimockLlmServer(0); // 随机端口
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 15000);

afterAll(async () => {
  await stopAimockLlmServer(server);
}, 10000);

beforeEach(() => {
  resetAimockRequestLog(server);
});

// ── 测试：模型列表端点 ──

describe("provider routing: model list endpoints", () => {
  for (const provider of BUILT_IN_PROVIDERS) {
    const endpoints = getEndpoints(provider);

    it(`${provider.id}: GET /${provider.id}${endpoints.models} → 200 with model list`, async () => {
      const res = await fetch(`${baseUrl}/${provider.id}${endpoints.models}`);
      expect(res.status).toBe(200);
      const json = await res.json();
      // 响应应包含 data、models 或 modelSummaries 数组
      const hasList = Array.isArray(json.data) || Array.isArray(json.models) || Array.isArray(json.modelSummaries);
      expect(hasList).toBe(true);
    });
  }
});

// ── 测试：聊天端点 + 自动 <译泽> 检测 ──

describe("provider routing: chat endpoints with <译泽> auto-detect", () => {
  for (const provider of BUILT_IN_PROVIDERS) {
    const endpoints = getEndpoints(provider);

    it(`${provider.id}: POST /${provider.id}${endpoints.chat} → 200 with ${EXPECTED_MARKER}`, async () => {
      const body = endpoints.bodyBuilder(TAGGED_CONTENT);
      const res = await fetch(`${baseUrl}/${provider.id}${endpoints.chat}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer mock-test-key",
          "x-api-key": "mock-test-key",
        },
        body,
      });
      expect(res.status).toBe(200);

      // 检查原始响应文本中是否包含 🌐[aimock] 标记
      // 不同格式（SSE/JSON/NDJSON）的解析方式不同，但标记文本一定出现在响应中
      const raw = await res.text();
      expect(raw).toContain(EXPECTED_MARKER);
    });
  }
});

// ── 测试：场景端点（auth-error / rate-limit） ──

describe("provider routing: scenario endpoints", () => {
  // 从第一个 OpenAI 兼容提供商取样测试
  const sampleProvider = BUILT_IN_PROVIDERS.find((p) => !NPM_TO_ENDPOINTS[p.npm]) || BUILT_IN_PROVIDERS[0];
  const endpoints = getEndpoints(sampleProvider);

  it(`${sampleProvider.id}: auth-error → 401`, async () => {
    const res = await fetch(
      `${baseUrl}/${sampleProvider.id}${endpoints.chat}?scenario=auth-error`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: endpoints.bodyBuilder("hello"),
      }
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.message).toBe("Mock auth error");
  });

  it(`${sampleProvider.id}: rate-limit → 429`, async () => {
    const res = await fetch(
      `${baseUrl}/${sampleProvider.id}${endpoints.chat}?scenario=rate-limit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: endpoints.bodyBuilder("hello"),
      }
    );
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.message).toBe("Mock rate limit");
  });

  // 也测试 Anthropic 和 Gemini 的场景（验证非 OpenAI 端点的场景处理）
  const anthropicProvider = BUILT_IN_PROVIDERS.find((p) => p.npm === "@ai-sdk/anthropic");
  if (anthropicProvider) {
    const anthropicEndpoints = getEndpoints(anthropicProvider);

    it(`${anthropicProvider.id}: auth-error → 401 (Anthropic format)`, async () => {
      const res = await fetch(
        `${baseUrl}/${anthropicProvider.id}${anthropicEndpoints.chat}?scenario=auth-error`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: anthropicEndpoints.bodyBuilder("hello"),
        }
      );
      expect(res.status).toBe(401);
    });
  }

  const geminiProvider = BUILT_IN_PROVIDERS.find((p) => p.npm === "@ai-sdk/google");
  if (geminiProvider) {
    const geminiEndpoints = getEndpoints(geminiProvider);

    it(`${geminiProvider.id}: auth-error → 401 (Gemini format)`, async () => {
      const res = await fetch(
        `${baseUrl}/${geminiProvider.id}${geminiEndpoints.chat}?scenario=auth-error`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: geminiEndpoints.bodyBuilder("hello"),
        }
      );
      expect(res.status).toBe(401);
    });
  }
});
