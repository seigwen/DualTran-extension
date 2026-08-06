# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

DualTran is a Chrome Manifest V3 extension that translates web pages using Google Translate and AI (LLM) providers. It can display translated text alongside original text, translate selected text, and improve Google translations with AI.

## How to load the extension
 **Webpack build** — `npm run dev` (watch) or `npm run build` (production). Output goes to `dist/chrome/`. Chrome loads `dist/chrome/` as an unpacked extension. 

## Build commands

```bash
npm run dev          # webpack watch mode for dist/chrome/
npm run build        # production build (webpack + babel, no polyfills)
```

## Testing

```bash
npm test                    # run all unit tests (vitest)
npx vitest run tests/options/  # run a specific test directory
npx vitest run tests/ai/sseClient.test.js  # run a single test file
```

Tests use vitest + jsdom. Files in `tests/`. Mock `chrome.*` APIs are set up per-test via `vi.stubGlobal()`.

### MCP E2E testing (Steps 7-9)

Uses `chrome-devtools-mcp-for-extension` MCP to test AI translation, floating buttons, and multi-provider support directly from Claude Code — no Playwright or display required.

```bash
# Prerequisites: build extension + start test servers
npm run build
node tests/mcp-e2e/start-test-servers.js  # outputs { mockUrl, staticUrl }
```

Invoke the `/run-e2e-mcp` skill in Claude Code to execute the full test sequence. The skill uses MCP tools (`navigate`, `evaluate_script`, `click`, `wait_for`) to interact with a real Chrome instance with the extension loaded.

MCP config is in `.mcp.json`. The skill definition is at `.claude/skills/run-e2e-mcp.md`.

## Architecture

### Content scripts (page translation)

`src/contentScript/` — injected into web pages. Key files:

- **`pageTranslator.js`** (~3000 lines) — the core translation engine. Manages Google translation batching, AI translation (sends text blocks wrapped in `<译泽>` XML), inline button groups (`createInlineButtonGroup`), and render state tracking.
- **`fetchSSE.js`** — calls `translateWithAI()` which reads config, resolves provider settings, builds messages, and sends structured requests through `sseClient.js`.
- **`sseClient.js`** — sends structured messages `{provider, apiKey, model, messages, extra}` via `chrome.runtime.connect({name:"ai-sse"})` to the Service Worker. Receives pure text chunks back (no SSE parsing).
- **`floatingBtn.js`** — floating Google/AI translation buttons. Subscribes to `pageTranslator.onAiRenderStateChange` to show loading/success/error states.
- **`translateSelected.js`** — selected-text translation popup.
- **`aiStreamMessage.js`** — parses OpenAI-style SSE JSON chunks; extracts `<译泽>` blocks with translation IDs.
- **`aiUiState.js`** — applies loading/success/error visual states to AI buttons.
- **`contentScript.js`** — entry point that dynamically imports other modules.

### Service Worker (background)

`src/background/` — runs in extension background context.

- **`sw.js`** — main service worker entry. Imports 30+ helper modules (menu, icons, tabs, storage, etc.) and `aiProxy.js`.
- **`aiProxy.js`** — listens on `chrome.runtime.onConnect("ai-sse")`. Receives structured requests, creates AI SDK clients dynamically (`SDK_MAP` lookup via `provider.npm`), calls `streamText()`, and streams text chunks back. Loads models.dev data at startup.
- **`translationService.js`** — Google Translate API calls.

### Options page

`src/options/` — the extension settings page. All AI provider settings now use a single **generic panel** (`#genericAiSettings`). Legacy per-provider HTML panels have been removed.

- **`options.js`** — populates the AI provider dropdown (models.dev cache → fallback to built-in registry). `_loadGenericProviderConfig(providerId)` handles all providers uniformly: loads config from `providerConfigs` (with legacy key fallback), dynamically updates labels, fetches model lists.
- **`aiModelApi.js`** — `loadAiProviderModelOptions()` fetches model lists from provider APIs using registry definitions.
- **`aiModelSelect.js`** — renders model `<select>` states: loading, fallback, model options.
- **`aiProviderUI.js`** — shows/hides settings panels. Now simplified to always show `#genericAiSettings`.
- **`aiProviderSync.js`** — cross-tab input sync via `chrome.storage`.

### AI provider system

`src/lib/ai/` — provider definitions and model discovery.

- **`providerRegistry.js`** — `BUILT_IN_PROVIDERS` array (18 hardcoded providers). Each entry has: `id`, `name`, `apiBase` (full `/chat/completions` endpoint), `modelListUrl`, `auth` type, `responseFormat`, `npm` value. The `createProviderRegistry()` factory creates a lookup API.
- **`providerModelPreview.js`** — `loadPreviewModels()` three-tier fallback:
  1. `chrome.storage.local` cache (per-provider, 24h TTL)
  2. `models.dev/api.json` live fetch
  3. Built-in static `STATIC_MODELS` (fallback for ~18 core providers)
  - `extractModelsFromDevData()` maps internal IDs → models.dev IDs (with fallback to direct ID lookup)
  - `getSmartDefaultModel()` selects the best default model (pricing > name heuristic > static priority)
