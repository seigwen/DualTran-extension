This package is used for localization data preparation and syncing. It is NOT bundled into the extension and is NOT loaded at runtime.

### Core Uses:

- Language name fetching and generation
  - `getLanguagesNames.js`: Fetches language names from Google/Yandex and generates data files for localization (output to `extra/out`). Has its own runtime environment; see `package.json`.

- Crowdin export processing
  - `crowdin.js`: Extracts the Crowdin translation package "DualTran (translations).zip", keeps only `messages.json`, normalizes language directory names (hyphens to underscores, e.g., `zh-CN` → `zh_CN`), and outputs to `extra/result` for easy copy/merge into `_locales`.

### Relationship to Main Project:

- These are maintenance/preprocessing scripts for localization resources, decoupled from build output. The build process (handled by `webpack.production.js` etc.) does NOT include this package.
- Output directories like `extra/result` are already in `.gitignore`.

### Usage:

```bash
# Run language name fetching (in the extra sub-project)
cd extra
npm run fetch-languages

# Process Crowdin export package (place zip in extra/ directory first)
npm run crowdin-extract
```

Afterward, you can sync with the main repo's localization scripts:
- Sync keys: `sync-locales.js` (`npm run i18n:sync`)
- Verify differences: `check-i18n-equals-en.js` (`npm run i18n:verify`)
