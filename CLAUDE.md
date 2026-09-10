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

### Translation Invariants

**RULE: Every content block must have at most 1 `<translated>` element.** This is a hard invariant — any violation indicates a feedback loop (translation output being re-translated). All translation tests (jsdom + E2E) must assert this after any translation operation.

**RULE: 译文颜色规则（translation color rule）—— 颜色只由"译文显示位置"决定：**
- 当 `whereToDisplayTranslatedText` 配置项的值为 **`replaceOriginal`（"用译文替换原文"）** 时，译文颜色为**原文颜色**——Google 译文和 AI 译文都不得应用 options 页的"谷歌译文颜色"（`translatedColor`）或"AI 译文颜色"（`aiTranslatedColor`）。
- 当 `whereToDisplayTranslatedText` 配置项的值为 **`newLine`（"在新行显示译文"）** 时，译文颜色遵循 options 页配置项"谷歌译文颜色"（`translatedColor`）和"AI 译文颜色"（`aiTranslatedColor`）。
- 实现位置：`applyTranslatedColorToNode()`（pageTranslator.js）在 replaceOriginal 模式下必须跳过；`_applyAiColorToTranslatedElement()` 已有 replaceOriginal 跳过逻辑（通过 `nodesToClear` 非空判断），不得移除。
- 测试：任何颜色相关测试必须同时覆盖两种模式（模式对称性规则）。
- **实现点清单（规则对称性）**：`applyTranslatedColorToNode`（Google 侧，PR #20 已加守卫）、`_applyAiColorToTranslatedElement`（AI 侧，已有守卫）、`applyAiTranslatedTextColor`（aiUiState.js，`data-dualtran-block` 检测）。修改任一实现点必须同步检查其他实现点 + 对应测试。

**RULE: SPA 导航重建状态规则（UI rebuild state rule）—— 悬浮按钮重建时必须从 pageTranslator 实时状态初始化，不得硬编码初始态：**
- 场景：GitHub (Turbo Drive) 等 SPA 站点，页面已翻译后导航再回退，floatingBtn host 随 body 被替换 → `floatingBtn.show()` 重建新闭包。
- pageTranslator 的状态（`pageLanguageState`/`pageRenderState`/`aiRenderState`/`aiModeActive`）在 SPA 导航中**保留且不广播事件**（状态无变化不触发 observer），所以重建的按钮组必须通过 getter（`getPageLanguageState`/`getPageRenderState`/`getAiRenderState`/`getAiModeActive`）查询实时状态。
- 初始化规则：`pageLanguageState === "translated"` 时 `highlight` 与 `displayMode` 应为 `aiModeActive && aiRenderState !== "idle" ? "ai" : "google"`（aiModeActive 默认 true，必须叠加 aiRenderState 判定）；`lastPageLanguageState` guard 必须同步初始化为 live 状态，否则下一次 "original" 事件会错误穿透 guard。
- 实现点清单（规则对称性）：`getState`（pageTranslator 单查询接口，B2）、`resolveInitialUiState`（floatingBtnClickResolver 纯函数，A3）。getCurrentUiState 消息处理为 E2E 断言辅助（被 tests/browser-e2e/setup.mjs 的 assertUiStateMatchesEngine 引用）。floatingBtn.js show() 内的 engineState / initialUi / lastPageLanguageState 为闭包局部实现细节，由 floatingBtn.behavior.test.js 生命周期矩阵测试（A1）+ E2E navigation-recovery.mjs Scene 5 的行为断言覆盖。修改任一实现点必须同步检查其他实现点 + 对应测试。
- 测试：jsdom `floatingBtn.behavior.test.js`（SPA back-nav rebuild 高亮保持 Google/AI）+ E2E `navigation-recovery.mjs` Scene 5（真实浏览器 Google 高亮回归）。

