/**
 * Hover to show original text on translated pages
 *
 * Plan 38: the bubble fires only when "Where to display the translated text"
 * is replaceOriginal — in newLine mode the original text is already visible,
 * so the hover bubble is redundant. The gate is a single predicate all
 * registration guards inherit through `showOriginal.isEnabled`.
 *
 * The skin is the shared panel skin: translateSelected.css + the
 * panelShared dark/light constants — the same single source the hover
 * translation panel and the selection panel consume (plan 37 discipline).
 */
"use strict";

console.log("showOriginal.js is running")

import twpConfig from "../lib/config.js";
import platformInfo from "../lib/platformInfo.js";
import {
  PANEL_DARK_MODE_CSS_DARK,
  PANEL_DARK_MODE_CSS_LIGHT,
} from "./panelShared.js";

/**
 * Hover to show original text on translated pages
 */
const showOriginal = {};

twpConfig.onReady(function () {
  // On mobile, all showOriginal (hover to show original) operations are disabled
  if (platformInfo.isMobile.any) {
    showOriginal.enable = () => {};
    showOriginal.disable = () => {};
    showOriginal.add = () => {};
    showOriginal.removeAll = () => {};
    return;
  }

  const enabledObservers = [];
  showOriginal.enabledObserverSubscribe = function (callback) {
    enabledObservers.push(callback);
  };

  let styleTextContent = "";
  fetch(chrome.runtime.getURL("/contentScript/css/translateSelected.css"))
    .then((response) => response.text())
    .then((response) => (styleTextContent = response))
    .catch((e) => console.error(e));

  // Plan 38 gate: feature is on only when the hover toggle is "yes" AND the
  // display mode is replaceOriginal. Any change of either setting recomputes
  // the predicate, rebuilds the host when it turns on, and notifies observers
  // (already-translated pages re-translate once so the bubble is immediately
  // available / immediately gone).
  let showOriginalTextWhenHovering = twpConfig.get(
    "showOriginalTextWhenHovering"
  );
  let whereToDisplayTranslatedText = twpConfig.get(
    "whereToDisplayTranslatedText"
  );
  function computeIsEnabled() {
    return (
      showOriginalTextWhenHovering === "yes" &&
      whereToDisplayTranslatedText === "replaceOriginal"
    );
  }
  showOriginal.isEnabled = computeIsEnabled();
  twpConfig.onChanged(function (name, newValue) {
    if (name === "showOriginalTextWhenHovering") {
      showOriginalTextWhenHovering = newValue;
    } else if (name === "whereToDisplayTranslatedText") {
      whereToDisplayTranslatedText = newValue;
    } else {
      return;
    }
    showOriginal.isEnabled = computeIsEnabled();
    showOriginal.enable(true);
    enabledObservers.forEach((callback) => {
      callback();
    });
  });

  let originalTextIsShowing = false;
  let divElement;
  let shadowRoot;
  let currentNodeOverMouse;
  let timeoutHandler;

  let nodesToShowOriginal = [];

  const mousePos = {
    x: 0,
    y: 0,
  };

  function onMouseMove(e) {
    mousePos.x = e.clientX;
    mousePos.y = e.clientY;
  }

  function onMouseDown(e) {
    if (!divElement) return;
    if (e.target === divElement) return;
    hideOriginalText();
  }

  function showOriginalText(node) {
    hideOriginalText();
    if (!divElement) return;
    if (window.isTranslatingSelected) return;

    const nodeInf = nodesToShowOriginal.find(
      (nodeInf) => nodeInf.node === node
    );
    if (nodeInf) {
      const eOrigText = shadowRoot.getElementById("eOrigText");
      eOrigText.textContent = nodeInf.original;
      document.body.appendChild(divElement);
      originalTextIsShowing = true;

      const eDivResult = shadowRoot.getElementById("eDivResult");
      eDivResult.style.display = "block";

      const height = eDivResult.offsetHeight;
      let top = mousePos.y + 10;
      top = Math.max(0, top);
      top = Math.min(window.innerHeight - height, top);

      const width = eDivResult.offsetWidth;
      let left = parseInt(mousePos.x /*- (width / 2) */);
      left = Math.max(0, left);
      left = Math.min(window.innerWidth - width, left);

      eDivResult.style.top = top + "px";
      eDivResult.style.left = left + "px";
    }
  }

  function hideOriginalText() {
    if (divElement) {
      divElement.remove();
      originalTextIsShowing = false;
    }
    clearTimeout(timeoutHandler);
  }

  function isShowingOriginalText() {
    return originalTextIsShowing;
  }

  function onMouseEnter(e) {
    if (!divElement) return;
    if (currentNodeOverMouse && e.target === currentNodeOverMouse) return;
    currentNodeOverMouse = e.target;
    if (timeoutHandler) clearTimeout(timeoutHandler);
    timeoutHandler = setTimeout(showOriginalText, 1500, currentNodeOverMouse);
  }

  function onMouseOut(e) {
    if (!divElement) return;
    if (!isShowingOriginalText()) return;

    if (e.target === currentNodeOverMouse && e.relatedTarget === divElement)
      return;
    if (e.target === divElement && e.relatedTarget === currentNodeOverMouse)
      return;

    hideOriginalText();
  }

  /**
   * Register a node so that hovering it pops up the original text.
   * @param {Node} node - node to attach mouseenter/mouseout listeners to
   * @param {string} [originalText] - original (source-language) text to show;
   *   defaults to the node's own textContent (replaceOriginal mode, where the
   *   source node itself is registered)
   */
  showOriginal.add = function (node, originalText) {
    if (platformInfo.isMobile.any) return;

    if (node && nodesToShowOriginal.indexOf(node) === -1) {
      nodesToShowOriginal.push({
        node: node,
        original:
          typeof originalText === "string" ? originalText : node.textContent,
      });
      node.addEventListener("mouseenter", onMouseEnter);
      node.addEventListener("mouseout", onMouseOut);
    }
  };

  showOriginal.removeAll = function () {
    nodesToShowOriginal.forEach((nodeInf) => {
      nodeInf.node.removeEventListener("mouseenter", onMouseEnter);
      nodeInf.node.removeEventListener("mouseout", onMouseOut);
    });
    nodesToShowOriginal = [];
  };

  showOriginal.enable = function (dontDeleteNodesToShowOriginal = false) {
    showOriginal.disable(dontDeleteNodesToShowOriginal);

    if (platformInfo.isMobile.any) return;
    // Plan 38 gate: single predicate — replaceOriginal-only.
    if (!showOriginal.isEnabled) return;
    if (divElement) return;

    // Reset mouse hover node reference to avoid skipping mouseenter on the same node after re-enabling
    currentNodeOverMouse = null;

    divElement = document.createElement("div");
    divElement.style = "all: initial";
    divElement.classList.add("notranslate");

    shadowRoot = divElement.attachShadow({
      mode: "closed",
    });
    // Plan 38: same skin as the hover translation box / selection panel —
    // shared CSS file, same id vocabulary (#eDivResult / #eOrigText), no
    // title bar and no buttons (the bubble is a pure reading snapshot).
    shadowRoot.innerHTML = `
            <link rel="stylesheet" href="${chrome.runtime.getURL(
              "/contentScript/css/translateSelected.css"
            )}">
            <div id="eDivResult" style="display: none">
              <div id="eOrigText" dir="auto"></div>
            </div>
        `;

    {
      const style = document.createElement("style");
      style.textContent = styleTextContent;
      shadowRoot.insertBefore(style, shadowRoot.getElementById("eDivResult"));
    }

    {
      // Dark/light scheme: identical contract to the hover panel and the
      // selection panel (backdropFilterElement + shared constants).
      const el = document.createElement("style");
      el.setAttribute("id", "backdropFilterElement");
      el.setAttribute("rel", "stylesheet");
      let darkMode = false;
      switch (twpConfig.get("darkMode")) {
        case "auto":
          if (matchMedia("(prefers-color-scheme: dark)").matches)
            darkMode = true;
          break;
        case "yes":
          darkMode = true;
          break;
      }
      el.textContent = darkMode ? PANEL_DARK_MODE_CSS_DARK : PANEL_DARK_MODE_CSS_LIGHT;
      shadowRoot.appendChild(el);
    }

    divElement.addEventListener("mouseout", onMouseOut);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousedown", onMouseDown);

    document.addEventListener("blur", hideOriginalText);
    document.addEventListener("visibilitychange", hideOriginalText);
  };

  showOriginal.disable = function (dontDeleteNodesToShowOriginal = false) {
    if (divElement) {
      hideOriginalText();
      divElement.remove();
      divElement = null;
      shadowRoot = null;
    }

    if (!dontDeleteNodesToShowOriginal) {
      showOriginal.removeAll();
    }

    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mousedown", onMouseDown);

    document.removeEventListener("blur", hideOriginalText);
    document.removeEventListener("visibilitychange", hideOriginalText);
  };
});

export default showOriginal;
