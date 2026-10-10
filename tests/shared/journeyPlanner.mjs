/**
 * journeyPlanner.mjs — pure journey planning for the seeded journey explorer
 * (plan 51 P2-C; DualTran-manage docs 52 §5 / 53 / 54).
 *
 * Pure module: no browser, no setup imports — directly unit-testable in
 * vitest (tests/shared/journeyPlanner.test.js). The scenario side
 * (tests/browser-e2e/journey-explorer.mjs) consumes these plans and executes
 * them against the mock SPA pair.
 *
 * ── Calibration discipline (do not skip) ──
 *
 * The DIRECTED_SEEDS library encodes shapes distilled from the 12-incident
 * "highlight / display mismatch" family. S1 is THE #152 calibration anchor:
 * its shape is the exact sequence that reproduced the pre-fix split on the
 * pre-#152 build (persistent: highlight=google / page=AI, doc 52 §3). Any
 * change to the explorer's behavior (settle logic / actions / assertions)
 * must be re-calibrated against BOTH builds before merging: pre-fix → red on
 * S1, master → all green.
 */

/** Action alphabet understood by tests/browser-e2e/journey-explorer.mjs. */
export const JOURNEY_ACTIONS = Object.freeze([
  "click:ai",
  "click:google",
  "click:original",
  "advance",
  "back",
  "forward",
  "reload",
]);

/**
 * Weighted random-pick weights (doc 52 §5-2): high-value intent actions up,
 * navigation-light actions down. Integer weights keep pickWeighted() exact.
 */
export const ACTION_WEIGHTS = Object.freeze({
  "click:ai": 5,
  "click:google": 5,
  advance: 4,
  back: 4,
  forward: 2,
  "click:original": 2,
  reload: 1,
});

/**
 * Directed seed library (doc 52 §5-1). Every plan is a sequence over
 * JOURNEY_ACTIONS.
 *   S1 — the #152 calibration anchor (pre-fix RED / master GREEN).
 *   S2 — same-page intent cycle (plan 30 same-page cells).
 *   S3 — refresh restore (M5 / plan 30 sessionStorage marker-restore path).
 *   S4 — cross-page back + forward legs (#134 forward territory).
 *   S5 — google -> ai then cross-page (armed run carried across navigation).
 *   S6 — triple navigation with a switch in the middle (M12/M13 sibling shapes).
 */
export const DIRECTED_SEEDS = Object.freeze([
  { id: "S1-cross-page-switch-back", plan: ["click:ai", "advance", "click:google", "back"] },
  { id: "S2-same-page-intent-cycle", plan: ["click:google", "click:ai", "click:original", "click:ai"] },
  { id: "S3-refresh-restore", plan: ["click:ai", "reload"] },
  { id: "S4-cross-page-forward", plan: ["click:ai", "advance", "back", "forward"] },
  { id: "S5-google-ai-advance", plan: ["click:google", "click:ai", "advance"] },
  { id: "S6-triple-nav-switch", plan: ["click:ai", "advance", "back", "click:google", "forward", "back"] },
]);

/** Default subset that runs in the regular suite: the four fastest high-value shapes. */
export const DEFAULT_SEED_IDS = Object.freeze([
  "S1-cross-page-switch-back",
  "S2-same-page-intent-cycle",
  "S3-refresh-restore",
  "S4-cross-page-forward",
]);

/** Mulberry32 seeded RNG — deterministic across runs and platforms. */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted pick over JOURNEY_ACTIONS using ACTION_WEIGHTS. */
export function pickWeighted(rng) {
  const total = JOURNEY_ACTIONS.reduce((s, a) => s + ACTION_WEIGHTS[a], 0);
  let r = rng() * total;
  for (const a of JOURNEY_ACTIONS) {
    r -= ACTION_WEIGHTS[a];
    if (r < 0) return a;
  }
  return JOURNEY_ACTIONS[JOURNEY_ACTIONS.length - 1];
}

/** Plan a length-`depth` random journey for `seed` (weighted alphabet). */
export function planRandomJourney(seed, depth) {
  const rng = mulberry32((seed * 2654435761) % 4294967296);
  const plan = [];
  for (let i = 0; i < depth; i++) plan.push(pickWeighted(rng));
  return plan;
}

/** Validate that a plan is a non-empty sequence of known actions. */
export function isValidPlan(plan) {
  return Array.isArray(plan) && plan.length > 0 && plan.every((a) => JOURNEY_ACTIONS.includes(a));
}
