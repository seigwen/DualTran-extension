import { describe, expect, it, vi } from "vitest";
import {
  createAiStreamParseErrorPayload,
  notifyAiStreamParseError,
  parseOpenAiStyleStreamMessage,
  parseTaggedPageTranslationProgress,
} from "../../src/contentScript/aiStreamMessage.js";

describe("aiStreamMessage", () => {
  it("parses empty, done, and delta stream messages", () => {
    expect(parseOpenAiStyleStreamMessage("   ")).toEqual({ kind: "empty" });
    expect(parseOpenAiStyleStreamMessage("[DONE]")).toEqual({ kind: "done" });
    expect(parseOpenAiStyleStreamMessage('{"choices":[{"delta":{"content":"bonjour"},"finish_reason":null}]}')).toMatchObject({
      kind: "delta",
      text: "bonjour",
    });
  });

  it("reports parse errors and empty results from OpenAI-style chunks", () => {
    expect(parseOpenAiStyleStreamMessage("{bad json").kind).toBe("parse-error");
    expect(parseOpenAiStyleStreamMessage('{"choices":[]}')).toEqual({ kind: "no-result" });
    expect(parseOpenAiStyleStreamMessage('{"choices":[{"delta":{},"finish_reason":null}]}')).toEqual({ kind: "no-delta" });
  });

  it("builds and notifies standardized parse-error payloads", () => {
    const onError = vi.fn();
    const controller = { abort: vi.fn() };
    const error = new Error("Unexpected token <");

    expect(createAiStreamParseErrorPayload(error)).toEqual({
      error: {
        message: "response parsing failed: Unexpected token <",
      },
    });

    expect(notifyAiStreamParseError({ error, controller, onError })).toEqual({
      error: {
        message: "response parsing failed: Unexpected token <",
      },
    });
    expect(controller.abort).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith({
      error: {
        message: "response parsing failed: Unexpected token <",
      },
    });
  });

  it("reports finish reasons without treating them as deltas", () => {
    expect(parseOpenAiStyleStreamMessage('{"choices":[{"delta":{},"finish_reason":"stop"}]}')).toEqual({
      kind: "finished",
      finishReason: "stop",
    });
  });

  it("returns null while page translation tags are still incomplete", () => {
    expect(parseTaggedPageTranslationProgress("<译泽 id=\"i12345678\">hello</译泽")).toBe(null);
    expect(parseTaggedPageTranslationProgress("<")).toBe(null);
  });

  it("extracts translation id and translated text from partial tagged page output", () => {
    expect(parseTaggedPageTranslationProgress('<译泽 id="i12345678">bonjour')).toEqual({
      translationId: "i12345678",
      translatedText: "bonjour",
      remainingAccumulatedText: null,
    });
  });

  it("extracts translated text and remaining buffer after a close tag", () => {
    expect(parseTaggedPageTranslationProgress('<译泽 id="i12345678">bonjour</译泽>tail')).toEqual({
      translationId: "i12345678",
      translatedText: "bonjour",
      remainingAccumulatedText: "tail",
    });
  });
});