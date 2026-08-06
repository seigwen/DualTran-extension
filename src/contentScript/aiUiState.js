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

  // replaceOriginal 模式下，AI 译文应使用原文颜色，不应用配置的译文颜色
  // 通过检查 translatedTextNode 或其父元素是否带有 data-dualtran-block 属性来判断是否为 replaceOriginal 模式
  const translatedTextNode = btnAi?.translatedTextNode;
  if (!translatedTextNode) {
    return;
  }

  // 检查是否在 replaceOriginal 模式下
  // replaceOriginal 模式下，AI span 的父元素（或祖先元素）会有 data-dualtran-block 属性
  let checkElement = translatedTextNode;
  while (checkElement) {
    if (checkElement.dataset?.dualtranBlock) {
      // replaceOriginal 模式下不应用颜色，使用原文颜色
      return;
    }
    checkElement = checkElement.parentElement || checkElement.parentNode;
    // 只检查到 body 元素为止
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

  // replaceOriginal 模式：AI 翻译开始时清空/隐藏原始节点，避免 AI 译文显示在原文右侧
  // 文本节点（nodeType === 3）：清空内容，并隐藏其父元素（如 <code>）
  // 元素节点（nodeType === 1）：使用 display:none 隐藏（保留元素以便恢复）
  try {
    const blockState = btnAi._st ? btnAi._st() : null;
    if (blockState && Array.isArray(blockState.nodesToClear) && blockState.nodesToClear.length > 0) {
      blockState.nodesToClear.forEach((node) => {
        try {
          if (node.nodeType === 3) {
            // 文本节点：清空内容
            node.textContent = "";
            // 如果父元素是内联元素（如 <code>、<a>、<b> 等），也隐藏父元素
            const parent = node.parentNode;
            if (parent && parent.nodeType === 1 && parent.style && !parent.dataset?.dualtranBlock) {
              parent.style.display = "none";
            }
          } else if (node.nodeType === 1 && node.style) {
            // 元素节点：隐藏（保留元素以便恢复）
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
    if (typeof translatedText === "string" && btnAi.translatedTextNode) {
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

  // replaceOriginal 模式：AI 翻译成功时清空/隐藏原始节点（包括缓存命中场景）
  // 文本节点（nodeType === 3）：清空内容，并隐藏其父元素（如 <code>）
  // 元素节点（nodeType === 1）：使用 display:none 隐藏（保留元素以便恢复）
  try {
    const blockState = btnAi._st ? btnAi._st() : null;
    if (blockState && Array.isArray(blockState.nodesToClear) && blockState.nodesToClear.length > 0) {
      blockState.nodesToClear.forEach((node) => {
        try {
          if (node.nodeType === 3) {
            // 文本节点：清空内容
            node.textContent = "";
            // 如果父元素是内联元素（如 <code>、<a>、<b> 等），也隐藏父元素
            const parent = node.parentNode;
            if (parent && parent.nodeType === 1 && parent.style && !parent.dataset?.dualtranBlock) {
              parent.style.display = "none";
            }
          } else if (node.nodeType === 1 && node.style) {
            // 元素节点：隐藏（保留元素以便恢复）
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
    if (typeof translatedText === "string" && btnAi.translatedTextNode) {
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
    // 如果有 error code（如 HTTP 状态码），将其包含在消息中
    const code = err?.error?.code ?? err?.code;
    const prefix = (code != null) ? code + " - " : "";
    return "AI translation error: " + prefix + msg;
  }
  // Fallback for unexpected error shapes
  const fallback = err?.error || err?.message || err || "unknown error";
  const fallbackStr = typeof fallback === "object" ? JSON.stringify(fallback) : String(fallback);
  return "AI translation error: " + fallbackStr;
}
