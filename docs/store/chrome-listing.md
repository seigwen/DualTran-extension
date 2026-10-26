# Chrome Web Store 上架材料（2.2.4）

> 用途：登录开发者后台后，把这几个字段逐项粘贴即可。截图在 `docs/assets/store/`。
> 注意：Chrome 商店一个条目只有一套截图，文案按语言分。截图不要加中文字幕（英文用户也看）。

## 基本信息

| 字段 | 值 |
|---|---|
| 名称（zh） | `DualTran 双语对照翻译` |
| 名称（en） | `DualTran — Bilingual Translator` |
| 类别 | Productivity（生产力工具） |
| 语言 | 中文（简体）、English |
| 官网 | https://seigwen.github.io/DualTran-extension/ |
| 支持邮箱 | seigwen@gmail.com |
| 隐私政策 | https://github.com/seigwen/DualTran-extension/blob/master/docs/store/privacy.md |

## 简短说明（≤132 字符）

**zh**：
```
译文放在原文下面，读英文网页不丢原句。Google 免配置，也能接 20+ 家 AI（自带 Key）。
```

**en**：
```
Side-by-side translation: keep the original, read the Chinese underneath. Free with Google, BYOK for 20+ AI models.
```

## 详细说明（zh，约 700 字）

```
DualTran 是「双语对照」翻译：原文一直在页面上，译文放在每一段下面，而不是把原文替换掉。

为什么是「对照」
读论文、SDK 文档、GitHub issue 时，机翻一旦漏掉一个 not、翻错一个术语，替换式翻译会让你连原句都看不见。对照阅读让你随时抬头看原句、低头看译文。

两种引擎可以同时开
· Google 翻译：快、稳，装完就能用，不需要任何配置
· AI 翻译：质量更高，支持 OpenAI、Anthropic、Gemini、DeepSeek、月之暗面、智谱、通义千问、Groq、OpenRouter、Ollama 等 20+ 家
· 两者可以并排显示，逐段比对，选你信得过的那个

主要功能
· 整页翻译 / 划词翻译
· 只处理正文，跳过代码块、公式与导航
· 38 种界面语言
· 快捷键、悬浮按钮、按站点自动翻译
· 翻译缓存，重复内容不重复请求

隐私
· 无需账号、无统计、无中转服务器
· 使用 AI 时，密钥只保存在本机浏览器
· 文本只发送给你选择的翻译服务（Google 或你自己的 AI 服务商）

开源
DualTran 基于 MPL-2.0 开源：https://github.com/seigwen/DualTran-extension

适合：读英文文档、论文、GitHub issue、Reddit 与 X 的帖子，需要中英对照时尤其好用。
```

## 详细说明（en，约 500 词）

```
DualTran keeps the original text on the page and puts the translation underneath each paragraph, instead of replacing what you are reading.

Why side-by-side
Machine translation drops negations and mistranslates terminology often enough that losing the source is a real cost. With DualTran the source stays exactly where it was.

Two engines, together
· Google Translate — fast, reliable, works out of the box with no configuration
· AI translation — higher quality, with your own key for OpenAI, Anthropic, Gemini, DeepSeek, Moonshot, Zhipu, Qwen, Groq, OpenRouter, Ollama and 20+ more
· Run both at once and compare paragraph by paragraph

Features
· Full-page and selection translation
· Skips code blocks, formulas and navigation so the layout stays intact
· 38 interface languages
· Keyboard shortcuts, floating button, per-site auto-translate
· Translation cache

Privacy
· No account, no analytics, no relay server
· API keys stay in your browser
· Text goes only to the service you choose

Open source (MPL-2.0): https://github.com/seigwen/DualTran-extension
```

## 截图（1280×800，按顺序上传）

| 序号 | 文件 | 说明 |
|---|---|---|
| 1 | `docs/assets/store/1-bilingual.png` | 英文文章 + 逐段中文，悬浮按钮在右侧 |
| 2 | `docs/assets/store/2-ai-settings.png` | AI 服务商选择与 Endpoint 设置 |
| 3 | `docs/assets/store/3-settings.png` | 翻译设置（目标语言、显示方式） |

## 权限说明（后台会逐项问用途）

| 权限 | 填写内容 |
|---|---|
| `storage` | 保存用户的翻译设置、目标语言与 AI 服务商配置（仅本机）。 |
| `activeTab` | 用户点击扩展按钮时，翻译当前标签页。 |
| `contextMenus` | 在右键菜单提供「翻译选中文本」。 |
| `webRequest` | 读取翻译请求的响应，用于流式显示 AI 译文。 |
| `alarms` | 定时任务（缓存清理、模型列表刷新）。 |
| `offscreen` | 在后台运行翻译用的音频/文本处理（不访问页面内容）。 |
| `declarativeNetRequest` | 为 Microsoft 翻译接口设置请求头（该接口要求特定 User-Agent）。 |
| `webNavigation`（可选） | 仅在用户开启「点击链接自动翻译」时申请。 |
| 主机权限（固定清单） | 仅访问清单内的翻译服务域名（Google、DeepL、OpenAI、Anthropic、DeepSeek 等）。 |
| 可选主机权限 `http(s)://*/*` | 仅当用户填写自定义 AI Endpoint 时申请该域名，用于 BYOK。 |

## 审核备注（Reviewer notes，可留空）

```
This extension translates pages in place. No remote code is loaded: all scripts ship in the
package. AI providers are optional and user-supplied; without a key the extension uses Google
Translate only. The optional host permission is requested only when the user saves a custom
API endpoint.
```
