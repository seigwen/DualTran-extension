# DualTran — Privacy Policy

_Last updated: 2026-10-15_

DualTran is a browser extension that translates web pages. This policy
describes exactly what leaves your device and when.

## What the developer collects

**Nothing.** There is no analytics, no telemetry, no crash reporting, and no
account system. The developer has no server that receives your data.

## What leaves your device, and when

- **Page text / selected text is sent to the translation service you selected,
  only when you trigger a translation.** By default that service is Google
  Translate (`translate.googleapis.com`). If you configure an AI provider
  (OpenAI, Anthropic, and 20+ others), the text is sent directly from your
  browser to that provider's API using your own API key.
- Your API keys are stored locally in your browser's extension storage and are
  sent only to the provider they belong to.
- The extension makes no other network requests beyond: the translation
  provider calls above, and (once per install/update) reading its bundled
  resources. No background beacon, no usage reporting.

## What is stored on your device

Settings, translation preferences, cached translations (if enabled), and API
keys — all in browser extension storage on your machine. Uninstalling the
extension removes them.

## Data shared with third parties

Only the text you choose to translate, only with the translation provider you
chose, at the moment you translate. The provider's own privacy policy applies
to that text.

## Contact

seigwen — seigwen@gmail.com — https://github.com/seigwen/DualTran-extension/issues
