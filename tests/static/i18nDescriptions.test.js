/**
 * Description freeze guard (spec 47 §2.3 item 3, issue #157).
 *
 * Every NEW en key must carry a translator `description`. The pre-existing
 * backlog (239 keys at freeze time) is frozen into a shrink-only legacy list
 * (`fixtures/i18nDescriptions/legacyNoDescription.json`): entries may leave the
 * list (once the key gains a description) but the guard fails on
 *   - a key that is missing a description and is NOT in the frozen list (new
 *     key without a description), and
 *   - a frozen entry whose key NOW has a description (stale entry — shrink it).
 *
 * The audit is a pure helper so the negative cells below exercise it directly
 * (seeded breaks must be flagged: "删 description → 必红").
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EN_MESSAGES_PATH = resolve(__dirname, "../../src/_locales/en/messages.json");
const LEGACY_LIST_PATH = resolve(__dirname, "fixtures/i18nDescriptions/legacyNoDescription.json");

const enMessages = JSON.parse(readFileSync(EN_MESSAGES_PATH, "utf-8"));
const legacyKeys = JSON.parse(readFileSync(LEGACY_LIST_PATH, "utf-8"));

/**
 * Audit description coverage.
 * @param {Record<string, {message?: string, description?: string}>} messages
 * @param {string[]} frozenKeys — shrink-only legacy keys allowed to lack a description
 * @returns {string[]} human-readable breaks ([] = clean)
 */
function auditDescriptions(messages, frozenKeys) {
  const breaks = [];
  const frozen = new Set(frozenKeys);
  for (const [key, entry] of Object.entries(messages)) {
    const hasDescription =
      typeof entry?.description === "string" && entry.description.trim().length > 0;
    if (!hasDescription && !frozen.has(key)) {
      breaks.push(`missing description on new key: ${key}`);
    }
    if (hasDescription && frozen.has(key)) {
      breaks.push(`stale frozen entry (key now HAS a description — shrink the list): ${key}`);
    }
  }
  for (const key of frozenKeys) {
    if (!(key in messages)) {
      breaks.push(`phantom frozen entry (key no longer exists in en): ${key}`);
    }
  }
  return breaks;
}

describe("description freeze (shrink-only legacy list, spec 47 P3-a)", () => {
  it("every en key outside the frozen legacy list carries a non-empty description", () => {
    expect(auditDescriptions(enMessages, legacyKeys)).toEqual([]);
  });

  it("the frozen list is a subset of en and non-empty (sanity)", () => {
    expect(legacyKeys.length).toBeGreaterThan(0);
    const missing = legacyKeys.filter((k) => !(k in enMessages));
    expect(missing).toEqual([]);
  });

  it("self-check: a seeded new key without a description is flagged (negative calibration)", () => {
    const fixture = {
      someExistingKey: { message: "x", description: "existing" },
      brandNewKey: { message: "brand new" }, // seeded break: no description, not frozen
    };
    const breaks = auditDescriptions(fixture, []);
    expect(breaks).toEqual(["missing description on new key: brandNewKey"]);
  });

  it("self-check: a stale frozen entry (key gained a description) is flagged", () => {
    const fixture = {
      frozenKey: { message: "x", description: "now documented" },
    };
    const breaks = auditDescriptions(fixture, ["frozenKey"]);
    expect(breaks).toEqual([
      "stale frozen entry (key now HAS a description — shrink the list): frozenKey",
    ]);
  });

  it("self-check: a phantom frozen entry (key gone from en) is flagged", () => {
    const breaks = auditDescriptions({}, ["removedKey"]);
    expect(breaks).toEqual(["phantom frozen entry (key no longer exists in en): removedKey"]);
  });

  it("self-check: a clean pair produces no breaks (positive calibration)", () => {
    const fixture = {
      documented: { message: "x", description: "doc" },
      frozenAndUndocumented: { message: "y" },
    };
    expect(auditDescriptions(fixture, ["frozenAndUndocumented"])).toEqual([]);
  });
});
