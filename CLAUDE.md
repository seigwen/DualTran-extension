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

### Real-site canary (S5, issue #57)

```bash
npm run build                                        # first — the tool loads dist/chrome/
node scripts/real-site-verify.mjs --list             # list scenarios
node scripts/real-site-verify.mjs                    # run the full scenario library (real github.com)
node scripts/real-site-verify.mjs --scenario=bug8-double-page-roundtrip   # one scenario
node scripts/real-site-verify.mjs --url=<user URL>   # ad-hoc single-URL journey (PR checklist)
xvfb-run -a node scripts/real-site-verify.mjs --self-test                 # hermetic (local mock pages)
```

- **Scenario library:** `scripts/canary-scenarios.mjs` — declarative data (`source` field traces each scenario to its user report / incident). Adding a scenario = adding one entry; the executor (`scripts/real-site-verify.mjs`) owns the step loop + tri-state assertions (healthy ∧ count===1 per settled step).
- **Assertions use the shared tri-state primitives** in `tests/shared/host-state.mjs` (same classifier as the E2E suite).
- **Cadence:** `.github/workflows/canary.yml` — every Monday 3:00 UTC + manual dispatch; fails open/comment on an issue (`canary:` title prefix, dedup; auto-closed when green again). **Not a PR gate** — real-site runs need human judgment.
- **Release gate:** `.github/workflows/release.yml` runs the canary before producing the ZIP — a release cannot ship if the real site is broken.
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
- **视觉：** 色板与浮动组逐字对齐（O `#d1d5db/#f3f4f6/#6b7280`→激活 `#374151`；G `#bfdbfe/#eff6ff/#1d4ed8`→激活 `#1d4ed8`；A `#ddd6fe/#f5f3ff/#7c3aed`→激活 `#7c3aed`），JS inline style + spec 对象（BTN_COLORS），激活态源 = 块 `displayMode`；标签全称 Original/Google/AI。
- **实现点清单（规则对称性）：** `singletonBtnClickResolver.js` `resolveSingletonBtnClick`（决策唯一实现）、`pageTranslator.js` `handleSingletonBtnClick`（执行唯一入口）、`singletonBtnGroup.js` `showButtonGroup`（守卫）、`BTN_COLORS`/`applyButtonPalette`（视觉）、`singletonBtnGroup.js` `createBlockState`（`requestEpoch` 字段）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** jsdom `singletonBtnClickResolver.test.js`（决策表 21 格）+ `hoverBtnBehavior.integration.test.js`（Behavior 1–4 + 晚写抑制 2 格）+ `singletonBtnGroup.test.js`（守卫 5 格 + 三按钮结构/色板 4 格）+ E2E `navigation-recovery.mjs` Scene 3（computed 色值 + 标签）。**样式变更必须 jsdom（锁 inline 色）+ E2E（锁 computed）双层**（tests/CLAUDE.md 样式分层纪律）。

**RULE: 视觉检查点规则（visual checkpoint rule, V1 #67）—— 截图点与清单双向覆盖，产物不入库，变更须演练效度对照：**
- **清单 SSOT：** 每个视觉截图点必须在 `tests/browser-e2e/visual-checks.mjs` 的 `CHECKPOINTS` 中声明（`id` + `capture` + `expect[]`）；`expect[]` 空 = 审查无判据，禁止。
- **双向覆盖：** `visual-audit.mjs` 中每个 `screenshotCheckpoint(page, "<id>")` 调用点的 id 必须在清单存在（且反向亦然）；id 必须是静态字符串字面量。由 `check-visual-checks.js`（第 11 个 lint）CI 强制。
- **产物纪律：** 截图/录像产物不入库（/tmp + CI artifacts 生命周期）；清单文件是代码资产、入库、走 review。
- **效度纪律：** 清单/捕获变更时必须演练一次（`VISUAL_SELFTEST=inject` 阳性必须命中 + `clean` 阴性必须零误报），结果贴对应 issue。
- **实现点清单（规则对称性）：** `visual-checks.mjs` `CHECKPOINTS`（清单 SSOT）、`visual-audit.mjs` `screenshotCheckpoint` 调用点（捕获）、`setup.mjs` `screenshotCheckpoint`/`waitForVisualStability`（助手）、`run-all.mjs` `captureFailureShot`（失败兜底）、`check-visual-checks.js`（lint 强制）。修改任一实现点必须同步检查其他实现点 + 对应测试。
- **测试：** `tests/scripts/checkVisualChecks.test.js`（lint 自测 9 格）+ `tests/scripts/visualCapture.test.js`（助手契约 7 格）+ E2E `visual-audit.mjs`（真实捕获 10 检查点）+ `VISUAL_SELFTEST=inject/clean` 效度演练（遮挡/移位/隐藏三注入形态）。

