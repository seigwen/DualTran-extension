/**
 * Monthly escape review stats (plan 87, P4).
 *
 * Prints the numbers the review needs: how many defects escaped per channel, where they
 * were caught, and whether each one has a regression test yet. The prose still has to be
 * written by a human — this only removes the counting.
 *
 * Usage: node scripts/bugs/monthly-report.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "bugs", "ledger.json"), "utf8"));

const byChannel = {};
const byDetection = {};
for (const bug of ledger.bugs) {
  byChannel[bug.channel] = (byChannel[bug.channel] || 0) + 1;
  byDetection[bug.detectedBy] = (byDetection[bug.detectedBy] || 0) + 1;
}

const unguarded = ledger.bugs.filter((bug) => bug.guarded === false);
const report = {
  at: new Date().toISOString(),
  total: ledger.bugs.length,
  byChannel,
  byDetection,
  unguarded: unguarded.map((bug) => bug.id),
  guardedRatio: `${ledger.bugs.length - unguarded.length}/${ledger.bugs.length}`,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`逃逸缺陷总数：${report.total}`);
  console.log(`按渠道：${Object.entries(byChannel).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`发现方式：${Object.entries(byDetection).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`已有回归测试：${report.guardedRatio}`);
  if (unguarded.length) {
    console.log(`仍未守卫：${unguarded.map((bug) => `${bug.id}(${bug.title})`).join("; ")}`);
  }
}
