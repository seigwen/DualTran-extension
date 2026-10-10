## Summary

<!-- Brief description of what this PR does and why -->

## Related Issues

<!-- Link related issues: Fixes #123, Closes #456 -->

## Changes

<!-- List the changes made in this PR -->
- [ ] ...

## State/Lifecycle Impact (required)

- [ ] Does this change touch UI state (highlight/displayMode/intervention/inFlight)?
      → If yes: who is the source of truth? Are cross-rebuild tests in place? Are consistency assertions added?
- [ ] Does it involve state across SPA navigation / rebuilds?
      → If yes: how is it restored? (Must be derived from `getState()` — hardcoding is prohibited)
- [ ] Does it affect the state-machine legality table?
      → If yes: are the legal/illegal transitions updated? (Illegal transitions must throw during development/testing)

## i18n Impact (required — spec 47 RULE 19)

- [ ] No user-visible strings added/changed, **or** new strings went through `_locales`: key in en (+`description`), `npm run i18n:sync`, zh_CN/zh_TW hand-translated
- [ ] Write sites use a registered wrapper (`getMessageWithFallback` / `i18nOrDefault`) — no hand-rolled env guards
- [ ] If one of the five sentinel surfaces changed (options / popup / floating group / hover box / selection panel): local sentinel run green after `npm run build` (`--scenario=i18n-sentinel`)
- [ ] New exemptions/allowlist entries carry a reason — `data` / `platform` only; `legacy` count stays 0

## Testing

- [ ] Unit tests added/updated (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Manual testing performed (describe below)
- [ ] **User-reported scenarios are converted into permanent regression tests (reference the scenario file)** — fill in N/A when there is no user report

### Manual Testing Steps

<!-- Describe how you tested this change -->
1. ...
2. ...

## Screenshots (if UI change)

<!-- Before/After screenshots -->

## Checklist

- [ ] Code follows existing style
- [ ] Comments are in English (for new/modified code)
- [ ] No hardcoded Chinese strings (use i18n via `_locales/`)
- [ ] No new console errors
- [ ] CHANGELOG.md updated (if applicable)
