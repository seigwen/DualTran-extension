import { describe, expect, it } from "vitest";
import { formatAiError } from "../../src/core/chat/streamChat.js";

describe("formatAiError", () => {
  it("never renders the provider's own error text on screen", () => {
    const result = formatAiError({ statusCode: 401, data: { error: { message: "Invalid API key from provider" } } });
    // The hint is ours; the provider's wording is diagnostics only.
    expect(result.message).toBe("Invalid or missing API key (HTTP 401)");
    expect(result.code).toBe("http_401");
    expect(result.detail).toContain("Invalid API key from provider");
  });

  it("keeps the raw cause out of the message and in the detail", () => {
    const result = formatAiError({
      statusCode: 200,
      message: "Failed to process successful response",
      cause: new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"),
    });
    expect(result.message).not.toContain("Unexpected token");
    expect(result.code).toBe("parse");
    expect(result.detail).toContain("Unexpected token");
  });

  it("flags an HTML body without echoing it", () => {
    const result = formatAiError({
      statusCode: 200,
      message: "Failed to process successful response",
      responseBody: "<!DOCTYPE html><html><head><title>Not Found</title></head></html>",
    });
    expect(result.message).toContain("HTML");
    expect(result.message).not.toContain("DOCTYPE");
    expect(result.detail).toContain("DOCTYPE");
  });

  it("keeps the plain status hint when there is nothing else to report", () => {
    const result = formatAiError({ statusCode: 429 });
    expect(result.message).toBe("Rate limit exceeded (HTTP 429)");
  });

  it("never puts the request URL on screen", () => {
    const result = formatAiError({
      statusCode: 200,
      message: "Failed to process successful response",
      url: "https://ollama.example/chat/completions",
      cause: new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON"),
    });
    expect(result.message).not.toContain("ollama.example");
    expect(result.detail).toContain("https://ollama.example/chat/completions");
  });

  it("classifies a transport failure as a network error", () => {
    const result = formatAiError({ name: "TypeError", message: "Failed to fetch" });
    expect(result.code).toBe("network");
    expect(result.statusCode).toBe("");
    expect(result.message).toContain("Cannot reach the AI service");
  });

  it("omits the URL when the error carries none", () => {
    const result = formatAiError({ statusCode: 500, message: "Server error" });
    expect(result.message).not.toContain("[");
    expect(result.detail).toBe("");
  });
});
