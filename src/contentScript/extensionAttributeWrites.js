/**
 * Registry of attribute values written by the extension itself.
 *
 * ── Why this exists ──
 *
 * Sibling module of extensionTextWrites.js, one level up: the MutationObserver
 * must distinguish two kinds of ATTRIBUTE mutations on translatable attributes
 * (placeholder / alt / title / value):
 *   1. The extension writing translation results into those attributes
 *      (translateAttributes → setAttribute). Re-feeding these into the pipeline
 *      is the attribute-channel twin of the text feedback loop (#16).
 *   2. The SITE rewriting such an attribute after translation, e.g. a lazy
 *      content update swapping a `placeholder`, or injecting a new element that
 *      carries `alt` (same user-visible family as x.com "Show more": content
 *      that appears after translation must be translated).
 *
 * The observer has NO `attributes` observation at all before this change, so
 * category 2 was never seen — a forward-looking gap of the same family
 * (channel audit 2026-09-27, see tests/shared/content-update-channels.mjs).
 *
 * Classification is by VALUE, exactly like the text side: if the attribute's
 * current value equals the value the extension last wrote into that
 * (element, attribute) pair, the mutation is a self-write; anything else is a
 * host update. Value comparison (not membership) matters: a later SITE write to
 * the same attribute produces a different value and must still count as a host
 * mutation.
 *
 * Marking must happen at EVERY extension write site that targets page
 * attributes (translateAttributes, restorePage restore path).
 */

/** @type {WeakMap<Element, Map<string, string|null>>} element → attrName → last written value */
const extensionAttributeWrites = new WeakMap();

/**
 * Record the value the extension just wrote into an attribute.
 * Call immediately AFTER setAttribute/removeAttribute, so the registry stores
 * the element's current value for that attribute.
 *
 * @param {Element|null|undefined} el - element the extension wrote into
 * @param {string} attrName
 */
export function markAttributeWrite(el, attrName) {
  if (!el || el.nodeType !== 1 || !attrName) return;
  let perElement = extensionAttributeWrites.get(el);
  if (!perElement) {
    perElement = new Map();
    extensionAttributeWrites.set(el, perElement);
  }
  perElement.set(attrName, el.getAttribute(attrName));
}

/**
 * True when the attribute's current value equals the value the extension last
 * wrote into this (element, attribute) pair — i.e. the mutation is the
 * extension's own write.
 *
 * @param {Element|null|undefined} el
 * @param {string} attrName
 * @returns {boolean}
 */
export function isExtensionWrittenAttribute(el, attrName) {
  if (!el || el.nodeType !== 1 || !attrName) return false;
  const perElement = extensionAttributeWrites.get(el);
  return !!perElement && perElement.has(attrName) && perElement.get(attrName) === el.getAttribute(attrName);
}
