/**
 * Always-visible block controls: the paragraph badge and the inline
 * three-button row (#57).
 *
 * Always mode ("blockBtnGroupDisplay" = "always") gives no-mouse users a
 * persistent, tappable control at the end of every registered paragraph:
 *   - "badge" style: a tiny "⇄" span; clicking it opens the shared singleton
 *     button group (Shadow-DOM popover) anchored at the badge — the policy /
 *     state machine / dismissal rules all live in singletonBtnGroup.js.
 *   - "buttons" style: the Original | Google | AI row rendered inline,
 *     direct-select (clicks go through the same single-entry executor).
 *
 * Anchors mirror blockTranslationIndicator.js (same three-position idea):
 *   - newLine: the block element IS <translated> → insert BEFORE it, i.e.
 *     right after the source text. Stable across display modes: the Original
 *     state hides <translated> (display:none), but the badge sits outside the
 *     hidden region, so the control stays visible and the user can switch
 *     back — anchoring inside the translation would strand them
 *     (reachability, plan 57 §3.5).
 *   - replaceOriginal: the block element is the source-text container →
 *     append as its last child (same anchor as the AI span / spinner).
 *
 * This module is UI + registry only: policy decisions and the singleton host
 * stay in singletonBtnGroup.js, which receives control clicks through
 * setBlockBadgeCallbacks().
 */

import { getMessageWithFallback } from "./i18n.js";
import {
  AI_ENGINE_LABEL,
  GOOGLE_ENGINE_LABEL,
  getOriginalButtonLabel,
} from "./engineLabels.js";
import { BTN_COLORS } from "./blockBtnGroupShared.js";

const BADGE_CLASS = "dualtran-block-badge";
const BTN_ROW_CLASS = "dualtran-block-btn-row";
const BTN_CLASS = "dualtran-block-btn";
const STYLE_ID = "dualtran-block-badge-style";

/** control element (badge / row) → block element (reverse lookup) */
const controlBlockMap = new WeakMap();
/** block element → badge element */
const badgeByBlock = new WeakMap();
/** block element → inline button row element */
const rowByBlock = new WeakMap();

let _callbacks = null;

/**
 * Register click callbacks (called by singletonBtnGroup.setCallbacks).
 * @param {{ onBadgeClick?: (badgeEl: Element, blockEl: Element) => void,
 *           onInlineButtonClick?: (buttonId: string, blockEl: Element) => void }} callbacks
 */
export function setBlockBadgeCallbacks(callbacks) {
  _callbacks = callbacks || null;
}

/** Anchor rule — see the header comment (mirrors the block indicators). */
function anchorPosition(blockEl) {
  return blockEl && blockEl.tagName === "TRANSLATED" ? "before" : "append";
}

function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

/**
 * Inject the static layout style sheet once per page. Colors of the badge
 * come from the shared palette (single source, BTN_COLORS.original.inactive);
 * the active/inactive states of the inline buttons are applied as inline
 * styles by syncBlockBadgeActiveState.
 */
