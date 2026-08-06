/**
 * 静态分析: 检测 options.js 中被注释掉的 onChange/oninput handler
 *
 * 被注释掉的 handler 意味着对应的 options 页控件不工作（ISSUE-001~004 的根因）。
 * 此测试在 CI 中运行，发现新注释掉的 handler 时 FAIL。
 *
 * 发现于 /qa on 2026-07-03
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const optionsJsPath = path.resolve(__dirname, "..", "..", "src", "options", "options.js");

/**
 * 已知有意注释掉的 handler（附带原因）。
 * 格式: "selector 模式" → "原因"
 */
const KNOWN_COMMENTED_HANDLERS = new Map([
  // textTranslatorService 可通过 popup/translateSelected 设置，options 页无需单独控制
  ["textTranslatorService", "可控于 popup/translateSelected，options 页移除"],
]);

describe("commented handler detection", () => {
  it("options.js 中不应有未知的被注释 handler", () => {
    const content = fs.readFileSync(optionsJsPath, "utf-8");
    const lines = content.split("\n");

    const commentedHandlers = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 检测被注释的 onChange/oninput handler 注册
      if (/^\s*\/\/.*\$\(["']#(\w+)["']\)\.(onchange|oninput)/.test(line)) {
        const match = line.match(/#(\w+)/);
        const id = match ? match[1] : "unknown";
        if (!KNOWN_COMMENTED_HANDLERS.has(id)) {
          commentedHandlers.push({
            line: i + 1,
            id,
            text: line.trim(),
          });
        }
      }
    }

    if (commentedHandlers.length > 0) {
      const details = commentedHandlers
        .map((h) => `  Line ${h.line}: #${h.id} — ${h.text}`)
        .join("\n");
      expect.fail(
        `发现 ${commentedHandlers.length} 个被注释的 handler:\n${details}\n\n` +
        "这些 handler 被注释意味着对应的 options 页控件不工作。\n" +
        "若要有意禁用，请添加到 KNOWN_COMMENTED_HANDLERS 并注明原因。\n" +
        "否则请取消注释（参见 ISSUE-001~004 的修复）。"
      );
    }
  });
});
