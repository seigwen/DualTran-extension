/**
 * Block-level translation loading/error indicators.
 *
 * Manages small inline spinners next to each paragraph being translated.
 * - "google" type: green spinner
 * - "ai" type: purple spinner
 * - state: "loading" | "error" | "done"
 * - Idempotent per (targetNode, translationType, position) triple
 *
 * `position` (5th argument of setBlockTranslationIndicator) selects the anchor
 * the indicator is inserted at / looked up from:
 *   - "after"  (default) — immediately AFTER the target node. Google's anchor:
 *     the target is a source text node, so the spinner lands at the end of the
 *     original line.
 *   - "before" — immediately BEFORE the target node. AI's anchor in newLine
 *     mode: the target is the <translated> container, so the spinner lands at
 *     the end of the text the user is reading.
 *   - "append" — as the last child of the target node. AI's anchor in
 *     replaceOriginal mode: the target IS the block element, so the spinner
 *     trails its text.
 * Lookup and insertion MUST use the same position, otherwise a later "done" /
 * "error" transition cannot find the element it inserted and leaves a stale
 * spinner behind.
 */

const TYPE_COLORS = {
  google: "rgb(22, 163, 74)",   // green-600
  ai: "rgb(124, 58, 237)",      // violet-600
};

/** Normalize a caller-provided anchor; unknown values fall back to "after". */
function normalizePosition(position) {
  return position === "before" || position === "append" ? position : "after";
}

function isIndicatorOfType(node, type) {
  return (
    node.nodeType === 1 &&
    node.classList &&
    node.classList.contains("dualtran-block-indicator") &&
    node.dataset.type === type
  );
}

function findExistingIndicator(targetNode, type, position = "after") {
  const pos = normalizePosition(position);

  if (pos === "before") {
    let sibling = targetNode.previousSibling;
    while (sibling) {
      if (isIndicatorOfType(sibling, type)) {
        return sibling;
      }
      sibling = sibling.previousSibling;
    }
    return null;
  }

  if (pos === "append") {
    const children = targetNode.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (isIndicatorOfType(children[i], type)) {
        return children[i];
      }
    }
    return null;
  }

  let sibling = targetNode.nextSibling;
  while (sibling) {
    if (isIndicatorOfType(sibling, type)) {
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

/**
 * Insert the indicator at the requested anchor.
 *
 * "append" needs no parent (the target itself is the container), but "before" /
 * "after" do: a detached target is a silent no-op instead of a TypeError (the
 * AI path iterates many blocks; one detached block must not abort the rest).
 */
function insertIndicator(targetNode, position, indicator) {
  const pos = normalizePosition(position);

  if (pos === "append") {
    targetNode.appendChild(indicator);
    return;
  }

  const parent = targetNode.parentNode;
  if (!parent) return;

  if (pos === "before") {
    parent.insertBefore(indicator, targetNode);
    return;
  }

  parent.insertBefore(indicator, targetNode.nextSibling);
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
 * @param {Node} targetNode - The node the indicator is anchored to
 * @param {"google"|"ai"} translationType - Which translation service
 * @param {"loading"|"error"|"done"} state - Indicator state
 * @param {string} [errorMessage] - Error message for "error" state
 * @param {"after"|"before"|"append"} [position="after"] - Anchor selector
 */
export function setBlockTranslationIndicator(targetNode, translationType, state, errorMessage, position = "after") {
  const pos = normalizePosition(position);
  const existing = findExistingIndicator(targetNode, translationType, pos);

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
    insertIndicator(targetNode, pos, spinner);
    return;
  }

  if (state === "error") {
    removeIndicator(existing);
    const errorIcon = createErrorIcon(translationType, errorMessage);
    insertIndicator(targetNode, pos, errorIcon);
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
