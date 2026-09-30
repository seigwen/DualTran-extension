/**
 * Shared panel implementation points (plan 37 — hover/selection panel alignment).
 *
 * Single source for the skin + state implementation both panels consume: the
 * intent-button palette, the translated-text color single point, the AI
 * decoration-absorbing proxy, the loading-state renderer, and the dark/light +
 * loading CSS constants.
 *
 * translateSelected.js imports these and re-exports the original four symbols,
 * so existing test import paths and cross-surface parity locks keep working
 * unchanged (plan 37, D2).
 */

import twpConfig from "../lib/config.js"
import { ERROR_CROSS_COLOR } from "./aiUiState.js"

// ── Panel implementation points (moved verbatim from translateSelected.js) ──

// Panel-local twin of the hover-group palette (BTN_COLORS / BUTTON_STYLES,
// floatingBtn.js + singletonBtnGroup.js — plan 31 / #106). Verbatim-identical
// spec objects (locked by a cross-surface parity test); colors are applied as
// JS inline styles so the shadow <style> keeps layout only. The panel has no
// Original button — the original text is always visible, so only google/ai.
const PANEL_BTN_COLORS = {
  google: {
    active: { color: "#ffffff", background: "#1d4ed8", borderColor: "#1d4ed8" },
    inactive: { color: "#1d4ed8", background: "#eff6ff", borderColor: "#bfdbfe" },
  },
  ai: {
    active: { color: "#ffffff", background: "#7c3aed", borderColor: "#7c3aed" },
    inactive: { color: "#7c3aed", background: "#f5f3ff", borderColor: "#ddd6fe" },
  },
}

// Same "no custom color" sentinel as hasCustomTranslatedColor /
// applyAiTranslatedTextColor — the options-page Reset value stays a no-paint.
const PANEL_EMPTY_COLORS = ["", "rgba(0, 0, 0, 1)", undefined, null]

/**
 * Single implementation point for the panel's translated-text color (plan 31 /
 * #106, requirement 1). Every arrival/switch resets first, then paints per the
 * engine that produced the visible text:
 *   "google" → translatedColor · "ai" → aiTranslatedColor · "error" → the
 *   shared error color · no kind → reset only.
 * The reset-before-paint is the fix for the observed cross-engine leak (an AI
 * color lingering on a Google arrival).
 */
function applyPanelTranslatedColor(node, kind) {
  if (!node || !node.style) return
  node.style.removeProperty("color")
  if (kind === "error") {
    node.style.color = ERROR_CROSS_COLOR
    return
  }
  let color
  if (kind === "google") {
    color = twpConfig.get("translatedColor")
  } else if (kind === "ai") {
    color = twpConfig.get("aiTranslatedColor")
  } else {
    return
  }
  if (PANEL_EMPTY_COLORS.includes(color)) return
  node.style.color = color
}

/**
 * Apply the panel's two-button palette (plan 31 / #106, requirement 2).
 * `active` is the panel intent ("google" | "ai"); the other button goes
 * inactive. Same contract as applyButtonPalette (singletonBtnGroup.js).
 */
function applyPanelButtonPalette(googleBtn, aiBtn, active) {
  const buttons = { google: googleBtn, ai: aiBtn }
  Object.keys(buttons).forEach((key) => {
    const btn = buttons[key]
    if (!btn) return
    const isActive = key === active
    const spec = isActive ? PANEL_BTN_COLORS[key].active : PANEL_BTN_COLORS[key].inactive
    btn.style.color = spec.color
    btn.style.background = spec.background
    btn.style.borderColor = spec.borderColor
    btn.classList.toggle("dualtran-btn-active", isActive)
  })
}

/**
 * Panel-scoped AI proxy (plan 31 / #106, requirements 3+4). The panel's engine
 * buttons express intent only: every engine-side decoration write — label,
 * tooltip, state classes, button color, title — lands on detached dummies
 * instead of the visible buttons (same absorption contract as
 * createSingletonBlockProxy in pageTranslator.js).
 *
 * The translation face (translatedTextNode) is the REAL translated-text
 * element — passed through by identity, so every reader/writer keeps
 * byte-identical behavior (text writes, color writes, showOriginal's
 * hover registration, classList cleanup). The one piece of panel semantics
 * added on top: the translationStatus setter paints the shared error color
 * the moment the engine declares "translationError" — the engine sets the
 * status BEFORE writing the message text, so the message lands in an
 * already-painted box (the box is the single state surface).
 *
 * Two deliberate differences from the singleton proxy:
 *   - the routed marker class `dualtran-ai-selected-btn` reads as present
 *     (engine routing: selected-panel target language + error text into the
 *     translated box) while all other classes read absent;
 *   - no `_st` at all — shouldApplyAiArrival treats a block-less surface as
 *     never-suppressed, which is exactly the panel's contract.
 */
