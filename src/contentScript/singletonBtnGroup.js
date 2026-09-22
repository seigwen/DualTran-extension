/**
 * Singleton floating button group module.
 *
 * Replaces per-block `.dualtran-inline-btn-group` with a single Shadow-DOM-
 * isolated button group attached to document.body.  The group follows the
 * currently hovered `<translated>` element so it is never clipped by ancestor
 * `overflow: hidden`.
 *
 * ─── Architecture ───────────────────────────────────────────────
 *
 *   pageTranslator.js          singletonBtnGroup.js
 *   ─────────────────          ────────────────────
 *   registerBlock()      ──→   WeakMap state
 *   getProxiesForTranslation()   BtnAiProxy adapter
 *   getAllProxies()              singleton DOM (Shadow DOM)
 *   setCallbacks()               positioning + hover state machine
 *                               event delegation
 *
 * Click handler logic stays in pageTranslator.js (needs aiCache,
 * nodesToRestore, resetAiButtonToIdle etc.).  Callbacks are registered
 * via setCallbacks().
 */

import { registerHost } from "./hostLifecycle.js";
import {
  getFloatingButtonOriginalTooltipText,
  getFloatingButtonGoogleTooltipText,
  getFloatingButtonAiTooltipText,
} from "./i18n.js";

// ── Shared dummy objects (absorb writes when proxy is not current target) ──

const DUMMY_NODE = (() => {
  if (typeof document === "undefined") return null;
  const node = document.createElement("span");
  return node;
})();

const DUMMY_CLASSLIST = {
  contains: () => false,
  add: () => {},
  remove: () => {},
};

const DUMMY_STYLE = (() => {
  let _color = "";
  return {
    set color(v) { _color = v; },
    get color() { return _color; },
  };
})();

// ── State store ──────────────────────────────────────────────────

/** @type {WeakMap<HTMLElement, TranslatedBlockState>} */
const blockStateMap = new WeakMap();

/**
 * @typedef {Object} TranslatedBlockState
 * @property {string} sourceString
 * @property {Node} translatedTextNode
 * @property {string} googleTranslatedText
 * @property {Element[]|null} nodesToClear
 * @property {string} translationId
 * @property {"idle"|"queuing"|"translating"|"translated"|"translationError"|"userPinned"} aiStatus
 * @property {"idle"|"translating"|"success"} googleBtnState
 * @property {"original"|"google"|"ai"} displayMode
 * @property {number} requestEpoch — monotonic write-back guard (#65): restored
 *   blocks bump it, so late in-flight responses (Google/AI) are discarded.
 * @property {string} [errorMessage]
 */

/**
 * Register a translated block in the WeakMap.
 * Called by pageTranslator.js instead of createInlineButtonGroup().
 */
/**
 * Create a block state with canonical defaults for the 4 state machine fields.
 * registerBlock() merges this with data fields and DOM references.
 * @returns {{ aiStatus: string, googleBtnState: string, displayMode: string, translationId: string, requestEpoch: number }}
 */
export function createBlockState() {
  return {
    aiStatus: "idle",
    googleBtnState: "idle",
    displayMode: "original",
    translationId: "",
    requestEpoch: 0,
  };
}

export function registerBlock(translatedElement, sourceString, translatedTextNode, googleTranslatedText, nodesToClear, { googleSpan = null, aiSpan = null } = {}) {
  // Mark element so getProxiesForTranslation can find non-<translated> elements in replaceOriginal mode
  translatedElement.dataset.dualtranBlock = "1";
  blockStateMap.set(translatedElement, {
    ...createBlockState(),
    sourceString,
    translatedTextNode,  // Legacy: kept for backward compat (points to googleTextNode in new mode)
    googleTranslatedText,
    nodesToClear,
    // Dual-span mode: separate spans for Google and AI translations
    googleSpan,   // <span class="dualtran-google"> — Google writes here
    aiSpan,       // <span class="dualtran-ai"> — AI writes here
    // Override: registerBlock is called after Google translation completes
    displayMode: "google",
  });
}

// ── BtnAiProxy adapter ──────────────────────────────────────────

