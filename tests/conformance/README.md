# Conformance matrix (plan 84, P1)

Two engines, one scenario spec. The point is to stop trusting "same code, same behaviour":
Firefox resolves a relative request against the extension origin and answers **200** with a
non-JSON body, Chrome answers 404, and neither is visible to a Node test.

## Run

```bash
npm run build && npm run build:firefox        # both dists must exist
xvfb-run -a node tests/conformance/run.mjs --engine=all
xvfb-run -a node tests/conformance/run.mjs --engine=chromium --scenario=ai-translate
xvfb-run -a node tests/conformance/run.mjs --engine=all --all     # include experimental
```

Chromium runs headed under Xvfb (extensions need a real browser), Firefox runs headed the
same way — headless reports `visibilityState: "hidden"`, and pageTranslator deliberately
skips hidden pages.

## What is covered today

| Scenario | Chromium | Firefox | Locks |
|---|---|---|---|
| `page-translate` | ✅ | ✅ | content script + Google path on both engines |
| `ai-translate` | ✅ | ✅ | full AI path against a tagged SSE mock |
| `ai-endpoint-invalid` | ✅ | ✅ | a schemeless endpoint never produces a request |
| `ai-html-200` (experimental) | — | — | 200 + HTML must not look like success |

Every run writes `DualTran-manage/visual-evidence/conformance/report.json` plus failure
screenshots.

## How Firefox gets an AI provider

A temporary add-on's storage is extension-private and Selenium refuses to script privileged
(`moz-extension://`) pages, so the runner ships a throwaway build with
`manifest.version_name = "conformance"` plus a `conformance.json` overlay. `src/lib/config.js`
applies that overlay only when `version_name === "conformance"`; production builds never set
it and never include the file, so the hook is inert in the store.

This is the same build the matrix runs; nothing is stubbed — the extension really calls the
mock endpoint and really parses its `<译泽>` reply.

## Mock server

`mock-llm.mjs` modes: `sse-ok`, `html-200`, `no-cors`. It echoes `<译泽 id="N">…</译泽>`
tags because that is the protocol DualTran speaks to models; a plain-text reply is rejected
by the extension ("AI response did not contain expected translation tags").
