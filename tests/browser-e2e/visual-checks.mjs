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
 *   - every checkpoint here has exactly one screenshotCheckpoint()
 *     call site in visual-audit.mjs, and vice versa (bidirectional)
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
    expect: [
      "Page renders as a normal article — no extension UI visible yet",
      "No floating button host, no hover button group on the page",
      "No translated blocks, no stray colored text",
    ],
  },
  {
    id: "after-google-translation",
    scenario: "visual-audit",
    capture: {
      page: "mock test-page.html",
      when: "after Google translation completes",
    },
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
];