- **`providerMigration.js`** — one-time migration of legacy flat config keys to `providerConfigs`.
- **`providerTypes.js`** — provider definition validation.

#### SDK routing: why some providers use `openai-compatible` fallback

`aiProxy.js` uses a three-tier routing system to select the AI SDK client:

1. **Dedicated SDK** — if `models.dev` returns an `npm` value that matches an entry in `SDK_MAP`, use that specific SDK (e.g. `@ai-sdk/anthropic` → `createAnthropic`).
2. **`openai-compatible` fallback** — if no match, use `createOpenAICompatible` with the provider's API base URL.
3. **Error** — if no `apiBase` can be resolved, throw.

**OpenRouter is an intentional fallback case**, not a missing mapping:

- Vercel AI SDK does not provide an `@ai-sdk/openrouter` package.
- Mapping OpenRouter to `@ai-sdk/openai` would pull in OpenAI-specific features (Responses API, Realtime API, Files API) that OpenRouter doesn't support, and whose error handling may differ.
- `@ai-sdk/openai-compatible` is the correct abstraction — it only relies on the standard `/v1/chat/completions` contract. OpenRouter's API is designed as a drop-in replacement for this contract, so requests are functionally identical.
- The same logic applies to any provider in models.dev whose API is OpenAI-format but lacks a dedicated SDK (100+ smaller providers).

Only providers with non-standard APIs (Anthropic Messages, Gemini generateContent, Cohere chat) or important proprietary features warrant a dedicated `SDK_MAP` entry.

### Data flow: AI translation request

```
Content Script (fetchSSE.js)
  → sseClient.js (chrome.runtime.connect "ai-sse")
    → Service Worker (aiProxy.js)
      → createModelClient({provider, apiKey, model, extra})
        → getProvidersData() (models.dev cache or fetch)
        → npm in SDK_MAP? ──yes──→ createXxx({apiKey, baseURL})
              │ no
              └──→ createOpenAICompatible({name, apiKey, baseURL})
      → streamText({model, messages})
      → for await (chunk of textStream)
        → port.postMessage({type:"data", chunk})
    ← sseClient.js receives {type:"data", chunk}
  ← fetchSSE.js wraps text as JSON SSE payload
← pageTranslator.js parses <译泽> blocks, applies translations
```

### Config storage

`src/lib/config.js` — `twpConfig` wraps `chrome.storage.local`. Key patterns:
- `twpConfig.get(key)` / `twpConfig.set(key, value)` — synchronous read, async write
- `twpConfig.onReady(callback)` — wait for config load
- `providerConfigs` — object keyed by provider ID, stores `{apiKey, model, apiBase, customModels}` for all providers (legacy + dynamic)
- Legacy legacy keys (`apiKeyOpenAI`, `openAiModel`, etc.) are still read as fallback until migration completes

### Important design constraints

- **No bare specifier imports in content scripts/popup/options** — only relative paths with `.js` extensions. 
- **`babel.config.json`** has `modules: false` (preserve ESM for webpack) and no `useBuiltIns` (no polyfill injection — targets Chrome 67+).
- **`webpack.common.js`** has `publicPath: '/'` (chunks resolve from extension root). Dynamic imports in content scripts use `/* webpackMode: "eager" */` to prevent chunk splitting.
- **Service Workers terminate after ~30s idle** — all persistent state must use `chrome.storage.local`. Memory caches are for session-only speed.
- **Models.dev data 24h TTL** — cached in `chrome.storage.local` under `"modelsdev:providers"`. The options page listens for `storage.onChanged` to auto-refresh the dropdown.

### i18n
Alway use i18n when editing code. 
Messages are store in \src\_locales.

### Dynamic Import
Dynamic import() is prohibited on ServiceWorkerGlobalScope by the HTML specification. Do not use dynamic import in service worker.

### Extension Usage
 扩展的翻译流程是这样的：
 1. 当我点击页面悬浮按钮组的“Google”时，使用谷歌翻译原文，然后根据“译文显示位置”配置项，用谷歌译文替换原文，或者在原文下方显示谷歌译文；
 2. 当我点击页面悬浮按钮组的“AI”按钮时，分两种情况：1）如果已经使用谷歌翻译了原文，那么就继续使用AI翻译原文，然后用AI译文替换掉谷歌译文；2） 如果还没使用谷歌翻译原文，则先调用谷歌翻译原文，然后用谷歌译文替换原文，或者在原文下方显示谷歌译文，再然后使用AI翻译原文（注意：AI是翻译原文，不是翻译谷歌译文），再用AI译文替换掉谷歌译文。