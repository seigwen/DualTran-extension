/**
 * 基于 @copilotkit/aimock，模拟 多个提供商的聊天 + 模型列表 API。
 * 支持场景切换、请求日志、fixture 数据驱动。自动化测试和手工测试均可使用。
 */
const http = require("http");
const path = require("path");
const { Readable } = require("stream");
const { URL } = require("url");
const { LLMock } = require("@copilotkit/aimock");

const DEFAULT_PORT = Number(process.env.AIMOCK_LLM_PORT || 8788);
const DEFAULT_FIXTURE_FILE = process.env.AIMOCK_FIXTURE_FILE || path.join(__dirname, "..", "fixtures", "aimock", "llm.json");

// 覆盖 @copilotkit/aimock v1.14.0 全部端点格式
const MODEL_CATALOGS = {
  openai: {
    data: [
      { id: "gpt-4o-mini" },
      { id: "o1-mini" },
    ],
  },
  openrouter: {
    data: [
      { id: "openai/gpt-4o-mini", name: "OpenAI GPT-4o Mini" },
      { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
    ],
  },
  azure: {
    data: [
      { id: "gpt-4o-mini" },
      { id: "gpt-4o" },
    ],
  },
  deepseek: {
    data: [
      { id: "deepseek-chat" },
      { id: "deepseek-reasoner" },
    ],
  },
  grok: {
    data: [
      { id: "grok-2-latest" },
      { id: "grok-beta" },
    ],
  },
  anthropic: {
    models: [
      { name: "claude-3-5-haiku-latest" },
      { name: "claude-3-7-sonnet-20250219" },
    ],
  },
  gemini: {
    models: [
      { name: "models/gemini-1.5-flash", displayName: "Gemini 1.5 Flash" },
      { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
    ],
  },
  vertex: {
    models: [
      { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
    ],
  },
  // ⚠️ Bedrock：当前 DualTran 不直接使用 Bedrock 原生端点（@ai-sdk/amazon-bedrock
  // 依赖 Node.js 原生模块，无法在 Service Worker 中运行）。扩展对 Bedrock 提供商
  // 使用 createOpenAICompatible() fallback。此路由为未来预留。
  bedrock: {
    modelSummaries: [
      { modelId: "anthropic.claude-3-haiku-20240307-v1:0" },
      { modelId: "amazon.titan-text-express-v1" },
    ],
  },
  // ⚠️ Ollama：当前 DualTran 不直接使用 Ollama 原生端点。扩展对 Ollama 使用
  // OpenAI 兼容 fallback。此路由为未来预留。
  ollama: {
    models: [
      { name: "llama3.2", model: "llama3.2", modified_at: "2025-01-01T00:00:00Z" },
      { name: "mistral", model: "mistral", modified_at: "2025-01-01T00:00:00Z" },
    ],
  },
  cohere: {
    models: [
      { name: "command-r-plus", endpoints: ["chat"] },
      { name: "command-r", endpoints: ["chat"] },
    ],
  },
  // 通用 OpenAI 兼容格式（用于 models.dev 中 100+ 提供商的通配路由）
  generic: {
    data: [
      { id: "default-model" },
      { id: "default-model-mini" },
    ],
  },
};

function withCorsHeaders(headers = {}) {
  return {
    ...headers,
    "Access-Control-Allow-Origin": "*",
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, withCorsHeaders({
    "Content-Type": "application/json; charset=utf-8",
  }));
  res.end(JSON.stringify(payload));
}

function writeText(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, withCorsHeaders({
    "Content-Type": contentType,
  }));
  res.end(payload);
}

function writeSse(res, chunks) {
  res.writeHead(200, withCorsHeaders({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  }));

  for (const chunk of chunks) {
    res.write(`data: ${chunk}\n\n`);
  }

  res.end();
}

function writeSseWithDelay(res, chunks, delayMs = 100) {
  res.writeHead(200, withCorsHeaders({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  }));

  let index = 0;
  const writeNext = () => {
    if (index >= chunks.length) {
      res.end();
      return;
    }
    res.write(`data: ${chunks[index]}\n\n`);
    index += 1;
    setTimeout(writeNext, delayMs);
  };

  writeNext();
}

function buildOpenAiDoneOnlyChunks() {
  return ["[DONE]"];
}

function getScenario(urlObject, req) {
  return urlObject.searchParams.get("scenario") || req.headers["x-mock-scenario"] || "success";
}

function stripScenarioParams(urlObject) {
  const cloned = new URL(urlObject.toString());
  cloned.searchParams.delete("scenario");
  return cloned;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function buildTaggedTranslationChunks(body) {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    const userMsg = (parsed?.messages || []).find((m) => m.role === "user");
    const content = userMsg?.content || "";
    const tagRe = /<译泽 id="([^"]+)">([^<]*(?:<(?!\/译泽>)[^<]*)*)<\/译泽>/g;
    let match;
    const parts = [];
    while ((match = tagRe.exec(content)) !== null) {
      parts.push({ id: match[1], source: match[2] });
    }
    if (parts.length === 0) return ["🌐[aimock]"];
    return parts.map((part) => `<译泽 id="${part.id}">🌐[aimock]${part.source}</译泽>`);
  } catch {
    return ["🌐[aimock]"];
  }
}

