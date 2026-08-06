import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

function readJSON(relativePath) {
  const filePath = resolve(ROOT, relativePath);
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function readJSONC(relativePath) {
  const filePath = resolve(ROOT, relativePath);
  const raw = readFileSync(filePath, "utf-8");
  let result = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      result += ch;
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      if (ch === '"') inString = false;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      result += "\n";
      continue;
    }
    if (ch === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i++;
      continue;
    }
    result += ch;
  }
  return JSON.parse(result);
}

describe("package.json sanity", () => {
  const pkg = readJSON("package.json");

  it("has a name field", () => {
    expect(typeof pkg.name).toBe("string");
    expect(pkg.name.length).toBeGreaterThan(0);
  });

  it("has a version field in semver format", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("has test scripts defined", () => {
    expect(pkg.scripts?.test).toBeDefined();
  });

  it("has devDependencies including vitest", () => {
    const deps = {
      ...pkg.devDependencies,
      ...pkg.dependencies,
    };
    expect(deps.vitest).toBeDefined();
  });

  it("does not list vitest in production dependencies", () => {
    expect(pkg.dependencies?.vitest).toBeUndefined();
  });
});

describe("manifest.json sanity", () => {
  const manifestPath = resolve(ROOT, "src/manifest.json");
  const hasManifest = existsSync(manifestPath);

  it("manifest.json exists in src/", () => {
    expect(hasManifest).toBe(true);
  });

  if (hasManifest) {
    const manifest = readJSONC("src/manifest.json");

    it("has manifest_version 3", () => {
      expect(manifest.manifest_version).toBe(3);
    });

    it("has a name", () => {
      expect(typeof manifest.name).toBe("string");
      expect(manifest.name.length).toBeGreaterThan(0);
    });

    it("has a version", () => {
      expect(manifest.version).toMatch(/^\d+/);
    });

    it("declares permissions array", () => {
      expect(Array.isArray(manifest.permissions)).toBe(true);
    });

    it("declares a default_locale", () => {
      expect(typeof manifest.default_locale).toBe("string");
    });

    it("default_locale has a matching _locales directory", () => {
      const localeDir = resolve(
        ROOT,
        "src/_locales",
        manifest.default_locale
      );
      expect(existsSync(localeDir)).toBe(true);
    });

    it("content_scripts entries reference existing files", () => {
      if (!manifest.content_scripts) return;
      for (const cs of manifest.content_scripts) {
        if (cs.js) {
          for (const jsFile of cs.js) {
            const relativePath = jsFile.replace(/^\//, "");
            const fullPath = resolve(ROOT, "src", relativePath);
            expect(
              existsSync(fullPath),
              `content_script JS not found: ${jsFile}`
            ).toBe(true);
          }
        }
      }
    });
  }
});
