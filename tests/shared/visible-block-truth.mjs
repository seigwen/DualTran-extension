/**
 * Visible-block-truth oracle (issue #72, escape analysis of #70).
 *
 * The escape analysis (doc 21) found that assertions clustered at L0
 * (element existence) and L1 (state fields), while the user observes L2
 * (visible truth). #70's symptom — `displayMode` says "ai" while the user
 * still sees Google — was structurally false-green for L1 oracles.
 *
 * This helper derives what the user actually SEES for one translated block,
 * from visibility alone (never from state fields), and provides the
 * tri-consistency invariant: visible truth ⇔ block state.
 *
 * Two shapes are supported, selected by the element shape itself:
 *   - newLine dual-span: a <translated> element carrying googleSpan + aiSpan
 *     (display toggled via inline style)
 *   - replaceOriginal: a container whose text nodes carry the visible text
 *     and whose AI span (`.dualtran-aitranslatedtext-replacemode`) is toggled
 *
 * The reader is environment-agnostic (plain DOM API): it runs in jsdom tests
 * and inside the page context of browser E2E alike.
 */

/** Display mode the user is currently seeing for the block. */
export const VISIBLE_MODES = Object.freeze(["original", "google", "ai", "none"]);

const GOOGLE_SPAN_SELECTOR = ".dualtran-google";
const AI_SPAN_SELECTOR = ".dualtran-ai, .dualtran-aitranslatedtext-replacemode";

/** True when an element is actually rendered (not display:none / hidden). */
function isVisible(el) {
  if (!el) return false;
  const style = el.style;
  if (style && style.display === "none") return false;
  if (style && style.visibility === "hidden") return false;
  // jsdom has no layout; walk up for an explicit display:none ancestor only.
  let node = el;
  while (node && node.style) {
    if (node.style.display === "none") return false;
    node = node.parentElement;
  }
  return true;
}

/** Full visible text of a node (own text nodes only, shallow). */
function shallowVisibleText(el) {
  if (!el) return "";
  let text = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) text += n.textContent;
  });
  return text.trim();
}

/**
 * Read what the user currently SEES for one translated block.
 *
 * @param {Element} translatedElement — the block container (for replaceOriginal
 *   this is the registered container; for newLine it is the <translated> element)
 * @param {{ originalText?: string }} [options] — known original source text.
 *   Required to CLASSIFY replaceOriginal node text as google vs original: that
 *   mode carries the translation inside plain text nodes, so the only way to
 *   tell translated from untranslated is comparing against the original.
 * @returns {{ visibleMode: "original"|"google"|"ai"|"none", visibleText: string,
 *             aiVisible: boolean, googleVisible: boolean, visibleSpans: string[] }}
 */
export function readVisibleBlockTruth(translatedElement, options = {}) {
  const empty = {
    visibleMode: "none",
    visibleText: "",
    aiVisible: false,
    googleVisible: false,
    visibleSpans: [],
  };
  if (!translatedElement) return empty;
  // A detached element shows nothing to anybody.
  if (translatedElement.isConnected === false) return empty;

  const googleSpan = translatedElement.querySelector(GOOGLE_SPAN_SELECTOR);
  const aiSpan = translatedElement.querySelector(AI_SPAN_SELECTOR);

  const googleVisible = !!googleSpan && isVisible(googleSpan) && !!googleSpan.textContent;
  const aiVisible = !!aiSpan && isVisible(aiSpan) && !!aiSpan.textContent;
  const containerVisible = isVisible(translatedElement);

  const visibleSpans = [];
  if (containerVisible && googleVisible) visibleSpans.push("google");
  if (containerVisible && aiVisible) visibleSpans.push("ai");

  const originalText = options.originalText;

  // newLine restore mechanism: hiding the whole <translated> element is HOW the
  // original text becomes visible again (restoreBlockOriginal). So a hidden
  // container means the user sees the original, not "nothing".
  if (!containerVisible) {
    return {
      visibleMode: "original",
      visibleText: (originalText || "").trim(),
      aiVisible: false,
      googleVisible: false,
      visibleSpans: [],
    };
  }

  // replaceOriginal: no googleSpan; visible text lives in the container's own
  // text nodes. Google text there is only distinguishable from original text
  // when the caller supplies the known original.
  const nodeText = shallowVisibleText(translatedElement);

  let visibleText = "";
  let nodeCarriedMode = null; // replaceOriginal node-carried classification
  if (aiVisible) {
    visibleText = (aiSpan.textContent || "").trim();
  } else if (googleVisible) {
    visibleText = (googleSpan.textContent || "").trim();
  } else if (!googleSpan && nodeText) {
    visibleText = nodeText;
    if (originalText === undefined) {
      nodeCarriedMode = "original"; // cannot tell — conservative
    } else {
      nodeCarriedMode = nodeText === originalText.trim() ? "original" : "google";
    }
  }

  let visibleMode;
  if (!containerVisible) {
    visibleMode = "none";
  } else if (aiVisible) {
    visibleMode = "ai";
  } else if (googleVisible) {
    visibleMode = "google";
  } else if (nodeCarriedMode) {
    visibleMode = nodeCarriedMode;
  } else if (googleSpan) {
    // newLine: the spans carry the translation (the original text lives outside
    // the <translated> element). No span visible → the user reads the original.
    visibleMode = "original";
  } else if (visibleText) {
    visibleMode = "original";
  } else {
    visibleMode = "none";
  }

  return { visibleMode, visibleText, aiVisible, googleVisible, visibleSpans };
}

/**
 * Tri-consistency invariant (escape mechanism 2): the visible truth must
 * agree with the block state's displayMode. Catches the #70 class where the
 * state field says "ai" while the user still sees Google.
 *
 * `none` (fully hidden) is only allowed while the block is in its restored
 * (original) state; any other combination where the state claims a mode that
 * is not actually visible is a desync.
 *
 * @param {Element} translatedElement
 * @param {{ displayMode?: string }} blockState
 * @param {{ originalText?: string }} [options] — see readVisibleBlockTruth
 * @returns {{ ok: boolean, reason?: string, truth: Object }}
 */
export function checkVisibleMatchesState(translatedElement, blockState, options = {}) {
  const truth = readVisibleBlockTruth(translatedElement, options);
  const declared = blockState && blockState.displayMode;
  if (!declared) {
    return { ok: false, reason: "block state carries no displayMode", truth };
  }

  // Restored / original state: the translation must NOT be visible.
  if (declared === "original") {
    if (truth.visibleMode === "google" || truth.visibleMode === "ai") {
      return {
        ok: false,
        reason: `state=original but ${truth.visibleMode} translation is visible`,
        truth,
      };
    }
    return { ok: true, truth };
  }

  if (truth.visibleMode !== declared) {
    return {
      ok: false,
      reason: `state=${declared} but the block visibly shows ${truth.visibleMode}`,
      truth,
    };
  }
  return { ok: true, truth };
}