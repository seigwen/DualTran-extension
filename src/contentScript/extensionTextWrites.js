/**
 * Registry of text-node values written by the extension itself.
 *
 * ── Why this exists ──
 *
 * The MutationObserver must distinguish two kinds of text mutations:
 *   1. The extension writing translation results into text nodes (must NOT be
 *      re-fed into the translation engine — that is the feedback loop fixed
 *      by PR #16 and guarded by the observer-feedback-loop E2E scenario).
 *   2. The SITE rewriting text in place, e.g. x.com's "Show more" expanding a
 *      truncated post by assigning `textNode.data` (a characterData mutation).
 *      These updates MUST be picked up and re-translated, otherwise expanded
 *      content stays in the source language (bug: x.com show-more untranslated).
 *
 * A blanket `if (mutation.type === "characterData") return` treats both kinds
 * as the extension's own writes and swallows site updates entirely. Instead we
 * record the value the extension wrote, and classify at observer time:
 *
 *   - value === last extension-written value  → self-inflicted, skip
 *   - anything else                            → host mutation, re-translate
 *
 * Value comparison rather than membership: a later SITE write to the same node
 * produces a different value, so it must still count as a host mutation
 * (same semantics as read-frog's `wasCharacterDataChangeExtensionDriven`).
 *
 * Marking must happen at EVERY extension write site that targets page source
 * text (translateResults, block restore/switch helpers, AI state writers).
 * A missed site would let a self-write slip through as "host content" and
 * re-enter the translation pipeline.
 */

/** @type {WeakMap<Node, string>} text node → last value written by the extension */
const extensionTextWrites = new WeakMap();

/**
 * Record the value the extension just wrote.
 *
 * Call immediately AFTER writing, since the registry stores the node's
 * current data. Accepts the node that was written through: when a Text node
 * is passed its data was set directly (characterData path); when an Element
 * is passed its textContent was set and the (possibly reused) child text
 * node is recorded.
 *
 * @param {Node|null|undefined} node - node the extension wrote into
 */
export function markTextWrite(node) {
  if (!node) return;
  const textNode = node.nodeType === 3 ? node : node.firstChild;
  if (textNode && textNode.nodeType === 3) {
    extensionTextWrites.set(textNode, textNode.data);
  }
}

/**
 * True when the text node's current data equals the value the extension
 * last wrote into it — i.e. the mutation is the extension's own write.
 *
 * @param {Node|null|undefined} textNode
 * @returns {boolean}
 */
export function isExtensionWrittenText(textNode) {
  return (
    !!textNode &&
    textNode.nodeType === 3 &&
    extensionTextWrites.get(textNode) === textNode.data
  );
}
