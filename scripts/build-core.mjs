#!/usr/bin/env node
/**
 * build-core.mjs — bundle src/core into dist-core/ (plan 59 M4-1).
 *
 * Output: dist-core/index.mjs (ESM) + index.mjs.map, gitignored like dist/.
 * SDK dependencies stay external — the consumer provides them (plan 59 D7).
 * `drop: ["console"]` keeps library consumers free of internal logs (D5);
 * the extension bundle is unaffected (it builds from src directly).
 *
 * Usage: npm run build:core
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [path.join(root, "src/core/index.js")],
  outfile: path.join(root, "dist-core/index.mjs"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  drop: ["console"],
  external: ["ai", "@ai-sdk/*", "common-tags", "eventsource-parser", "node:*"],
  logLevel: "info",
  metafile: true,
});

const out = path.join(root, "dist-core/index.mjs");
const bytes = fs.statSync(out).size;
const outputs = Object.entries(result.metafile.outputs);
console.log(`✅ dist-core/index.mjs built — ${bytes} bytes (gzip n/a)`);
for (const [name, info] of outputs) {
  if (name.endsWith(".mjs")) console.log(`   ${name}: ${info.bytes} bytes`);
}
