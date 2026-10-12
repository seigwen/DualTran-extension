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
import {
  AI_ENGINE_LABEL,
  GOOGLE_ENGINE_LABEL,
  getOriginalButtonLabel,
} from "./engineLabels.js";
import { BTN_COLORS } from "./blockBtnGroupShared.js";
import {
  upsertBlockBadge,
  removeBlockBadge,
  removeAllBlockBadges,
  setBlockBadgeCallbacks,
  syncBlockBadgeActiveState,
} from "./blockBtnGroupBadge.js";

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
 * @property {"original"|"google"|"ai"} displayMode — ACTUAL display record
 *   (plan 30): written by actual-display events alone (success display
 *   switches / restore); drives the resolver's noop decisions.
 * @property {"original"|"google"|"ai"} intentMode — INTENT record (plan 30):
 *   what the user asked for (click), what a page-level intent action
 *   propagated, or what the rebuild derivation seeded. The button highlight
 *   reads THIS, not displayMode — the two may legally diverge mid-flight
 *   (AI in flight → intent ai while the page still shows Google).
 * @property {number} requestEpoch — monotonic write-back guard (#65): restored
 *   blocks bump it, so late in-flight responses (Google/AI) are discarded.
 * @property {number} blockIntentEpoch — block-scope switch-away edge counter
 *   (plan 30 / Q2c, #70 family): bumped when a click switches the block away
 *   from an in-flight AI request; the arrival checks it and keeps the result
 *   without stealing the display (newLine: kept; replaceOriginal: discarded).
 * @property {string} [errorMessage]
 */

/**
 * Register a translated block in the WeakMap.
 * Called by pageTranslator.js instead of createInlineButtonGroup().
 */
/**
 * Create a block state with canonical defaults for the state machine fields.
 * registerBlock() merges this with data fields and DOM references.
 * @returns {{ aiStatus: string, googleBtnState: string, displayMode: string, intentMode: string, translationId: string, requestEpoch: number, blockIntentEpoch: number }}
 */
export function createBlockState() {
  return {
    aiStatus: "idle",
    googleBtnState: "idle",
    displayMode: "original",
    intentMode: "original",
    translationId: "",
    requestEpoch: 0,
    blockIntentEpoch: 0,
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
    // Intent at registration = Google (same reasoning): the block's first
    // registered moment is the Google pass. Page-level intent changes reach
    // it afterwards via propagateIntentToBlocks.
    intentMode: "google",
  });

  // Always mode (#57): a persistent control at the block end for no-mouse
  // users — badge or inline three buttons (blockBtnGroupBadge.js). The
  // initial active-state paint is deferred: the call sites set the inherited
  // intentMode right AFTER registerBlock returns, and the row must reflect
  // that value, not the registration default ("google").
  const policy = _getEntryPolicy();
  if (policy.display === "always") {
    try {
      upsertBlockBadge(translatedElement, policy.alwaysStyle);
      queueMicrotask(() => {
        try {
          const st = blockStateMap.get(translatedElement);
          if (st) syncBlockBadgeActiveState(translatedElement, st.intentMode);
        } catch (e) {
          console.warn("[DualTran] badge state paint failed", e);
        }
      });
    } catch (e) {
      console.warn("[DualTran] badge upsert failed", e);
    }
  }
}

// ── Entry policy (#57) ───────────────────────────────────────────
// The settings (blockBtnGroupDisplay / AlwaysStyle / ShowOnHover /
// ShowOnClick) decide WHEN the singleton group appears. The provider is
// installed by pageTranslator (which owns config access) and read fresh at
// every event — no staleness, no subscription needed for gating. The module
// default mirrors the pre-settings behavior so unit tests that never install
// a provider keep their old semantics (hover-only, no tap).
const DEFAULT_ENTRY_POLICY = Object.freeze({
  display: "triggered",
  alwaysStyle: "badge",
  showOnHover: "yes",
  showOnClick: "no",
});

let _entryPolicyProvider = null;

export function setEntryPolicyProvider(provider) {
  _entryPolicyProvider = typeof provider === "function" ? provider : null;
}

function _getEntryPolicy() {
  try {
    const policy = _entryPolicyProvider && _entryPolicyProvider();
    if (policy && policy.display) return policy;
  } catch (e) {
    console.warn("[DualTran] entry policy provider failed", e);
  }
  return DEFAULT_ENTRY_POLICY;
}

/** Hover entry is live only in triggered mode with the hover toggle on. */
function _hoverEntryEnabled(policy) {
  return policy.display === "triggered" && policy.showOnHover === "yes";
}

/** Tap/click entry is live only in triggered mode with the click toggle on. */
function _clickEntryEnabled(policy) {
  return policy.display === "triggered" && policy.showOnClick === "yes";
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

  // ── Absorbing DOM surfaces (plan 30 / Q3a) ──
  // The engine's UI writes must NEVER reach the visible button: the button is
  // rendered from state by updateSingletonUI, and actual translation state is
  // expressed on the page (spinners / ⚠ / translated text). These surfaces
  // used to fall through to the live singleton node when the block was the
  // hover target, so the page-level AI flow ("queuing"/"translating..." labels,
  // dualtran-ai-loading/-success/-error classes, ✕ cross, dynamic tooltips,
  // title, button color) decorated the visible button mid-stream. Absorption
  // is unconditional — target or not (same contract as createSingletonBlockProxy).
  get btnAiTxtNode()  { return DUMMY_NODE; }
  get tooltip()       { return DUMMY_NODE; }
  get classList()     { return DUMMY_CLASSLIST; }
  get style()         { return DUMMY_STYLE; }
  get ownerDocument() { return document; }

  /** Absorbed — the live button's title stays the static i18n tooltip (plan 30 / Q3a). */
  setAttribute(_name, _value) {}

  // ── Internals ──
  _st() { return this._map.get(this._el) || {}; }
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
  _anchorEl: null,
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
// layout only. Active state source = the block's intentMode.
//
// #57: the constant itself now lives in blockBtnGroupShared.js — the
// always-visible inline row (blockBtnGroupBadge.js) renders the same
// palette. Re-exported below so existing import paths keep working.

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
      /* Coarse pointers (#57): finger-sized tap targets for the popover. */
      @media (pointer: coarse) {
        .dualtran-original-btn, .dualtran-google-btn, .dualtran-ai-btn {
          font-size: 14px;
          padding: 10px 14px;
          min-height: 44px;
        }
      }
    </style>
    <div class="dualtran-btn-group">
      <button class="dualtran-original-btn"></button>
      <button class="dualtran-google-btn"></button>
      <button class="dualtran-ai-btn">
        <span></span>
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

  // Engine labels (#157 batch ③): "Original" is localized; Google/AI are
  // brand/initialism tokens — all three from the engineLabels single source.
  originalBtn.textContent = getOriginalButtonLabel();
  googleBtn.textContent = GOOGLE_ENGINE_LABEL;
  aiTextNode.textContent = AI_ENGINE_LABEL;

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
  // #57: route the always-visible controls through the same single-entry
  // executor as the popover buttons (onBtnClick(buttonId, blockEl)).
  setBlockBadgeCallbacks({
    onInlineButtonClick(buttonId, blockEl) {
      try {
        _singleton._callbacks?.onBtnClick?.(buttonId, blockEl);
      } catch (e) {
        console.warn("[DualTran] inline button dispatch failed", e);
      }
    },
    onBadgeClick(badgeEl, blockEl) {
      handleBadgeClick(badgeEl, blockEl);
    },
  });
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
  _pointerDownInfo = null;
  try {
    removeAllBlockBadges();
  } catch (e) {
    console.warn("[DualTran] badge sweep failed", e);
  }
  _singleton = { ..._singleton, host: null, btnGroup: null, originalBtn: null, currentTarget: null, _anchorEl: null, _visible: false, _pendingHideTimer: null };
}

// ── Positioning ─────────────────────────────────────────────────

/**
 * Position the button group relative to an anchor element (the block, or
 * the badge in always mode — #57). Defaults below-left. Flips above if
 * viewport overflow; clamps to the right edge.
 */
export function positionButtonGroup(anchorEl) {
  if (!_singleton.host || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const host = _singleton.host;

  // Force layout recalculation
  host.style.display = "block";
  const hostRect = host.getBoundingClientRect();

  let top = rect.bottom + 4;
  // Flip above if would overflow bottom
  if (top + hostRect.height > window.innerHeight && rect.top > hostRect.height + 4) {
    top = rect.top - hostRect.height - 4;
  }

  // Viewport clamp (#57): left edge only guards the left; a three-button row
  // anchored at the end of a narrow-viewport line can overflow the right.
  // The clamped value feeds BOTH positioning branches below — the absolute
  // fallback (transformed ancestors) must not bypass the guard.
  let clampedLeft = Math.max(0, rect.left);
  if (hostRect.width && clampedLeft + hostRect.width > window.innerWidth - 4) {
    clampedLeft = Math.max(0, window.innerWidth - hostRect.width - 4);
  }
  host.style.left = clampedLeft + "px";
  host.style.top = Math.max(0, top) + "px";

  // Fixed-position fallback: detect ancestor transform
  if (hasAncestorTransform()) {
    host.style.position = "absolute";
    host.style.left = (clampedLeft + window.scrollX) + "px";
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
export function showButtonGroup(translatedElement, options = {}) {
  const anchorEl = options.anchorEl || translatedElement;
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
  _singleton._anchorEl = anchorEl;
  updateSingletonUI(translatedElement);
  positionButtonGroup(anchorEl);
  _singleton._visible = true;
}

/**
 * Hide the button group.
 */
export function hideButtonGroup() {
  if (!_singleton.host) return;
  _singleton.currentTarget = null;
  _singleton._anchorEl = null;
  _singleton._visible = false;
  _singleton.host.style.top = "-9999px";
  _singleton.host.style.left = "-9999px";
}

/**
 * Render the singleton hover button group for a block.
 *
 * Plan 30 (intent model): the buttons express INTENT ONLY — no loading/error
 * decoration (the old "translating..." label, ✕ cross, error tooltip and
 * success/loading/error classes are REMOVED). Actual state lives on the page:
 * spinners, translated text, ⚠ error icons. The highlight reads the block's
 * `intentMode` (falling back to the legacy displayMode derivation for blocks
 * whose state was created before the field existed).
 *
 * #83: the label stays a plain "AI" — nothing decorates it anymore.
 */
export function updateSingletonUI(translatedElement) {
  const state = blockStateMap.get(translatedElement);
  // #57: refresh this block's always-visible inline controls first — that
  // path is host-independent (the row can exist while the popover host was
  // never created, e.g. always mode + buttons style on a fresh page).
  if (state) {
    try {
      syncBlockBadgeActiveState(translatedElement, state.intentMode);
    } catch (e) {
      console.warn("[DualTran] inline control refresh failed", e);
    }
  }
  if (!_singleton.aiBtn) return;
  if (!state) return;

  // Intent-driven active-state highlight (plan 30 / Q2a). Legacy fallback
  // mirrors the pre-plan-30 derivation for state objects created without
  // intentMode (e.g. tests building bare states).
  const intentMode =
    state.intentMode ||
    state.displayMode ||
    (state.aiStatus === "translated" ? "ai" : "google");
  applyButtonPalette(intentMode);
}

// ── Always-visible controls orchestration (#57) ──────────────────

/**
 * Badge click (always mode): open the shared singleton group as a popover
 * anchored at the badge; clicking the same badge again closes it. The
 * identity guard mirrors showButtonGroup's fail-safe: only registered blocks
 * have state (a Turbo snapshot clone carries the attribute but not the
 * WeakMap entry).
 */
function handleBadgeClick(badgeEl, blockEl) {
  if (!blockStateMap.get(blockEl)) return;
  if (
    _singleton._visible &&
    _singleton.currentTarget === blockEl &&
    _singleton._anchorEl === badgeEl
  ) {
    hideButtonGroup();
  } else {
    showButtonGroup(blockEl, { anchorEl: badgeEl });
  }
}

/**
 * Reconcile every registered block's control with the current settings:
 * inject (or swap the style of) controls in always mode, remove them in
 * triggered mode. Called on settings changes (pageTranslator's config
 * listener).
 */
export function syncBlockBadges() {
  const policy = _getEntryPolicy();
  const styleMode = policy.alwaysStyle === "buttons" ? "buttons" : "badge";
  for (const el of document.querySelectorAll("translated, [data-dualtran-block]")) {
    if (!blockStateMap.has(el)) continue;
    try {
      if (policy.display === "always") {
        upsertBlockBadge(el, styleMode);
        const st = blockStateMap.get(el);
        if (st) syncBlockBadgeActiveState(el, st.intentMode);
      } else {
        removeBlockBadge(el);
      }
    } catch (e) {
      console.warn("[DualTran] syncBlockBadges failed", e);
    }
  }
}

/**
 * Repaint every registered block's inline row from its intentMode — the
 * page-level intent propagation path (one write, every row follows).
 */
export function syncAllBlockBadgeActiveStates() {
  for (const el of document.querySelectorAll("translated, [data-dualtran-block]")) {
    if (!blockStateMap.has(el)) continue;
    try {
      const st = blockStateMap.get(el);
      if (st) syncBlockBadgeActiveState(el, st.intentMode);
    } catch (e) {
      console.warn("[DualTran] syncAllBlockBadgeActiveStates failed", e);
    }
  }
}

// ── Event delegation ────────────────────────────────────────────

let _hoverDelegationAttached = false;

const HIDE_DELAY_MS = 250;

const _onMouseover = (e) => {
  // #171: touch-synthesized compat mouse events (Chrome fires mouseover after
  // every tap) must not enter through the hover gate — the tap guards own the
  // touch path; the hover gate is for real pointers only.
  if (_isTouchSynthesizedMouseEvent(e)) return;
  // Find <translated> element (newLine mode) or element with data-dualtran-block attribute (replaceOriginal mode)
  const translated = e.target.closest("translated, [data-dualtran-block]");
  if (translated) {
    // #57: the hover entry respects the entry policy (triggered mode + hover
    // toggle). In always mode the persistent controls are the only entry.
    if (_hoverEntryEnabled(_getEntryPolicy())) {
      showButtonGroup(translated);
    }
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
  // #171: mirror of the mouseover guard — touch-synthesized mouseout must not
  // hide a group that a tap just opened (dismissal on touch = outside
  // pointerdown / scroll / re-tap).
  if (_isTouchSynthesizedMouseEvent(e)) return;
  // #57: hover-hide applies only while the hover entry is live — a group
  // opened by tap or badge survives mouse-out (it is dismissed by outside
  // pointerdown / scroll / re-tap instead).
  if (!_hoverEntryEnabled(_getEntryPolicy())) return;
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

// ── Tap / click entry (#57) ──────────────────────────────────────
// Replaces the legacy touchstart handler. Tap semantics: pointerup with
// movement / duration guards so that scroll starts, long-press text
// selection and link taps never open the group; pointerdown outside a block
// keeps the snappy dismiss the old handler had.
//
// #171 probe findings (xvfb E2E, block-btn-group scenario):
//   1. Chrome synthesizes compat mouse events (mouseover/mousedown/…/click)
//      after touch taps — the synthetic mouseover used to enter through the
//      HOVER gate and bypass the tap guards. Touch-synthesized mouse events
//      are now ignored for the hover entry (sourceCapabilities.firesTouchEvents
//      + a post-touch fallback window).
//   2. Handler-run-time (performance.now) overstates a gesture's duration
//      when the renderer is congested (events are delivered late). The tap
//      guards therefore use the event's own input timestamp (e.timeStamp).

const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_DURATION_MS = 600;
const TOUCH_MOUSE_SUPPRESS_MS = 700;
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, summary, [contenteditable], [role="button"]';

let _pointerDownInfo = null;
let _lastTouchInteractionAt = null;

function _isTouchSynthesizedMouseEvent(e) {
  // Chrome marks compat mouse events synthesized from touch input.
  if (e && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return true;
  // Fallback for shapes without sourceCapabilities: a mouse hover event in
  // the window right after a real touch pointer is the synthetic twin of the
  // tap, not a mouse hover.
  return (
    typeof _lastTouchInteractionAt === "number" &&
    performance.now() - _lastTouchInteractionAt < TOUCH_MOUSE_SUPPRESS_MS
  );
}

function _eventTime(e) {
  return typeof e.timeStamp === "number" ? e.timeStamp : performance.now();
}

function _isExtensionControl(target) {
  return !!(
    target &&
    target.closest &&
    target.closest(
      ".dualtran-block-badge, .dualtran-block-btn-row, #dualtran-singleton-btn-host"
    )
  );
}

function _blockOf(target) {
  return target && target.closest
    ? target.closest("translated, [data-dualtran-block]")
    : null;
}

const _onPointerDown = (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.isPrimary === false) return;
  if (e.pointerType === "touch") _lastTouchInteractionAt = performance.now();
  const target = e.target;
  const block = _blockOf(target);
  if (!block) {
    if (_singleton._visible && !_isExtensionControl(target)) {
      hideButtonGroup();
    }
    _pointerDownInfo = null;
    return;
  }
  _pointerDownInfo = {
    x: e.clientX,
    y: e.clientY,
    t: _eventTime(e),
    blockEl: block,
  };
};

const _onPointerUp = (e) => {
  const info = _pointerDownInfo;
  _pointerDownInfo = null;
  if (!info) return;
  if (e.pointerType === "touch") _lastTouchInteractionAt = performance.now();
  if (!_clickEntryEnabled(_getEntryPolicy())) return;
  if (_eventTime(e) - info.t > TAP_MAX_DURATION_MS) return;
  const dx = (typeof e.clientX === "number" ? e.clientX : info.x) - info.x;
  const dy = (typeof e.clientY === "number" ? e.clientY : info.y) - info.y;
  if (Math.sqrt(dx * dx + dy * dy) > TAP_MAX_MOVE_PX) return;
  const target = e.target;
  if (_isExtensionControl(target)) return;
  if (target.closest && target.closest(INTERACTIVE_SELECTOR)) return;
  const block = _blockOf(target);
  if (!block || block !== info.blockEl) return;
  if (_singleton._visible && _singleton.currentTarget === block) {
    hideButtonGroup();
  } else {
    showButtonGroup(block);
  }
};

const _onPointerCancel = () => {
  _pointerDownInfo = null;
};

/**
 * Attach hover + tap/click + scroll event delegation.
 * Call once per page load.
 */
export function attachHoverDelegation() {
  if (_hoverDelegationAttached) return;
  _hoverDelegationAttached = true;

  document.addEventListener("mouseover", _onMouseover);
  document.addEventListener("mouseout", _onMouseout);
  window.addEventListener("scroll", _onScroll, { passive: true, capture: true });
  document.addEventListener("pointerdown", _onPointerDown);
  document.addEventListener("pointerup", _onPointerUp);
  document.addEventListener("pointercancel", _onPointerCancel);
}

function _detachHoverListeners() {
  document.removeEventListener("mouseover", _onMouseover);
  document.removeEventListener("mouseout", _onMouseout);
  window.removeEventListener("scroll", _onScroll, { capture: true });
  document.removeEventListener("pointerdown", _onPointerDown);
  document.removeEventListener("pointerup", _onPointerUp);
  document.removeEventListener("pointercancel", _onPointerCancel);
  _hoverDelegationAttached = false;
}

// ── iframe guard ──
// All functions check window.self !== window.top at entry points,
// so loading this module in an iframe is harmless.
