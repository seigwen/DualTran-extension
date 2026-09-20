/**
 * Arrival-path symmetry meta-test (issue #72, mechanism 3).
 *
 * THE GAP THIS CLOSES (#70 escape)
 * An AI result can arrive through three physically different paths
 * (memory-cache / persistent-cache / stream). #70 lived ONLY on the
 * non-streaming arrivals; the old harness mocked the stream parser, so the
 * defect had zero coverage and no mechanism would ever have noticed a path
 * silently dropping out of the test space. Display modes have a symmetry lint;
 * arrival paths had nothing.
 *
 * THE INVARIANT (both directions enforced)
 *   Production  →  SSOT: every `@arrival-path: <id>` tag in pageTranslator.js
 *                        names an id declared in tests/shared/arrival-paths.mjs
 *   SSOT        →  Production: every declared id is tagged in production
 *                        (a path removed from production must be removed from
 *                         the SSOT in the same change)
 *   SSOT        →  Matrix: every declared id is consumed by the interaction
 *                        matrix's ARRIVAL_PATHS enumeration (the cells actually
 *                        run it)
 *
 * Any one-sided change turns red, forcing the three surfaces to move together.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARRIVAL_PATH_IDS,
  ARRIVAL_PATH_DESCRIPTIONS,
  ARRIVAL_SITE_FILE,
  ARRIVAL_TAG_RE,
} from "../shared/arrival-paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

/** Extract all `@arrival-path: <id>` tags from the production file. */
function readProductionTags() {
  const source = readFileSync(join(REPO_ROOT, ARRIVAL_SITE_FILE), "utf8");
  const tags = [];
  let m;
  ARRIVAL_TAG_RE.lastIndex = 0;
  while ((m = ARRIVAL_TAG_RE.exec(source)) !== null) {
    tags.push(m[1]);
  }
  return tags;
}

/** Read the matrix's ARRIVAL_PATHS table the same way a reader would. */
function readMatrixArrivalPaths() {
  const source = readFileSync(
    join(REPO_ROOT, "tests", "contentScript", "crossLevelInteraction.matrix.test.js"),
    "utf8"
  );
  const m = source.match(/export const ARRIVAL_PATHS = \[([^\]]+)\]/);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

describe("arrival-path symmetry — production ⇔ SSOT ⇔ matrix", () => {
  it("every production @arrival-path tag names a declared id", () => {
    const declared = new Set(ARRIVAL_PATH_IDS);
    const production = readProductionTags();
    expect(production.length, "no @arrival-path tags found in production").toBeGreaterThan(0);
    for (const tag of production) {
      expect(
        declared.has(tag),
        `production tags "${tag}" which is not declared in tests/shared/arrival-paths.mjs`
      ).toBe(true);
    }
  });

  it("every declared id is tagged in production (no orphan declarations)", () => {
    const production = new Set(readProductionTags());
    for (const id of ARRIVAL_PATH_IDS) {
      expect(
        production.has(id),
        `SSOT declares "${id}" (${ARRIVAL_PATH_DESCRIPTIONS[id]}) but production has no @arrival-path: ${id} tag`
      ).toBe(true);
    }
  });

  it("every declared id is exercised by the interaction matrix", () => {
    const matrixPaths = readMatrixArrivalPaths();
    expect(matrixPaths, "matrix ARRIVAL_PATHS table not found").not.toBeNull();
    const matrixSet = new Set(matrixPaths);
    for (const id of ARRIVAL_PATH_IDS) {
      expect(
        matrixSet.has(id),
        `SSOT declares "${id}" but the interaction matrix does not enumerate it — the path would silently lose coverage (#70 mechanism)`
      ).toBe(true);
    }
    // And the reverse: the matrix must not invent ids the SSOT does not know.
    for (const id of matrixPaths) {
      expect(
        ARRIVAL_PATH_IDS.includes(id),
        `matrix enumerates "${id}" which is not declared in the arrival-path SSOT`
      ).toBe(true);
    }
  });

  it("the SSOT itself has no duplicates and is non-empty", () => {
    expect(ARRIVAL_PATH_IDS.length).toBeGreaterThan(0);
    expect(new Set(ARRIVAL_PATH_IDS).size).toBe(ARRIVAL_PATH_IDS.length);
    for (const id of ARRIVAL_PATH_IDS) {
      expect(ARRIVAL_PATH_DESCRIPTIONS[id], `missing description for "${id}"`).toBeTruthy();
    }
  });
});