export class BtnAiProxy {
  /**
   * @param {HTMLElement} translatedElement — the <translated> DOM node
   * @param {WeakMap<HTMLElement, TranslatedBlockState>} stateMap
   * @param {Object} singleton — the singleton button group controller
   */
  constructor(translatedElement, stateMap, singleton) {
    this._el = translatedElement;
    this._map = stateMap;
    this._s = singleton;
  }

  // ── WeakMap-backed properties ──
  get sourceString()  { return this._st().sourceString; }
  get translatedTextNode() { return this._st().translatedTextNode; }
  get googleSpan()    { return this._st().googleSpan; }
  get aiSpan()        { return this._st().aiSpan; }
  get nodesToClear()  { return this._st().nodesToClear; }
  get googleTranslatedText() { return this._st().googleTranslatedText; }
  get translationId() { return this._st().translationId; }
  set translationId(v) { this._st().translationId = v; }
  get translationStatus() { return this._st().aiStatus; }
  set translationStatus(v) { this._st().aiStatus = v; }
  get googleBtnState() { return this._st().googleBtnState; }
  set googleBtnState(v) { this._st().googleBtnState = v; }
  get displayMode() { return this._st().displayMode; }
  set displayMode(v) { this._st().displayMode = v; }

  // ── Singleton-backed DOM nodes (only live when currentTarget matches) ──
  get btnAiTxtNode()  { return this._isTarget() ? this._s.aiTextNode : DUMMY_NODE; }
  get tooltip()       { return this._isTarget() ? this._s.tooltipNode  : DUMMY_NODE; }
  get classList()     { return this._isTarget() ? this._s.aiBtn.classList : DUMMY_CLASSLIST; }
  get style()         { return this._isTarget() ? this._s.aiBtn.style       : DUMMY_STYLE; }
  get ownerDocument() { return document; }

  setAttribute(name, value) {
    if (this._isTarget()) this._s.aiBtn.setAttribute(name, value);
  }

  // ── Internals ──
  _st() { return this._map.get(this._el) || {}; }
  _isTarget() { return this._s.currentTarget === this._el; }
}

// ── Proxy helpers for aiTranslateDynamically / updateAiRenderStateInternal ──

/**
 * Return BtnAiProxy[] for blocks that need AI translation.
 * (aiStatus not in ["queuing","translating","translated"])
 */
export function getProxiesForTranslation(_map = null, _s = null) {
  const stateMap = _map || blockStateMap;
  const singleton = _s || _singleton;
  if (window.self !== window.top && !_map) return [];
  const result = [];
  // Query both <translated> elements (newLine mode) and elements with data-dualtran-block attribute (replaceOriginal mode)
  for (const el of document.querySelectorAll("translated, [data-dualtran-block]")) {
    if (!stateMap.has(el)) continue;
    result.push(new BtnAiProxy(el, stateMap, singleton));
  }
  // Filter out blocks in queuing/translating/translated/translationError state.
  // translationError must also be filtered, otherwise aiTranslateDynamically() would
  // keep retrying errored blocks after cooldown, causing infinite retry loops on persistent errors (e.g., 503).
  // Users can manually click the AI button to retry (status is reset to idle on click).
  return result.filter(p => !["queuing", "translating", "translated", "translationError", "userPinned"].includes(p.translationStatus));
}

/**
 * Return BtnAiProxy[] for ALL registered blocks.
 * Used by updateAiRenderStateInternal — needs even blocks that are queuing/translating/translated.
 */
export function getAllProxies(_map = null, _s = null) {
  const stateMap = _map || blockStateMap;
  const singleton = _s || _singleton;
  if (window.self !== window.top && !_map) return [];
  const result = [];
  for (const el of document.querySelectorAll("translated, [data-dualtran-block]")) {
    if (!stateMap.has(el)) continue;
    result.push(new BtnAiProxy(el, stateMap, singleton));
  }
  return result;
}

/**
 * Read state from WeakMap for a translated element.
 */
export function getBlockState(translatedElement) {
  return blockStateMap.get(translatedElement) || null;
}

// ── Singleton DOM ───────────────────────────────────────────────

let _singleton = {
  currentTarget: null,
  host: null,
  btnGroup: null,
  originalBtn: null,
  aiBtn: null,
  googleBtn: null,
  aiTextNode: null,
  tooltipNode: null,
  _callbacks: null,
  _visible: false,
  _pendingHideTimer: null,
};

