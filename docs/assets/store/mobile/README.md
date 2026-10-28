# Mobile screenshots (1080×1920)

Captured from the real Chrome build at a phone viewport (1080×1920, DPR 1) through
`tests/conformance/runners/chromium.mjs` — not mockups.

| File | What it shows |
|---|---|
| `m1-bilingual.png` | An English article translated with Google: each paragraph keeps its source line and adds the Chinese underneath; the floating panel sits at the right edge |
| `m2-settings.png` | Languages tab at phone width (no horizontal overflow: scrollWidth == clientWidth) |
| `m3-ai.png` | AI tab: provider, key, endpoint, model |

Notes for store submissions that want phone-shaped assets (Galaxy Store, Play-style listings):
the options page keeps its desktop two-column layout at this width, so text is small but
legible and nothing is clipped. The floating panel is fully inside the viewport.
