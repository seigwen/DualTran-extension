## Summary

<!-- Brief description of what this PR does and why -->

## Related Issues

<!-- Link related issues: Fixes #123, Closes #456 -->

## Changes

<!-- List the changes made in this PR -->
- [ ] ...

## State/Lifecycle Impact（状态/生命周期影响——必填）

- [ ] 本次改动是否涉及 UI 状态（highlight/displayMode/intervention/inFlight）？
      → 若是：事实源是谁？跨重建测试做了吗？一致性断言加了吗？
- [ ] 是否涉及跨 SPA 导航/重建的状态？
      → 若是：重建后如何恢复？（必须从 `getState()` 派生，禁止硬编码）
- [ ] 状态机合法性表是否受影响？
      → 若是：合法/非法转换更新了吗？（非法转换必须在开发/测试期报错）

## Testing

- [ ] Unit tests added/updated (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Manual testing performed (describe below)

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
