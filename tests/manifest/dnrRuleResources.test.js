import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC_MANIFEST = path.join(ROOT, "src/manifest.json");

// src/manifest.json is JSON-with-comments; strip single-line // comments
// outside string literals before parsing.
function stripComments(text) {
  return text.split("\n").map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//")) return "";
    let inString = false;
    let escape = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (!inString && ch === "/" && line[i + 1] === "/") {
        return line.slice(0, i).trimEnd();
      }
    }
    return line;
  }).join("\n");
}

function readManifest() {
  return JSON.parse(stripComments(fs.readFileSync(SRC_MANIFEST, "utf8")));
}

// ---------------------------------------------------------------------------
// Store validators resolve declarative_net_request paths literally against
// the package root. A leading slash makes the referenced file unresolvable:
// Edge Add-ons rejects the upload with "The ZIP file doesn't contain the
// /rules/request_modifier_rule.json file" even though the file is present.
// Chrome tolerates the leading slash, so this only surfaces on Edge.
// ---------------------------------------------------------------------------
describe("declarative_net_request rule resources", () => {
  const manifest = readManifest();
  const resources = manifest.declarative_net_request?.rule_resources ?? [];

  it("declares at least one rule resource", () => {
    expect(Array.isArray(resources)).toBe(true);
    expect(resources.length).toBeGreaterThan(0);
  });

  it("uses relative paths without a leading slash", () => {
    for (const resource of resources) {
      expect(typeof resource.path).toBe("string");
      expect(resource.path.startsWith("/")).toBe(false);
    }
  });

  it("references rule files that exist under src/", () => {
    for (const resource of resources) {
      const abs = path.join(ROOT, "src", resource.path);
      expect(fs.existsSync(abs), `missing rule file: ${resource.path}`).toBe(true);
    }
  });
});
