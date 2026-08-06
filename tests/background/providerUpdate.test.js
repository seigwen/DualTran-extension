import { describe, expect, it, vi } from "vitest";
import { fetchRemoteProviders, mergeRemoteProviders } from "../../src/background/providerUpdate.js";

describe("providerUpdate", () => {
  describe("mergeRemoteProviders", () => {
    it("adds new providers from remote data", () => {
      const builtIn = [
        { id: "openai", name: "OpenAI", source: "built-in", website: "https://openai.com", apiKeyUrl: "https://platform.openai.com/api-keys", apiBase: "https://api.openai.com/v1", auth: { type: "bearer", header: "Authorization" }, responseFormat: "openai-sse", supportsStreaming: true, category: "global" },
      ];
      const remote = [
        { id: "groq", name: "Groq", source: "remote", website: "https://groq.com", apiKeyUrl: "https://console.groq.com/keys", apiBase: "https://api.groq.com", auth: { type: "bearer", header: "Authorization" }, responseFormat: "openai-sse", supportsStreaming: true, category: "global" },
      ];
      const result = mergeRemoteProviders(builtIn, remote);
      expect(result).toHaveLength(2);
      expect(result.find((p) => p.id === "groq").source).toBe("remote");
    });

    it("updates built-in fields with remote data", () => {
      const builtIn = [
        { id: "openai", name: "OpenAI", apiBase: "https://old.api.openai.com/v1", source: "built-in", website: "https://openai.com", apiKeyUrl: "https://platform.openai.com/api-keys", auth: { type: "bearer", header: "Authorization" }, responseFormat: "openai-sse", supportsStreaming: true, category: "global" },
      ];
      const remote = [
        { id: "openai", name: "OpenAI", apiBase: "https://api.openai.com/v1", source: "remote", website: "https://openai.com", apiKeyUrl: "https://platform.openai.com/api-keys", auth: { type: "bearer", header: "Authorization" }, responseFormat: "openai-sse", supportsStreaming: true, category: "global" },
      ];
      const result = mergeRemoteProviders(builtIn, remote);
      expect(result[0].apiBase).toBe("https://api.openai.com/v1");
      expect(result[0].source).toBe("built-in");
    });

    it("filters out remote entries that fail validation", () => {
      const builtIn = [
        { id: "openai", name: "OpenAI", source: "built-in", website: "https://openai.com", apiKeyUrl: "https://platform.openai.com/api-keys", apiBase: "https://api.openai.com/v1", auth: { type: "bearer", header: "Authorization" }, responseFormat: "openai-sse", supportsStreaming: true, category: "global" },
      ];
      const remote = [
        { id: "bad", name: "" },
      ];
      const result = mergeRemoteProviders(builtIn, remote);
      expect(result).toHaveLength(1);
    });
  });

  describe("fetchRemoteProviders", () => {
    it("returns parsed JSON on success", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([{ id: "test", name: "Test" }]),
      });
      const result = await fetchRemoteProviders("https://example.com/providers.json", fetcher);
      expect(result).toEqual([{ id: "test", name: "Test" }]);
    });

    it("returns null on fetch failure", async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error("Network error"));
      const result = await fetchRemoteProviders("https://example.com/providers.json", fetcher);
      expect(result).toBeNull();
    });

    it("returns null on non-200 status", async () => {
      const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const result = await fetchRemoteProviders("https://example.com/providers.json", fetcher);
      expect(result).toBeNull();
    });

    it("returns null for empty URL", async () => {
      const result = await fetchRemoteProviders("");
      expect(result).toBeNull();
    });
  });
});
