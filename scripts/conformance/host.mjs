#!/usr/bin/env node
/**
 * dualtran-extension host conformance gate (SPEC 2.1.0).
 *
 * The conformance assertions live in tests/options/options.test.js
 * (`describe("host conformance (SPEC 2.1.0)")`) because the payload has to be
 * read from the real settings surface: the options page is booted into jsdom
 * with the project's own loadOptionsModule harness, the provider list is the
 * dropdown the user actually sees, and the endpoint value is read after a real
 * provider switch.
 *
 * So this command runs that vitest file — with the kit's own negative controls
 * (selfTest) in front of it, per the kit contract ("a gate that cannot fail is
 * worse than no gate") — and then executes the static anti-pattern scan that
 * conformance.json declares:
 *
 *   npm run conformance:payload   # selfTest + payload contract (vitest)
 *   npm run conformance:static    # banned tokens in the declared static files
 *
 * Keep scripts/conformance/{run,validate,scan}.mjs byte-identical to the kit.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SPEC_VERSION, selfTest } from "./validate.mjs";
import { scanFiles } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const configPath = resolve(repoRoot, "conformance.json");

function die(message) {
  console.error(message);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  die(`conformance.json is missing or invalid: ${error.message}`);
}
if (config.spec !== SPEC_VERSION) {
  die(`conformance.json targets spec ${config.spec}, this kit is ${SPEC_VERSION}`);
}
if (!config.payload) die("conformance.json needs a `payload` (the vitest file carrying the contract)");
const payloadPath = resolve(repoRoot, config.payload);
try {
  readFileSync(payloadPath, "utf8");
} catch (error) {
  die(`payload file ${config.payload} is unreadable: ${error.message}`);
}

// Negative controls first: a gate that cannot fail is worse than no gate.
try {
  const count = selfTest();
  console.log(`self-test: ${count} negative controls caught`);
} catch (error) {
  die(`conformance self-test failed:\n${error.message}`);
}

// Static anti-pattern scan (config.static). Reported here so a banned token is
// attributed to its file and line; the vitest payload re-runs the same scan and
// feeds the hits through validatePayload() as payload.static.hits.
if (config.static) {
  const hits = scanFiles(repoRoot, config.static);
  if (hits.length) {
    for (const hit of hits) console.error(`STATIC ${hit.file}:${hit.line} ${hit.token} — ${hit.text}`);
    die(`STATIC banned token(s) found: ${hits.map((hit) => hit.token).join(", ")}`);
  }
  console.log(`static scan: ${(config.static.files || []).length} file(s), ${(config.static.patterns || []).length} pattern(s), 0 hits`);
}

// Payload contract. The vitest file also calls selfTest()/validatePayload(); the
// exit code of this runner is what `npm run conformance` reports.
const vitestBin = resolve(repoRoot, "node_modules/vitest/vitest.mjs");
try {
  execFileSync(process.execPath, [vitestBin, "run", config.payload], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, CONFORMANCE_STRICT: "1" },
  });
} catch (error) {
  die(`payload contract failed (${config.payload})`);
}

console.log(`PASS ${config.host}: payload contract + static scan (spec ${SPEC_VERSION})`);
