/**
 * Block-level translation loading/error indicators.
 *
 * Manages small inline spinners next to each paragraph being translated.
 * - "google" type: green spinner
 * - "ai" type: purple spinner
 * - state: "loading" | "error" | "done"
 * - Idempotent per (targetNode, translationType) pair
 */

const TYPE_COLORS = {
  google: "rgb(22, 163, 74)",   // green-600
  ai: "rgb(124, 58, 237)",      // violet-600
};

function findExistingIndicator(targetNode, type) {
  let sibling = targetNode.nextSibling;
  while (sibling) {
    if (
      sibling.nodeType === 1 &&
      sibling.classList &&
      sibling.classList.contains("dualtran-block-indicator") &&
      sibling.dataset.type === type
    ) {
      return sibling;
    }
    sibling = sibling.nextSibling;
  }
  return null;
}

function removeIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator);
  }
}

function createSpinner(type) {
  const span = document.createElement("span");
  span.className = "dualtran-block-indicator dualtran-block-spinner";
  span.dataset.type = type;
  span.dataset.state = "loading";
  span.style.cssText =
    "display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:999px; animation:dualtranBlockSpinnerRotate 0.7s linear infinite; opacity:0.5; vertical-align:middle; margin-left:4px; box-sizing:border-box;";
  span.style.color = TYPE_COLORS[type];
  span.setAttribute("aria-label", type + " translation in progress");
  return span;
}

function createErrorIcon(type, errorMessage) {
  const span = document.createElement("span");
  span.className = "dualtran-block-indicator dualtran-block-error";
  span.dataset.type = type;
  span.dataset.state = "error";
  span.style.cssText =
    "display:inline-block; font-size:12px; opacity:0.5; vertical-align:middle; margin-left:4px; cursor:help;";
  span.style.color = TYPE_COLORS[type];
  span.textContent = "⚠";
  span.title = errorMessage || "Translation error";
  span.setAttribute("aria-label", type + " translation error");
  return span;
}

/**
 * Manage a block-level translation indicator.
 *
 * @param {Node} targetNode - The node to insert the indicator after
 * @param {"google"|"ai"} translationType - Which translation service
 * @param {"loading"|"error"|"done"} state - Indicator state
 * @param {string} [errorMessage] - Error message for "error" state
 */
export function setBlockTranslationIndicator(targetNode, translationType, state, errorMessage) {
  const existing = findExistingIndicator(targetNode, translationType);

  if (state === "done") {
    removeIndicator(existing);
    return;
  }

  if (state === "loading") {
    if (existing && existing.dataset.state === "loading") {
      // Already loading — idempotent no-op
      return;
    }
    removeIndicator(existing);
    const spinner = createSpinner(translationType);
    targetNode.parentNode.insertBefore(spinner, targetNode.nextSibling);
    return;
  }

  if (state === "error") {
    removeIndicator(existing);
    const errorIcon = createErrorIcon(translationType, errorMessage);
    targetNode.parentNode.insertBefore(errorIcon, targetNode.nextSibling);
    return;
  }
}

/**
 * Inject the CSS animation keyframes needed by the spinner.
 * Call once during page initialization.
 */
export function injectBlockIndicatorStyles() {
  if (document.getElementById("dualtran-block-indicator-style")) return;
  const style = document.createElement("style");
  style.id = "dualtran-block-indicator-style";
  style.textContent = `
    @keyframes dualtranBlockSpinnerRotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}
