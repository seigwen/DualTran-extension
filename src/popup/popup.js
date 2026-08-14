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

  // Target language dropdown
  const selectTargetLanguage = /** @type {HTMLSelectElement} */ (document.getElementById("selectTargetLanguage"));

  /**
   * Populate target language dropdown
   * First item is "Original", favorite languages at top, rest sorted by name
   */
  function populateTargetLanguageSelect() {
    selectTargetLanguage.innerHTML = "";

    // First item: Original (show original text)
    const originalOption = document.createElement("option");
    originalOption.value = "original";
    originalOption.textContent = chrome.i18n.getMessage("btnMobileOriginal") || "Original";
    selectTargetLanguage.appendChild(originalOption);

    // Separator
    const sep1 = document.createElement("option");
    sep1.disabled = true;
    sep1.textContent = "──────────";
    selectTargetLanguage.appendChild(sep1);

    // Favorite languages at top
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

    // Separator
    const sep2 = document.createElement("option");
    sep2.disabled = true;
    sep2.textContent = "──────────";
    selectTargetLanguage.appendChild(sep2);

    // All remaining languages sorted by name
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

  // Dropdown selection change event
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

  // Get active tab, update language-related settings styles
  chrome.tabs.query(
    {
      active: true,
      currentWindow: true,
    },
    /**
     * Update language-related settings styles
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

      // Get active tab's originalTabLanguage and display it on the first radio label
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
            // Update "hover over this language" label with actual language name.
            // The i18n template uses $LANGUAGE_NAME$ placeholder ($1), but
            // data-i18n processing doesn't pass substitution args, so we set it
            // explicitly here after the language is detected.
            const langName = twpLang.codeToLanguage(originalTabLanguage);
            if (langName) {
              const hoverLangLbl = document.getElementById("lblShowTranslatedWhenHoveringThisLang");
              if (hoverLangLbl) {
                const msg = chrome.i18n.getMessage("lblShowTranslatedWhenHoveringThisLang", [langName]);
                if (msg) hoverLangLbl.textContent = msg;
              }
            }
            updateInterface()
          }
        }
      );

      // Get active tab's currentPageLanguage and update UI
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

      // Get active tab's currentPageLanguageState (original/translated) and update UI
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

      // Set "Always translate this language" checkbox click handler
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
      // Set "Never translate this language" checkbox click handler
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


      // Set "Always translate this site" checkbox click handler
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
      // Set "Never translate this site" checkbox click handler
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

      // Set "Show 'translate selected text' button" checkbox click handler
      $("#cbShowTranslateSelectedButton").addEventListener("change", (e) => {
        if (e.target.checked) {
          twpConfig.set("showTranslateSelectedButton", "yes");
        } else {
          twpConfig.set("showTranslateSelectedButton", "no");
        }
        updateInterface();
      });

      // Set "Where to display translated text" select change handler
      $("#whereToDisplayTranslatedText").addEventListener("change", (e) => {
        twpConfig.set("whereToDisplayTranslatedText", e.target.value);
        updateInterface();
      });

      // Set "Show original text when hovering" checkbox click handler
      $("#cbShowOriginalWhenHovering").addEventListener("change", (e) => {
        if (e.target.checked) {
          twpConfig.set("showOriginalTextWhenHovering", "yes");
        } else {
          twpConfig.set("showOriginalTextWhenHovering", "no");
        }
        updateInterface();
      });
      // Set "Show translation when hovering over this site" checkbox click handler
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
      // Set "Show translation when hovering over this language" checkbox click handler
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

      // Set "Show translation when hovering over this language" checkbox click handler
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
   * Update interface styles
   */
  function updateInterface() {
    console.log("hostname:", hostname)
    console.log("originalTabLanguage:", originalTabLanguage)
    // Update target language dropdown selected value
    if (currentPageLanguageState === "translated") {
      selectTargetLanguage.value = currentPageLanguage;
    } else {
      // Smart default: saved > browser language > OS language > Original
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

    // Set "Show translate selected text button" checkbox style
    $("#cbShowTranslateSelectedButton").checked = twpConfig.get("showTranslateSelectedButton") == "yes" ? true : false;

    // Set "Where to display translated text" select value
    $("#whereToDisplayTranslatedText").value = twpConfig.get("whereToDisplayTranslatedText") || "newLine";

    // Set "Show original when hovering" checkbox style
    $("#cbShowOriginalWhenHovering").checked = twpConfig.get("showOriginalTextWhenHovering") == "yes" ? true : false;

    $("#cbShowTranslatedWhenHoveringThisLang").checked = twpConfig.get("langsToTranslateWhenHovering").indexOf(originalTabLanguage) !== -1;

    $("#cbShowTranslatedWhenHoveringThisSite").checked = twpConfig.get("sitesToTranslateWhenHovering").indexOf(hostname) !== -1;


    if (![undefined, "und"].includes(originalTabLanguage)) {
      // Set "Always translate this language" checkbox style
      $("#cbAlwaysTranslateThisLanguage").disabled = false
      // Set "Always translate this language" checkbox style
      $("#cbNeverTranslateThisLanguage").disabled = false
      // Set "Show translated when hovering this language" checkbox style
      $("#cbShowTranslatedWhenHoveringThisLang").disabled = false
    } else {
      $("#cbAlwaysTranslateThisLanguage").disabled = true
      $("#cbNeverTranslateThisLanguage").disabled = true
      $("#cbShowTranslatedWhenHoveringThisLang").disabled = true
    }

    if (hostname) {
      // Set "Always translate this site" checkbox style
      $("#cbAlwaysTranslateThisSite").disabled = false
      // Set "Never translate this site" checkbox style
      $("#cbNeverTranslateThisSite").disabled = false
      // Set "Show translated when hovering this site" checkbox style
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

  // Enable dark mode
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

  // Disable dark mode
  function disableDarkMode() {
    if ($("#darkModeElement")) {
      $("#darkModeElement").remove();
    }
  }

  // Enable/disable dark mode
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
