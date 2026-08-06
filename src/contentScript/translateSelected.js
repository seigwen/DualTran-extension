/**
 * 划词翻译。
 * 
 * 用户在网页上选择文本后, 显示划词按钮, 点击划词按钮后, 即弹出翻译窗口并进行翻译. 允许用户选择翻译引擎和目标语言, 还允许复制译文, 朗读原文和译文等.
 * 
 * 本文件适用于chrome浏览器。chrome等没有browserAction.setPopup接口的浏览器,需要从sw.js向contentScript发送消息,content script里再调用translateSelected.js里的相关函数弹出翻译窗口(动态创建的div)
 * 对于firefox等有browserAction.setPopup接口的浏览器,可以在sw.js直接调用browserAction.setPopup()弹出\src\popup\popup-translate-text.html
 */

// DONE: 对单词进行AI翻译时, 词源不是以目标语言解释的。已修复


// TODO: 提高语言检测准确性: 对单个单词进行语言检测时,很容易检测错误,比如properties/represents等会检测为德文
// TODO: 对is这个单词进行AI翻译时,会列出非常非常多的义项,其实根本没必要

const TRANSLATION_TIMEOUT_MS = 10000; // 超时时间（毫秒）

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

// 这个对象没有被用到??
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
 * 用AI翻译
 * @param {Array<Element>} toBeTranslated 
 * @returns 
 */
let aiTranslateWord = async (toBeTranslated, showToastForError = true) => {
  /** @type {any} */
  let btnAi = toBeTranslated[0]
  let hasAiStreamError = false

  // contentSequence为空字符串, 则退出
  if (!(btnAi.sourceString.trim().length)) {
    console.log("contentSequence为空字符串")
    return
  }

  // 如果正在翻译中, 则退出
  btnAi.translationStatus = "queuing"
  btnAi.btnAiTxtNode.textContent = "queuing"

  // 目标语言采用“文本翻译”的目标语言
  const targetLanguageCodeForAI = twpConfig.get("targetLanguageTextTranslation") || twpConfig.get("targetLanguage")
  // 如果缓存里有相同原文且相同目标语言,则直接使用缓存
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

  // 开始翻译
  let accumulatedText = ""

  // 定义响应解析函数
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
      console.log("解析响应出错1", parsedChunk.error)
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
      console.log("解析响应出错2", e)
    }
  }

  // 定义错误处理函数
  let onError = (err) => {
    hasAiStreamError = true
    chrome.runtime.sendMessage({
      action: "recordNewRequestToOpenAI",
      result: "failed",
      timeStamp: Date.now()
    })

    // 构造错误提示文案：若为超时，显示“server response timeout”；否则同时展示 code 与 message（若存在）
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

  // 定义完成处理函数
  let onFinished = () => {
    if (hasAiStreamError) {
      console.log("onFinished skipped due to previous error")
      return
    }
    console.log("onFinished is called")
    // 确保移除 loading 状态
    applyAiSuccessState(btnAi, {
      translatedTextColor: twpConfig.get("aiTranslatedColor"),
      tooltipText: "AI translated successfully!",
      titleText: "AI translated successfully!",
    })
    // 写入缓存（按原文 + 目标语言区分）
    try {
      aiCache.push({
        original: btnAi.sourceString,
        targetLanguage: targetLanguageCodeForAI,
        translated: btnAi.translatedTextNode?.textContent || ""
      })
    } catch (_) { }
  }

  // 构建中止控制器
  const controller = new AbortController();
  abortControllers.push(controller)
  const signal = controller.signal;

  // 开始调用AI翻译
  translateWithAI(btnAi.sourceString, onMessage, onError, onFinished, signal, true, targetLanguageCodeForAI)
}

