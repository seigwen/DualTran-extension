#!/usr/bin/env node
/**
 * check-content-update-channels.js
 *
 * CI lint (14th architecture check, #98 recurrence review).
 *
 * ── Why this exists ──
 *
 * Twice now (#7 @2026-08-17, #98 @2026-09-26) the SAME user-visible defect
 * family escaped the whole test system: "content the site updates or reveals
 * AFTER the initial translation is not re-translated". Both times a scenario
 * whose NAME matched the symptom ("showmore") exercised the WRONG DOM
 * mechanism (append) while the real site used another (characterData rewrite /
 * childList replace). Nothing in the repo knew which mechanism-channels exist,
 * which are simulated, which are run, or which are unit-covered — so each
 * incident was patched channel-by-channel and the next channel escaped.
 *
 * This lint makes the channel classification an enforced contract between four
 * artefacts:
 *
 *   SSOT              tests/shared/content-update-channels.mjs
 *   mock page         extra/e2e/*.html (MOCK FIDELITY declaration)
 *   E2E scenario      tests/browser-e2e/*.mjs (behavioral mode iteration)
 *   unit tests        tests/contentScript/*.test.js
 *
 * ── Rules (hard failure, line-level messages) ──
 *
 *   N1  Every ACTIVE channel must appear in the mock-page MOCK FIDELITY
 *       declaration (section「分支：内容更新通道」or the channel's simulator
 *       section) AND be marked「✅ 已模拟」. A channel that is not simulated
 *       cannot be run — the whole point of the classification.
 *   N2  Reverse direction: every item in the「分支：内容更新通道」section must
 *       reference a channel id that exists in the SSOT (no ghost channels —
 *       the declaration cannot invent coverage either).
 *   N3  Every ACTIVE channel must declare scenarioRefs (files that exist) and
 *       at least one of them must contain BEHAVIORAL mode iteration
 *       (`forEachDisplayMode(` or `DISPLAY_MODES`) — a comment mentioning the
 *       modes does not count. This is what closes the #98 replaceOriginal hole.
 *   N4  Every ACTIVE channel must declare unitRefs (>=1 existing file) or an
 *       explicit unitRefsExempt with a reason (>=3 chars).
 *   N5  Every channel must carry a non-empty `provenance` (issue number or
 *       capture date) — prevents invented mechanisms with no incident behind
 *       them.
 *   N6  Every EXEMPT channel must be「⛔ 未模拟」in the mock page WITH an
 *       exemption reason + upstream impact (R3 grammar reuse), so "not covered"
 *       is always a recorded decision, never silence.
 *
 * Usage:
 *   node scripts/check-content-update-channels.js
 *   node scripts/check-content-update-channels.js --root <fixture>   (self-test)
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const argRoot = process.argv.indexOf("--root");
const SCAN_ROOT = argRoot !== -1 ? path.resolve(process.argv[argRoot + 1]) : ROOT;

const SSOT_PATH = path.join(SCAN_ROOT, "tests", "shared", "content-update-channels.mjs");
const E2E_DIR = path.join(SCAN_ROOT, "tests", "browser-e2e");
const CONTENT_SCRIPT_DIR = path.join(SCAN_ROOT, "tests", "contentScript");
const MOCK_PAGE_DIR = path.join(SCAN_ROOT, "extra", "e2e");

const SECTION_HEADER = "分支：内容更新通道";
const MARK_SIMULATED = "✅ 已模拟";
const MARK_NOT_SIMULATED = "⛔ 未模拟";

/** Strip block + line comments (a comment must never satisfy a check). */
function decomment(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

async function main() {
  const violations = [];

  // ── Load the SSOT ──
  let channels;
  try {
    const mod = await import(pathToFileURL(SSOT_PATH).href);
    channels = mod.CONTENT_UPDATE_CHANNELS;
  } catch (err) {
    console.warn(`⚠️  Cannot load ${path.relative(ROOT, SSOT_PATH)}: ${err.message}`);
    console.log("\n1 content-update-channel violation(s) found.");
    process.exit(1);
  }

  if (!Array.isArray(channels) || channels.length === 0) {
    console.warn(`⚠️  ${path.relative(ROOT, SSOT_PATH)} must export a non-empty CONTENT_UPDATE_CHANNELS array.`);
    process.exit(1);
  }

  // ── Index mock-page declarations ──
  // channel id → { file, line, simulated }
  const declared = new Map();
  const ghosts = [];
  if (fs.existsSync(MOCK_PAGE_DIR)) {
    for (const entry of fs.readdirSync(MOCK_PAGE_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
      const full = path.join(MOCK_PAGE_DIR, entry.name);
      const content = fs.readFileSync(full, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("- ")) return;
        // Channel-declaration items carry their channel id as the first
        // backticked token; other MOCK FIDELITY sections (mechanisms/timing)
        // are free-form and skipped unless they use the channel id syntax.
        const idMatch = line.match(/^\s*-\s+`([a-z0-9-]+)`/);
        if (!idMatch) return;
        const id = idMatch[1];
        const simulated = line.includes(MARK_SIMULATED);
        const notSimulated = line.includes(MARK_NOT_SIMULATED);
        if (!simulated && !notSimulated) return; // not a marked item → other lint's business
        const inChannelSection = (() => {
          // Walk upwards to the nearest section header.
          for (let j = i; j >= 0; j--) {
            if (lines[j].includes(SECTION_HEADER)) return true;
            if (lines[j].includes("分支：")) return false;
          }
          return false;
        })();
        if (!inChannelSection) return;
        declared.set(id, { file: path.relative(ROOT, full), line: i + 1, simulated });
      });
    }
  }

  const ssotIds = new Set(channels.map((c) => c.id));

  // ── N2: ghost channels (declaration references an id the SSOT does not know) ──
  for (const [id, info] of declared.entries()) {
    if (!ssotIds.has(id)) {
      ghosts.push(`⚠️  ${info.file}:${info.line}: 「${SECTION_HEADER}」declares channel「${id}」which does not exist in the SSOT (N2).`);
    }
  }

  // ── Per-channel rules ──
  for (const channel of channels) {
    const id = channel.id;

    // N5: provenance required
    if (typeof channel.provenance !== "string" || channel.provenance.trim().length === 0) {
      violations.push(`channel「${id}」has no provenance — every channel must trace to an issue number or a capture date (N5).`);
    }

    const decl = declared.get(id);

    if (channel.status === "active") {
      // N1: must be simulated in a mock page
      if (!decl) {
        violations.push(
          `channel「${id}」is ACTIVE but does not appear in any mock-page「${SECTION_HEADER}」declaration — a channel that is not simulated cannot be run (N1).`
        );
      } else if (!decl.simulated) {
        violations.push(
          `channel「${id}」is ACTIVE but declared「${MARK_NOT_SIMULATED}」in ${decl.file}:${decl.line} — an active channel must be simulated (N1).`
        );
      }

      // N3: scenarioRefs must exist and one must carry BEHAVIORAL mode iteration
      const scenarioRefs = Array.isArray(channel.scenarioRefs) ? channel.scenarioRefs : [];
      if (scenarioRefs.length === 0) {
        violations.push(`channel「${id}」is ACTIVE but declares no scenarioRefs — the conformance suite must exercise it (N3).`);
      } else {
        let anyBehavioral = false;
        for (const ref of scenarioRefs) {
          const full = path.join(E2E_DIR, ref);
          const source = readIfExists(full);
          if (source === null) {
            violations.push(`channel「${id}」references scenario「${ref}」which does not exist in tests/browser-e2e/ (N3).`);
            continue;
          }
          const code = decomment(source);
          const behavioral =
            code.includes("forEachDisplayMode(") || code.includes("DISPLAY_MODES");
          if (behavioral) anyBehavioral = true;
        }
        if (!anyBehavioral && scenarioRefs.every((r) => readIfExists(path.join(E2E_DIR, r)) !== null)) {
          violations.push(
            `channel「${id}」scenarioRefs contain no BEHAVIORAL mode iteration (forEachDisplayMode/DISPLAY_MODES in code, comments excluded) — a comment mentioning the modes does not prove the channel ran in both display modes (N3).`
          );
        }
      }

      // N4: unitRefs or typed exemption
      const unitRefs = Array.isArray(channel.unitRefs) ? channel.unitRefs : [];
      const unitExempt = channel.unitRefsExempt;
      if (unitRefs.length === 0 && !unitExempt) {
        violations.push(`channel「${id}」is ACTIVE but declares no unitRefs and no unitRefsExempt (N4).`);
      }
      for (const ref of unitRefs) {
        if (readIfExists(path.join(CONTENT_SCRIPT_DIR, ref)) === null) {
          violations.push(`channel「${id}」references unit test「${ref}」which does not exist in tests/contentScript/ (N4).`);
        }
      }
      if (unitExempt) {
        if (typeof unitExempt.reason !== "string" || unitExempt.reason.trim().length < 3) {
          violations.push(`channel「${id}」unitRefsExempt reason is too short (>=3 chars required, N4).`);
        }
      }
    } else if (channel.status === "exempt") {
      // N6: exemption must be recorded on the mock-page side too
      const ex = channel.exemption;
      if (!ex || typeof ex.reason !== "string" || ex.reason.trim().length < 3) {
        violations.push(`channel「${id}」is EXEMPT but carries no exemption.reason (N6).`);
      }
      if (!ex || typeof ex.upstreamImpact !== "string" || ex.upstreamImpact.trim().length < 3) {
        violations.push(`channel「${id}」is EXEMPT but carries no exemption.upstreamImpact (N6).`);
      }
      if (decl && decl.simulated) {
        violations.push(
          `channel「${id}」is EXEMPT in the SSOT but declared「${MARK_SIMULATED}」in ${decl.file}:${decl.line} — the two must agree (N6).`
        );
      }
    } else {
      violations.push(`channel「${id}」has invalid status「${channel.status}」— must be "active" or "exempt".`);
    }
  }

  const all = [...violations, ...ghosts];
  if (all.length > 0) {
    for (const v of all) console.warn(v.startsWith("⚠️") ? v : `⚠️  ${v}`);
    console.log(`\n${all.length} content-update-channel violation(s) found.`);
    console.log("Every content-update channel must be simulated, run in BOTH display modes, and unit-covered");
    console.log("(or explicitly exempted with a reason + upstream impact). See tests/CLAUDE.md.");
    process.exit(1);
  }

  const activeCount = channels.filter((c) => c.status === "active").length;
  console.log(
    `✅ Content-update channels: ${channels.length} declared (${activeCount} active), all simulated + mode-symmetric + unit-covered.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[content-update-channels] fatal: ${err.message}`);
  process.exit(1);
});
