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
  return 0;
}

const dryRun = process.argv.includes("--dry-run");
process.exit(await applyAmo(dryRun));
