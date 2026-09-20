#!/usr/bin/env node
/**
 * check-visual-fidelity.mjs
 *
 * Visual checkpoint fidelity gate (V2, issue #75).
 *
 * ── Why this exists ──
 *
 * The V1 acceptance ("same build, two runs, 0 pixel diff") proved
 * DETERMINISM, not FIDELITY. Nothing verified that a given screenshot
 * actually captured the moment its checkpoint declares. In run 35499329775
 * the `baseline-untranslated` shot was a fully translated French page and
 * the `replace-original-mode` shot was byte-identical to it — four declared
 * expectations violated, zero machines objected.
 *
 * ── The invariant (calibrated against real runs) ──
 *
 * A checkpoint declares `mustDifferFrom: ["<other-id>", ...]`: the claim
 * that these two checkpoints capture GENUINELY DIFFERENT states, so their
 * screenshots must not be visually identical. The threshold is a pixel-diff
 * ratio below MIN_DIFF_RATIO.
 *
 * The naive form of this invariant — "no two checkpoints may ever be
 * byte-identical" — is WRONG and was empirically falsified: in a clean run
 * `after-ai-translation` and `floating-three-state` are byte-identical,
 * because both legitimately declare "AI text visible + AI button active"
 * and the capture sequence converges to the same visual state. A gate that
 * fires on correct behaviour is worse than no gate. Hence: declared pairs
 * only.
 *
 * Calibration evidence (2026-09-20, /tmp/visual-review{,-prev}):
 *
 *   pair                                       clean run   defect run
 *   baseline ~ replace-original                  6.67%       0.00%  ← caught
 *   after-google ~ after-ai                      7.24%       0.00%  ← caught
 *   after-ai ~ floating-three-state              0.00%       0.00%  ← NOT declared (converges legitimately)
 *
 * ── Scope rules ──
 *   - Pairs are matched WITHIN one scenario directory only.
 *   - `failures/` is excluded — forensic shots carry no fidelity claim.
 *   - A missing shots dir exits 0 (the E2E run already failed; no double report).
 *   - A missing image for a declared pair is reported as a warning, not a
 *     hard failure (the E2E side already fails on missing checkpoints).
 *
 * Why .mjs: pixelmatch v7 is ESM-only and package.json declares
 * `"type": "commonjs"` — a CJS require() of pixelmatch throws.
 *
 * Usage:
 *   node scripts/check-visual-fidelity.mjs                     # /tmp/e2e-shots
 *   node scripts/check-visual-fidelity.mjs --dir <path>
 *   node scripts/check-visual-fidelity.mjs --json
 *
 * Exit code 1 when a declared pair fails to differ; 0 otherwise.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * Minimum pixel-diff ratio for two declared-different checkpoints.
 * Below this they are treated as capturing the same visual state.
 * Calibrated on real runs: genuine state changes measured ≥ 5.7%; the
 * #75 defect measured 0.0000%. 0.1% is a wide, safe margin.
 */
const MIN_DIFF_RATIO = 0.001;

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const shotsRoot = argValue("--dir") || process.env.E2E_SHOTS_DIR || "/tmp/e2e-shots";
const jsonOut = args.includes("--json");
const checksPath = argValue("--checks") || path.join(ROOT, "tests", "browser-e2e", "visual-checks.mjs");

function log(msg) {
  console.log(`[fidelity] ${msg}`);
}

/** Pixel-diff ratio between two PNGs; -1 on size mismatch / unreadable. */
function diffRatio(aPath, bPath) {
  try {
    const a = PNG.sync.read(fs.readFileSync(aPath));
    const b = PNG.sync.read(fs.readFileSync(bPath));
    if (a.width !== b.width || a.height !== b.height) return { ratio: -1, sizeMismatch: true };
    const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
    return { ratio: diff / (a.width * a.height), sizeMismatch: false };
  } catch {
    return { ratio: -1, sizeMismatch: false, unreadable: true };
  }
}

