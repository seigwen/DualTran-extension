/*
  i18n channels meta-lint (spec 47 §2.4, the 17th architecture lint, issue #157).

  The enforcement-arm check for the i18n channel SSOT
  (`tests/shared/i18n-channels.mjs`): every registered channel must be real and
  actually wired, so a guard cannot silently disappear from the gate or from
  its own tests while the docs keep claiming it exists.

  Rules:
    C0  SSOT shape — non-empty array; unique ids; every entry carries
        id / name / kind / guard.script / testAnchor{file,marker} / wiring[]
    C1  guard existence — every channel's guard script file exists
    C2  test anchor — every channel's test anchor file exists AND contains its
        marker (the pin that proves the guard has a behavioral test)
    C3  wiring — every declared wiring entry {file, needle}: the file exists and
        actually contains the needle (e.g. pre-push really runs the guard, CI
        really runs the E2E suite, package.json really defines i18n:check)

  Deliberately existence + wiring only — no semantic theater (spec §2.4).

  Usage:
    node scripts/check-i18n-channels.js
    node scripts/check-i18n-channels.js --root <fixture>   (self-test)

  Exit code 1 when violations are found (hard failure in CI).
*/

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const argRoot = process.argv.indexOf("--root");
const SCAN_ROOT = argRoot !== -1 ? path.resolve(process.argv[argRoot + 1]) : ROOT;

const SSOT_REL = path.join("tests", "shared", "i18n-channels.mjs");
const SSOT_PATH = path.join(SCAN_ROOT, SSOT_REL);

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (_) {
    return null;
  }
}

async function main() {
  const violations = [];

  // ── C0: load + shape ──
  let mod;
  try {
    mod = await import(pathToFileURL(SSOT_PATH).href);
  } catch (err) {
    console.error(`⚠️  Cannot load ${SSOT_REL}: ${err.message}`);
    console.log("\n1 i18n-channel violation(s) found.");
    process.exit(1);
  }
  const channels = mod.I18N_CHANNELS;
  if (!Array.isArray(channels) || channels.length === 0) {
    console.error(`⚠️  ${SSOT_REL} must export a non-empty I18N_CHANNELS array.`);
    console.log("\n1 i18n-channel violation(s) found.");
    process.exit(1);
  }

  const seenIds = new Set();
  for (const channel of channels) {
    const cid = channel && channel.id ? channel.id : "(missing id)";
    if (!channel || !channel.id || !channel.name || !channel.kind) {
      violations.push(`[C0] channel ${cid}: id / name / kind are required`);
      continue;
    }
    if (seenIds.has(channel.id)) {
      violations.push(`[C0] duplicate channel id: ${channel.id}`);
    }
    seenIds.add(channel.id);
    if (!channel.guard || !channel.guard.script) {
      violations.push(`[C0] channel ${cid}: guard.script is required`);
    }
    if (!channel.testAnchor || !channel.testAnchor.file || !channel.testAnchor.marker) {
      violations.push(`[C0] channel ${cid}: testAnchor{file,marker} is required`);
    }
    if (!Array.isArray(channel.wiring) || channel.wiring.length === 0) {
      violations.push(`[C0] channel ${cid}: at least one wiring entry is required`);
    }
  }

  // ── C1: guard existence ──
  for (const channel of channels) {
    if (!channel || !channel.guard || !channel.guard.script) continue;
    if (!fs.existsSync(path.join(SCAN_ROOT, channel.guard.script))) {
      violations.push(`[C1] channel ${channel.id}: guard script missing — ${channel.guard.script}`);
    }
  }

  // ── C2: test anchor exists + contains the marker ──
  for (const channel of channels) {
    if (!channel || !channel.testAnchor) continue;
    const anchorPath = path.join(SCAN_ROOT, channel.testAnchor.file);
    const text = readText(anchorPath);
    if (text === null) {
      violations.push(`[C2] channel ${channel.id}: test anchor missing — ${channel.testAnchor.file}`);
      continue;
    }
    if (!text.includes(channel.testAnchor.marker)) {
      violations.push(
        `[C2] channel ${channel.id}: test anchor ${channel.testAnchor.file} does not contain marker "${channel.testAnchor.marker}"`
      );
    }
  }

  // ── C3: wiring — the file exists and actually contains the needle ──
  for (const channel of channels) {
    if (!channel || !Array.isArray(channel.wiring)) continue;
    for (const entry of channel.wiring) {
      if (!entry || !entry.file || !entry.needle) {
        violations.push(`[C3] channel ${channel.id}: wiring entries need {file, needle}`);
        continue;
      }
      const text = readText(path.join(SCAN_ROOT, entry.file));
      if (text === null) {
        violations.push(`[C3] channel ${channel.id}: wiring file missing — ${entry.file}`);
        continue;
      }
      if (!text.includes(entry.needle)) {
        violations.push(
          `[C3] channel ${channel.id}: ${entry.file} does not mention "${entry.needle}" — the guard is not actually wired`
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error(`i18n-channel violations found (${violations.length}):`);
    for (const v of violations) console.error("  " + v);
    console.error("");
    console.error(
      "Fix the SSOT (tests/shared/i18n-channels.mjs), restore the guard/wiring, or update the anchor marker."
    );
    process.exit(1);
  }

  console.log(`✅ i18n channels meta-check OK (${channels.length} channel(s), all guards anchored and wired).`);
  process.exit(0);
}

main();
