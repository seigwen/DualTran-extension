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

  // replaceOriginal mode: clear/hide original nodes when AI translation starts, to avoid showing AI translation to the right of original text
  // Text nodes (nodeType === 3): clear content and hide INLINE parent elements only
  // Block-level parents (<li>, <p>, <div>) must NOT be hidden.
  // Element nodes (nodeType === 1): hide with display:none (keep element for restoration)
  const INLINE_ELEMENTS = new Set([
    "a", "abbr", "b", "bdo", "cite", "code", "dfn", "em", "i", "kbd",
    "label", "mark", "q", "ruby", "rt", "rp", "s", "samp", "small",
    "span", "strong", "sub", "sup", "time", "tt", "u", "var", "font", "wbr",
  ]);
  try {
    const blockState = btnAi._st ? btnAi._st() : null;
    if (blockState && Array.isArray(blockState.nodesToClear) && blockState.nodesToClear.length > 0) {
      blockState.nodesToClear.forEach((node) => {
        try {
          if (node.nodeType === 3) {
            // Text node: clear content
            node.textContent = "";
            // If parent is an inline element (e.g., <code>, <a>, <b>), also hide the parent
            const parent = node.parentNode;
            if (parent && parent.nodeType === 1 && parent.style && !parent.dataset?.dualtranBlock && INLINE_ELEMENTS.has(parent.nodeName.toLowerCase())) {
              parent.style.display = "none";
            }
          } else if (node.nodeType === 1 && node.style) {
            // Element node: hide (keep element for restoration)
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

  // replaceOriginal mode: clear/hide original nodes when AI translation succeeds (including cache hits)
  // Text nodes (nodeType === 3): clear content and hide INLINE parent elements only
  // Block-level parents (<li>, <p>, <div>) must NOT be hidden.
  // Element nodes (nodeType === 1): hide with display:none (keep element for restoration)
  try {
  const INLINE_ELEMENTS = new Set([
    "a", "abbr", "b", "bdo", "cite", "code", "dfn", "em", "i", "kbd",
    "label", "mark", "q", "ruby", "rt", "rp", "s", "samp", "small",
    "span", "strong", "sub", "sup", "time", "tt", "u", "var", "font", "wbr",
  ]);
    const blockState = btnAi._st ? btnAi._st() : null;
    if (blockState && Array.isArray(blockState.nodesToClear) && blockState.nodesToClear.length > 0) {
      blockState.nodesToClear.forEach((node) => {
        try {
          if (node.nodeType === 3) {
            // Text node: clear content
            node.textContent = "";
            // If parent is an inline element (e.g., <code>, <a>, <b>), also hide the parent
            const parent = node.parentNode;
            if (parent && parent.nodeType === 1 && parent.style && !parent.dataset?.dualtranBlock && INLINE_ELEMENTS.has(parent.nodeName.toLowerCase())) {
              parent.style.display = "none";
            }
          } else if (node.nodeType === 1 && node.style) {
            // Element node: hide (keep element for restoration)
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
