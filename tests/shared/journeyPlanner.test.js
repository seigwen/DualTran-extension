/**
 * Tests for tests/shared/journeyPlanner.mjs — the pure planner behind the
 * seeded journey explorer (plan 51 P2-C).
 *
 * Locks: the calibration anchor (S1 = the #152 pre-fix sequence) is frozen
 * here — changing it without a fresh double-build calibration turns this
 * suite RED; the weighted pick is exact-integer; random plans are
 * deterministic per seed.
 */
import { describe, expect, it } from "vitest";
import {
  JOURNEY_ACTIONS,
  ACTION_WEIGHTS,
  DIRECTED_SEEDS,
  DEFAULT_SEED_IDS,
  mulberry32,
  pickWeighted,
  planRandomJourney,
  isValidPlan,
  STATE_ACTION_WEIGHTS,
  deriveExplorerMode,
  pickStateAwareAction,
} from "../shared/journeyPlanner.mjs";

describe("journeyPlanner — directed seed library", () => {
  it("freezes the #152 calibration anchor (S1)", () => {
    const s1 = DIRECTED_SEEDS.find((s) => s.id === "S1-cross-page-switch-back");
    expect(s1).toBeDefined();
    expect(s1.plan).toEqual(["click:ai", "advance", "click:google", "back"]);
  });

  it("every directed plan is valid and ids are unique", () => {
    const ids = new Set();
    for (const s of DIRECTED_SEEDS) {
      expect(isValidPlan(s.plan), s.id).toBe(true);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });

  it("default suite ids all exist in the library", () => {
    for (const id of DEFAULT_SEED_IDS) {
      expect(DIRECTED_SEEDS.some((s) => s.id === id), id).toBe(true);
    }
  });
});

describe("journeyPlanner — weighted alphabet", () => {
  it("weights cover exactly the action alphabet", () => {
    expect(Object.keys(ACTION_WEIGHTS).sort()).toEqual([...JOURNEY_ACTIONS].sort());
  });

  it("pickWeighted respects the weights exactly (one full cycle)", () => {
    const total = JOURNEY_ACTIONS.reduce((s, a) => s + ACTION_WEIGHTS[a], 0);
    const counts = Object.fromEntries(JOURNEY_ACTIONS.map((a) => [a, 0]));
    // r hits each unit interval of [0, total) once — exact expected counts.
    for (let i = 0; i < total; i++) {
      const rng = () => i / total;
      counts[pickWeighted(rng)] += 1;
    }
    for (const a of JOURNEY_ACTIONS) {
      expect(counts[a], a).toBe(ACTION_WEIGHTS[a]);
    }
  });

  it("rng()=0 picks the first action; rng()->1 picks the last", () => {
    expect(pickWeighted(() => 0)).toBe(JOURNEY_ACTIONS[0]);
    expect(pickWeighted(() => 0.999999)).toBe(JOURNEY_ACTIONS[JOURNEY_ACTIONS.length - 1]);
  });
});

describe("journeyPlanner — seeded randomness", () => {
  it("mulberry32 is deterministic per seed", () => {
    const a1 = mulberry32(42);
    const a2 = mulberry32(42);
    const b = mulberry32(43);
    const seqA = [a1(), a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2(), a2()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqA2);
    expect(seqA).not.toEqual(seqB);
  });

  it("planRandomJourney is deterministic, correct-length and valid", () => {
    const p1 = planRandomJourney(11, 8);
    const p2 = planRandomJourney(11, 8);
    expect(p1).toEqual(p2);
    expect(p1).toHaveLength(8);
    expect(isValidPlan(p1)).toBe(true);
    expect(isValidPlan([])).toBe(false);
    expect(isValidPlan(["teleport"])).toBe(false);
  });
});

describe("state-aware walk (plan 51 P3 v0.2)", () => {
  it("deriveExplorerMode applies the frozen plan-30 mapping", () => {
    expect(deriveExplorerMode(null)).toBe("original");
    expect(deriveExplorerMode({ pageLanguageState: "original", aiRenderState: "idle", aiModeActive: false })).toBe("original");
    expect(deriveExplorerMode({ pageLanguageState: "translated", aiRenderState: "idle", aiModeActive: false })).toBe("google");
    expect(deriveExplorerMode({ pageLanguageState: "translated", aiRenderState: "active", aiModeActive: false })).toBe("ai");
    expect(deriveExplorerMode({ pageLanguageState: "translated", aiRenderState: "idle", aiModeActive: true })).toBe("ai");
  });

  it("pickStateAwareAction draws only from the current mode's table", () => {
    for (const mode of ["original", "google", "ai"]) {
      const rng = mulberry32(7);
      const allowed = Object.keys(STATE_ACTION_WEIGHTS[mode]);
      for (let i = 0; i < 50; i++) {
        expect(allowed).toContain(pickStateAwareAction(rng, mode));
      }
    }
  });

  it("the AI-mode table never re-picks click:ai, and original prefers translation", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 200; i++) expect(pickStateAwareAction(rng, "ai")).not.toBe("click:ai");
    expect(Object.keys(STATE_ACTION_WEIGHTS.original)).toContain("click:ai");
    expect(Object.keys(STATE_ACTION_WEIGHTS.ai)).toContain("click:google");
  });

  it("is deterministic: equal seeds produce equal walks", () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    const a = [];
    const b = [];
    for (let i = 0; i < 20; i++) {
      const mode = i % 2 ? "google" : "ai";
      a.push(pickStateAwareAction(r1, mode));
      b.push(pickStateAwareAction(r2, mode));
    }
    expect(a).toEqual(b);
    expect(a).toHaveLength(20);
  });
});
