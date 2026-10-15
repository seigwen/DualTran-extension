# AMO listing draft — DualTran (addons.mozilla.org)

Status: draft. Submit at https://addons.mozilla.org/developers/ :
upload `DualTran-firefox-vX.Y.Z.zip` from the GitHub release, then use
"Submit source code" to attach `DualTran-firefox-vX.Y.Z-src.zip` (contains
`BUILD-src.md` at the archive root).

## Fields

- **Name (suggested):** `DualTran: Dual-Language & AI Translator`
- **Category:** Language Support
- **License:** MPL-2.0 (already shipped as LICENSE in the package)
- **Homepage:** https://github.com/seigwen/DualTran-extension
- **Support email:** seigwen@gmail.com
- **Privacy policy URL:** https://github.com/seigwen/DualTran-extension/blob/master/docs/store/privacy.md
- **Tags (suggested):** translation, translate, language, ai, llm, bilingual

**Summary (<=250 chars):**
```
Translate pages with Google or your own AI model (20+ BYOK providers). DualTran shows the translation next to the original text instead of replacing it, so you can read both side by side. Also translates selected text and popup content.
```

## Description

```
DualTran translates web pages and shows the translation **next to the original text** instead of replacing it - read both languages side by side.

**Two translation engines, your choice:**
- **Google** - fast and reliable, works out of the box, no account needed.
- **AI** - bring your own key (BYOK) for 20+ providers: OpenAI, Anthropic (Claude), Google Gemini, Mistral, Cohere, Groq, DeepSeek, OpenRouter (300+ models), Azure OpenAI, and more - higher-quality, context-aware translation.

**Features**
- One-click page translation (floating button or Alt+T).
- Selected-text translation in a popup (Alt+S); switch service on the fly (Alt+Q).
- Dual display keeps the original text in place; the translation appears in a second color below each block.
- Automatic translation for languages you choose.
- Handles dynamically loaded content (infinite feeds, single-page apps).

**Privacy**
- No analytics, no telemetry - the developer collects nothing.
- Page text is sent only to the translation service you chose, and only when you translate.
- AI requests go directly from your browser to your provider, with your own key.
- All settings stay on your device.

DualTran is based on the excellent Traduzir-paginas-web (TWP) by FilipePS, with significant enhancements for AI-powered translation. Licensed MPL-2.0.

Support: https://github.com/seigwen/DualTran-extension/issues 
```

## Data collection (reviewer questionnaire)

- **websiteContent** — declared as required in the manifest
  (`data_collection_permissions`). Matches actual behavior: page text and
  selected text are sent to the translation provider the user chose, only
  when the user triggers a translation.
- No other categories. No analytics, no telemetry.

## Reviewer notes

- Testing needs network access to `translate.googleapis.com` (default engine;
  no account required). AI translation requires the user's own provider key —
  reviewers can skip the AI paths, the UI stays functional without one.
- Test flow: open a foreign-language page (e.g. `https://es.wikipedia.org/wiki/España`),
  click the floating button at the bottom right (or press `Alt+T`). Translated
  text appears below each original block in a second color.
- Expected behavior: page translation starts only while the tab is visible
  (by design — translation is paused for hidden tabs and resumes when the tab
  becomes visible again).
- Manifest: `strict_min_version` 140.0; `gecko_android.strict_min_version` 142.0;
  gecko id `dualtran@seigwen.dev`. Event page via `background.scripts` (no
  service worker on Firefox).

## Assets checklist (TODO before submit)

- [ ] Icon 128px (from `src/icons/`)
- [ ] 2-4 screenshots 1280x800: dual-span translation on a real page; selection
      popup; options page with AI provider settings (capture on the real
      Firefox build — reuse the smoke fixture for a clean shot)
- [ ] Submit source zip (auto-attached to every GitHub release)
