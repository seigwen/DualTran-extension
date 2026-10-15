#!/usr/bin/env node
/**
 * lint-firefox.mjs — run web-ext lint (addons-linter) against dist/firefox.
 *
 * Plan 62 M1. Policy: ERRORS are fatal (exit 1); warnings are printed so they
 * can be triaged, but tolerated — the AMO submission gate is "0 errors".
 * The linter is the same one AMO runs on submission, so this is the closest
 * local proxy for the store's first validation pass.
 *
 * Requires dist/firefox to exist: `npm run build:firefox` first.
 * web-ext 10 needs Node 22+ (local + release CI; the unit-test CI job stays on
 * Node 20 and does not run this script).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { findUnknownWarnings } = require("./firefox-lint-policy.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "dist", "firefox");

if (!fs.existsSync(path.join(SOURCE_DIR, "manifest.json"))) {
  console.error("dist/firefox/manifest.json missing - run `npm run build:firefox` first.");
  process.exit(2);
}

// `npx web-ext` prefers the local devDependency binary over the registry.
const result = spawnSync(
  "npx",
  ["--no-install", "web-ext", "lint", "--source-dir", SOURCE_DIR, "--output", "json"],
  { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);

if (result.error) {
  console.error(`failed to run web-ext: ${result.error.message}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  // Bootstrap or crash output — surface it raw so the failure is diagnosable.
  console.error(result.stdout || "(empty stdout)");
  console.error(result.stderr || "(empty stderr)");
  process.exit(1);
}

const errors = report.errors || [];
const warnings = report.warnings || [];
const unknown = findUnknownWarnings(warnings);

for (const w of warnings) {
  console.log(`warning: [${w.code}] ${w.message}${w.file ? ` (${w.file})` : ""}`);
}
for (const e of errors) {
  console.error(`error: [${e.code}] ${e.message}${e.file ? ` (${e.file})` : ""}`);
}
for (const w of unknown) {
  console.error(
    `NEW warning outside the archived allowlist: [${w.code}] ${w.message}` +
      `${w.file ? ` (${w.file})` : ""} - triage it, then either fix it or ` +
      `extend scripts/firefox-lint-policy.js with a reason.`
  );
}
console.log(
  `web-ext lint: ${errors.length} error(s), ${warnings.length} warning(s) ` +
    `(${unknown.length} outside the archived allowlist).`
);

if (errors.length > 0 || unknown.length > 0) process.exit(1);
