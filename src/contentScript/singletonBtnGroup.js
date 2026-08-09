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
 * @property {"idle"|"queuing"|"translating"|"translated"|"translationError"} aiStatus
 * @property {string} [errorMessage]
 */

/**
 * Register a translated block in the WeakMap.
 * Called by pageTranslator.js instead of createInlineButtonGroup().
 */
export function registerBlock(translatedElement, sourceString, translatedTextNode, googleTranslatedText, nodesToClear, { googleSpan = null, aiSpan = null } = {}) {
  // Mark element so getProxiesForTranslation can find non-<translated> elements in replaceOriginal mode
  translatedElement.dataset.dualtranBlock = "1";
  blockStateMap.set(translatedElement, {
    sourceString,
    translatedTextNode,  // Legacy: kept for backward compat (points to googleTextNode in new mode)
    googleTranslatedText,
    nodesToClear,
    translationId: "",
    aiStatus: "idle",
    // Dual-span mode: separate spans for Google and AI translations
    googleSpan,   // <span class="dualtran-google"> — Google writes here
    aiSpan,       // <span class="dualtran-ai"> — AI writes here
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
  get translationId() { return this._st().translationId; }
  set translationId(v) { this._st().translationId = v; }
  get translationStatus() { return this._st().aiStatus; }
  set translationStatus(v) { this._st().aiStatus = v; }

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
  return result.filter(p => !["queuing", "translating", "translated", "translationError"].includes(p.translationStatus));
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
  aiBtn: null,
  googleBtn: null,
  aiTextNode: null,
  tooltipNode: null,
  _callbacks: null,
  _visible: false,
  _pendingHideTimer: null,
};

/**
 * Create the singleton button group host (Shadow DOM) on document.body.
 */
export function createSingletonButtonGroup() {
  // If host has been detached from DOM tree (body replaced by Turbo/SPA navigation), reset references to allow rebuilding
  if (_singleton.host) {
    if (!document.body.contains(_singleton.host)) {
      if (_singleton._pendingHideTimer) {
        clearTimeout(_singleton._pendingHideTimer);
        _singleton._pendingHideTimer = null;
      }
      _singleton.host = null;
      _singleton.currentTarget = null;
      _singleton._visible = false;
    } else {
      return;
    }
  }
  if (window.self !== window.top) return;

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
      .dualtran-google-btn, .dualtran-ai-btn {
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
      .dualtran-google-btn {
        border: 1px solid #86efac;
        background: #f0fdf4;
        color: #15803d;
      }
      .dualtran-ai-btn {
        border: 1px solid #ddd6fe;
        background: #f5f3ff;
        color: #7c3aed;
      }
      .dualtran-ai-btn.dualtran-ai-loading { color: #4f46e5; }
      .dualtran-ai-btn.dualtran-ai-success { color: #16a34a; }
      .dualtran-ai-btn.dualtran-ai-error { color: #dc2626; }
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
      .dualtran-ai-success-check { color: #16a34a; margin-left: 4px; font-weight: 600; }
      .dualtran-ai-error-cross { color: #dc2626; margin-left: 4px; font-weight: 600; }
    </style>
    <div class="dualtran-btn-group">
      <button class="dualtran-google-btn">G ✓</button>
      <button class="dualtran-ai-btn">
        <span>AI</span>
        <span class="dualtran-ai-tooltip"></span>
      </button>
    </div>
  `;

  document.body.appendChild(host);

  const btnGroup = shadow.querySelector(".dualtran-btn-group");
  const googleBtn = shadow.querySelector(".dualtran-google-btn");
  const aiBtn = shadow.querySelector(".dualtran-ai-btn");
  const aiTextNode = aiBtn.querySelector("span");
  const tooltipNode = aiBtn.querySelector(".dualtran-ai-tooltip");

  _singleton = {
    ..._singleton,
    host,
    btnGroup,
    googleBtn,
    aiBtn,
    aiTextNode,
    tooltipNode,
  };

  // Google button click → callback
  googleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_singleton.currentTarget && _singleton._callbacks?.onGoogleClick) {
      _singleton._callbacks.onGoogleClick(_singleton.currentTarget);
    }
  });

  // AI button click → callback
  aiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_singleton.currentTarget && _singleton._callbacks?.onAiClick) {
      _singleton._callbacks.onAiClick(_singleton.currentTarget);
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
 */
export function destroySingletonButtonGroup() {
  if (_singleton.host) {
    _singleton.host.remove();
  }
  _detachHoverListeners();
  _singleton = { ..._singleton, host: null, btnGroup: null, currentTarget: null, _visible: false, _pendingHideTimer: null };
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
 */
export function showButtonGroup(translatedElement) {
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
 */
export function updateSingletonUI(translatedElement) {
  if (!_singleton.aiBtn) return;
  const state = blockStateMap.get(translatedElement);
  if (!state) return;

  // Reset state classes
  _singleton.aiBtn.classList.remove("dualtran-ai-loading", "dualtran-ai-success", "dualtran-ai-error");
  // Remove old indicators
  _singleton.aiBtn.querySelectorAll(".dualtran-ai-success-check,.dualtran-ai-error-cross").forEach(el => el.remove());

  const status = state.aiStatus;
  if (status === "translated") {
    _singleton.aiBtn.classList.add("dualtran-ai-success");
    const check = document.createElement("span");
    check.textContent = "✓";
    check.className = "dualtran-ai-success-check";
    _singleton.aiTextNode.textContent = "AI";
    _singleton.aiTextNode.appendChild(check);
    _singleton.tooltipNode.textContent = "AI translated successfully!";
    _singleton.tooltipNode.style.color = "";
    _singleton.aiBtn.style.color = "";
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
    _singleton.aiBtn.style.color = "#dc2626";
  } else if (status === "translating") {
    _singleton.aiBtn.classList.add("dualtran-ai-loading");
    _singleton.aiTextNode.textContent = "translating...";
    _singleton.tooltipNode.textContent = "translating...";
    _singleton.tooltipNode.style.color = "";
    _singleton.aiBtn.style.color = "";
  } else {
    // Idle state: clear tooltip to avoid residual error/success info from previous block
    _singleton.aiTextNode.textContent = "AI";
    _singleton.tooltipNode.textContent = "";
    _singleton.tooltipNode.style.color = "";
    _singleton.aiBtn.style.color = "";
  }
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
