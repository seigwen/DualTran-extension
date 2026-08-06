"use strict";

import twpLang from "../lib/languages.js"
import twpConfig from "../lib/config.js"
import "../lib/i18n.js"

var $ = document.querySelector.bind(document);

let hostname
let tabId

twpConfig.onReady(function () {
  // Avoid outputting the error message "Receiving end does not exist" in the Console.
  function checkedLastError() {
    chrome.runtime.lastError;
  }

  let originalTabLanguage = "und";
  let currentPageLanguage = "und";
  let currentPageLanguageState = "original";

  // 目标语言下拉框
  const selectTargetLanguage = /** @type {HTMLSelectElement} */ (document.getElementById("selectTargetLanguage"));

  /**
   * 填充目标语言下拉框
   * 第一项为 "Original"，收藏语言置顶，其余按名称排序
   */
  function populateTargetLanguageSelect() {
    selectTargetLanguage.innerHTML = "";

    // 第一项：Original（显示原文）
    const originalOption = document.createElement("option");
    originalOption.value = "original";
    originalOption.textContent = chrome.i18n.getMessage("btnMobileOriginal") || "Original";
    selectTargetLanguage.appendChild(originalOption);

    // 分隔线
    const sep1 = document.createElement("option");
    sep1.disabled = true;
    sep1.textContent = "──────────";
    selectTargetLanguage.appendChild(sep1);

    // 收藏语言置顶
    const targetLanguages = twpConfig.get("targetLanguages") || [];
    const insertedCodes = new Set();
    for (const code of targetLanguages) {
      if (!code) continue;
      insertedCodes.add(code);
      const option = document.createElement("option");
      option.value = code;
      option.textContent = twpLang.codeToLanguage(code);
      selectTargetLanguage.appendChild(option);
    }

    // 分隔线
    const sep2 = document.createElement("option");
    sep2.disabled = true;
    sep2.textContent = "──────────";
    selectTargetLanguage.appendChild(sep2);

    // 其余所有语言按名称排序
    const allLangs = twpLang.getLanguageList();
    const sorted = Object.entries(allLangs)
      .filter(([code]) => !insertedCodes.has(code))
      .sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));
    for (const [code, name] of sorted) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = name;
      selectTargetLanguage.appendChild(option);
    }
  }
  populateTargetLanguageSelect();

  // 下拉框选择变化事件
  selectTargetLanguage.addEventListener("change", () => {
    const value = selectTargetLanguage.value;
    currentPageLanguage = value;
    if (value === "original") {
      currentPageLanguageState = "original";
    } else {
      currentPageLanguageState = "translated";
      twpConfig.setTargetLanguage(value);
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "translatePage", targetLanguage: value || "original" },
        checkedLastError
      );
    });
  });

  // 获取active tab, 更新语言相关设置的样式
  chrome.tabs.query(
    {
      active: true,
      currentWindow: true,
    },
    /**
     * 更新语言相关设置的样式
     * @param {*} tabs 
     */
    (tabs) => {
      try {
        hostname = new URL(tabs[0].url).hostname
      } catch (_e) {
        hostname = ""
      }
      tabId = tabs[0].id
      updateInterface()

      // 获取active tab的originalTabLanguage,并显示在第一个单选项的标签上
      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: "getOriginalTabLanguage",
        },
        {
          frameId: 0,
        },
        (tabLanguage) => {
          checkedLastError();
          if (
            !tabLanguage ||
            (tabLanguage = twpLang.fixTLanguageCode(tabLanguage))
          ) {
            originalTabLanguage = tabLanguage || "und";
            const lbl = document.getElementById("lblOriginalLanguage");
            if (lbl) lbl.textContent = twpLang.codeToLanguage(originalTabLanguage);
            updateInterface()
          }
        }
      );

      // 获取active tab的CurrentPageLanguage,并更新界面
      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: "getCurrentPageLanguage",
        },
        {
          frameId: 0,
        },
        (pageLanguage) => {
          checkedLastError();
          if (pageLanguage) {
            currentPageLanguage = pageLanguage;
            updateInterface();
          }
        }
      );

      // 获取active tab的currentPageLanguageState(original/translated),并更新界面
      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: "getCurrentPageLanguageState",
        },
        {
          frameId: 0,
        },
        (pageLanguageState) => {
          checkedLastError();
          if (pageLanguageState) {
            currentPageLanguageState = pageLanguageState;
            updateInterface();
          }
        }
      );

      // 设置"总是翻译此语言"复选框点击响应
      $("#cbAlwaysTranslateThisLanguage").addEventListener("change", (e) => {
        if([undefined, null, "", "und"].includes(originalTabLanguage)){
          return
        }
        if (e.target.checked) {
          twpConfig.addLangToAlwaysTranslate(originalTabLanguage, hostname);
          twpConfig.removeLangFromNeverTranslate(originalTabLanguage);
        } else {
          twpConfig.removeLangFromAlwaysTranslate(originalTabLanguage);
        }
        updateInterface();
      });
      // 设置"永不翻译此语言"复选框点击响应
      $("#cbNeverTranslateThisLanguage").addEventListener("change", (e) => {
        if([undefined, null, "", "und"].includes(originalTabLanguage)){
          return
        }
        if (e.target.checked) {
          console.log("originalTabLanguage to be added to never translate:", originalTabLanguage)
          twpConfig.addLangToNeverTranslate(originalTabLanguage, hostname);
          twpConfig.removeLangFromAlwaysTranslate(originalTabLanguage);
        } else {
          twpConfig.removeLangFromNeverTranslate(originalTabLanguage);
        }
        updateInterface();
      });


      // 设置"总是翻译此网站"复选框点击响应
      $("#cbAlwaysTranslateThisSite").addEventListener("change", (e) => {
        if([undefined, null, "", "und"].includes(hostname)){
          return
        }
        if (e.target.checked) {
          twpConfig.addSiteToAlwaysTranslate(hostname);
          twpConfig.removeSiteFromNeverTranslate(hostname);
        } else {
          twpConfig.removeSiteFromAlwaysTranslate(hostname);
        }
        updateInterface();
      });
      // 设置"永不翻译此网站"复选框点击响应
      $("#cbNeverTranslateThisSite").addEventListener("change", (e) => {
        if([undefined, null, "", "und"].includes(hostname)){
          return
        }
        if (e.target.checked) {
          twpConfig.addSiteToNeverTranslate(hostname);
          twpConfig.removeSiteFromAlwaysTranslate(hostname);
        } else {
          twpConfig.removeSiteFromNeverTranslate(hostname);
        }
        updateInterface();
      });

      // 设置"显示'翻译选中文本'按钮"复选框点击响应
      $("#cbShowTranslateSelectedButton").addEventListener("change", (e) => {
        if (e.target.checked) {
          twpConfig.set("showTranslateSelectedButton", "yes");
        } else {
          twpConfig.set("showTranslateSelectedButton", "no");
        }
        updateInterface();
      });

      // 设置"悬停显示原文"复选框点击响应
      $("#cbShowOriginalWhenHovering").addEventListener("change", (e) => {
        if (e.target.checked) {
          twpConfig.set("showOriginalTextWhenHovering", "yes");
        } else {
          twpConfig.set("showOriginalTextWhenHovering", "no");
        }
        updateInterface();
      });
      // 设置"在此网站悬停显示译文"复选框点击响应
      $("#cbShowTranslatedWhenHoveringThisSite").addEventListener(
        "change",
        (e) => {
          if([undefined, null, "", "und"].includes(hostname)){
            return
          }
          if (e.target.checked) {
            twpConfig.addSiteToTranslateWhenHovering(hostname);
          } else {
            twpConfig.removeSiteFromTranslateWhenHovering(hostname);
          }
          updateInterface();
        }
      );
      // 设置"对此语言悬停显示译文"复选框点击响应
      $("#cbShowTranslatedWhenHoveringThisLang").addEventListener(
        "change",
        (e) => {
          if([undefined, null, "", "und"].includes(originalTabLanguage)){
            return
          }
          if (e.target.checked) {
            twpConfig.addLangToTranslateWhenHovering(originalTabLanguage);
          } else {
            twpConfig.removeLangFromTranslateWhenHovering(originalTabLanguage);
          }
          updateInterface();
        }
      );

      // 设置"自动使用AI改进翻译"复选框点击响应
      $("#cbAutoImproveByAi").addEventListener("change", (e) => {
        if (e.target.checked) {
          twpConfig.set("autoImproveByAI", "yes");
        } else {
          twpConfig.set("autoImproveByAI", "no");
        }
        updateInterface();
      });

      // 设置"对此语言悬停显示译文"复选框点击响应
      $("#cbMoreOptions").addEventListener(
        "click",
        (e) => {
          chrome.tabs.create({
            url: chrome.runtime.getURL("/options/options.html"),
          });
          window.close
        }
      );
    }
  );

  /**
   * 更新界面样式
   */
  function updateInterface() {
    console.log("hostname:", hostname)
    console.log("originalTabLanguage:", originalTabLanguage)
    // 更新目标语言下拉框的选中值
    if (currentPageLanguageState === "translated") {
      selectTargetLanguage.value = currentPageLanguage;
    } else {
      // 智能默认：已保存 > 浏览器语言 > 操作系统语言 > Original
      const saved = twpConfig.get("targetLanguage");
      if (saved) {
        selectTargetLanguage.value = saved;
      } else {
        const browserLang = twpLang.fixTLanguageCode(chrome.i18n.getUILanguage());
        const osLang = twpLang.fixTLanguageCode(navigator.language);
        selectTargetLanguage.value = browserLang || osLang || "original";
      }
    }

    $("#cbAlwaysTranslateThisLanguage").checked = twpConfig.get("alwaysTranslateLangs").indexOf(originalTabLanguage) !== -1;
    $("#cbNeverTranslateThisLanguage").checked = twpConfig.get("neverTranslateLangs").indexOf(originalTabLanguage) !== -1;

    $("#cbAlwaysTranslateThisSite").checked = twpConfig.get("alwaysTranslateSites").indexOf(hostname) !== -1;
    $("#cbNeverTranslateThisSite").checked = twpConfig.get("neverTranslateSites").indexOf(hostname) !== -1;

    // 设置"显示'翻译选中文本'按钮"复选框的样式
    $("#cbShowTranslateSelectedButton").checked = twpConfig.get("showTranslateSelectedButton") == "yes" ? true : false;

    $("#cbAutoImproveByAi").checked = twpConfig.get("autoImproveByAI") == "yes" ? true : false;

    // 设置"悬停显示原文"复选框的样式
    $("#cbShowOriginalWhenHovering").checked = twpConfig.get("showOriginalTextWhenHovering") == "yes" ? true : false;

    $("#cbShowTranslatedWhenHoveringThisLang").checked = twpConfig.get("langsToTranslateWhenHovering").indexOf(originalTabLanguage) !== -1;

    $("#cbShowTranslatedWhenHoveringThisSite").checked = twpConfig.get("sitesToTranslateWhenHovering").indexOf(hostname) !== -1;


    if (![undefined, "und"].includes(originalTabLanguage)) {
      // 设置"总是翻译此语言"复选项的样式
      $("#cbAlwaysTranslateThisLanguage").disabled = false
      // 设置"总是翻译此语言"复选项的样式
      $("#cbNeverTranslateThisLanguage").disabled = false
      // 设置"对此语言悬停显示译文"复选项的样式
      $("#cbShowTranslatedWhenHoveringThisLang").disabled = false
    } else {
      $("#cbAlwaysTranslateThisLanguage").disabled = true
      $("#cbNeverTranslateThisLanguage").disabled = true
      $("#cbShowTranslatedWhenHoveringThisLang").disabled = true
    }

    if (hostname) {
      // 设置"总是翻译此网站"复选项的样式
      $("#cbAlwaysTranslateThisSite").disabled = false
      // 设置"永不翻译此网站"复选项的样式
      $("#cbNeverTranslateThisSite").disabled = false
      // 设置"对此网站悬停显示译文"复选项的样式
      $("#cbShowTranslatedWhenHoveringThisSite").disabled = false
    } else {
      $("#cbAlwaysTranslateThisSite").disabled = true
      $("#cbNeverTranslateThisSite").disabled = true
      $("#cbShowTranslatedWhenHoveringThisSite").disabled = true
    }

    if (twpConfig.get("whereToDisplayTranslatedText") == "newLine") {
      $("#containerShowOriginalWhenHovering").style.display = "none"
      $("#containerShowTranslatedWhenHoveringThisSite").style.display = "none"
      $("#containerShowTranslatedWhenHoveringThisLang").style.display = "none"
      $("#hrOfLastItem").style.display = "none"
    } else {
      $("#containerShowOriginalWhenHovering").style.display = "block"
      $("#containerShowTranslatedWhenHoveringThisSite").style.display = "block"
      $("#containerShowTranslatedWhenHoveringThisLang").style.display = "block"
      $("#hrOfLastItem").style.display = "block"
    }
  }

  updateInterface();

  setInterval(() => {
    chrome.tabs.sendMessage(
      tabId,
      {
        action: "getOriginalTabLanguage",
      },
      {
        frameId: 0,
      },
      (tabLanguage) => {
        checkedLastError();
        if (
          !tabLanguage ||
          (tabLanguage = twpLang.fixTLanguageCode(tabLanguage))
        ) {
          console.log("tabLanguage:", tabLanguage)
          originalTabLanguage = tabLanguage || "und";
          const lbl = document.getElementById("lblOriginalLanguage");
          if (lbl) lbl.textContent = twpLang.codeToLanguage(originalTabLanguage);
          updateInterface()
        }
      }
    );
  }, 1500)

  // 开启暗夜模式
  function enableDarkMode() {
    if (!$("#darkModeElement")) {
      const el = document.createElement("style");
      el.setAttribute("id", "darkModeElement");
      el.setAttribute("rel", "stylesheet");
      el.textContent = `
            body {
                color: rgb(231, 230, 228) !important;
                background-color: #181a1b !important;
            }
            
            .mdiv, .md, {
                background-color: rgb(231, 230, 228);
            }

            .menuDot {
                background-image:
                    radial-gradient(rgb(231, 230, 228) 2px, transparent 2px),
                    radial-gradient(rgb(231, 230, 228) 2px, transparent 2px),
                    radial-gradient(rgb(231, 230, 228) 2px, transparent 2px);
            }

            #btnSwitchInterfaces:hover, #divMenu:hover {
                background-color: #454a4d !important;
                color: rgb(231, 230, 228) !important;
            }
            
            select {
                color: rgb(231, 230, 228) !important;
                background-color: #181a1b !important;
            }

            hr {
                border-color: #666;
            }

            .arrow {
                border-color: rgb(231, 230, 228);
            }
            `;
      document.head.appendChild(el);
    }
  }

  // 关闭暗夜模式
  function disableDarkMode() {
    if ($("#darkModeElement")) {
      $("#darkModeElement").remove();
    }
  }

  // 开启/关闭暗夜模式
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
});
