/**
 * Mock LLM server for the conformance matrix (plan 84, P1).
 *
 * Three modes, each modelling a real failure we shipped:
 *   sse-ok    — a well-behaved OpenAI-compatible streaming endpoint
 *   html-200  — 200 with an HTML page (what a wrong/redirected endpoint returns)
 *   no-cors   — a valid SSE body with no CORS headers, served from an origin the
 *               extension has no host permission for
 *
 * The server records every request so a scenario can assert that *no* request was made
 * (config-time validation) instead of only looking at the UI.
 */
import fs from "node:fs";
import http from "node:http";

const SSE_BODY = (sentinel) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [{ index: 0, delta: { role: "assistant", content: sentinel }, finish_reason: null }],
  })}\n\n` +
  `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}\n\n` +
  "data: [DONE]\n\n";

const HTML_BODY =
  "<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Checking your browser</h1></body></html>";

/**
 * @param {{host?: string, mode?: "sse-ok"|"html-200"|"no-cors", sentinel?: string, port?: number}} options
 * @returns {Promise<{url: string, base: string, origin: string, requests: Array<object>, close: () => Promise<void>}>}
 */
export async function startMockServer({ host = "127.0.0.1", mode = "sse-ok", sentinel = "MOCK-AI-TRANSLATION", port = 0 } = {}) {
  const requests = [];
  const cors = mode !== "no-cors";
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: body.slice(0, 400) });
      if (process.env.CONFORMANCE_MOCK_LOG) {
        try {
          fs.appendFileSync(process.env.CONFORMANCE_MOCK_LOG, `${body}\n---\n`);
        } catch {}
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204, cors ? { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" } : {});
        res.end();
        return;
      }
      if (req.url?.endsWith("/models")) {
        const headers = { "Content-Type": "application/json" };
        if (cors) headers["Access-Control-Allow-Origin"] = "*";
        res.writeHead(200, headers);
        res.end(JSON.stringify({ data: [{ id: "mock-model", object: "model" }] }));
        return;
      }
      const headers = { "Content-Type": mode === "html-200" ? "text/html; charset=utf-8" : "text/event-stream" };
      if (cors) headers["Access-Control-Allow-Origin"] = "*";
      if (mode === "html-200") {
        res.writeHead(200, headers);
        res.end(HTML_BODY);
        return;
      }
      // DualTran asks the model for <译泽 id="N">source</译泽> and parses the same tags back,
      // so the mock echoes one tagged line per requested block.
      // The request body is JSON, so the tags arrive escaped: <译泽 id=\"N\">
      const flat = body.split('\\"').join('"');
      const ids = [...flat.matchAll(/<译泽 id="([^"]+)">/g)].map((m) => m[1]);
      const tagged = ids.length
        ? ids.map((id) => `<译泽 id="${id}">${sentinel}-${id}</译泽>`).join("\n")
        : sentinel;
      const body2 = SSE_BODY(tagged);
      headers["Content-Length"] = String(Buffer.byteLength(body2));
      res.writeHead(200, headers);
      res.end(body2);
    });
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const actualPort = server.address().port;
  return {
    base: `http://${host}:${actualPort}`,
    url: `http://${host}:${actualPort}/v1`,
    origin: `http://${host}:${actualPort}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
