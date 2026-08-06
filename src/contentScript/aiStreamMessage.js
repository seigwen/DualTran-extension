"use strict";

const PAGE_TRANSLATION_CLOSE_TAG = "</译泽>";

export function parseOpenAiStyleStreamMessage(message) {
  const messageText = typeof message === "string" ? message : String(message ?? "");
  const trimmedMessageText = messageText.trim();

  if (!trimmedMessageText) {
    return { kind: "empty" };
  }

  if (trimmedMessageText === "[DONE]") {
    return { kind: "done" };
  }

  let payload;
  try {
    payload = JSON.parse(trimmedMessageText);
  } catch (error) {
    return {
      kind: "parse-error",
      error,
      message: error?.message
        ? `response parsing failed: ${error.message}`
        : "response parsing failed",
    };
  }

  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  if (!choices.length) {
    return { kind: "no-result" };
  }

  const firstChoice = choices[0] || {};
  if (firstChoice.finish_reason) {
    return { kind: "finished", finishReason: firstChoice.finish_reason };
  }

  const deltaText = firstChoice?.delta?.content;
  if ([undefined, null, ""].includes(deltaText)) {
    return { kind: "no-delta" };
  }

  return {
    kind: "delta",
    payload,
    text: deltaText,
  };
}

export function createAiStreamParseErrorPayload(error) {
  return {
    error: {
      message: error?.message
        ? `response parsing failed: ${error.message}`
        : "response parsing failed",
    },
  };
}

export function notifyAiStreamParseError({ error, controller, onError }) {
  const payload = createAiStreamParseErrorPayload(error);
  if (typeof controller?.abort === "function") {
    try {
      controller.abort();
    } catch (_) {
    }
  }
  onError?.(payload);
  return payload;
}

export function parseTaggedPageTranslationProgress(accumulatedText) {
  const text = typeof accumulatedText === "string" ? accumulatedText : String(accumulatedText ?? "");
  if (
    text.length <= 21 ||
    text.endsWith("<") ||
    text.endsWith("</") ||
    text.endsWith("</译") ||
    text.endsWith("</译泽")
  ) {
    return null;
  }

  const openingTagMatch = text.match(/^<译泽 id="([^"]+)">/);
  if (!openingTagMatch) {
    return null;
  }

  const translationId = openingTagMatch[1];
  const contentStart = text.substring(openingTagMatch[0].length);
  const endTagIndex = contentStart.indexOf("</译");
  const translatedText = endTagIndex > -1 ? contentStart.substring(0, endTagIndex) : contentStart;
  const closeTagIndex = contentStart.indexOf(PAGE_TRANSLATION_CLOSE_TAG);

  return {
    translationId,
    translatedText,
    remainingAccumulatedText: closeTagIndex > -1
      ? contentStart.substring(closeTagIndex + PAGE_TRANSLATION_CLOSE_TAG.length)
      : null,
  };
}