// ── Three-button palette (#65, NQ2) ──────────────────────────────
// Exact same spec as the floating group (floatingBtn.js 834-871):
// colors are applied as JS inline styles, the shadow <style> keeps
// layout only. Active state source = the block's displayMode.

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

/**
 * Export the palette spec so tests can lock the exact values (rule
 * symmetry: BTN_COLORS is an implementation point of the #65 rule).
 */
export { BTN_COLORS };

/**
 * Apply the three-button palette. `displayMode` is the active key
 * ("original" | "google" | "ai"); any other value leaves all inactive.
 */
function applyButtonPalette(displayMode) {
  const buttons = {
    original: _singleton.originalBtn,
    google: _singleton.googleBtn,
    ai: _singleton.aiBtn,
  };
  Object.keys(buttons).forEach((key) => {
    const btn = buttons[key];
    if (!btn) return;
    const active = key === displayMode;
    const style = active ? BTN_COLORS[key].active : BTN_COLORS[key].inactive;
    btn.style.color = style.color;
    btn.style.background = style.background;
    btn.style.borderColor = style.borderColor;
    btn.classList.toggle("dualtran-btn-active", active);
  });
}

// Register with the shared host lifecycle manager (C1/M5). The manager
// owns the health predicate (count === 1 && connected && shadowRoot),
// the enabled flag, the pre-rebuild copy cleanup, and create() error
// containment (a throwing create() no longer propagates into the hover
// path). recovery: "lazy" — the manager installs no subscriptions; the
// singleton rebuilds only through its interaction entry points
// (createSingletonButtonGroup / showButtonGroup self-heal), preserving
// the tested "no interaction → no rebuild" contract (no ghost rebuilds).
const singletonHandle = registerHost({
  hostId: "dualtran-singleton-btn-host",
  create: createSingletonHost,
  recovery: "lazy",
});

/**
 * Create the singleton button group host (Shadow DOM) on document.body.
 *
 * Thin wrapper over the lifecycle manager (C1, M5): enable() flips the
 * enabled flag to true and ensures the host exists — create when
 * missing/degraded, no-op when healthy (the old idempotent semantics,
 * kept). The health predicate, the pre-rebuild copy cleanup and the
 * create() error containment live in hostLifecycle.js now.
 */
export function createSingletonButtonGroup() {
  if (window.self !== window.top) return;
  singletonHandle.enable();
}

/**
 * The registered create() callback (C1, M5): build a fresh singleton
 * host, install its listeners, and publish the new nodes on _singleton.
 * Called by the lifecycle manager through enable()/ensure() — never
 * directly by consumers (the public entry stays createSingletonButtonGroup).
 */
