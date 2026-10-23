import { describe, expect, it } from "vitest";
import { endpointOriginPattern } from "../../src/lib/ai/endpointPermission.js";

describe("endpointOriginPattern", () => {
  it("reduces an API base URL to its origin pattern", () => {
    expect(endpointOriginPattern("https://ollama.com/v1")).toBe("https://ollama.com/*");
    expect(endpointOriginPattern("http://localhost:11434/v1")).toBe("http://localhost:11434/*");
    expect(endpointOriginPattern("https://api.example.com/openai/v1/chat/completions")).toBe(
      "https://api.example.com/*"
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(endpointOriginPattern("  https://ollama.com/v1  ")).toBe("https://ollama.com/*");
  });

  it("returns an empty pattern for values that cannot be a request target", () => {
    expect(endpointOriginPattern("")).toBe("");
    expect(endpointOriginPattern("ollama.com/v1")).toBe("");
    expect(endpointOriginPattern("/v1")).toBe("");
    expect(endpointOriginPattern("ftp://example.com")).toBe("");
  });
});
