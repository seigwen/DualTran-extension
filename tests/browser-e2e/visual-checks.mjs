/**
 * Visual checkpoint declarations (V1, issue #67).
 *
 * Each checkpoint is one screenshot capture point in the visual-audit
 * scenario, paired with a human-readable expectation list (`expect[]`).
 * The AI visual review (Hermes native vision, VQ3 ①a) consumes these:
 * for every captured screenshot it walks the checkpoint's `expect[]`
 * items and records pass/fail per item plus an open "additional
 * findings" column (VQ3 ②c).
 *
 * Rules (enforced by scripts/check-visual-checks.js):
 *   - `id` matches [a-z0-9-]+ and is unique (stable id = issue dedup key)
 *   - `expect[]` carries at least one entry
 *   - every checkpoint here has exactly one screenshotCheckpoint() call
 *     site in visual-audit.mjs, and vice versa (bidirectional)
 *
 * `programmatic` (issue #75 — V2): mechanically checkable expectations are
 * ALSO asserted in the capture scenario, so the E2E run itself hard-fails
 * instead of relying on the AI review (which cannot fail a build). Each name
 * must have a matching call site in the file that captures the checkpoint.
 * The fidelity-critical checkpoints (the direct victims of #75) MUST declare
 * at least one entry — enforced by rule 6b of the lint.
 *
 * `mustDifferFrom` (issue #75 — V2): checkpoints this one claims to capture a
 * GENUINELY DIFFERENT state from. Enforced by scripts/check-visual-fidelity.mjs
 * (pixel-diff ratio below 0.1% ⇒ hard failure). Only declare pairs that are
 * semantically required to differ — `after-ai-translation` and
 * `floating-three-state` legitimately converge to the same rendering and are
 * deliberately NOT paired here.
 *
 * `capture` documents the intent of the shot (page + moment) for review
 * context — it is not machine-enforced.
 */

