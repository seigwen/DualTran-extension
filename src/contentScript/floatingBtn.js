
/**
 * Floating button
 */

console.log("floatingBtn.js is running")

import twpConfig from "../lib/config.js"
import { pageTranslator } from "./pageTranslator.js"
import {
  getFloatingButtonAiTooltipText,
  getFloatingButtonGoogleTooltipText,
  getFloatingButtonMoreOptionsText,
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
  let pageLanguageState = "original";
  let detachViewportListeners = null;
  let shortcutRevealTimer = null;
  let lastViewportWidth = window.innerWidth;
  const MIN_FLOATING_BTN_WIDTH = 48;

  /**
   * Hide floating button
   * @returns 
   */
  floatingBtn.hide = function () {
    if (!divElement) return;

    if (detachViewportListeners) {
      detachViewportListeners();
      detachViewportListeners = null;
    }

    if (shortcutRevealTimer) {
      clearTimeout(shortcutRevealTimer);
      shortcutRevealTimer = null;
    }

    divElement.remove();
    divElement = getElemById = null;
  };

  /**
   * Show floating button
   * @param {*} forceShow 
   * @returns 
   */
  floatingBtn.show = function (forceShow = false) {
    console.log("floatingBtn.show() is called")

    floatingBtn.hide();

    if (
      !forceShow && showFloatingBtn !== "yes"
    ){
      console.log("floatingBtn.show() going to return in short")
      return;
    }
    console.log("floatingBtn.show() is called 2222")

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
    const btnOptionsShortcutEl = getElemById("btnOptionsShortcut");
    lastViewportWidth = window.innerWidth;

    let googleRenderState = "idle";
    let aiRenderState = "idle";
    let currentFloatingBtnWidth = twpConfig.get("floatingBtnWidth");
    let suppressNextClick = false;

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
      updateButtons(googleRenderState, aiRenderState);
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
      const width = containerEl.offsetWidth || rect.width || 92;
      const height = containerEl.offsetHeight || rect.height || 90;
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
      clampContainerToViewport(false);
      revealShortcutBriefly();
    } catch (e) {
      console.warn("restore floating button state failed", e);
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

      function getElSize() {
        const w = containerEl.offsetWidth || 60;
        const h = containerEl.offsetHeight || 80;
        return { w, h };
      }

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
        const { w, h } = getElSize();
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

    btnGoogleEl.addEventListener("click", (e) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      console.log("Google translate button clicked");
      if (pageLanguageState === "original") {
        // Original state → Google-only translation
        googleRenderState = "loading";
        updateButtons(googleRenderState, aiRenderState);
        translatePage();
      } else {
        // Translated state
        if (aiRenderState === "success") {
          // AI has translated → switch to Google-only view (hide AI, show Google)
          pageTranslator.showGoogleOnly();
          aiRenderState = "idle";
          googleRenderState = "success";
          updateButtons(googleRenderState, aiRenderState);
          pageTranslator.stopAiAutoTranslate();
        } else {
          // AI not translated → restore original
          pageTranslator.restorePage();
        }
      }
    });

    btnAiEl.addEventListener("click", (e) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      console.log("AI translate button clicked");
      if (aiRenderState === "loading") {
        return;
      }
      if (aiRenderState === "success") {
        // Already AI-translated → restore original
        pageTranslator.restorePage();
      } else if (pageLanguageState === "original") {
        // Original state → Google+AI concurrent translation
        googleRenderState = "loading";
        aiRenderState = "loading";
        updateButtons(googleRenderState, aiRenderState);
        const started = pageTranslator.translatePageAi();
        if (started === false) {
          aiRenderState = "idle";
          googleRenderState = "idle";
          updateButtons(googleRenderState, aiRenderState);
        }
      } else if (googleRenderState === "success") {
        // Already has Google translation → add AI on top
        aiRenderState = "loading";
        updateButtons(googleRenderState, aiRenderState);
        const started = pageTranslator.translatePageAi();
        if (started === false) {
          aiRenderState = "idle";
          updateButtons(googleRenderState, aiRenderState);
        }
      } else {
        pageTranslator.restorePage();
      }
    });

    console.log("updating buttons");

    function updateButtons(googleState, aiState) {
      console.log("updateButtons() called with", googleState, aiState);

      const applyButtonState = (button, state, labels) => {
        const isCompact = button.clientWidth < labels.compactWidth;
        if (state === "loading") {
          if (button.clientWidth < labels.loadingMinWidth) {
            button.innerHTML = `<span class="dualtran-floating-btn-label"><span class="dualtran-floating-btn-spinner" aria-hidden="true"></span></span>`;
          } else {
            button.innerHTML = `<span class="dualtran-floating-btn-label"><span class="dualtran-floating-btn-spinner" aria-hidden="true"></span><span class="dualtran-floating-btn-text">${labels.loading}</span></span>`;
          }
          button.style.color = "#6b7280";
          button.style.background = "#f3f4f6";
          button.style.borderColor = "#d1d5db";
          return;
        }

        if (state === "success") {
          button.textContent = isCompact ? labels.compactIdle : labels.success;
          button.style.color = "#15803d";
          button.style.background = "#f0fdf4";
          button.style.borderColor = "#86efac";
          return;
        }

        if (state === "error") {
          button.textContent = isCompact ? labels.compactIdle : (labels.error || "AI ✗");
          button.style.color = "#991b1b";
          button.style.background = "#fef2f2";
          button.style.borderColor = "#fca5a5";
          return;
        }

        button.textContent = isCompact ? labels.compactIdle : labels.idle;
        button.style.color = labels.idleColor;
        button.style.background = labels.idleBackground;
        button.style.borderColor = labels.idleBorder;
      };

      applyButtonState(btnGoogleEl, googleState, {
        idle: "Google",
        compactIdle: "Go",
        loading: "Google…",
        success: "Google ✓",
        compactWidth: 58,
        loadingMinWidth: 74,
        idleColor: "#1d4ed8",
        idleBackground: "#eff6ff",
        idleBorder: "#bfdbfe",
      });

      applyButtonState(btnAiEl, aiState, {
        idle: "AI",
        compactIdle: "AI",
        loading: "AI…",
        success: "AI ✓",
        error: "AI ✗",
        compactWidth: 58,
        loadingMinWidth: 62,
        idleColor: "#7c3aed",
        idleBackground: "#f5f3ff",
        idleBorder: "#ddd6fe",
      });
    }

    updateButtons(googleRenderState, aiRenderState);

    // Watch page translation state
    pageTranslator.onPageLanguageStateChange((_pageLanguageState) => {
      pageLanguageState = _pageLanguageState;
      if (pageLanguageState === "original") {
        googleRenderState = "idle";
        aiRenderState = "idle";
        updateButtons(googleRenderState, aiRenderState);
      }
    });

    if (pageTranslator.onPageRenderStateChange) {
      pageTranslator.onPageRenderStateChange((state) => {
        googleRenderState = state;
        updateButtons(googleRenderState, aiRenderState);
      });
    }

    if (pageTranslator.onAiRenderStateChange) {
      pageTranslator.onAiRenderStateChange((state) => {
        aiRenderState = state;
        updateButtons(googleRenderState, aiRenderState);
      });
    }
  };

    console.log("will show floating button, 88888888111111")
    floatingBtn.show();

    // Listen for browser forward/back navigation (popstate), recreate floating button after SPA (e.g., GitHub Turbo) navigation
    // When Turbo/pjax replaces DOM, the floating button's host element is removed with the old body,
    // and the floating button is only created once on initial load, so it won't auto-rebuild.
    let floatingBtnPopstateTimer = null;
    window.addEventListener("popstate", () => {
      if (floatingBtnPopstateTimer) clearTimeout(floatingBtnPopstateTimer);
      floatingBtnPopstateTimer = setTimeout(() => {
        const host = document.getElementById("dualtran-floating-btn-host");
        if (!host || !document.body.contains(host)) {
          console.log("[floatingBtn] host missing after popstate, recreating");
          floatingBtn.show();
        }
      }, 200);
    });

    // Use MutationObserver to watch body DOM replacement, as a complement to popstate:
    // 1. SPA link navigation (non-back, pushState only) does not trigger popstate
    // 2. When SPA framework loads slowly, popstate's 200ms delay may not be enough
    // Observer detects host removal and auto-rebuilds, debounce 300ms to prevent loops.
    // Distinguish active hide() from passive DOM replacement: hide() sets
    // divElement to null, so Observer skips rebuild.
    let floatingBtnObserver = null;
    let floatingBtnObserverTimer = null;
    function setupFloatingBtnObserver() {
      if (floatingBtnObserver) floatingBtnObserver.disconnect();
      floatingBtnObserver = new MutationObserver(() => {
        if (floatingBtnObserverTimer) return; // debounce
        floatingBtnObserverTimer = setTimeout(() => {
          floatingBtnObserverTimer = null;
          // divElement is null means hide() already removed it, skip rebuild
          if (!divElement) return;
          const host = document.getElementById("dualtran-floating-btn-host");
          if (!host || !document.body.contains(host)) {
            console.log("[floatingBtn] host removed from DOM, recreating");
            floatingBtnObserver.disconnect();
            floatingBtn.show();
            setupFloatingBtnObserver();
          }
        }, 300);
      });
      floatingBtnObserver.observe(document.body, { childList: true });
    }
    setupFloatingBtnObserver();

    // Handle bfcache restore: bfcache preserves full DOM, normally no rebuild needed.
    // But when bfcache is unavailable (page evicted), browser fully reloads the page,
    // and content script re-injects — so this only handles edge cases
    // where DOM is partially replaced under bfcache.
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) {
        // bfcache restore: check if host still exists
        const host = document.getElementById("dualtran-floating-btn-host");
        if (!host || !document.body.contains(host)) {
          console.log("[floatingBtn] host missing after bfcache restore, recreating");
          floatingBtn.show();
        }
      }
    });
  });
}

export default floatingBtn
