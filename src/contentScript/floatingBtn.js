
/**
 * Floating button
 */

console.log("floatingBtn.js is running")

import twpConfig from "../lib/config.js"
import { registerHost } from "./hostLifecycle.js"
import { pageTranslator } from "./pageTranslator.js"
import { resolveFloatingBtnClick, resolveInitialUiState } from "./floatingBtnClickResolver.js"
import { setState, getState, resetForRebuild } from "./uiStateStore.js"
import {
  getFloatingButtonAiTooltipText,
  getFloatingButtonGoogleTooltipText,
  getFloatingButtonMoreOptionsText,
  getFloatingButtonOriginalTooltipText,
} from "./i18n.js"

var floatingBtn = {};

/**
 * Get tab hostname
 * @returns 
 */
function getTabHostName() {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "getTabHostName" }, (result) =>
      resolve(result)
    )
  );
}

// Only show floating button in top-level window, skip iframes
if (window.self !== window.top) {
  console.log("floatingBtn.js: skip iframe, only top window shows floating button");
} else {
  Promise.all([twpConfig.onReady(), getTabHostName()]).then(function (_) {
    console.log("floatingBtn.js is still running")
    const tabHostName = _[1];

  const htmlMobile = `
    <style>
      @keyframes dualtranFloatingBtnSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      #floatingBtnBody {
        position: relative;
        padding-top: 38px;
      }

      #floatingBtnLayer.dualtran-options-shortcut-below #floatingBtnBody {
        padding-top: 0;
        padding-bottom: 38px;
      }

      .dualtran-floating-btn-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        white-space: nowrap;
      }

      .dualtran-floating-btn-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 999px;
        animation: dualtranFloatingBtnSpin 0.7s linear infinite;
        box-sizing: border-box;
        flex: 0 0 auto;
      }

      .dualtran-floating-btn-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
    <div id="floatingBtnLayer" style="position: fixed; top: 50%; right: 0px; transform: translateY(-50%); z-index: 2147483647;">
      <div id="floatingBtnBody">
        <button id="btnOptionsShortcut" type="button" style="position: absolute; right: 0px; top: 0; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border: none; background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%); border-radius: 999px; box-shadow: 0 10px 22px rgba(37,99,235,0.32); color: #ffffff; cursor: pointer; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(4px) scale(0.96); transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s ease; line-height: 1; z-index: 3; padding: 0; outline: none;">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" style="display: block; fill: currentColor;">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.14 7.14 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.84a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"></path>
          </svg>
        </button>
        <div id="floatingBtnContainer" style="position: relative; display: flex; flex-direction: column; align-items: stretch; background: white; border: 1px solid #d1d5db; border-radius: 12px; padding: 6px; box-shadow: 0 10px 24px rgba(15,23,42,0.18); width: 92px; min-width: 48px; gap: 6px; font-family: Arial, sans-serif; box-sizing: border-box;">
          <div id="resizeHandle" style="position: absolute; left: -6px; top: 18px; bottom: 6px; width: 12px; display: flex; align-items: center; justify-content: center; cursor: ew-resize; touch-action: none;">
            <div style="width: 3px; height: 26px; border-radius: 999px; background: #cbd5e1;"></div>
          </div>
          <div id="dragHandle" style="height: 12px; cursor: grab; background: #f3f4f6; border-radius: 999px; display: flex; justify-content: center; align-items: center;">
          <div style="width: 22px; height: 2px; background: #9ca3af; border-radius: 999px;"></div>
          </div>
          <button id="btnOriginal" type="button" style="cursor: pointer; border: 1px solid #d1d5db; background: #f3f4f6; border-radius: 8px; padding: 8px 10px; font-size: 12px; font-weight: 700; color: #6b7280; transition: all 0.2s ease; width: 100%; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Original</button>
          <button id="btnGoogle" type="button" style="cursor: pointer; border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 8px; padding: 8px 10px; font-size: 12px; font-weight: 700; color: #1d4ed8; transition: all 0.2s ease; width: 100%; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Google</button>
          <button id="btnAi" type="button" style="cursor: pointer; border: 1px solid #ddd6fe; background: #f5f3ff; border-radius: 8px; padding: 8px 10px; font-size: 12px; font-weight: 700; color: #7c3aed; transition: all 0.2s ease; width: 100%; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">AI</button>
        </div>
      </div>
    </div>
    `;

  let originalTabLanguage = "und";
  let currentTargetLanguage = twpConfig.get("targetLanguage");
  let currentPageTranslatorService = twpConfig.get("pageTranslatorService");
  let alwaysTranslateThisSite =
    twpConfig.get("alwaysTranslateSites").indexOf(tabHostName) !== -1;
  let translateThisSite =
    twpConfig.get("neverTranslateSites").indexOf(tabHostName) === -1;
  let translateThisLanguage = false;
  let showFloatingBtn = twpConfig.get("showFloatingBtn");

  // Watch config change events
  twpConfig.onChanged(function (name, newValue) {
    switch (name) {
      // Sites always translated
      case "alwaysTranslateSites":
        alwaysTranslateThisSite = newValue.indexOf(tabHostName) !== -1;
        console.log("will show floating button, 1111111")
        floatingBtn.show();
        break;
      // Sites never translated
      case "neverTranslateSites":
        translateThisSite = newValue.indexOf(tabHostName) === -1;
        console.log("will show floating button, 2222222")
        floatingBtn.show();
        break;
      // Languages never translated
      case "neverTranslateLangs":
        translateThisLanguage =
          originalTabLanguage === "und" ||
          (currentTargetLanguage !== originalTabLanguage &&
            newValue.indexOf(originalTabLanguage) === -1);
        console.log("will show floating button, 3333333")
        floatingBtn.show();
        break;
      // Show floating button
      case "showFloatingBtn":
        showFloatingBtn = newValue;
        console.log("will show floating button, 4444444")
        floatingBtn.show();
        break;
    }
  });

  let divElement;
  let getElemById;
  let detachViewportListeners = null;
  let shortcutRevealTimer = null;
  let lastViewportWidth = window.innerWidth;
  const MIN_FLOATING_BTN_WIDTH = 48;
  // Height of the options shortcut strip reserved by #floatingBtnBody padding
  // (padding-top: 38px, flipped to padding-bottom near the top edge). The
  // POSITIONED element is the layer, whose box is the container plus this
  // strip — so every viewport budget must include it, or the panel bottom
  // (AI button row) can be placed up to 38px past the viewport edge (#80).
  const SHORTCUT_STRIP_SIZE = 38;

  // B3: engineStateOverride handoff into the registered create() callback.
  // show(forceShow, engineStateOverride) stores the override here right
  // before handle.rebuild(); createFloatingBtnHost() consumes it
  // synchronously (single-threaded — no interleaving with eager triggers).
  let pendingEngineStateOverride = null;

  // Register with the shared host lifecycle manager (C1/M5). The manager
  // owns the health predicate, the enabled flag ("should this host
  // exist"), the rebuild mechanism (clear every stale copy → create) and
  // the eager subscriptions (popstate 200ms / observer 300ms debounce on
  // getObserverRoot() / pageshow persisted — timing preserved verbatim).
  // show()/hide() below keep the component policy.
  const floatingBtnHandle = registerHost({
    hostId: "dualtran-floating-btn-host",
    create: createFloatingBtnHost,
    recovery: "eager",
  });

  /**
   * Hide floating button — the "should not exist" policy (C1, M5).
   *
   * The manager owns the mechanism now: disable() flips the enabled flag
   * to false (the explicit "hidden by choice" signal the eager triggers
   * check — a passive DOM removal keeps the flag true and rebuilds; an
   * active hide does not) AND removes every host copy from the DOM (Turbo
   * snapshot renders can leave a shadow-less shell behind while this
   * closure's divElement points at a detached node — bug 2026-09-14;
   * removing every copy guarantees a single healthy host after a rebuild).
   */
  floatingBtn.hide = function () {
    floatingBtnHandle.disable();

    if (detachViewportListeners) {
      detachViewportListeners();
      detachViewportListeners = null;
    }

    if (shortcutRevealTimer) {
      clearTimeout(shortcutRevealTimer);
      shortcutRevealTimer = null;
    }

    divElement = getElemById = null;
  };

  /**
   * Show floating button
   * @param {*} forceShow 
   * @param {Object} [engineStateOverride] — B3: test-only state injection point.
   *   When provided, the button group initializes from this state instead of
   *   querying pageTranslator. Production callers never pass it; tests use it
   *   to verify the rebuild-initialization contract without mocking getState.
   * @returns 
   */
  floatingBtn.show = function (forceShow = false, engineStateOverride = null) {
    console.log("floatingBtn.show() is called")

    floatingBtn.hide();

    if (
      !forceShow && showFloatingBtn !== "yes"
    ){
      console.log("floatingBtn.show() going to return in short")
      return;
    }
    console.log("floatingBtn.show() is called 2222")

    pendingEngineStateOverride = engineStateOverride;
    floatingBtnHandle.rebuild();
  };

  /**
   * The registered create() callback (C1, M5): build a fresh floating-button
   * host, install listeners, and seed the UI state store from the engine.
   * Called by the lifecycle manager through rebuild()/ensure() — never
   * directly by consumers (the public entry stays floatingBtn.show()).
   *
   * B3: consumes pendingEngineStateOverride (set by show() immediately
   * before rebuild(); synchronous single-thread handoff — an eager rebuild
   * can never observe a stale override).
   */
  function createFloatingBtnHost() {
    const engineStateOverride = pendingEngineStateOverride;
    pendingEngineStateOverride = null;

    // Rebuild cleanup (C1): detach the previous instance's viewport listener
    // and reveal timer before building the next one. The public show() path
    // does this via hide(); eager rebuilds (popstate/observer/pageshow) go
    // straight to create(), so the same cleanup lives here — otherwise every
    // SPA rebuild would leak a zombie resize listener.
    if (detachViewportListeners) {
      detachViewportListeners();
      detachViewportListeners = null;
    }
    if (shortcutRevealTimer) {
      clearTimeout(shortcutRevealTimer);
      shortcutRevealTimer = null;
    }

    divElement = document.createElement("div");
    divElement.id = "dualtran-floating-btn-host";
    divElement.style = "all: initial";
    divElement.classList.add("notranslate");

    // Use open shadow root: maintains style isolation while providing stable read-only access for automation testing and debugging.
    const shadowRoot = divElement.attachShadow({
      mode: "open",
    });
  shadowRoot.innerHTML = htmlMobile;

    document.body.appendChild(divElement);

    // Localize the button
    chrome.i18n.translateDocument(shadowRoot);



    /**
     * Enable dark mode
     */
    function enableDarkMode() {
      // TODO
    }

    /**
     * Disable dark mode
     */
    function disableDarkMode() {
      // TODO
    }

    // Enable/disable dark mode based on config
    switch (twpConfig.get("darkMode")) {
      case "auto":
        if (matchMedia("(prefers-color-scheme: dark)").matches) {
          enableDarkMode();
        } else {
          disableDarkMode();
        }
        break;
      case "yes":
        enableDarkMode();
        break;
      case "no":
        disableDarkMode();
        break;
      default:
        break;
    }

    getElemById = shadowRoot.getElementById.bind(shadowRoot);

    const layerEl = getElemById("floatingBtnLayer");
    const containerEl = getElemById("floatingBtnContainer");
    const resizeHandleEl = getElemById("resizeHandle");
    const dragHandleEl = getElemById("dragHandle");
    const btnGoogleEl = getElemById("btnGoogle");
    const btnAiEl = getElemById("btnAi");
    const btnOriginalEl = getElemById("btnOriginal");
    const btnOptionsShortcutEl = getElemById("btnOptionsShortcut");
    lastViewportWidth = window.innerWidth;

    let currentFloatingBtnWidth = twpConfig.get("floatingBtnWidth");
    // Three-state model state (Q28 behavior table)
    // On re-show (SPA navigation rebuild), initialize from pageTranslator's
    // live state instead of hardcoding "original". pageTranslator's state
    // survives SPA navigation (same page context) while this module's closure
    // state does not, so without this the rebuilt button group would show
    // "Original" highlighted on a page that is actually translated (bug:
    // GitHub Turbo back-nav leaves Google translation on page but highlights
    // Original button).
    // A3: initialization is a pure function (resolveInitialUiState) so the
    // event-absence path is unit-testable; show() only queries + renders.
    // B3: engineStateOverride lets tests inject state directly (no getState
    // mock needed) to verify the rebuild-initialization contract.
    // L1 (M3): UI decision state (highlight/displayMode/intervention/
    // inFlight) lives in uiStateStore — this closure is a pure renderer.
    // resetForRebuild() derives initial UI state from the engine mirrors
    // (which are also owned by the store, fed by pageTranslator events —
    // see pageTranslatorBridge below).
    const engineState =
      engineStateOverride ||
      (pageTranslator.getState
        ? pageTranslator.getState()
        : {
            pageLanguageState: "original",
            pageRenderState: "idle",
            aiRenderState: "idle",
            aiModeActive: true,
          });
    // Seed the store's engine mirrors once at startup so resetForRebuild
    // (and the render path) reads from the same source everywhere.
    setState(engineState, "show()");
    resetForRebuild();

    let suppressNextClick = false;
    // NOTE: no closure state (highlight/displayMode/intervention/inFlight)
    // — all UI decision state lives in uiStateStore (L1/M3). Renders read
    // getState() below.

    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    function setShortcutVisible(visible) {
      btnOptionsShortcutEl.classList.toggle("dualtran-visible", !!visible);
      btnOptionsShortcutEl.style.opacity = visible ? "1" : "0";
      btnOptionsShortcutEl.style.visibility = visible ? "visible" : "hidden";
      btnOptionsShortcutEl.style.pointerEvents = visible ? "auto" : "none";
      btnOptionsShortcutEl.style.transform = visible
        ? "translateY(0) scale(1)"
        : (layerEl.classList.contains("dualtran-options-shortcut-below")
          ? "translateY(-4px) scale(0.96)"
          : "translateY(4px) scale(0.96)");
      
      if (layerEl.classList.contains("dualtran-options-shortcut-below")) {
          btnOptionsShortcutEl.style.top = "auto";
          btnOptionsShortcutEl.style.bottom = "0px";
      } else {
          btnOptionsShortcutEl.style.top = "0px";
          btnOptionsShortcutEl.style.bottom = "auto";
      }
    }

    function revealShortcutBriefly() {
      if (shortcutRevealTimer) {
        clearTimeout(shortcutRevealTimer);
        shortcutRevealTimer = null;
      }
      setShortcutVisible(true);
      shortcutRevealTimer = setTimeout(() => {
        if (!layerEl.matches(':hover')) {
          setShortcutVisible(false);
        }
      }, 2000);
    }

    function getMaxFloatingBtnWidth() {
      return Math.max(MIN_FLOATING_BTN_WIDTH, window.innerWidth - 12);
    }

    // The POSITIONED element is the LAYER, so its box is the container PLUS the
    // shortcut strip (#80). Every viewport budget must use this box — budgeting
    // the container alone let the layer bottom sit SHORTCUT_STRIP_SIZE past the
    // viewport edge (bottom clamp, drag, and resize paths alike). Single helper
    // so the clamp and the drag can never drift apart again.
    function getLayerBoxSize() {
      const rect = layerEl.getBoundingClientRect();
      const w = containerEl.offsetWidth || rect.width || 92;
      const h = containerEl.offsetHeight || rect.height || 90;
      return { w, h: h + SHORTCUT_STRIP_SIZE };
    }

    function updateShortcutPlacement() {
      const rect = containerEl.getBoundingClientRect();
      layerEl.classList.toggle("dualtran-options-shortcut-below", rect.top < 64);
      setShortcutVisible(btnOptionsShortcutEl.style.visibility === "visible");
    }

    function persistFloatingBtnWidth(width) {
      try {
        twpConfig.set("floatingBtnWidth", width);
      } catch (e) {
        console.warn("save floating button width failed", e);
      }
    }

    function applyFloatingBtnWidth(nextWidth, saveAfterChange = false) {
      const normalizedWidth = clamp(
        typeof nextWidth === "number" ? nextWidth : 92,
        MIN_FLOATING_BTN_WIDTH,
        getMaxFloatingBtnWidth()
      );
      currentFloatingBtnWidth = normalizedWidth;
      containerEl.style.width = normalizedWidth + "px";
      updateShortcutPlacement();
      updateButtons();
      if (saveAfterChange) {
        persistFloatingBtnWidth(normalizedWidth);
      }
      return normalizedWidth;
    }

    function clampContainerToViewport(saveAfterClamp = false) {
      if (layerEl.style.bottom || layerEl.style.right) {
        updateShortcutPlacement();
        lastViewportWidth = window.innerWidth;
        return;
      }

      const rect = layerEl.getBoundingClientRect();
      const { w: width, h: height } = getLayerBoxSize();
      const previousMaxLeft = Math.max(0, lastViewportWidth - width);
      const maxLeft = Math.max(0, window.innerWidth - width);
      const maxTop = Math.max(0, window.innerHeight - height);

      const currentLeft = parseFloat(layerEl.style.left || String(rect.left || 0)) || 0;
      const currentTop = parseFloat(layerEl.style.top || String(rect.top || 0)) || 0;
      const wasPinnedToRight = Math.abs(currentLeft - previousMaxLeft) <= 1;
      const nextLeft = wasPinnedToRight ? maxLeft : clamp(currentLeft, 0, maxLeft);
      const nextTop = clamp(currentTop, 0, maxTop);

      layerEl.style.left = nextLeft + "px";
      layerEl.style.top = nextTop + "px";
      lastViewportWidth = window.innerWidth;
      updateShortcutPlacement();

      if (!saveAfterClamp) {
        return;
      }
      try {
        twpConfig.set("floatingBtnPosition", { left: nextLeft, top: nextTop });
      } catch (e) {
        console.warn("save floating button position failed", e);
      }
    }

    const handleViewportChange = () => {
      applyFloatingBtnWidth(currentFloatingBtnWidth, false);
      clampContainerToViewport(true);
    };
    window.addEventListener("resize", handleViewportChange, { passive: true });
    detachViewportListeners = () => {
      window.removeEventListener("resize", handleViewportChange);
    };

    dragHandleEl.style.touchAction = "none";
    dragHandleEl.draggable = false;
    resizeHandleEl.style.touchAction = "none";
    btnGoogleEl.title = getFloatingButtonGoogleTooltipText();
    btnGoogleEl.setAttribute("aria-label", btnGoogleEl.title);
    btnAiEl.title = getFloatingButtonAiTooltipText();
    btnAiEl.setAttribute("aria-label", btnAiEl.title);
    btnOriginalEl.title = getFloatingButtonOriginalTooltipText();
    btnOriginalEl.setAttribute("aria-label", btnOriginalEl.title);
    btnOptionsShortcutEl.title = getFloatingButtonMoreOptionsText();
    btnOptionsShortcutEl.setAttribute("aria-label", btnOptionsShortcutEl.title);

    layerEl.addEventListener("mouseenter", () => {
      if (shortcutRevealTimer) {
        clearTimeout(shortcutRevealTimer);
        shortcutRevealTimer = null;
      }
      setShortcutVisible(true);
    }, { passive: true });
    layerEl.addEventListener("mouseleave", () => setShortcutVisible(false), { passive: true });
    layerEl.addEventListener("focusin", () => setShortcutVisible(true));
    layerEl.addEventListener("focusout", (e) => {
      // If focus is leaving the layer, hide the shortcut
      if (!layerEl.contains(e.relatedTarget)) {
        setShortcutVisible(false);
      }
    });

    btnOptionsShortcutEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      setShortcutVisible(true);
      chrome.runtime?.sendMessage?.({
        action: "openOptionsPage",
        hash: "#translations",
      });
    });

    // Three-state highlight rendering (Q13/Q20 visual spec)
    // Declared ABOVE the restore block on purpose: restoring saved state calls
    // applyFloatingBtnWidth() → updateButtons(), which reads this table. When
    // it lived below the restore block it was still uninitialized at restore
    // time → the read threw → the exception was swallowed by the restore catch
    // → the clamp call after it was skipped → saved off-screen positions kept
    // the button group invisible until the next resize (issue #78).
    const BUTTON_STYLES = {
      original: {
        active: { color: "#ffffff", background: "#374151", borderColor: "#374151" },
        inactive: { color: "#6b7280", background: "#f3f4f6", borderColor: "#d1d5db" },
        label: "Original",
        compactLabel: "O",
      },
      google: {
        active: { color: "#ffffff", background: "#1d4ed8", borderColor: "#1d4ed8" },
        inactive: { color: "#1d4ed8", background: "#eff6ff", borderColor: "#bfdbfe" },
        label: "Google",
        compactLabel: "G",
      },
      ai: {
        active: { color: "#ffffff", background: "#7c3aed", borderColor: "#7c3aed" },
        inactive: { color: "#7c3aed", background: "#f5f3ff", borderColor: "#ddd6fe" },
        label: "AI",
        compactLabel: "A",
      },
    };

    try {
      const savedPos = twpConfig.get("floatingBtnPosition");
      if (savedPos && typeof savedPos.left === "number" && typeof savedPos.top === "number") {
        layerEl.style.bottom = "";
        layerEl.style.right = "";
        layerEl.style.transform = "";
        layerEl.style.left = savedPos.left + "px";
        layerEl.style.top = savedPos.top + "px";
      }
      applyFloatingBtnWidth(currentFloatingBtnWidth, false);
    } catch (e) {
      console.warn("restore floating button state failed", e);
    }

    // Clamp as an INDEPENDENT step: it is the guarantee that the button group
    // is visible, so it must still run when the restore above fails. Sharing
    // one try/catch previously let a swallowed restore error skip the clamp,
    // leaving a saved off-screen position invisible until the next resize
    // (issue #78). Do not merge this back into the block above.
    try {
      clampContainerToViewport(false);
      revealShortcutBriefly();
    } catch (e) {
      console.warn("clamp floating button to viewport failed", e);
    }

    // Enable drag to reposition, save on release
    (function enableDragging() {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      let pointerMovedBeyondThreshold = false;

      const dragThresholdPx = 3;

      function toTopLeftIfNeeded() {
        if (layerEl.style.bottom || layerEl.style.right || layerEl.style.transform) {
          const rect = layerEl.getBoundingClientRect();
          layerEl.style.bottom = "";
          layerEl.style.right = "";
          layerEl.style.transform = "";
          layerEl.style.top = rect.top + "px";
          layerEl.style.left = rect.left + "px";
        }
      }

      function onPointerDown(clientX, clientY) {
        toTopLeftIfNeeded();
        dragging = true;
        startX = clientX;
        startY = clientY;
        startLeft = parseFloat(layerEl.style.left || "0") || 0;
        startTop = parseFloat(layerEl.style.top || "0") || 0;
        pointerMovedBeyondThreshold = false;
        
        dragHandleEl.style.cursor = "grabbing";
        window.addEventListener("mousemove", onMouseMove, { passive: false });
        window.addEventListener("mouseup", onMouseUp, { passive: true });
        window.addEventListener("touchmove", onTouchMove, { passive: false });
        window.addEventListener("touchend", onTouchEnd, { passive: true });
      }

      function onMouseDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        onPointerDown(e.clientX, e.clientY);
      }

      function onTouchStart(e) {
        if (!e.touches || e.touches.length === 0) return;
        const t = e.touches[0];
        e.preventDefault();
        onPointerDown(t.clientX, t.clientY);
      }

      function onPointerMove(clientX, clientY) {
        if (!dragging) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (!pointerMovedBeyondThreshold) {
          pointerMovedBeyondThreshold =
            Math.abs(dx) > dragThresholdPx || Math.abs(dy) > dragThresholdPx;
          if (!pointerMovedBeyondThreshold) {
            return;
          }
        }
        const { w, h } = getLayerBoxSize();
        const maxLeft = Math.max(0, window.innerWidth - w);
        const maxTop = Math.max(0, window.innerHeight - h);
        const newLeft = clamp(startLeft + dx, 0, maxLeft);
        const newTop = clamp(startTop + dy, 0, maxTop);
        layerEl.style.left = newLeft + "px";
        layerEl.style.top = newTop + "px";
        updateShortcutPlacement();
      }

      function onMouseMove(e) {
        e.preventDefault();
        onPointerMove(e.clientX, e.clientY);
      }

      function onTouchMove(e) {
        if (!e.touches || e.touches.length === 0) return;
        const t = e.touches[0];
        e.preventDefault();
        onPointerMove(t.clientX, t.clientY);
      }

      function savePosition() {
        clampContainerToViewport(false);
        const left = parseFloat(layerEl.style.left || "0") || 0;
        const top = parseFloat(layerEl.style.top || "0") || 0;
        try {
          twpConfig.set("floatingBtnPosition", { left, top });
        } catch (e) {
          console.warn("save floating button position failed", e);
        }
      }

      function onPointerUp() {
        if (!dragging) return;
        dragging = false;
        dragHandleEl.style.cursor = "grab";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onTouchEnd);
        if (pointerMovedBeyondThreshold) {
          savePosition();
          suppressNextClick = true;
          setTimeout(() => {
            suppressNextClick = false;
          }, 0);
        }
        pointerMovedBeyondThreshold = false;
      }

      function onMouseUp() { onPointerUp(); }
      function onTouchEnd() { onPointerUp(); }

      dragHandleEl.addEventListener("mousedown", onMouseDown, { passive: false });
      dragHandleEl.addEventListener("touchstart", onTouchStart, { passive: false });

      (function enableWidthResizing() {
        let resizing = false;
        let resizeStartX = 0;
        let resizeStartWidth = 0;
        let resizeStartLeft = 0;

        function onResizePointerDown(clientX) {
          toTopLeftIfNeeded();
          resizing = true;
          resizeStartX = clientX;
          resizeStartWidth = containerEl.offsetWidth || currentFloatingBtnWidth || 92;
          resizeStartLeft = parseFloat(layerEl.style.left || "0") || 0;
          window.addEventListener("mousemove", onResizeMouseMove, { passive: false });
          window.addEventListener("mouseup", onResizePointerUp, { passive: true });
          window.addEventListener("touchmove", onResizeTouchMove, { passive: false });
          window.addEventListener("touchend", onResizePointerUp, { passive: true });
        }

        function onResizeMouseDown(e) {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          onResizePointerDown(e.clientX);
        }

        function onResizeTouchStart(e) {
          if (!e.touches || e.touches.length === 0) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          onResizePointerDown(e.touches[0].clientX);
        }

        function onResizePointerMove(clientX) {
          if (!resizing) return;
          const deltaX = clientX - resizeStartX;
          const nextWidth = applyFloatingBtnWidth(resizeStartWidth - deltaX, false);
          const rightEdge = resizeStartLeft + resizeStartWidth;
          const maxLeft = Math.max(0, window.innerWidth - nextWidth);
          const nextLeft = clamp(rightEdge - nextWidth, 0, maxLeft);
          layerEl.style.left = nextLeft + "px";
          layerEl.style.top = (parseFloat(layerEl.style.top || "0") || 0) + "px";
          updateShortcutPlacement();
        }

        function onResizeMouseMove(e) {
          e.preventDefault();
          onResizePointerMove(e.clientX);
        }

        function onResizeTouchMove(e) {
          if (!e.touches || e.touches.length === 0) return;
          e.preventDefault();
          onResizePointerMove(e.touches[0].clientX);
        }

        function onResizePointerUp() {
          if (!resizing) return;
          resizing = false;
          window.removeEventListener("mousemove", onResizeMouseMove);
          window.removeEventListener("mouseup", onResizePointerUp);
          window.removeEventListener("touchmove", onResizeTouchMove);
          window.removeEventListener("touchend", onResizePointerUp);
          clampContainerToViewport(false);
          persistFloatingBtnWidth(currentFloatingBtnWidth);
          try {
            twpConfig.set("floatingBtnPosition", {
              left: parseFloat(layerEl.style.left || "0") || 0,
              top: parseFloat(layerEl.style.top || "0") || 0,
            });
          } catch (e) {
            console.warn("save floating button position failed", e);
          }
          suppressNextClick = true;
          setTimeout(() => {
            suppressNextClick = false;
          }, 0);
        }

        resizeHandleEl.addEventListener("mousedown", onResizeMouseDown, { passive: false });
        resizeHandleEl.addEventListener("touchstart", onResizeTouchStart, { passive: false });
      })();
    })();

    function translatePage() {
      pageTranslator.translatePage();
    }

    // ── Three-state click handling (Q28 behavior table) ──────────────

    function setHighlight(next) {
      // M3: highlight lives in uiStateStore; watch the change to re-render
      const patch = setState({ highlight: next }, "setHighlight");
      if (patch.highlight !== undefined) updateButtons();
    }

    function buildUiState() {
      const s = getState();
      return {
        pageLanguageState: s.pageLanguageState,
        displayMode: s.displayMode,
        highlight: s.highlight,
        intervention: s.intervention,
        googleInFlight: s.googleInFlight,
        aiInFlight: s.aiInFlight,
        hasGoogleFailedBlocks: s.pageRenderState === "error",
        hasAiFailedBlocks: s.aiRenderState === "error",
        aiResultAvailable: pageTranslator.hasAiResults ? pageTranslator.hasAiResults() : false,
        hasApiKey: true, // translatePageAi returns false when no key — handled below
        whereToDisplayTranslatedText: twpConfig.get("whereToDisplayTranslatedText"),
      };
    }

    function handleButtonClick(buttonId) {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      console.log(`${buttonId} button clicked`);
      setState({ intervention: true }, "handleButtonClick");
      setHighlight(buttonId);
      // Q5: engine needs to know whether the user is in AI mode when an AI
      // response arrives (decides display switch vs discard).
      pageTranslator.setAiModeActive?.(buttonId === "ai");

      const action = resolveFloatingBtnClick(buildUiState(), buttonId);
      switch (action.type) {
        case "noop":
          break;
        case "translatePage":
          setState({ googleInFlight: true }, "handleButtonClick");
          translatePage();
          break;
        case "translatePageAi": {
          const started = pageTranslator.translatePageAi();
          if (started === false) {
            // No API key: prompt shown by translatePageAi; AI stays highlighted (Q4)
            setState({ aiInFlight: false }, "handleButtonClick");
          } else {
            setState({ aiInFlight: true }, "handleButtonClick");
          }
          break;
        }
        case "restorePage":
          setState({ googleInFlight: false, aiInFlight: false, displayMode: "original" }, "handleButtonClick");
          pageTranslator.restorePage();
          break;
        case "showGoogleOnly":
          pageTranslator.stopAiAutoTranslate();
          pageTranslator.showGoogleOnly();
          setState({ displayMode: "google" }, "handleButtonClick");
          break;
        case "showAiOnly":
          pageTranslator.showAiOnly();
          setState({ displayMode: "ai" }, "handleButtonClick");
          break;
        case "retryAi":
          setState({ aiInFlight: true }, "handleButtonClick");
          pageTranslator.translatePageAi();
          break;
        case "promptConfig":
          pageTranslator.translatePageAi(); // shows config prompt, returns false
          break;
        default:
          break;
      }
    }

    btnOriginalEl.addEventListener("click", (e) => {
      e.preventDefault();
      handleButtonClick("original");
    });

    btnGoogleEl.addEventListener("click", (e) => {
      e.preventDefault();
      handleButtonClick("google");
    });

    btnAiEl.addEventListener("click", (e) => {
      e.preventDefault();
      handleButtonClick("ai");
    });

    console.log("updating buttons");

    // NOTE: BUTTON_STYLES is declared ABOVE, just before the restore block —
    // updateButtons() is reachable from the restore path at load time, so the
    // table must be initialized before that block runs (issue #78).

    function updateButtons() {
      const { highlight } = getState();
      console.log("updateButtons() called, highlight =", highlight);

      const isCompact = btnGoogleEl.clientWidth < 58;
      const buttons = [
        { el: btnOriginalEl, key: "original" },
        { el: btnGoogleEl, key: "google" },
        { el: btnAiEl, key: "ai" },
      ];
      buttons.forEach(({ el, key }) => {
        const spec = BUTTON_STYLES[key];
        const active = highlight === key;
        el.textContent = isCompact ? spec.compactLabel : spec.label;
        const style = active ? spec.active : spec.inactive;
        el.style.color = style.color;
        el.style.background = style.background;
        el.style.borderColor = style.borderColor;
        el.classList.toggle("dualtran-floating-btn-active", active);
      });
    }

    updateButtons();

    // Watch page translation state
    // Guard: translatePage() internally calls restorePage(), which fires
    // pageLanguageState observers unconditionally — including "original" when
    // the page was already original. Ignore no-change events, otherwise a
    // click on AI/Google (which triggers translatePage → restorePage) would
    // reset the highlight right after the click set it.
    // Initialize from live state: after SPA rebuild the page may already be
    // "translated" — starting the guard at "original" would let the next
    // "original" event through even though nothing changed (same stale-state
    // bug as the highlight init above).
    // M3: engine mirrors live in uiStateStore; callbacks feed the store and
    // the watchdog arbitrates engine-driven UI state automatically.
    let lastPageLanguageState = engineState.pageLanguageState;
    pageTranslator.onPageLanguageStateChange((_pageLanguageState) => {
      if (_pageLanguageState === lastPageLanguageState) return;
      lastPageLanguageState = _pageLanguageState;
      setState({ pageLanguageState: _pageLanguageState }, "onPageLanguageStateChange");
      const s = getState();
      if (s.pageLanguageState === "original") {
        // Page restored (button click or external action): reset to Original
        // highlight + clear intervention (Q12/Q19/Q24). In-flight flags reset
        // here too — restorePage cancels in-flight requests.
        setState(
          { googleInFlight: false, aiInFlight: false, intervention: false, displayMode: "original" },
          "onPageLanguageStateChange"
        );
        pageTranslator.setAiModeActive?.(false);
        setHighlight("original");
      } else if (!s.intervention) {
        // Auto-translate without user intervention → content-driven highlight (Q6/Q16)
        setState({ displayMode: "google" }, "onPageLanguageStateChange");
        setHighlight("google");
      }
      updateButtons();
    });

    // Google render state → in-flight tracking + failure detection (Q14)
    pageTranslator.onPageRenderStateChange((state) => {
      setState({ pageRenderState: state }, "onPageRenderStateChange");
      if (state === "loading") {
        setState({ googleInFlight: true }, "onPageRenderStateChange");
      } else if (state === "idle" || state === "success" || state === "error") {
        setState({ googleInFlight: false }, "onPageRenderStateChange");
        const s = getState();
        if (state === "success" && s.displayMode !== "ai") {
          // Google translation completed and is displayed. Q2: when AI is the
          // user's selection, Google still shows first (intermediate state).
          // If AI is already displayed, don't overwrite it.
          setState({ displayMode: "google" }, "onPageRenderStateChange");
        }
      }
      updateButtons();
    });

    // AI render state → in-flight tracking + failure detection (Q3/Q8)
    pageTranslator.onAiRenderStateChange((state) => {
      setState({ aiRenderState: state }, "onAiRenderStateChange");
      const s = getState();
      if (state === "loading") {
        setState({ aiInFlight: true }, "onAiRenderStateChange");
      } else if (state === "idle" || state === "success" || state === "error") {
        setState({ aiInFlight: false }, "onAiRenderStateChange");
        if (state === "success" && s.highlight === "ai") {
          // AI completed and user still selected AI → AI display takes over (Q2).
          // If the user switched away (highlight !== "ai"), the result is
          // discarded (Q5) — displayMode stays as-is.
          setState({ displayMode: "ai" }, "onAiRenderStateChange");
        }
      }
      updateButtons();
    });
  }

  console.log("will show floating button, 88888888111111")
  floatingBtn.show();

  // NOTE (C1/M5): the popstate (200ms) / MutationObserver (300ms debounce on
  // getObserverRoot()) / pageshow(persisted) recovery subscriptions moved to
  // hostLifecycle.js — installed once by the manager for every registered
  // `recovery: "eager"` host, timing preserved verbatim there. This module
  // only declares policy (show/hide) and provides the create() callback.
  });
}

export default floatingBtn
