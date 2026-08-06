/**
 * 在移动平台上显示的弹出窗口
 */

console.log("popupMobile.js is running")

import twpLang from "../lib/languages.js"
import twpConfig from "../lib/config.js"
import platformInfo from "../lib/platformInfo.js"
import { pageTranslator } from "./pageTranslator.js"

var popupMobile = {};

/**
 * 获取tab的主机名
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
  console.log("popupMobile.js is still running")
  const tabHostName = _[1];
  // 非移动平台, 退出本JS
  if (!platformInfo.isMobile.any) return;

  const htmlMobile = `
    <link rel="stylesheet" href="${chrome.runtime.getURL(
    "/contentScript/css/popupMobile.css"
  )}">
    
    <div id='element'>
    <div id='main'>
        <img id="iconTranslate">
        <button id="btnOriginal" class="item button" data-i18n="btnMobileOriginal">Original</button>
        <button id="btnTranslate" class="item button" data-i18n="btnMobileTranslated">Translated</button>
        <button id="spin" class="item button">
            <div class="loader button"></div>
        </button>
        <button id="btnMenu" class="item2">
            <div class="dropup">
                <div id="menu" class="dropup-content">
                    <a id="btnChangeLanguages" data-i18n="btnChangeLanguages">Change languages</a>
                    <a id="btnTranslateSelectedText" data-i18n="msgTranslateSelectedText">Translate selected text</a>
                    <a id="btnNeverTranslate" data-i18n="btnNeverTranslate">Never translate this site</a>
                    <a id="neverTranslateThisLanguage" data-i18n="btnNeverTranslateThisLanguage" display="none">Never translate this language</a>
                    <a id="btnMoreOptions" data-i18n="btnMoreOptions">More options</a>
                </div>
            </div>
            <div class="dropup">
                <div id="menuSelectLanguage" class="dropup-content"></div>
            </div>
            <div class="menuDot"></div>
            <div class="menuDot"></div>
            <div class="menuDot"></div>
        </button>
        <button id="btnClose" class="item">&times;</button>
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
  let showPopupMobile = twpConfig.get("showPopupMobile");

  // 监听配置变更事件
  twpConfig.onChanged(function (name, newValue) {
    switch (name) {
      // 总是翻译的网站
      case "alwaysTranslateSites":
        alwaysTranslateThisSite = newValue.indexOf(tabHostName) !== -1;
        console.log("will show mobile popup, 1111111")
        popupMobile.show();
        break;
      // 从不翻译的网站
      case "neverTranslateSites":
        translateThisSite = newValue.indexOf(tabHostName) === -1;
        console.log("will show mobile popup, 2222222")
        popupMobile.show();
        break;
      // 从不翻译的语言
      case "neverTranslateLangs":
        translateThisLanguage =
          originalTabLanguage === "und" ||
          (currentTargetLanguage !== originalTabLanguage &&
            newValue.indexOf(originalTabLanguage) === -1);
        console.log("will show mobile popup, 3333333")
        popupMobile.show();
        break;
      // 显示弹出窗口
      case "showPopupMobile":
        showPopupMobile = newValue;
        console.log("will show mobile popup, 4444444")
        popupMobile.show();
        break;
    }
  });

  let divElement;
  let getElemById;

  /**
   * 隐藏菜单
   * @param {*} e 
   * @returns 
   */
  function hideMenu(e) {
    if (!divElement) return;
    if (e.target === divElement) return;

    getElemById("menuSelectLanguage").style.display = "none";
    getElemById("menu").style.display = "none";
  }

  let pageLanguageState = "original";
  pageTranslator.onPageLanguageStateChange((_pageLanguageState) => {
    pageLanguageState = _pageLanguageState;
  });

  /**
   * 隐藏弹出窗口
   * @returns 
   */
  popupMobile.hide = function () {
    if (!divElement) return;

    divElement.remove();
    divElement = getElemById = null;

    document.removeEventListener("blur", hideMenu);
    document.removeEventListener("click", hideMenu);
  };

  /**
   * 显示popup弹出窗口
   * @param {*} forceShow 
   * @returns 
   */
  popupMobile.show = function (forceShow = false) {
    popupMobile.hide();

    if (
      !forceShow &&
      ((!alwaysTranslateThisSite &&
        (!translateThisSite || !translateThisLanguage)) ||
        showPopupMobile !== "yes")
    )
      return;

    divElement = document.createElement("div");
    divElement.style = "all: initial";
    divElement.classList.add("notranslate");

    const shadowRoot = divElement.attachShadow({
      mode: "closed",
    });
    shadowRoot.innerHTML = htmlMobile;

    document.body.appendChild(divElement);

    // 国际化该popup
    chrome.i18n.translateDocument(shadowRoot);

    /**
     * 开启暗黑模式
     */
    function enableDarkMode() {
      if (!shadowRoot.getElementById("darkModeElement")) {
        const el = document.createElement("style");
        el.setAttribute("id", "darkModeElement");
        el.setAttribute("rel", "stylesheet");
        el.textContent = `
                div, button, select, option {
                    color: rgb(231, 230, 228);
                    background-color: #181a1b !important;
                }
            
                a {
                    color: rgb(231, 230, 228) !important;
                    background-color: #181a1b;
                }
            
                .dropup-content a:hover {
                    background-color: #454a4d;
                }
            
                .menuDot {
                    background-color: rgb(231, 230, 228) !important;
                }
                `;
        shadowRoot.appendChild(el);
      }
    }

    /**
     * 关闭暗黑模式
     */
    function disableDarkMode() {
      if (shadowRoot.getElementById("#darkModeElement")) {
        shadowRoot.getElementById("#darkModeElement").remove();
      }
    }

    // 根据配置决定是否开启暗黑模式
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

    if (pageLanguageState === "original") {
      getElemById("btnOriginal").style.color = "#2196F3";
      getElemById("btnTranslate").style.color = null;
    } else {
      getElemById("btnOriginal").style.color = null;
      getElemById("btnTranslate").style.color = "#2196F3";
    }

    /**
     * 翻译整页
     * @param {*} targetLanguage 
     */
    function translatePage(targetLanguage = currentTargetLanguage) {
      getElemById("menuSelectLanguage").style.display = "none";
      getElemById("menu").style.display = "none";

      if (targetLanguage !== currentTargetLanguage) {
        currentTargetLanguage = targetLanguage;
        twpConfig.setTargetLanguage(targetLanguage, true);
      }
      pageTranslator.translatePage(targetLanguage);

      getElemById("btnOriginal").style.color = null;
      getElemById("btnTranslate").style.color = "#2196F3";
    }

    // fill language list
    (function () {
      let langs = twpLang.getLanguageList();

      const langsSorted = [];

      for (const i in langs) {
        langsSorted.push([i, langs[i]]);
      }

      langsSorted.sort(function (a, b) {
        return a[1].localeCompare(b[1]);
      });

      const menuSelectLanguage = getElemById("menuSelectLanguage");
      langsSorted.forEach((value) => {
        const a = document.createElement("a");
        a.setAttribute("value", value[0]);
        a.textContent = value[1];
        a.addEventListener("click", (e) => {
          e.stopPropagation();
          translatePage(value[0]);
        });
        menuSelectLanguage.appendChild(a);
      });
    })();

    /**
     * 更新图标
     * @returns 
     */
    function updateIcon() {
      if (!getElemById) return;

      if (currentPageTranslatorService === "yandex") {
        getElemById("iconTranslate").src = chrome.runtime.getURL(
          "/icons/yandex-translate-32.png"
        );
      } else {
        getElemById("iconTranslate").src = chrome.runtime.getURL(
          "/icons/google-translate-32.png"
        );
      }
    }
    updateIcon();

    getElemById("iconTranslate").onclick = (e) => {
      pageTranslator.swapTranslationService();

      currentPageTranslatorService =
        currentPageTranslatorService === "google" ? "yandex" : "google";
      // 更新图标
      updateIcon();

      twpConfig.set("pageTranslatorService", currentPageTranslatorService);
    };

    // 弹出窗的"显示原文"按钮的点击事件响应函数
    getElemById("btnOriginal").onclick = (e) => {
      pageTranslator.restorePage();
      if (!getElemById) return;

      getElemById("btnOriginal").style.color = "#2196F3";
      getElemById("btnTranslate").style.color = null;
    };

    // 弹出窗的"翻译"按钮的点击事件响应函数
    getElemById("btnTranslate").onclick = (e) => {
      translatePage();
    };

    getElemById("btnMenu").onclick = (e) => {
      if (!getElemById) return;
      if (getElemById("menu").style.display === "block") {
        getElemById("menu").style.display = "none";
      } else {
        getElemById("menu").style.display = "block";
      }
      getElemById("menuSelectLanguage").style.display = "none";
    };

    getElemById("btnClose").onclick = (e) => {
      popupMobile.hide();
    };

    getElemById("btnChangeLanguages").onclick = (e) => {
      e.stopPropagation();
      if (!getElemById) return;
      getElemById("menuSelectLanguage").style.display = "block";
      getElemById("menu").style.display = "none";
    };

    getElemById("btnTranslateSelectedText").onclick = (e) => {
      if (twpConfig.get("showTranslateSelectedButton") === "yes") {
        twpConfig.set("showTranslateSelectedButton", "no");
        getElemById("btnTranslateSelectedText").textContent =
          chrome.i18n.getMessage("msgTranslateSelectedText");
      } else {
        twpConfig.set("showTranslateSelectedButton", "yes");
        getElemById("btnTranslateSelectedText").textContent =
          chrome.i18n.getMessage("msgNoTranslateSelectedText");
      }
      getElemById("menu").style.display = "none";
      e.stopPropagation();
    };

    getElemById("btnNeverTranslate").onclick = (e) => {
      twpConfig.addSiteToNeverTranslate(tabHostName);
      popupMobile.hide();
    };

    getElemById("neverTranslateThisLanguage").onclick = (e) => {
      twpConfig.addLangToNeverTranslate(originalTabLanguage);
      popupMobile.hide();
    };

    getElemById("btnMoreOptions").onclick = (e) => {
      chrome.runtime.sendMessage({
        action: "openOptionsPage",
      });
    };

    document.addEventListener("blur", hideMenu);
    document.addEventListener("click", hideMenu);

    if (twpConfig.get("showTranslateSelectedButton") === "yes") {
      getElemById("btnTranslateSelectedText").textContent =
        chrome.i18n.getMessage("msgNoTranslateSelectedText");
    } else {
      getElemById("btnTranslateSelectedText").textContent =
        chrome.i18n.getMessage("msgTranslateSelectedText");
    }
  };

  console.log("will show mobile popup, 88888888111111")
  popupMobile.show();


  if (showPopupMobile !== "no") {
    // 当3指触摸时,显示popupMobile
    window.addEventListener("touchstart", (e) => {
      if (e.touches.length == 3) {
        console.log("will show mobile popup, 55555555")
        popupMobile.show(true);
      }
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "showPopupMobile") {
      console.log("will show mobile popup, 66666666")
      popupMobile.show(true);
    }
  });

  pageTranslator.onGetOriginalTabLanguage(function (tabLanguage) {
    if (!tabLanguage || tabLanguage === "und") {
      const lang = twpLang.fixTLanguageCode(document.documentElement.lang);
      if (lang) {
        originalTabLanguage = tabLanguage;
      }
    } else {
      originalTabLanguage = tabLanguage;
    }
    translateThisLanguage =
      originalTabLanguage === "und" ||
      (currentTargetLanguage !== originalTabLanguage &&
        twpConfig.get("neverTranslateLangs").indexOf(originalTabLanguage) ===
        -1);
    console.log("will show mobile popup, 7777777")
    popupMobile.show();
  });

  console.log("will show mobile popup, 8888888811111111")
  popupMobile.show();

  /*
    const dpr = 1
    const origInnerWidth = window.innerWidth * window.devicePixelRatio
    console.log(origInnerWidth)
    const el = iframeDiv
 
    function f() {
        el.style.scale = dpr / window.devicePixelRatio
        el.style.width = ( 100 / (dpr / window.devicePixelRatio) ) + "%"
        el.style.left = "0px"
        el.style.bottom = "0px"
 
        const eWidth = parseFloat(window.innerWidth)
 
        const dX = (eWidth * window.devicePixelRatio - eWidth) / 2
        const dY = ((50 * (window.devicePixelRatio)) - 50) / (window.devicePixelRatio * 2)
        console.log({
            scale: dpr / window.devicePixelRatio,
            dpr: dpr,
            devicePixelRatio: devicePixelRatio,
            elWidth: getComputedStyle(el).width,
            dx: dX
        })
        el.style.left = - (origInnerWidth - innerWidth) / 2 + "px"
        el.style.bottom = -dY + "px" 
    }
    let oldwidth = null
 
    function foo() {
        if (oldwidth) {
            if (oldwidth != window.innerWidth) {
                f()
            }
            oldwidth = window.innerWidth
        } else {
            oldwidth = window.innerWidth
            f()
        }
        requestAnimationFrame(foo)
    }
    requestAnimationFrame(foo)
    //*/
});