**基础设施假设清单（Infrastructure Assumptions，M1 issue #31）—— 每个假设必须有测试引用（M3 用 check-infra-assumptions.js 强制）：**
- **假设：** `document.body` 元素可能被框架整体替换（Turbo Drive 回退导航 `replaceWith`，2026-09-10 github.com 实测）→ 测试：`tests/contentScript/pageTranslator.navRestore.integration.test.js`「T8: body 元素被替换后（Turbo back-nav），动态翻译 observer 仍存活」+ `tests/contentScript/floatingBtn.behavior.test.js`「turbo back-nav」2 个
- **假设：** `document.documentElement`（`<html>`）在 SPA 导航中存活（实测 `htmlReplaced: false`）→ 测试：`tests/contentScript/pageTranslator.navRestore.integration.test.js`「T8: body 元素被替换后（Turbo back-nav），动态翻译 observer 仍存活」+ `tests/contentScript/floatingBtn.behavior.test.js`「turbo back-nav: body element replaced immediately → host must be recreated」
- **假设：** 挂 documentElement 的 observer 对 `<head>` 变化可见 → 回调必须过滤 `document.head.contains(addedNode)`（否则 `<title>` 被翻译，soak feedback loop）→ 测试：`tests/browser-e2e/observer-feedback-loop.mjs`（4 组合 soak 计数稳定）
- **假设：** popstate 定时器不是可靠的恢复机制（Turbo fetch 异步，200ms 检查时 host 可能还在）→ 测试：`tests/contentScript/floatingBtn.behavior.test.js`「turbo back-nav: body element replaced AFTER popstate 200ms check」
- **假设：** `pageshow` 只在 bfcache（`e.persisted`）触发，Turbo 回退不是 bfcache → 测试：`tests/contentScript/pageTranslator.navRestore.integration.test.js`「T5: pageshow（bfcache 恢复，persisted=true）」
- **假设：** MutationObserver 挂载点必须用 `getObserverRoot()`（`src/lib/dom.js`），禁止 `document.body` → 测试：`tests/scripts/checkObserverMount.test.js`（lint 自测 5 个）+ `scripts/check-observer-mount.js`（CI 强制）
- **假设：** Turbo Drive 快照缓存是 `cloneNode(true)`（**不克隆 shadow root**）且 restore 恢复（back/forward 到可缓存页）渲染快照**不发请求**（`turbo-cache-control: no-preview` 可缓存、`no-cache` 不可缓存；2026-09-14 github.com 实测 + @hotwired/turbo@8 源码 `PageSnapshot.clone()`）→ **重建检查必须把"无 shadowRoot 的 host"当作缺失**（`hasFunctionalHost()`），否则快照渲染后的空壳 host 永久存活、按钮消失（第 8 次事故）→ 测试：`tests/contentScript/floatingBtn.behavior.test.js`「turbo snapshot shell」4 个 + `tests/contentScript/singletonBtnGroup.test.js`「快照残留的 shadow-less shell host 在重建时被清除」+ E2E `tests/browser-e2e/navigation-recovery.mjs` Scene 6（两页翻译 + 快速往返）
- **假设：** 模块加载期调度的一次性定时器（如 pageTranslator 主框架分支的 120ms 可见性检查）**不可取消**，可能在 DOM 上下文拆除后触发（vitest 环境拆除 / 页面卸载）→ 回调必须带 teardown 守卫（`typeof document === "undefined"` → no-op），否则裸 `document` 访问抛 ReferenceError，在 zero-tolerance CI 上表现为「全部测试通过但 1 unhandled error → exit 1」（2026-09-15 PR #46 CI 实锤：run `34965080915`——navRestore 测试每测 `resetModules()` + 重复 `import`，每个模块实例都调度一个新定时器，文件结束后最后一个在 jsdom 拆除后触发）→ 测试：`tests/contentScript/pageTranslator.navRestore.integration.test.js`「T9: 模块加载期 120ms 定时器在环境拆除后触发不得抛 ReferenceError」
- **假设：** 持久 host 组件的「应否存在」不能靠隐式事实源推断（旧：`divElement === null` / `_singleton.host === null` / 死变量 `singletonInitialized`）——主动隐藏与被动移除在闭包守卫下同形，eager 重建无法区分二者；必须升级为显式的 `enabled` 标志 + 每宿主一个注册句柄（C1/M5，`hostLifecycle.js`）→ 测试：`tests/contentScript/hostLifecycle.test.js`（①注册默认 disabled ②disable 清全部副本 ⑤disabled 拦阻三种 eager 触发 ⑧第三宿主一行注册验收）
- **假设：** Turbo 快照 `cloneNode(true)` 复制 DOM 属性（`data-dualtran-block`、googleSpan/aiSpan class）但**不复制 WeakMap 块状态** → 悬停委派命中克隆块时 `getBlockState()` 返回 undefined；显示层守卫必须用 **WeakMap 身份判定**（`blockStateMap.get(el)`），禁止属性判定（#65）→ 测试：`tests/contentScript/singletonBtnGroup.test.js`「未注册块悬停 — fail-safe 守卫 (#65)」5 格（①快照克隆块真 `cloneNode(true)` 悬停不创建 host ②裸未注册块 ③幽灵组防护 ④touchstart 入口 ⑤已注册块回归对照）

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

### English first
It's a github project, always use English for code comments and git messages.