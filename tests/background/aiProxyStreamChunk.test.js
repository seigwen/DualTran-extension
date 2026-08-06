/**
 * aiProxyStreamChunk.test.js
 *
 * 责任：
 * - 锁定 AI SDK `text-delta` 事件的当前字段形状。
 * - 防止依赖升级后再次出现 `part.textDelta === undefined`，导致 aiProxy 向前端发送空 chunk。
 */

import { describe, expect, it } from "vitest";
import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  startAimockLlmServer,
  stopAimockLlmServer,
} from "../mock-server/mock-llm-server-aimock.js";

describe("AI SDK text-delta contract", () => {
  /**
   * 直接重放浏览器 E2E 中的 OpenRouter mock 路径，验证 `fullStream` 的文本事件现在使用 `text` 字段。
   * 这个测试不是在验证 mock 响应内容本身，而是在锁定第三方 SDK 事件契约，防止 aiProxy 继续读取过期字段名。
   */
  it("emits text-delta chunks through the text field for openai-compatible providers", async () => {
    const server = await startAimockLlmServer(0);

    try {
      const address = server.address();
      const baseURL = `http://127.0.0.1:${address.port}/openrouter/v1`;
      const model = createOpenAICompatible({
        name: "openrouter",
        apiKey: "mock-openrouter-key",
        baseURL,
      })("openai/gpt-4o-mini");

      const result = streamText({
        model,
        allowSystemInMessages: true,
        messages: [
          { role: "system", content: "Translate the content within the tags of <译泽>." },
          { role: "assistant", content: "I understand. Please give me the text." },
          { role: "user", content: '<译泽 id="x1">Hello world</译泽><译泽 id="x2">Bye</译泽>' },
        ],
      });

      const textDeltaParts = [];
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          textDeltaParts.push(part);
        }
      }

      // 至少应收到两个文本块，分别对应两个 <译泽> 节点。
      expect(textDeltaParts.length).toBeGreaterThanOrEqual(2);

      // 当前 SDK 契约：文本内容位于 `text`，而不是旧字段 `textDelta`。
      expect(textDeltaParts.every((part) => typeof part.text === "string" && part.text.length > 0)).toBe(true);
      expect(textDeltaParts.some((part) => part.text.includes("🌐[aimock]"))).toBe(true);
    } finally {
      await stopAimockLlmServer(server);
    }
  });
});