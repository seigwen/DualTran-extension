"use strict";

export const SUCCESS_CHECK_COLOR = "#16a34a";
export const ERROR_CROSS_COLOR = "#dc2626";
export const AI_SUCCESS_CHECK_CLASS = "dualtran-ai-success-check";
export const AI_ERROR_CROSS_CLASS = "dualtran-ai-error-cross";

function applyAiTranslatedTextColor(btnAi, translatedTextColor) {
  const aiTranslatedColor = translatedTextColor;
  if (["", "rgba(0, 0, 0, 1)", undefined, null].includes(aiTranslatedColor)) {
    return;
  }

  // Dual-span mode: apply AI color to aiSpan directly
  if (btnAi?.aiSpan) {
    btnAi.aiSpan.style.color = aiTranslatedColor;
    return;
  }

  // In replaceOriginal mode, AI translation should use original text color, not the configured translation color
  const translatedTextNode = btnAi?.translatedTextNode;
  if (!translatedTextNode) {
    return;
  }

  // Check if in replaceOriginal mode
  // In replaceOriginal mode, the AI span's parent (or ancestor) will have data-dualtran-block attribute
  let checkElement = translatedTextNode;
  while (checkElement) {
    if (checkElement.dataset?.dualtranBlock) {
      // In replaceOriginal mode, don't apply color; use original text color
      return;
    }
    checkElement = checkElement.parentElement || checkElement.parentNode;
    // Only check up to the body element
    if (checkElement === document.body) break;
  }

  if (translatedTextNode.nodeType === 3 && translatedTextNode.parentNode?.style) {
    translatedTextNode.parentNode.style.color = aiTranslatedColor;
    return;
  }

  if (translatedTextNode.style) {
    translatedTextNode.style.color = aiTranslatedColor;
  }
}

function updateInlineBtnStateClass(btnAi, state) {
  if (!btnAi || !btnAi.classList) return;
  btnAi.classList.remove("dualtran-ai-loading", "dualtran-ai-success", "dualtran-ai-error");
  if (state) {
    btnAi.classList.add("dualtran-ai-" + state);
  }
}

export function renderAiSuccessIndicator(btnAi) {
  if (!btnAi || !btnAi.btnAiTxtNode) return;
  btnAi.btnAiTxtNode.textContent = "AI";
  updateInlineBtnStateClass(btnAi, "success");
  const checkSpan = btnAi.ownerDocument.createElement("span");
  checkSpan.textContent = "\u2713";
  checkSpan.className = AI_SUCCESS_CHECK_CLASS;
  checkSpan.style.marginLeft = "4px";
  checkSpan.style.color = SUCCESS_CHECK_COLOR;
  checkSpan.style.fontWeight = "600";
  btnAi.btnAiTxtNode.appendChild(checkSpan);
}

export function renderAiErrorIndicator(btnAi) {
  if (!btnAi || !btnAi.btnAiTxtNode) return;
  btnAi.btnAiTxtNode.textContent = "AI";
  updateInlineBtnStateClass(btnAi, "error");
  const crossSpan = btnAi.ownerDocument.createElement("span");
  crossSpan.textContent = "\u2715";
  crossSpan.className = AI_ERROR_CROSS_CLASS;
  crossSpan.style.marginLeft = "4px";
  crossSpan.style.color = ERROR_CROSS_COLOR;
  crossSpan.style.fontWeight = "600";
  btnAi.btnAiTxtNode.appendChild(crossSpan);
}

