#!/usr/bin/env node
/**
 * visual-review.mjs
 *
 * V1 visual judgment layer — review input builder (issue #67, module D).
 *
 * Takes captured screenshots (from CI artifacts via `gh run download`, or
 * from a local E2E run) and produces `visual-review-input.json`: for every
 * screenshot, the checkpoint declaration from visual-checks.mjs (id,
 * capture context, expect[] criteria) plus the image path and a hash.
 * The Hermes analyzer consumes this file to walk each image against its
 * checklist (VQ3 ①a/②c) and writes the review output separately.
 *
 * Usage:
 *   node scripts/visual-review.mjs --dir /tmp/e2e-shots            # local run output
 *   node scripts/visual-review.mjs --run <github-run-id> [--repo <owner/name>]
 *       (downloads the run's e2e-visual-shots artifact first via gh CLI)
 *   node scripts/visual-review.mjs --dir <path> --out <file.json>
 *
 * Exit code 1 on hard failures (no screenshots found / cannot load
 * visual-checks.mjs). Missing individual checkpoints are reported as
 * warnings — partial runs still produce a reviewable payload.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const dirArg = argValue("--dir");
const runArg = argValue("--run");
const repoArg = argValue("--repo");
const outArg = argValue("--out");
const shotsRoot = process.env.E2E_SHOTS_DIR || "/tmp/e2e-shots";

function log(msg) {
  console.log(`[visual-review] ${msg}`);
}

/** Download the visual-shots artifact for a GitHub run into `<shotsRoot>/<runId>`. */
function downloadArtifact(runId, repo) {
  const dest = path.join(shotsRoot, `run-${runId}`);
  fs.mkdirSync(dest, { recursive: true });
  const cmdArgs = ["run", "download", String(runId), "--name", "e2e-visual-shots", "--dir", dest];
  if (repo) cmdArgs.push("--repo", repo);
  log(`downloading artifact e2e-visual-shots from run ${runId} → ${dest}`);
  execFileSync("gh", cmdArgs, { stdio: "inherit" });
  return dest;
}

/** Compute a stable content hash for an image file. */
function fileHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

async function main() {
  // ── Load the checkpoint declarations ──
  const checksPath = path.join(ROOT, "tests", "browser-e2e", "visual-checks.mjs");
  let checkpoints;
  try {
    const mod = await import(pathToFileURL(checksPath).href);
    checkpoints = mod.CHECKPOINTS;
  } catch (err) {
    console.error(`[visual-review] cannot load visual-checks.mjs: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    console.error("[visual-review] visual-checks.mjs has no CHECKPOINTS");
    process.exit(1);
  }

  // ── Resolve the screenshot directory ──
  let baseDir = dirArg;
  if (runArg) {
    baseDir = downloadArtifact(runArg, repoArg);
  }
  if (!baseDir) {
    console.error("[visual-review] one of --dir <path> or --run <id> is required");
    process.exit(1);
  }
  if (!fs.existsSync(baseDir)) {
    console.error(`[visual-review] directory does not exist: ${baseDir}`);
    process.exit(1);
  }

  // ── Collect shots recursively (artifact layout: <dir>/<scenario>/<id>.png) ──
  const shots = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".png")) {
        shots.push(full);
      }
    }
  }
  walk(baseDir);

  if (shots.length === 0) {
    console.error(`[visual-review] no screenshots found under ${baseDir}`);
    process.exit(1);
  }

  // ── Build the review payload ──
  const byId = new Map();
  for (const shot of shots) {
    const id = path.basename(shot, ".png");
    byId.set(id, shot);
  }

  const items = [];
  const missing = [];
  for (const cp of checkpoints) {
    const shotPath = byId.get(cp.id);
    if (!shotPath) {
      missing.push(cp.id);
      continue;
    }
    items.push({
      id: cp.id,
      scenario: cp.scenario || "visual-audit",
      capture: cp.capture || {},
      expect: cp.expect,
      image: shotPath,
      imageHash: fileHash(shotPath),
    });
  }

  // Failure-site shots ride along (not declared as checkpoints; forensic value)
  const failureShots = [];
  for (const [id, shotPath] of byId.entries()) {
    if (id.startsWith("failure-")) {
      failureShots.push({ id, image: shotPath, imageHash: fileHash(shotPath) });
    }
  }

  // Ground truth from a selftest drill (if present)
  let selftest = null;
  const gtPath = shots.find((s) => s.endsWith("_selftest-groundtruth.json")) ||
    (() => {
      try {
        const candidate = path.join(baseDir, "visual-audit", "_selftest-groundtruth.json");
        return fs.existsSync(candidate) ? candidate : null;
      } catch {
        return null;
      }
    })();
  if (gtPath && fs.existsSync(gtPath)) {
    try {
      selftest = JSON.parse(fs.readFileSync(gtPath, "utf8"));
    } catch {
      selftest = null;
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDir: path.resolve(baseDir),
    totalCheckpoints: checkpoints.length,
    capturedCount: items.length,
    missingCheckpoints: missing,
    items,
    failureShots,
    selftest,
  };

  const outPath = outArg || path.join(baseDir, "visual-review-input.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  log(`${items.length}/${checkpoints.length} checkpoints captured, ${failureShots.length} failure shot(s)`);
  if (missing.length > 0) {
    log(`WARNING missing checkpoints: ${missing.join(", ")}`);
  }
  if (selftest) {
    log(`selftest ground truth present (mode=${selftest.mode}, ${selftest.injections?.length || 0} injection(s))`);
  }
  log(`review input written: ${outPath}`);

  // Hard failure only when NOTHING was captured (a partial run is still reviewable)
  process.exit(items.length === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[visual-review] fatal: ${err.message}`);
  process.exit(1);
});
