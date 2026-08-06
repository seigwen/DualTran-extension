# mock-server/CLAUDE.md

本目录包含 DualTran 扩展的 LLM Mock 服务器，用于在不调用真实 AI API 的情况下进行开发和测试。

---

## 文件概览

| 文件 | 协议 | 端口 | 用途 |
|------|------|------|------|
| `mock-llm-server-aimock.js` | Raw HTTP | 8788 | **唯一的通用 LLM mock 服务器**。基于 @copilotkit/aimock，模拟 7 个提供商的聊天 + 模型列表 API。支持场景切换、请求日志、fixture 数据驱动。自动化测试和手工测试均可使用。 |
| `mock-gemini.js` | Koa | — | 模拟 Gemini API。解析 `<译泽>` 块，返回带相同 id 的 mock 译文。手工测试用。 |
| `mock-anthropic.js` | Koa | — | 模拟 Anthropic SSE API。解析 `<译泽>` 块，返回带相同 id 的 mock 译文。手工测试用。 |

---

## mock-llm-server-aimock.js 详细使用指南

### 1. 快速启动

```bash
# 方式一：npm 脚本（推荐）
npm run mock:llm:aimock

# 方式二：直接运行
node tests/mock-server/mock-llm-server-aimock.js

# 方式三：自定义端口
AIMOCK_LLM_PORT=9999 node tests/mock-server/mock-llm-server-aimock.js

# 方式四：自定义 fixture 文件
AIMOCK_FIXTURE_FILE=./my-fixtures.json node tests/mock-server/mock-llm-server-aimock.js
```

启动后输出：
```
Aimock LLM server is listening on http://127.0.0.1:8788
```

### 2. 健康检查

```bash
curl http://127.0.0.1:8788/health
# → { "ok": true, "service": "aimock-llm-server", "upstream": "http://127.0.0.1:XXXXX" }
```

`upstream` 字段显示内部 LLMock 引擎的地址（随机端口）。

---

### 3. 支持的 API 端点

#### 3.1 聊天补全端点（代理到 LLMock）

这些端点会将请求代理给内部 LLMock 引擎处理。LLMock 根据 fixture 文件中的匹配规则返回预定义响应。

| 提供商 | 端点路径 | 实际 API 格式 |
|--------|----------|--------------|
| OpenAI | `POST /openai/v1/chat/completions` | OpenAI SSE |
| OpenRouter | `POST /openrouter/v1/chat/completions` | OpenAI SSE |
| DeepSeek | `POST /deepseek/v1/chat/completions` | OpenAI SSE |
| xAI (Grok) | `POST /grok/v1/chat/completions` | OpenAI SSE |
| Azure | `POST /azure/openai/deployments/{name}/chat/completions` | OpenAI SSE |
| Anthropic | `POST /anthropic/v1/messages` | Anthropic SSE |
| Gemini | `POST /gemini/v1beta/models/{model}:generateContent` | Gemini JSON |
| Gemini | `POST /gemini/v1beta/models/{model}:streamGenerateContent` | Gemini SSE |

**示例请求：**

```bash
# OpenAI 聊天补全
curl -X POST http://127.0.0.1:8788/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'

# Anthropic 聊天
curl -X POST http://127.0.0.1:8788/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: test-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-3-5-haiku-latest","messages":[{"role":"user","content":"hello anthropic"}]}'

# DualTran 翻译请求（带 <译泽> 标签）
curl -X POST http://127.0.0.1:8788/openai/v1/chat/completions?scenario=tagged-echo \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"<译泽 id=\"1\">Hello</译泽><译泽 id=\"2\">World</译泽>"}]}'
```

#### 3.2 模型列表端点（静态数据）

这些端点直接返回 `MODEL_CATALOGS` 中的静态数据，**不经过 LLMock**。

| 提供商 | 端点路径 | 响应格式 |
|--------|----------|----------|
| OpenAI | `GET /openai/v1/models` | `{ data: [{ id }] }` |
| OpenRouter | `GET /openrouter/v1/models` | `{ data: [{ id, name }] }` |
| Azure | `GET /azure/openai/models` | `{ data: [{ id }] }` |
| DeepSeek | `GET /deepseek/v1/models` | `{ data: [{ id }] }` |
| xAI (Grok) | `GET /grok/v1/models` | `{ data: [{ id }] }` |
| Anthropic | `GET /anthropic/v1/models` | `{ models: [{ name }] }` |
| Gemini | `GET /gemini/v1beta/models` | `{ models: [{ name, displayName }] }` |

**示例：**

```bash
curl http://127.0.0.1:8788/openai/v1/models
# → {"data":[{"id":"gpt-4o-mini"},{"id":"o1-mini"}]}

curl http://127.0.0.1:8788/anthropic/v1/models
# → {"models":[{"name":"claude-3-5-haiku-latest"},{"name":"claude-3-7-sonnet-20250219"}]}
```

---

### 4. 测试场景（Scenarios）

通过 `?scenario=xxx` 查询参数或 `x-mock-scenario` 请求头触发不同的测试场景。

