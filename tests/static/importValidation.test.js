/**
 * 导入路径验证 — 防止 ISSUE-005 类 bug（测试文件引用不存在的源模块）
 *
 * 此测试读取所有 .test.js 文件，提取 import 路径，并验证目标文件存在。
 * 发现于 /qa on 2026-07-03
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * 递归读取目录中的所有 .test.js 文件
 */
function findTestFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "fixtures") {
      findTestFiles(fullPath, files);
    } else if (entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * 从文件内容中提取相对 import 路径（排除注释行和字符串内的路径）
 */
function extractImportPaths(fileContent) {
  const paths = [];
  // 匹配: import ... from "./..." 或 import ... from "../..."
  // 排除以 // 开头的注释行
  const regex = /^\s*import\b[^"']*from\s+["'](\.[^"']+)["']/gm;
  let match;
  while ((match = regex.exec(fileContent)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

/**
 * 解析 import 路径为文件系统路径
 */
function resolveImportPath(importPath, testFileDir) {
  // 处理不带扩展名的 import
  const resolved = path.resolve(testFileDir, importPath);
  if (fs.existsSync(resolved)) return resolved;
  if (fs.existsSync(resolved + ".js")) return resolved + ".js";
  if (fs.existsSync(resolved + ".mjs")) return resolved + ".mjs";
  // 检查是否为目录（index.js）
  if (fs.existsSync(path.join(resolved, "index.js"))) return path.join(resolved, "index.js");
  return null;
}

describe("import path validation", () => {
  const testFiles = findTestFiles(testsDir);

  it("至少应有 100 个测试文件", () => {
    expect(testFiles.length).toBeGreaterThan(100);
  });

  // 对每个测试文件验证其 import 路径
  for (const testFile of testFiles) {
    const relativePath = path.relative(projectRoot, testFile);
    const testFileDir = path.dirname(testFile);

    it(`${relativePath} 的所有 import 路径均有效`, () => {
      const content = fs.readFileSync(testFile, "utf-8");
      const importPaths = extractImportPaths(content);

      for (const importPath of importPaths) {
        const resolved = resolveImportPath(importPath, testFileDir);
        expect(
          resolved,
          `${relativePath}: import "${importPath}" → 目标文件不存在`
        ).not.toBeNull();
      }
    });
  }
});
