/**
 * Release evidence (plan 83, P0).
 *
 * "Shipping" must be a claim backed by a file, not by memory. This script runs the
 * checks that a release depends on, records each result with its duration, and writes
 * release-evidence.json. Publishing scripts refuse to run without an all-pass bundle.
 *
 * Checks whose tooling does not exist yet (P1 conformance, P2 store audit) are recorded
 * as "skipped" and marked pending, so the gap is visible instead of silently absent.
 *
 * Usage: node scripts/release-check.mjs [--allow-pending]
 * Exit codes: 0 = pass, 1 = blockers, 2 = usage/IO error.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_PATH = path.join(ROOT, "release-evidence.json");

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

/** Version in src/manifest.json (tolerates the file's // comments). */
export function manifestVersion() {
  const raw = fs.readFileSync(path.join(ROOT, "src", "manifest.json"), "utf8");
  const match = raw.match(/"version"\s*:\s*"([^"]+)"/);
  return match ? match[1] : "";
}

/** Top-most released heading in CHANGELOG.md. */
export function changelogVersion() {
  const raw = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const match = raw.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  return match ? match[1] : "";
}

export function checkVersions() {
  const manifest = manifestVersion();
  const changelog = changelogVersion();
  if (!manifest) return { status: "fail", detail: "src/manifest.json has no version" };
  if (!changelog) return { status: "fail", detail: "CHANGELOG.md has no version heading" };
  if (manifest !== changelog) {
    return { status: "fail", detail: `manifest ${manifest} != changelog ${changelog}` };
  }
  return { status: "pass", detail: manifest };
}

function run(name, command, args, { required = true, timeout = 900000 } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", timeout, env: process.env });
  const durationMs = Date.now() - started;
  if (result.status === 0) return { name, status: "pass", durationMs, detail: tail(result.stdout) };
  const detail = tail(`${result.stdout || ""}\n${result.stderr || ""}`);
  return { name, status: required ? "fail" : "warn", durationMs, detail };
}

const tail = (text) =>
  String(text || "")
    .trim()
    .split("\n")
    .slice(-3)
    .join(" | ")
    .slice(0, 300);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function collectArtifacts() {
  const artifacts = [];
  const outDir = path.join(ROOT, "..", "DualTran-manage", "out");
  const version = manifestVersion();
  for (const name of [`DualTran-v${version}-firefox.zip`, `DualTran-v${version}.zip`]) {
    const file = path.join(outDir, name);
    if (fs.existsSync(file)) artifacts.push({ path: file, sha256: sha256(file), bytes: fs.statSync(file).size });
  }
  return artifacts;
}

function main(argv) {
  const allowPending = argv.includes("--allow-pending");
  const checks = [];

  checks.push({ name: "versions", ...checkVersions() });
  checks.push(run("unit-tests", "npx", ["vitest", "run"], { timeout: 1800000 }));

  const ledger = run("bug-ledger", "node", ["scripts/check-bug-ledger.mjs", "--release"], { timeout: 60000 });
  checks.push(ledger);

  checks.push(run("lint-i18n-writes", "npm", ["run", "lint:i18n-writes"], { timeout: 300000 }));
  checks.push(run("lint-core-boundary", "npm", ["run", "lint:core-boundary"], { timeout: 300000 }));
  checks.push(run("build-firefox", "npm", ["run", "build:firefox"], { timeout: 900000 }));

  const conformance = path.join(ROOT, "tests", "conformance", "run.mjs");
  checks.push(
    fs.existsSync(conformance)
      ? run("conformance", "node", ["tests/conformance/run.mjs", "--engine=all"], { timeout: 1200000 })
      : { name: "conformance", status: "skipped", detail: "tests/conformance not implemented yet (P1)" }
  );

  const storeAudit = path.join(ROOT, "scripts", "store", "audit.mjs");
  checks.push(
    fs.existsSync(storeAudit)
      ? run("store-audit", "node", ["scripts/store/audit.mjs"], { timeout: 600000 })
      : { name: "store-audit", status: "skipped", detail: "scripts/store/audit.mjs not implemented yet (P2)" }
  );

  const blockers = checks.filter((check) => check.status === "fail").map((check) => check.name);
  const pending = checks.filter((check) => check.status === "skipped").map((check) => check.name);
  const overall = blockers.length === 0 && (allowPending || pending.length === 0) ? "pass" : "fail";

  const evidence = {
    version: manifestVersion(),
    gitSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    at: new Date().toISOString(),
    checks,
    artifacts: collectArtifacts(),
    pending,
    blockers,
    overall,
  };
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);

  const summary = checks.map((check) => `${check.status.padEnd(7)} ${check.name}`).join("\n");
  console.log(`[release-check] ${overall.toUpperCase()} — v${evidence.version} (${evidence.gitSha.slice(0, 7)})`);
  console.log(summary);
  if (pending.length) console.log(`[release-check] pending tooling: ${pending.join(", ")}`);
  if (blockers.length) console.error(`[release-check] blockers: ${blockers.join(", ")}`);
  console.log(`[release-check] evidence -> ${EVIDENCE_PATH}`);
  return overall === "pass" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
