/**
 * Selected text translation.
 * 
 * After the user selects text on a web page, a translate button appears. Clicking it opens a translation window and performs the translation. Users can choose the translation engine and target language, and also copy the translation, read aloud the original text and translation, etc.
 * 
 * This file is for Chrome browser. Browsers like Chrome that lack the browserAction.setPopup API need to send messages from sw.js to contentScript, and the content script then calls relevant functions in translateSelected.js to pop up the translation window (a dynamically created div)
 * For browsers like Firefox that have the browserAction.setPopup API, sw.js can directly call browserAction.setPopup() to open \src\popup\popup-translate-text.html
 */

// DONE: When doing AI translation for words, the etymology was not explained in the target language. Fixed.


// TODO: Improve language detection accuracy: single words are easily misdetected, e.g. properties/represents are detected as German
// TODO: When doing AI translation for the word "is", far too many definitions are listed, which is really unnecessary

const TRANSLATION_TIMEOUT_MS = 10000; // Timeout duration (milliseconds)

console.log("translateSelected.js is running")

import twpLang from "../lib/languages.js"
import twpConfig from "../lib/config.js"
import platformInfo from "../lib/platformInfo.js"
const { backgroundTranslateSingleText, pageTranslator, aiTranslateText, aiCache, abortControllers } = await import("./pageTranslator.js")
import Toastify from 'toastify-js'
import detectTextLanguage from "../util/detectTextLanguage.js"
import wordsCount from "../util/globalWordsCount.js"
import { translateWithAI } from "./fetchSSE.js"
import { getAiImproveTranslationTooltipText } from "./i18n.js"
import { notifyAiStreamParseError, parseOpenAiStyleStreamMessage } from "./aiStreamMessage.js"
import {
  applyAiErrorState,
  applyAiSuccessState,
  applyAiTranslatingState,
  AI_SUCCESS_CHECK_CLASS,
  ERROR_CROSS_COLOR,
  SUCCESS_CHECK_COLOR,
  formatAiTranslationError,
} from "./aiUiState.js"

// This object is not being used??
var translateSelected = {};

const GOOGLE_BUTTON_LABEL = "google";
const GOOGLE_SUCCESS_TITLE = "Google translated successfully!";

function renderGoogleSuccessIndicator(btnGoogle) {
  if (!btnGoogle || !btnGoogle.btnGoogleTxtNode) return;
  const baseLabel = btnGoogle.googleLabelText || GOOGLE_BUTTON_LABEL;
  btnGoogle.btnGoogleTxtNode.textContent = baseLabel;
  const checkSpan = document.createElement("span");
  checkSpan.textContent = "\u2713";
  checkSpan.className = AI_SUCCESS_CHECK_CLASS;
  checkSpan.style.marginLeft = "4px";
  checkSpan.style.color = SUCCESS_CHECK_COLOR;
  checkSpan.style.fontWeight = "600";
  btnGoogle.btnGoogleTxtNode.appendChild(checkSpan);
  btnGoogle.style.color = SUCCESS_CHECK_COLOR;
  const successTitle = btnGoogle.googleSuccessTitle || GOOGLE_SUCCESS_TITLE;
  try { btnGoogle.setAttribute("title", successTitle); } catch (_) { }
  if (btnGoogle.dataset) {
    btnGoogle.dataset.googleSuccess = "1";
  }
}

function clearGoogleSuccessIndicator(btnGoogle) {
  if (!btnGoogle || !btnGoogle.btnGoogleTxtNode) return;
  const baseLabel = btnGoogle.googleLabelText || GOOGLE_BUTTON_LABEL;
  btnGoogle.btnGoogleTxtNode.textContent = baseLabel;
  btnGoogle.style.removeProperty("color");
  const defaultTitle = btnGoogle.googleDefaultTitle;
  if (defaultTitle) {
    try { btnGoogle.setAttribute("title", defaultTitle); } catch (_) { }
  }
  if (btnGoogle.dataset) {
    delete btnGoogle.dataset.googleSuccess;
  }
}

function getTabHostName() {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "getTabHostName" }, (result) =>
      resolve(result)
    )
  );
}

/**
 * Translate with AI
 * @param {Array<Element>} toBeTranslated 
 * @returns 
 */
let aiTranslateWord = async (toBeTranslated, showToastForError = true) => {
  /** @type {any} */
  let btnAi = toBeTranslated[0]
  let hasAiStreamError = false

  // If contentSequence is empty string, exit
  if (!(btnAi.sourceString.trim().length)) {
    console.log("contentSequence is empty")
    return
  }

  // If already translating, exit
  btnAi.translationStatus = "queuing"
  btnAi.btnAiTxtNode.textContent = "queuing"

  // Use the “text translation” target language as the target language
  const targetLanguageCodeForAI = twpConfig.get("targetLanguageTextTranslation") || twpConfig.get("targetLanguage")
  // If the cache has the same source text and target language, use the cache directly
  let cacheItem = aiCache.find(item => btnAi.sourceString === item.original && item.targetLanguage === targetLanguageCodeForAI)
  if (cacheItem) {
    applyAiSuccessState(btnAi, {
      translatedText: cacheItem.translated || "",
      translatedTextColor: twpConfig.get("aiTranslatedColor"),
      tooltipText: "AI translated successfully!",
      titleText: "AI translated successfully!",
    })
    return
  }

  // Start translation
  let accumulatedText = ""

  // Define response parsing function
  let onMessage = (msg) => {
    console.log(9999, 'received message', msg)

    const parsedChunk = parseOpenAiStyleStreamMessage(msg)
    if (parsedChunk.kind === "empty" || parsedChunk.kind === "done") {
      if (parsedChunk.kind === "done") {
        console.log("AI stream completion marker received")
      }
      return
    }

    if (accumulatedText === "") {
      chrome.runtime.sendMessage({
        action: "recordNewRequestToOpenAI",
        result: "successful",
        timeStamp: Date.now()
      })
    }

    if (parsedChunk.kind === "parse-error") {
      console.log("Response parsing error 1", parsedChunk.error)
      hasAiStreamError = true
      showToastForError = true
      notifyAiStreamParseError({
        error: parsedChunk.error,
        controller,
        onError,
      })
      return
    }

    if (parsedChunk.kind === "no-result") {
      console.log(33333, 'No result')
      return { error: 'No result' }
    }
    if (parsedChunk.kind === "finished") {
      console.log(4444444, parsedChunk.finishReason)
      return
    }

    if (parsedChunk.kind !== "delta") {
      return
    }

    let targetTxt = ''
    targetTxt = parsedChunk.text
    console.log("targetTxt:", targetTxt)

    if ([undefined, null, ""].includes(targetTxt)) {
      return
    }
    accumulatedText = accumulatedText + targetTxt
    console.log("accumulatedText:", accumulatedText)


    try {
      applyAiTranslatingState(btnAi, {
        translatedText: accumulatedText,
        translatedTextColor: twpConfig.get("aiTranslatedColor"),
        tooltipColor: "darkgreen...",
      })
    } catch (e) {
      console.log("Response parsing error 2", e)
    }
  }

  // Define error handling function
  let onError = (err) => {
    hasAiStreamError = true
    chrome.runtime.sendMessage({
      action: "recordNewRequestToOpenAI",
      result: "failed",
      timeStamp: Date.now()
    })

    // Build error message: if timeout, show “server response timeout”; otherwise show both code and message (if present)
    const errTxt = formatAiTranslationError(err)
    console.log(999999, err)

    applyAiErrorState(btnAi, {
      errorText: errTxt,
    })

    if (showToastForError) {
      Toastify({
        text: errTxt,
        duration: 5000,
        newWindow: true,
        close: true,
        gravity: "top", // `top` or `bottom`
        position: "left", // `left`, `center` or `right`
        stopOnFocus: true, // Prevents dismissing of toast on hover
        style: {
          background: "linear-gradient(to bottom, red, darkred)",
          fontSize: "12px"
        },
        onClick: function () { } // Callback after click
      }).showToast();
    }
  }

  // Define completion handler
  let onFinished = () => {
    if (hasAiStreamError) {
      console.log("onFinished skipped due to previous error")
      return
    }
    console.log("onFinished is called")
    // Ensure loading state is removed
    applyAiSuccessState(btnAi, {
      translatedTextColor: twpConfig.get("aiTranslatedColor"),
      tooltipText: "AI translated successfully!",
      titleText: "AI translated successfully!",
    })
    // Write to cache (keyed by source text + target language)
    try {
      aiCache.push({
        original: btnAi.sourceString,
        targetLanguage: targetLanguageCodeForAI,
        translated: btnAi.translatedTextNode?.textContent || ""
      })
    } catch (_) { }
  }

  // Build abort controller
  const controller = new AbortController();
  abortControllers.push(controller)
  const signal = controller.signal;

  // Start calling AI translation
  translateWithAI(btnAi.sourceString, onMessage, onError, onFinished, signal, true, targetLanguageCodeForAI)
}

