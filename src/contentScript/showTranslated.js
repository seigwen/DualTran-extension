/**
 * Hover to show translated text on pages that were translated then restored to original
 *
 * Plan 37: the panel skin + state implementation are shared with the selection
 * panel (panelShared.js); only the trigger/lifecycle stay hover-specific.
 */

console.log("showTranslated.js is running")

import twpLang from "../lib/languages.js"
import twpConfig from "../lib/config.js"
import platformInfo from "../lib/platformInfo.js"
import { getFloatingButtonAiTooltipText, getFloatingButtonGoogleTooltipText } from "./i18n.js"
import { backgroundTranslateSingleText, pageTranslator, aiTranslateText } from "./pageTranslator.js"
import {
  PANEL_DARK_MODE_CSS_DARK,
  PANEL_DARK_MODE_CSS_LIGHT,
  PANEL_LOADING_CSS,
  applyPanelButtonPalette,
  applyPanelTranslatedColor,
  clearPanelTranslationLoadingState,
  createPanelAiProxy,
  setPanelTranslationLoadingState,
} from "./panelShared.js"
import { aiTranslateWord } from "./translateSelected.js"
import wordsCount from "../util/globalWordsCount.js"
import Toastify from 'toastify-js'

const TRANSLATION_TIMEOUT_MS = 10000; // Timeout duration (milliseconds)

// This object seems unused?????
var showTranslated = {};

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

