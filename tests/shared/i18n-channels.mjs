/**
 * i18n enforcement-channel SSOT (spec 47 §2.4, issue #157).
 *
 * Every mechanism that guarantees user-visible strings flow through
 * `src/_locales/` is registered here exactly once:
 *
 *   l1-write-sites        static write-site lint (hardcoded literals at JS writes)
 *   l3-sentinel           runtime completeness under a sentinel locale (5 surfaces)
 *   static-completeness   locale ⊇ en parity + full placeholder integrity
 *   description-freeze    new en keys must carry a translator description
 *   sync-pipeline         en→locales sync + dry check (missing/extra keys)
 *   manifest-msg          manifest localizable fields resolve through __MSG_
 *
 * The channels meta-lint (`scripts/check-i18n-channels.js`, the 17th
 * architecture lint) three-way checks each entry: the guard script exists, its
 * test anchor exists and contains the marker, and every declared wiring entry
 * actually mentions the right needle in the right file. The L1 guard and the
 * sentinel scenario additionally import this table for their own cheap
 * self-consistency reads — a channel cannot quietly disappear from the docs,
 * the tests, or the gate without one of the three surfaces noticing.
 *
 * `kind`: `hard` = violations fail PR/CI; `pipeline` = operates on the data,
 * failures surface through its wiring entry.
 *
 * @module i18n-channels
 */

export const I18N_CHANNELS = [
  {
    id: "l1-write-sites",
    name: "L1 write-site lint (hardcoded user-visible literals)",
    kind: "hard",
    guard: { script: "scripts/check-i18n-writes.js" },
    testAnchor: { file: "tests/static/i18nWrites.test.js", marker: "i18n write-site" },
    wiring: [
      { file: "scripts/pre-push-verify.sh", needle: "check-i18n-writes.js" },
      { file: ".github/workflows/ci.yml", needle: "check-i18n-writes.js" },
    ],
  },
  {
    id: "l3-sentinel",
    name: "L3 sentinel scenario (runtime completeness under a sentinel locale)",
    kind: "hard",
    guard: { script: "tests/browser-e2e/i18n-sentinel.mjs" },
    testAnchor: { file: "tests/shared/i18nSentinelRules.test.js", marker: "sentinel" },
    wiring: [
      { file: "tests/browser-e2e/run-all.mjs", needle: "i18n-sentinel.mjs" },
      { file: ".github/workflows/ci.yml", needle: "run-all.mjs" },
    ],
  },
  {
    id: "static-completeness",
    name: "static completeness (locale ⊇ en + placeholder integrity)",
    kind: "hard",
    guard: { script: "tests/static/i18nCompleteness.test.js" },
    testAnchor: { file: "tests/static/i18nCompleteness.test.js", marker: "placeholder integrity" },
    wiring: [
      { file: "scripts/pre-push-verify.sh", needle: "npm test" },
      { file: ".github/workflows/ci.yml", needle: "npm test" },
    ],
  },
  {
    id: "description-freeze",
    name: "description freeze (new en keys must carry a translator description)",
    kind: "hard",
    guard: { script: "tests/static/i18nDescriptions.test.js" },
    testAnchor: { file: "tests/static/i18nDescriptions.test.js", marker: "shrink-only" },
    wiring: [
      { file: "scripts/pre-push-verify.sh", needle: "npm test" },
      { file: ".github/workflows/ci.yml", needle: "npm test" },
    ],
  },
  {
    id: "sync-pipeline",
    name: "en→locales sync pipeline + dry check",
    kind: "pipeline",
    guard: { script: "scripts/sync-locales.js" },
    testAnchor: { file: "tests/static/i18nCompleteness.test.js", marker: "locale ⊇ en" },
    wiring: [
      { file: "package.json", needle: "i18n:check" },
      { file: "scripts/pre-push-verify.sh", needle: "i18n:check" },
      { file: ".github/workflows/ci.yml", needle: "i18n:check" },
    ],
  },
  {
    id: "manifest-msg",
    name: "manifest __MSG_ localization (description + command labels)",
    kind: "hard",
    guard: { script: "src/manifest.json" },
    testAnchor: { file: "tests/manifest/manifestValidation.test.js", marker: "__MSG_extensionDescription__" },
    wiring: [
      { file: "scripts/pre-push-verify.sh", needle: "npm test" },
      { file: ".github/workflows/ci.yml", needle: "npm test" },
    ],
  },
];
