# PROVENANCE

**Plan 59 · M4-4 provenance record.** This document records which files in this repository derive from **Traduzir-paginas-web** ("TWP", [FilipePS/Traduzir-paginas-web](https://github.com/FilipePS/Traduzir-paginas-web), MPL-2.0) and which are **DualTran-original**, as verified against the upstream repository on **2026-10-14**. Every module moved or extracted into `src/core/` keeps the **MPL-2.0** license (plan 59 decision D2); the classification distinguishes where the obligation comes from and does not change the outbound license.

## Method

Verification performed **2026-10-14 (UTC)** with the `gh` CLI (authenticated as `seigwen`). Commands actually run and their results:

```bash
gh api repos/FilipePS/Traduzir-paginas-web --jq .default_branch
# → master

gh api "repos/FilipePS/Traduzir-paginas-web/git/trees/master?recursive=1" \
  --jq '.tree[].path' > /tmp/twp-tree.txt
# → 200 tree entries, truncated=false (160 under src/)

gh api "repos/FilipePS/Traduzir-paginas-web/commits?path=src/contentScript/fetchSSE.js&per_page=3" \
  --jq '.[].sha'
# → []  (empty array — path never existed in upstream history)

gh api "repos/FilipePS/Traduzir-paginas-web/commits?path=src/background/aiProxy.js&per_page=3" \
  --jq '.[].sha'
# → []  (empty array — path never existed in upstream history)

# Controls — same sampling on known TWP files (proves the sampling method discriminates):
gh api "repos/FilipePS/Traduzir-paginas-web/commits?path=src/contentScript/pageTranslator.js&per_page=3" \
  --jq '.[].sha'
# → 2f81fad0b0…, 664dd1c000…, d7add8ebcc…  (non-empty)
gh api "repos/FilipePS/Traduzir-paginas-web/commits?path=src/background/translationService.js&per_page=3" \
  --jq '.[].sha'
# → 97d378abc2…, 4dc0485ffa…, 71089d4cdb…  (non-empty)

# Local inventory, cross-checked path-by-path against the upstream tree:
git ls-files src/
# → 125 non-locale paths; 41 of them exist in the upstream tree
git log --max-parents=0 --format='%H %s %ci'
# → 91115d444a6d3ea14f121eb9d8ad21a4d67872f1 "feat: initial open-source release", 2026-08-06
```

- Upstream default branch at check time: `master`, HEAD `50a92116542ab93524594cc210f4bf4e5d86a925` (commit date 2026-08-16; root tree `c4b5aca34c48595b32c005fc10550ed8fde8b429`).
- Local repository at write time: branch `plan59-core-extraction`, HEAD `19b6027` ("refactor(core): move provider modules to src/core + shims (plan 59 M1)").
- `LICENSE` at repo root: full **MPL-2.0** text preceded by a DualTran copyright header that credits Traduzir-paginas-web (checked 2026-10-14).
- Classification is **path-based**, per plan 59 §1.3: a file counts as a TWP derivative iff the same path exists in the upstream tree. This is the operative method for the plan 59 file set; no claim is made about files outside it.

## Classification

Scope: the files relevant to the plan 59 core extraction. (Broader context from the same cross-check: of the 125 non-locale local `src/` paths, 41 exist in the upstream tree; the local-only remainder includes DualTran additions beyond this scope.)

### MPL-2.0 derivative (TWP-has) — path present in upstream `master` tree, checked 2026-10-14

| Local path | Upstream | Evidence |
|---|---|---|
| `src/contentScript/pageTranslator.js` | present | tree match; upstream commit history non-empty (latest sampled: `2f81fad0b0`) |
| `src/background/translationService.js` | present | tree match; upstream commit history non-empty (latest sampled: `97d378abc2`) |
| `src/background/translationCache.js` | present | tree match |
| `src/lib/config.js` | present | tree match |
| `src/lib/languages.js` | present | tree match |

These files (and their `src/core/` descendants) carry MPL-2.0 file-level obligations with them.

### DualTran-original (TWP-new) — no upstream path, checked 2026-10-14

| Local path | Upstream | Evidence |
|---|---|---|
| `src/contentScript/fetchSSE.js` | absent | tree: no match; upstream commit-history sample: empty `[]` (never existed) |
| `src/background/aiProxy.js` | absent | tree: no match; upstream commit-history sample: empty `[]` (never existed) |
| `src/background/sw.js` | absent | tree: no match (upstream `src/background/` contains only `background.js`, `textToSpeech.js`, `translationCache.js`, `translationService.js`) |
| `src/background/aiTranslationCache.js` | absent | tree: no match |
| `src/lib/ai/providerRegistry.js` | absent | tree: no match (upstream has no `src/lib/ai/` entries at all) |
| `src/lib/ai/sseClient.js` | absent | tree: no match |
| `src/lib/ai/reasoningDepth.js` | absent | tree: no match |
| `src/lib/ai/providerModelPreview.js` | absent | tree: no match |
| `src/lib/ai/providerTypes.js` | absent | tree: no match |
| `src/lib/ai/providerMigration.js` | absent | tree: no match |

## `src/core/` mapping

**This table describes the final structure of plan 59.** Extraction may not be fully complete at the time of writing; entries are marked with their plan step rather than asserting on-disk presence.

| New core path (plan 59) | Origin | Plan step |
|---|---|---|
| `src/core/providers/registry.js` | moved from `src/lib/ai/providerRegistry.js` | (plan 59 M1) |
| `src/core/providers/types.js` | moved from `src/lib/ai/providerTypes.js` | (plan 59 M1) |
| `src/core/providers/migration.js` | moved from `src/lib/ai/providerMigration.js` | (plan 59 M1) |
| `src/core/providers/modelPreview.js` | moved from `src/lib/ai/providerModelPreview.js` | (plan 59 M1) |
| `src/core/providers/reasoningDepth.js` | moved from `src/lib/ai/reasoningDepth.js` | (plan 59 M1) |
| `src/core/chat/*` (`sdkMap.js`, `modelsDev.js`, `createModelClient.js`, `streamChat.js`) | extracted from `src/background/aiProxy.js` | (plan 59 M2) |
| `src/core/translator/prompts.js` | extracted from `src/contentScript/fetchSSE.js` | (plan 59 M3) |
| `src/core/engines/*` (`utils.js`, `serviceBase.js`, `google.js`) | extracted from `src/background/translationService.js` | (plan 59 M3) |
| `src/core/languages/names.js` | extracted from `src/lib/languages.js` | (plan 59 M3) |
| `src/core/cache/keys.js` | extracted from `src/background/aiTranslationCache.js` | (plan 59 M3) |

## Conclusion

- The core library is offered as a whole under **MPL-2.0** (plan 59 decision D2).
- Both classes of files are licensed MPL-2.0: TWP-derived files carry the license with them, and DualTran licenses the repository overall under MPL-2.0 (see `LICENSE`). The classification therefore does not affect the outbound license.
- Shim files (thin `export *` re-exports left at the original paths) do not change provenance: a shim only forwards the module it points to, so the classification of the target module applies.
- Local git history was squashed at the initial open-source release (commit `91115d4`), so classification relies on the upstream file tree, not local git history.
