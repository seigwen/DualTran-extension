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
 *   steps       — [{ name, cmd, expect, needsXvfb? }]; `expect` is a PLAIN
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
];