function createOpenAiChunksFromTagged(textChunks) {
  const id = "chatcmpl-mock-" + Date.now();
  const dataChunks = textChunks.map((text) =>
    JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    })
  );
  // Final chunk with finish_reason
  dataChunks.push(JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  }));
  dataChunks.push("[DONE]");
  return dataChunks;
}

function createAnthropicChunks(text = "mock translated text") {
  return [
    JSON.stringify({ type: "content_block_delta", delta: { text } }),
    JSON.stringify({ type: "message_stop" }),
  ];
}

function createAnthropicErrorChunks(message = "Anthropic mock stream error", type = "rate_limit_error") {
  return [
    JSON.stringify({
      type: "error",
      error: { message, type },
    }),
  ];
}

function createAnthropicFallbackErrorChunks() {
  return [
    JSON.stringify({
      type: "error",
      error: "quota exceeded",
    }),
  ];
}

function createMalformedAnthropicChunks() {
  return [
    "{bad json",
    JSON.stringify({ type: "message_stop" }),
  ];
}

// ─── 自动检测 <译泽> 标签 ─────────────────────────────────

/**
 * 检测请求体是否包含 DualTran 的 <译泽> 标签。
 * 如果包含，mock 服务器将自动回显翻译内容（无需 scenario 参数）。
 */
function shouldAutoTaggedEcho(body) {
  return typeof body === "string" && body.includes("<译泽");
}

// ─── 各格式 tagged-echo 响应构造 ─────────────────────────

/**
 * 构造 Anthropic 格式的 tagged-echo 响应 SSE 数据块。
 * 将所有 <译泽> 块的文本拼接后包裹为 Anthropic 的 content_block_delta 格式。
 */
function createAnthropicTaggedEchoChunks(body) {
  const taggedChunks = buildTaggedTranslationChunks(body);
  const fullText = taggedChunks.join("");
  return [
    JSON.stringify({ type: "content_block_delta", delta: { text: fullText } }),
    JSON.stringify({ type: "message_stop" }),
  ];
}

/**
 * 构造 Gemini 格式的 tagged-echo 响应 JSON。
 * 将所有 <译泽> 块的文本拼接后包裹为 Gemini 的 candidates 格式。
 */
function createGeminiTaggedEchoJson(body) {
  const taggedChunks = buildTaggedTranslationChunks(body);
  const fullText = taggedChunks.join("");
  return {
    candidates: [{
      content: { parts: [{ text: fullText }] },
    }],
  };
}