export function injectBlockBadgeStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const neutral = BTN_COLORS.original.inactive;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // i18n-exempt: other — CSS style-sheet fragment for the block controls (layout/colors only, no user-facing text; #171)
  style.textContent = `
    .${BADGE_CLASS} {
      display: inline-block;
      font-size: 12px;
      line-height: 16px;
      padding: 0 5px;
      margin-left: 4px;
      border: 1px solid ${neutral.borderColor};
      border-radius: 8px;
      background: ${neutral.background};
      color: ${neutral.color};
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      vertical-align: middle;
    }
    .${BADGE_CLASS}:hover { background: #e5e7eb; }
    .${BTN_ROW_CLASS} {
      display: inline-flex;
      gap: 3px;
      margin-left: 4px;
      vertical-align: middle;
      user-select: none;
      -webkit-user-select: none;
    }
    .${BTN_CLASS} {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 6px;
      border-style: solid;
      border-width: 1px;
      cursor: pointer;
      white-space: nowrap;
      line-height: 14px;
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);
}

function createBadge(blockEl) {
  const span = document.createElement("span");
  span.className = `${BADGE_CLASS} notranslate`;
  span.setAttribute("role", "button");
  const tooltip = getMessageWithFallback("blockBtnGroupBadgeTooltip", "Paragraph translation options");
  span.setAttribute("aria-label", tooltip);
  span.title = tooltip;
  // Pure-symbol glyph — the L1 write-site lexer classifies it as non-text
  // (same exemption family as the block indicator's "⚠").
  span.textContent = "⇄";
  // Shield: our chrome must never leak clicks into page handlers or default
  // actions (the badge can sit inside page links / labels).
  span.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      _callbacks?.onBadgeClick?.(span, blockEl);
    } catch (err) {
      console.warn("[DualTran] badge click failed", err);
    }
  });
  controlBlockMap.set(span, blockEl);
  badgeByBlock.set(blockEl, span);
  return span;
}

function createButtonRow(blockEl) {
  const row = document.createElement("span");
  row.className = `${BTN_ROW_CLASS} notranslate`;
  const specs = [
    { id: "original", label: getOriginalButtonLabel() },
    { id: "google", label: GOOGLE_ENGINE_LABEL },
    { id: "ai", label: AI_ENGINE_LABEL },
  ];
  specs.forEach(({ id, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.dataset.buttonId = id;
    btn.textContent = label;
    const spec = BTN_COLORS[id].inactive;
    btn.style.color = spec.color;
    btn.style.background = spec.background;
    btn.style.borderColor = spec.borderColor;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        _callbacks?.onInlineButtonClick?.(id, blockEl);
      } catch (err) {
        console.warn("[DualTran] inline button click failed", err);
      }
    });
    row.appendChild(btn);
  });
  controlBlockMap.set(row, blockEl);
  rowByBlock.set(blockEl, row);
  return row;
}

function insertControl(blockEl, pos, el) {
  if (pos === "append") {
    blockEl.appendChild(el);
    return;
  }
  const parent = blockEl.parentNode;
  if (!parent) return; // detached block — silent no-op (indicator convention)
  parent.insertBefore(el, blockEl);
}

/**
 * Create (or swap) the control for one block. Idempotent: a live control of
 * the requested style is kept; the other style is replaced.
 * @param {Element} blockEl — the registered block element
 * @param {"badge"|"buttons"} styleMode
 */
export function upsertBlockBadge(blockEl, styleMode) {
  if (!blockEl) return;
  injectBlockBadgeStyles();

  let badge = badgeByBlock.get(blockEl) || null;
  if (badge && !badge.isConnected) {
    badgeByBlock.delete(blockEl);
    badge = null;
  }
  let row = rowByBlock.get(blockEl) || null;
  if (row && !row.isConnected) {
    rowByBlock.delete(blockEl);
    row = null;
  }

  if (styleMode === "buttons") {
    if (badge) {
      removeNode(badge);
      badgeByBlock.delete(blockEl);
    }
    if (row) return;
    insertControl(blockEl, anchorPosition(blockEl), createButtonRow(blockEl));
    return;
  }

  if (row) {
    removeNode(row);
    rowByBlock.delete(blockEl);
  }
  if (badge) return;
  insertControl(blockEl, anchorPosition(blockEl), createBadge(blockEl));
}

/** Remove the control (either style) of one block. */
export function removeBlockBadge(blockEl) {
  if (!blockEl) return;
  const badge = badgeByBlock.get(blockEl);
  if (badge) {
    removeNode(badge);
    badgeByBlock.delete(blockEl);
  }
  const row = rowByBlock.get(blockEl);
  if (row) {
    removeNode(row);
    rowByBlock.delete(blockEl);
  }
}

/** Sweep every control from the document (full restore / destroy path). */
export function removeAllBlockBadges() {
  document.querySelectorAll(`.${BADGE_CLASS}, .${BTN_ROW_CLASS}`).forEach(removeNode);
}

/**
 * Reverse lookup: given a click target, find the block element its control
 * belongs to (null when the target is not one of ours).
 */
export function resolveBlockForControl(target) {
  if (!target || !target.closest) return null;
  const el = target.closest(`.${BADGE_CLASS}, .${BTN_ROW_CLASS}`);
  return el ? controlBlockMap.get(el) || null : null;
}

/**
 * Render the inline row's active state from the block's intentMode
 * (single-reader rule: the caller passes the state value; this module never
 * reads block state itself).
 */
export function syncBlockBadgeActiveState(blockEl, intentMode) {
  if (!blockEl) return;
  const row = rowByBlock.get(blockEl);
  if (!row || !row.isConnected) return;
  row.querySelectorAll(`.${BTN_CLASS}`).forEach((btn) => {
    const key = btn.dataset.buttonId;
    const spec = BTN_COLORS[key];
    if (!spec) return;
    const active = key === intentMode;
    const style = active ? spec.active : spec.inactive;
    btn.style.color = style.color;
    btn.style.background = style.background;
    btn.style.borderColor = style.borderColor;
    btn.classList.toggle("dualtran-btn-active", active);
  });
}