export const CHECKPOINTS = [
  {
    id: "baseline-untranslated",
    scenario: "visual-audit",
    capture: {
      page: "mock test-page.html",
      when: "loaded, before any translation",
    },
    programmatic: ["assertBaselinePristine"],
    mustDifferFrom: [
      "after-google-translation",
      "after-ai-translation",
      "replace-original-mode",
      "hover-group-visible",
      "hover-group-original-mode",
      "floating-three-state",
    ],
    expect: [
      "Page text is the ORIGINAL language (English) — no translated blocks, no stray colored text",
      // ⚠️ 2026-09-20 校准：浮动按钮组在 baseline 是**预期可见**的（showFloatingBtn="yes"，
      // 默认 Original 高亮）——原判据「no extension UI visible yet」与事实不符，会造成
      // 每日 AI 审查假阳性（已由 V2 效度验证发现）。真值：浮动组在、O 高亮、无译文；
      // 悬停组**不应**出现（未悬停）。
      "Floating button group is visible at the right edge with Original highlighted (default state)",
      "No hover button group — nothing is hovered yet",
    ],
  },
  {
    id: "after-google-translation",
    scenario: "visual-audit",
    capture: {
      page: "mock test-page.html",
      when: "after Google translation completes",
    },
    programmatic: ["assertGoogleNotAi"],
    mustDifferFrom: ["after-ai-translation"],
    expect: [
      "Translated text is rendered on the page (French), original text still readable",
      "Translation blocks do NOT overlap each other or the original paragraphs",
      "No layout breakage: no horizontal scrollbar, no clipped/truncated text blocks",
      "Floating button group is present at the right edge and does not cover page content",
      "Floating group shows exactly one highlighted button (Google)",
    ],
  },
  {
    id: "after-ai-translation",
    scenario: "visual-audit",
    capture: {
      page: "mock test-page.html",
      when: "after AI translation completes (mock provider)",
    },
    expect: [
      "AI translation text is visible with the configured AI color treatment",
      "No duplicate/stacked translation blocks at any paragraph",
      "Text remains legible — no contrast failure (dark-on-dark / light-on-light)",
      "Floating group shows exactly one highlighted button (AI)",
    ],
  },
  {
    id: "hover-group-visible",
    scenario: "visual-audit",
    capture: {
      page: "mock test-page.html",
      when: "hovering a translated block after translation",
    },
    expect: [
      "Three-button group (Original / Google / AI) is visible next to the hovered block",
      "Buttons carry full-word labels, legible at default zoom",
      "Buttons do not overlap the hovered text or each other",
      "Exactly one button appears in its active (filled) state",
    ],
  },
  {
    id: "hover-group-original-mode",
    scenario: "visual-audit",
    capture: {
      page: "mock test-page.html",
      when: "after clicking Original on the hover group, group still hovered",
    },
    expect: [
      "Original button is the active one (grey filled state)",
      "Google/AI buttons show their inactive outline styles",
      "Page text is back to the original language",
    ],
  },
  {
    id: "floating-three-state",
    scenario: "visual-audit",
    capture: {
      page: "mock test-page.html",
      when: "floating button cycle: original → google → ai",
    },
    expect: [
      "Floating group stays anchored to the right edge through the cycle",
      "Exactly one button highlighted per state, no two buttons highlighted simultaneously",
      "No visual flicker artifacts visible in the final state (e.g. stale translated text)",
    ],
  },
  {
    id: "replace-original-mode",
    scenario: "visual-audit",
    capture: {
      page: "mock test-page.html",
      when: "replaceOriginal display mode after translation",
    },
    programmatic: ["assertReplaceOriginalDiffersFromBaseline"],
    expect: [
      "Translated text replaces the original inline — no duplicated paragraphs",
      "No leftover empty wrappers or residual original text fragments visible",
      "No layout shift artifacts (collapsed containers, double spacing)",
    ],
  },
  {
    id: "popup-default",
    scenario: "visual-audit",
    capture: {
      page: "popup.html",
      when: "opened fresh with default settings",
    },
    expect: [
      "Popup renders fully — no clipped sections, no overflowing text",
      "All controls (selects, checkboxes, labels) aligned on a consistent grid",
      "Interactive controls show standard affordances (no invisible/blank rows)",
    ],
  },
  {
    id: "options-languages",
    scenario: "visual-audit",
    capture: {
      page: "options.html#languages",
      when: "loaded",
    },
    expect: [
      "Sidebar navigation visible with all section entries",
      "Language selects and favorite-language rows aligned; no placeholder text leaking",
      "No overlapping elements between sidebar and content area",
    ],
  },
  {
    id: "options-ai",
    scenario: "visual-audit",
    capture: {
      page: "options.html#ai",
      when: "loaded",
    },
    expect: [
      "AI provider section renders with provider select and key field visible",
      "No unstyled native controls breaking the dark/light theme",
      "Long labels wrap instead of overflowing their containers",
    ],
  },
  // ── cross-level journey (#70/#73 escape-analysis regression anchor) ──
  // These four checkpoints back the L2 assertions in cross-level-journey.mjs:
  // the scenario asserts visible truth programmatically; these declarations
  // give the AI visual review the same moments to cross-check for artifacts
  // the programmatic read could miss (overlap, clipping, stale text ghosts).
  {
    id: "cross-level-newline-after-hover-ai",
    scenario: "cross-level-journey",
    capture: {
      page: "mock test-page.html",
      when: "newLine: after hovering block 0 and clicking AI in the block group (page was previously Google-translated)",
    },
    expect: [
      "Block 0 shows the AI translation text — NOT the Google translation (#70 assertion: the block-level AI click must win over the page-level Google state)",
      "The AI text uses the configured AI color treatment, not the Google one",
      "No duplicated/stacked translation at block 0; other blocks still show Google text",
    ],
  },
  {
    id: "cross-level-replace-original-after-hover-ai",
    scenario: "cross-level-journey",
    capture: {
      page: "mock test-page.html",
      when: "replaceOriginal: after hovering block 0 and clicking AI in the block group",
    },
    expect: [
      "Block 0's visible text is the AI translation (not the original source text, not the Google translation)",
      "No leftover empty wrappers or residual original fragments inside block 0",
      "No layout collapse at block 0 (double spacing / collapsed container)",
    ],
  },
  {
    id: "cross-level-newline-final",
    scenario: "cross-level-journey",
    capture: {
      page: "mock test-page.html",
      when: "newLine: after the O→A round trip and a page-level AI switch (all blocks should show AI)",
    },
    expect: [
      "Every translated block shows AI text — none shows the original language (#73 assertion: the O restore must be undone by the next AI display)",
      "No block appears empty or partially hidden",
      "Exactly one floating button (AI) highlighted; hover group not stuck on screen",
    ],
  },
  {
    id: "cross-level-replace-original-final",
    scenario: "cross-level-journey",
    capture: {
      page: "mock test-page.html",
      when: "replaceOriginal: after the O→A round trip and a page-level AI switch",
    },
    expect: [
      "Block 0 and its neighbours show AI translation text after the round trip (#73)",
      "No block left showing raw untranslated source text",
      "No overlapping text or clipped containers introduced by the round trip",
    ],
  },
];