function createPanelAiProxy({ sourceString, translatedTextNode }) {
  const state = { sourceString, translationStatus: undefined, translationId: undefined }
  return {
    get sourceString() { return state.sourceString },
    set sourceString(v) { state.sourceString = v },
    get translationStatus() { return state.translationStatus },
    set translationStatus(v) {
      state.translationStatus = v
      // The status write is the engine's declaration of a state switch — the
      // single arrival-observation point for the panel, so it resets+paints the
      // box (Q1/Q2): "translationError" → shared error color; "translating" /
      // "translated" → configured AI color (empty config = reset only). The
      // engine's own color write (applyAiTranslatedTextColor) lands just before
      // or after this, but the reset discipline is owned here.
      if (v === "translationError") {
        applyPanelTranslatedColor(translatedTextNode, "error")
      } else if (v === "translating" || v === "translated") {
        applyPanelTranslatedColor(translatedTextNode, "ai")
      }
    },
    get translationId() { return state.translationId },
    set translationId(v) { state.translationId = v },
    get translatedTextNode() { return translatedTextNode },
    get btnAiTxtNode() { return document.createElement("span") },
    get tooltip() { return document.createElement("span") },
    get classList() {
      return {
        contains: (cls) => cls === "dualtran-ai-selected-btn",
        add: () => {},
        remove: () => {},
        toggle: () => {},
      }
    },
    get style() {
      let _color = ""
      return { set color(v) { _color = v }, get color() { return _color } }
    },
    get ownerDocument() { return document },
    setAttribute: () => {},
  }
}



/**
 * Shared loading-state renderer (plan 37): writes the spinner + "Loading..."
 * into the given translated-text node. Identical classes and markup to the
 * selection panel's original inline implementation — moved here so both panels
 * render the exact same loading surface.
 */
function clearPanelTranslationLoadingState(node) {
  if (!node) return;
  node.classList.remove("dualtran-loading");
  node.innerHTML = "";
}

function setPanelTranslationLoadingState(node) {
  if (!node) return;
  clearPanelTranslationLoadingState(node);
  // State-switch reset (plan 31 / #106, Q1): a new run must never inherit the
  // previous engine's inline color — the spinner shows in the default color and
  // the arrival repaints per its own engine.
  applyPanelTranslatedColor(node);
  node.classList.add("dualtran-loading");
  const spinner = document.createElement("span");
  spinner.className = "dualtran-loading-spinner";
  const label = document.createElement("span");
  label.className = "dualtran-loading-label";
  label.textContent =
    (chrome && chrome.i18n && chrome.i18n.getMessage("loading")) ||
    "Loading...";
  node.appendChild(spinner);
  node.appendChild(label);
}

/**
 * Dark/light scheme blocks, moved verbatim from translateSelected.js (plan 37,
 * D2). Both panels inject the same string into their `#backdropFilterElement`
 * style element, so the surfaces cannot drift.
 */
export const PANEL_DARK_MODE_CSS_DARK = `
                    #eDivResult {
                        backdrop-filter: none;
            background-color: rgba(40, 40, 40, 0.92);
            box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
                        color: white;
                    }
                    li, #moreOrLess {
          	background-color: rgba(255, 255, 255, 0.25);
                    }
          #drag {
            background-color: rgba(255, 255, 255, 0.18);
          }
                    .selected {
                    	background-color: rgba(255, 255, 255, 0.6);
                    }
            		hr {
					border: 1px rgba(225, 225, 225, 0.65) solid;
            		}
            		#listen {
            		    fill: white;
            		}
                `

export const PANEL_DARK_MODE_CSS_LIGHT = `
                    #eDivResult {
                        backdrop-filter: none;
            background-color: rgba(248, 248, 248, 0.98);
            box-shadow: 0 0px 25px rgba(15, 23, 42, 0.28);
                        color: black;
                    }
                    li, #moreOrLess {
          	background-color: rgba(0, 0, 0, 0.12);
                    }
          #drag {
            background-color: rgba(0, 0, 0, 0.12);
          }
                    .selected {
                    	background-color: rgba(0, 0, 0, 0.32);
                    }
            		hr {
					border: 1px rgba(0, 0, 0, 0.35) solid;
            		}
            		#listen {
            		    fill: black;
            		}
                `

/**
 * Loading + layout-fix style block, moved verbatim from translateSelected.js's
 * inline `styleFix` (plan 37, D2). Class names and rules are the locked
 * contract the loading-state renderer above relies on.
 */
export const PANEL_LOADING_CSS = `
    #eSelTextTrans,#eOrigText {
      margin-right: 22px;
    }
    #eDivResult {
      min-width: 300px;
    }
    .dualtran-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
    }
    .dualtran-loading-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-left-color: transparent;
      border-radius: 50%;
      animation: dualtran-spin 0.8s linear infinite;
    }
    .dualtran-loading-label {
      font-size: 14px;
      opacity: 0.8;
    }
    .dualtran-ai-error-cross {
      margin-left: 4px;
      color: #dc2626;
      font-weight: 600;
    }
    @keyframes dualtran-spin {
      to { transform: rotate(360deg); }
    }
    `


export {
  PANEL_BTN_COLORS,
  PANEL_EMPTY_COLORS,
  applyPanelTranslatedColor,
  applyPanelButtonPalette,
  createPanelAiProxy,
  clearPanelTranslationLoadingState,
  setPanelTranslationLoadingState,
}
