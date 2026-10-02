/**
 * dist/chrome production-artifact guards (plan 39, issue #131).
 *
 * Two escape routes this file closes — both were measured on the PUBLISHED
 * Web Store CRX (v2.1.30), not on a local build:
 *
 *  1. **Console noise.** `webpack.production.js` sets terser
 *     `drop_console: true`, but terser only removes console CALLS it can see
 *     through. A call that reaches console through an indirection — computed
 *     member access (`console[level]`), a value-position reference
 *     (`log: console.log`), a default parameter (`onWarn = console.warn`), or
 *     a `typeof console` guarded read — SURVIVES minification and ships.
 *     Audited: 7 survivors shipped in 2.1.30 (3 files), producing 12 log lines
 *     in a minimal repro.
 *
 *  2. **Dangling page assets.** An HTML `<script src>` / `<link href>` with no
 *     matching file in dist/chrome 404s on every page load. Audited:
 *     `options/options.html` referenced `darkmode.js`, which is not in the
 *     CopyWebpackPlugin list → not in the package → one 404 per options open.
 *
 * Why an AST scan and not a regex: the bundles legitimately contain the STRING
 * `https://console.anthropic.com/keys` and seven sibling provider URLs. A plain
 * text scan counts them (47 raw `console` tokens vs 7 real references); only a
 * parse can tell a reference from text inside a literal.
 *
 * The guard runs against whatever `dist/chrome` currently holds (same
 * `describeIfBuilt` contract as the sibling manifest tests), so CI's build step
 * is what gives it teeth.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import parser from "@babel/parser";

const ROOT = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(ROOT, "dist/chrome");

function hasDist() {
  return fs.existsSync(DIST_DIR) && fs.existsSync(path.join(DIST_DIR, "manifest.json"));
}
const describeIfBuilt = hasDist() ? describe : describe.skip;

/** Recursively list files under `dir` whose name ends with `ext`. */
function listFiles(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/**
 * Collect every `console` member access in a bundle.
 *
 * Covers the four shapes that survive `drop_console` plus the `window` /
 * `globalThis` / `self` qualifiers, and reports computed access as
 * `console[<computed>]` so a regression prints something actionable.
 *
 * @param {string} file absolute path to a JS bundle
 * @returns {{line: number|undefined, text: string}[]} one entry per reference
 */
function collectConsoleRefs(file) {
  const ast = parser.parse(fs.readFileSync(file, "utf8"), {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    plugins: ["dynamicImport"],
    errorRecovery: true,
  });

  const hits = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const obj = node.object;
      const onConsole =
        (obj?.type === "Identifier" && obj.name === "console") ||
        (obj?.type === "MemberExpression" &&
          ["window", "globalThis", "self"].includes(obj.object?.name) &&
          !obj.computed &&
          obj.property?.name === "console");
      if (onConsole) {
        hits.push({
          line: node.loc?.start?.line,
          text: node.computed ? "console[<computed>]" : `console.${node.property?.name}`,
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key.endsWith("Comments")) continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object" && typeof value.type === "string") visit(value);
    }
  };
  visit(ast);
  return hits;
}

describeIfBuilt("dist/chrome ships no console references (plan 39, issue #131)", () => {
  // Collection-time note: describe.skip still evaluates this body (vitest must
  // enumerate the tests to mark them skipped), and CI runs `npm test` BEFORE
  // `npm run build` — so never touch the filesystem eagerly when the build is
  // absent. `hasDist() ? … : []` keeps the collection pass ENOENT-free.
  const jsFiles = hasDist() ? listFiles(DIST_DIR, ".js") : [];

  it("at least the webpack entries are present to scan", () => {
    expect(jsFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of jsFiles) {
    const rel = path.relative(DIST_DIR, file).replace(/\\/g, "/");
    it(`${rel} has no console member access`, () => {
      const hits = collectConsoleRefs(file);
      const rendered = hits.map((h) => `  line ${h.line}: ${h.text}`).join("\n");
      expect(hits, `${rel} still references console:\n${rendered}`).toEqual([]);
    });
  }
});

describeIfBuilt("dist/chrome HTML local references resolve (plan 39, issue #131)", () => {
  // Same collection-time constraint as the console-refs block above.
  const htmlFiles = hasDist() ? listFiles(DIST_DIR, ".html") : [];

  it("at least one HTML entry exists to scan", () => {
    expect(htmlFiles.length).toBeGreaterThanOrEqual(1);
  });

  for (const file of htmlFiles) {
    const rel = path.relative(DIST_DIR, file).replace(/\\/g, "/");
    it(`${rel} every local src/href exists on disk`, () => {
      const html = fs.readFileSync(file, "utf8");
      const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      const local = refs.filter(
        (r) => !/^(?:https?:)?\/\//.test(r) && !r.startsWith("data:") && !r.startsWith("#")
      );
      const missing = local.filter((r) => {
        const target = r.startsWith("/")
          ? path.join(DIST_DIR, r.slice(1))
          : path.resolve(path.dirname(file), r);
        return !fs.existsSync(target);
      });
      expect(missing, `${rel} references missing local asset(s): ${missing.join(", ")}`).toEqual([]);
    });
  }
});
