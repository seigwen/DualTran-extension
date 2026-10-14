/**
 * coreBoundary.test.js — calibration for scripts/check-core-boundary.js (plan 59 M4-3).
 *
 * The guard gets three runs:
 *   1. the real tree (must PASS),
 *   2. a fixture dir of violations (must go RED, each violation shape named),
 *   3. a fixture dir of lookalikes — host globals inside strings/comments,
 *      inside template interpolations' *text*, and legit in-core imports
 *      (must NOT fire).
 *
 * A guard that is never proven to fire is dead; a guard that fires on clean
 * code gets disabled. Both directions are pinned here.
 *
 * Implementation-point map (rule symmetry, CLAUDE.md "core boundary" rule):
 *   serviceRuntime  — host-capability injection carrier (src/core/engines/serviceBase.js)
 *   translateGoogle — host-free Google entry point (src/core/engines/google.js)
 * (Paths stay in prose on purpose — the lint extracts bare identifiers only.)
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SCRIPT = path.join(ROOT, "scripts", "check-core-boundary.js");

function runBoundary(dir) {
  const args = [SCRIPT];
  if (dir) args.push("--dir", dir);
  try {
    const out = execFileSync(process.execPath, args, { encoding: "utf8" });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

function writeFixture(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, "utf8");
}

describe("core boundary guard (plan 59 M4-3)", () => {
  it("runs clean on the real src/core tree", () => {
    const { code, out } = runBoundary(null);
    expect(code).toBe(0);
    expect(out).toContain("core boundary clean");
  });

  describe("fixture calibration", () => {
    let violatingDir;
    let lookalikeDir;

    beforeAll(() => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "core-boundary-"));

      violatingDir = path.join(base, "violations");
      fs.mkdirSync(violatingDir);
      writeFixture(
        violatingDir,
        "host-globals.js",
        [
          "export function bad() {",
          "  const a = chrome.storage.local;",
          "  document.title = 'x';",
          "  const w = window.scrollY;",
          "  indexedDB.open('db');",
          "  location.href = 'x';",
          "  alert('a');",
          "  confirm('b');",
          "  prompt('c');",
          "  return [a, w];",
          "}",
          "",
        ].join("\n")
      );
      writeFixture(
        violatingDir,
        "interpolation-evasion.js",
        "export const u = `prefix ${chrome.runtime.id} suffix`;\n"
      );
      writeFixture(
        violatingDir,
        "escapes-core.js",
        ['import { one } from "../background/aiProxy.js";', 'export const two = await import("../../contentScript/fetchSSE.js");', ""].join("\n")
      );
      writeFixture(
        violatingDir,
        "absolute-specifier.js",
        ['import { z } from "/src/background/x.js";', 'export const c = await import("chrome-extension://abc/options/options.js");', ""].join("\n")
      );

      lookalikeDir = path.join(base, "lookalikes");
      fs.mkdirSync(lookalikeDir);
      writeFixture(
        lookalikeDir,
        "doc-mentions.js",
        [
          "// This comment mentions chrome.storage.local and window.document freely.",
          "/** JSDoc: never touches chrome. or indexedDB or location. here */",
          "export const literal = 'a string with chrome. and prompt( inside';",
          "export const template = `a template with window. and document. inside ${1 + 2}`;",
          "import { readFileSync } from \"node:fs\";",
          "import { helper } from \"./helper.js\";",
          "export function use() { return readFileSync && helper; }",
          "",
        ].join("\n")
      );
      writeFixture(lookalikeDir, "helper.js", "export const helper = 1;\n");
    });

    afterAll(() => {
      if (violatingDir) fs.rmSync(path.dirname(violatingDir), { recursive: true, force: true });
    });

    it("violating fixtures go RED and every violation shape is named", () => {
      const { code, out } = runBoundary(violatingDir);
      expect(code).toBe(1);
      expect(out).toContain("chrome.* host API");
      expect(out).toContain("window.* host API");
      expect(out).toContain("document.* host API");
      expect(out).toContain("indexedDB");
      expect(out).toContain("location.* host API");
      expect(out).toContain("alert()");
      expect(out).toContain("confirm()");
      expect(out).toContain("prompt()");
      expect(out).toContain("escapes src/core");
      expect(out).toContain("extension layer");
      expect(out).toContain("absolute/extension specifier");
      expect(out).toContain("interpolation-evasion.js:1:"); // chrome inside a template interpolation is still code
    });

    it("lookalikes (strings/comments/template text) do NOT fire — and in-core imports pass", () => {
      const { code, out } = runBoundary(lookalikeDir);
      expect(code).toBe(0);
      expect(out).toContain("core boundary clean");
    });
  });
});
