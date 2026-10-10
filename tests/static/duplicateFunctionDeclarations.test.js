/**
 * 静态守卫：同一语句块内不得重复声明同名函数（#161 类缺陷根治）
 *
 * 背景：函数声明在 JS 中会被提升，同作用域内同名重复声明时**后声明静默覆盖前声明**——
 * 不报错、不警告，旧实现变成永不执行的幽灵代码。options.js 曾发生两处同族缺陷：
 *   - `populateGoogleGeminiModels` 同作用域 ×2（#161：迁移半途旧实现未删，
 *     "改错副本=白改"，且删除任一副本都会静默切换运行时行为）；
 *   - `popup-translate-text.js` 的 `stopAudio` ×2（纯复制粘贴事故）。
 * 此守卫按「直接语句块」粒度做 AST 检查（同块内重名 = 必为缺陷；跨块同名 = 合法遮蔽，不报）。
 *
 * 解析器：@babel/parser（与 tests/manifest/buildArtifactGuards.test.js 同源用法）。
 * 解析失败会让本测试红——这是有意为之：src/ 下任何解析失败都会使守卫失去意义。
 *
 * 发现于 /qa（spec 47 P4 收尾，#161）。
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import parser from "@babel/parser";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** 递归列出 dir 下所有 .js 文件。 */
function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/**
 * 语句块容器 = 可以容纳 FunctionDeclaration 的「直接声明列表」。
 * Program.body / BlockStatement.body / StaticBlock.body / SwitchCase.consequent。
 */
function statementContainer(node) {
  if (node.type === "Program" || node.type === "BlockStatement" || node.type === "StaticBlock") {
    return node.body;
  }
  if (node.type === "SwitchCase") {
    return node.consequent;
  }
  return null;
}

/** 返回 { duplicates: [{ name, line }], totalDeclarations }。 */
function collectDuplicateFunctionDeclarations(code) {
  const ast = parser.parse(code, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    plugins: ["dynamicImport"],
  });
  const duplicates = [];
  let totalDeclarations = 0;

  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node.type !== "string") return;

    const body = statementContainer(node);
    if (body) {
      const seen = new Map();
      for (const statement of body) {
        if (statement?.type === "FunctionDeclaration" && statement.id?.name) {
          totalDeclarations += 1;
          const previousLine = seen.get(statement.id.name);
          if (previousLine !== undefined) {
            duplicates.push({
              name: statement.id.name,
              line: statement.loc?.start?.line,
              firstLine: previousLine,
            });
          } else {
            seen.set(statement.id.name, statement.loc?.start?.line);
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      walk(node[key]);
    }
  })(ast);

  return { duplicates, totalDeclarations };
}

describe("静态守卫：重复函数声明（#161）", () => {
  it("src/ 下没有任何语句块重复声明同名函数", () => {
    const files = listJsFiles(SRC_DIR);
    // 防空跑护栏：文件数与函数声明总数必须达到当前量级
    expect(files.length).toBeGreaterThanOrEqual(80);

    let totalDeclarations = 0;
    const violations = [];

    for (const file of files) {
      const source = fs.readFileSync(file, "utf-8");
      let result;
      try {
        result = collectDuplicateFunctionDeclarations(source);
      } catch (error) {
        violations.push(`${path.relative(SRC_DIR, file)}: 解析失败 — ${error.message}`);
        continue;
      }
      totalDeclarations += result.totalDeclarations;
      for (const duplicate of result.duplicates) {
        violations.push(
          `${path.relative(SRC_DIR, file)}:${duplicate.line} 重复声明 "${duplicate.name}"（首见于 :${duplicate.firstLine}）`
        );
      }
    }

    expect(totalDeclarations).toBeGreaterThanOrEqual(300);
    expect(violations).toEqual([]);
  });
});
