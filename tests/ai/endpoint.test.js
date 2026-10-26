import { describe, expect, it, vi } from "vitest";
import { endpointProblemKey, normalizeEndpoint, probeEndpoint } from "../../src/core/chat/endpoint.js";

describe("normalizeEndpoint", () => {
  it("accepts absolute http(s) bases and strips trailing slashes", () => {
    expect(normalizeEndpoint("https://ollama.com/v1/")).toMatchObject({ ok: true, url: "https://ollama.com/v1", origin: "https://ollama.com" });
    expect(normalizeEndpoint("http://localhost:11434/v1")).toMatchObject({ ok: true, url: "http://localhost:11434/v1" });
  });

  it("strips a pasted request path", () => {
    expect(normalizeEndpoint("https://api.example.com/v1/chat/completions")).toMatchObject({ ok: true, url: "https://api.example.com/v1" });
  });

  it("flags a bare host and suggests the https form instead of guessing", () => {
    const result = normalizeEndpoint("ollama.com/v1");
    expect(result.ok).toBe(false);
    expect(result.problem).toBe("missing-scheme");
    expect(result.suggestion).toBe("https://ollama.com/v1");
  });

  it("rejects non-http protocols, templates and query strings", () => {
    expect(normalizeEndpoint("ftp://example.com").problem).toBe("not-http");
    expect(normalizeEndpoint("${OLLAMA_BASE_URL}").problem).toBe("template-var");
    expect(normalizeEndpoint("https://example.com/v1?x=1").problem).toBe("has-query");
    expect(normalizeEndpoint("").problem).toBe("empty");
  });

  it("maps every problem to its own message key", () => {
    const keys = ["empty", "missing-scheme", "not-http", "template-var", "has-query", "nonsense"].map(endpointProblemKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("probeEndpoint", () => {
  const okFetch = () => Promise.resolve({ ok: true, status: 200 });
  const status = (code) => () => Promise.resolve({ ok: false, status: code });

  it("reports ok on 2xx", async () => {
    await expect(probeEndpoint("https://x/v1", { fetchImpl: okFetch })).resolves.toMatchObject({ state: "ok" });
  });

  it("distinguishes an auth failure from a generic http error", async () => {
    await expect(probeEndpoint("https://x/v1", { fetchImpl: status(401) })).resolves.toMatchObject({ state: "unauthorized" });
    await expect(probeEndpoint("https://x/v1", { fetchImpl: status(500) })).resolves.toMatchObject({ state: "http-error" });
  });

  it("reports a blocked request (CORS / missing host permission) as blocked, not as a status", async () => {
    const blocked = () => Promise.reject(new TypeError("NetworkError when attempting to fetch resource."));
    await expect(probeEndpoint("https://x/v1", { fetchImpl: blocked })).resolves.toMatchObject({ state: "blocked" });
  });

  it("reports a timeout", async () => {
    const slow = (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    await expect(probeEndpoint("https://x/v1", { fetchImpl: slow, timeoutMs: 10 })).resolves.toMatchObject({ state: "timeout" });
  });

  it("sends the key as a bearer token", async () => {
    const spy = vi.fn(okFetch);
    await probeEndpoint("https://x/v1", { apiKey: "secret", fetchImpl: spy });
    expect(spy.mock.calls[0][0]).toBe("https://x/v1/models");
    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });
});
