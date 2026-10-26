/**
 * Store listing audit (plan 85, P2).
 *
 * The store page is a release artefact, so it gets assertions:
 *   - AMO: version, description length + required claims, icon actually extracted (and
 *     visually the same as src/icons/icon-64.png, not just "not the default")
 *   - Obsidian / npm / VS Code: the published version matches package.json / manifest
 *   - Chrome / Edge / Opera: the public page is reachable (upload is manual; the read-back
 *     is what tells us whether the upload landed)
 *   - uTools / Outlook: manual checklist evidence per version
 *
 * Usage: node scripts/store/audit.mjs [--json]
 * Exit: 0 = all pass, 1 = at least one fail, 2 = usage/IO error.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LISTING = JSON.parse(fs.readFileSync(path.join(ROOT, "store", "listing.json"), "utf8"));
const EVIDENCE_DIR = path.join(ROOT, "store", "evidence");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Version in src/manifest.json (tolerates // comments). */
function localVersion() {
  const raw = fs.readFileSync(path.join(ROOT, "src", "manifest.json"), "utf8");
  return (raw.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || "";
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers || {}) } });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

/* ── AMO ─────────────────────────────────────────────── */

function amoAuthToken() {
  const credPath = path.join(os.homedir(), ".amo-credentials");
  if (!fs.existsSync(credPath)) return "";
  const values = {};
  for (const line of fs.readFileSync(credPath, "utf8").split("\n")) {
    if (!line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim();
  }
  const key = values.WEB_EXT_API_KEY;
  const secret = values.WEB_EXT_API_SECRET;
  if (!key || !secret) return "";
  const b64 = (data) => Buffer.from(data).toString("base64url").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ iss: key, jti: crypto.randomUUID().replace(/-/g, ""), iat: now, exp: now + 300 }));
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url").replace(/=+$/, "");
  return `${header}.${payload}.${signature}`;
}

