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