function createSingletonHost() {
  if (window.self !== window.top) return;

  // The handle is stale (detached / shadow-less / duplicate cleanup):
  // reset the component references before the rebuild. The manager has
  // already removed every stale DOM copy (bug 2026-09-14 shell cleanup).
  if (_singleton.host) {
    if (_singleton._pendingHideTimer) {
      clearTimeout(_singleton._pendingHideTimer);
      _singleton._pendingHideTimer = null;
    }
    _singleton.host = null;
    _singleton.currentTarget = null;
    _singleton._visible = false;
  }

  const host = document.createElement("div");
  host.id = "dualtran-singleton-btn-host";
  host.style.cssText = "all:initial;position:fixed;top:-9999px;left:-9999px;z-index:2147483646;";
  host.classList.add("notranslate");

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .dualtran-btn-group {
        display: inline-flex;
        flex-direction: row;
        gap: 4px;
        white-space: nowrap;
      }
      .dualtran-original-btn, .dualtran-google-btn, .dualtran-ai-btn {
        font-size: 12px;
        font-weight: 700;
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
        position: relative;
        box-sizing: border-box;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dualtran-ai-tooltip {
        display: none;
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: #f8fafc;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 4px;
        white-space: nowrap;
        z-index: 10;
        pointer-events: none;
      }
      .dualtran-ai-btn:hover .dualtran-ai-tooltip { display: block; }
      .dualtran-ai-error-cross { color: #dc2626; margin-left: 4px; font-weight: 600; }
    </style>
    <div class="dualtran-btn-group">
      <button class="dualtran-original-btn">Original</button>
      <button class="dualtran-google-btn">Google</button>
      <button class="dualtran-ai-btn">
        <span>AI</span>
        <span class="dualtran-ai-tooltip"></span>
      </button>
    </div>
  `;

  document.body.appendChild(host);

  const btnGroup = shadow.querySelector(".dualtran-btn-group");
  const originalBtn = shadow.querySelector(".dualtran-original-btn");
  const googleBtn = shadow.querySelector(".dualtran-google-btn");
  const aiBtn = shadow.querySelector(".dualtran-ai-btn");
  const aiTextNode = aiBtn.querySelector("span");
  const tooltipNode = aiBtn.querySelector(".dualtran-ai-tooltip");

  // i18n tooltips (reuse the floating group's keys, NQ2)
  originalBtn.title = getFloatingButtonOriginalTooltipText();
  googleBtn.title = getFloatingButtonGoogleTooltipText();
  aiBtn.title = getFloatingButtonAiTooltipText();

  _singleton = {
    ..._singleton,
    host,
    btnGroup,
    originalBtn,
    googleBtn,
    aiBtn,
    aiTextNode,
    tooltipNode,
  };

  // Three buttons share the single onBtnClick(buttonId, target) callback
  // (#65, NQ4.2 — replaces the old per-button onGoogleClick/onAiClick).
  originalBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_singleton.currentTarget && _singleton._callbacks?.onBtnClick) {
      _singleton._callbacks.onBtnClick("original", _singleton.currentTarget);
    }
  });

  googleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_singleton.currentTarget && _singleton._callbacks?.onBtnClick) {
      _singleton._callbacks.onBtnClick("google", _singleton.currentTarget);
    }
  });

  aiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_singleton.currentTarget && _singleton._callbacks?.onBtnClick) {
      _singleton._callbacks.onBtnClick("ai", _singleton.currentTarget);
    }
  });
}

/**
 * Register click callbacks from pageTranslator.js.
 */
export function setCallbacks(callbacks) {
  _singleton._callbacks = callbacks;
}

/**
 * Remove the singleton host and all event listeners.
 *
 * Disable via the manager (C1, M5): the enabled flag flips to false
 * ("should not exist" — restorePage semantics) and every host copy is
 * removed (stale shells included). Hover listener detach stays here —
 * it is component UX policy, not host lifecycle; the manager never
 * touches it. The _singleton reference reset is component state.
 */
export function destroySingletonButtonGroup() {
  singletonHandle.disable();
  _detachHoverListeners();
  _singleton = { ..._singleton, host: null, btnGroup: null, originalBtn: null, currentTarget: null, _visible: false, _pendingHideTimer: null };
}

// ── Positioning ─────────────────────────────────────────────────

/**
 * Position the button group relative to a translated element.
 * Defaults below-left. Flips above if viewport overflow.
 */
export function positionButtonGroup(translatedElement) {
  if (!_singleton.host) return;
  const rect = translatedElement.getBoundingClientRect();
  const host = _singleton.host;

  // Force layout recalculation
  host.style.display = "block";
  const hostRect = host.getBoundingClientRect();

  let top = rect.bottom + 4;
  // Flip above if would overflow bottom
  if (top + hostRect.height > window.innerHeight && rect.top > hostRect.height + 4) {
    top = rect.top - hostRect.height - 4;
  }

  host.style.left = Math.max(0, rect.left) + "px";
  host.style.top = Math.max(0, top) + "px";

  // Fixed-position fallback: detect ancestor transform
  if (hasAncestorTransform()) {
    host.style.position = "absolute";
    host.style.left = (rect.left + window.scrollX) + "px";
    host.style.top = (top + window.scrollY) + "px";
  } else {
    host.style.position = "fixed";
  }
}

/**
 * Check if body or html has CSS transforms that break position:fixed.
 */
export function hasAncestorTransform() {
  try {
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    const check = (s) => s.transform !== "none" || s.filter !== "none" || s.perspective !== "none";
    return check(bodyStyle) || check(htmlStyle);
  } catch (_) {
    return false;
  }
}

// ── Visibility ──────────────────────────────────────────────────

/**
 * Show and position the button group for a translated element.
 *
 * Self-heal (issue #40): hover/touch is the singleton's only recovery
 * entry point in degraded host states. After a Turbo body replacement /
 * snapshot render the handle is stale (detached or shadow-less) — a bare
 * truthiness check would silently operate on an invisible node and the
 * hover path would stay dead until a page re-translation. Rebuild in
 * place instead, mirroring floatingBtn's hasFunctionalHost() checks.
 *
 * C1/M5: routed through the manager's enable() — flag=true + idempotent
 * ensure (healthy host untouched, missing/degraded → clear stale copies
 * + create). enable() rather than bare ensure() is load-bearing: the
 * tested contract is "hover creates the host on demand, even after
 * destroy()" (no enabled-gate on the interaction entry — the entry IS
 * the enable moment). ensure() keeps the gate for manager-internal
 * (eager) triggers only.
 *
 * #65 fail-safe guard: the WeakMap identity check runs FIRST, before
 * enable(). registerBlock() is the only writer of the block state, and
 * cloneNode(true) copies DOM attributes but NOT WeakMap entries — a
 * Turbo snapshot clone (or a threshold-short never-registered block)
 * matches the hover selector yet has no state. Showing the group for it
 * produced click handlers that early-returned = dead buttons. The guard
 * must be WeakMap IDENTITY, never attribute presence (a clone carries
 * data-dualtran-block="1"); attribute checks would pass for clones and
 * miss the bug entirely.
 *
 * On mismatch the group hides immediately (and the pending hide timer is
 * cleared): if block A's group is visible and the pointer slides onto an
 * unregistered block B, mouseout-A bails early (enterTarget already hits
 * a translated element) and without this hide the stale group would stay
 * parked over A — a "ghost group" whose clicks operate on B's data while
 * pointing at A.
 */
export function showButtonGroup(translatedElement) {
  if (!blockStateMap.get(translatedElement)) {
    hideButtonGroup();
    if (_singleton._pendingHideTimer) {
      clearTimeout(_singleton._pendingHideTimer);
      _singleton._pendingHideTimer = null;
    }
    return;
  }
  singletonHandle.enable();
  if (!_singleton.host) return;
  if (_singleton._pendingHideTimer) {
    clearTimeout(_singleton._pendingHideTimer);
    _singleton._pendingHideTimer = null;
  }
  _singleton.currentTarget = translatedElement;
  updateSingletonUI(translatedElement);
  positionButtonGroup(translatedElement);
  _singleton._visible = true;
}

/**
 * Hide the button group.
 */
export function hideButtonGroup() {
  if (!_singleton.host) return;
  _singleton.currentTarget = null;
  _singleton._visible = false;
  _singleton.host.style.top = "-9999px";
  _singleton.host.style.left = "-9999px";
}

/**
 * Update the singleton's button UI to reflect the state of the given block.
 *
 * #65: three buttons (Original / Google / AI). Button colors come from the
 * BTN_COLORS palette (inline styles, active state = block displayMode);
 * the AI error decorations (✕ / "translating..." / error tooltip) are kept,
 * but they no longer fight the palette over the button text color — the
 * decoration's own color lives on the indicator span.
 *
 * #83: the AI success ✓ glyph was REMOVED by user request — the label stays a
 * plain "AI" and the success state is carried by the `dualtran-ai-success`
 * class alone (the highlighted button already communicates the state).
 */
export function updateSingletonUI(translatedElement) {
  if (!_singleton.aiBtn) return;
  const state = blockStateMap.get(translatedElement);
  if (!state) return;

  // Reset state classes
  _singleton.aiBtn.classList.remove("dualtran-ai-loading", "dualtran-ai-success", "dualtran-ai-error");
  // Remove the error indicator from a previous render. #83: the success ✓ glyph
  // was removed, so the cross is the only decoration that can be present.
  _singleton.aiBtn.querySelectorAll(".dualtran-ai-error-cross").forEach(el => el.remove());

  const status = state.aiStatus;
  if (status === "translated") {
    // #83: success state = class marker only, label stays a plain "AI".
    // The ✓ decoration that used to be appended here was removed by user
    // request (the highlighted button already communicates the state).
    _singleton.aiBtn.classList.add("dualtran-ai-success");
    _singleton.aiTextNode.textContent = "AI";
    _singleton.tooltipNode.textContent = "AI translated successfully!";
    _singleton.tooltipNode.style.color = "";
  } else if (status === "translationError") {
    _singleton.aiBtn.classList.add("dualtran-ai-error");
    const cross = document.createElement("span");
    cross.textContent = "✕";
    cross.className = "dualtran-ai-error-cross";
    _singleton.aiTextNode.textContent = "AI";
    _singleton.aiTextNode.appendChild(cross);
    // Restore error reason from blockState to tooltip (stored in state.errorMessage when error occurred)
    _singleton.tooltipNode.textContent = state.errorMessage || "AI translation error";
    _singleton.tooltipNode.style.color = "#dc2626";
  } else if (status === "translating") {
    _singleton.aiBtn.classList.add("dualtran-ai-loading");
    _singleton.aiTextNode.textContent = "translating...";
    _singleton.tooltipNode.textContent = "translating...";
    _singleton.tooltipNode.style.color = "";
  } else {
    // Idle state: clear tooltip to avoid residual error/success info from previous block
    _singleton.aiTextNode.textContent = "AI";
    _singleton.tooltipNode.textContent = "";
    _singleton.tooltipNode.style.color = "";
  }

  // Active-state highlight follows the block's display mode (legacy state
  // fallback mirrors the pre-#65 handlers).
  const displayMode = state.displayMode ||
    (state.aiStatus === "translated" ? "ai" : "google");
  applyButtonPalette(displayMode);
}

// ── Event delegation ────────────────────────────────────────────

let _hoverDelegationAttached = false;

const HIDE_DELAY_MS = 250;

const _onMouseover = (e) => {
  // Find <translated> element (newLine mode) or element with data-dualtran-block attribute (replaceOriginal mode)
  const translated = e.target.closest("translated, [data-dualtran-block]");
  if (translated) {
    showButtonGroup(translated);
    return;
  }
  // Entering the button host itself cancels any pending hide
  if (e.target.closest("#dualtran-singleton-btn-host")) {
    if (_singleton._pendingHideTimer) {
      clearTimeout(_singleton._pendingHideTimer);
      _singleton._pendingHideTimer = null;
    }
  }
};

const _onMouseout = (e) => {
  // Only trigger if leaving a translated element and not entering another or the btnGroup
  // Find <translated> element (newLine mode) or element with data-dualtran-block attribute (replaceOriginal mode)
  const leaveTranslated = e.target.closest("translated, [data-dualtran-block]");
  if (!leaveTranslated) return;

  const enterTarget = e.relatedTarget;
  if (enterTarget && (enterTarget.closest("translated, [data-dualtran-block]") || enterTarget.closest("#dualtran-singleton-btn-host"))) {
    return;
  }

  // Delay hide to avoid flicker
  if (_singleton._pendingHideTimer) clearTimeout(_singleton._pendingHideTimer);
  _singleton._pendingHideTimer = setTimeout(() => {
    hideButtonGroup();
  }, HIDE_DELAY_MS);
};

const _onScroll = () => {
  if (_singleton._visible) {
    hideButtonGroup();
  }
};

const _onTouchstart = (e) => {
  const translated = e.target.closest("translated");
  if (translated) {
    if (_singleton._visible && _singleton.currentTarget === translated) {
      hideButtonGroup();
    } else {
      showButtonGroup(translated);
    }
  } else if (_singleton._visible && !e.target.closest("#dualtran-singleton-btn-host")) {
    hideButtonGroup();
  }
};

/**
 * Attach hover + scroll + touch event delegation.
 * Call once per page load.
 */
export function attachHoverDelegation() {
  if (_hoverDelegationAttached) return;
  _hoverDelegationAttached = true;

  document.addEventListener("mouseover", _onMouseover);
  document.addEventListener("mouseout", _onMouseout);
  window.addEventListener("scroll", _onScroll, { passive: true, capture: true });
  document.addEventListener("touchstart", _onTouchstart);
}

function _detachHoverListeners() {
  document.removeEventListener("mouseover", _onMouseover);
  document.removeEventListener("mouseout", _onMouseout);
  window.removeEventListener("scroll", _onScroll, { capture: true });
  document.removeEventListener("touchstart", _onTouchstart);
  _hoverDelegationAttached = false;
}

// ── iframe guard ──
// All functions check window.self !== window.top at entry points,
// so loading this module in an iframe is harmless.