/**
 * 构造 Cohere v2/chat 格式的 tagged-echo 响应 JSON。
 */
function createCohereTaggedEchoJson(body) {
  const taggedChunks = buildTaggedTranslationChunks(body);
  const fullText = taggedChunks.join("");
  return {
    message: { role: "assistant", content: [{ type: "text", text: fullText }] },
    finish_reason: "COMPLETE",
  };
}

/**
 * 构造 Ollama /api/chat 格式的 tagged-echo 响应 JSON。
 */
function createOllamaTaggedEchoJson(body) {
  const taggedChunks = buildTaggedTranslationChunks(body);
  const fullText = taggedChunks.join("");
  return { message: { role: "assistant", content: fullText }, done: true };
}

function createRequestLogEntry({ req, pathname, rewrittenPath, scenario, body }) {
  return {
    method: req.method || "GET",
    pathname,
    rewrittenPath,
    scenario,
    headers: Object.fromEntries(
      Object.entries(req.headers || {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value ?? "")])
    ),
    body,
    timestamp: Date.now(),
  };
}

function buildRouteDescriptor(pathname) {
  // 模拟completion接口。覆盖 @copilotkit/aimock v1.14.0 全部 LLM 端点
  if (pathname === "/openai/v1/chat/completions") {
    return { type: "proxy", rewrittenPath: "/v1/chat/completions" };
  }
  if (pathname === "/openrouter/v1/chat/completions") {
    return { type: "proxy", rewrittenPath: "/v1/chat/completions" };
  }
  if (pathname === "/deepseek/v1/chat/completions") {
    return { type: "proxy", rewrittenPath: "/v1/chat/completions" };
  }
  if (pathname === "/grok/v1/chat/completions") {
    return { type: "proxy", rewrittenPath: "/v1/chat/completions" };
  }
  if (/^\/azure\/openai\/deployments\/[^/]+\/chat\/completions$/.test(pathname)) {
    return { type: "proxy", rewrittenPath: pathname.replace(/^\/azure/, "") };
  }
  if (pathname === "/anthropic/v1/messages") {
    return { type: "proxy", rewrittenPath: "/v1/messages" };
  }
  if (/^\/gemini\/v1beta\/models\/.+:(generateContent|streamGenerateContent)$/.test(pathname)) {
    return { type: "proxy", rewrittenPath: pathname.replace(/^\/gemini/, "") };
  }
  // Vertex AI (⚠️ 未来预留——@ai-sdk/google-vertex 依赖 Node.js 原生模块)
  if (/^\/vertex\/v1\/projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.test(pathname)) {
    return { type: "proxy", rewrittenPath: pathname.replace(/^\/vertex/, "") };
  }
  // Bedrock Invoke (⚠️ 未来预留——@ai-sdk/amazon-bedrock 依赖 Node.js 原生模块)
  if (/^\/bedrock\/model\/[^/]+\/invoke$/.test(pathname)) {
    return { type: "proxy", rewrittenPath: pathname.replace(/^\/bedrock/, "") };
  }
  // Bedrock Stream (⚠️ 未来预留)
  if (/^\/bedrock\/model\/[^/]+\/invoke-with-response-stream$/.test(pathname)) {
    return { type: "proxy", rewrittenPath: pathname.replace(/^\/bedrock/, "") };
  }
  // Bedrock Converse (⚠️ 未来预留)
  if (/^\/bedrock\/model\/[^/]+\/converse$/.test(pathname)) {
    return { type: "proxy", rewrittenPath: pathname.replace(/^\/bedrock/, "") };
  }
  // Bedrock Converse Stream (⚠️ 未来预留)
  if (/^\/bedrock\/model\/[^/]+\/converse-stream$/.test(pathname)) {
    return { type: "proxy", rewrittenPath: pathname.replace(/^\/bedrock/, "") };
  }
  // Ollama Chat (⚠️ 未来预留)
  if (pathname === "/ollama/api/chat") {
    return { type: "proxy", rewrittenPath: "/api/chat" };
  }
  // Ollama Generate (⚠️ 未来预留)
  if (pathname === "/ollama/api/generate") {
    return { type: "proxy", rewrittenPath: "/api/generate" };
  }
  // Cohere v2/chat
  if (pathname === "/cohere/v2/chat") {
    return { type: "proxy", rewrittenPath: "/v2/chat" };
  }

  // 模拟模型列表API。覆盖 @copilotkit/aimock v1.14.0 全部模型列表端点
  if (pathname === "/openai/v1/models") {
    return { type: "models", provider: "openai" };
  }
  if (pathname === "/openrouter/v1/models") {
    return { type: "models", provider: "openrouter" };
  }
  if (pathname === "/azure/openai/models") {
    return { type: "models", provider: "azure" };
  }
  if (pathname === "/deepseek/v1/models") {
    return { type: "models", provider: "deepseek" };
  }
  if (pathname === "/grok/v1/models") {
    return { type: "models", provider: "grok" };
  }
  if (pathname === "/anthropic/v1/models") {
    return { type: "models", provider: "anthropic" };
  }
  if (pathname === "/gemini/v1beta/models") {
    return { type: "models", provider: "gemini" };
  }
  if (pathname === "/vertex/v1beta/models") {
    return { type: "models", provider: "vertex" };
  }
  if (pathname === "/ollama/api/tags") {
    return { type: "models", provider: "ollama" };
  }
  if (pathname === "/cohere/v1/models") {
    return { type: "models", provider: "cohere" };
  }

  // ── 通配路由：覆盖 models.dev 中 100+ OpenAI 兼容提供商 ──
  // 必须放在所有显式规则之后，作为最终 fallback。
  if (/^\/[^/]+\/v1\/chat\/completions$/.test(pathname)) {
    return { type: "proxy", rewrittenPath: "/v1/chat/completions" };
  }
  if (/^\/[^/]+\/v1\/models$/.test(pathname)) {
    return { type: "models", provider: "generic" };
  }

  return null;
}

