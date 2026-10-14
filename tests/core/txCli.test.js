/**
 * txCli.test.js — Node dual-path proof over the dist-core bundle (plan 59 A5).
 *
 * The google leg runs against an injected fetch fixture that mirrors the real
 * translate_a/single response shape (recorded) — deterministic, no network.
 * The ai leg streams through aimock SSE with the real AI SDK (no network).
 * beforeAll builds dist-core, so this test proves the shipped bundle works.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startAimockLlmServer, stopAimockLlmServer } from "../mock-server/mock-llm-server-aimock.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

let txCli;

beforeAll(async () => {
  // Build the artifact under test — the CLI loads dist-core/index.mjs.
  execFileSync("npm", ["run", "build:core"], { cwd: ROOT, stdio: "pipe" });
  txCli = await import("../../scripts/tx-cli.mjs");
}, 60_000);

/** fetch stub returning a fixed Google payload + recording request URLs. */
function fixtureFetch(response, record) {
  return async (url) => {
    record.push(String(url));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(response),
      json: async () => response,
    };
  };
}

describe("tx-cli — google leg (injected fetch fixture)", () => {
  it("translates one line and builds the client=gtx request", async () => {
    const calls = [];
    // Real response shape: [[["translated", "original", ...], ...], null, "detectedLang", ...]
    const results = await txCli.runGoogle({
      text: "Hello world",
      from: "en",
      to: "fr",
      fetchImpl: fixtureFetch([[["Bonjour le monde", "Hello world", null, null, 10]], null, "en"], calls),
    });

    expect(results).toEqual(["Bonjour le monde"]);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.origin + url.pathname).toBe("https://translate.googleapis.com/translate_a/single");
    expect(url.searchParams.get("client")).toBe("gtx");
    expect(url.searchParams.get("sl")).toBe("en");
    expect(url.searchParams.get("tl")).toBe("fr");
    expect(url.searchParams.get("q")).toBe("Hello world");
  });

  it("batches multiple lines with the intra-request separator and splits them back", async () => {
    const calls = [];
    const results = await txCli.runGoogle({
      text: "Hello\nWorld",
      from: "en",
      to: "fr",
      fetchImpl: fixtureFetch([[["Bonjour\n\n\nMonde"]], null, "en"], calls),
    });

    expect(results).toEqual(["Bonjour", "Monde"]);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get("q")).toBe("Hello\n\n\nWorld");
  });

  it("persists through the file cache — a second identical run does not re-fetch", async () => {
    const calls = [];
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tx-cli-cache-")), "cache.json");
    const fetchImpl = fixtureFetch([[["Bonjour"]], null, "en"], calls);

    const first = await txCli.runGoogle({ text: "Hello", from: "en", to: "fr", fetchImpl, cachePath });
    const second = await txCli.runGoogle({ text: "Hello", from: "en", to: "fr", fetchImpl, cachePath });

    expect(first).toEqual(["Bonjour"]);
    expect(second).toEqual(["Bonjour"]);
    expect(calls).toHaveLength(1); // second run served from the JSON file cache
    expect(fs.existsSync(cachePath)).toBe(true);
  });
});

describe("tx-cli — ai leg (aimock SSE through the shared engine)", () => {
  it("streams a chat completion end to end", async () => {
    const server = await startAimockLlmServer(0);
    try {
      const port = server.address().port;
      const chunks = [];
      const out = await txCli.runAi({
        text: "Hello world",
        to: "zh-CN",
        provider: "openai",
        model: "gpt-4o-mini",
        key: "test-key",
        base: `http://127.0.0.1:${port}/openai/v1`,
        offline: true, // deterministic: no live models.dev lookup
        onChunk: (chunk) => chunks.push(chunk),
      });

      expect(out.length).toBeGreaterThan(0);
      expect(out).toContain("aimock");
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.join("")).toBe(out);
    } finally {
      await stopAimockLlmServer(server);
    }
  });
});
