#!/usr/bin/env node
/**
 * fetch-firefox-tools.mjs — download the Firefox desktop build + geckodriver
 * into tools/ for the smoke suite (plan 62 M3).
 *
 * Pinned versions; both artifacts are checksum-verified:
 *   - geckodriver: official .sha256 asset next to the release archive;
 *   - firefox: SHA512SUMS from the mozilla release directory.
 *
 * Idempotent: re-running skips anything already present and verified.
 * tools/ is gitignored; CI caches it keyed on these constants.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_DIR = path.join(ROOT, "tools");

export const FIREFOX_VERSION = "158.0";
export const GECKODRIVER_VERSION = "0.37.1";

const GEO_PLATFORM = "linux64";
const GECKODRIVER_ARCHIVE = `geckodriver-v${GECKODRIVER_VERSION}-${GEO_PLATFORM}.tar.gz`;

const DOWNLOADS = [
  {
    name: "firefox",
    archive: `firefox-${FIREFOX_VERSION}.tar.xz`,
    url: `https://archive.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/linux-x86_64/en-US/firefox-${FIREFOX_VERSION}.tar.xz`,
    checksumsUrl: `https://archive.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/SHA512SUMS`,
    checksumsFile: `SHA512SUMS`,
    // full relative path: "linux-i686/..." shares the same file-name suffix
    sumsPath: `linux-x86_64/en-US/firefox-${FIREFOX_VERSION}.tar.xz`,
    algo: "sha512",
    // the archive carries a top-level firefox/ directory -> extract into tools/
    extractTo: ".",
    binary: path.join("firefox", "firefox"),
  },
  {
    name: "geckodriver",
    archive: GECKODRIVER_ARCHIVE,
    url: `https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/${GECKODRIVER_ARCHIVE}`,
    // geckodriver publishes no .sha256 asset; GitHub's release API exposes a
    // per-asset sha256 digest (format "sha256:<hex>").
    digestApiUrl: `https://api.github.com/repos/mozilla/geckodriver/releases/tags/v${GECKODRIVER_VERSION}`,
    algo: "sha256",
    extractTo: "geckodriver",
    binary: path.join("geckodriver", "geckodriver"),
  },
];

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return await res.text();
}

async function fetchFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function shaOf(file, algo) {
  const hash = createHash(algo);
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

/**
 * @param {{name: string, archive: string, url: string, checksumsUrl: string,
 *          checksumsFile?: string, algo: string, extractTo: string, binary: string}} spec
 */
async function ensureTool(spec) {
  const binaryPath = path.join(TOOLS_DIR, spec.binary);
  if (fs.statSync(binaryPath, { throwIfNoEntry: false })?.isFile()) {
    console.log(`[fetch-firefox-tools] ${spec.name}: already present (${binaryPath})`);
    return;
  }

  const archivePath = path.join(TOOLS_DIR, spec.archive);
  if (!fs.existsSync(archivePath)) {
    console.log(`[fetch-firefox-tools] ${spec.name}: downloading ${spec.url}`);
    await fetchFile(spec.url, archivePath);
  }

  console.log(`[fetch-firefox-tools] ${spec.name}: verifying ${spec.algo}`);
  let expected;
  if (spec.checksumsUrl) {
    const sums = await fetchText(spec.checksumsUrl);
    expected = sums
      .split("\n")
      .find((line) => line.trim().endsWith(spec.sumsPath || spec.archive))
      ?.trim()
      .split(/\s+/)[0];
  } else if (spec.digestApiUrl) {
    const release = JSON.parse(await fetchText(spec.digestApiUrl));
    expected = String(
      (release.assets || []).find((a) => a.name === spec.archive)?.digest || ""
    ).replace(/^sha256:/, "");
  }
  if (!expected) throw new Error(`${spec.name}: checksum for ${spec.archive} not found`);
  const actual = shaOf(archivePath, spec.algo);
  if (actual !== expected) {
    fs.rmSync(archivePath, { force: true });
    throw new Error(`${spec.name}: checksum mismatch (expected ${expected}, got ${actual}) - archive deleted`);
  }

  console.log(`[fetch-firefox-tools] ${spec.name}: extracting to tools/${spec.extractTo}/`);
  fs.mkdirSync(path.join(TOOLS_DIR, spec.extractTo), { recursive: true });
  const args =
    spec.archive.endsWith(".tar.xz") || spec.archive.endsWith(".tar.gz")
      ? ["-xf", archivePath, "-C", path.join(TOOLS_DIR, spec.extractTo)]
      : ["-xf", archivePath];
  execFileSync("tar", args);
  fs.chmodSync(binaryPath, 0o755);
  console.log(`[fetch-firefox-tools] ${spec.name}: ready (${binaryPath})`);
}

export async function ensureAllTools() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  for (const spec of DOWNLOADS) {
    await ensureTool(spec);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureAllTools()
    .then(() => console.log("[fetch-firefox-tools] all tools ready."))
    .catch((e) => {
      console.error(`[fetch-firefox-tools] FAILED: ${e.message}`);
      process.exit(1);
    });
}