export function applyAiTranslatingState(btnAi, {
  translatedText,
  translatedTextColor,
  labelText = "translating...",
  tooltipText = "translating...",
  tooltipColor = "darkgreen",
  buttonColor = "darkgreen",
} = {}) {
  if (!btnAi) return;

  updateInlineBtnStateClass(btnAi, "loading");

  // replaceOriginal mode: clear original text nodes when AI translation starts.
  // Only clear text content — do NOT hide parent elements, as restoration may
  // fail to find matching nodesToRestore entries, leaving parents permanently hidden.
  try {
    const blockState = btnAi._st ? btnAi._st() : null;
    if (blockState && Array.isArray(blockState.nodesToClear) && blockState.nodesToClear.length > 0) {
      blockState.nodesToClear.forEach((node) => {
        try {
          if (node.nodeType === 3) {
            node.textContent = "";
          } else if (node.nodeType === 1 && node.style) {
            node.style.display = "none";
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

  try {
    if (btnAi.translatedTextNode && btnAi.translatedTextNode.classList) {
      btnAi.translatedTextNode.classList.remove("dualtran-loading");
    }
    // Dual-span mode: write AI translation to aiSpan, toggle visibility
    if (btnAi.aiSpan) {
      if (typeof translatedText === "string") {
        btnAi.aiSpan.textContent = translatedText;
      }
      btnAi.aiSpan.style.display = "block";
      if (btnAi.googleSpan) {
        btnAi.googleSpan.style.display = "none";
      }
    } else if (typeof translatedText === "string" && btnAi.translatedTextNode) {
      // Legacy single-span mode
      btnAi.translatedTextNode.textContent = translatedText;
    }
    applyAiTranslatedTextColor(btnAi, translatedTextColor);
  } catch (_) {
  }

  btnAi.translationStatus = "translating";
  // Keep the hover-button display state machine in sync: AI takes over the display
  try {
    const st = btnAi._st ? btnAi._st() : null;
    if (st && st.displayMode !== undefined) {
      st.displayMode = "ai";
    }
  } catch (_) {}
  if (btnAi.btnAiTxtNode) {
    btnAi.btnAiTxtNode.textContent = labelText;
  }
  if (btnAi.tooltip) {
    btnAi.tooltip.textContent = tooltipText;
    btnAi.tooltip.style.color = tooltipColor;
  }
  if (btnAi.style) {
    btnAi.style.color = buttonColor;
  }
}

export function applyAiSuccessState(btnAi, {
  translatedText,
  translatedTextColor,
  tooltipText = "AI translated successfully!",
  tooltipColor = "darkgreen",
  titleText = "AI translated successfully!",
  buttonColor = "darkgreen",
} = {}) {
  if (!btnAi) return;

  // replaceOriginal mode: clear original text nodes when AI translation succeeds.
  // Only clear text content — do NOT hide parent elements, as restoration may
  // fail to find matching nodesToRestore entries, leaving parents permanently hidden.
  try {
    const blockState = btnAi._st ? btnAi._st() : null;
    if (blockState && Array.isArray(blockState.nodesToClear) && blockState.nodesToClear.length > 0) {
      blockState.nodesToClear.forEach((node) => {
        try {
          if (node.nodeType === 3) {
            node.textContent = "";
          } else if (node.nodeType === 1 && node.style) {
            node.style.display = "none";
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

  try {
    if (btnAi.translatedTextNode && btnAi.translatedTextNode.classList) {
      btnAi.translatedTextNode.classList.remove("dualtran-loading");
    }
    // Dual-span mode: write AI translation to aiSpan, toggle visibility
    if (btnAi.aiSpan) {
      if (typeof translatedText === "string") {
        btnAi.aiSpan.textContent = translatedText;
      }
      btnAi.aiSpan.style.display = "block";
      if (btnAi.googleSpan) {
        btnAi.googleSpan.style.display = "none";
      }
    } else if (typeof translatedText === "string" && btnAi.translatedTextNode) {
      // Legacy single-span mode
      btnAi.translatedTextNode.textContent = translatedText;
    }
    applyAiTranslatedTextColor(btnAi, translatedTextColor);
  } catch (_) {
  }

  btnAi.translationStatus = "translated";
  // Keep the hover-button display state machine in sync: AI takes over the display
  try {
    const st = btnAi._st ? btnAi._st() : null;
    if (st && st.displayMode !== undefined) {
      st.displayMode = "ai";
      st.googleBtnState = st.googleBtnState || "idle";
    }
  } catch (_) {}
  btnAi.classList?.remove?.("dualtran-hide");
  if (btnAi.style) {
    btnAi.style.color = buttonColor;
  }
  renderAiSuccessIndicator(btnAi);
  if (btnAi.tooltip) {
    btnAi.tooltip.textContent = tooltipText;
    btnAi.tooltip.style.color = tooltipColor;
  }
  if (titleText !== undefined && titleText !== null && typeof btnAi.setAttribute === "function") {
    try {
      btnAi.setAttribute("title", titleText);
    } catch (_) {
    }
  }
}

export function applyAiErrorState(btnAi, {
  errorText,
  translatedText = errorText,
  tooltipColor = ERROR_CROSS_COLOR,
  buttonColor = ERROR_CROSS_COLOR,
  titleText = errorText,
} = {}) {
  if (!btnAi) return;

  btnAi.translationStatus = "translationError";
  btnAi.classList?.remove?.("dualtran-hide");
  if (btnAi.style) {
    btnAi.style.color = buttonColor;
  }
  renderAiErrorIndicator(btnAi);

  try {
    if (btnAi.translatedTextNode && btnAi.translatedTextNode.classList) {
      btnAi.translatedTextNode.classList.remove("dualtran-loading");
    }
    if (translatedText !== undefined && translatedText !== null && btnAi.translatedTextNode) {
      btnAi.translatedTextNode.textContent = translatedText;
    }
  } catch (_) {
  }

  if (btnAi.tooltip) {
    btnAi.tooltip.textContent = errorText || "";
    btnAi.tooltip.style.color = tooltipColor;
  }
  if (titleText !== undefined && titleText !== null && typeof btnAi.setAttribute === "function") {
    try {
      btnAi.setAttribute("title", titleText);
    } catch (_) {
    }
  }
}

export function formatAiTranslationError(err) {
  // Timeout from aiProxy
  if (err?.error?.type === "timeout") {
    return "AI translation error: server response timeout";
  }
  // Pre-formatted message from aiProxy
  const msg = err?.error?.message || err?.message;
  if (msg) {
    // If there's an error code (e.g., HTTP status), include it in the message
    const code = err?.error?.code ?? err?.code;
    const prefix = (code != null) ? code + " - " : "";
    return "AI translation error: " + prefix + msg;
  }
  // Fallback for unexpected error shapes
  const fallback = err?.error || err?.message || err || "unknown error";
  const fallbackStr = typeof fallback === "object" ? JSON.stringify(fallback) : String(fallback);
  return "AI translation error: " + fallbackStr;
}

/**
 * Per-block "show Google only" logic. Called by pageTranslator.showGoogleOnly()
 * for each registered block. Centralised here so the replaceOriginal-mode
 * restoration bug is locked down by a test at the same seam the bug occurs.
 *
 * newLine mode (googleSpan/aiSpan present):
 *   - show googleSpan, hide aiSpan
 *
 * replaceOriginal mode (nodesToClear present):
 *   - text nodes were CLEARED by applyAiSuccessState when AI finished;
 *     restore the Google translation from nodesToRestore[].translatedText
 *     (NOT originalText — that would revert to the source language)
 *   - restore parent elements hidden by AI translation
 *   - clear the AI translatedTextNode
 *
 * Both modes: reset aiStatus to "idle" and clear translationId so the block
 * can be AI-translated again.
 *
 * @param {Object} btnAi — BtnAiProxy-like object
 * @param {Array} nodesToRestore — pageTranslator's nodesToRestore array
 *   entries: { node, originalText, translatedText }
 */
export function applyShowGoogleOnlyState(btnAi, nodesToRestore = []) {
  if (!btnAi) return;

  if (btnAi.googleSpan) {
    // newLine mode (dual-span): show Google, hide AI
    btnAi.googleSpan.style.display = "block";
    if (btnAi.aiSpan) {
      btnAi.aiSpan.style.display = "none";
    }
  } else if (btnAi.nodesToClear) {
    // replaceOriginal mode: restore Google translation into cleared text nodes
    const restoreList = Array.isArray(nodesToRestore) ? nodesToRestore : [];
    btnAi.nodesToClear.forEach((n) => {
      try {
        const restored = restoreList.find((r) => r && r.node === n);
        if (restored) {
          if (n.nodeType === 3) {
            // Google translation was stored in translatedText; originalText is the source language
            n.textContent = restored.translatedText;
          } else if (n.nodeType === 1) {
            n.style.display = "";
            n.textContent = restored.translatedText;
          }
        }
        // Restore hidden parent elements (e.g., <code>, <a>) hidden by AI translation
        const parent = n.parentNode;
        if (parent && parent.nodeType === 1 && parent.style?.display === "none") {
          parent.style.display = "";
        }
      } catch (_) {}
    });
    // Clear the AI translatedTextNode
    if (btnAi.translatedTextNode) {
      try { btnAi.translatedTextNode.textContent = ""; } catch (_) {}
    }
  }

  // Reset AI translation state so blocks can be re-translated
  btnAi.translationStatus = "idle";
  btnAi.translationId = "";
  // Keep the hover-button display state machine in sync: page now shows Google
  try {
    const st = btnAi._st ? btnAi._st() : null;
    if (st) {
      st.displayMode = "google";
      st.googleBtnState = "success";
    }
  } catch (_) {}
}
