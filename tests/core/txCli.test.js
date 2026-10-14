/**
 * txCli.test.js — Node dual-path proof over the dist-core bundle (plan 59 A5,
 * failure surface + cross-process file cache pinned in plan 61).
 *
 * The google leg runs against an injected fetch fixture that mirrors the real
 * translate_a/single response shape (recorded) — deterministic, no network.
 * The ai leg streams through aimock SSE with the real AI SDK (no network).
 * beforeAll builds dist-core, so this test proves the shipped bundle works.
 *
 * plan 61: the file-cache proof now reads back in a FRESH process (the in-process
 * translationsInProgress memo cannot exist there) with a fetch that throws on any
 * call — the value can only come from the JSON cache file; and the failure surface
 * is pinned: translateGoogle must reject with the provider error, never return a
 * silent empty string, and a failed request must not poison the session memo.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

  it("persists through the file cache — a fresh process reads it back without any fetch (plan 61)", async () => {
    const calls = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-cli-cache-"));
    const cachePath = path.join(dir, "cache.json");
    const fetchImpl = fixtureFetch([[[ "Bonjour"]], null, "en"], calls);

    const first = await txCli.runGoogle({ text: "Hello", from: "en", to: "fr", fetchImpl, cachePath });
    expect(first).toEqual(["Bonjour"]);
    expect(calls).toHaveLength(1);
    expect(fs.existsSync(cachePath)).toBe(true);

    // Second leg: a fresh Node process. The in-process translationsInProgress memo
    // cannot exist there, and the injected fetch throws on any call — so the value
    // can only come from the JSON cache file. (plan 61: the previous in-process
    // second run was short-circuited by the memo and never exercised the read path.)
    const probePath = path.join(dir, "probe.mjs");
    fs.writeFileSync(
      probePath,
      `
      const core = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "dist-core", "index.mjs")).href)});
      const r = await core.translateGoogle({
        sourceArray: ["Hello"],
        sourceLanguage: "en",
        targetLanguage: "fr",
        cache: core.createFileCache(${JSON.stringify(cachePath)}),
        fetchImpl: async () => { throw new Error("NETWORK: the cache read must not fetch"); },
      });
      process.stdout.write(JSON.stringify(r));
    `,
      "utf8"
    );
    const out = execFileSync(process.execPath, [probePath], { encoding: "utf8" });
    expect(JSON.parse(out)).toEqual(["Bonjour"]);
  });

  it("translateGoogle rejects with the provider error instead of a silent empty string (plan 61)", async () => {
    const failing = async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "<html>Sorry...</html>",
      json: async () => ({}),
    });
    await expect(
      txCli.runGoogle({ text: "FailCase-alpha", from: "en", to: "fr", fetchImpl: failing })
    ).rejects.toThrow(/Google translation failed.*429/i);
  });

  it("failure does not poison the session memo — a retry can succeed (plan 61)", async () => {
    const failing = async () => { throw new Error("network down"); };
    await expect(
      txCli.runGoogle({ text: "FailCase-beta", from: "en", to: "fr", fetchImpl: failing })
    ).rejects.toThrow(/Google translation failed/);

    const calls = [];
    const retry = await txCli.runGoogle({
      text: "FailCase-beta",
      from: "en",
      to: "fr",
      fetchImpl: fixtureFetch([[[ "Reprise"]], null, "en"], calls),
    });
    expect(retry).toEqual(["Reprise"]);
    expect(calls).toHaveLength(1);
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
