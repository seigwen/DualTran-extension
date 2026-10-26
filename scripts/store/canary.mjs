/**
 * Post-release canary (plan 87, P4).
 *
 * "We uploaded it" is not "the store serves it". This downloads the artefact the store
 * actually hands to users, unzips it, and checks that it is the version we think we shipped
 * and that the manifest still declares icons that exist in the package (the AMO icon defect
 * shipped because nothing compared the package to the listing).
 *
 * Usage: node scripts/store/canary.mjs [--version=2.2.4]
 * Exit: 0 = match, 1 = mismatch, 2 = download/IO error.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function localVersion() {
  const raw = fs.readFileSync(path.join(ROOT, "src", "manifest.json"), "utf8");
  return (raw.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || "";
}

async function latestAmoFileUrl(slug) {
  const response = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${slug}/`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`AMO API HTTP ${response.status}`);
  const data = await response.json();
  return { version: data.current_version?.version || "", url: data.current_version?.file?.url || "" };
}

function unzip(xpi, dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("unzip", ["-o", "-q", xpi, "-d", dir], { stdio: "ignore" });
  return path.join(dir, "manifest.json");
}

async function main() {
  const argVersion = (process.argv.find((a) => a.startsWith("--version=")) || "").split("=")[1] || "";
  const expected = argVersion || localVersion();
  const slug = "dualtran";

  const { version: liveVersion, url } = await latestAmoFileUrl(slug);
  if (!url) throw new Error("AMO returned no file url");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dualtran-canary-"));
  const xpi = path.join(tmp, "live.xpi");
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  fs.writeFileSync(xpi, Buffer.from(await response.arrayBuffer()));

  const manifestPath = unzip(xpi, path.join(tmp, "x"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const problems = [];
  if (liveVersion !== expected) problems.push(`store version ${liveVersion} != expected ${expected}`);
  if (manifest.version !== expected) problems.push(`package manifest ${manifest.version} != expected ${expected}`);

  const icons = manifest.icons || {};
  for (const [size, rel] of Object.entries(icons)) {
    const file = path.join(tmp, "x", rel.replace(/^\/+/, ""));
    if (!fs.existsSync(file)) problems.push(`icon ${size} declared but missing: ${rel}`);
  }
  if (Object.keys(icons).length === 0) problems.push("manifest declares no icons");

  fs.rmSync(tmp, { recursive: true, force: true });

  if (problems.length) {
    for (const problem of problems) console.error(`[canary] FAIL ${problem}`);
    return 1;
  }
  console.log(`[canary] ok — AMO serves ${liveVersion}, manifest and ${Object.keys(icons).length} icon(s) match`);
  return 0;
}

try {
  process.exit(await main());
} catch (error) {
  console.error(`[canary] error: ${error.message}`);
  process.exit(2);
}
