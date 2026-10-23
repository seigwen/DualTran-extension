import { describe, expect, it } from "vitest";
import { formatAiError } from "../../src/core/chat/streamChat.js";

describe("formatAiError", () => {
  it("prefers the provider error message when the body carries one", () => {
    const result = formatAiError({ statusCode: 401, data: { error: { message: "Invalid API key" } } });
    expect(result.message).toBe("Invalid API key");
  });

  it("surfaces the underlying cause when the SDK reports a generic parse failure", () => {
    const result = formatAiError({
      statusCode: 200,
      message: "Failed to process successful response",
      cause: new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"),
    });
    expect(result.message).toContain("Failed to process successful response");
    expect(result.message).toContain("Unexpected token");
  });

  it("flags an HTML body so the endpoint can be corrected", () => {
    const result = formatAiError({
      statusCode: 200,
      message: "Failed to process successful response",
      responseBody: "<!DOCTYPE html><html><head><title>Not Found</title></head></html>",
    });
    expect(result.message).toContain("HTML");
  });

  it("keeps the plain status hint when there is nothing else to report", () => {
    const result = formatAiError({ statusCode: 429 });
    expect(result.message).toBe("Rate limit exceeded");
  });

  it("appends the request URL so a wrong endpoint is visible in the report", () => {
    const result = formatAiError({
      statusCode: 200,
      message: "Failed to process successful response",
      url: "https://ollama.com/chat/completions",
      cause: new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON"),
    });
    expect(result.message).toContain("https://ollama.com/chat/completions");
  });

  it("omits the URL when the error carries none", () => {
    const result = formatAiError({ statusCode: 500, message: "Server error" });
    expect(result.message).not.toContain("[");
  });
});
