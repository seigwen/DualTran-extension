/**
 * Apply store listing text (plan 85, P2) for channels that expose a write API.
 *
 * Only AMO does today: PATCH summary + description from store/listing.json. Everything else
 * is read-back only (see audit.mjs). Running twice must be a no-op.
 *
 * Usage: node scripts/store/apply.mjs [--dry-run]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LISTING = JSON.parse(fs.readFileSync(path.join(ROOT, "store", "listing.json"), "utf8"));

function amoToken() {
  const credPath = path.join(os.homedir(), ".amo-credentials");
  if (!fs.existsSync(credPath)) throw new Error(`missing ${credPath}`);
  const values = {};
  for (const line of fs.readFileSync(credPath, "utf8").split("\n")) {
    if (!line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim();
  }
  const b64 = (data) => Buffer.from(data).toString("base64url").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ iss: values.WEB_EXT_API_KEY, jti: crypto.randomUUID().replace(/-/g, ""), iat: now, exp: now + 300 }));
  const signature = crypto.createHmac("sha256", values.WEB_EXT_API_SECRET).update(`${header}.${payload}`).digest("base64url").replace(/=+$/, "");
  return `${header}.${payload}.${signature}`;
}

async function applyAmo(dryRun) {
  const slug = LISTING.channels.amo.slug;
  const url = `https://addons.mozilla.org/api/v5/addons/addon/${slug}/`;
  const token = amoToken();

  const current = await (await fetch(url, { headers: { Authorization: `JWT ${token}` } })).json();
  const body = {
    summary: Object.fromEntries(Object.entries(LISTING.locales).map(([locale, text]) => [locale, text.summary])),
    description: Object.fromEntries(Object.entries(LISTING.locales).map(([locale, text]) => [locale, text.description])),
  };

  const changes = [];
  for (const [locale, text] of Object.entries(body.summary)) {
    const live = current.summary?.[locale] || "";
    if (live !== text) changes.push(`summary[${locale}]`);
  }
  for (const [locale, text] of Object.entries(body.description)) {
    const live = current.description?.[locale] || "";
    if (live !== text) changes.push(`description[${locale}] (${live.length} → ${text.length} chars)`);
  }

  if (changes.length === 0) {
    console.log("[store:apply] amo — no changes");
    await applyAmoPreviews(token, dryRun);
    return 0;
  }
  console.log(`[store:apply] amo — ${dryRun ? "would update" : "updating"}: ${changes.join(", ")}`);
  if (dryRun) return 0;

  const response = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `JWT ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error(`[store:apply] amo — HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return 1;
  }
  console.log("[store:apply] amo — updated");
  await applyAmoPreviews(token, dryRun);
  return 0;
}

/**
 * Upload the listing gallery when the live add-on has fewer previews than the repo.
 * Idempotent: three or more previews means nothing to do. AMO throttles writes hard
 * (roughly one add-on PATCH per hour, previews a few per minute), so a 429 is reported
 * rather than retried in a loop.
 */
async function applyAmoPreviews(token, dryRun) {
  const slug = LISTING.channels.amo.slug;
  const base = `https://addons.mozilla.org/api/v5/addons/addon/${slug}/`;
  const gallery = (LISTING.channels.amo.previews || []).map((name) => path.join(ROOT, "docs", "assets", "store", name));
  if (!gallery.length) return;

  const live = await (await fetch(base, { headers: { Authorization: `JWT ${token}` } })).json();
  const count = (live.previews || []).length;
  if (count >= gallery.length) {
    console.log(`[store:apply] amo previews — ${count} live, nothing to do`);
    return;
  }
  console.log(`[store:apply] amo previews — ${dryRun ? "would upload" : "uploading"} ${gallery.length - count}`);
  if (dryRun) return;

  for (let index = count; index < gallery.length; index += 1) {
    const file = gallery[index];
    const form = new FormData();
    form.append("image", new Blob([fs.readFileSync(file)], { type: "image/png" }), path.basename(file));
    form.append("position", String(index + 1));
    const caption = LISTING.channels.amo.previewCaptions?.[path.basename(file)];
    for (const [locale, text] of Object.entries(caption || {})) {
      form.append(`caption[${locale}]`, text);
    }
    const response = await fetch(`${base}previews/`, {
      method: "POST",
      headers: { Authorization: `JWT ${amoToken()}` },
      body: form,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      console.error(`[store:apply] amo previews — ${path.basename(file)} HTTP ${response.status}: ${detail}`);
      return;
    }
    console.log(`[store:apply] amo previews — uploaded ${path.basename(file)}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

const dryRun = process.argv.includes("--dry-run");
process.exit(await applyAmo(dryRun));
