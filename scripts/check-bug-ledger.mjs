/**
 * Bug ledger guard (plan 83, P0).
 *
 * Enforces the rule that made four escaped defects possible to ship: a fix without a
 * regression test. Every bug recorded in docs/bugs/ledger.json must name the test(s)
 * that would catch it, and a pull request that references a bug must touch one of them.
 *
 * Usage:
 *   node scripts/check-bug-ledger.mjs                      # PR mode (reads PR body + git diff)
 *   node scripts/check-bug-ledger.mjs --release            # release mode (open bugs block)
 *   node scripts/check-bug-ledger.mjs --body-file pr.md --changed-files a.js,b.js
 *
 * Exit codes: 0 = ok, 1 = violations, 2 = usage/IO error.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LEDGER_PATH = path.join(ROOT, "docs", "bugs", "ledger.json");

/**
 * Extract BUG-<digits> references from free text.
 * @param {string} text
 * @returns {string[]} unique ids, in first-seen order
 */
export function parseBugIds(text) {
  const ids = [];
  for (const match of String(text || "").matchAll(/\bBUG-(\d{3,})\b/g)) {
    const id = `BUG-${match[1]}`;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Structural validation of the ledger itself.
 * @param {object} ledger
 * @returns {string[]} problems
 */
export function validateLedger(ledger) {
  const problems = [];
  if (!ledger || !Array.isArray(ledger.bugs)) return ["ledger.bugs must be an array"];
  const seen = new Set();
  for (const bug of ledger.bugs) {
    if (!bug?.id || !/^BUG-\d{3,}$/.test(bug.id)) problems.push(`invalid or missing id: ${JSON.stringify(bug?.id)}`);
    if (seen.has(bug?.id)) problems.push(`duplicate id: ${bug.id}`);
    seen.add(bug?.id);
    if (!bug?.title) problems.push(`${bug?.id}: missing title`);
    if (!Array.isArray(bug?.regressionTests)) problems.push(`${bug?.id}: regressionTests must be an array`);
    if (typeof bug?.guarded !== "boolean") problems.push(`${bug?.id}: guarded must be a boolean`);
  }
  return problems;
}

/**
 * Decide whether the PR honours the ledger rule.
 * @param {{ledger: object, body?: string, changedFiles?: string[], release?: boolean}} input
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function checkPullRequest({ ledger, body = "", changedFiles = [], release = false }) {
  const errors = [];
  const warnings = [];
  const structural = validateLedger(ledger);
  if (structural.length) errors.push(...structural);

  const bugs = Array.isArray(ledger?.bugs) ? ledger.bugs : [];
  const byId = new Map(bugs.map((bug) => [bug.id, bug]));
  const referenced = parseBugIds(body);

  for (const id of referenced) {
    const bug = byId.get(id);
    if (!bug) {
      errors.push(`${id} is referenced but missing from docs/bugs/ledger.json`);
      continue;
    }
    if (!bug.regressionTests?.length) {
      errors.push(`${id} has no regressionTests entry`);
      continue;
    }
    const touched = bug.regressionTests.filter((file) => changedFiles.includes(file));
    if (touched.length === 0) {
      errors.push(
        `${id} is referenced but none of its regression tests changed in this PR (expected one of: ${bug.regressionTests.join(", ")})`
      );
    }
  }

  const unguarded = bugs.filter((bug) => bug.guarded === false).map((bug) => bug.id);
  if (unguarded.length) {
    const message = `${unguarded.length} bug(s) still unguarded: ${unguarded.join(", ")}`;
    if (release) errors.push(`release blocked — ${message}`);
    else warnings.push(message);
  }

  return { ok: errors.length === 0, errors, warnings };
}

function changedFilesFromGit() {
  const base = process.env.GITHUB_BASE_REF || "master";
  try {
    const out = execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD`], { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    // A shallow clone has no merge base; returning [] here would blame every BUG reference
    // instead of the actual problem, so say what happened.
    return null;
  }
}

function readBody(argv) {
  const fileIndex = argv.indexOf("--body-file");
  if (fileIndex !== -1 && argv[fileIndex + 1]) return fs.readFileSync(argv[fileIndex + 1], "utf8");
  if (process.env.PR_BODY) return process.env.PR_BODY;
  if (process.env.GITHUB_EVENT_PATH && fs.existsSync(process.env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
      return `${event?.pull_request?.title || ""}\n${event?.pull_request?.body || ""}`;
    } catch {
      return "";
    }
  }
  return "";
}

function main(argv) {
  const release = argv.includes("--release");
  const filesIndex = argv.indexOf("--changed-files");
  const changedFiles =
    filesIndex !== -1 && argv[filesIndex + 1] ? argv[filesIndex + 1].split(",").map((f) => f.trim()) : changedFilesFromGit();

  if (changedFiles === null && parseBugIds(readBody(argv)).length > 0) {
    console.error(`[bug-ledger] cannot compute changed files (no merge base with origin/${process.env.GITHUB_BASE_REF || "master"}).`);
    console.error("[bug-ledger] in CI, check out with fetch-depth: 0 so the base branch is available.");
    return 2;
  }

  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  } catch (error) {
    console.error(`[bug-ledger] cannot read ${LEDGER_PATH}: ${error.message}`);
    return 2;
  }

  const result = checkPullRequest({ ledger, body: readBody(argv), changedFiles: changedFiles || [], release });
  for (const warning of result.warnings) console.warn(`[bug-ledger] warning: ${warning}`);
  for (const error of result.errors) console.error(`[bug-ledger] error: ${error}`);

  if (result.ok) {
    console.log(`[bug-ledger] ok — ${ledger.bugs.length} bug(s) tracked, ${result.warnings.length} warning(s)`);
    return 0;
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