Promise.all([twpConfig.onReady(), getTabHostName()]).then(function (_) {
  console.log("translateSelected.js promise.all is resolved")

  const tabHostName = _[1];

  /**
   * 选定文本的信息
   */
  let gSelectionInfo;
  /**
   * 上一次选定文本的信息
   */
  let prevSelectionInfo;

  /**
   * 划词窗口的父元素(shwoDOM的host)
   */
  let divElement;
  /**
   * 划词后显示的图标按钮(点击后显示划词窗口)
   */
  let eButtonTransSelText;
  /**
   * 划词窗口
   */
  let eDivResult;
  /**
   * 显示译文的元素
   */
  let eSelTextTrans;
  /**
   * 显示原始文本的元素
   */
  let eOrigText;
  /**
   * 显示原始文本的元素的父元素
   */
  let origTextContainer;
  let sOpenAI = null;
  let sGoogle = null;
  let updateTranslatorButtonState = null;

  /**
   * 从配置文件获取配置, 赋值给内存变量
   */

  // tab原语言
  let originalTabLanguage = "und";
  // 当前目标语言列表
  let currentTargetLanguages = twpConfig.get("targetLanguages");
  // 当前目标语言
  let currentTargetLanguage = twpConfig.get("targetLanguageTextTranslation");
  // 当前翻译服务
  let currentTextTranslatorService = twpConfig.get("textTranslatorService") || "google";
  let activeTextTranslatorService =
    currentTextTranslatorService === "google" ? "google" : "ai";
  // 总是翻译此网站
  let alwaysTranslateThisSite =
    twpConfig.get("alwaysTranslateSites").indexOf(tabHostName) !== -1;
  // 可翻译此网站(从不翻译此网站的反值)
  let translateThisSite =
    twpConfig.get("neverTranslateSites").indexOf(tabHostName) === -1;
  // 可翻译此语言(从不翻译此语言的反值)
  let translateThisLanguage =
    twpConfig.get("neverTranslateLangs").indexOf(originalTabLanguage) === -1;
  // 是否在选中文本侧边显示"翻译"图标
  let showTranslateSelectedButton = twpConfig.get(
    "showTranslateSelectedButton"
  );
  // 当语言是目标语言时不显示划词翻译弹出框
  let dontShowIfPageLangIsTargetLang = twpConfig.get(
    "dontShowIfPageLangIsTargetLang"
  );
  // 当语言是未知语言时不显示划词翻译弹出框
  let dontShowIfPageLangIsUnknown = twpConfig.get(
    "dontShowIfPageLangIsUnknown"
  );
  // 当选中文本是目标语言时不显示划词翻译弹出框
  let dontShowIfSelectedTextIsTargetLang = twpConfig.get(
    "dontShowIfSelectedTextIsTargetLang"
  );
  // 当选中文本是目标语言时不显示划词翻译弹出框
  let dontShowIfSelectedTextIsUnknown = twpConfig.get(
    "dontShowIfSelectedTextIsUnknown"
  );
  let fooCount = 0;
  let panelLayoutRevision = 0;
  let panelLockedPosition = null;
  let panelAppliedRevision = -1;

  // 获取页面原始语言, 更新对应变量
  pageTranslator.onGetOriginalTabLanguage(function (tabLanguage) {
    originalTabLanguage = tabLanguage;
    translateThisLanguage =
      twpConfig.get("neverTranslateLangs").indexOf(originalTabLanguage) === -1;
    updateEventListener();
  });

  let isPlayingAudio = false;

  /**
   * 播放音频
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
   * @returns 停止播放音频
   */
  function stopAudio() {
    if (!isPlayingAudio) return;
    isPlayingAudio = false;
    chrome.runtime.sendMessage({
      action: "stopAudio",
    });
  }

  /**
   * 拖曳划词翻译窗口(鼠标放在划词窗口最下面一行时进行拖曳)
   * @param {*} elmnt 划词窗口
   * @param {*} elmnt2 拖曳时鼠标所在元素
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
     * 当mouseDown发生在拖曳栏时, 添加mouseMove和mouseUp监听
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
     * 此函数是mouseMove事件的响应函数. 
     * 获取moveMove事件坐标值, 然后据此调整划词翻译窗口的坐标值
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
     * 此函数是mouseup事件的响应函数
     * 去除mouseup和mouseMove事件的监听
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
   * 初始化并显示划词窗口
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

    // 划词翻译窗的HTML
    shadowRoot.innerHTML = `
    <!--划词后显示的图标按钮(点击后显示划词窗口)-->
    <div id="eButtonTransSelText" style="display: none"></div>
    <!--划词窗口-->
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

      <!--原文部分-->
			<div id="origTextContainer">
        <!--原文-->
				<div>
					<div id="eOrigText" contentEditable="true" spellcheck="false" dir="auto"></div>
					<hr>
				</div>
				<ul>
          <!--"朗读"按钮-->
          <li title="Listen" data-i18n-title="btnListen" id="listenOriginal">
            <!--"复制"按钮-->
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
      <!--译文部分-->
			<div id="transTextContainer">
        <!--译文-->
				<div id="eSelTextTrans" dir="auto"></div>
        <!--按钮行-->
				<ul>
          <!--朗读译文按钮-->
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
          <!--复制译文按钮-->
					<li title="Copy" data-i18n-title="btnCopy" id="copy">
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M13 7H7V5H13V7Z" fill="currentColor" />
						<path d="M13 11H7V9H13V11Z" fill="currentColor" />
						<path d="M7 15H13V13H7V15Z" fill="currentColor" />
						<path fill-rule="evenodd" clip-rule="evenodd" d="M3 19V1H17V5H21V23H7V19H3ZM15 17V3H5V17H15ZM17 7V19H9V21H19V7H17Z" fill="currentColor"/>
						</svg>
					</li>
          <!--???按钮-->
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
      <!--按钮栏-->
      <div style="display: flex; justify-content: space-between; flex-direction: row;">
        <!--目标语言-->
        <ul id="setTargetLanguage" style="position:relative;">
          <li value="en" title="English">en</li>
          <li value="es" title="Spanish">es</li>
          <li value="de" title="German">de</li>
          <li id="btnMoreTargetLang" title="More languages">+</li>
          <select id="selectMoreTargetLang" style="display:none; position:absolute; bottom:100%; left:0; max-width:140px; font-size:12px; padding:2px; background:#1c1b1b; color:#fff; border:1px solid #555; border-radius:3px;"></select>
        </ul>
        <!--是否显示原文-->
        <div id="moreOrLess" style="display:block"><i class="arrow up" id="showOriginalText"></i><i class="arrow down" id="hideOriginalText"></i></div>        
        <!--翻译服务-->
        <ul>
          <li title="Google" id="sGoogle">google</li>
          <li title="openAI" id="sOpenAI" style="color: white;">
            <span id="btnAiTxtNode">AI</span>
          </li>
        </ul>
      </div>
		</div>
        `;

    // 插入划词翻译框需要的CSS 
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

    // 模拟btnAi
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

    // 将 tooltip 文案同步到原生 title（避免默认 title="openAI" 导致悬浮只显示固定文案）
    try { sOpenAI.setAttribute("title", tooltip.textContent || "") } catch (_) { }
    try {
      const syncTitle = () => {
        try { sOpenAI.setAttribute("title", tooltip.textContent || "") } catch (_) { }
      };
      const observer = new MutationObserver(syncTitle);
      observer.observe(tooltip, { childList: true, characterData: true, subtree: true });
      // 立即同步一次
      syncTitle();
    } catch (_) { }

    sOpenAI.addEventListener("click", () => {
      if (!eOrigText.textContent.trim().length) {
        return;
      }
      setTranslatorButtonState("ai");
      triggerAiTranslation({ showToastForError: true });
    })
    if (twpConfig.get("autoImproveByAI") === "yes") {
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
     * 原始文本的"朗读"按钮
     */
    const eListenOriginal = shadowRoot.getElementById("listenOriginal");
    /**
     * 译文的"朗读"按钮
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
     * 复制翻译后文本  
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
     * 把旧文本替换为新文本
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
      // 复位
      btnAiTxtNode.textContent = "AI"
      // 重置 tooltip 文案并同步到 title，避免保留上一次错误/成功提示
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

    // "更多/更少"按钮的点击事件响应
    eMoreOrLess.onclick = () => {
      if (twpConfig.get("expandPanelTranslateSelectedText") === "no") {
        twpConfig.set("expandPanelTranslateSelectedText", "yes");
      } else {
        twpConfig.set("expandPanelTranslateSelectedText", "no");
      }
      // 保持页面原有选区，不在面板展开/收起时强制将光标移动到面板输入框
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
     * 朗读
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
     * "朗读"原文
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
     * "朗读"译文
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
     * 点击划词图标后,进行翻译
     */
    eButtonTransSelText.addEventListener("click", onClick);
    document.addEventListener("mousedown", onDown);

    const targetLanguageButtons = shadowRoot.querySelectorAll(
      "#setTargetLanguage li"
    );

    // 目标语言元素
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

    // "更多语言"按钮和下拉框
    const btnMore = shadowRoot.getElementById("btnMoreTargetLang");
    const selectMore = shadowRoot.getElementById("selectMoreTargetLang");

    // 填充全部语言到下拉框
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

    /** 刷新三个语言按钮的显示文本和高亮状态 */
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
      // 高亮匹配的按钮
      const activeIdx = langs.indexOf(currentTargetLanguage);
      if (activeIdx >= 0 && activeIdx < 3) {
        targetLanguageButtons[activeIdx].classList.add("selected");
      } else {
        btnMore.classList.add("selected");
      }
    }

    // 点击"+"按钮 → 展开为多行列表，直接显示所有语言
    btnMore.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectMore.querySelectorAll("option").forEach((opt) => {
        opt.selected = (opt.value === currentTargetLanguage);
      });

      // 定位：用 fixed 定位避免被弹窗裁切
      const btnRect = btnMore.getBoundingClientRect();
      selectMore.style.position = "fixed";
      selectMore.style.top = "auto";
      selectMore.style.bottom = (window.innerHeight - btnRect.top) + "px";
      selectMore.style.left = btnRect.left + "px";
      selectMore.style.zIndex = "2147483647";

      selectMore.size = Math.min(sorted.length, 15); // 展开为可见列表（最多15行）
      selectMore.style.display = "inline-block";
      btnMore.style.display = "none";
      selectMore.focus();
    });

    // 收起下拉框
    function collapseSelectMore() {
      selectMore.size = 1;
      selectMore.style.display = "none";
      btnMore.style.display = "";
    }

    // 选择语言 → 提升为首选收藏，翻译，刷新按钮
    selectMore.addEventListener("change", () => {
      const code = selectMore.value;
      if (!code) return;

      // 将该语言提升为首选收藏语言
      let langs = twpConfig.get("targetLanguages") || [];
      langs = langs.filter((l) => l !== code); // 去重
      langs.unshift(code);                     // 插入首位
      langs = langs.slice(0, 3);               // 只保留前 3 个
      twpConfig.set("targetLanguages", langs);

      currentTargetLanguage = code;
      twpConfig.setTargetLanguageTextTranslation(code);
      refreshLanguageButtons();
      translateNewInput();

      collapseSelectMore();
    });

    // 失焦时关闭下拉框（但不触发翻译）
    selectMore.addEventListener("blur", () => {
      setTimeout(() => collapseSelectMore(), 150);
    });

    // 翻译引擎元素
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

    // 划词翻译窗口是否显示原文
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
   * 销毁划词翻译窗口. 移除监听
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

  // 监听配置变更事件, 更新内存里的值
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
   * 更新译文显示元素以显示最新的译文
   * @param {string} result 译文内容
   * @param {{ skipTextUpdate?: boolean }} [options] 是否跳过更新译文文本
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
      // 始终显示弹窗骨架
      if (eDivResult.style.display !== "block") {
        eDivResult.style.visibility = "hidden";
        eDivResult.style.display = "block";
        shouldRevealAfterLayout = true;
      }

      // 设置译文显示方向
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

  // 防止点击按钮时默认行为导致页面选区折叠（保持原页面选中文本高亮）
  if (eButtonTransSelText && typeof eButtonTransSelText.addEventListener === "function") {
    eButtonTransSelText.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
    });
  }
  /**
   * 翻译输入的新文本
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
   * 翻译选中文本, 更新划词翻译窗口的译文元素
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
   * 翻译选中文本,隐藏划词图标按钮
   * @param {*} e 
   */
  function onClick(e) {
    translateSelText();
    eButtonTransSelText.style.display = "none";
  }

  /**
   * 当点击划词窗口以外区域时, 隐藏划词窗口
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
   * 获取选定文本
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
   * 读取选中文本, 以便翻译
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
   * 显示划词图标 (当鼠标点击up或触摸完成时, 会调用本函数)
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

      // 显示划词图标
      eButtonTransSelText.style.display = "block";
    }
  }

  let showButtonTimerHandler = null;

  /**
   * 当触发MouseUp时, 读取选取区域文字, 并且显示划词图标
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
   * 当触发touchEnd时, 读取选取区域文字, 并且显示划词图标
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
   * 当选定发生变更时, 读取选定区域文字
   * @param {*} e 
   */
  function onSelectionchange(e) {
    if (isTouchSelection) {
      readSelection();
    }
  }

  /**
   * 判断当前选定的是否包含文本
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
   * 当触发KeyUp时, 读取选取区域文字, 并且立即翻译
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