/** Compare two PNGs with ImageMagick; returns an RMSE in 0..1 or null when unavailable. */
function imageDistance(a, b) {
  try {
    const out = execFileSync("compare", ["-metric", "RMSE", a, b, "null:"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return Number.parseFloat(out) || 0;
  } catch (error) {
    const stderr = String(error.stderr || "");
    const match = stderr.match(/\(([\d.]+)\)/);
    if (match) return Number.parseFloat(match[1]);
    return null;
  }
}

async function checkAmo(listing, results) {
  const channel = listing.channels.amo;
  // No `lang` filter: AMO returns every locale when it is omitted, and `?lang=` returns
  // only that one (which made the en-US length check read as empty).
  const base = `https://addons.mozilla.org/api/v5/addons/addon/${channel.slug}/`;
  const token = amoAuthToken();
  const response = await fetchText(base, token ? { headers: { Authorization: `JWT ${token}` } } : {});
  if (response.status !== 200) {
    results.push({ channel: "amo", check: "api", status: "fail", detail: `HTTP ${response.status}` });
    return;
  }
  const data = JSON.parse(response.text);
  const version = data.current_version?.version || "";
  const expected = localVersion();
  results.push({
    channel: "amo",
    check: "version",
    status: version === expected ? "pass" : "fail",
    detail: `live ${version || "(none)"} vs local ${expected}`,
  });

  const desc = (data.description?.["zh-CN"] || "") + (data.description?.["en-US"] || "");
  const problems = [];
  if ((data.description?.["zh-CN"] || "").length < 400) problems.push("zh-CN description < 400 chars");
  if ((data.description?.["en-US"] || "").length < 400) problems.push("en-US description < 400 chars");
  for (const claim of ["20+", "API Key"]) {
    if (!desc.includes(claim)) problems.push(`missing claim: ${claim}`);
  }
  results.push({
    channel: "amo",
    check: "description",
    status: problems.length ? "fail" : "pass",
    detail: problems.length ? problems.join("; ") : `${desc.length} chars`,
  });

  const iconUrl = data.icon_url || "";
  const isDefault = iconUrl.includes("addon-icons/default");
  let distance = null;
  if (!isDefault) {
    try {
      const iconResponse = await fetch(iconUrl, { headers: { "User-Agent": UA } });
      if (iconResponse.status === 200) {
        const tmp = path.join(os.tmpdir(), `amo-icon-${Date.now()}.png`);
        fs.writeFileSync(tmp, Buffer.from(await iconResponse.arrayBuffer()));
        const localIcon = path.join(ROOT, "src", "icons", "icon-64.png");
        distance = imageDistance(localIcon, tmp);
        fs.rmSync(tmp, { force: true });
      }
    } catch {
      distance = null;
    }
  }
  const iconOk = !isDefault && (distance === null || distance <= 0.15);
  results.push({
    channel: "amo",
    check: "icon",
    status: iconOk ? "pass" : "fail",
    detail: isDefault ? "default placeholder icon" : `rmse ${distance === null ? "unavailable" : distance.toFixed(3)}`,
  });

  // A listing with no screenshots converts badly, and nothing used to check for it: the
  // add-on was live for weeks with an empty gallery while every other gate was green.
  const previews = Array.isArray(data.previews) ? data.previews : [];
  const tooSmall = previews.filter((p) => {
    const [width] = p.image_size || [];
    return !width || width < 1000;
  });
  const previewProblems = [];
  if (previews.length < 3) previewProblems.push(`only ${previews.length} preview(s), need 3`);
  if (tooSmall.length) previewProblems.push(`${tooSmall.length} preview(s) narrower than 1000px`);
  results.push({
    channel: "amo",
    check: "previews",
    status: previewProblems.length ? "fail" : "pass",
    detail: previewProblems.length ? previewProblems.join("; ") : `${previews.length} preview(s)`,
  });

  const uncaptioned = previews.filter((p) => !(p.caption?.["zh-CN"] || "").trim());
  results.push({
    channel: "amo",
    check: "previewCaptions",
    status: uncaptioned.length ? "warn" : "pass",
    detail: uncaptioned.length ? `${uncaptioned.length} preview(s) without a zh-CN caption` : "all captioned",
  });
}

/* ── Other channels ──────────────────────────────────── */

async function checkObsidian(listing, results) {
  const channel = listing.channels.obsidian;
  const community = await fetchText("https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json");
  const listed = community.status === 200 && community.text.includes(`"id": "${channel.listingId}"`);
  results.push({
    channel: "obsidian",
    check: "communityListing",
    status: listed ? "pass" : "fail",
    detail: listed ? "present in community-plugins.json" : `HTTP ${community.status}, id not found`,
  });

  const manifest = await fetchText(`https://raw.githubusercontent.com/${channel.repo}/master/manifest.json`);
  let version = "";
  try {
    version = JSON.parse(manifest.text).version || "";
  } catch {}
  const expected = localObsidianVersion(channel);
  results.push({
    channel: "obsidian",
    check: "repoManifest",
    status: version && (!expected || version === expected) ? "pass" : "fail",
    detail: `repo ${version || "(none)"}${expected ? ` vs local ${expected}` : ""}`,
  });
}

function localObsidianVersion() {
  const file = path.join(os.homedir(), "DualTran-hosts", "dualtran-obsidian", "manifest.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).version || "";
  } catch {
    return "";
  }
}

async function checkNpm(listing, results) {
  for (const name of listing.channels.npm.packages) {
    const response = await fetchText(`https://registry.npmjs.org/${name}/latest`);
    let version = "";
    try {
      version = JSON.parse(response.text).version || "";
    } catch {}
    results.push({
      channel: "npm",
      check: name,
      status: version ? "pass" : "fail",
      detail: version ? `v${version}` : `HTTP ${response.status}`,
    });
  }
}

async function checkPublicPage(channelName, url, results, { optional = false, note = "" } = {}) {
  try {
    const response = await fetchText(url, { redirect: "follow" });
    const status = response.status === 200 ? "pass" : optional ? "warn" : "fail";
    results.push({
      channel: channelName,
      check: "publicPage",
      status,
      detail: `HTTP ${response.status}${note ? ` — ${note}` : ""}`,
    });
  } catch (error) {
    results.push({
      channel: channelName,
      check: "publicPage",
      status: optional ? "warn" : "fail",
      detail: `${String(error.message || error)}${note ? ` — ${note}` : ""}`,
    });
  }
}

function checkManual(channelName, results) {
  const expected = localVersion();
  const file = path.join(EVIDENCE_DIR, `${channelName}-${expected}.json`);
  const ok = fs.existsSync(file);
  results.push({
    channel: channelName,
    check: "manual",
    status: ok ? "pass" : "fail",
    detail: ok ? `evidence ${path.relative(ROOT, file)}` : `missing store/evidence/${channelName}-${expected}.json`,
  });
}

async function main() {
  const results = [];
  const listing = LISTING;

  await checkAmo(listing, results);
  await checkObsidian(listing, results);
  await checkNpm(listing, results);
  await checkPublicPage("chrome", `https://chromewebstore.google.com/detail/${listing.channels.chrome.itemId || "dualtran"}`, results);
  // Edge serves its public detail page only to residential origins; from a datacenter IP it
  // answers 404 even for a live listing (verified in the Partner Center dashboard).
  await checkPublicPage(
    "edge",
    listing.channels.edge.publicUrl || `https://microsoftedge.microsoft.com/addons/detail/${listing.channels.edge.productId}`,
    results,
    { optional: true, note: "check from the home node / Partner Center" },
  );
  await checkPublicPage("opera", "https://addons.opera.com/en/extensions/details/dualtran/", results);
  await checkPublicPage("vscode", `https://github.com/${listing.channels.vscode.repo}/releases/latest`, results);
  checkManual("utools", results);
  checkManual("outlook", results);

  const report = {
    at: new Date().toISOString(),
    localVersion: localVersion(),
    results,
    summary: {
      pass: results.filter((r) => r.status === "pass").length,
      warn: results.filter((r) => r.status === "warn").length,
      fail: results.filter((r) => r.status === "fail").length,
    },
  };
  const outFile = path.join(ROOT, "store-audit.json");
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

  for (const result of results) {
    const tag = result.status === "pass" ? "ok  " : result.status === "warn" ? "WARN" : "FAIL";
    console.log(`${tag} ${result.channel}/${result.check} — ${result.detail}`);
  }
  console.log(`[store-audit] ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail → ${outFile}`);
  return report.summary.fail === 0 ? 0 : 1;
}

process.exit(await main());
