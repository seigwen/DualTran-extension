#!/usr/bin/env node
/**
 * tx-cli.mjs — Node harness over dist-core (plan 59 M4-2).
 *
 * Proves the engine runs outside Chrome; NOT a product entry point (D8).
 * Requires `npm run build:core` first.
 *
 * Usage:
 *   node scripts/tx-cli.mjs google --to zh --from en --text "Hello world"
 *   node scripts/tx-cli.mjs ai --provider openai --model gpt-4o-mini \
 *     --base http://127.0.0.1:8788/openai/v1 --key test --to zh --text "Hello"
 *
 * Common flags: --text <s> | --file <path>, --to <code>, --from <code>,
 *               --cache <file> (JSON file cache; default in-memory),
 *               --offline (skip the live models.dev lookup for the AI leg)
 *
 * The module is importable: tests call runGoogle/runAi with injected fetch.
 */
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

const CORE_URL = new URL("../dist-core/index.mjs", import.meta.url);
let corePromise = null;

export async function loadCore() {
  if (!corePromise) {
    corePromise = import(CORE_URL.href).catch((err) => {
      corePromise = null;
      throw new Error(
        `dist-core not found or failed to load (${err?.message || err}). Run \`npm run build:core\` first.`
      );
    });
  }
  return corePromise;
}

/** Minimal flag parser: --flag value | --flag (boolean) | positional subcommand. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[name] = true;
      } else {
        args[name] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function textInput(args) {
  if (typeof args.text === "string") return args.text;
  if (typeof args.file === "string") return await readFile(args.file, "utf8");
  throw new Error("Missing input: pass --text <s> or --file <path>");
}

/** Split into non-empty lines — each line becomes one batched piece. */
function toPieces(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Google leg.
 * @param {Object} params
 * @param {string} [params.from="auto"]
 * @param {string} params.to
 * @param {Function} [params.fetchImpl] — injected fetch (tests use a fixture)
 * @param {string} [params.cachePath] — JSON file cache (default: memory)
 * @returns {Promise<string[]>} translated pieces (aligned with input lines)
 */
export async function runGoogle({ text, from = "auto", to, fetchImpl = null, cachePath = "" }) {
  const core = await loadCore();
  const cache = cachePath ? core.createFileCache(cachePath) : core.createMemoryCache();
  return await core.translateGoogle({
    sourceArray: toPieces(text),
    sourceLanguage: from,
    targetLanguage: to,
    cache,
    fetchImpl,
  });
}

/**
 * AI leg — streams through the shared chat engine.
 * @param {Object} params
 * @param {string} params.provider
 * @param {string} params.model
 * @param {string} params.key
 * @param {string} [params.base] — baseURL override (aimock / custom endpoints)
 * @param {string} params.to
 * @param {boolean} [params.offline] — skip the live models.dev data lookup
 * @param {Function} [params.onChunk] — stream callback
 * @returns {Promise<string>} full streamed text
 */
export async function runAi({
  text,
  to,
  provider,
  model,
  key,
  base = "",
  offline = false,
  fetchImpl = null,
  onChunk = null,
}) {
  const core = await loadCore();
  const fetchImplResolved = fetchImpl ?? globalThis.fetch;

  const store = offline
    ? null
    : core.createModelsDevStore({ storage: core.createMemoryStorage(), fetch: fetchImplResolved });

  const targetLanguageName = core.codeToLanguageNameInEnglish(to) || to;
  const built = core.buildTranslationMessages({
    content: text,
    targetLanguageName,
    hostname: "localhost",
    isSingleWord: false,
    targetLangConfig: core.otherConfigs[to],
    sourceLanguageTrusted: false,
    sourceLanguageName: "",
    isSameLanguage: false,
  });

  let out = "";
  const { streamError, totalChunks } = await core.streamChat({
    provider,
    apiKey: key,
    model,
    messages: [
      { role: "system", content: built.system },
      { role: "assistant", content: built.assistant },
      { role: "user", content: text },
    ],
    extra: base ? { baseURL: base } : {},
    store,
    onChunk: (chunk) => {
      out += chunk;
      onChunk?.(chunk);
    },
  });

  if (streamError) {
    throw new Error(core.formatAiError(streamError).message);
  }
  if (totalChunks === 0) {
    throw new Error("No response from AI provider");
  }
  return out;
}

const USAGE = `DualTran core CLI (plan 59) — requires \`npm run build:core\` first.

  node scripts/tx-cli.mjs google --to zh [--from en] --text "Hello world" | --file <path>
      [--cache <file.json>]

  node scripts/tx-cli.mjs ai --provider <id> --model <id> --key <k> [--base <url>] --to zh
      --text "Hello" | --file <path> [--offline]
`;

async function main(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);

  if (subcommand === "google") {
    if (!args.to) throw new Error("--to is required");
    const results = await runGoogle({
      text: await textInput(args),
      from: typeof args.from === "string" ? args.from : "auto",
      to: args.to,
      cachePath: typeof args.cache === "string" ? args.cache : "",
    });
    process.stdout.write(results.join("\n") + "\n");
    return;
  }

  if (subcommand === "ai") {
    for (const required of ["provider", "model", "key", "to"]) {
      if (!args[required]) throw new Error(`--${required} is required`);
    }
    const text = await textInput(args);
    const result = await runAi({
      text,
      to: args.to,
      provider: args.provider,
      model: args.model,
      key: args.key,
      base: typeof args.base === "string" ? args.base : "",
      offline: args.offline === true,
      onChunk: (chunk) => process.stdout.write(chunk),
    });
    process.stdout.write("\n");
    if (!result) throw new Error("No response from AI provider");
    return;
  }

  process.stdout.write(USAGE);
  if (subcommand !== undefined) throw new Error(`Unknown subcommand: ${subcommand}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`❌ ${err?.message || err}`);
    process.exit(1);
  });
}
