import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = fs.readFileSync(path.join(ROOT, "src", "manifest.json"), "utf8");

/**
 * The manifest carries `//` comments, so it is not strict JSON. The icons block has no
 * comments inside it, and pinning that block is all these assertions need.
 */
function icons() {
  const block = SRC.match(/"icons"\s*:\s*\{([\s\S]*?)\}/);
  if (!block) return {};
  const found = {};
  for (const match of block[1].matchAll(/"(\d+)"\s*:\s*"([^"]+)"/g)) found[match[1]] = match[2];
  return found;
}

/**
 * BUG-001: the AMO listing rendered the default placeholder icon. The cause was the icon
 * block itself — leading-slash paths (AMO resolves icons relative to the package root, so
 * `/icons/x.png` misses) and no 48/96 declarations (the sizes AMO extracts). These
 * assertions pin the shape AMO needs, not the fix of the day.
 */
describe("manifest icons (BUG-001)", () => {
  it("declares icons as package-relative paths", () => {
    const map = icons();
    expect(Object.keys(map).length).toBeGreaterThan(0);
    for (const [size, href] of Object.entries(map)) {
      expect(href.startsWith("/"), `icons[${size}] must not start with a slash: ${href}`).toBe(false);
      expect(href.startsWith("http"), `icons[${size}] must be packaged, not remote: ${href}`).toBe(false);
    }
  });

  it("ships the sizes AMO extracts", () => {
    const map = icons();
    for (const size of ["48", "96", "128"]) {
      expect(map[size], `manifest is missing icons["${size}"]`).toBeTruthy();
    }
  });

  it("points at files that actually exist in src/", () => {
    const map = icons();
    expect(Object.keys(map).length).toBeGreaterThan(0);
    for (const href of Object.values(map)) {
      expect(fs.existsSync(path.join(ROOT, "src", href)), `missing file: src/${href}`).toBe(true);
    }
  });

  it("does not ship the AMO placeholder", () => {
    for (const href of Object.values(icons())) {
      expect(href.includes("default")).toBe(false);
    }
  });
});