function isChatLikeRoute(pathname) {
  return (
    pathname === "/openai/v1/chat/completions"
    || pathname === "/openrouter/v1/chat/completions"
    || pathname === "/deepseek/v1/chat/completions"
    || pathname === "/grok/v1/chat/completions"
    || /^\/azure\/openai\/deployments\/[^/]+\/chat\/completions$/.test(pathname)
  );
}

// ─── 自动 tagged-echo 调度 ───────────────────────────────

/**
 * 判断路径属于哪种 API 端点格式，用于自动 tagged-echo 响应的格式选择。
 * @returns {"openai"|"anthropic"|"gemini"|"cohere"|"ollama"|"bedrock"}
 */
function detectEndpointFormat(pathname) {
  if (pathname === "/anthropic/v1/messages") return "anthropic";
  if (/^\/(gemini|vertex)\//.test(pathname)) return "gemini";
  if (pathname === "/cohere/v2/chat") return "cohere";
  if (/^\/ollama\/api\//.test(pathname)) return "ollama";
  if (/^\/bedrock\//.test(pathname)) return "bedrock";
  return "openai";
}

/**
 * 根据端点格式自动构造 tagged-echo 响应。
 * 当请求体中检测到 <译泽> 标签时调用。
 * @returns {boolean} true 表示已处理响应
 */
async function handleAutoTaggedEcho(res, pathname, body) {
  const format = detectEndpointFormat(pathname);
  switch (format) {
    case "anthropic":
      writeSse(res, createAnthropicTaggedEchoChunks(body));
      return true;
    case "gemini":
      writeJson(res, 200, createGeminiTaggedEchoJson(body));
      return true;
    case "cohere":
      writeJson(res, 200, createCohereTaggedEchoJson(body));
      return true;
    case "ollama":
      writeJson(res, 200, createOllamaTaggedEchoJson(body));
      return true;
    case "openai":
    default: {
      const taggedChunks = buildTaggedTranslationChunks(body);
      const sseChunks = createOpenAiChunksFromTagged(taggedChunks);
      res.writeHead(200, withCorsHeaders({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      }));
      res.flushHeaders();
      if (res.socket) res.socket.setNoDelay(true);
      // Initial role delta
      const initChunk = JSON.stringify({
        id: "chatcmpl-mock-" + Date.now(), object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000), model: "mock-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });
      // Write all chunks with delays, return Promise that resolves when done
      await new Promise((resolve) => {
        res.write(`data: ${initChunk}\n\n`);
        let idx = 0;
        const writeNext = () => {
          if (idx >= sseChunks.length) { res.end(resolve); return; }
          res.write(`data: ${sseChunks[idx]}\n\n`);
          idx++;
          setTimeout(writeNext, 5);
        };
        setTimeout(writeNext, 5);
      });
      return true;
    }
  }
}

// ─── 场景处理 ────────────────────────────────────────────

function maybeHandleScenario(req, res, pathname, scenario, body) {
  if (scenario === "auth-error") {
    writeJson(res, 401, { error: { message: "Mock auth error", status: 401 } });
    return true;
  }

  if (scenario === "rate-limit") {
    writeJson(res, 429, { error: { message: "Mock rate limit", status: 429 } });
    return true;
  }

  if (scenario === "empty" && isChatLikeRoute(pathname)) {
    writeSse(res, buildOpenAiDoneOnlyChunks());
    return true;
  }

  if (scenario === "empty" && /^\/gemini\/v1beta\/models\/.+:generateContent$/.test(pathname)) {
    writeJson(res, 200, { candidates: [] });
    return true;
  }

  if (scenario === "tagged-echo" && isChatLikeRoute(pathname)) {
    return "tagged-echo";
  }

  if (scenario === "slow-stream") {
    if (isChatLikeRoute(pathname)) {
      const taggedChunks = buildTaggedTranslationChunks(body);
      writeSseWithDelay(res, createOpenAiChunksFromTagged(taggedChunks), 100);
      return true;
    }
    if (pathname === "/anthropic/v1/messages") {
      const taggedChunks = buildTaggedTranslationChunks(body);
      writeSseWithDelay(res, createAnthropicChunks(taggedChunks.join("")), 100);
      return true;
    }
  }

  if (pathname === "/anthropic/v1/messages") {
    if (scenario === "event-error") {
      writeSse(res, createAnthropicErrorChunks());
      return true;
    }
    if (scenario === "event-error-fallback") {
      writeSse(res, createAnthropicFallbackErrorChunks());
      return true;
    }
    if (scenario === "malformed-event") {
      writeSse(res, createMalformedAnthropicChunks());
      return true;
    }
  }

  if (scenario === "non-json-error" && /^\/gemini\/v1beta\/models\/.+:generateContent$/.test(pathname)) {
    writeText(res, 503, "Gemini upstream exploded");
    return true;
  }

  return false;
}

async function proxyToAimock({ llm, req, res, urlObject, rewrittenPath, body }) {
  const upstreamUrl = new URL(`${rewrittenPath}${stripScenarioParams(urlObject).search}`, llm.url);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];

  const response = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });

  const responseHeaders = withCorsHeaders({
    "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
  });
  const cacheControl = response.headers.get("cache-control");
  if (cacheControl) {
    responseHeaders["Cache-Control"] = cacheControl;
  }

  res.writeHead(response.status, responseHeaders);

  if (!response.body) {
    res.end();
    return;
  }

  await new Promise((resolve, reject) => {
    Readable.fromWeb(response.body).on("error", reject).on("end", resolve).pipe(res);
  });
}

async function createAimockLlmServer(port = DEFAULT_PORT) {
  const llm = new LLMock({ port: 0, host: "127.0.0.1" });
  llm.loadFixtureFile(DEFAULT_FIXTURE_FILE);
  await llm.start();

  const requestLog = [];
  const server = http.createServer(async (req, res) => {
    const urlObject = new URL(req.url, "http://127.0.0.1");
    const pathname = urlObject.pathname;
    const scenario = getScenario(urlObject, req);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, authorization, x-api-key, api-key, x-mock-scenario, anthropic-version, anthropic-dangerous-direct-browser-access, http-referer, x-title",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      writeJson(res, 200, { ok: true, service: "aimock-llm-server", upstream: llm.url });
      return;
    }

    if (req.method === "GET" && pathname === "/request-log") {
      writeJson(res, 200, { requests: getAimockRequestLog({ __requestLog: requestLog }) });
      return;
    }

    if (req.method === "POST" && pathname === "/request-log/reset") {
      resetAimockRequestLog({ __requestLog: requestLog });
      writeJson(res, 200, { ok: true });
      return;
    }

    const route = buildRouteDescriptor(pathname);
    const body = await readRequestBody(req);
    requestLog.push(createRequestLogEntry({
      req,
      pathname,
      rewrittenPath: route?.rewrittenPath || null,
      scenario,
      body,
    }));

    if (!route) {
      writeJson(res, 404, { error: { message: `Unknown aimock route: ${pathname}`, status: 404 } });
      return;
    }

    const scenarioResult = maybeHandleScenario(req, res, pathname, scenario, body);
    if (scenarioResult === true) {
      return;
    }
    if (scenarioResult === "tagged-echo") {
      // 显式 tagged-echo 场景（向后兼容），使用格式感知调度
      await handleAutoTaggedEcho(res, pathname, body);
      return;
    }

    // ── 自动检测 <译泽> 标签 ──
    // DualTran 的翻译请求体包含 <译泽> 标签。检测到时自动回显，
    // 无需 ?scenario=tagged-echo 参数。对所有提供商格式统一生效。
    if (route.type === "proxy" && shouldAutoTaggedEcho(body)) {
      await handleAutoTaggedEcho(res, pathname, body);
      return;
    }

    if (route.type === "models") {
      writeJson(res, 200, MODEL_CATALOGS[route.provider]);
      return;
    }

    try {
      await proxyToAimock({ llm, req, res, urlObject, rewrittenPath: route.rewrittenPath, body });
    } catch (error) {
      writeJson(res, 502, {
        error: {
          message: error?.message || "Failed to proxy aimock request",
          status: 502,
        },
      });
    }
  });

  server.__aimock = llm;
  server.__requestLog = requestLog;

  return server;
}

