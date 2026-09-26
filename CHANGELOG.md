# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **x.com "Show more" revealed text was never translated** (#98): the dynamic-content MutationObserver classified every `characterData` mutation as "the extension writing its own translation result" and skipped it unconditionally (the #16 feedback-loop guard). But React/site code rewrites existing text nodes in place too (`nodeValue` assignment → characterData; x.com's "Show more" expands a truncated post this way), so the expanded text never re-entered the translation pipeline — the translation stayed frozen at the truncated preview length. Fix: classify characterData mutations **by value** instead of blanket-skipping — a text node whose current data equals the value the extension last wrote (`extensionTextWrites.markTextWrite`) is a self-write and is skipped; anything else is a host update, is queued, and re-queues the piece that references the node (`isTranslated=false`) so the next tick re-reads the expanded text and re-translates it. Two supporting fixes: the same blanket skip also swallowed site updates inside `.dualtran-result-container` in replaceOriginal mode (that class sits on the SOURCE container) — the filter now excludes only marked DualTran-generated nodes (`isDualTranGeneratedNode`, extended with the block indicator), and a freshness guard drops translation responses whose source text changed while the request was in flight (bounded by `STALE_DROP_LIMIT`, so a node whose text outruns the request round-trip cannot spin the loop). newLine re-translation now REUSES the existing google/ai spans instead of appending a second pair. Test anchors: `tests/contentScript/mutationObserver.characterData.test.js` (8 cells: host-update detection, self-write skip, value-comparison semantics, `<translated>` guard, no-op rewrite, re-translation request payload, re-scan of unreferenced nodes, notranslate opt-out — RED-verified 4/4 positive cells under the old blanket skip) + E2E `dynamic-content-showmore.mjs` Scenario B (in-place characterData update; pre-fix RED: "translation stayed at max 75 chars while the source container grew to 517"). Real-site verified on x.com (clicked a truncated long post with a client-hints-spoofed browser; expanded text translated on the fixed build). Feedback-loop guard re-verified: `observer-feedback-loop.mjs` all 4 soak combinations stable.
- **Module-load visibility-timer callback no longer leaks failures** (#96): the 120ms module-load timer's callback chain (tab-visibility check → `detectTabLanguage` → auto-translate decision) is now contained — a failure on any step is warned (`console.warn`) and skipped, never thrown. This is a best-effort check (the user can always translate manually), and an escaped error could previously be reported as an unhandled error that failed the zero-tolerance test job even when every test passed (master `34f0e01`). Auto-translate behavior on healthy environments is unchanged; the #47 teardown guard is preserved. Test anchor: `tests/contentScript/pageTranslatorHelpers.test.js`「T10」.
- **Block-level AI loading indicator flashed for ~45ms and was effectively invisible** (#90): clicking the page-level "AI" button showed no purple spinner on the paragraphs, while clicking "Google" showed the green one. The spinner WAS inserted, then removed again 42ms later — before any AI text arrived (measured: add t=6ms, remove t=48ms, first arrival t=2068ms). Root cause: `aiTranslateDynamically` cleared the indicators right after `await aiTranslateText(...)`, but `aiTranslateText` returns at DISPATCH time (the stream arrives via callbacks) — unlike the Google path, whose `backgroundTranslateHTML(...)` is a real promise that resolves on arrival. Fix: `aiTranslateText` gains an optional per-block settle callback (`onBlockSettled`), and the indicator cleanup is bound to each block's terminal state (translated / error / discarded), with a 180s guard for silently dead streams. The error tooltip now also carries the REAL error message (`proxy._st().errorMessage`; the previous `proxy._lastErrorMessage` never existed and always fell back to a generic string). Anchors: the AI spinner now lands inline at the end of the text being read (newLine: before the `<translated>` container, i.e. tailing the source text like Google's; replaceOriginal: appended inside the block), instead of on a standalone line below the block. RED evidence: `tests/contentScript/aiBlockIndicator.integration.test.js` (5 cells, all red pre-fix) + E2E `ai-block-indicator.mjs` (both display modes; pre-fix build failed with "19 AI spinner(s) removed BEFORE their block's text arrived").
- **Gemini (and any aliased provider ID) silently fell back to the OpenAI-compatible client** (#88): `createModelClient` looked up models.dev provider data with DualTran's internal ID (`google-gemini`), but models.dev keys the entry `google` — the dedicated `@ai-sdk/google` client was never selected, so requests went to a `/chat/completions` URL against the native `generateContent` API. Surfaced by the hardened multi-provider E2E (was silently skipped before). Fix: single source of truth `INTERNAL_TO_MODELSDEV` + `resolveModelsDevId()` in `providerRegistry.js`, consumed by `aiProxy.js`, `sseClient.js` (fallback fetch) and `providerModelPreview.js`. RED tests: `tests/ai/createModelClient.test.js` C5.1–C5.3.
- Mock server Gemini fidelity (#88): `:streamGenerateContent` now answers with SSE frames (was plain JSON — the SDK's SSE parser produced zero chunks), and tag extraction is format-aware (`contents[].parts[].text`, not only `messages[].content`).

### Added
- Test-system hardening from the #85 escape analysis (issue #88): a **platform-shape probe lint** (`scripts/check-platform-probes.js`) requires every environment probe in `src/` to enumerate its shapes with a test reference; a **skip-typing rule** in `check-assertion-strength.js` forbids untyped E2E skip branches (`SKIP-ENV: <objective premise>` / `SKIP-DATA:` or hard failure) and the E2E orchestrator now prints a typed-skip summary; a **set-completeness oracle** (`assertAllHaveNonEmptyText` / `assertSelectOptionsComplete`) asserts "every item has a non-empty label" for list-like UI; three new visual checkpoints (`options-hotkeys`, `options-sites`, `options-style`); and destructive paths (reset-to-defaults, config export/import) are now exercised through real clicks in isolated extension contexts. Test-only change — no user-facing behavior change.
- Initial open-source release

### Changed
- **Default translation colors now match the floating button palette** (#94): the factory defaults behind the options-page "Google translation color" (`translatedColor`) and "AI translation color" (`aiTranslatedColor`) change from green `rgba(11, 112, 33, 1)` to Google-blue `#1d4ed8`, and from bright-blue `#2041FF` to AI-purple `#7c3aed`. A translated paragraph now renders in the same color as the button that produced it, on every fresh install. Already-picked colors are kept (stored values override the default — no migration); the reset buttons keep their semantics (clear the color → render in the page's original color). Test anchors: `tests/lib/config.test.js` locks the defaults to the palette values (plus a no-migration cell); E2E `translation.mjs` asserts the rendered Google/AI translation color equals the live floating-button color (translation color ≡ button color, drift on either side fails); E2E `translation-replace-original.mjs` replaces its hardcoded old-default-green negative check with a value-independent sentinel check (the old form would silently go blind after this change) and now exercises the negative rule with `showOriginalTextWhenHovering` enabled — the only DOM path (`encapsulateTextNode`'s `<font>`) where the in-place Google translation can actually be painted.

### Fixed
- Options page → Hotkeys: the first row of the "Keyboard shortcuts" list no longer renders an empty label. The browser's reserved action command (`_execute_action`, reported by `chrome.commands.getAll()` with an empty description) now gets a localized fallback label (`lblActivateTheExtension`, "Activate the extension" / "激活扩展程序") — previously only the legacy MV2 name `_execute_browser_action` was covered (#85).
- Extension-wide: platform detection no longer treats the existence of the `browser` namespace as "this is Firefox". Since Chrome 148, Chrome exposes extension APIs under `browser` as an alias of `chrome` (without `commands.update`), which made the options page take the Firefox branch on Chromium — showing the in-page shortcut list (and hiding the working "Open native shortcut key manager" button), and made `twpConfig.import` / `twpConfig.restoreToDefault` throw `TypeError: browser.commands.update is not a function` (config import aborted before reload and misreported "file is corrupted"; "Restore default settings" silently did nothing). Detection now probes the `commands.update` capability, so Chrome ≤147 / Chrome 148+ / Firefox all behave correctly (#85).
- Hover AI button: the green ✓ success glyph next to the "AI" label is gone (#83). The success state is still carried by the `dualtran-ai-success` class and the button's active highlight — the label now stays a plain "AI" with no trailing decoration, on both the per-block hover group and the selected-text panel. The error ✕ is unchanged.
- Floating button group: the viewport clamp and the drag clamp now budget the FULL layer box (panel + the 38px options shortcut strip) instead of the panel alone — the bottom row (AI button) could previously be placed up to 38px past the viewport's bottom edge (#80; pre-existing since before v2.1.30).
- Floating button group: a saved position that is off-screen for the current viewport (e.g. saved on a wider window, or on another display) is now clamped into view at load. The restore path read `BUTTON_STYLES` before its initialization, the exception was swallowed by the restore try/catch, and the viewport clamp right after it never ran — the button group stayed invisible until any resize (#78).
- Floating button group: the visibility clamp now runs as an independent step, so a restore failure can never again skip it (the clamp is the guarantee that the group is visible).
- Hover AI button: clicking "AI" on a block no longer stays on the Google translation when the page-level mode was set to Google earlier. A page-level switch away now only suppresses in-flight AI arrivals (Q22/Q23 preserved); a stale flag no longer vetoes block-scope direct requests (#70).

## [2.1.30] - 2026-08-06

### Added
- AI-powered translation with 20+ provider support
- Generic AI settings panel for all providers
- Provider model preview with models.dev integration
- Smart default model selection
- Cross-tab input synchronization

### Changed
- Unified AI provider configuration system
- Improved provider migration from legacy config

### Fixed
- Various bug fixes and improvements

## [1.0.0] - 2024-01-01

### Added
- Google Translate integration
- Dual text display (original + translated)
- Selected text translation popup
- Keyboard shortcuts
- Multi-language support (100+ languages)
- Customizable translation display options

---

## Release Notes

### Version 2.1.30
- Major AI translation improvements
- Added support for Chinese AI providers (DeepSeek, Zhipu, Moonshot, Qwen, Baidu, ByteDance, iFlytek)
- Unified provider settings with dynamic model loading

### Version 1.0.0
- Initial release based on Traduzir-paginas-web
- Core translation functionality
- Google Translate support
