#!/usr/bin/env node
/**
 * check-announcement-channels.js
 *
 * CI lint (15th architecture check, plan 40 / #137 — highlight-desync family).
 *
 * ── Why this exists ──
 *
 * "Page translated but the button highlight is wrong" has recurred four times
 * (#23 / #29 / #70 / #134). #134's root cause was a CHANNEL problem: an
 * internal transition suppressed its intent event but leaked on two OTHER
 * channels, and a subscriber executed user-level restore semantics on the
 * leaked announcement. Part A (#137) fixed both sides structurally (single
 * announcement outlet + mirror-only subscriber); this lint keeps the
 * properties from silently eroding:
 *
 *   A0  every channel in the SSOT carries provenance (no invented channels)
 *   A1  outlet uniqueness — raw pageLanguageState emit tokens may appear ONLY
 *       inside the declared outlet function body in src/ (raw emit sites
 *       elsewhere are a hard failure)
 *   A2  probe presence — every probeRequired channel has >=1 existing probeRef
 *       file whose decommented source contains one of the channel's
 *       probeTokens (the SSOT entry must arrive WITH its behavioral pin)
 *   A3  navigation-scenario highlight assertions — every E2E scenario that
 *       navigates (goBack(/goForward() must read the floating highlight and
 *       CALL the intent SSOT (assertUiStateMatchesEngine( — a bare import
 *       does not count), or carry an explicit `// nav-assert-allow:`
 *       exemption with a reason
 *   A4  mirror-only region — between the [mirror-only:begin]/[mirror-only:end]
 *       markers in floatingBtn.js, forbidden semantic tokens must not appear
 *       (comments excluded)
 *
 * Usage:
 *   node scripts/check-announcement-channels.js
 *   node scripts/check-announcement-channels.js --root <fixture>   (self-test)
 *
 * Exit code 1 when violations are found (hard failure in CI).
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const argRoot = process.argv.indexOf("--root");
const SCAN_ROOT = argRoot !== -1 ? path.resolve(process.argv[argRoot + 1]) : ROOT;

const SSOT_PATH = path.join(SCAN_ROOT, "tests", "shared", "announcement-channels.mjs");
const E2E_DIR = path.join(SCAN_ROOT, "tests", "browser-e2e");
const CONTENT_SCRIPT_DIR = path.join(SCAN_ROOT, "tests", "contentScript");
const SRC_DIR = path.join(SCAN_ROOT, "src");

/** Strip block + line comments WITHOUT changing line count (a comment must
 *  never satisfy a check, and reported line numbers must stay accurate). */
function decomment(source) {
  let out = "";
  let inBlock = false;
  let inLine = false;
  let inString = null;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (ch === "\n") {
        out += ch;
        inLine = false;
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      out += ch === "\n" ? "\n" : "";
      i++;
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    }
    out += ch;
    i++;
  }
  return out;
}

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function collectJsFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
}

