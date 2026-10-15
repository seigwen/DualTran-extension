# Opera Add-ons listing draft — DualTran (addons.opera.com)

Status: draft. Submit at https://addons.opera.com/developer/ (upload the
Chromium package `DualTran-vX.Y.Z.zip` from the GitHub release).

## Submission decisions (make explicitly — do not keep defaults)

- **License: select MPL-2.0** (Opera's default submission license is
  CC-BY-NC-ND; DualTran is MPL-2.0 and the package ships LICENSE).
- **Source readability:** answer honestly — the package is minified webpack
  output. Point reviewers at the public repository and the release-source zip
  (`DualTran-firefox-vX.Y.Z-src.zip` contains `BUILD-src.md`; the same
  instructions build the Chromium package with `npm run build` instead of
  `npm run build:firefox`).

## Fields

- **Name (suggested):** `DualTran: Dual-Language & AI Translator`
- **Category:** Productivity *(switch to a "Translation" category if the
  dashboard offers one)*
- **Summary (short, <=~132 chars):**
  `Read pages in two languages: Google or your own AI model (BYOK), translation shown next to the original text.`
- **Homepage:** https://github.com/seigwen/DualTran-extension
- **Support email:** seigwen@gmail.com
- **Privacy policy URL:** https://github.com/seigwen/DualTran-extension/blob/master/docs/store/privacy.md

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

## Reviewer notes

- Same package as the Chrome Web Store build; needs network access to the
  translation provider only while translating.
- Test flow: Spanish Wikipedia -> floating button (bottom-right) or Alt+T ->
  translated text below each original block in a second color.
