#!/usr/bin/env node
/**
 * cert-run.mjs — one-command RED certification / lock-liveness audit
 * (plan 51 P2-D; docs 49 §3-D / 52 / 55).
 *
 * For a cert case (tests/shared/cert-cases.mjs): create a disposable worktree
 * of the current HEAD, revert the fix, build, run the target locks, and
 * REQUIRE each of them to fail with its declared signature. A lock that
 * cannot fail when its fix is gone is a dead lock (always-green), not a
 * guard — cert turns that into a machine verdict.
 *
 * Usage:
 *   npm run cert -- --list                         list registered cases
 *   npm run cert -- --case m13-disarm-152         certify one case
 *   npm run cert -- --all                         certify every case
 *   npm run cert -- --case <id> --only <s1,s2>    run a subset of steps (debug)
 *   npm run cert -- --case <id> --keep            keep the worktree for inspection
 *   npm run cert -- --case <id> --with-clean      also prove the clean leg is green
 *
 * Evidence (default /tmp/dt-cert-out/<case>-<timestamp>/; override CERT_OUT_DIR):
 *   revert.patch  build.log  step-<name>.log  result.json
 *
 * Exit 0 = every requested case PASSED (locks went RED with their signature);
 * 1 = at least one case failed (dead lock / wrong red / setup error);
 * 2 = usage error.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CERT_CASES } from "../tests/shared/cert-cases.mjs";

const DEFAULT_OUT = process.env.CERT_OUT_DIR || "/tmp/dt-cert-out";

function parseArgs(argv) {
  const opts = { cases: [], all: false, list: false, keep: false, withClean: false, only: null, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") opts.list = true;
    else if (a === "--all") opts.all = true;
    else if (a === "--keep") opts.keep = true;
    else if (a === "--with-clean") opts.withClean = true;
    else if (a === "--case") opts.cases.push(argv[++i]);
    else if (a.startsWith("--case=")) opts.cases.push(a.slice("--case=".length));
    else if (a === "--only") opts.only = new Set((argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean));
    else if (a.startsWith("--only=")) opts.only = new Set(a.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--out") opts.out = argv[++i];
    else if (a.startsWith("--out=")) opts.out = a.slice("--out=".length);
  }
  return opts;
}

/** Run a shell command; returns { code, out, seconds }; out is logged when logFile is given. */
function sh(cmd, cwd, { logFile } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, { shell: true, cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, out);
  }
  return { code: r.status == null ? 1 : r.status, out, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status == null ? 1 : r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = (git(["rev-parse", "--show-toplevel"], process.cwd()).out || "").trim();
  if (!repoRoot) {
    console.error("cert: not inside a git repository");
    process.exit(2);
  }

  if (opts.list) {
    for (const c of CERT_CASES) {
      console.log(`\n${c.id}`);
      console.log(`  ${c.description}`);
      console.log(`  provenance: ${c.provenance}`);
      console.log(`  steps: ${c.steps.map((s) => s.name).join(", ")}`);
    }
    process.exit(0);
  }

  const wanted = opts.all ? CERT_CASES : CERT_CASES.filter((c) => opts.cases.includes(c.id));
  if (wanted.length === 0) {
    console.error("cert: no cases selected — use --case <id> or --all (see --list)");
    process.exit(2);
  }

  const commonDir = (git(["rev-parse", "--git-common-dir"], repoRoot).out || "").trim();
  const mainRoot = path.dirname(path.resolve(repoRoot, commonDir));
  const nodeModulesSource = path.join(mainRoot, "node_modules");

  let failedCases = 0;
  const summaries = [];

  for (const certCase of wanted) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = path.join(opts.out, `${certCase.id}-${stamp}`);
    fs.mkdirSync(outDir, { recursive: true });
    const wt = path.join(os.tmpdir(), `dt-cert-${certCase.id}`);
    const result = {
      case: certCase.id,
      startedAt: new Date().toISOString(),
      base: null,
      worktree: wt,
      outDir,
      steps: [],
      verdict: "PENDING",
      failures: [],
    };

    const fail = (msg) => {
      result.failures.push(msg);
      console.error(`  ✗ ${msg}`);
    };
    const finish = () => {
      if (!opts.keep) {
        try {
          fs.rmSync(path.join(wt, "node_modules"), { force: true });
        } catch {}
        git(["worktree", "remove", "--force", wt], repoRoot);
        git(["worktree", "prune"], repoRoot);
      } else if (fs.existsSync(wt)) {
        console.log(`  (worktree kept: ${wt})`);
      }
      fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
      if (result.verdict !== "PASS") failedCases++;
      summaries.push({ id: certCase.id, verdict: result.verdict, failures: result.failures.length, outDir });
    };

    // ── prepare a clean disposable worktree ──
    if (fs.existsSync(wt)) {
      try {
        fs.rmSync(path.join(wt, "node_modules"), { force: true });
      } catch {}
      git(["worktree", "remove", "--force", wt], repoRoot);
      if (fs.existsSync(wt)) fs.rmSync(wt, { recursive: true, force: true });
    }
    const baseRef = certCase.baseRef || "HEAD";
    let r = git(["worktree", "add", wt, baseRef, "--detach"], repoRoot);
    if (r.code !== 0) {
      fail(`worktree add failed: ${r.out.trim()}`);
      result.verdict = "ERROR";
      finish();
      continue;
    }
    result.base = (git(["rev-parse", "HEAD"], wt).out || "").trim();
    console.log(`\n═══ cert: ${certCase.id} @ ${String(result.base).slice(0, 8)} (evidence: ${outDir}) ═══`);

    // ── apply the declared reverts (precise, unique-anchor) ──
    for (const rev of certCase.revert || []) {
      const file = path.join(wt, rev.file);
      const src = fs.readFileSync(file, "utf8");
      const count = src.split(rev.from).length - 1;
      if (count !== 1) {
        fail(`revert anchor not unique in ${rev.file} (count=${count}) — update the cert case`);
        continue;
      }
      fs.writeFileSync(file, src.replace(rev.from, rev.to));
      console.log(`  reverted: ${rev.file}`);
    }
    if (result.failures.length) {
      result.verdict = "ERROR";
      finish();
      continue;
    }

    const patch = git(["diff"], wt).out;
    if (!patch.trim()) {
      fail("revert produced an empty diff — nothing was changed");
      result.verdict = "ERROR";
      finish();
      continue;
    }
    fs.writeFileSync(path.join(outDir, "revert.patch"), patch);

    // E2E steps run against dist/ (needsXvfb implies a built tree); lint/
    // vitest steps read src/ and tools only — skip the build when none is
    // selected (fast --only iterations).
    const stepsToRun = certCase.steps.filter((s) => !opts.only || opts.only.has(s.name));
    const needBuild = stepsToRun.some((s) => s.needsXvfb === true);

    // ── shared deps + build ──
    try {
      fs.symlinkSync(nodeModulesSource, path.join(wt, "node_modules"), "dir");
    } catch (e) {
      fail(`node_modules symlink failed: ${e.message}`);
    }
    let built = false;
    if (certCase.build !== false && needBuild) {
      console.log("  building (npm run build)…");
      const b = sh("npm run build", wt, { logFile: path.join(outDir, "build.log") });
      built = b.code === 0;
      console.log(`  build: ${built ? "ok" : "FAILED"} (${b.seconds}s)`);
      if (!built) fail("build failed in the reverted worktree — see build.log");
    }
    if (result.failures.length) {
      result.verdict = "ERROR";
      finish();
      continue;
    }

    // ── red leg: each step must fail, and the failure must carry the declared signature ──
    for (const step of stepsToRun) {
      const cmd = (step.needsXvfb ? "xvfb-run -a " : "") + step.cmd;
      const logFile = path.join(outDir, `step-${step.name}.log`);
      console.log(`  ▶ red step "${step.name}": ${cmd}`);
      const res = sh(cmd, wt, { logFile });
      const red = res.code !== 0;
      const signatureFound = res.out.includes(step.expect);
      const rec = {
        name: step.name,
        cmd,
        exitCode: res.code,
        red,
        signatureFound,
        seconds: res.seconds,
        log: logFile,
      };
      if (!red) {
        rec.verdict = "DEAD-LOCK";
        fail(`step "${step.name}": expected RED, got GREEN — the lock is dead (or the revert is ineffective)`);
      } else if (!signatureFound) {
        rec.verdict = "WRONG-RED";
        const tail = res.out.trim().split("\n").slice(-4).join("\n      ");
        fail(`step "${step.name}": red for the wrong reason — signature not found.\n      expected substring: ${JSON.stringify(step.expect)}\n      tail: ${tail}`);
      } else {
        rec.verdict = "RED-OK";
        console.log(`  ✓ step "${step.name}": RED with the declared signature (${res.seconds}s)`);
      }
      result.steps.push(rec);
    }

    // ── optional clean leg: prove the locks are not always-red ──
    if (opts.withClean && result.failures.length === 0) {
      const files = (certCase.revert || []).map((x) => x.file);
      git(["checkout", "--", ...files], wt);
      if (built) {
        const b2 = sh("npm run build", wt, { logFile: path.join(outDir, "build-clean.log") });
        if (b2.code !== 0) fail("clean-leg build failed — see build-clean.log");
      }
      for (const step of stepsToRun) {
        const cmd = (step.needsXvfb ? "xvfb-run -a " : "") + step.cmd;
        const logFile = path.join(outDir, `clean-step-${step.name}.log`);
        console.log(`  ▶ clean step "${step.name}": ${cmd}`);
        const res = sh(cmd, wt, { logFile });
        result.steps.push({
          name: `clean:${step.name}`,
          cmd,
          exitCode: res.code,
          green: res.code === 0,
          seconds: res.seconds,
          log: logFile,
        });
        if (res.code !== 0) fail(`clean step "${step.name}": expected GREEN on the un-reverted tree, got exit ${res.code} — not-always-red broken`);
        else console.log(`  ✓ clean step "${step.name}": GREEN (${res.seconds}s)`);
      }
    }

    result.verdict = result.failures.length === 0 ? "PASS" : "FAIL";
    finish();
  }

  console.log("\n──── cert summary ────");
  for (const s of summaries) {
    console.log(`  ${s.verdict === "PASS" ? "✅" : "❌"} ${s.id}: ${s.verdict} (${s.failures} failure(s)) — ${s.outDir}`);
  }
  process.exit(failedCases > 0 ? 1 : 0);
}

main();