Promise.all([twpConfig.onReady(), getTabHostName()]).then(function (_) {
  console.log("translateSelected.js promise.all is resolved")

  const tabHostName = _[1];

  /**
   * Selected text info
   */
  let gSelectionInfo;
  /**
   * Previous selected text info
   */
  let prevSelectionInfo;

  /**
   * Parent element of the translation popup (host of shadow DOM)
   */
  let divElement;
  /**
   * Icon button shown after text selection (click to show translation popup)
   */
  let eButtonTransSelText;
  /**
   * Translation popup window
   */
  let eDivResult;
  /**
   * Element that displays the translated text
   */
  let eSelTextTrans;
  /**
   * Element that displays the original text
   */
  let eOrigText;
  /**
   * Parent element of the original text display element
   */
  let origTextContainer;
  let sOpenAI = null;
  let sGoogle = null;
  let updateTranslatorButtonState = null;

  /**
   * Load config from configuration and assign to memory variables
   */

  // Original tab language
  let originalTabLanguage = "und";
  // Current target language list
  let currentTargetLanguages = twpConfig.get("targetLanguages");
  // Current target language
  let currentTargetLanguage = twpConfig.get("targetLanguageTextTranslation");
  // Current translation service
  let currentTextTranslatorService = twpConfig.get("textTranslatorService") || "google";
  let activeTextTranslatorService =
    currentTextTranslatorService === "google" ? "google" : "ai";
  // Always translate this site
  let alwaysTranslateThisSite =
    twpConfig.get("alwaysTranslateSites").indexOf(tabHostName) !== -1;
  // Can translate this site (inverse of never translate this site)
  let translateThisSite =
    twpConfig.get("neverTranslateSites").indexOf(tabHostName) === -1;
  // Can translate this language (inverse of never translate this language)
  let translateThisLanguage =
    twpConfig.get("neverTranslateLangs").indexOf(originalTabLanguage) === -1;
  // Whether to show "translate" icon next to selected text
  let showTranslateSelectedButton = twpConfig.get(
    "showTranslateSelectedButton"
  );
  // Don't show translation popup when page language is the target language
  let dontShowIfPageLangIsTargetLang = twpConfig.get(
    "dontShowIfPageLangIsTargetLang"
  );
  // Don't show translation popup when page language is unknown
  let dontShowIfPageLangIsUnknown = twpConfig.get(
    "dontShowIfPageLangIsUnknown"
  );
  // Don't show translation popup when selected text is in the target language
  let dontShowIfSelectedTextIsTargetLang = twpConfig.get(
    "dontShowIfSelectedTextIsTargetLang"
  );
  // Don't show translation popup when selected text language is unknown
  let dontShowIfSelectedTextIsUnknown = twpConfig.get(
    "dontShowIfSelectedTextIsUnknown"
  );
  let fooCount = 0;
  let panelLayoutRevision = 0;
  let panelLockedPosition = null;
  let panelAppliedRevision = -1;

  // Get page original language, update corresponding variables
  pageTranslator.onGetOriginalTabLanguage(function (tabLanguage) {
    originalTabLanguage = tabLanguage;
    translateThisLanguage =
      twpConfig.get("neverTranslateLangs").indexOf(originalTabLanguage) === -1;
    updateEventListener();
  });

  let isPlayingAudio = false;

  /**
   * Play audio
   * @param {*} text 
   * @param {*} targetLanguage 
   * @param {*} cbOnEnded 
   */
  function playAudio(text, targetLanguage, cbOnEnded = () => { }) {
    isPlayingAudio = true;
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

  /**
   * 
   * @returns Stop playing audio
   */
  function stopAudio() {
    if (!isPlayingAudio) return;
    isPlayingAudio = false;
    chrome.runtime.sendMessage({
      action: "stopAudio",
    });
  }

  /**
   * Drag the translation popup (drag when mouse is on the bottom bar of the popup)
   * @param {*} elmnt Translation popup
   * @param {*} elmnt2 Element where the mouse is during dragging
   */
  function enableDragAndDrop(elmnt, elmnt2) {
    var pos1 = 0,
      pos2 = 0,
      pos3 = 0,
      pos4 = 0;
    if (elmnt2) {
      elmnt2.addEventListener("mousedown", onMouseDown);
    } else {
      elmnt.addEventListener("mousedown", onMouseDown);
    }

    /**
     * When mousedown occurs on the drag bar, add mouseMove and mouseUp listeners
     * @param {*} e 
     */
    function onMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      // get the mouse cursor position at startup:
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.addEventListener("mouseup", onMouseUp);
      // call a function whenever the cursor moves:
      document.addEventListener("mousemove", onMouseMove);
    }

    /**
     * This function handles the mouseMove event.
     * Get mouseMove event coordinates and adjust the translation popup position accordingly
     * @param {*} e 
     */
    function onMouseMove(e) {
      e = e || window.event;
      e.preventDefault();
      // calculate the new cursor position:
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      // set the element's new position:
      elmnt.style.top =
        Math.min(
          window.innerHeight - parseInt(getComputedStyle(elmnt).height),
          Math.max(0, elmnt.offsetTop - pos2)
        ) + "px";
      elmnt.style.left = Math.max(0, elmnt.offsetLeft - pos1) + "px";
    }

    /**
     * This function handles the mouseup event
     * Remove mouseup and mouseMove event listeners
     */
    function onMouseUp() {
      // stop moving when mouse button is released:
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousemove", onMouseMove);
    }
  }

  /**
   * sets the position of the caret (text cursor) to the end of a text element while ensuring that the selection remains collapsed. 
   */
  function setCaretAtEnd() {
    const el = eOrigText;
    const range = document.createRange();
    const sel = window.getSelection();
    // set the start position of the range, and the textContent.length > 0 ? 1 : 0 condition ensures that the selection starts at position 1 if the element has any content in it, or at position 0 if not.
    range.setStart(el, el.textContent.length > 0 ? 1 : 0);
    range.collapse(true);
    // clear any existing ranges
    sel.removeAllRanges();
    // add the newly created range to the selection. 
    sel.addRange(range);
    // ensure that the element receives focus
    el.focus();
  }

  let onCSSLoad = null;
  let isCSSLoaded = false;

  /**
   * Initialize and show the translation popup
   */
  function init() {
    destroy();

    window.isTranslatingSelected = true;

    divElement = document.createElement("div");
    divElement.style = "all: initial";
    divElement.classList.add("notranslate");

    const shadowRoot = divElement.attachShadow({
      mode: "closed",
    });

    // HTML of the translation popup
    shadowRoot.innerHTML = `
    <!--Icon button shown after text selection (click to show translation popup)-->
    <div id="eButtonTransSelText" style="display: none"></div>
    <!--Translation popup window-->
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

      <!--Original text section-->
			<div id="origTextContainer">
        <!--Original text-->
				<div>
					<div id="eOrigText" contentEditable="true" spellcheck="false" dir="auto"></div>
					<hr>
				</div>
				<ul>
          <!--"Listen" button-->
          <li title="Listen" data-i18n-title="btnListen" id="listenOriginal">
            <!--"Copy" button-->
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
        </ul>
			</div>
      <!--Translation section-->
			<div id="transTextContainer">
        <!--Translation-->
				<div id="eSelTextTrans" dir="auto"></div>
        <!--Button row-->
				<ul>
          <!--Listen to translation button-->
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
          <!--??? button-->
					<li title="Replace" data-i18n-title="btnReplace" id="replace" hidden>
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path
						d="M5.75739 7.17154L7.1716 5.75732L16.2426 14.8283L16.2426 10.2427H18.2426L18.2426 18.2427H10.2426V16.2427L14.8285 16.2427L5.75739 7.17154Z"
						fill="currentColor"
						/>
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
        <!--Whether to show original text-->
        <div id="moreOrLess" style="display:block"><i class="arrow up" id="showOriginalText"></i><i class="arrow down" id="hideOriginalText"></i></div>        
        <!--Translation service-->
        <ul>
          <li title="Google" id="sGoogle">google</li>
          <li title="openAI" id="sOpenAI" style="color: white;">
            <span id="btnAiTxtNode">AI</span>
          </li>
        </ul>
      </div>
		</div>
        `;

    // Insert CSS needed for the translation popup
    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute(
      "href",
      chrome.runtime.getURL("/contentScript/css/translateSelected.css")
    );
    isCSSLoaded = false;
    link.onload = (e) => {
      isCSSLoaded = true;
      if (onCSSLoad) onCSSLoad();
    };
    shadowRoot.appendChild(link);

    const styleFix = document.createElement("style");
    styleFix.textContent = `
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
    .dualtran-ai-success-check {
      margin-left: 4px;
      color: #16a34a;
      font-weight: 600;
    }
    .dualtran-ai-error-cross {
      margin-left: 4px;
      color: #dc2626;
      font-weight: 600;
    }
    @keyframes dualtran-spin {
      to { transform: rotate(360deg); }
    }
    `;
    shadowRoot.appendChild(styleFix);

    enableDragAndDrop(
      shadowRoot.getElementById("eDivResult"),
      shadowRoot.getElementById("drag")
    );

    const isFirefox = navigator.userAgent.toLowerCase().indexOf("firefox") > -1;

    if (CSS.supports("backdrop-filter: blur(5px)") && !isFirefox && false) {
      const el = document.createElement("style");
      el.setAttribute("id", "backdropFilterElement");
      el.setAttribute("rel", "stylesheet");
      el.textContent = `
                    #eDivResult {
                        backdrop-filter: blur(3px);
                        background-color: rgba(0, 0, 0, 0.5);
                    }
                    li {
                    	background-color: rgba(255, 255, 255, 0.1);
                    }
                    .selected {
                    	background-color: rgba(255, 255, 255, 0.3);
                    }
                    #moreOrLess {
                		background-color: rgba(255, 255, 255, 0.1);
            		}
            		hr {
            			border: 1px rgba(255, 255, 255, 0.5) solid;
            		}
            		#listen {
            		    fill: white;
            		}
                `;
      shadowRoot.appendChild(el);
    } else {
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
      if (darkMode === true) {
        el.textContent = `
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
                `;
      } else {
        el.textContent = `
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
                `;
      }
      shadowRoot.appendChild(el);
    }

    eButtonTransSelText = shadowRoot.getElementById("eButtonTransSelText");
    eDivResult = shadowRoot.getElementById("eDivResult");
    eSelTextTrans = shadowRoot.getElementById("eSelTextTrans");
    eOrigText = shadowRoot.getElementById("eOrigText");
    origTextContainer = shadowRoot.getElementById("origTextContainer");

    const eMoreOrLess = shadowRoot.getElementById("moreOrLess");
    const eMore = shadowRoot.getElementById("showOriginalText");
    const eLess = shadowRoot.getElementById("hideOriginalText");

    sOpenAI = shadowRoot.getElementById("sOpenAI");
    const btnAiTxtNode = shadowRoot.getElementById("btnAiTxtNode");

    // Simulate btnAi
    let tooltip = document.createElement("span")
    tooltip.textContent = getAiImproveTranslationTooltipText()
    tooltip.classList.add("dualtran-ai-tooltip")
    sOpenAI.appendChild(tooltip)
    sOpenAI.tooltip = tooltip
    sOpenAI.translationStatus = null
    sOpenAI.translatedTextNode = eSelTextTrans
    sOpenAI.btnAiTxtNode = btnAiTxtNode
    sOpenAI.classList.add("dualtran-ai-selected-btn")
    const el = document.createElement("style");
    el.setAttribute("rel", "stylesheet");
    el.textContent = `
    .dualtran-ai-tooltip{
      display: none;
    } 
    `;
    shadowRoot.appendChild(el);

    // Sync tooltip text to native title (to avoid default title="openAI" always showing fixed text on hover)
    try { sOpenAI.setAttribute("title", tooltip.textContent || "") } catch (_) { }
    try {
      const syncTitle = () => {
        try { sOpenAI.setAttribute("title", tooltip.textContent || "") } catch (_) { }
      };
      const observer = new MutationObserver(syncTitle);
      observer.observe(tooltip, { childList: true, characterData: true, subtree: true });
      // Sync once immediately
      syncTitle();
    } catch (_) { }

    sOpenAI.addEventListener("click", () => {
      if (!eOrigText.textContent.trim().length) {
        return;
      }
      setTranslatorButtonState("ai");
      triggerAiTranslation({ showToastForError: true });
    })
    if (false) {
      setTimeout(() => sOpenAI.click(), 1000)
    }

    sGoogle = shadowRoot.getElementById("sGoogle");
    if (sGoogle) {
      const googleLabelText = (sGoogle.textContent || GOOGLE_BUTTON_LABEL).trim() || GOOGLE_BUTTON_LABEL;
      const googleTextSpan = document.createElement("span");
      googleTextSpan.textContent = googleLabelText;
      sGoogle.textContent = "";
      sGoogle.appendChild(googleTextSpan);
      sGoogle.btnGoogleTxtNode = googleTextSpan;
      sGoogle.googleLabelText = googleLabelText;
      sGoogle.googleDefaultTitle = sGoogle.getAttribute("title") || googleLabelText;
      sGoogle.googleSuccessTitle = GOOGLE_SUCCESS_TITLE;
      clearGoogleSuccessIndicator(sGoogle);
    }
    // const sYandex = shadowRoot.getElementById("sYandex");
    // const sBing = shadowRoot.getElementById("sBing");
    // const sDeepL = shadowRoot.getElementById("sDeepL");
    const resetAiButtonBaseColor = () => {
      if (!sOpenAI) return;
      const referenceColor = sGoogle
        ? window.getComputedStyle(sGoogle).color
        : "";
      if (referenceColor) {
        sOpenAI.style.color = referenceColor;
      } else {
        sOpenAI.style.removeProperty("color");
      }
    };

    const setTranslatorButtonState = (active) => {
      activeTextTranslatorService = active === "ai" ? "ai" : "google";
      const googleHasSuccess = Boolean(sGoogle?.dataset?.googleSuccess);
      if (active === "ai") {
        if (sOpenAI) {
          sOpenAI.classList.add("selected");
          sOpenAI.style.removeProperty("color");
        }
        if (sGoogle) {
          sGoogle.classList.remove("selected");
          if (!googleHasSuccess) {
            clearGoogleSuccessIndicator(sGoogle);
          }
        }
      } else {
        if (sGoogle) {
          sGoogle.classList.add("selected");
          if (!googleHasSuccess) {
            clearGoogleSuccessIndicator(sGoogle);
          }
        }
        if (sOpenAI) {
          sOpenAI.classList.remove("selected");
          resetAiButtonBaseColor();
        }
      }
    };
    updateTranslatorButtonState = setTranslatorButtonState;

    const eCopy = shadowRoot.getElementById("copy");
    const eReplace = shadowRoot.getElementById("replace");
    /**
     * "Listen" button for original text
     */
    const eListenOriginal = shadowRoot.getElementById("listenOriginal");
    /**
     * "Listen" button for translated text
     */
    const eListenTranslated = shadowRoot.getElementById("listenTranslated");

    if (
      gSelectionInfo &&
      (gSelectionInfo.isInputElement || gSelectionInfo.isContentEditable)
    ) {
      eCopy.setAttribute("hidden", "");
      eReplace.removeAttribute("hidden");
    } else {
      eCopy.removeAttribute("hidden");
      eReplace.setAttribute("hidden", "");
    }

    /**
     * Copy translated text  
     */
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
              gravity: "top", // `top` or `bottom`
              position: "left", // `left`, `center` or `right`
              stopOnFocus: true, // Prevents dismissing of toast on hover
              style: {
                background: "linear-gradient(to bottom, red, darkred)",
                fontSize: "12px"
              },
              onClick: function () { } // Callback after click
            }).showToast();
          })
      } else {
        Toastify({
          text: chrome.i18n.getMessage("errorCopyFailedInsecure"),
          duration: 5000,
          newWindow: true,
          close: true,
          gravity: "top", // `top` or `bottom`
          position: "left", // `left`, `center` or `right`
          stopOnFocus: true, // Prevents dismissing of toast on hover
          style: {
            background: "linear-gradient(to bottom, red, darkred)",
            fontSize: "12px"
          },
          onClick: function () { } // Callback after click
        }).showToast();
      }
    };

    /**
     * Replace old text with new text
     */
    function replaceText() {
      const prevSelInfo = prevSelectionInfo;
      destroy();
      if (prevSelInfo.element.nodeType === 3) {
        prevSelInfo.element.parentNode.focus();
      } else {
        prevSelInfo.element.focus();
      }
      document.execCommand("selectAll", false);
      if (prevSelInfo.isInputElement) {
        prevSelInfo.element.setSelectionRange(
          prevSelInfo.selStart,
          prevSelInfo.selEnd
        );
      } else if (prevSelInfo.isContentEditable) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(prevSelInfo.range);
      }
      document.execCommand("insertText", false, eSelTextTrans.textContent);
    }
    eReplace.onclick = replaceText;

    eOrigText.onkeypress = (e) => {
      e.stopPropagation();
    };

    eOrigText.onkeydown = (e) => {
      e.stopPropagation();
    };

    let lastTimePressedCtrl = null;

    eOrigText.onkeyup = (e) => {
      if (twpConfig.get("translateSelectedWhenPressTwice") !== "yes") return;
      if (e.key == "Control") {
        if (
          lastTimePressedCtrl &&
          performance.now() - lastTimePressedCtrl < 250
        ) {
          lastTimePressedCtrl = performance.now();
          replaceText();
        }
        lastTimePressedCtrl = performance.now();
      }
    };

    let translateNewInputTimerHandler;
    eOrigText.oninput = () => {
      // Reset
      btnAiTxtNode.textContent = "AI"
      // Reset tooltip text and sync to title, to avoid retaining previous error/success message
      try {
        tooltip.textContent = getAiImproveTranslationTooltipText();
        sOpenAI.setAttribute("title", tooltip.textContent || "");
      } catch (_) { }
      if (sGoogle) {
        clearGoogleSuccessIndicator(sGoogle);
      }
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
      if (sOpenAI.classList.contains("selected")) {
        sOpenAI.style.removeProperty("color");
      } else {
        resetAiButtonBaseColor();
      }

      clearTimeout(translateNewInputTimerHandler);
      translateNewInputTimerHandler = setTimeout(translateNewInput, 800);
    };

    setTranslatorButtonState(currentTextTranslatorService === "google" ? "google" : "ai");

    // Click event handler for "more/less" button
    eMoreOrLess.onclick = () => {
      if (twpConfig.get("expandPanelTranslateSelectedText") === "no") {
        twpConfig.set("expandPanelTranslateSelectedText", "yes");
      } else {
        twpConfig.set("expandPanelTranslateSelectedText", "no");
      }
      // Preserve the page's existing selection, don't force cursor to panel input on expand/collapse
    };

    sGoogle.onclick = () => {
      currentTextTranslatorService = "google";
      twpConfig.set("textTranslatorService", "google");
      setTranslatorButtonState("google");
      translateNewInput();
    };
    // sYandex.onclick = () => {
    //   currentTextTranslatorService = "yandex";
    //   twpConfig.set("textTranslatorService", "yandex");
    //   translateNewInput();

    //   sGoogle.classList.remove("selected");
    //   sYandex.classList.remove("selected");
    //   sBing.classList.remove("selected");
    //   sDeepL.classList.remove("selected");

    //   sYandex.classList.add("selected");
    // };
    // sBing.onclick = () => {
    //   currentTextTranslatorService = "bing";
    //   twpConfig.set("textTranslatorService", "bing");
    //   translateNewInput();

    //   sGoogle.classList.remove("selected");
    //   sYandex.classList.remove("selected");
    //   sBing.classList.remove("selected");
    //   sDeepL.classList.remove("selected");

    //   sBing.classList.add("selected");
    // };
    // sDeepL.onclick = () => {
    //   currentTextTranslatorService = "deepl";
    //   twpConfig.set("textTranslatorService", "deepl");
    //   translateNewInput();

    //   sGoogle.classList.remove("selected");
    //   sYandex.classList.remove("selected");
    //   sBing.classList.remove("selected");
    //   sDeepL.classList.remove("selected");

    //   sDeepL.classList.add("selected");
    // };

    const setTargetLanguage = shadowRoot.getElementById("setTargetLanguage");
    setTargetLanguage.onclick = (e) => {
      if (e.target.getAttribute("value")) {
        const langCode = twpLang.fixTLanguageCode(
          e.target.getAttribute("value")
        );
        if (langCode) {
          currentTargetLanguage = langCode;
          twpConfig.setTargetLanguageTextTranslation(langCode);
          translateNewInput();
        }

        shadowRoot.querySelectorAll("#setTargetLanguage li").forEach((li) => {
          li.classList.remove("selected");
        });

        e.target.classList.add("selected");
      }
    };

    /**
     * Listen
     * @param {*} type "original" or "translated"
     * @param {*} element 
     * @param {*} text 
     * @param {*} language 
     */
    function onListenClick(type, element, text, language) {
      const msgListen = chrome.i18n.getMessage("btnListen");
      const msgStopListening = chrome.i18n.getMessage("btnStopListening");

      eListenOriginal.classList.remove("selected");
      eListenTranslated.classList.remove("selected");
      eListenOriginal.setAttribute("title", msgStopListening);
      eListenTranslated.setAttribute("title", msgStopListening);

      if (isPlayingAudio) {
        stopAudio();
        element.classList.remove("selected");
      } else {
        playAudio(text, language, () => {
          element.classList.remove("selected");
          element.setAttribute("title", msgListen);
        });
        element.classList.add("selected");
      }
    }

    let lastListenAudioType = null;

    /**
     * "Listen" to original text
     */
    eListenOriginal.onclick = async () => {
      let { lang, isReliable } = await detectTextLanguage(
        eOrigText.textContent
      );
      if (!isReliable && originalTabLanguage !== "und") {
        lang = originalTabLanguage;
      }
      if (lastListenAudioType !== "original") {
        stopAudio();
      }
      lastListenAudioType = "original";
      onListenClick("original", eListenOriginal, eOrigText.textContent, lang);
    };

    /**
     * "Listen" to translation
     */
    eListenTranslated.onclick = () => {
      if (lastListenAudioType !== "translated") {
        stopAudio();
      }
      lastListenAudioType = "translated";
      onListenClick(
        "translated",
        eListenTranslated,
        eSelTextTrans.textContent,
        currentTargetLanguage
      );
    };

    document.body.appendChild(divElement);

    chrome.i18n.translateDocument(shadowRoot);

    if (platformInfo.isMobile.any) {
      eButtonTransSelText.style.width = "30px";
      eButtonTransSelText.style.height = "30px";
      document.addEventListener("touchstart", onTouchstart);
    }

    /**
     * Translate when the selection icon is clicked
     */
    eButtonTransSelText.addEventListener("click", onClick);
    document.addEventListener("mousedown", onDown);

    const targetLanguageButtons = shadowRoot.querySelectorAll(
      "#setTargetLanguage li"
    );

    // Target language elements
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

    // "More languages" button and dropdown
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

    // Select language → promote to top favorite, translate, refresh buttons
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
      translateNewInput();

      collapseSelectMore();
    });

    // Close dropdown on blur (but don't trigger translation)
    selectMore.addEventListener("blur", () => {
      setTimeout(() => collapseSelectMore(), 150);
    });

    // Translation engine elements
    // if (currentTextTranslatorService === "yandex") {
    //   sYandex.classList.add("selected");
    // } else if (currentTextTranslatorService == "deepl") {
    //   sDeepL.classList.add("selected");
    // } else if (currentTextTranslatorService == "bing") {
    //   sBing.classList.add("selected");
    // } else {
    //   sGoogle.classList.add("selected");
    // }
    // sGoogle.classList.add("selected");

    // if (twpConfig.get("enableDeepL") === "yes") {
    //   sDeepL.removeAttribute("hidden");
    // } else {
    //   sDeepL.setAttribute("hidden", "");
    // }

    // Whether to show original text in the translation popup
    if (
      twpConfig.get("expandPanelTranslateSelectedText") === "yes" ||
      (prevSelectionInfo &&
        (prevSelectionInfo.isContentEditable ||
          prevSelectionInfo.isInputElement))
    ) {
      origTextContainer.style.display = "block";
      eMore.style.display = "none";
      eLess.style.display = "block";
      eMoreOrLess.setAttribute("title", chrome.i18n.getMessage("hideOriginalText"));
    } else {
      origTextContainer.style.display = "none";
      eMore.style.display = "block";
      eLess.style.display = "none";
      eMoreOrLess.setAttribute("title", chrome.i18n.getMessage("showOriginalText"));
    }

    twpConfig.onChanged((name, newvalue) => {
      switch (name) {
        // case "enableDeepL":
        //   if (newvalue === "yes") {
        //     sDeepL.removeAttribute("hidden");
        //   } else {
        //     sDeepL.setAttribute("hidden", "");
        //   }
        //   break;
        case "expandPanelTranslateSelectedText":
          const prevHeight = parseInt(getComputedStyle(eDivResult).height);
          if (newvalue === "yes") {
            origTextContainer.style.display = "block";
            eMore.style.display = "none";
            eLess.style.display = "block";
            eMoreOrLess.setAttribute("title", chrome.i18n.getMessage("hideOriginalText"));
            eDivResult.style.top =
              parseInt(eDivResult.style.top) +
              (prevHeight - parseInt(getComputedStyle(eDivResult).height)) +
              "px";
          } else {
            origTextContainer.style.display = "none";
            eMore.style.display = "block";
            eLess.style.display = "none";
            eMoreOrLess.setAttribute("title", chrome.i18n.getMessage("showOriginalText"));
            eDivResult.style.top =
              parseInt(eDivResult.style.top) +
              (prevHeight - parseInt(getComputedStyle(eDivResult).height)) +
              "px";
          }
          break;
      }
    });
  }

  /**
   * Destroy the translation popup. Remove listeners
   * @returns 
   */
  function destroy() {
    window.isTranslatingSelected = false;
    fooCount++;
    stopAudio();
    if (!divElement) return;
    eButtonTransSelText.removeEventListener("click", onClick);
    document.removeEventListener("mousedown", onDown);
    if (platformInfo.isMobile.any) {
      document.removeEventListener("touchstart", onTouchstart);
    }
    divElement.remove();
    divElement = eButtonTransSelText = eDivResult = null;
    panelLockedPosition = null;
    panelAppliedRevision = -1;
    sOpenAI = null;
    sGoogle = null;
    updateTranslatorButtonState = null;
  }

  function destroyIfButtonIsShowing(e) {
    if (
      eButtonTransSelText &&
      e.target !== divElement &&
      eButtonTransSelText.style.display === "block"
    ) {
      destroy();
    }
  }

  // Listen for config change events, update in-memory values
  twpConfig.onChanged(function (name, newValue) {
    switch (name) {
      case "textTranslatorService":
        currentTextTranslatorService = newValue;
        activeTextTranslatorService =
          currentTextTranslatorService === "google" ? "google" : "ai";
        if (typeof updateTranslatorButtonState === "function") {
          updateTranslatorButtonState(activeTextTranslatorService);
        }
        break;
      case "targetLanguages":
        currentTargetLanguages = newValue;
        break;
      case "targetLanguageTextTranslation":
        currentTargetLanguage = newValue;
        break;
      case "alwaysTranslateSites":
        alwaysTranslateThisSite = newValue.indexOf(tabHostName) !== -1;
        updateEventListener();
        break;
      case "neverTranslateSites":
        translateThisSite = newValue.indexOf(tabHostName) === -1;
        updateEventListener();
        break;
      case "neverTranslateLangs":
        translateThisLanguage = newValue.indexOf(originalTabLanguage) === -1;
        updateEventListener();
        break;
      case "showTranslateSelectedButton":
        showTranslateSelectedButton = newValue;
        updateEventListener();
        break;
      case "dontShowIfPageLangIsTargetLang":
        dontShowIfPageLangIsTargetLang = newValue;
        updateEventListener();
        break;
      case "dontShowIfPageLangIsUnknown":
        dontShowIfPageLangIsUnknown = newValue;
        updateEventListener();
        break;
      case "dontShowIfSelectedTextIsTargetLang":
        dontShowIfSelectedTextIsTargetLang = newValue;
        break;
      case "dontShowIfSelectedTextIsUnknown":
        dontShowIfSelectedTextIsUnknown = newValue;
        break;
    }
  });

  function clearTranslationLoadingState() {
    if (!eSelTextTrans) return;
    eSelTextTrans.classList.remove("dualtran-loading");
    eSelTextTrans.innerHTML = "";
  }

  function setTranslationLoadingState() {
    if (!eSelTextTrans) return;
    clearTranslationLoadingState();
    eSelTextTrans.classList.add("dualtran-loading");
    const spinner = document.createElement("span");
    spinner.className = "dualtran-loading-spinner";
    const label = document.createElement("span");
    label.className = "dualtran-loading-label";
    label.textContent =
      (chrome && chrome.i18n && chrome.i18n.getMessage("loading")) ||
      "Loading...";
    eSelTextTrans.appendChild(spinner);
    eSelTextTrans.appendChild(label);
  }

  function triggerAiTranslation({ showToastForError = true, showLoading = true } = {}) {
    if (!sOpenAI || !eOrigText) {
      return;
    }

    const sourceText = eOrigText.textContent || "";
    if (!sourceText.trim()) {
      if (showLoading) {
        clearTranslationLoadingState();
      }
      return;
    }

    if (showLoading) {
      setTranslationLoadingState();
    }

    sOpenAI.sourceString = sourceText;
    if (wordsCount(sourceText) === 1) {
      aiTranslateWord([sOpenAI], showToastForError);
    } else {
      aiTranslateText([sOpenAI], showToastForError);
    }
  }

  /**
   * Update the translation display element to show the latest translation
   * @param {string} result Translation content
   * @param {{ skipTextUpdate?: boolean }} [options] Whether to skip updating the translation text
   */
  function update_eDivResult(result = "", { skipTextUpdate = false } = {}) {
    if (!eDivResult || eDivResult.style.display !== "block") {
      init();
    }

    const applyLayout = () => {
      if (!prevSelectionInfo || !eDivResult || !eSelTextTrans) {
        return;
      }

      const eTop = prevSelectionInfo.bottom;
      const eLeft = prevSelectionInfo.left;

      let shouldRevealAfterLayout = false;
      // Always show popup skeleton
      if (eDivResult.style.display !== "block") {
        eDivResult.style.visibility = "hidden";
        eDivResult.style.display = "block";
        shouldRevealAfterLayout = true;
      }

      // Set translation text direction
      if (twpLang.isRtlLanguage(currentTargetLanguage)) {
        eSelTextTrans.setAttribute("dir", "rtl");
      } else {
        eSelTextTrans.setAttribute("dir", "ltr");
      }

      if (!skipTextUpdate) {
        clearTranslationLoadingState();
        const normalizedResult =
          typeof result === "string" ? result : result == null ? "" : String(result);
        eSelTextTrans.textContent = normalizedResult;
      }

      let top;
      let left;
      const needRecompute = !panelLockedPosition || panelAppliedRevision !== panelLayoutRevision;

      if (needRecompute) {
        top = eTop + 5;
        left = eLeft;

        const computed = getComputedStyle(eDivResult);
        const computedHeight = parseInt(computed.height, 10);
        const computedWidth = parseInt(computed.width, 10);
        const fallbackHeight = Number.isFinite(computedHeight) && computedHeight > 0
          ? computedHeight
          : eDivResult.offsetHeight || 200;
        const fallbackWidth = Number.isFinite(computedWidth) && computedWidth > 0
          ? computedWidth
          : eDivResult.offsetWidth || 280;

        top = Math.max(0, top);
        top = Math.min(window.innerHeight - fallbackHeight, top);

        left = Math.max(0, left);
        left = Math.min(window.innerWidth - fallbackWidth, left);

        panelLockedPosition = { top, left };
        panelAppliedRevision = panelLayoutRevision;
      } else if (panelLockedPosition) {
        ({ top, left } = panelLockedPosition);
      }

      if (typeof top === "number") {
        eDivResult.style.top = `${top}px`;
      }
      if (typeof left === "number") {
        eDivResult.style.left = `${left}px`;
      }

      if (shouldRevealAfterLayout) {
        requestAnimationFrame(() => {
          if (!eDivResult) return;
          eDivResult.style.visibility = "visible";
        });
      }
    };

    applyLayout();

    if (!isCSSLoaded) {
      const currentFooCount = fooCount;
      onCSSLoad = () => {
        onCSSLoad = null;
        if (currentFooCount !== fooCount) return;
        applyLayout();
      };
    }
  }

  // Prevent default button click behavior from collapsing page selection (preserve original page text highlight)
  if (eButtonTransSelText && typeof eButtonTransSelText.addEventListener === "function") {
    eButtonTransSelText.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
    });
  }
  /**
   * Translate newly input text
   */
  function translateNewInput() {
    fooCount++;
    stopAudio();
    if (sGoogle) {
      clearGoogleSuccessIndicator(sGoogle);
    }

    if (activeTextTranslatorService === "ai") {
      triggerAiTranslation({ showToastForError: true });
      return;
    }

    const currentFooCount = fooCount;
    setTranslationLoadingState();

    const translationPromise = backgroundTranslateSingleText(
      currentTextTranslatorService,
      currentTargetLanguage,
      eOrigText.textContent
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
        console.log("result of backgroundTranslateSingleText:", result);
        if (currentFooCount !== fooCount) return;

        update_eDivResult(result);
        if (currentTextTranslatorService === "google" && sGoogle) {
          renderGoogleSuccessIndicator(sGoogle);
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

        update_eDivResult(toastMsg);
      });

    translationPromise.catch((promiseError) => {
      console.warn("backgroundTranslateSingleText error:", promiseError);
    });
  }

  /**
   * Translate selected text, update the translation element in the popup
   * @param {*} usePrevSelectionInfo 
   * @returns 
   */
  function translateSelText(usePrevSelectionInfo = false) {
    if (!usePrevSelectionInfo && gSelectionInfo) {
      prevSelectionInfo = gSelectionInfo;
    } else if (!(usePrevSelectionInfo && prevSelectionInfo)) {
      return;
    }

    panelLayoutRevision += 1;
    panelLockedPosition = null;
    panelAppliedRevision = -1;

    update_eDivResult("", { skipTextUpdate: true });
    if (eOrigText) {
      eOrigText.textContent = prevSelectionInfo.text;
    }
    setTranslationLoadingState();
    translateNewInput();
  }

  /**
   * Translate selected text, hide the selection icon button
   * @param {*} e 
   */
  function onClick(e) {
    translateSelText();
    eButtonTransSelText.style.display = "none";
  }

  /**
   * Hide the translation popup when clicking outside of it
   * @param {*} e 
   */
  function onDown(e) {
    if (e.target != divElement) {
      eDivResult.style.display = "none";
      eButtonTransSelText.style.display = "none";
      destroy();
    }
  }

  let isTouchSelection = false;

  function onTouchstart(e) {
    isTouchSelection = true;
    onDown(e);
  }

  /**
   * Get selected text
   * @returns 
   */
  function getSelectionText() {
    let text = "";
    const activeEl = document.activeElement;
    const activeElTagName = activeEl ? activeEl.tagName.toLowerCase() : null;
    if (
      activeElTagName == "textarea" ||
      (activeElTagName == "input" &&
        /^(?:text|search)$/i.test(activeEl.type) &&
        typeof activeEl.selectionStart == "number")
    ) {
      text = activeEl.value.slice(
        activeEl.selectionStart,
        activeEl.selectionEnd
      );
    } else if (window.getSelection) {
      text = window.getSelection().toString();
    }
    return text;
  }

  /**
   * Read selected text for translation
   * @param {*} dontReadIfSelectionDontChange 
   * @returns 
   */
  function readSelection(dontReadIfSelectionDontChange = false) {
    let newSelectionInfo = null;

    const activeEl = document.activeElement;
    const activeElTagName = activeEl ? activeEl.tagName.toLowerCase() : null;
    if (
      activeElTagName == "textarea" ||
      (activeElTagName == "input" &&
        /^(?:text|search)$/i.test(activeEl.type) &&
        typeof activeEl.selectionStart == "number")
    ) {
      const text = activeEl.value.slice(
        activeEl.selectionStart,
        activeEl.selectionEnd
      );
      const rect = activeEl.getBoundingClientRect();
      newSelectionInfo = {
        isInputElement: true,
        isContentEditable: false,
        element: activeEl,
        selStart: activeEl.selectionStart,
        selEnd: activeEl.selectionEnd,
        text: text,
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      };
    } else if (window.getSelection) {
      const selection = window.getSelection();
      if (selection.type == "Range") {
        const text = selection.toString();
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        newSelectionInfo = {
          isInputElement: false,
          isContentEditable:
            selection.focusNode.nodeType === 3
              ? selection.focusNode.parentNode.isContentEditable
              : selection.focusNode.isContentEditable,
          element: selection.focusNode,
          selStart: selection.getRangeAt(0).startOffset,
          selEnd: selection.getRangeAt(0).endOffset,
          text: text,
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          range: selection.getRangeAt(0),
        };
      }
    }

    if (
      dontReadIfSelectionDontChange &&
      gSelectionInfo &&
      newSelectionInfo &&
      gSelectionInfo.text === newSelectionInfo.text
    ) {
      gSelectionInfo = newSelectionInfo;
      return false;
    }
    gSelectionInfo = newSelectionInfo;
    return true;
  }

  /**
   * Show the selection icon (called when mouse button is released or touch ends)
   * @param {*} e 
   * @returns 
   */
  async function onUp(e) {
    if (e.target == divElement) return;

    const clientX = Math.max(
      typeof e.clientX === "undefined" ? 0 : e.clientX,
      typeof e.changedTouches === "undefined" ? 0 : e.changedTouches[0].clientX
    );
    const clientY = Math.max(
      typeof e.clientY === "undefined" ? 0 : e.clientY,
      typeof e.changedTouches === "undefined" ? 0 : e.changedTouches[0].clientY
    );

    const selectedText = getSelectionText().trim();
    if (!selectedText || selectedText.length < 1) return;
    let detectedLanguage = (await detectTextLanguage(selectedText)).lang;
    if (!detectedLanguage) detectedLanguage = "und";

    if (
      ((dontShowIfSelectedTextIsTargetLang == "yes" &&
        detectedLanguage !== currentTargetLanguage) ||
        dontShowIfSelectedTextIsTargetLang != "yes") &&
      ((dontShowIfSelectedTextIsUnknown == "yes" &&
        detectedLanguage !== "und") ||
        dontShowIfSelectedTextIsUnknown != "yes")
    ) {
      init();
      if (platformInfo.isMobile.any) {
        eButtonTransSelText.style.left = window.innerWidth - 45 + "px";
        eButtonTransSelText.style.top = clientY + "px";
      } else {
        eButtonTransSelText.style.left =
          Math.min(window.innerWidth - 40, clientX + 25) + "px";
        eButtonTransSelText.style.top = Math.max(2, clientY - 35) + "px";
      }

      // Show the selection icon
      eButtonTransSelText.style.display = "block";
    }
  }

  let showButtonTimerHandler = null;

  /**
   * When MouseUp is triggered, read selected text and show the selection icon
   * @param {*} e 
   * @returns 
   */
  function onMouseup(e) {
    if (e.button != 0) return;
    if (e.target == divElement) return;
    if (readSelection(true)) {
      clearTimeout(showButtonTimerHandler);
      showButtonTimerHandler = setTimeout(() => onUp(e), 150);
    }
  }

  /**
   * When touchEnd is triggered, read selected text and show the selection icon
   * @param {*} e 
   * @returns 
   */
  function onTouchend(e) {
    if (e.target == divElement) return;
    readSelection();
    clearTimeout(showButtonTimerHandler);
    showButtonTimerHandler = setTimeout(() => onUp(e), 150);
  }

  /**
   * When selection changes, read the selected text
   * @param {*} e 
   */
  function onSelectionchange(e) {
    if (isTouchSelection) {
      readSelection();
    }
  }

  /**
   * Check if the current selection contains text
   * @returns 
   */
  function isSelectingText() {
    const activeEl = document.activeElement;
    const activeElTagName = activeEl ? activeEl.tagName.toLowerCase() : null;
    if (
      activeElTagName == "textarea" ||
      (activeElTagName == "input" &&
        /^(?:text|search)$/i.test(activeEl.type) &&
        typeof activeEl.selectionStart == "number")
    ) {
      const text = activeEl.value.slice(
        activeEl.selectionStart,
        activeEl.selectionEnd
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

  /**
   * When KeyUp is triggered, read selected text and translate immediately
   * @param {*} e 
   * @returns 
   */
  function onKeyUp(e) {
    if (twpConfig.get("translateSelectedWhenPressTwice") !== "yes") return;
    if (e.key == "Control") {
      if (
        lastTimePressedCtrl &&
        performance.now() - lastTimePressedCtrl < 280 &&
        isSelectingText()
      ) {
        lastTimePressedCtrl = performance.now();
        readSelection();
        init();
        translateSelText();
      }
      lastTimePressedCtrl = performance.now();
    }
  }

  document.addEventListener("keyup", onKeyUp);

  let windowIsInFocus = true;
  window.addEventListener("focus", function (e) {
    windowIsInFocus = true;
    chrome.runtime.sendMessage({ action: "thisFrameIsInFocus" });
  });
  window.addEventListener("blur", function (e) {
    windowIsInFocus = false;
  });

  window.addEventListener("beforeunload", function (e) {
    destroy();
  });

  function updateEventListener() {
    if (
      showTranslateSelectedButton == "yes" &&
      (alwaysTranslateThisSite ||
        (translateThisSite && translateThisLanguage)) &&
      ((dontShowIfPageLangIsTargetLang == "yes" &&
        originalTabLanguage !== currentTargetLanguage) ||
        dontShowIfPageLangIsTargetLang != "yes") &&
      ((dontShowIfPageLangIsUnknown == "yes" &&
        originalTabLanguage !== "und") ||
        dontShowIfPageLangIsUnknown != "yes")
    ) {
      document.addEventListener("mouseup", onMouseup);

      document.addEventListener("blur", destroyIfButtonIsShowing);
      document.addEventListener("visibilitychange", destroyIfButtonIsShowing);

      document.addEventListener("keydown", destroyIfButtonIsShowing);
      document.addEventListener("mousedown", destroyIfButtonIsShowing);
      document.addEventListener("wheel", destroyIfButtonIsShowing);

      if (platformInfo.isMobile.any) {
        document.addEventListener("touchend", onTouchend);
        document.addEventListener("selectionchange", onSelectionchange);
      }
    } else {
      document.removeEventListener("mouseup", onMouseup);

      document.removeEventListener("blur", destroyIfButtonIsShowing);
      document.removeEventListener(
        "visibilitychange",
        destroyIfButtonIsShowing
      );

      document.removeEventListener("keydown", destroyIfButtonIsShowing);
      document.removeEventListener("mousedown", destroyIfButtonIsShowing);
      document.removeEventListener("wheel", destroyIfButtonIsShowing);

      if (platformInfo.isMobile.any) {
        document.removeEventListener("touchend", onTouchend);
        document.removeEventListener("selectionchange", onSelectionchange);
      }
    }
  }

  updateEventListener();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TranslateSelectedText") {
      readSelection();
      init();
      translateSelText();
    } else if (request.action === "anotherFrameIsInFocus") {
      if (!windowIsInFocus) {
        destroy();
      }
    } else if (request.action === "hotTranslateSelectedText") {
      readSelection();
      const prevSelInfo = gSelectionInfo;
      if (
        !prevSelInfo?.element?.focus &&
        !prevSelInfo?.element?.parentNode?.focus
      )
        return;
      if (prevSelInfo.isInputElement && prevSelInfo.readOnly) return;
      if (prevSelInfo.text) {
        backgroundTranslateSingleText(
          currentTextTranslatorService,
          currentTargetLanguage,
          prevSelInfo.text
        ).then((result) => {
          if (!result) return;
          destroy();
          if (prevSelInfo.element.nodeType === 3) {
            prevSelInfo.element.parentNode.focus();
          } else {
            prevSelInfo.element.focus();
          }
          document.execCommand("selectAll", false);
          if (prevSelInfo.isInputElement) {
            prevSelInfo.element.setSelectionRange(
              prevSelInfo.selStart,
              prevSelInfo.selEnd
            );
          } else if (prevSelInfo.isContentEditable) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(prevSelInfo.range);
          }
          document.execCommand("insertText", false, result);
        });
      }
    }
  });

});

export { aiTranslateWord }
export default translateSelected
