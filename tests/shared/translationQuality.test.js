/**
 * Translation-quality gate unit tests (plan 34).
 *
 * The gate replaced the canary's "element exists" check after two
 * false-green holes were proved (2026-09-29/30):
 *   ① a 429 window PASSED bug7 while all 150 nodes were empty;
 *   ② unseeded profiles translated en→en (149 non-empty / 0 CJK).
 * Cells ⑤/⑥/⑧ feed the exact measured false-green metric shapes and
 * MUST be red under the old semantics (RED-archived before the real
 * implementation landed).
 *
 * Cells ①–④ pin the browser-context collector: selector union dedupe,
 * trim semantics, CJK detection, empty page.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUALITY,
  collectTranslationQualityInPage,
  evaluateQualityGate,
} from "./translation-quality.mjs";

/** Build a <translated> node (optionally also matching the result-container selector). */
function makeTranslated(text, { resultContainer = false } = {}) {
  const el = document.createElement("translated");
  if (resultContainer) el.classList.add("dualtran-result-container");
  if (text !== undefined) el.textContent = text;
  document.body.appendChild(el);
  return el;
}

describe("collectTranslationQualityInPage (browser-context collector)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("① union dedupe: an element matching BOTH selectors is counted exactly once", () => {
    makeTranslated("你好 world", { resultContainer: true });
    const m = collectTranslationQualityInPage();
    expect(m.count).toBe(1);
    expect(m.nonEmpty).toBe(1);
    expect(m.cjk).toBe(1);
  });

  it("② whitespace-only text is not counted as non-empty", () => {
    makeTranslated("   \n\t  ");
    makeTranslated("Hello");
    const m = collectTranslationQualityInPage();
    expect(m.count).toBe(2);
    expect(m.nonEmpty).toBe(1);
  });

  it("③ CJK detection: mixed Chinese-English text counts as CJK", () => {
    makeTranslated("你好，world");
    makeTranslated("plain english only");
    const m = collectTranslationQualityInPage();
    expect(m.nonEmpty).toBe(2);
    expect(m.cjk).toBe(1);
  });

  it("④ empty page → {0, 0, 0}", () => {
    const m = collectTranslationQualityInPage();
    expect(m).toEqual({ count: 0, nonEmpty: 0, cjk: 0 });
  });
});

describe("evaluateQualityGate (pure threshold logic)", () => {
  it("⑤ empty-translation full page (429 window shape: 150 nodes / 0 non-empty) → RED", () => {
    // Measured false green ①: bug7 PASSED with every node empty.
    const m = evaluateQualityGate({ count: 150, nonEmpty: 0, cjk: 0 });
    expect(m.ok).toBe(false);
  });

  it("⑥ en→en identity (unseeded profile shape: 149 non-empty / 0 CJK) → RED", () => {
    // Measured false green ②: translations were the English source text.
    const m = evaluateQualityGate({ count: 150, nonEmpty: 149, cjk: 0 });
    expect(m.ok).toBe(false);
    expect(m.cjkRatio).toBe(0);
  });

  it("⑦ healthy page (workers.dev shape: 142 non-empty / 99% CJK) → GREEN", () => {
    const m = evaluateQualityGate({ count: 142, nonEmpty: 142, cjk: 140 });
    expect(m.ok).toBe(true);
    expect(m.minNonEmpty).toBe(29); // max(10, ceil(0.2 × 142)) = 29
  });

  it("⑧ non-empty floor is a real floor (9 non-empty on a 200-node page) → RED", () => {
    const m = evaluateQualityGate({ count: 200, nonEmpty: 9, cjk: 9 });
    expect(m.ok).toBe(false);
    expect(m.minNonEmpty).toBe(40); // max(10, ceil(0.2 × 200)) = 40
  });

  it("⑨ boundary equality passes (exactly the floor and exactly 30% CJK) → GREEN", () => {
    // count 50 → minNonEmpty = max(10, 10) = 10; exactly 10 non-empty and
    // exactly 3 CJK (0.3) must both pass (>=, not >).
    const m = evaluateQualityGate({ count: 50, nonEmpty: 10, cjk: 3 });
    expect(m.ok).toBe(true);
    expect(m.cjkRatio).toBeCloseTo(0.3, 10);
  });

  it("⑩ scenario-level threshold override applies partially without clobbering the rest", () => {
    // Override only the CJK ratio — the floor/ratio defaults must survive.
    const m = evaluateQualityGate(
      { count: 100, nonEmpty: 30, cjk: 12 },
      { minCjkRatio: 0.5 }
    );
    expect(m.ok).toBe(false); // 0.4 < 0.5
    expect(m.minNonEmpty).toBe(20); // default floor logic still applied
    // Sanity: the same metrics clear the default CJK side.
    expect(evaluateQualityGate({ count: 100, nonEmpty: 30, cjk: 12 }).ok).toBe(true);
  });

  it("⑩b DEFAULT_QUALITY carries the plan-34 calibrated thresholds", () => {
    expect(DEFAULT_QUALITY).toEqual({
      minNonEmptyFloor: 10,
      minNonEmptyRatio: 0.2,
      minCjkRatio: 0.3,
    });
  });
});

describe("collectTranslationQualityInPage — visible scope (plan 36)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /** Visible element: getClientRects() reports a box (jsdom has no layout). */
  function makeVisibleTranslated(text) {
    const el = makeTranslated(text);
    el.getClientRects = () => [{ width: 100, height: 20 }];
    return el;
  }

  /** Hidden element: getClientRects() reports no box (display:none-class shape). */
  function makeHiddenTranslated(text) {
    const el = makeTranslated(text);
    el.getClientRects = () => [];
    return el;
  }

  it("⑪ visibleOnly: hidden elements are excluded from count AND nonEmpty", () => {
    makeVisibleTranslated("你好");
    makeHiddenTranslated("隐藏的译文");
    const m = collectTranslationQualityInPage({ visibleOnly: true });
    expect(m.count).toBe(1);
    expect(m.nonEmpty).toBe(1);
    expect(m.cjk).toBe(1);
  });

  it("⑫ default (no opts): hidden elements are still counted — existing consumers unchanged", () => {
    makeVisibleTranslated("你好");
    makeHiddenTranslated("隐藏的译文");
    const m = collectTranslationQualityInPage();
    expect(m.count).toBe(2);
    expect(m.nonEmpty).toBe(2);
    expect(m.cjk).toBe(2);
  });

  it("⑬ hidden stale CJK text must not mask a reverted visible route (the roundtrip false-green shape)", () => {
    // Roundtrip shape: the visible route reverted to English (no CJK) while a
    // hidden stale route still carries CJK. Full-count read → 50% CJK (the
    // default gate would PASS); visible-scoped read → 0/1 → the gate can
    // still catch the reverted state.
    makeVisibleTranslated("back to English");
    makeHiddenTranslated("旧的隐藏译文");
    const full = collectTranslationQualityInPage();
    const vis = collectTranslationQualityInPage({ visibleOnly: true });
    expect(full).toEqual({ count: 2, nonEmpty: 2, cjk: 1 });
    expect(vis).toEqual({ count: 1, nonEmpty: 1, cjk: 0 });
  });
});
