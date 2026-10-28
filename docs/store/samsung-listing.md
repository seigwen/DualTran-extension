# Samsung Internet（Galaxy Store）上架包

> 目标：把 DualTran 提交到 Samsung Internet 的扩展商店。Samsung Internet 是三星手机默认浏览器，扩展商店在 Galaxy Store 内。
> 状态：**待账号**（需 Samsung Seller 账号，实名）。材料已备齐，账号就绪后 1 小时可提交。

## 1. 与 Chrome 包的差异

- 包格式：**同一个 `dist/chrome` 打包的 zip**（Samsung Internet 基于 Chromium，兼容大部分 `chrome.*` API）。
- 需要改的：`manifest.json` 的 `minimum_chrome_version` 可保留；`background.service_worker` 需确认 Samsung 版本支持（Samsung Internet 21+ 支持 MV3 service worker）。
- **不需要**重新打包 Firefox 版。

## 2. 账号与入口

1. 注册 Samsung Seller 账号：<https://seller.samsungapps.com/>（个人开发者需身份证/护照，企业需营业执照）。
2. 登录后 → **Add New Application** → 选择 **Samsung Internet Extension**（不是 Android App）。
3. 上传 zip、填 listing、提交审核。

> 注意：Galaxy Store 的审核会检查「移动端可用性」——桌面版 UI 直接搬过去容易被拒。提交前请确认：
> - 悬浮按钮在窄屏不遮挡正文
> - 选项页在手机上可滚动、可点击
> - 不依赖 hover

## 3. Listing 文案（英文，Galaxy Store 以英文为主）

**App name**（≤50 字符）：
```
DualTran — Bilingual Translator
```

**Short description**（≤80 字符）：
```
Keep the original text and read the translation underneath it.
```

**Full description**：
```
DualTran translates a web page without replacing what you are reading. Every paragraph keeps
its original text, and the translation appears directly underneath — so you can check a
negation, a term or a condition against the source at any time.

• Google Translate works out of the box, no account and no configuration
• Bring your own key for 20+ AI providers (OpenAI, Anthropic, Gemini, DeepSeek, Qwen,
  Moonshot, OpenRouter, local Ollama)
• Run Google and an AI model at the same time and compare paragraph by paragraph
• Skips code blocks, formulas and navigation
• 38 interface languages
• Open source (MPL-2.0), no telemetry, no relay server

Best for reading documentation, papers, contracts and GitHub issues on a phone.
```

**Category**：Productivity / Tools
**Privacy policy**：https://github.com/seigwen/DualTran-extension/blob/master/docs/store/privacy.md

## 4. 素材

| 素材 | 规格 | 来源 |
|---|---|---|
| 应用图标 | 512×512 PNG | 从 `src/icons/icon-256.png` 放大或用矢量重出 |
| 截图 | 手机竖屏 1080×1920 ×3 | ✅ `docs/assets/store/mobile/`（真机同款构建，手机视口实拍） |
| 宣传图 | 1024×500（可选） | 可用 `promo-440x280.jpg` 重排 |

**截图已补齐**：`docs/assets/store/mobile/{m1-bilingual,m2-settings,m3-ai}.png`，1080×1920，由真实构建在手机视口截取，非合成图。

## 5. 提交前检查清单

- [ ] Samsung Seller 账号已实名
- [ ] zip 能在 Samsung Internet 上安装并翻译（真机验证）
- [x] 手机竖屏截图 3 张（已生成）
- [ ] 隐私政策 URL 可访问（已验证 200）
- [ ] 审核备注写明：无需账号、无远程代码、AI 需用户自带 Key

## 6. 审核备注模板

```
This is a translation extension. All scripts ship inside the package; no remote code is
loaded. Google Translate works without any configuration. AI providers are optional and
require the user's own API key. No account, no analytics, no server of ours.
```
