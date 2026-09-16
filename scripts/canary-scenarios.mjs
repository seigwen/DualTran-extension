/**
 * Canary scenario library (S5, issue #57) — declarative data consumed by
 * scripts/real-site-verify.mjs (the executor).
 *
 * Each scenario is DATA, not code: the executor owns the step loop, the
 * tri-state assertions (healthy ∧ count===1 after every settled step) and
 * the diagnostics. Adding a scenario = adding one entry here.
 *
 * `source` is mandatory — it records where the scenario came from (user
 * report / incident id). This is the answer to the doc-13 finding that
 * diagnostic scripts died with their debugging session: user reports must
 * land in a permanent, traceable home.
 *
 * Step types (closed set, implemented by the executor):
 *   - goto      : navigate to url (waits for URL + host healthy)
 *   - translate : click the floating Google button and wait for
 *                 translation to appear + host healthy
 *   - back      : history back (waits for URL + host healthy)
 *   - forward   : history forward (waits for URL + host healthy)
 *   - roundtrip : convenience — back/forward repeated `rounds` times
 *   - settle    : no-op wait for host healthy (explicit stabilization point)
 *
 * Scope notes:
 *   - All scenarios are Google-only. The canary has no API key; AI paths
 *     are covered by the browser E2E suite. Deliberately NOT mocking AI
 *     here: a real-site canary that secretly runs mocks would poison the
 *     signal semantics doc 13 warns about.
 *   - Assertions are tri-state (absent/shell/healthy) — see
 *     tests/shared/host-state.mjs.
 *
 * Self-test mapping (--self-test): step URLs are rewritten by pathname
 * against SELF_TEST_PATH_MAP onto the local spa mock pages
 * (extra/e2e/, served by the executor). Unmapped URLs cause the scenario
 * to be SKIPPED (never fall back to the real site — the self-test
 * contract is hermetic).
 */

export const SELF_TEST_PATH_MAP = {
  "/obra/superpowers/projects": "spa-source.html",
  "/obra/superpowers/security": "spa-target.html",
};

const P1 = "https://github.com/obra/superpowers/projects";
const P2 = "https://github.com/obra/superpowers/security";

export const SCENARIOS = [
  {
    name: "bug8-double-page-roundtrip",
    source: "user report 2026-09-14 (bug 8: /projects ↔ /security back/forward disappearance)",
    description:
      "Translate both pages, then hammer back/forward 12 rounds — every settled step must keep a healthy floating host (the original bug: Turbo snapshot shell survived all rebuild checks).",
    steps: [
      { type: "goto", url: P1 },
      { type: "translate" },
      { type: "goto", url: P2 },
      { type: "translate" },
      { type: "roundtrip", rounds: 12 },
    ],
  },
  {
    name: "bug7-single-page-backnav",
    source: "incident 7 (PR #30: Turbo replaces the <body> element on back-nav; observer died)",
    description:
      "Translate, SPA-navigate away, then back ×3 rounds — the dynamic-translation observer must survive the body replacement and the host must stay healthy.",
    steps: [
      { type: "goto", url: P1 },
      { type: "translate" },
      { type: "goto", url: P2 },
      { type: "back" },
      { type: "forward" },
      { type: "back" },
      { type: "forward" },
      { type: "back" },
    ],
  },
  {
    name: "selfheal-injections",
    source: "issue #40 / issue #43 (S1 audit real-site findings: hover self-heal + duplicate convergence)",
    description:
      "On a translated page inject a Turbo snapshot shell (cloneNode without shadow root) and poke the hover path — it must self-heal; then inject a duplicate host and poke hover — it must converge back to exactly one healthy host.",
    steps: [
      { type: "goto", url: P1 },
      { type: "translate" },
      { type: "inject-shell-hover" },
      { type: "inject-duplicate-hover" },
    ],
  },
];
