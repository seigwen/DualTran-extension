# Edge Add-ons listing draft — DualTran (Partner Center)

Status: draft. Submit at https://partner.microsoft.com/dashboard/microsoftedge
(upload `DualTran-vX.Y.Z.zip` from the GitHub release — the Chromium package).

## Fields

- **Name (suggested):** `DualTran: Dual-Language & AI Translator` (40 chars)
- **Short description (<=132 chars):**
  `Translate pages with Google or your own AI model and read the translation side by side with the original.`
- **Category:** Productivity
- **Search terms (suggested):** translate, translation, bilingual, ai translator, page translator
- **Homepage:** https://github.com/seigwen/DualTran-extension
- **Support email:** seigwen@gmail.com
- **Privacy policy URL:** https://github.com/seigwen/DualTran-extension/blob/master/docs/store/privacy.md

## Detailed description

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

## Permission justifications (for the review form)

| Permission | Justification |
|---|---|
| `storage` | Store user settings and translation preferences locally. |
| `activeTab` | Translate the active tab when the user explicitly triggers it (button / shortcut / menu). |
| `contextMenus` | Right-click entries "translate this page / this selection". |
| `webRequest` | Read the document MIME type (onHeadersReceived) to skip non-HTML documents. |
| `alarms` | Schedule auto-translation shortly after page load. |
| `offscreen` | Play text-to-speech audio for translations (offscreen document). |
| `declarativeNetRequest` | Adjust request headers for translation-provider compatibility. |
| `host_permissions` | NOT a broad allowlist: explicit per-provider hosts only (translate.googleapis.com, api.openai.com, api.anthropic.com, ...). Requests go exclusively to the translation service the user selected. |

(Verify the final list against the packaged `manifest.json` at submission time.)

## Notes for certification

- No sign-in, no account, no remote code. All JS is bundled in the package.
- Default engine needs network access to `translate.googleapis.com`; AI engines
  need a user-supplied provider key (skippable for review).
- Test flow: open a foreign-language page (e.g. Spanish Wikipedia) → click the
  floating button (bottom-right) or press Alt+T → translated text appears below
  each original block in a second color; the page title is translated too.
- The extension is also published on the Chrome Web Store; identical package.