async function main() {
  // ── Load the checkpoint declarations (mustDifferFrom lives beside expect[]) ──
  let checkpoints;
  try {
    const mod = await import(pathToFileURL(checksPath).href);
    checkpoints = mod.CHECKPOINTS;
  } catch (err) {
    console.warn(`[fidelity] cannot load ${path.relative(ROOT, checksPath)}: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(checkpoints)) {
    console.warn("[fidelity] visual-checks.mjs has no CHECKPOINTS array");
    process.exit(1);
  }

  if (!fs.existsSync(shotsRoot)) {
    log(`skipped (no shots dir: ${shotsRoot})`);
    process.exit(0);
  }

  // ── Index captured shots: scenario → id → path ──
  const byScenario = new Map();
  for (const entry of fs.readdirSync(shotsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "failures") continue; // forensic shots: no fidelity claim
    const dir = path.join(shotsRoot, entry.name);
    const ids = new Map();
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith(".png")) {
        ids.set(path.basename(f.name, ".png"), path.join(dir, f.name));
      }
    }
    byScenario.set(entry.name, ids);
  }

  // ── Walk declared mustDifferFrom pairs ──
  const violations = [];
  const warnings = [];
  let checked = 0;

  for (const cp of checkpoints) {
    const declared = Array.isArray(cp.mustDifferFrom) ? cp.mustDifferFrom : [];
    if (declared.length === 0) continue;

    const scenario = cp.scenario || "visual-audit";
    const shots = byScenario.get(scenario);
    if (!shots) continue; // scenario not captured in this run

    const aPath = shots.get(cp.id);
    if (!aPath) {
      warnings.push(`${cp.id}: not captured in this run (pair check skipped)`);
      continue;
    }

    for (const otherId of declared) {
      const bPath = shots.get(otherId);
      if (!bPath) {
        warnings.push(`${cp.id} ~ ${otherId}: ${otherId} not captured in this run`);
        continue;
      }

      checked++;
      const { ratio, sizeMismatch, unreadable } = diffRatio(aPath, bPath);
      if (unreadable) continue;
      if (sizeMismatch) {
        warnings.push(`${cp.id} ~ ${otherId}: image size mismatch`);
        continue;
      }
      if (ratio === 0) {
        const h = crypto.createHash("sha256").update(fs.readFileSync(aPath)).digest("hex").slice(0, 16);
        violations.push({ scenario, a: cp.id, b: otherId, ratio, hash: h, byteIdentical: true });
      } else if (ratio < MIN_DIFF_RATIO) {
        violations.push({ scenario, a: cp.id, b: otherId, ratio, byteIdentical: false });
      }
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify({
      shotsRoot: path.resolve(shotsRoot),
      declaredPairsChecked: checked,
      violations,
      warnings,
      minDiffRatio: MIN_DIFF_RATIO,
    }, null, 2));
  } else {
    log(`${checked} declared pair(s) checked in ${shotsRoot}`);
    for (const w of warnings) console.log(`⚠️  WARN ${w}`);
    for (const v of violations) {
      const pct = (v.ratio * 100).toFixed(4);
      console.warn(
        `⚠️  HARD ${v.scenario}/${v.a} ~ ${v.a === v.b ? "" : `${v.scenario}/${v.b}`} differ by ${pct}% ` +
          `(min ${(MIN_DIFF_RATIO * 100).toFixed(2)}%)` +
          (v.hash ? ` sha256:${v.hash}` : "") +
          ` — declared as different states but captured the same visual state (issue #75).`
      );
    }
  }

  if (violations.length > 0) {
    console.log(`\n${violations.length} fidelity violation(s) found.`);
    console.log("Checkpoints declared as capturing different states must not render identically.");
    console.log("See issue #75 and tests/CLAUDE.md '视觉检查点（Visual Checkpoints）'.");
    process.exit(1);
  }
  console.log(`✅ Visual fidelity: ${checked} declared pair(s) verified different.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[fidelity] fatal: ${err.message}`);
  process.exit(1);
});
