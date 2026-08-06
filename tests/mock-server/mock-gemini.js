/**
 * Gemini mock。手工测试用。
 */

const Koa = require("koa");
const bodyParser = require("koa-bodyparser");

const app = new Koa();

app.use(
  bodyParser({
    enableTypes: ["json"],
    jsonLimit: "50mb",
  })
);

/**
 * Gemini SSE chunk
 */
function buildChunk(text) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: "model",
        },
      },
    ],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从请求体中提取用户原文（XML 格式），从中解析出每段的 id 和原文，
 * 并生成对应的「伪翻译」XML（保留原 id，译文在原文前加 🌐 前缀）。
 */
function buildTranslatedXml(requestBody) {
  try {
    // Gemini 请求格式: contents 数组可能含多条消息
    // 找到 role === "user" 的那条（不是 assistant/system）
    const userMsg = (requestBody?.contents || []).find(
      (c) => c?.role === "user"
    );
    const userText = userMsg?.parts?.[0]?.text || "";

    if (!userText) return "";

    // 匹配所有 <译泽 id="...">原文</译泽> 块
    const blocks = [];
    const regex = /<译泽\s+id="([^"]+)">([^<]*)<\/译泽>/g;
    let match;
    while ((match = regex.exec(userText)) !== null) {
      blocks.push({ id: match[1], original: match[2] });
    }

    if (!blocks.length) {
      console.log("[mock-gemini] 正则未匹配到译泽块，userText:", userText.substring(0, 200));
      return "";
    }

    console.log("[mock-gemini] 提取到", blocks.length, "个翻译块");
    // 生成带相同 id 的译文 XML（原文前加 🌐 表示已"翻译"）
    return blocks
      .map((b) => `<译泽 id="${b.id}">🌐 ${b.original}</译泽>`)
      .join("\n");
  } catch {
    return "";
  }
}

app.use(async (ctx) => {
  console.log(`[mock-gemini] ${ctx.method} ${ctx.path}`);

  // 匹配 :streamGenerateContent 或 :generateContent
  if (
    ctx.method === "POST" &&
    (ctx.path.includes(":streamGenerateContent") || ctx.path.includes(":generateContent"))
  ) {
    console.log("[mock-gemini] 请求命中，body keys:", Object.keys(ctx.request.body || {}));
    ctx.status = 200;
    ctx.set("Content-Type", "text/event-stream");
    ctx.set("Cache-Control", "no-cache");
    ctx.set("Connection", "keep-alive");
    ctx.set("X-Accel-Buffering", "no");

    // 从请求中提取原文并以相同 id 生成译文
    const text = buildTranslatedXml(ctx.request.body);
    console.log("[mock-gemini] 生成的译文长度:", text.length, "字符");

    if (!text) {
      console.log("[mock-gemini] 未找到译泽块，返回提示");
      // 请求中没有 XML 块，返回提示
      ctx.res.write(
        `data: ${JSON.stringify(buildChunk("(no translatable blocks found)"))}\n\n`
      );
      ctx.res.write(
        `data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", index: 0 }] })}\n\n`
      );
      ctx.res.end();
      return;
    }

    // 逐字符流式输出
    for (const ch of text) {
      ctx.res.write(`data: ${JSON.stringify(buildChunk(ch))}\n\n`);
      // await sleep(0);
    }

    // 结束事件
    ctx.res.write(
      `data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", index: 0 }] })}\n\n`
    );
    ctx.res.end();
    return;
  }

  ctx.status = 404;
  ctx.body = "Not Found";
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Mock Gemini running at http://localhost:${PORT}`);
});