async function main() {
  const violations = [];

  // ── Load the SSOT ──
  let mod;
  try {
    mod = await import(pathToFileURL(SSOT_PATH).href);
  } catch (err) {
    console.warn(`⚠️  Cannot load ${path.relative(ROOT, SSOT_PATH)}: ${err.message}`);
    console.log("\n1 announcement-channel violation(s) found.");
    process.exit(1);
  }
  const channels = mod.ANNOUNCEMENT_CHANNELS;
  const outlet = mod.ANNOUNCEMENT_OUTLET;
  const mirrorContract = mod.MIRROR_ONLY_CONTRACT;
  const navContract = mod.NAV_ASSERT_CONTRACT;

  if (!Array.isArray(channels) || channels.length === 0) {
    console.warn(
      `⚠️  ${path.relative(ROOT, SSOT_PATH)} must export a non-empty ANNOUNCEMENT_CHANNELS array.`
    );
    process.exit(1);
  }

  // ── A0: provenance required ──
  for (const channel of channels) {
    if (typeof channel.provenance !== "string" || channel.provenance.trim().length === 0) {
      violations.push(
        `channel「${channel.id}」has no provenance — every channel must trace to an issue number or a capture date (A0).`
      );
    }
  }

  // ── A1: outlet uniqueness — raw emit tokens only inside the outlet body ──
  {
    const outletFile = path.join(SCAN_ROOT, outlet.file);
    const source = readIfExists(outletFile);
    if (source === null) {
      violations.push(`declared outlet file「${outlet.file}」does not exist (A1).`);
    } else {
      const lines = source.split("\n");
      const declIdx = lines.findIndex((l) => l.includes(`function ${outlet.functionName}`));
      if (declIdx === -1) {
        violations.push(`outlet function「${outlet.functionName}」not found in ${outlet.file} (A1).`);
      } else {
        // The outlet body spans from its declaration to the next sibling
        // top-level statement at the same 2-space indentation.
        let endIdx = lines.length;
        for (let i = declIdx + 1; i < lines.length; i++) {
          if (/^  (function |pageTranslator\.|const |let )/.test(lines[i])) {
            endIdx = i;
            break;
          }
        }

        const body = decomment(lines.slice(declIdx, endIdx).join("\n"));
        if (!body.includes("pageLanguageStateObservers.forEach")) {
          violations.push(
            `outlet「${outlet.functionName}」does not contain the observer broadcast — the outlet must own BOTH channels (A1).`
          );
        }
        if (!body.includes('action: "setPageLanguageState"')) {
          violations.push(
            `outlet「${outlet.functionName}」does not contain the SW message — the outlet must own BOTH channels (A1).`
          );
        }

        // scan ALL src js files for forbidden raw tokens outside the outlet body
        const srcFiles = [];
        collectJsFiles(SRC_DIR, srcFiles);
        for (const file of srcFiles) {
          const raw = readIfExists(file);
          if (raw === null) continue;
          const clean = decomment(raw);
          if (!clean.includes("pageLanguage")) continue;
          const fileLines = clean.split("\n");
          for (const token of outlet.forbiddenRawTokens) {
            fileLines.forEach((line, i) => {
              if (!line.includes(token)) return;
              const inOutlet = file === outletFile && i >= declIdx && i < endIdx;
              if (!inOutlet) {
                violations.push(
                  `${path.relative(ROOT, file)}:${i + 1}: raw announcement emit token「${token}」outside the single outlet「${outlet.functionName}」 — all pageLanguageState emissions must go through the outlet (A1).`
                );
              }
            });
          }
        }
      }
    }
  }

  // ── A2: probe presence for probeRequired channels ──
  for (const channel of channels) {
    // The flag must be declared EXPLICITLY — an omitted flag would skip the
    // whole probe net silently (escape hatch by omission).
    if (channel.probeRequired !== true && channel.probeRequired !== false) {
      violations.push(
        `channel「${channel.id}」must declare probeRequired explicitly (true/false) — an omitted flag would skip the probe net silently (A2).`
      );
      continue;
    }
    if (channel.probeRequired === false) {
      // Exemptions are earned in writing, not by omission (#98 unitRefsExempt pattern).
      const reason = typeof channel.probeExempt === "string" ? channel.probeExempt.trim() : "";
      if (reason.length < 3) {
        violations.push(
          `channel「${channel.id}」sets probeRequired:false without a written probeExempt reason — exemptions must be typed with a reason (>=3 chars, A2).`
        );
      }
      continue;
    }
    const refs = Array.isArray(channel.probeRefs) ? channel.probeRefs : [];
    const tokens = Array.isArray(channel.probeTokens) ? channel.probeTokens : [];
    if (refs.length === 0) {
      violations.push(
        `channel「${channel.id}」is probeRequired but declares no probeRefs — a channel without a behavioral pin is where the next desync hides (A2).`
      );
      continue;
    }
    if (tokens.length === 0) {
      violations.push(
        `channel「${channel.id}」is probeRequired but declares no probeTokens — the lint cannot verify the pin without them (A2).`
      );
      continue;
    }
    let anyPinned = false;
    let anyNamed = false;
    for (const ref of refs) {
      const full = path.join(CONTENT_SCRIPT_DIR, ref);
      const source = readIfExists(full);
      if (source === null) {
        violations.push(
          `channel「${channel.id}」references probe「${ref}」which does not exist in tests/contentScript/ (A2).`
        );
        continue;
      }
      const clean = decomment(source);
      // The probe file must NAME the channel it pins (decommented — a mention
      // inside a comment does not prove the probe covers this channel).
      if (clean.includes(channel.id)) anyNamed = true;
      if (tokens.some((t) => clean.includes(t))) anyPinned = true;
    }
    if (!anyNamed) {
      violations.push(
        `channel「${channel.id}」id does not appear in any probeRef (comments excluded) — a probe file must name the channel it pins (A2).`
      );
    }
    if (!anyPinned) {
      violations.push(
        `channel「${channel.id}」probeRefs contain none of its probeTokens [${tokens.join(", ")}] (comments excluded) — the SSOT entry must arrive WITH its behavioral pin (A2).`
      );
    }
  }

  // ── A3: navigation scenarios must assert highlight + SSOT ──
  if (fs.existsSync(E2E_DIR)) {
    for (const entry of fs.readdirSync(E2E_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
      const full = path.join(E2E_DIR, entry.name);
      const source = readIfExists(full);
      if (source === null) continue;
      const clean = decomment(source);
      if (!/goBack\(|goForward\(/.test(clean)) continue;
      const hasHighlightRead = navContract.highlightReadTokens.some((t) => clean.includes(t));
      // Call syntax required — a bare import would otherwise satisfy the check
      // without asserting anything (false-green channel).
      const callRe = new RegExp(
        navContract.ssotToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\("
      );
      const hasSsot = callRe.test(clean);
      if (hasHighlightRead && hasSsot) continue;
      const exempt = source.split("\n").some((l) => {
        const trimmed = l.trim();
        return (
          trimmed.startsWith(navContract.exemptionMarker) &&
          trimmed.length > navContract.exemptionMarker.length + 3
        );
      });
      if (exempt) continue;
      const missing = [];
      if (!hasHighlightRead) missing.push("a floating-highlight read");
      if (!hasSsot) missing.push(`an ${navContract.ssotToken} SSOT assertion`);
      violations.push(
        `tests/browser-e2e/${entry.name} navigates (goBack/goForward) but lacks ${missing.join(" and ")} — navigation scenarios must lock the highlight-vs-intent consistency, or carry「${navContract.exemptionMarker} <reason>」(A3).`
      );
    }
  }

  // ── A4: mirror-only region contract ──
  {
    const file = path.join(SCAN_ROOT, mirrorContract.file);
    const source = readIfExists(file);
    if (source === null) {
      violations.push(`mirror-contract file「${mirrorContract.file}」does not exist (A4).`);
    } else {
      const lines = source.split("\n");
      let begin = -1;
      let end = -1;
      lines.forEach((l, i) => {
        if (l.includes(mirrorContract.beginMarker) && begin === -1) begin = i;
        if (l.includes(mirrorContract.endMarker) && begin !== -1 && end === -1) end = i;
      });
      if (begin === -1 || end === -1 || end < begin) {
        violations.push(
          `${mirrorContract.file}: missing「${mirrorContract.beginMarker}」/「${mirrorContract.endMarker}」markers — the mirror-only region must be explicitly delimited (A4).`
        );
      } else {
        const body = decomment(lines.slice(begin + 1, end).join("\n"));
        for (const token of mirrorContract.forbiddenTokens) {
          if (body.includes(token)) {
            violations.push(
              `${mirrorContract.file}:${begin + 1}-${end + 1}: semantic token「${token}」inside the mirror-only region — a mirror-only subscriber may mirror + render, never execute user-level semantics (A4).`
            );
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    for (const v of violations) console.warn(`⚠️  ${v}`);
    console.log(`\n${violations.length} announcement-channel violation(s) found.`);
    console.log(
      "Every announcement channel must be emitted through its single outlet, be probe-pinned,"
    );
    console.log(
      "and every navigation scenario must lock the highlight-vs-intent consistency. See tests/CLAUDE.md."
    );
    process.exit(1);
  }

  console.log(
    `✅ Announcement channels OK (${channels.length} channels, outlet unique, probes pinned, nav assertions complete, mirror-only region clean).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