#### 4.1 通用场景（所有端点）

| 场景名 | 状态码 | 描述 |
|--------|--------|------|
| `success` | — | **默认**。正常代理到 LLMock，根据 fixture 匹配返回。 |
| `auth-error` | 401 | 模拟 API key 无效或缺失。 |
| `rate-limit` | 429 | 模拟请求频率超限。 |

#### 4.2 OpenAI 兼容端点场景

| 场景名 | 描述 |
|--------|------|
| `empty` | 返回仅含 `[DONE]` 的空 SSE 流（模拟 AI 无响应内容）。 |
| `tagged-echo` | 解析请求中的 `<译泽>` 标签，回显带 `[aimock e2e result]` 标记的翻译。DualTran 专用。 |
| `slow-stream` | 同 tagged-echo 但每个 SSE chunk 间延迟 100ms，模拟慢速网络。 |

#### 4.3 Anthropic 专有场景

| 场景名 | 描述 |
|--------|------|
| `event-error` | SSE 流中返回标准格式的错误事件 `{ type: "error", error: { message, type } }`。 |
| `event-error-fallback` | SSE 流中返回降级格式的错误事件 `{ type: "error", error: "quota exceeded" }`（error 为字符串）。 |
| `malformed-event` | SSE 流中返回无效 JSON，用于测试 JSON 解析错误处理。 |
| `slow-stream` | Anthropic 格式的慢速流。 |

#### 4.4 Gemini 专有场景

| 场景名 | 描述 |
|--------|------|
| `empty` | `generateContent` 返回 `{ candidates: [] }`。 |
| `non-json-error` | 返回 503 纯文本 "Gemini upstream exploded"，测试非 JSON 错误处理。 |

**示例：**

```bash
# 触发 401 认证错误
curl -X POST http://127.0.0.1:8788/openai/v1/chat/completions?scenario=auth-error \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
# → {"error":{"message":"Mock auth error","status":401}}

# 通过请求头触发场景
curl -X POST http://127.0.0.1:8788/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-mock-scenario: rate-limit" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
# → {"error":{"message":"Mock rate limit","status":429}}

# Anthropic 流内错误
curl -X POST http://127.0.0.1:8788/anthropic/v1/messages?scenario=event-error \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-5-haiku-latest","messages":[{"role":"user","content":"hello"}]}'
```

---

### 5. Fixture 文件格式

Fixture 文件（默认 `tests/fixtures/aimock/llm.json`）定义 LLMock 的请求匹配规则和预定义响应。

#### 5.1 基本结构

```json
{
  "fixtures": [
    {
      "match": { "userMessage": "关键词" },
      "response": { "content": "响应文本" },
      "chunkSize": 12
    }
  ]
}
```

#### 5.2 匹配规则

- **`match.userMessage`**：匹配 `messages` 数组中最后一条 `role: "user"` 消息的内容（子字符串匹配）。
- 匹配按数组顺序进行，**第一个匹配的规则生效**。

#### 5.3 响应类型

```json
// 正常文本响应（流式返回）
{ "response": { "content": "翻译结果" } }

// 工具调用
{ "response": { "toolCalls": [{ "name": "fn", "arguments": { "key": "val" } }] } }

// 错误响应（HTTP 错误码）
{ "response": { "error": { "message": "错误信息" }, "status": 401 } }
```

#### 5.4 高级控制参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `chunkSize` | number | 每个 SSE chunk 的字符数（控制流式粒度） |
| `latency` | number | 首个 chunk 前的延迟毫秒数 |
| `streamingProfile.tps` | number | tokens per second 模拟 |
| `streamingProfile.ttft` | number | time to first token 毫秒 |
| `truncateAfterChunks` | number | 发送 N 个 chunk 后截断流（模拟不完整响应） |
| `disconnectAfterMs` | number | N 毫秒后断开连接（模拟网络中断） |
| `chaos.malformedRate` | number (0-1) | 生成畸形 chunk 的概率 |

**示例 fixture 文件：**

```json
{
  "fixtures": [
    {
      "match": { "userMessage": "hello" },
      "response": { "content": "Hi! I'm a mock AI." },
      "chunkSize": 8
    },
    {
      "match": { "userMessage": "translate" },
      "response": { "content": "<译泽 id=\"1\">你好世界</译泽>" },
      "chunkSize": 20
    },
    {
      "match": { "userMessage": "slow" },
      "response": { "content": "This streams slowly" },
      "streamingProfile": { "tps": 2, "ttft": 500 },
      "chunkSize": 4
    },
    {
      "match": { "userMessage": "fail" },
      "response": { "error": { "message": "模拟错误" }, "status": 500 }
    },
    {
      "match": { "userMessage": "disconnect" },
      "response": { "content": "This will be cut off mid-stream" },
      "disconnectAfterMs": 50,
      "chunkSize": 3
    }
  ]
}
```

---

### 6. 在自动化测试中使用

#### 6.1 基本用法（vitest / jest）