function startAimockLlmServer(port = DEFAULT_PORT) {
  return new Promise(async (resolve, reject) => {
    let server;
    try {
      server = await createAimockLlmServer(port);
      server.listen(port, "127.0.0.1", () => resolve(server));
      server.on("error", reject);
    } catch (error) {
      if (server?.__aimock) {
        await server.__aimock.stop().catch(() => {});
      }
      reject(error);
    }
  });
}

async function stopAimockLlmServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (server.__aimock) {
    await server.__aimock.stop();
  }
}

function getAimockInstance(server) {
  return server?.__aimock || null;
}

function getAimockRequestLog(server) {
  return Array.isArray(server?.__requestLog) ? [...server.__requestLog] : [];
}

function resetAimockRequestLog(server) {
  if (Array.isArray(server?.__requestLog)) {
    server.__requestLog.length = 0;
  }
}

if (require.main === module) {
  startAimockLlmServer().then((server) => {
    const address = server.address();
    console.log(`Aimock LLM server is listening on http://127.0.0.1:${address.port}`);
  });
}

module.exports = {
  DEFAULT_PORT,
  createAimockLlmServer,
  startAimockLlmServer,
  stopAimockLlmServer,
  getAimockInstance,
  getAimockRequestLog,
  resetAimockRequestLog,
};
