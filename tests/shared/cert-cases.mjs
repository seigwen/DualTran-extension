/**
 * Cert-case registry (plan 51 P2-D — one-command RED certification; docs 49
 * §3-D, 52, 55). Each case reverts ONE fix and declares which locks must go
 * RED (and with which failure signature) — the executable form of "this lock
 * can actually fail". A lock that stays green when its fix is gone is dead.
 *
 * Field contract (enforced by cert-run.mjs + tests/shared/certCases.test.js):
 *   id          — lowercase-dash, unique
 *   description — what reverted fix the case simulates
 *   provenance  — REQUIRED: plan/issue/commit reference
 *   revert      — [{ file, from, to }]; `from` must match EXACTLY ONCE in the
 *                 current tree (the registry test re-checks — if the fixed
 *                 line moves or is edited, update the case in the same change)
 *   steps       — [{ name, cmd, expect, needsXvfb?, needsBuild? }]; `expect` is a PLAIN
 *                 substring that the failing output must contain
 *   build       — optional; false skips `npm run build` in the worktree
 *   baseRef     — optional; default HEAD
 *
 * Audit cadence (docs 55): quarterly / before releases run `npm run cert -- --all`.
 */

export const CERT_CASES = [
  {
    id: "m13-disarm-152",
    description:
      "#152 disarm-line revert: the E1 announcement gate, the arming-flag restore, the intent-gate lint (I3 count) and the journey-explorer S1 anchor must all go RED",
    provenance: "#152 (975d326) / plan 44; cert case built in plan 51 P2-D",
    revert: [
      {
        file: "src/contentScript/pageTranslator.js",
        from: "    shouldForceAiAfterPageTranslation = shouldForceAiForThisRun && aiModeActive\n",
        to: "    shouldForceAiAfterPageTranslation = shouldForceAiForThisRun\n",
      },
    ],
    steps: [
      {
        name: "intent-gate-lint",
        cmd: "node scripts/check-intent-gates.js",
        expect: 'segment "run-arm-restore": "aiModeActive" declared 1, actual 0',
      },
      {
        name: "unit-152-disarm-cell",
        cmd: "node_modules/.bin/vitest run tests/contentScript/hoverBtnBehavior.integration.test.js",
        expect: "E1 (D6/#152)",
      },
      {
        name: "e2e-ai-nav-restore",
        cmd: "node tests/browser-e2e/run-all.mjs --scenario=ai-nav-restore",
        expect: "#152: the page shows AI translation",
        needsXvfb: true,
      },
      {
        name: "e2e-journey-explorer",
        cmd: "node tests/browser-e2e/run-all.mjs --scenario=journey-explorer",
        expect: "persistent violation(s) — S1-cross-page-switch-back",
        needsXvfb: true,
      },
      {
        name: "e2e-floating-btn-three-state",
        cmd: "node tests/browser-e2e/run-all.mjs --scenario=floating-btn-three-state",
        expect: "#152: the armed restore shows AI translation",
        needsXvfb: true,
      },
    ],
  },
  {
    id: "m131-console-bypass",
    description:
      "#131 console-reference revert: the computed `console[level]` shape survives the production terser pass — the PRODUCTION BUILD itself (post-build guard) must go RED",
    provenance: "#131 (plan 39) / plan 51 P3 round 2",
    revert: [
      {
        file: "src/contentScript/pageTranslator.js",
        from: `function emitDualTranDebugLog(level, marker, payload) {
  if (level === "error") {
    console.error(marker, payload);
    return;
  }
  console.log(marker, payload);
}`,
        to: `function emitDualTranDebugLog(level, marker, payload) {
  // #131 revert: computed member access survives drop_console (pre-plan-39 shape).
  (console[level] || console.log)(marker, payload);
}`,
      },
    ],
    steps: [
      {
        // 锁 = 生产构建自身：webpack 产物后置守卫在 dist 中发现 console 引用即
        // 令 `npm run build` 失败（#131 的 RED 就是这个形状）。案例级 build:false
        // ——不要预构建（预构建会因为这道锁失败而先把案例打成 ERROR）。
        name: "build-rejects-console-refs",
        cmd: "npm run build",
        expect: "console[<computed>]",
      },
    ],
    build: false,
  },
  {
    id: "m151-cld-gate",
    description:
      "#151 word-path CLD gate revert: an unreliable / unknown language reading is trusted again — the W1 cell must go RED",
    provenance: "#151 (plan 44) / plan 51 P3 round 2",
    revert: [
      {
        file: "src/contentScript/fetchSSE.js",
        from: `  const sourceLanguageTrusted = sourceLangIsReliable === true && detectedSourceLang !== 'und';`,
        to: `  const sourceLanguageTrusted = true; // #151 revert: unreliable/unknown CLD readings trusted again`,
      },
    ],
    steps: [
      {
        name: "unit-w1-cld-gate",
        cmd: "node_modules/.bin/vitest run tests/ai/fetchSSE.integration.test.js",
        expect: "unreliable CLD reading must not pin the bogus language",
      },
    ],
  },
  {
    id: "m10-arrival-70",
    description:
      "#70 arrival-gate revert: back to the horizontal read — the stale-flag cells of the Arrival gate suite must go RED",
    provenance: "#70 (plan 30; fix #71) / plan 51 P3 round 2",
    revert: [
      {
        file: "src/contentScript/pageTranslator.js",
        from: `function isAiArrivalAllowedForBlock(capturedEpoch) {
  if (aiModeActive) return true
  return capturedEpoch === aiModeEpoch
}`,
        to: `function isAiArrivalAllowedForBlock(capturedEpoch) {
  // #70 revert: horizontal read — a stale page-level flag vetoes the arrival.
  return aiModeActive
}`,
      },
    ],
    steps: [
      {
        name: "unit-arrival-gate",
        cmd: "node_modules/.bin/vitest run tests/contentScript/hoverBtnBehavior.integration.test.js",
        expect: "stale page-level flag (set before the request) must not veto the arrival",
      },
    ],
  },
  {
    id: "m12-silent-leak-134",
    description:
      "#134 silent-channel revert: the silent gate no longer covers the broadcast channels — the T10 silent-path-leak cell must go RED",
    provenance: "#134 (plan 40) / plan 51 P3 round 2",
    revert: [
      {
        file: "src/contentScript/pageTranslator.js",
        from: `function announcePageLanguageState(nextState, { silent = false }`,
        to: `function announcePageLanguageState(nextState, { silent = false } = {}) {
    // #134 revert: internal (silent) restores reach the broadcast channels
    // unconditionally again (pre-outlet shape).
    chrome.runtime.sendMessage({
      action: "setPageLanguageState",
      pageLanguageState: nextState,
    });
    pageLanguageStateObservers.forEach((callback) => callback(nextState));
    if (silent) return;
  }`,
      },
    ],
    steps: [
      {
        name: "unit-t10-silent-leak",
        cmd: "node_modules/.bin/vitest run tests/contentScript/pageTranslator.navRestore.integration.test.js",
        expect: "静默路径零泄漏",
      },
    ],
  },
];
