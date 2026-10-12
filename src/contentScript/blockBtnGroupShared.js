/**
 * Shared spec for the block-level paragraph button group (#57 family).
 *
 * Single source for the three-button palette (Original | Google | AI) used
 * by the surfaces that render the row for a paragraph:
 *   - the singleton hover / badge-popover group (singletonBtnGroup.js —
 *     re-exports BTN_COLORS so the existing import paths in tests keep
 *     working),
 *   - the always-visible inline three-button row (blockBtnGroupBadge.js).
 *
 * Colors are applied as JS inline styles (same #65 convention as the
 * floating group's BUTTON_STYLES); the panel twin (panelShared.js
 * PANEL_BTN_COLORS) stays locked verbatim by its cross-surface parity test.
 */

const BTN_COLORS = {
  original: {
    active: { color: "#ffffff", background: "#374151", borderColor: "#374151" },
    inactive: { color: "#6b7280", background: "#f3f4f6", borderColor: "#d1d5db" },
  },
  google: {
    active: { color: "#ffffff", background: "#1d4ed8", borderColor: "#1d4ed8" },
    inactive: { color: "#1d4ed8", background: "#eff6ff", borderColor: "#bfdbfe" },
  },
  ai: {
    active: { color: "#ffffff", background: "#7c3aed", borderColor: "#7c3aed" },
    inactive: { color: "#7c3aed", background: "#f5f3ff", borderColor: "#ddd6fe" },
  },
};

export { BTN_COLORS };
