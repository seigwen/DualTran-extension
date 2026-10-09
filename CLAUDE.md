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

### Real-site canary (S5, issue #57; multi-site expansion: plan 34, issue #114)

```bash
npm run build                                        # first — the tool loads dist/chrome/
node scripts/real-site-verify.mjs --list             # list scenarios (CI set + local set)
node scripts/real-site-verify.mjs                    # run the 18-scenario CI matrix (10 sites)
node scripts/real-site-verify.mjs --include-local    # + local-only scenarios (x.com)
node scripts/real-site-verify.mjs --scenario=<name>  # one scenario (CI or local name)
node scripts/real-site-verify.mjs --url=<user URL>   # ad-hoc single-URL journey (PR checklist)
xvfb-run -a node scripts/real-site-verify.mjs --self-test                 # hermetic (local mock pages)
```

- **Scenario library:** `scripts/canary-scenarios.mjs` — declarative data (`source` field traces each scenario to its user report / incident). Adding a scenario = adding one entry; the executor (`scripts/real-site-verify.mjs`) owns the step loop + tri-state assertions (healthy ∧ count===1 per settled step).
- **CI matrix (10 sites / 18 scenarios):** github.com ×3 (bug8 / bug7 / selfheal), workers.dev ×2 and vercel.com ×2 (translate-reality + #78 seeded-position), nextjs / nuxt / svelte / angular / astro / gitlab ×1 each (front-end-stack representatives), plus **client-route roundtrips ×5** (plan 36: nextjs `/docs`, nuxt `/modules`, svelte `/docs`, angular `/tutorials`, vercel `/about` — translate home → client-route → translate → 6× back/forward; astro / gitlab / workers.dev excluded with evidence: full-page navigations / no in-page links). **x.com is local-only** (`LOCAL_SCENARIOS`, `--include-local`) — Cloudflare blocks the Actions runner IP range (plan 34 §二.3; not a Playwright fingerprint issue).
- **Translation-reality gate (plan 34):** every translate/assert-translated step seeds `targetLanguage=zh-CN` and must pass `tests/shared/translation-quality.mjs` — `nonEmpty ≥ max(10, 20%×count)` ∧ `cjk/nonEmpty ≥ 30%` (scenario-level `quality` overrides). Closes two measured false-green holes: a 429 window (nodes created, text empty) and en→en identity (unseeded profile).
- **Typed-skip discipline (exit codes):** `0` = PASSED, `1` = FAILED, `2` = SKIPPED-ENV (Google gtx throttled — preflight or failure re-probe; SKIP never opens/closes issues, is never retried; the release gate lets it through with a `::warning::`). `SKIP-DATA` (self-test unmapped scenarios; plan 36 premise-invalid runs) never fails the run — exit stays 0.
- **Premise guards (plan 36):** roundtrip scenarios assert the client-route premise via `tests/shared/document-identity.mjs` (`performance.timeOrigin` + per-document token, compared around navigations) — a full page load or route drift reports SKIP-DATA (audit the scenario), never a silent shallow PASS. Roundtrip quality reads use `quality.visibleOnly` (stale hidden route DOM must not inflate the counters).
- **Assertions use the shared tri-state primitives** in `tests/shared/host-state.mjs` (same classifier as the E2E suite).
- **x.com deep check (on demand):** `scripts/xcom-showmore-check.mjs` — issue #98 "Show more" reveal-translation check; typed outcomes incl. SKIP-DATA (no truncated post on this load; hit rate ≈ 2/5, hence not in the library).
- **Cadence:** `.github/workflows/canary.yml` — every Monday 3:00 UTC + manual dispatch; fails open/comment on an issue (`canary:` title prefix, dedup; auto-closed ONLY on effective=0 — a SKIP must never close a real defect). **Not a PR gate** — real-site runs need human judgment.
- **Release gate:** `.github/workflows/release.yml` runs the canary before producing the ZIP — a real failure blocks the release; SKIP-ENV (throttled endpoint) releases with a prominent warning (Google risk controls must not hold the release cadence; the full E2E suite has already gated the build).
- **Platform fact:** GitHub pauses `schedule` triggers after 60 days of repo inactivity — if the canary looks "silent", check workflow activity before assuming health.
- **CLI form:** always use `=` (`--url=<URL>`, `--scenario=<name>`) — space forms are silently ignored (same trap as PR #30's `--scenario name`).

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
- **实现点清单（规则对称性）**：`applyTranslatedColorToNode`（Google 侧，PR #20 已加守卫）、`_applyAiColorToTranslatedElement`（AI 侧，已有守卫）、`applyAiTranslatedTextColor`（aiUiState.js，`data-dualtran-block` 检测）、`applyPanelTranslatedColor`（划词面板译文色单点，plan 31——面板不使用双模式语义、无条件按配置应用；先重置再上色；空值不染色）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **默认值与按钮色板一致性（#94）**：出厂默认 `translatedColor` = `#1d4ed8`（Google 蓝）、`aiTranslatedColor` = `#7c3aed`（AI 紫），与悬浮按钮色板逐字一致——改按钮色板必须同步改默认值，反之亦然；已手动选色的用户不做迁移（storage 值覆盖默认；「重置」保持写空值语义 = 不染色）。负向颜色检查禁止硬编码具体色值（默认色一变即静默失明）：用场景内哨兵色断言「译文色 ≠ 哨兵」（先例：`translation-replace-original.mjs` 的 #94 哨兵化）。
- **实现点清单（规则对称性）**：`translatedColor`（config.js 默认值，tests/lib/config.test.js 锁定字面值 + 无迁移单元格）、`aiTranslatedColor`（同上）、`BTN_COLORS`（singletonBtnGroup.js 色板，singletonBtnGroup.test.js 锁定）+ E2E `translation.mjs`「译文渲染色 ≡ 浮动按钮色」双向断言。改任一处必须同步检查其余实现点 + 对应测试。

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
- 实现点清单（规则对称性）：`hostLifecycle.js` `installEagerSubscriptions`（C1/M5：eager 订阅统一装配点，observer 挂 `getObserverRoot()`）、`pageTranslator.js` `enableMutatinObserver`（PR #30）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- 测试：floatingBtn.behavior.test.js「turbo back-nav」2 个（body 元素替换后 host 重建）+ E2E navigation-recovery 6 场景（模拟页已忠实化：`replaceWith` 替换 body 元素 + 快照缓存渲染）。

**RULE: 重建检查必须验证 host "功能完好"（有 shadowRoot），禁止只查存在性；且必须验证「恰好一个」host 副本（duplicate 收敛）：**
- Turbo 快照是 `cloneNode(true)` 缓存（**shadow root 不被克隆**）；restore 恢复（back/forward 到可缓存页）渲染快照且不发请求 → 快照中的 `#dualtran-floating-btn-host` 是无 shadowRoot 的空壳，`!host || !document.body.contains(host)` 检查全部通过 → 按钮永不重建（第 8 次事故，2026-09-14）。
- 所有重建路径（popstate/observer/pageshow）必须用 `hasFunctionalHost()`（**C1/M5 起为 `hostLifecycle.js` 的谓词唯一实现**，PR #39；`count === 1 && document.body.contains(host) && host.shadowRoot`）（issue #43 收紧：旧「存在一个功能 host」谓词在 healthy-first duplicate flavor 下（副本在健康 host 之后）会通过检查 → 隐形空壳副本永久存活；总量判定使任何 duplicate 都触发重建，重建路径自带清全部副本 → 收敛为单实例）。组件侧不再各自实现谓词：两个旧副本（floatingBtn.js / singletonBtnGroup.js）已删除，改由生命周期管理器（`registerHost` 注册句柄的 `enable`/`disable`/`ensure`/`rebuild` 动词）统一承载；singleton 的两个入口保留为薄包装：`createSingletonButtonGroup`（→ `enable`，重建前清除残留同名 host 避免 shell + 新 host 双元素）与 `showButtonGroup`（悬停/触摸入口——降级状态下悬停是 singleton 唯一的恢复入口，必须当场自愈重建）。
- 实现点清单（规则对称性）：`hostLifecycle.js` `hasFunctionalHost`（唯一谓词实现）、`hostLifecycle.js` `registerHost`（句柄 + 4 动词：`enable`/`disable`/`ensure`/`rebuild`；`recovery: "eager"` 的宿主自动获得 popstate/observer/pageshow 订阅，`"lazy"` 宿主由交互入口调用 `ensure`/`enable`）、`createSingletonButtonGroup`（薄包装 → `enable`）、`showButtonGroup`（悬停/触摸入口自愈）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- 测试：floatingBtn.behavior.test.js「turbo snapshot shell」4 个 + 「duplicate hosts」2 个（healthy-first / shell-first 收敛）+「absent host」3 个（popstate/observer/pageshow 无 host 重建）+ singletonBtnGroup.test.js「快照残留的 shadow-less shell host 在重建时被清除」+「singleton hover recovery — 失败态注入矩阵」4 个（absent 创建/detached/shell/healthy 悬停自愈）+「duplicate hosts」2 个（悬停收敛）+ real-site-verify.mjs step 9（真实页面空壳注入 + 悬停自愈）/ step 9b（duplicate 收敛）+ E2E navigation-recovery Scene 3（重译恢复路径）/ Scene 6。**完整五态矩阵（10 格）见 tests/CLAUDE.md「组件状态空间 → 可达性 → 测试引用矩阵」（S1 审计，issue #45；check-state-reachability.js CI 强制）。**

**RULE: 块级悬停按钮组三按钮语义规则（block-level hover three-button rule, #65）—— 悬停组 O/G/A 与浮动组同义（direct-select），决策逻辑单点、执行器单入口、晚写必须抑制：**
- **语义（direct-select）：** 点击 = 「显示该模式」作用于**当前块**（O=本块原文 / G=本块 Google / A=本块 AI）。点击当前已显示模式 = noop；请求在飞 = noop（**不得重发已完成/在飞请求**）；还原职责**只在 O 键**（G/A 无二次点击还原）；G 在原文态且有已存译文 = 本地再现（零网络）；A 错误态点击 = 重试。
- **决策单点：** `singletonBtnClickResolver.js` `resolveSingletonBtnClick(blockState, buttonId, ctx)` 纯函数返回 action 描述符（`noop`/`restoreBlock`/`showGoogle`/`fetchGoogle`/`showAi`/`fetchAi`/`retryAi`/`promptConfig`）；**禁止**在点击链路重加 if/else 决策分支（决策表全量单测 `singletonBtnClickResolver.test.js`）。
- **执行单入口:** `pageTranslator.js` `handleSingletonBtnClick(buttonId, target)`，经单一 `onBtnClick` 回调接线（**禁止**恢复 per-button 回调名）；复用既有块级机制（`restoreBlockOriginal`/`showBlockGoogleOnly`/`writeGoogleIntoBlock`/`applyGoogle*`/`aiTranslateText`）零改动。
- **晚写抑制（requestEpoch）：** 块状态含单调 `requestEpoch`；发起 fetch 时捕获、写回前校验；`restoreBlock`（O）自增使一切在飞响应作废。**G/A 两通道共用一字段**——新增网络写回路径必须校验 epoch，禁止只查 `displayMode`（旧检查无法区分「尚未写」与「用户已点 O」）。
- **未注册块守卫：** `showButtonGroup` 以 **WeakMap 身份**判定（`blockStateMap.get(translatedElement)`），非属性判定（快照克隆块带 `data-dualtran-block` 属性但 WeakMap 状态不复制）——未注册块悬停整组不显示 + 立即隐藏（清 `currentTarget` + `_pendingHideTimer`）。
- **视觉：** 色板与浮动组逐字对齐（O `#d1d5db/#f3f4f6/#6b7280`→激活 `#374151`；G `#bfdbfe/#eff6ff/#1d4ed8`→激活 `#1d4ed8`；A `#ddd6fe/#f5f3ff/#7c3aed`→激活 `#7c3aed`），JS inline style + spec 对象（BTN_COLORS），激活态源 = 块 `displayMode`；标签全称 Original/Google/AI。**AI 成功态不渲染任何 ✓ 装饰（#83）**——成功由 `dualtran-ai-success` class + 激活高亮承载，标签恒为纯 `AI`；错误态 ✕ 保留（`dualtran-ai-error-cross`）。悬停组与划词面板两处 AI 按钮同规则（共享 `renderAiSuccessIndicator`）。
- **实现点清单（规则对称性）：** `singletonBtnClickResolver.js` `resolveSingletonBtnClick`（决策唯一实现）、`pageTranslator.js` `handleSingletonBtnClick`（执行唯一入口）、`singletonBtnGroup.js` `showButtonGroup`（守卫）、`BTN_COLORS`/`applyButtonPalette`（视觉）、`singletonBtnGroup.js` `createBlockState`（`requestEpoch` 字段）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** jsdom `singletonBtnClickResolver.test.js`（决策表 21 格）+ `hoverBtnBehavior.integration.test.js`（Behavior 1–4 + 晚写抑制 2 格）+ `singletonBtnGroup.test.js`（守卫 5 格 + 三按钮结构/色板 4 格）+ E2E `navigation-recovery.mjs` Scene 3（computed 色值 + 标签）。**样式变更必须 jsdom（锁 inline 色）+ E2E（锁 computed）双层**（tests/CLAUDE.md 样式分层纪律）。

**RULE: AI 到达闸门规则（AI arrival gate rule, #70）—— 抑制是边沿不是水平；显示声明只属于实际显示切换：**
- **抑制语义（edge）：** 仅「用户在请求**在飞期间**切走」抑制到达（Q22 newLine 保留不显示 / Q23 replaceOriginal 整体丢弃）。**禁止**用到达时刻的页级水平旗标裁决——陈旧水平不得否决在其之后发起的块级 direct 请求（否则悬停 A 点了也不切）。
- **边沿实现：** `aiModeEpoch`（`pageTranslator.js`）仅 true→false 时自增；请求起点捕获 arrivalEpoch；抑制条件 = 「epoch 在请求期间移动」——与 #65 块级 `requestEpoch` 同构的**页级版本**。
- **面板豁免：** 无 `_st` 的代理（划词/悬停翻译面板）不被页面级显示切换抑制。
- **显示声明所有权：** `displayMode = "ai"` 只能由实际显示切换写入；仅写文本+状态的 `applyAiResult` **禁止**写 displayMode——「到达但未显示」（Q22 保留态）必须停留 `google`，否则用户看 Google 而状态说 ai → 下次 A 点击被判 noop。
- **实现点清单（规则对称性）：** `setAiModeActive`（epoch 自增唯一入口）、`_isAiArrivalAllowed`（判定唯一实现）、`applyAiSuccessWithModeCheck`（到达应用唯一入口）、`switchToAiDisplay`（显示声明唯一入口）、`applyAiResult`（不得写 displayMode）。
- **测试：** `hoverBtnBehavior.integration.test.js`「Arrival gate」套件（陈旧旗标×双模式×{内存/持久缓存} + 面板豁免 + 在飞切走 Q22/Q23 + guard 三格）+ `hoverBtnStreamArrival.integration.test.js`（真实流式解析到达）+ `aiUiState.split.test.js`（displayMode 所有权三格）。

**RULE: 块级翻译指示器生命周期规则（block indicator lifetime rule, #90）—— 指示器生命周期 = 请求生命周期；清理绑「到达」，不绑「派发」：**
- **症状与根因（#90）：** 点页级 AI 按钮看不到段落级 loading 图标——受控实测：spinner 插入 t=6ms、移除 t=48ms，首个 AI 文本 t=2068ms 才到达（全程不可见）。根因：`aiTranslateDynamically` 把清理绑在 `await aiTranslateText(...)` 之后，而该函数在**派发时刻**返回（响应经回调到达、`translateWithAI` fire-and-forget）；Google 路径无此问题（`backgroundTranslateHTML` 是真 promise，到达时 resolve）。
- **对称性要求：** 任何「显示 loading → 等待 → 清理」链条，必须确认等待表达式 resolve 的时刻属于**到达**而非**派发**——「看起来是 await」不构成证据；有歧义时用慢 mock 探针实锤三时刻时间线（插入 / 移除 / 首达）。
- **到达驱动实现：** `aiTranslateText(toBeTranslated, showToastForError, onBlockSettled)` 第三参数为**逐块终态回调**——每个块到达终态时触发（6 站点：无 key 早退 / 内存缓存命中 / 持久缓存命中 / 流式到达 / `onError` / `onFinished` stuck 块）；调用方（`settleBlockIndicator`）据此清理该块指示器——**逐块语义**（兄弟块 spinner 不受影响），清理必须**幂等**（pending 集合去重）。
- **静默死亡守卫：** `AI_BLOCK_INDICATOR_GUARD_MS` 兜底「回调永不触发」的静默死亡（如 SW 被杀）；守卫上限必须**大于**传输层不活动超时（`fetchSSE` `inactivityTimeoutMs: 60_000`），否则活着的慢流会被守卫误清。
- **锚点规则：** 块级 AI spinner 必须行内贴附于「用户正在阅读的文本末尾」——newLine：`<translated>` 容器**之前**（尾随原文，与 Google spinner 同视觉关系）；replaceOriginal：块内 append（尾随译文）；**禁止**渲染为块下方独立一行。
- **实现点清单（规则对称性）：** `settleBlockIndicator`（pageTranslator.js，到达驱动清理唯一实现，含每块幂等去重）、`aiBlockIndicatorPosition`（锚点判定唯一实现）、`onBlockSettled`（逐块终态回调契约）、`AI_BLOCK_INDICATOR_GUARD_MS`（守卫常量）、`setBlockTranslationIndicator`（blockTranslationIndicator.js，position 感知的插入/查找/移除）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** jsdom `tests/contentScript/aiBlockIndicator.integration.test.js`（派发后 spinner 仍在 / 逐块清理 / 双模式 / 真实错误消息 / 守卫兜底 / 锚点行内 / 实现点映射 + `onBlockSettled` 契约）+ `tests/contentScript/blockTranslationIndicator.test.js`（position 支持 12 格）+ E2E `tests/browser-e2e/ai-block-indicator.mjs`（双模式**顺序断言**：spinner 移除必须晚于该块 AI 文本到达——与 mock 速度无关）。**新增检查必须做 RED 能力验证**（pre-fix 源码/构建下必须变红）。

**RULE: 视觉检查点规则（visual checkpoint rule, V1 #67）—— 截图点与清单双向覆盖，产物不入库，变更须演练效度对照：**
- **清单 SSOT：** 每个视觉截图点必须在 `tests/browser-e2e/visual-checks.mjs` 的 `CHECKPOINTS` 中声明（`id` + `capture` + `expect[]`）；`expect[]` 空 = 审查无判据，禁止。
- **双向覆盖：** `visual-audit.mjs` 中每个 `screenshotCheckpoint(page, "<id>")` 调用点的 id 必须在清单存在（且反向亦然）；id 必须是静态字符串字面量。由 `check-visual-checks.js`（第 11 个 lint）CI 强制。
- **产物纪律：** 截图/录像产物不入库（/tmp + CI artifacts 生命周期）；清单文件是代码资产、入库、走 review。
- **效度纪律：** 清单/捕获变更时必须演练一次（`VISUAL_SELFTEST=inject` 阳性必须命中 + `clean` 阴性必须零误报），结果贴对应 issue。
- **实现点清单（规则对称性）：** `visual-checks.mjs` `CHECKPOINTS`（清单 SSOT）、`visual-audit.mjs` `screenshotCheckpoint` 调用点（捕获）、`setup.mjs` `screenshotCheckpoint`/`waitForVisualStability`（助手）、`run-all.mjs` `captureFailureShot`（失败兜底）、`check-visual-checks.js`（lint 强制）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `tests/scripts/checkVisualChecks.test.js`（lint 自测 9 格）+ `tests/scripts/visualCapture.test.js`（助手契约 7 格）+ E2E `visual-audit.mjs`（真实捕获 10 检查点）+ `VISUAL_SELFTEST=inject/clean` 效度演练（遮挡/移位/隐藏三注入形态）。

**RULE: 意图驱动高亮规则（intent-driven highlight rule, plan 30 / #102）—— 按钮高亮 = 意图的函数，实际状态只由页面表达：**

- **症状/机制：** 高亮语义曾分裂为两套——页级「意图优先 + 实际显示兜底」× 块级「结果驱动」；07/09/11 号文档家族 5+ 次「按钮状态与实际不符」事故全部发生在两套语义的接缝处（最近一次：M10/#70 水平读边沿）。plan 30 统一为单一意图模型。
- **语义（两层同源）：** ① 页级 `highlight` = 纯意图（`deriveIntentUi` 单一派生：`translated ? (aiModeActive && aiRenderState !== "idle" ? "ai" : "google") : "original"`）；② 块级激活态 = 块 `intentMode`。**「意图高亮 + 页面显示别的东西」是合法中间态**（AI 在飞：高亮 AI + 页面 Google + spinner；AI 失败：高亮 AI + ⚠）——一致性断言必须分开「高亮=意图」与「可见真相=实际」两组，禁止要求两者恒等。
- **意图源 5 类（完备性清单）：** 点击（含 noop/promptConfig/retry——「点击总是切高亮」）、外部操作（popup/右键/快捷键，经意图事件显式写入）、自动翻译（Google 列表 `alwaysTranslateLangs`/`alwaysTranslateSites` → google；AI 列表 `alwaysTranslateLangsAI`/`alwaysTranslateSitesAI` → ai，经 `resolveAutoTranslateEngine` 判决，无 API key 时静默跳过不弹窗）、AI 流启动/恢复（→ai，含在飞与失败）、SPA 重建/刷新（从引擎镜像派生）。**任何新增意图入口必须同时接入意图写入链，禁止只写引擎不改高亮。**
- **闩锁语义：** `intervention` = 「意图在途闩锁」（非「点击优先」）——意图写入后抑制派生纠偏，派生与 highlight 对齐即自动释放；restore/rebuild 无条件清除。闩锁与 highlight 必须**原子**写（同一次 setState），拆开写会触发自释放把意图冲掉。
- **发音闸门（D6）：** 意图事件发出（发音）必须与派生规则同门——`shouldForceAiForThisRun && aiModeActive`；陈旧持久标记（armed sessionStorage marker）不得压过显式意图。
- **读取源一致性（#152）：** 「运行的有效意图」被多个闸门读取时（发音/显示/循环/抑制），必须读**同一源、在同一处收口**——`translatePage` 的 flag 恢复（`shouldForceAiAfterPageTranslation = shouldForceAiForThisRun && aiModeActive`）与 E1 发音同源：有效意图为 google 的武装运行必须**收窄 AI 循环**，否则批次 AI 到达会过 #70 epoch 闸门（请求期间未动 epoch）抢走显示（高亮 google / 页面 AI；跨页回退与同页已武装两种形状）。新增任一闸门必须同步核对其余闸门。
- **通道完备性（#134）：** 「静默/内部」入口的抑制参数必须作用于该入口的**全部通告通道**——`restorePage(silent=true)`（translatePage 的内部首步）曾只 gate 意图事件（E2），`pageLanguageStateObservers` 广播与 SW `setPageLanguageState` 消息仍无条件发出；泄漏的 mid-run "original" 让 floatingBtn observer handler 执行用户级 restore 语义（`setAiModeActive(false)` 清空引擎旗标 + bump `aiModeEpoch`），E1 随后按被污染旗标发音 "google"、块级 `propagateIntentToBlocks` 同步传播——而本次运行实际在恢复 AI 译文（SPA 回退/前进后双按钮组错亮 Google；watchdog 读同一被污染旗标故不自愈）。规则：静默路径**零通告**（同一运行同步重声明 "translated"，消费方收敛于最终态）；非静默路径（用户级 restore）双通道广播保持不变。
- **单语义写者（#137）：** 语义混流的强制面——状态通告通道（pageLanguageState 广播类）的订阅者**只许镜像 + 渲染**（写 store 镜像、刷 UI），**禁止**执行用户级语义（`setAiModeActive` / 清闩锁 / 写 `displayMode` / 清 in-flight）。用户级语义**只许**发生在意图通道 handler（`onRequestedModeChange`）——#134 的伤因正是状态通道上残留的用户级 handler 被内部通告误触发（observer 分支 `setAiModeActive(false)` 污染引擎旗标）。floatingBtn observer handler 以 `[mirror-only:begin]/[mirror-only:end]` 标记区块圈定，lint A4 扫描该区块内的语义 token（注释除外）。
- **出口唯一化（#137）：** 同一通告的**全部通道发射**必须收进单一出口函数（`announcePageLanguageState(nextState, { silent })`）——observer 广播与 SW `setPageLanguageState` 消息只许出现在该函数体内（lint A1 扫 src 全局散点）；`silent` 在出口短路，「漏掉一条通道」从「可能」变「结构上不可能」。新增通告通道 = 只改出口一处 + SSOT 登记。
- **实现点清单（规则对称性）：** `deriveIntentUi`（uiStateStore.js，派生唯一规则）、`arbitrateEngineDrivenState`（watchdog 仲裁 + 闩锁自释放）、`resolveAutoTranslateEngine`（pageTranslator.js，页面加载自动翻译的引擎判决纯函数——AI 列表 > Google 列表，无 key 静默）、`onRequestedModeChange`（意图事件唯一入口）+ `emitRequestedModeChange`（发音，E1 translatePage / E2 restorePage(silent，抑制覆盖全部通告通道) / E3 translatePageAi）、`propagateIntentToBlocks`（页级→块级传播）、`isBlockArrivalDisplayAllowed`（块级到达闸门，含 `blockIntentEpoch` 比对）、`intentMode`（块级意图字段）、`resolveInitialUiState`（重建派生镜像纯函数）、`announcePageLanguageState`（通告单一出口：observer+SW 双通道 + silent 短路，plan 40/#137）、`MIRROR_ONLY_CONTRACT`（mirror-only 订阅者契约：标记区块 + 禁止语义 token，tests/shared/announcement-channels.mjs）、`BtnAiProxy`（吸收化——页面级流经代理的 DOM 写入永不落到可见按钮）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `uiStateStore.test.js`（派生/闩锁）+ `watchdogScenarios.test.js`（S1–S7）+ `hoverBtnBehavior.integration.test.js`（E1/E2/E3 + D6 + 传播 + 继承）+ `floatingBtn.behavior.test.js`（意图源完备性 4 格 + SPA 重建）+ `floatingBtnClickResolver.test.js`（`resolveInitialUiState` 事件缺失格）+ `singletonBtnGroup.test.js`（吸收契约）+ `crossLevelInteraction.matrix.test.js`（D5 + 背离格）+ E2E `assertUiStateMatchesEngine`（意图 SSOT 优先）。

**RULE: 划词面板按钮意图规则（selection-panel intent rule, plan 31 / #106）—— 按钮只表意图，状态全部在译文框：**

- **症状/机制：** 面板底栏 G/A 按钮曾承载全部状态装饰——Google 成功加 `✓` span + 变色 + title 改写（`renderGoogleSuccessIndicator`）；AI 进行中 label 写成 `queuing`/`translating...`、成功后按钮 inline `color=darkgreen`、tooltip 随状态变异。用户要求：按钮「仅代表意图」——任何状态下文字恒为 `Google`/`AI`，点击只切换高亮。
- **语义：** ① 点击 = 只切换高亮（点亮当前、取消另一个，零其它写入）；② 翻译状态（loading spinner / 译文 / 错误文案）只在译文元素 `eSelTextTrans` 内呈现；③ 引擎对按钮的装饰写入全部被吸收（不落可见按钮）。
- **装饰吸收（`createPanelAiProxy`）：** 装饰面（`btnAiTxtNode` / tooltip / `classList` / `style` / `setAttribute`）落游离 dummy；**译文面（`translatedTextNode`）按身份直通**——`showOriginal` 注册靠元素恒等匹配（包 facade 会断悬停显示原文）；`classList.contains` 对 `dualtran-ai-selected-btn` 恒 true（`isSelectedPanel` 路由依赖，勿删）。
- **颜色（与译文颜色规则衔接）：** 面板不使用 `whereToDisplayTranslatedText` 双模式语义（译文永远单独显示）——`translatedColor`/`aiTranslatedColor` **无条件**按配置应用，且每次切换/到达**先重置再上色**（治跨引擎泄漏）；空值 = 不染色。
- **色板：** `PANEL_BTN_COLORS` 与悬浮组 `BTN_COLORS` **逐字一致**（跨面 parity 单测锁定；改任一处必须同步另一处）；颜色走 inline style（shadow `<style>` 只留布局）。
- **实现点清单（规则对称性）**：`applyPanelButtonPalette`（点击的唯一边界效果——色板翻转 + 意图写入）、`PANEL_BTN_COLORS`（面板色板 SSOT）、`createPanelAiProxy`（装饰吸收 + 译文面直通）、`applyPanelTranslatedColor`（状态呈现的译文侧单点）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `translateSelected.test.js`「panel intent buttons」+「panel translation color」两套件；E2E `selected-panel.mjs`（真实用户流 + CDP pierce；每次读取新鲜解析节点——面板会被 `onUp` 重建）。

**RULE: 单词路径缓存解耦规则（word-path cache decoupling rule, plan 33 / #111）—— 单词 AI 查询不读、不写共享缓存，每次点击直发请求：**

- **症状/机制：** 划词面板的单词路径（`aiTranslateWord`）曾在派发前查询共享内存缓存 `aiCache`——页面/悬停的文本路径写入的同词**普通译文**会被原样当作“单词释义”显示（用户查单词要的是词典式详释）。反向污染同源：单词路径把**词典长文**写进同一池子，文本路径按 (原文, 目标语言) 命中后会把词典文当作段落译文复用。
- **规则：** 单词路径与 `aiCache` **完全解耦**——不读（单词永远直发真实请求，含同词重复点击）、不写（词典式结果永不进入共享池）。单词判定沿用既有路由谓词 `wordsCount() === 1`（与面板路径分流单一来源，禁止引入第二套判定）。
- **边界：** 仅单词路径；`aiTranslateText`（页面块 / 悬停面板 / 句子）的缓存复用**保持不变**（负向对照格锁定）；持久缓存（IndexedDB）不涉及（单词路径本不使用）。已接受成本：每次单词点击 = 一次真实 API 调用（用户已确认，Q1/Q2 决策记录）。
- **实现点清单（规则对称性）**：`aiTranslateWord`（单词路径：无缓存读 + 无缓存写）、`aiCache`（共享池：单词运行前后逐字节不变）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `translateSelected.test.js`「translateSelected aiTranslateWord」套件（"marks success without writing the aiCache" + "ignores a matching aiCache entry — a single word always issues a live request" 两格，均 RED-first 实证）；E2E `selected-panel.mjs` 相位 E/F（单词连点两次 = 两次真实请求——旧代码第二次命中缓存实测红；句子二次点击 = 缓存命中 0 请求负向对照）。

**RULE: 单词路径源语言闸门规则（word-path source-language gate rule, plan 43 / #151）—— 不可信的 CLD 读数不得写进词典提示词，也不得驱动同语言分支：**

- **症状/机制：** 划词面板 + 悬停面板的单词路径把 `chrome.i18n.detectLanguage`（Chrome 内置 CLD）的读数直接写死进词典角色句（`professional <source>-<target> dictionary`）。孤立单词的 CLD 读数常年不可信**且错误**（实测 "Undertow"/"hello"/"undertow" → `sr`，isReliable=false，Chromium 145/151 两引擎一致；完整句子才 reliable=true 且正确），模型随即按角色要求伪造一整层该语言——用户实测：查 "Undertow" 输出在英文/中文正确层之上叠加整层塞尔维亚语（西里尔 + 拉丁混排）。
- **规则：** 只有 `isReliable === true` 且语言码 ≠ `und` 的读数才允许进入提示词（命名源语言的词典角色）并驱动 `isSameLanguage`；否则走**语言中立句**（`professional bilingual dictionary translating the word into <target>; identify the word's own language yourself`——`[<language>]` 字段本就要求模型自报词语言）。已删 `und → "English"` 硬编码回退（并入中立路径）。
- **边界：** 仅单词路径（`isSingleWord=true`）；文本路径提示词不含源语言（实测复核），不受影响。
- **实现点清单（规则对称性）**：`buildWordPromptRole`（角色句措辞单点，fetchSSE.js `@internal` 导出）、fetchSSE 信任闸门（`sourceLanguageTrusted` 判定单点，含 `isSameLanguage` 同闸门）、`detectTextLanguage`（isReliable 供给）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `fetchSSE.integration.test.js`「word-path source-language gate (#151)」W1–W5（不可信读数不进提示词 / und 不再回退 English / 可信对照 / 不可信不驱动同语言分支 / 真值表——W1/W2/W4/W5 RED-first 实证）；E2E `selected-panel.mjs` + `hover-panel.mjs` [E1b]（对 mock `/request-log` 实捕请求体 `messages[0]` 做前提条件化断言——与同一浏览器的 CLD 实测读数双支自校准，不 skip 不空转；修复前构建两场景均实测红，报错即用户原症状 `Serbian-French dictionary`）。

**RULE: 内容更新通道一致性规则（content-update channel conformance rule, #98 复发复盘）—— 翻译后站点更新必须按「机制通道」枚举覆盖，禁止按站点/功能名枚举：**

- **症状/机制：** 同一用户可见症状（「翻译后出现的站点更新内容不被翻译」）已复发 ≥3 次（#7 append、#98 characterData+容器过滤）。根因是它是一个**多通道维度**：站点更新 DOM 的机制有 8 类，历次修复只封住事发的那一条通道。
- **对称性要求：** 任何此类修复必须（a）在 SSOT `tests/shared/content-update-channels.mjs` 登记通道（含 `provenance`）；（b）在模拟页声明 `✅ 已模拟`；（c）由场景做**行为级**双模式遍历（`forEachDisplayMode`）；（d）有单测引用或书面豁免。四方一致由 `check-content-update-channels.js`（第 14 lint）强制（N1–N6）。
- **模拟页拓扑保真铁律：** 复现「容器过滤吞站点更新」根因的通道（append / replace），站点更新落点必须在**幸存且被扩展标记**的元素内部——追加目标 / 被替换节点位于标记元素之外时该根因不可复现（RED 校准实测：撤销修复断言不红 = 假绿）。
- **模式循环 collect-then-throw：** `forEachDisplayMode` 循环内的硬断言必须收集后统一抛出，禁止中途 throw——否则单格红会中断循环，另一显示模式整段漏跑。
- **实现点清单（规则对称性）：** `handleObserverMutations`（观察者分类唯一入口：characterData 值比对 + attributes 通道）、`hostUpdatedTextNodes`（站点写集合）、`getAttributesToTranslate`（元素级重扫）、`markAttributeWrite` / `isExtensionWrittenAttribute`（属性自写登记与值比对）、`updatePiecesToTranslateWithNewNodes`（消费端：新节点/站点写/属性合并 + 容器过滤改判据 `isDualTranGeneratedNode`）。修改任一实现点必须同步检查其他实现点 + 对应测试。

**RULE: 推理深度方言映射规则（reasoning-depth dialect rule, plan 32）—— 推理参数必须逐方言映射 + 值域裁剪，禁止照搬声明值：**

- **症状/机制（探针实锤 2026-09-28）：** AI SDK 的 `providerOptions` 有两个静默失败面——① **未知 key 被静默丢弃**（openai-compatible 方言下传 `{deepseek: {...}}` 时请求体里没有 `reasoning_effort`、无任何 warning；正确 key 是 `openaiCompatible`）；② **值域不符时抛错并崩掉整个翻译**（zod 严格校验：`mistral.reasoningEffort='max'`、`xai.reasoningEffort='xhigh'` 均抛 `invalid provider options`）。而 models.dev 的 `reasoning_options` 声明是**面向全生态的并集**（mistral 声明 `max`、xai 声明 `xhigh`、anthropic 声明 `none`），直接照搬 = 把用户送进运行时报错。
- **方言判据单点：** 方言由 models.dev 的 `npm` 字段决定（与 `createModelClient` 选 SDK 同一判据）；`resolveDialect` 是**唯一**判据实现，`DIALECTS` 表逐方言记录 `key`（providerOptions 键名）/ `accepts`（值域，`null` = 不校验）/ `style`（参数形状）。**新增 SDK_MAP 条目必须同步新增方言表条目**——两处独立维护同一判据会漂移，且漂移只会静默失败（issue #88 教训）。
- **不发送优于发错：** 值不被方言接受时 `buildProviderOptions` 返回 `null`（不传 providerOptions，请求仍成功、只是没有推理提示）——**禁止**为「让参数生效」而在无对应能力的方言上强传（thin wrapper `@ai-sdk/{togetherai,perplexity,deepinfra,cerebras}` 不读 `reasoningEffort`，无独立方言键）。
- **选项生成同样裁剪：** 下拉框选项 = 声明值 ∩ 方言接受集（`buildReasoningDepthOptions`），`Default`（value `""`）恒为首项且恒存在；`toggle` 型声明展开为 `Default` + 该方言的「开」值；`budget_tokens` 本轮不支持（显示 `Default`）。
- **缓存一致性：** 推理深度是 AI 翻译持久缓存 key 的一段——改深度必须换条目，否则会静默返回旧深度的译文。
- **实现点清单（规则对称性）：** `resolveDialect`（reasoningDepth.js，方言判据唯一实现）、`buildReasoningDepthOptions`（选项生成：声明值 ∩ 方言接受集）、`buildProviderOptions`（providerOptions 构造：不接受则返回 null）、`SDK_MAP`（aiProxy.js，npm → SDK 分发表——与方言表必须逐包对齐）、`buildCacheKey`（aiTranslationCache.js，深度参与 key 组成）、`getReasoningDepthForProvider`（pageTranslator.js，per-provider 深度读取，未设置返回 `""` 而非默认值）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `tests/ai/reasoningDepth.test.js`（28 格：方言解析 + 值域裁剪 + toggle 展开 + 拒绝即丢弃 + **与 SDK_MAP 的逐包对齐断言**）+ `tests/background/aiProxyReasoningDepth.test.js`（port `start` → `streamText` 的 providerOptions 实捕 8 格）+ `tests/background/aiTranslationCacheReasoningDepth.test.js`（深度参与 key；升级前 4 段 key 不命中）+ `tests/contentScript/pageTranslator.integration.test.js`「getReasoningDepthForProvider (plan 32)」+ E2E `tests/browser-e2e/reasoning-depth.mjs`（**线级实锤**：mock 服务器 `/request-log` 必须出现 `reasoning_effort: "high"`，对照组不得出现任何 reasoning 字段）+ E2E `settings-translation.mjs` S12（真实 UI：选深度 → reload → 持久化且重选）。

**RULE: 用户反馈通道规则（user feedback channel rule, plan 35 / #116）—— 一切可从扩展带出的产物必须经白名单构造、用户可见可删，禁止静默外发：**

- **症状/机制：** 反馈产物的泄露面在「调用方多传了什么」——预填 URL / 诊断块 / mailto 的构造若按调用方传参全收，API key、API base、页面内容、翻译文本都可能随上下文进入产物。构造侧必须**解构白名单**（只取声明的字段），调用方 extras 天然被丢弃——这是结构保证，不是纪律保证（负向断言锁死）。
- **红线：** 任何产物（issue URL / 诊断块 / mailto）不得出现 API key、API base 配置、页面内容、翻译原文/译文；错误文本与 hostname 只进用户提交前**可见可删**的预填区；不做任何静默后台发送；不引入遥测。
- **静态路径不得猜服务：** options 静态入口不知道页面上下文，`service` 参数不得预填（猜错误导分诊）；版本/浏览器/OS 从 manifest + navigator 派生（可信）。
- **URL 预算收敛：** 最终 URL ≤2000 字符，收敛只能收缩错误文本（CJK 最坏情形逐字符），其他上下文字段永不丢弃。
- **实现点清单（规则对称性）：** `buildIssueUrl`（预填 URL 白名单构造 + 预算收敛）、`buildMailtoUrl`（mailto 兜底：版本化主题 + 可删正文）、`formatDiagnosticsBlock`（诊断块行名 SSOT）、`mapServiceToIssueValue`（service 参数 ↔ bug_report.yml 选项逐值映射）、`detectBrowserFromUserAgent`（browser 参数映射）、`detectOsFromUserAgent`（os 参数映射，含 Android-before-Linux 排序陷阱）、`installFeedbackReporter`（⚠ 图标委托点击 → SW 消息）、`buildOpenFeedbackIssueEffect`（SW 分发分支：open-tab 效应构造）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `tests/lib/feedbackLink.test.js`（20 格：golden URL 逐字节 + 白名单不泄露负向断言 + service 映射 + CJK 预算收敛 + 诊断块行门控 + mailto）+ `tests/contentScript/feedbackReporter.test.js`（委托点击契约 7 格）+ `tests/background/runtimeMessageExecutionHelpers.test.js` / `runtimeMessageDispatchLoop.integration.test.js` / `runtimeMessageFlow.integration.test.js`（效应构造 + 分发链路）+ `tests/options/options.test.js` / `tests/popup/popup.test.js` / `tests/contentScript/popupMobile.test.js`（三入口）+ E2E `tests/browser-e2e/feedback-entry.mjs` F1–F5（结构 / 逐参数 URL 断言 / 剪贴板红线哨兵 / popup 入口 / 连接拒绝→⚠→预填 URL 全链，登录墙 `return_to` 解码）。

**RULE: 悬停面板对齐规则（hover-panel alignment rule, plan 37 / #125）—— 悬停框与划词框共享皮肤/状态实现点；只有触发与生命周期保持悬停特有：**

- **症状/机制：** 悬停翻译框（`showTranslated.js`）与划词面板（`translateSelected.js`）各自维护皮肤、译文色、按钮色板、loading 与错误渲染，长期漂移（悬停框曾无标题栏/复制/「+」下拉；loading 延迟到译文到达才出现；错误只在 toast、框内无；Google 失败直接销毁框）。对齐的边界不是「整壳复用」（触发与生命周期语义不同），而是**共享实现点**——皮肤 + 状态渲染下沉 `panelShared.js`（五件套），触发壳保持各自特有。
- **共享面（单源，零漂移）：** `panelShared.js` 五件套——loading 面（spinner + label 渲染/清空）、译文色（先重置再上色，空配置 = 不染色）、按钮意图色板（与划词逐字 parity）、装饰吸收代理（标签恒定、零 ✓/✕）、暗色/布局样式常量。`translateSelected.js` 对既有符号保持同名 re-export（既有测试 import 路径不变、划词回归零漂移）。改任一实现点必须同步两面板 + 对应测试。
- **悬停特有（禁止共享化）：** 触发与生命周期保持悬停语义——1.25s 悬停触发 / 跟随光标定位 / 移开换目标 / 点框外销毁 / Ctrl×2；不移植原文块 / 页面替换 / moreOrLess。
- **状态与错误对齐：** loading 在发起翻译的同一刻进框（译文框先于译文出现）；Google 失败 = toast + 框内红字（不再销毁框）；AI 失败 = toast + 框内红字（装饰经共享代理吸收）；超时 10s 与划词同值。
- **「+」下拉语义同划词：** 选中语言 → 置顶收藏前三（全局 `targetLanguages` 两处共享）+ 设为目标语言 + 立即重译 + 收起。
- **负向契约（悬停 AI 不得污染页面级状态）：** 悬停 AI 成功不得写页面「已 AI 翻译」标记——悬停 AI 运行经 `dualtran-ai-selected-btn` 代理（`isSelectedPanel` 分支天然跳过页面级标记写）。
- **实现点清单（规则对称性）：** `setPanelTranslationLoadingState`（loading 渲染单点）、`clearPanelTranslationLoadingState`（loading 清空单点）、`applyPanelTranslatedColor`（译文色单点：先重置再上色）、`applyPanelButtonPalette`（意图色板翻转单点）、`createPanelAiProxy`（装饰吸收 + 译文面直通）、`PANEL_BTN_COLORS`（面板色板 SSOT）、`PANEL_LOADING_CSS`（布局/loading 样式常量）、`PANEL_DARK_MODE_CSS_DARK` / `PANEL_DARK_MODE_CSS_LIGHT`（暗/亮样式常量）、`aiTranslateWord`（Q-H1 单词路由）、`wordsCount`（单词判定谓词）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `showTranslated.test.js`（25 格：模板齐备/loading 起点/译文色/意图色板/标签恒定零装饰/错误进框/跨引擎泄漏/复制/「+」下拉/暗色常量共享/单词路由）+ `translateSelected.test.js`（re-export 契约下 17 格回归——划词行为零变化）+ E2E `hover-panel.mjs` 相位 A–E（loading 先于译文出现 / 色板 computed / 跨引擎色归位 / 单词=词典路径、多词=文本路径请求计数正反两格）。

**RULE: 悬停显示原文气泡门控与皮肤规则（hover original-text bubble rule, plan 38 / #128）—— 气泡只在「用译文替换原文」模式生效，皮肤与悬停框/划词面板单源：**

- **症状/机制：** 「悬停显示原文」气泡（`showOriginal.js`）原在两种显示模式下都注册悬停目标（newLine 注册 `<translated>`、replaceOriginal 注册 encapsulate 的 `<font>`）——newLine 下原文本就可见，气泡冗余且与悬停翻译框竞争。同时气泡自带皮肤（`showOriginal.css`）与 plan 37 后的共享面板皮肤漂移。
- **门控（单点谓词）：** `showOriginal.isEnabled` = `showOriginalTextWhenHovering === "yes"` ∧ `whereToDisplayTranslatedText === "replaceOriginal"`。全部注册守卫（newLine 块注册 / replaceOriginal 逐节点注册 / AI 路径）共用该谓词——改它即全链路随动，`pageTranslator.js` 零改动。新增注册点必须同样先查 `showOriginal.isEnabled`。
- **运行时联动：** 任一设置变更（`twpConfig.onChanged`）→ 重算谓词 → `showOriginal.enable(true)` 重建/拆除宿主 → 通知 `enabledObserverSubscribe` 观察者；已译页经 observers 自动重译一次，模式切换即时生效（出现/消失）。
- **皮肤（单源，零本地样式）：** 气泡共用 `translateSelected.css` + `panelShared.js` 暗/亮常量（`PANEL_DARK_MODE_CSS_DARK` / `PANEL_DARK_MODE_CSS_LIGHT`），id 对齐面板词汇（`#eDivResult` / `#eOrigText`），`showOriginal.css` 已删除。不移植 `#f3f4f8` 内容块——气泡保持「容器底色 + 文字」两层。不加标题栏/复制/「+」下拉：气泡是纯阅读快照。
- **触发与生命周期（保持原样，禁止改动）：** 1.5s 悬停延迟 / 跟随光标（`mousePos + 10px`，视口钳制）/ 移开换目标 / 点框外（`mousedown`）销毁 / `blur` + `visibilitychange` 隐藏。
- **实现点清单（规则对称性）：** `showOriginal.isEnabled`（门控谓词单点）、`showOriginal.enable`（宿主建/拆 + 谓词守卫）、`showOriginal.disable`（拆除）、`showOriginal.add`（节点注册）、`showOriginal.removeAll`（注册清理）、`enabledObserverSubscribe`（联动通知）、`backdropFilterElement`（暗色载体单点）、`eDivResult`（气泡容器 id）、`eOrigText`（气泡文本 id）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `tests/contentScript/showOriginal.test.js`（18 格：门控 4 组合真值表 / 联动双向 / 皮肤模板单源 / 暗亮常量格）；E2E `options-behavior.mjs` O-B 三相位（B1 newLine 负向悬停无气泡 / B2 切 replaceOriginal 已译页自动重渲染 + 悬停出现 / B3 options 备注结构）+ `popup-behavior.mjs` P-B（显式 pin replaceOriginal）。

**RULE: 生产产物控制台静默规则（production console silence rule, plan 39 / #131）—— 调试日志必须经 terser 可识别的字面量调用形态；禁止一切「terser 看不穿」的引用形态（计算属性 / 值位置引用 / 默认参数 / 守卫读）：**

- **症状/机制：** `webpack.production.js` 已设 terser `drop_console: true`，但 terser 只能删除**可证明为死代码的字面量调用**。凡经以下四种形态到达 console 的调用**原样穿透**进发布包：计算属性访问（`console[level]`）、值位置引用（`log: console.log`）、默认参数（`onWarn = console.warn`）、守卫读（`typeof console !== "undefined" && console.debug`）。已发布 2.1.30 实测 6 处幸存（AST 7 个引用），最小复现输出 13 条控制台消息（SW 10 条 + 页面 2 条 + 设置页 1 条）。
- **裁决（数组形式已被实测否决）：** 保留布尔 `drop_console: true` 全删；**禁止**改为数组形式（`["log","info","debug"]`）——实测会揭开 70 条此前被静默吞掉的潜伏消息（设置页一开刷 42 条 debug + 28 条 warn），与「控制台静默」目标反向。
- **允许形态：** 固定形参箭头 + 字面量 console 调用（`(label, value) => console.log(label, value)`），terser 可证明 body 死代码并整体删除；生产构建中该函数体被删为空（`(label, value) => {}`），实参形态差异只影响 dev 构建外观。
- **实现点清单（规则对称性）：** `emitDualTranDebugLog`（pageTranslator.js，字面量两分支——`"error"` → console.error、其余 → console.log；禁止 `console[level]`）、`debugLog`（options.js，模块级固定形参 sink；声明位置必须早于所有 `$()` 调用点——模块求值期未命中也会到达它，晚声明 = TDZ ReferenceError）。
- **测试：** `tests/manifest/buildArtifactGuards.test.js`（N1 产物级 AST 零 console 引用——对 dist/chrome/**/*.js 逐文件解析，含计算属性与 window/globalThis/self 变体；N2 HTML 本地引用可解析）；`tests/contentScript/pageTranslator.test.js`（emitDualTranDebugLog 真值表：error/log/未知 level 回退，负向格）；`tests/options/options.test.js`（未命中经 debugLog + 存在元素负向格）。
- **门禁纪律：** 改动 `sw.js` 的 `log`/`logError` 注入点、`pageTranslator` 调试发点或 options 的 `$`/`debugLog` 后，必须跑 `buildArtifactGuards.test.js`（产物级 N1 是唯一能验「terser 是否删得掉」的手段；静态 grep 会误判 provider URL 字符串）。

**基础设施假设清单（Infrastructure Assumptions，M1 issue #31）—— 每个假设必须有测试引用（M3 用 check-infra-assumptions.js 强制）：**
- **假设：** `document.body` 元素可能被框架整体替换（Turbo Drive 回退导航 `replaceWith`，2026-09-10 github.com 实测）→ 测试：`tests/contentScript/pageTranslator.navRestore.integration.test.js`「T8: body 元素被替换后（Turbo back-nav），动态翻译 observer 仍存活」+ `tests/contentScript/floatingBtn.behavior.test.js`「turbo back-nav」2 个
- **假设：** `document.documentElement`（`<html>`）在 SPA 导航中存活（实测 `htmlReplaced: false`）→ 测试：`tests/contentScript/pageTranslator.navRestore.integration.test.js`「T8: body 元素被替换后（Turbo back-nav），动态翻译 observer 仍存活」+ `tests/contentScript/floatingBtn.behavior.test.js`「turbo back-nav: body element replaced immediately → host must be recreated」
- **假设：** 挂 documentElement 的 observer 对 `<head>` 变化可见 → 回调必须过滤 `document.head.contains(addedNode)`（否则 `<title>` 被翻译，soak feedback loop）→ 测试：`tests/browser-e2e/observer-feedback-loop.mjs`（4 组合 soak 计数稳定）
- **假设：** popstate 定时器不是可靠的恢复机制（Turbo fetch 异步，200ms 检查时 host 可能还在）→ 测试：`tests/contentScript/floatingBtn.behavior.test.js`「turbo back-nav: body element replaced AFTER popstate 200ms check」
- **假设：** `pageshow` 只在 bfcache（`e.persisted`）触发，Turbo 回退不是 bfcache → 测试：`tests/contentScript/pageTranslator.navRestore.integration.test.js`「T5: pageshow（bfcache 恢复，persisted=true）」
- **假设：** MutationObserver 挂载点必须用 `getObserverRoot()`（`src/lib/dom.js`），禁止 `document.body` → 测试：`tests/scripts/checkObserverMount.test.js`（lint 自测 5 个）+ `scripts/check-observer-mount.js`（CI 强制）
- **假设：** Turbo Drive 快照缓存是 `cloneNode(true)`（**不克隆 shadow root**）且 restore 恢复（back/forward 到可缓存页）渲染快照**不发请求**（`turbo-cache-control: no-preview` 可缓存、`no-cache` 不可缓存；2026-09-14 github.com 实测 + @hotwired/turbo@8 源码 `PageSnapshot.clone()`）→ **重建检查必须把"无 shadowRoot 的 host"当作缺失**（`hasFunctionalHost()`），否则快照渲染后的空壳 host 永久存活、按钮消失（第 8 次事故）→ 测试：`tests/contentScript/floatingBtn.behavior.test.js`「turbo snapshot shell」4 个 + `tests/contentScript/singletonBtnGroup.test.js`「快照残留的 shadow-less shell host 在重建时被清除」+ E2E `tests/browser-e2e/navigation-recovery.mjs` Scene 6（两页翻译 + 快速往返）
- **假设：** 模块加载期调度的一次性定时器（如 pageTranslator 主框架分支的 120ms 可见性检查）**不可取消**，可能在 DOM 上下文拆除后触发（vitest 环境拆除 / 页面卸载）→ 回调必须带 teardown 守卫（`typeof document === "undefined"` → no-op），否则裸 `document` 访问抛 ReferenceError，在 zero-tolerance CI 上表现为「全部测试通过但 1 unhandled error → exit 1」（2026-09-15 PR #46 CI 实锤：run `34965080915`——navRestore 测试每测 `resetModules()` + 重复 `import`，每个模块实例都调度一个新定时器，文件结束后最后一个在 jsdom 拆除后触发）。**该定时器还会在「宿主环境存活但 API 不完整」时触发**——coverage 仪器化使测试文件运行 >120ms，定时器在文件执行中途回调，此时测试文件的薄 mock（如 `platformInfo` mock 为 `{}`）会让回调链抛 TypeError 逃逸（2026-09-26 master `34f0e01` Coverage job 实锤：run `36236786748`，`!platformInfo.isMobile.any` @ `pageTranslator.js:4156`）→ **回调链整体必须失败遏制**（best-effort 检查的 `try/catch` + `console.warn`，绝不外抛；M5 静默捕获治理：核心路径 catch 必须 warn）→ 测试：`tests/contentScript/pageTranslator.navRestore.integration.test.js`「T9: 模块加载期 120ms 定时器在环境拆除后触发不得抛 ReferenceError」+ `tests/contentScript/pageTranslatorHelpers.test.js`「T10: 模块加载期 120ms 定时器回调在本文件薄 mock 环境下不得抛异常（#96）」
- **假设：** 持久 host 组件的「应否存在」不能靠隐式事实源推断（旧：`divElement === null` / `_singleton.host === null` / 死变量 `singletonInitialized`）——主动隐藏与被动移除在闭包守卫下同形，eager 重建无法区分二者；必须升级为显式的 `enabled` 标志 + 每宿主一个注册句柄（C1/M5，`hostLifecycle.js`）→ 测试：`tests/contentScript/hostLifecycle.test.js`（①注册默认 disabled ②disable 清全部副本 ⑤disabled 拦阻三种 eager 触发 ⑧第三宿主一行注册验收）
- **假设：** Turbo 快照 `cloneNode(true)` 复制 DOM 属性（`data-dualtran-block`、googleSpan/aiSpan class）但**不复制 WeakMap 块状态** → 悬停委派命中克隆块时 `getBlockState()` 返回 undefined；显示层守卫必须用 **WeakMap 身份判定**（`blockStateMap.get(el)`），禁止属性判定（#65）→ 测试：`tests/contentScript/singletonBtnGroup.test.js`「未注册块悬停 — fail-safe 守卫 (#65)」5 格（①快照克隆块真 `cloneNode(true)` 悬停不创建 host ②裸未注册块 ③幽灵组防护 ④touchstart 入口 ⑤已注册块回归对照）
- **假设：** `browser` 命名空间的存在**不是**「这是 Firefox」的判据——Chrome 148+ 起 Chrome 也提供 `browser`（作为 `chrome` 的别名，命名空间可用但 `commands.update` 不存在；`browser.i18n === chrome.i18n` 实测），存在性探测 `typeof browser !== "undefined"` 在 Chromium 恒真 → 平台分支翻转（本应隐藏的页内快捷键列表显示、本应显示的原生管理器按钮隐藏）+ `twpConfig.import`/`restoreToDefault` 抛 `TypeError: browser.commands.update is not a function`（重置失效、导入误报文件损坏）；平台判定必须探测**能力**（`typeof browser.commands?.update === "function"`）。同理 `commands.getAll()` 返回的浏览器自动合成保留命令（MV3 `_execute_action` / 旧 MV2 `_execute_browser_action` / `_execute_page_action`）其 `description` 为**空字符串**，UI 必须按 `_execute_` 前缀兜底本地化 label（#85）→ 测试：`tests/options/options.test.js`「renders a fallback label for a reserved command with an empty description」+「keeps the legacy MV2 reserved command name covered by the fallback label」+「treats the Chrome 148+ browser alias namespace as Chromium (native manager shown, list hidden)」+「still uses the in-page shortcut editor on Firefox (commands.update available)」+ `tests/lib/config.test.js`「imports config on Chrome 148+, where the browser namespace has no commands.update (#85)」+「restores defaults on Chrome 148+, where the browser namespace has no commands.update (#85)」+「still pushes every hotkey through browser.commands.update on Firefox (#85)」+ E2E `tests/browser-e2e/settings-advanced.mjs` H2（原生管理器按钮可见，硬失败）+ H8（双形态逐行 label 非空）
- **假设：** models.dev 数据以**其自身 ID** 为键（`google` / `xai` / `togetherai` / `zhipuai` / `moonshotai` / `alibaba-cn` / `azure`），与产品**内部 ID**（`google-gemini` / `grok` / `together` / `zhipu` / `moonshot` / `qwen` / `azure-openai`）不同——凡以内部 ID 消费 models.dev 数据的代码点**必须**经统一别名解析（`providerRegistry.resolveModelsDevId()`），否则 `npm` 解析失败 → 专用 AI SDK 永不选中 → 静默落入 OpenAI 兼容 fallback，请求打到该提供商原生 API 不存在的 `/chat/completions` 路径（Gemini 原生 `generateContent` API 实测 404；#88 由硬化后的 multi-provider E2E 发现——旧测试对此 warn+skip 永久静默）。各模块自带 ID 映射副本 = 不对称 = 缺陷温床（`providerModelPreview.js` 曾有独立副本，`aiProxy.js`/`sseClient.js` 没有）→ 测试：`tests/ai/createModelClient.test.js`「C5.1: google-gemini resolves the dedicated Google SDK via the models.dev alias (google)」+「C5.2: grok resolves @ai-sdk/xai via the models.dev alias (xai)」+「C5.3: together resolves @ai-sdk/togetherai via the models.dev alias (togetherai)」+ E2E `tests/browser-e2e/translation.mjs` multi-provider-ai（gemini 45s 超时硬失败，实测 41/41 nodes）

**PR Checklist for translation core changes** (MutationObserver callback, `updatePiecesToTranslateWithNewNodes`, `getPiecesToTranslate`, `addTranslatedContent`, `translateDynamically`):
- [ ] New/modified tests cover "translation output is not re-translated" scenario
- [ ] `assertNoDuplicateTranslations` E2E assertion still passes
- [ ] If modifying the MutationObserver callback, verify `isDescendantOfTranslated` filter is preserved

**PR Checklist for UI state changes** (floatingBtn, singletonBtnGroup, any component with highlight/displayMode state):
- [ ] 涉及 UI 状态？是否测试了跨重建/跨导航的状态保持？（生命周期矩阵测试，tests/CLAUDE.md）
- [ ] 涉及引擎状态？UI 是否有查询路径（`pageTranslator.getState()`）+ 事件缺失测试？（A3）
- [ ] 涉及 SPA 导航？E2E 是否断言了导航后状态一致性？（`assertUiStateMatchesEngine`）
- [ ] 初始化是否从引擎状态派生（`resolveInitialUiState`），而非硬编码？（`check-ui-state-init.js` CI 强制）

**PR Checklist for SPA/navigation/DOM-lifecycle fixes (M4 issue #34):**
- [ ] 本次修复是否扩大了观察/监听范围（observer 挂载点、事件监听范围）？如果是，新可见区域（如 head）的过滤是否已验证？（T3）
- [ ] 本次修复涉及 SPA 导航/DOM 生命周期？如果是，必须运行 `node scripts/real-site-verify.mjs --url=<用户报告 URL>` 并在 PR 描述附结果（P1；**注意 `=` 形式**——空格形式 `--url <URL>` 会被静默忽略跑默认站点，与 PR #30 `--scenario name` 同类陷阱）

**修复前置检查 SOP（Pre-Fix Pattern Check，M4 issue #34）—— 修复任何 bug 前必须执行：**
1. **对照状态同步失败模式清单（M1-M6）**：`M1 事件丢失 / M2 重建归零 / M3 顺序竞态 / M4 副本失真 / M5 初始化硬编码 / M6 观察者死亡`（完整定义见 dualtran-extension skill「状态同步失败模式清单」）。属于已知模式 → 直接套用修复模板；不属于 → 继续第 2 步。
2. **对照基础设施假设清单**（本文件「基础设施假设清单」章节）：本次 bug 是否暴露了新的基础设施假设（DOM 元素生命周期/事件触发条件/定时器时序）？如果是 → **先文档化假设 + 测试引用，再修复**（M3 用 check-infra-assumptions.js 强制）。
3. **对照模拟忠实度**：本次 bug 是否涉及 SPA/导航/DOM 生命周期？如果是 → 修复后必须运行 `real-site-verify.mjs`（P1）+ 检查 E2E 模拟页是否忠实（M2）。
4. 修复完成后按「复盘五步」落档：根因 → 测试盲区 → 架构裂缝 → 改进项 → **维度族枚举**（根 CLAUDE.md / tests/CLAUDE.md / skill pattern 三处）。
   - **第五步「维度族枚举」（13 号文档 P1）：** 本次暴露的新维度，其**同族成员**还有哪些？逐成员标注「已覆盖 / 未覆盖 + 计划」。**机理：** 每补一个维度就暴露下一层（事件驱动补维度 = 打地鼠）——机制驱动枚举一次把同族列全，把「下个 bug 的下个维度」变成已跟踪的清单。**示范（第 8 次事故）：** 新维度「Turbo 快照机制」→ 族成员：cloneNode 语义 ✅ 已模拟 / 缓存策略分支 ✅ 已模拟 / LRU 淘汰 ⛔ 未覆盖 / 预渲染 ⛔ 未覆盖 / 脚本语义 ⛔ 未覆盖 / CSS 合并 ⛔ 未覆盖——逐项进入 MOCK FIDELITY 分支枚举声明（S3 落地），不再是「下个 bug 的下个维度」。

**概率性症状诊断 SOP（条件枚举优先，13 号文档 P5）—— 用户报告含「大概率 / 偶发 / 有时」时：**
1. **第一动作 = 条件枚举**：列出「发生条件 vs 不发生条件的差异」表（页面 / 导航路径 / 缓存头 / 时序 / 扩展配置任一维度），**而非**立即进入时序/竞速假设。
2. **换轨纪律**：两个假设轮次无进展 → **强制更换假设类别**（时序 ↔ 机制 ↔ 状态），不得在同类假设上继续加码。
3. **依据（第 8 次事故教训）：** 早期在「时序竞速」假设上耗时（route 注入延迟验证失败）；通向根因的实际路径是条件枚举——两页的 `cache-control` 头差异（/security `no-preview` vs /projects `no-cache`）一旦列出，「为什么大概率」自明。**概率性描述 = 条件差异的邀请函。**
4. **条件枚举表的归宿**：进入复盘文档 + 若涉及模拟页保真度 → 对照 MOCK FIDELITY 分支枚举（S3）检查对应条件是否已建模。

**UI 状态架构原则（计划文档 08-ui-state-ssot-plan.md）：**
- **SSOT**：UI 状态（highlight/displayMode/intervention/inFlight）唯一事实源是 `uiStateStore`，禁止闭包持有状态副本。floatingBtn 等组件是纯渲染器，从 `getState()` 读取。
- **Watchdog**：引擎驱动状态必须可自愈（不一致时 setState 纠正）；用户选择状态（intervention=true）必须保留，watchdog 不得干预。
- **Watchdog 实时派生规则（plan 30 意图模型修正，2026-09-27）**：无干预且无意图闩锁时，`highlight` 必须与**意图派生**一致——`pageLanguageState === "translated" && aiModeActive && aiRenderState !== "idle"` → AI；translated → Google；original → Original（单一规则 `deriveIntentUi`；watchdog 只仲裁 highlight，`displayMode` 退役为实际显示记录）。**不得**读「到达时刻的实际显示」（`=== "success"`）当派生——AI 启动/恢复的加载期高亮必须已是 AI（= 意图）；失败保持 AI（点击 = 重试）。**不得**只看 pageLanguageState 派生（第 6 次同类事故）。意图闩锁（intervention）在途时 watchdog 不纠偏，派生对齐后闩锁自释放；restore/rebuild 无条件清除闩锁。
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

### English first
It's a github project, always use English for code comments and git messages.

**User-facing repo surfaces are English-only too (#121):** GitHub renders issue forms / PR templates straight from static repository files — there is no i18n mechanism there (only the extension's `_locales/` route is localized). A half-Chinese issue form blocks non-Chinese reporters exactly at the triage-critical fields. Guard: `tests/static/githubTemplates.test.js` — CJK scan over every issue template (dynamic enumeration: new templates are covered automatically) + the PR template, with negative-fixture detector self-tests; it also freezes the `bug_report.yml` field-id set (the prefill / E2E contract) and asserts every dropdown value the extension can prefill exists byte-for-byte among the form options (a mismatched value makes GitHub silently drop the prefill). Internal-only files (`.github/workflows/*` comments) are deliberately out of scope.

### 预授权规则（2026-09-29 用户授权）
本项目对 CLAUDE.md / AGENTS.md 的修改不设事前审批：agent 可直接编辑（走 `~/.hermes/scripts/edit-agent-rules.py`，精确补丁 + 原子写），但必须在写完后的**同一轮内**发送一封邮件说明改了什么（脚本会自动发信：正文含 unified diff，标题 `CLAUDE.md已更新-<简述>`）。审计日志：`~/.hermes/logs/agent-rules-edits.log`。例外仍受保护：SOUL.md / .cursorrules 维持原有审批门。