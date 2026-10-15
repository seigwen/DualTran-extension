# DualTran — source build instructions (AMO source submission)

DualTran ships bundled/minified JavaScript. This document explains how to
reproduce the submitted `DualTran-firefox-<version>.zip` package from the
source archive that accompanies it, per the addons.mozilla.org "source code
submission" requirements.

## Repository

- Source: https://github.com/seigwen/DualTran-extension
- The archive corresponds to release tag `v<version>`.
- The archive root includes `package-lock.json` (the dependency snapshot used
  for this release build) and this file.

## Build environment

The release package is built by CI with:

- OS: Ubuntu (GitHub Actions `ubuntu-latest`)
- Node.js: 22.x (any Node.js >= 22.13 works; Node.js 24 is also verified)
- npm: 10+

No other system packages are required.

## Reproducing the package

From the root of the extracted source archive:

```
npm ci                 # exact dependency tree from the included package-lock.json
npm run build:firefox  # builds the Firefox package into dist/firefox/
```

`dist/firefox/` is the content of the submitted extension package — zip it
as-is.

Optional sanity check with the same validator addons.mozilla.org uses:

```
npm run lint:firefox   # web-ext lint; must report 0 errors
```

## How the build works

- Bundler: webpack 5 (configs: `webpack.common.js`, `webpack.production.js`).
- Every entry point becomes a single-file IIFE bundle — there is no runtime
  module loading: `background/sw.js` (background event page),
  `contentScript/contentScript.js`, plus static files copied from `src/`
  (icons, locales, popup).
- Minification: terser; the exact version comes from the lockfile.
- The Firefox manifest is GENERATED from `src/manifest.json` by
  `scripts/manifest-variant.js` (target `firefox`): `background.scripts`
  event page, `browser_specific_settings` (id, `strict_min_version 140.0`,
  `gecko_android 142.0`, `data_collection_permissions`), classic content
  scripts. Chromium-only keys are dropped. There is no hand-maintained
  per-target duplicate to drift.
- The extension never fetches or executes remote code. All network traffic is
  plain `fetch` to the translation service the user selected (Google by
  default; user-configured AI providers when the user adds their own key).

## Contact

seigwen — seigwen@gmail.com — https://github.com/seigwen/DualTran-extension/issues
