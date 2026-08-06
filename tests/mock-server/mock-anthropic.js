/**
 * Anthropic mock。手工测试用。
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildTranslatedXml(xml) {
  return xml.replace(
    /<译泽\s+id="([^"]*)">([\s\S]*?)<\/译泽>/g,
    (_, id, text) => {
      return `<译泽 id="${id}">🌐${text}</译泽>`;
    }
  );
}

app.use(async (ctx) => {
  if (
    ctx.method !== "POST" ||
    ctx.path !== "/messages"
  ) {
    ctx.status = 404;
    return;
  }

  const body = ctx.request.body || {};

  const userMsg =
    body.messages
      ?.slice()
      .reverse()
      .find((m) => m.role === "user");

  const xml =
    userMsg?.content?.[0]?.text || "";

  const translatedXml =
    buildTranslatedXml(xml);

  ctx.req.setTimeout(0);

  ctx.status = 200;

  ctx.set(
    "content-type",
    "text/event-stream"
  );

  ctx.set(
    "cache-control",
    "no-cache"
  );

  ctx.set(
    "connection",
    "keep-alive"
  );

  ctx.set(
    "x-accel-buffering",
    "no"
  );

  const writeEvent = (event, data) => {
    ctx.res.write(
      `event: ${event}\n`
    );

    ctx.res.write(
      `data: ${JSON.stringify(data)}\n\n`
    );
  };

  //
  // message_start
  //
  writeEvent("message_start", {
    type: "message_start",
    message: {
      id: "msg_mock_001",
      type: "message",
      role: "assistant",
      model: "claude-haiku-3-5-20241022",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 0,
      },
    },
  });

  //
  // content_block_start
  //
  writeEvent("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: {
      type: "text",
      text: "",
    },
  });

  //
  // content_block_delta
  // Anthropic 官方格式
  //
  for (const ch of translatedXml) {
    writeEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text: ch,
      },
    });

    await sleep(0);
  }

  //
  // content_block_stop
  //
  writeEvent("content_block_stop", {
    type: "content_block_stop",
    index: 0,
  });

  //
  // message_delta
  //
  writeEvent("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: "end_turn",
      stop_sequence: null,
    },
    usage: {
      output_tokens: translatedXml.length,
    },
  });

  //
  // message_stop
  //
  writeEvent("message_stop", {
    type: "message_stop",
  });

  ctx.res.end();
});

app.listen(3670, () => {
  console.log(
    "Mock Anthropic Server Listening On :3670"
  );
});