**RULE: MutationObserver 挂载点（observer mount rule）—— 必须挂 `document.documentElement`，禁止挂 `document.body`：**
- 真实 Turbo Drive（GitHub）回退导航时用新 `<body>` 元素 `replaceWith` 旧 `<body>` 元素本身（2026-09-10 实测：`document.body !== oldBody`），挂在 body 上的 observer 随旧 body 一起死亡 → host 消失/动态翻译停止后永不恢复（第 7 次同类事故）。
- `<html>` 元素在 Turbo 导航中存活（实测 `htmlReplaced: false`），挂 `documentElement` + `subtree: true` 能捕获 body 替换。
- **连带规则：** 挂 documentElement 后 head 变化也可见 → 回调必须过滤 `document.head.contains(addedNode)`（否则 `<title>` 文本被拾取 → `<translated>` 被追加进 `<title>`，soak feedback loop）。
- 实现点清单（规则对称性）：`floatingBtn.js` `setupFloatingBtnObserver`（PR #30）、`pageTranslator.js` `enableMutatinObserver`（PR #30）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- 测试：floatingBtn.behavior.test.js「turbo back-nav」2 个（body 元素替换后 host 重建）+ E2E navigation-recovery 5 场景（模拟页已忠实化：`replaceWith` 替换 body 元素）。

**PR Checklist for translation core changes** (MutationObserver callback, `updatePiecesToTranslateWithNewNodes`, `getPiecesToTranslate`, `addTranslatedContent`, `translateDynamically`):
- [ ] New/modified tests cover "translation output is not re-translated" scenario
- [ ] `assertNoDuplicateTranslations` E2E assertion still passes
- [ ] If modifying the MutationObserver callback, verify `isDescendantOfTranslated` filter is preserved

**PR Checklist for UI state changes** (floatingBtn, singletonBtnGroup, any component with highlight/displayMode state):
- [ ] 涉及 UI 状态？是否测试了跨重建/跨导航的状态保持？（生命周期矩阵测试，tests/CLAUDE.md）
- [ ] 涉及引擎状态？UI 是否有查询路径（`pageTranslator.getState()`）+ 事件缺失测试？（A3）
- [ ] 涉及 SPA 导航？E2E 是否断言了导航后状态一致性？（`assertUiStateMatchesEngine`）
- [ ] 初始化是否从引擎状态派生（`resolveInitialUiState`），而非硬编码？（`check-ui-state-init.js` CI 强制）

**UI 状态架构原则（计划文档 08-ui-state-ssot-plan.md）：**
- **SSOT**：UI 状态（highlight/displayMode/intervention/inFlight）唯一事实源是 `uiStateStore`，禁止闭包持有状态副本。floatingBtn 等组件是纯渲染器，从 `getState()` 读取。
- **Watchdog**：引擎驱动状态必须可自愈（不一致时 setState 纠正）；用户选择状态（intervention=true）必须保留，watchdog 不得干预。
- **Watchdog 实时派生规则（PR #29 修正）**：无干预时，`highlight`/`displayMode` 必须反映**页面实际显示**——`pageLanguageState === "translated" && aiRenderState === "success" && aiModeActive` → AI；否则 translated → Google；original → Original。**不得**只看 pageLanguageState 派生（刷新/SPA 恢复后页面显示 AI 但按钮 Google 高亮 = 第 6 次同类事故）。AI 在飞（loading）或失败（error）时页面显示 Google，按钮保持 Google。
- **状态机**：状态转换必须通过显式合法表，非法转换（如 pageLanguageState=original 时 highlight=ai）在开发/测试期报错。
- **变更日志**：所有 setState 记录（时间戳/来源/调用栈/前后快照），`dumpLog()` 可导出，诊断状态 bug 的第一工具。

**Known blind spot:** replaceOriginal mode AI text nodes (inside `.dualtran-aitranslatedtext-replacemode` spans) are NOT inside `<translated>` elements, so `isDescendantOfTranslated` does not catch them. The `addTranslatedContent` last defense also doesn't apply since replaceOriginal mode uses `translateResults`. This is a known limitation — verify via E2E if affected.

### i18n
Alway use i18n when editing code. 
Messages are store in \src\_locales.

### Dynamic Import
Dynamic import() is prohibited on ServiceWorkerGlobalScope by the HTML specification. Do not use dynamic import in service worker.

### Extension Usage
The extension's translation flow works as follows:
1. When the user clicks the “Google” button in the floating button group, Google Translate translates the original text. Then, depending on the “translation display position” setting, the Google translation either replaces the original text or is displayed below it.
2. When the user clicks the “AI” button in the floating button group, there are two cases: (a) If Google Translate has already been applied, AI translates the original text and replaces the Google translation with the AI translation. (b) If Google Translate has not been applied yet, Google Translate runs first (either replacing the original or displaying below it), then AI translates the original text (note: AI translates the original, NOT the Google translation), and finally the AI translation replaces the Google translation.