```js
import { startAimockLlmServer, stopAimockLlmServer, getAimockRequestLog, resetAimockRequestLog } from "../mock-server/mock-llm-server-aimock.js";

let server;

beforeAll(async () => {
  server = await startAimockLlmServer(8788);
});

afterAll(async () => {
  await stopAimockLlmServer(server);
});

beforeEach(() => {
  resetAimockRequestLog(server); // 清空日志，确保测试隔离
});

test("应该正确发送聊天请求", async () => {
  const res = await fetch("http://127.0.0.1:8788/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer test" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }] }),
  });
  expect(res.ok).toBe(true);

  // 检查请求日志
  const log = getAimockRequestLog(server);
  expect(log).toHaveLength(1);
  expect(log[0].pathname).toBe("/openai/v1/chat/completions");
});

test("auth-error 场景应返回 401", async () => {
  const res = await fetch("http://127.0.0.1:8788/openai/v1/chat/completions?scenario=auth-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }] }),
  });
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.error.message).toBe("Mock auth error");
});
```

#### 6.2 动态加载 Fixture

```js
import { getAimockInstance } from "../mock-server/mock-llm-server-aimock.js";

test("动态加载自定义 fixture", async () => {
  const llm = getAimockInstance(server);
  llm.loadFixtureFile("tests/fixtures/aimock/custom-scenario.json");
  // 后续请求将使用新的 fixture 数据
});
```

#### 6.3 在扩展 E2E 测试中使用

```bash
# 启动 mock 服务器后运行浏览器 E2E 测试
npm run mock:llm:aimock &
npm run test:browser-e2e:aimock
```

在扩展的 `providerConfigs` 中将 `apiBase` 指向 mock 服务器：

```js
// 示例：将 OpenAI 的 apiBase 设置为 mock 地址
providerConfigs.openai = {
  apiKey: "test-key",
  model: "gpt-4o-mini",
  apiBase: "http://127.0.0.1:8788/openai"  // 注意：不含 /v1/chat/completions
};
```

---

### 7. 架构说明

```
浏览器扩展                    本服务器 (8788)               LLMock (随机端口)
───────────                  ────────────────              ────────────────
                             ┌────────────────┐
POST /openai/v1/chat/...    │ buildRouteDescriptor()     │
       →                    │ → type:"proxy"              │
                             │ maybeHandleScenario()      │
                             │ → false (正常流程)          │
                             │ proxyToAimock()   ─────────→ fixture 匹配
                             │ ← 流式响应  ←──────────────
       ←                    └────────────────┘

GET /openai/v1/models       │ buildRouteDescriptor()     │
       →                    │ → type:"models"             │
                             │ 直接返回 MODEL_CATALOGS    │
       ←                    └────────────────┘

POST /openai/v1/...         │ getScenario() → "auth-error"│
  ?scenario=auth-error      │ maybeHandleScenario()       │
       →                    │ → true (已处理)              │
                             │ writeJson(401, ...)         │
       ←                    └────────────────┘
```

**两层设计的好处：**
- 外层处理路由分发、场景模拟、CORS、请求日志
- 内层 LLMock 处理 fixture 匹配、流式分块、延迟控制、混沌注入
- 可以通过 `?scenario=` 快速切换到特殊场景，而不影响 LLMock 的正常 fixture 匹配

---

### 8. 环境变量

| 变量名 | 默认值 | 描述 |
|--------|--------|------|
| `AIMOCK_LLM_PORT` | `8788` | 服务器监听端口 |
| `AIMOCK_FIXTURE_FILE` | `tests/fixtures/aimock/llm.json` | LLMock fixture 文件路径 |

---

### 9. 导出 API 参考

| 函数 | 描述 |
|------|------|
| `startAimockLlmServer(port?)` | 创建并启动服务器。返回 `Promise<http.Server>`。 |
| `stopAimockLlmServer(server)` | 优雅关闭服务器（HTTP + LLMock）。返回 `Promise<void>`。 |
| `createAimockLlmServer(port?)` | 仅创建服务器（不 listen），供需要自定义 listen 的场景使用。 |
| `getAimockInstance(server)` | 获取内部 LLMock 实例（可动态加载 fixture）。 |
| `getAimockRequestLog(server)` | 获取请求日志快照（用于测试断言）。 |
| `resetAimockRequestLog(server)` | 清空请求日志（用于测试间隔离）。 |
| `DEFAULT_PORT` | 默认端口常量（8788）。 |

---

### 10. 常见问题

**Q: 请求返回 404 "Unknown aimock route"？**
A: 检查路径前缀是否正确。所有路径必须以提供商名开头（如 `/openai/...`、`/anthropic/...`）。

**Q: LLMock 返回的内容不符合预期？**
A: 检查 fixture 文件中的 `match.userMessage` 是否匹配了请求中 user 消息的内容。匹配是子字符串匹配，按数组顺序优先。

**Q: 如何模拟一个新的 AI 提供商？**
A: 在 `buildRouteDescriptor()` 中添加新的路径匹配规则，在 `MODEL_CATALOGS` 中添加模型列表数据，在 `isChatLikeRoute()` 中添加路径（如果是 OpenAI 兼容格式）。