Promise.all([twpConfig.onReady(), getTabHostName()]).then(function (_) {
  console.log("showTranslated.js promise.all is resolved")

  const tabHostName = _[1];
  // On mobile, all showOriginal operations (hover to show original) are disabled
  if (platformInfo.isMobile.any) return;

  let styleTextContent = "";
  fetch(chrome.runtime.getURL("/contentScript/css/translateSelected.css"))
    .then((response) => response.text())
    .then((response) => (styleTextContent = response))
    .catch((e) => console.error(e));

  let pageLanguageState = "original";
  let originalTabLanguage = "und";
  let currentTargetLanguages = twpConfig.get("targetLanguages");
  let currentTargetLanguage = twpConfig.get("targetLanguageTextTranslation");
  let currentTextTranslatorService =
    twpConfig.get("textTranslatorService") === "deepl"
      ? "google"
      : twpConfig.get("textTranslatorService");
  // Panel intent (plan 31 / #106 model): derived exactly like the selection
  // panel — anything but "google" reads as AI intent.
  let activeTextTranslatorService =
    currentTextTranslatorService === "google" ? "google" : "ai";
  let showTranslatedTextWhenHoveringThisSite =
    twpConfig.get("sitesToTranslateWhenHovering").indexOf(tabHostName) !== -1;
  let showTranslatedTextWhenHoveringThisLang = false;
  let translateTextOverMouseWhenPressTwice =
    twpConfig.get("translateTextOverMouseWhenPressTwice") === "yes";
  let fooCount = 0;

  // Watch config change events to update in-memory variables in real time
  twpConfig.onChanged(function (name, newValue) {
    switch (name) {
      // Translation service setting changed
      case "textTranslatorService":
        currentTextTranslatorService =
          newValue === "deepl" ? "google" : newValue;
        activeTextTranslatorService =
          currentTextTranslatorService === "google" ? "google" : "ai";
        if (typeof updateTranslatorButtonState === "function") {
          updateTranslatorButtonState(activeTextTranslatorService);
        }
        break;
      // Target language list setting changed
      case "targetLanguages":
        currentTargetLanguages = newValue;
        break;
      // Target language setting changed
      case "targetLanguageTextTranslation":
        currentTargetLanguage = newValue;
        break;
      // Mouse hover translation setting changed
      case "sitesToTranslateWhenHovering":
        showTranslatedTextWhenHoveringThisSite =
          newValue.indexOf(tabHostName) !== -1;
        updateEventListener();
        break;
      // 
      case "langsToTranslateWhenHovering":
        showTranslatedTextWhenHoveringThisLang =
          newValue.indexOf(originalTabLanguage) !== -1;
        updateEventListener();
        break;
      // Double-click translation setting changed
      case "translateTextOverMouseWhenPressTwice":
        translateTextOverMouseWhenPressTwice =
          twpConfig.get("translateTextOverMouseWhenPressTwice") === "yes";
        updateEventListener();
        break;
    }
  });

  const htmlTagsInlineText = [
    "#text",
    "a",
    "abbr",
    "acronym",
    "b",
    "bdo",
    "big",
    "cite",
    "dfn",
    "em",
    "i",
    "label",
    "q",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "u",
    "tt",
    "var",
  ];
  const htmlTagsInlineIgnore = ["br", "code", "kbd", "wbr"]; // and input if type is submit or button, and <pre> depending on settings
  const htmlTagsNoTranslate = ["title", "script", "style", "textarea", "svg"];

  if (twpConfig.get("translateTag_pre") !== "yes") {
    htmlTagsInlineIgnore.push("pre");
  }

  // Watch config change events to update in-memory variables in real time
  twpConfig.onChanged((name, newvalue) => {
    switch (name) {
      // Whether to translate <pre> elements
      case "translateTag_pre":
        const index = htmlTagsInlineIgnore.indexOf("pre");
        if (index !== -1) {
          htmlTagsInlineIgnore.splice(index, 1);
        }
        if (newvalue !== "yes") {
          htmlTagsInlineIgnore.push("pre");
        }
        break;
    }
  });

  let divElement;
  let shadowRoot;
  let eSelTextTrans;
  // Panel palette sync hook (plan 31 / #106 model): config changes repaint the
  // live panel's engine buttons; null while no panel exists.
  let updateTranslatorButtonState = null;
  let currentNodeOverMouse;
  let timeoutHandler;
  // Last source text used for translation, for AI improvement use
  let lastSourceText = "";

  function onScroll(e) {
    clearTimeout(timeoutHandler);
  }

  const mousePos = {
    x: 0,
    y: 0,
  };

  function onMouseMove(e) {
    mousePos.x = e.clientX;
    mousePos.y = e.clientY;

    if (e.target === divElement) return;

    if (e.target === currentNodeOverMouse) return;
    currentNodeOverMouse = e.target;

    if (
      !(
        !showTranslatedTextWhenHoveringThisSite &&
        !showTranslatedTextWhenHoveringThisLang
      )
    ) {
      destroy();
      if (e.buttons === 0) {
        timeoutHandler = setTimeout(translateThisNode, 1250, e.target);
      }
    }
  }


  function onMouseDown(e) {
    if (e.target === divElement) return;
    if (divElement && divElement.contains(e.target)) return;
    destroy();
  }

  let isPlayingAudio = false;

  /**
   * Play audio
   * 
   * @param {*} text Text
   * @param {*} targetLanguage  Target language
   * @param {*} cbOnEnded Callback when audio playback ends
   */
  function playAudio(text, targetLanguage, cbOnEnded = () => { }) {
    isPlayingAudio = true;
    // Text to speech
    chrome.runtime.sendMessage(
      {
        action: "textToSpeech",
        text,
        targetLanguage,
      },
      () => {
        isPlayingAudio = false;
        cbOnEnded();
      }
    );
  }

  function stopAudio() {
    if (!isPlayingAudio) return;
    isPlayingAudio = false;
    chrome.runtime.sendMessage({
      action: "stopAudio",
    });
  }

  window.addEventListener("beforeunload", (e) => {
    destroy();
  });

  let prevNode = null;

  /** Position the visible panel at the cursor, clamped into the viewport. */
  function positionPanel() {
    if (!shadowRoot) return;
    const eDivResult = shadowRoot.getElementById("eDivResult");
    if (!eDivResult) return;

    const height = eDivResult.offsetHeight;
    let top = mousePos.y + 10;
    top = Math.max(0, top);
    top = Math.min(window.innerHeight - height, top);

    const width = eDivResult.offsetWidth;
    let left = Number(mousePos.x /*- (width / 2) */);
    left = Math.max(0, left);
    left = Math.min(window.innerWidth - width, left);

    eDivResult.style.top = top + "px";
    eDivResult.style.left = left + "px";
  }

  /** Reveal the panel (shared CSS keeps #eDivResult display:none by default). */
  function showPanel() {
    if (!shadowRoot) return;
    const eDivResult = shadowRoot.getElementById("eDivResult");
    if (!eDivResult) return;
    eDivResult.style.display = "block";
  }

  /**
   * Retranslate with the currently active engine intent — same routing as the
   * selection panel's translateNewInput (intent "ai" → AI path, else Google).
   * Used by the language buttons / "+" dropdown after target-language changes.
   */
  function retranslateForIntent() {
    if (activeTextTranslatorService === "ai") {
      triggerAiTranslation();
    } else {
      translateThisNode(null, true);
    }
  }

  /**
   * Trigger the AI run for the last hovered source text through the shared
   * panel proxy (decoration writes absorbed, translated face passes through).
   * Single words route through the dictionary path, same as the selection panel.
   */
  function triggerAiTranslation() {
    const sourceText = lastSourceText || "";
    if (!sourceText.trim()) return;
    const eSelTextTransNode = shadowRoot
      ? shadowRoot.getElementById("eSelTextTrans")
      : null;
    if (!eSelTextTransNode) return;

    setPanelTranslationLoadingState(eSelTextTransNode);

    const proxy = createPanelAiProxy({
      sourceString: sourceText,
      translatedTextNode: eSelTextTransNode,
    });
    if (wordsCount(sourceText) === 1) {
      aiTranslateWord([proxy], true);
    } else {
      aiTranslateText([proxy], true);
    }
  }

  /**
   * Translate the selected node
   * 
   * @param {*} node 
   * @param {*} usePrevNode 
   * @returns 
   */
  function translateThisNode(node, usePrevNode = false) {
    fooCount++;

    stopAudio();

    if (usePrevNode && prevNode) {
      node = prevNode;
    }
    prevNode = node;

    let hasChildNodeBlock = function (node) {
      let foo = function (node) {
        const nodeName = node.nodeName.toLowerCase();
        if (
          htmlTagsInlineText.indexOf(nodeName) === -1 &&
          htmlTagsInlineIgnore.indexOf(nodeName) === -1
        ) {
          return true;
        }

        for (const child of node.childNodes) {
          if (foo(child)) {
            return true;
          }
        }
      };
      for (const child of node.childNodes) {
        if (foo(child)) {
          return true;
        }
      }
    };

    const nodeName = node.nodeName.toLowerCase();
    if (
      htmlTagsInlineText.indexOf(nodeName) === -1 &&
      htmlTagsInlineIgnore.indexOf(nodeName) === -1
    ) {
      if (hasChildNodeBlock(node)) return;
    }

    let text;
    if (nodeName === "input" || nodeName === "textarea") {
      text = node.value.length > 0 ? node.value : node.placeholder;
      if (nodeName === "input" && !/^(?:text|search|button|submit)$/i.test(node.type)) {
        text = null;
        return;
      }
      if (
        nodeName === "input" &&
        (node.type === "button" || node.type === "submit")
      ) {
        text = node.value;
        if (!text && node.type === "submit") {
          text = "Submit Query";
        }
      }
    } else {
      do {
        const nodeName = node.nodeName.toLowerCase();
        if (htmlTagsNoTranslate.indexOf(nodeName) !== -1) return;
        if (
          htmlTagsInlineText.indexOf(nodeName) === -1 &&
          htmlTagsInlineIgnore.indexOf(nodeName) === -1
        ) {
          break;
        } else {
          node = node.parentNode;
        }
      } while (node && node !== document.body);

      if (!node) return;
      if (node.textContent.length > 1000) return;
      text = node.innerText;
    }

    if (!text || text.length < 1 || text.length > 1000) return;

    // Record source text for AI improvement use
    lastSourceText = text;

    // Show the panel with the shared loading surface the moment translation
    // starts (plan 37 / Q3) — no longer delayed until the arrival.
    if (!usePrevNode || !shadowRoot) {
      init();
      if (!shadowRoot) return;
    }

    // Capture AFTER init() — panel (re)creation bumps fooCount via destroy().
    let currentFooCount = fooCount;

    const eSelTextTransNode = shadowRoot.getElementById("eSelTextTrans");
    if (!eSelTextTransNode) return;

    setPanelTranslationLoadingState(eSelTextTransNode);
    showPanel();
    if (!usePrevNode) {
      positionPanel();
    }

    // Translate (with the shared 10s timeout, same as the selection panel)
    const translationPromise = backgroundTranslateSingleText(
      currentTextTranslatorService,
      currentTargetLanguage,
      text
    );

    const timeoutError = new Error("Translation timeout");
    timeoutError.name = "DualTranTranslationTimeout";

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(timeoutError);
      }, TRANSLATION_TIMEOUT_MS);
    });

    Promise.race([translationPromise, timeoutPromise])
      .then((result) => {
        clearTimeout(timeoutId);
        if (!result) return;
        if (currentFooCount !== fooCount) return;

        const transNode = shadowRoot
          ? shadowRoot.getElementById("eSelTextTrans")
          : null;
        const eDivResult = shadowRoot
          ? shadowRoot.getElementById("eDivResult")
          : null;
        if (!transNode || !eDivResult) return;

        if (twpLang.isRtlLanguage(currentTargetLanguage)) {
          transNode.setAttribute("dir", "rtl");
        } else {
          transNode.setAttribute("dir", "ltr");
        }
        clearPanelTranslationLoadingState(transNode);
        // Display translation result in the result box
        transNode.textContent = result;
        applyPanelTranslatedColor(transNode, "google");

        if (!usePrevNode) {
          positionPanel();
        }
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (currentFooCount !== fooCount) return;

        const isTimeout = err && (err === timeoutError || err.name === "DualTranTranslationTimeout");
        const toastMsg = isTimeout
          ? ((chrome && chrome.i18n && chrome.i18n.getMessage("errorTranslationTimeout")) || "Translation request timed out")
          : ((chrome && chrome.i18n && chrome.i18n.getMessage("errorTranslationFailed")) || "Translation failed");

        Toastify({
          text: toastMsg,
          duration: 5000,
          newWindow: true,
          close: true,
          gravity: "top",
          position: "left",
          stopOnFocus: true,
          style: {
            background: "linear-gradient(to bottom, red, darkred)",
            fontSize: "12px"
          },
          onClick: function () { }
        }).showToast();

        // Q3: the failure stays visible INSIDE the box (error color) — the
        // panel is not destroyed; leaving the hover target retires it.
        const transNode = shadowRoot
          ? shadowRoot.getElementById("eSelTextTrans")
          : null;
        if (transNode) {
          clearPanelTranslationLoadingState(transNode);
          transNode.textContent = toastMsg;
          applyPanelTranslatedColor(transNode, "error");
        }
      });

    translationPromise.catch((promiseError) => {
      console.warn("backgroundTranslateSingleText error:", promiseError);
    });
  }

  /**
   * Handle drag-and-drop
   * 
   * @param {*} elmnt 
   * @param {*} elmnt2 
   */
  function dragElement(elmnt, elmnt2) {
    var pos1 = 0,
      pos2 = 0,
      pos3 = 0,
      pos4 = 0;
    if (elmnt2) {
      elmnt2.addEventListener("mousedown", dragMouseDown);
    } else {
      elmnt.addEventListener("mousedown", dragMouseDown);
    }

    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      // get the mouse cursor position at startup:
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.addEventListener("mouseup", closeDragElement);
      // call a function whenever the cursor moves:
      document.addEventListener("mousemove", elementDrag);
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      // calculate the new cursor position:
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      // set the element's new position:
      elmnt.style.top = elmnt.offsetTop - pos2 + "px";
      elmnt.style.left = elmnt.offsetLeft - pos1 + "px";
    }

    function closeDragElement() {
      // stop moving when mouse button is released:
      document.removeEventListener("mouseup", closeDragElement);
      document.removeEventListener("mousemove", elementDrag);
    }
  }

  /**
   * Initialize translation result box
   * 
   * @returns 
   */
  function init() {
    destroy();
  // Prevent coexistence with selection popup
  if (/** @type {any} */ (window).isTranslatingSelected) return;

    divElement = document.createElement("div");
    divElement.style = "all: initial";
    divElement.classList.add("notranslate");

    shadowRoot = divElement.attachShadow({
      mode: "closed",
    });
    // Plan 37: same skin as the selection panel — shared CSS file, same id
    // vocabulary, same title bar / copy / "+" dropdown composition.
    shadowRoot.innerHTML = `
        <link rel="stylesheet" href="${chrome.runtime.getURL(
      "/contentScript/css/translateSelected.css"
    )}">

        <div id="eDivResult" style="display: none">
          <div id="drag"
            style="
            height: 30px;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 16px;
            font-weight: bold;
            border-radius: 10px 10px 0 0;
            ">
            DualTran
          </div>

          <div id="transTextContainer">
            <div id="eSelTextTrans" dir="auto"></div>
            <ul>
              <!--"Listen" button-->
              <li title="Listen" data-i18n-title="btnListen" id="listenTranslated">
                <svg id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="10px" height="10px" viewBox="0 0 93.038 93.038"
              style="enable-background:new 0 0 93.038 93.038;" xml:space="preserve">
              <g>
                <path d="M46.547,75.521c0,1.639-0.947,3.128-2.429,3.823c-0.573,0.271-1.187,0.402-1.797,0.402c-0.966,0-1.923-0.332-2.696-0.973
                l-23.098-19.14H4.225C1.892,59.635,0,57.742,0,55.409V38.576c0-2.334,1.892-4.226,4.225-4.226h12.303l23.098-19.14
                c1.262-1.046,3.012-1.269,4.493-0.569c1.481,0.695,2.429,2.185,2.429,3.823L46.547,75.521L46.547,75.521z M62.784,68.919
                c-0.103,0.007-0.202,0.011-0.304,0.011c-1.116,0-2.192-0.441-2.987-1.237l-0.565-0.567c-1.482-1.479-1.656-3.822-0.408-5.504
                c3.164-4.266,4.834-9.323,4.834-14.628c0-5.706-1.896-11.058-5.484-15.478c-1.366-1.68-1.24-4.12,0.291-5.65l0.564-0.565
                c0.844-0.844,1.975-1.304,3.199-1.231c1.192,0.06,2.305,0.621,3.061,1.545c4.977,6.09,7.606,13.484,7.606,21.38
                c0,7.354-2.325,14.354-6.725,20.24C65.131,68.216,64.007,68.832,62.784,68.919z M80.252,81.976
                c-0.764,0.903-1.869,1.445-3.052,1.495c-0.058,0.002-0.117,0.004-0.177,0.004c-1.119,0-2.193-0.442-2.988-1.237l-0.555-0.555
                c-1.551-1.55-1.656-4.029-0.246-5.707c6.814-8.104,10.568-18.396,10.568-28.982c0-11.011-4.019-21.611-11.314-29.847
                c-1.479-1.672-1.404-4.203,0.17-5.783l0.554-0.555c0.822-0.826,1.89-1.281,3.115-1.242c1.163,0.033,2.263,0.547,3.036,1.417
                c8.818,9.928,13.675,22.718,13.675,36.01C93.04,59.783,88.499,72.207,80.252,81.976z"/>
              </g>
            </svg>
              </li>
              <!--Copy translation button-->
              <li title="Copy" data-i18n-title="btnCopy" id="copy">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M13 7H7V5H13V7Z" fill="currentColor" />
						<path d="M13 11H7V9H13V11Z" fill="currentColor" />
						<path d="M7 15H13V13H7V15Z" fill="currentColor" />
						<path fill-rule="evenodd" clip-rule="evenodd" d="M3 19V1H17V5H21V23H7V19H3ZM15 17V3H5V17H15ZM17 7V19H9V21H19V7H17Z" fill="currentColor"/>
						</svg>
              </li>
            </ul>
          </div>
          <!--Button bar-->
          <div style="display: flex; justify-content: space-between; flex-direction: row;">
            <!--Target language-->
            <ul id="setTargetLanguage" style="position:relative;">
              <li value="en" title="English">en</li>
              <li value="es" title="Spanish">es</li>
              <li value="de" title="German">de</li>
              <li id="btnMoreTargetLang" title="More languages">+</li>
              <select id="selectMoreTargetLang" style="display:none; position:absolute; bottom:100%; left:0; max-width:140px; font-size:12px; padding:2px; background:#1c1b1b; color:#fff; border:1px solid #555; border-radius:3px;"></select>
            </ul>
            <!--Translation service-->
            <ul>
              <li title="Google" id="sGoogle">Google</li>
              <li title="OpenAI" id="sOpenAI">
                <span id="btnAiTxtNode">AI</span>
              </li>
            </ul>
          </div>
        </div>
        `;

    {
      const style = document.createElement("style");
      style.textContent = styleTextContent;
      shadowRoot.insertBefore(style, shadowRoot.getElementById("eDivResult"));
    }

    {
      const styleFix = document.createElement("style");
      styleFix.textContent = PANEL_LOADING_CSS;
      shadowRoot.appendChild(styleFix);
    }

    dragElement(
      shadowRoot.getElementById("eDivResult"),
      shadowRoot.getElementById("drag")
    );

    {
      // Dark/light scheme: identical contract to the selection panel
      // (backdropFilterElement + shared constants — plan 37 / D1+D2).
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

    eSelTextTrans = shadowRoot.getElementById("eSelTextTrans");

    const sGoogle = shadowRoot.getElementById("sGoogle");
    const sOpenAI = shadowRoot.getElementById("sOpenAI");

    // Engine buttons express intent only (plan 31 / #106): labels are constant
    // ("Google" / "AI"), all translation state lives in the translated-text
    // element, and every AI run goes through the panel proxy (createPanelAiProxy).
    sOpenAI.classList.add("dualtran-ai-selected-btn")
    try { sOpenAI.setAttribute("title", getFloatingButtonAiTooltipText()) } catch (_) { }

    const setTranslatorButtonState = (active) => {
      activeTextTranslatorService = active === "ai" ? "ai" : "google";
      applyPanelButtonPalette(sGoogle, sOpenAI, activeTextTranslatorService);
    };
    updateTranslatorButtonState = setTranslatorButtonState;

    sOpenAI.addEventListener("click", () => {
      if (!(lastSourceText || "").trim().length) {
        return;
      }
      setTranslatorButtonState("ai");
      triggerAiTranslation();
    });

    if (sGoogle) {
      try { sGoogle.setAttribute("title", getFloatingButtonGoogleTooltipText()) } catch (_) { }
    }
    sGoogle.onclick = () => {
      currentTextTranslatorService = "google";
      twpConfig.set("textTranslatorService", "google");
      setTranslatorButtonState("google");
      translateThisNode(null, true);
    };

    setTranslatorButtonState(currentTextTranslatorService === "google" ? "google" : "ai");

    /**
     * Copy translated text
     */
    const eCopy = shadowRoot.getElementById("copy");
    eCopy.onclick = () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(eSelTextTrans.textContent)
          .then(() => {
            const oldBackgroundColor = eCopy.style.backgroundColor;
            eCopy.style.backgroundColor = "rgba(0, 255, 0, 0.4)";
            setTimeout(() => {
              eCopy.style.backgroundColor = oldBackgroundColor;
            }, 500);
          })
          .catch((e) => {
            Toastify({
              text: chrome.i18n.getMessage("errorCopyFailed") + " " + e,
              duration: 3500,
              newWindow: true,
              close: true,
              gravity: "top",
              position: "left",
              stopOnFocus: true,
              style: {
                background: "linear-gradient(to bottom, red, darkred)",
                fontSize: "12px"
              },
              onClick: function () { }
            }).showToast();
          })
      } else {
        Toastify({
          text: chrome.i18n.getMessage("errorCopyFailedInsecure"),
          duration: 5000,
          newWindow: true,
          close: true,
          gravity: "top",
          position: "left",
          stopOnFocus: true,
          style: {
            background: "linear-gradient(to bottom, red, darkred)",
            fontSize: "12px"
          },
          onClick: function () { }
        }).showToast();
      }
    };

    const eListenTranslated = shadowRoot.getElementById("listenTranslated");
    eListenTranslated.onclick = () => {
      const msgListen = chrome.i18n.getMessage("btnListen");
      const msgStopListening = chrome.i18n.getMessage("btnStopListening");

      eListenTranslated.classList.remove("selected");
      eListenTranslated.setAttribute("title", msgStopListening);

      if (isPlayingAudio) {
        stopAudio();
        eListenTranslated.classList.remove("selected");
      } else {
        playAudio(eSelTextTrans.textContent, currentTargetLanguage, () => {
          eListenTranslated.classList.remove("selected");
          eListenTranslated.setAttribute("title", msgListen);
        });
        eListenTranslated.classList.add("selected");
      }
    };

    document.body.appendChild(divElement);

    // Translation result box i18n
  /** @type {any} */ (chrome.i18n).translateDocument(shadowRoot);

    const targetLanguageButtons = shadowRoot.querySelectorAll(
      "#setTargetLanguage li"
    );

    // Target language elements (display names, same as the selection panel)
    for (let i = 0; i < 3; i++) {
      if (currentTargetLanguages[i] == currentTargetLanguage) {
        targetLanguageButtons[i].classList.add("selected");
      }
      targetLanguageButtons[i].textContent = twpLang.codeToLanguage(currentTargetLanguages[i]);
      targetLanguageButtons[i].setAttribute("value", currentTargetLanguages[i]);
      targetLanguageButtons[i].setAttribute(
        "title",
        twpLang.codeToLanguage(currentTargetLanguages[i])
      );
    }

    // "More languages" button and dropdown (same behavior as the selection panel)
    const btnMore = shadowRoot.getElementById("btnMoreTargetLang");
    const selectMore = shadowRoot.getElementById("selectMoreTargetLang");

    // Populate all languages into the dropdown
    const allLangs = twpLang.getLanguageList();
    const sorted = Object.entries(allLangs).sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));
    selectMore.innerHTML = "";
    sorted.forEach(([code, name]) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = name;
      if (code === currentTargetLanguage) opt.selected = true;
      selectMore.appendChild(opt);
    });

    /** Refresh the display text and highlight state of the three language buttons */
    function refreshLanguageButtons() {
      const langs = twpConfig.get("targetLanguages") || [];
      for (let i = 0; i < 3 && i < targetLanguageButtons.length && i < langs.length; i++) {
        const code = langs[i];
        const name = twpLang.codeToLanguage(code);
        targetLanguageButtons[i].setAttribute("value", code);
        targetLanguageButtons[i].textContent = name;
        targetLanguageButtons[i].setAttribute("title", name);
        targetLanguageButtons[i].classList.remove("selected");
      }
      btnMore.classList.remove("selected");
      // Highlight the matching button
      const activeIdx = langs.indexOf(currentTargetLanguage);
      if (activeIdx >= 0 && activeIdx < 3) {
        targetLanguageButtons[activeIdx].classList.add("selected");
      } else {
        btnMore.classList.add("selected");
      }
    }

    // Click "+" button → expand to multi-line list showing all languages
    btnMore.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectMore.querySelectorAll("option").forEach((opt) => {
        opt.selected = (opt.value === currentTargetLanguage);
      });

      // Positioning: use fixed positioning to avoid being clipped by popups
      const btnRect = btnMore.getBoundingClientRect();
      selectMore.style.position = "fixed";
      selectMore.style.top = "auto";
      selectMore.style.bottom = (window.innerHeight - btnRect.top) + "px";
      selectMore.style.left = btnRect.left + "px";
      selectMore.style.zIndex = "2147483647";

      selectMore.size = Math.min(sorted.length, 15); // Expand to visible list (max 15 rows)
      selectMore.style.display = "inline-block";
      btnMore.style.display = "none";
      selectMore.focus();
    });

    // Collapse the dropdown
    function collapseSelectMore() {
      selectMore.size = 1;
      selectMore.style.display = "none";
      btnMore.style.display = "";
    }

    // Select language → promote to top favorite, retranslate, refresh buttons
    selectMore.addEventListener("change", () => {
      const code = selectMore.value;
      if (!code) return;

      // Promote this language to the top favorite
      let langs = twpConfig.get("targetLanguages") || [];
      langs = langs.filter((l) => l !== code); // Remove duplicates
      langs.unshift(code);                     // Insert at first position
      langs = langs.slice(0, 3);               // Keep only first 3
      twpConfig.set("targetLanguages", langs);

      currentTargetLanguage = code;
      twpConfig.setTargetLanguageTextTranslation(code);
      refreshLanguageButtons();
      retranslateForIntent();

      collapseSelectMore();
    });

    // Close dropdown on blur (but don't trigger translation)
    selectMore.addEventListener("blur", () => {
      setTimeout(() => collapseSelectMore(), 150);
    });

    const setTargetLanguage = shadowRoot.getElementById("setTargetLanguage");
    setTargetLanguage.onclick = (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const val = target.getAttribute("value");
      if (val) {
        const langCode = twpLang.fixTLanguageCode(val);
        if (langCode) {
          currentTargetLanguage = langCode;
          twpConfig.setTargetLanguageTextTranslation(langCode);
          retranslateForIntent();
        }

        shadowRoot.querySelectorAll("#setTargetLanguage li").forEach((li) => {
          li.classList.remove("selected");
        });

        target.classList.add("selected");
      }
    };
  }

  /**
   * Destroy translation result box
   */
  function destroy() {
    fooCount++;
    stopAudio();

    clearTimeout(timeoutHandler);

    if (divElement) {
      divElement.remove();
      divElement = shadowRoot = eSelTextTrans = null;
      updateTranslatorButtonState = null;
    }
  }

  function isSelectingText() {
    const activeEl = document.activeElement;
    const activeElTagName = activeEl ? activeEl.tagName.toLowerCase() : null;
    if (
      activeElTagName == "textarea" ||
      (activeElTagName == "input" &&
        /^(?:text|search)$/i.test(/** @type {any} */ (activeEl).type) &&
        typeof /** @type {any} */ (activeEl).selectionStart == "number")
    ) {
      const el = /** @type {any} */ (activeEl);
      const text = el.value.slice(
        el.selectionStart,
        el.selectionEnd
      );
      if (text) return true;
    } else if (window.getSelection) {
      const selection = window.getSelection();
      if (selection.type == "Range") {
        const text = selection.toString();
        if (text) return true;
      }
    }
    return false;
  }

  let lastTimePressedCtrl = null;

  function onKeyUp(e) {
    if (!translateTextOverMouseWhenPressTwice) return;
    if (e.key == "Control") {
      if (
        lastTimePressedCtrl &&
        performance.now() - lastTimePressedCtrl < 280 &&
        !isSelectingText()
      ) {
        lastTimePressedCtrl = performance.now();

        const elements = document.querySelectorAll(":hover");
        if (elements.length > 0) {
          destroy();
          translateThisNode(elements[elements.length - 1]);
        }
      }
      lastTimePressedCtrl = performance.now();
    }
  }

  function updateEventListener() {
    if (
      platformInfo.isMobile.any ||
      pageLanguageState == "translated" ||
      !(
        showTranslatedTextWhenHoveringThisSite ||
        showTranslatedTextWhenHoveringThisLang ||
        translateTextOverMouseWhenPressTwice
      )
    ) {
      window.removeEventListener("scroll", onScroll);

      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);

      document.removeEventListener("blur", destroy);
      document.removeEventListener("visibilitychange", destroy);

      document.removeEventListener("keyup", onKeyUp);

      destroy();
    } else {
      window.addEventListener("scroll", onScroll);

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mousedown", onMouseDown);

      document.addEventListener("blur", destroy);
      document.addEventListener("visibilitychange", destroy);

      document.addEventListener("keyup", onKeyUp);
    }
  }
  updateEventListener();

  pageTranslator.onGetOriginalTabLanguage(function (tabLanguage) {
    originalTabLanguage = tabLanguage;
    showTranslatedTextWhenHoveringThisLang =
      twpConfig
        .get("langsToTranslateWhenHovering")
        .indexOf(originalTabLanguage) !== -1;
    updateEventListener();
  });

  pageTranslator.onPageLanguageStateChange((_pageLanguageState) => {
    pageLanguageState = _pageLanguageState;
    updateEventListener();
  });
});

export default showTranslated
