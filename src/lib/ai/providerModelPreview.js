/**
 * Shim (plan 59): the canonical implementation moved to
 * src/core/providers/modelPreview.js.
 *
 * This file is not a bare re-export: it owns the only host-specific piece —
 * the chrome.storage.local adapter injected into the core function. All cache
 * logic and the three-tier fallback live in the core module; the adapter below
 * is the extension-host glue (the same split Node/other hosts reuse).
 *
 * The path is kept stable on purpose — options.js, aiModelRefresh.js, tests
 * and vi.mock() module-path interception all depend on it.
 */
import {
  loadPreviewModels as loadPreviewModelsCore,
} from "../../core/providers/modelPreview.js";

export {
  getSmartDefaultModel,
  getPreviewProviders,
} from "../../core/providers/modelPreview.js";

/** chrome.storage.local adapter (extension host). */
const chromeStorageAdapter = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};

export async function loadPreviewModels({ provider, fetcher = globalThis.fetch, storage = null } = {}) {
  return loadPreviewModelsCore({
    provider,
    fetcher,
    storage: storage ?? chromeStorageAdapter,
  });
}
