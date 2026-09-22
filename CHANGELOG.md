# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial open-source release

### Fixed
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
