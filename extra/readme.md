本包用于本地化相关的数据准备与同步，不会被打包进扩展，也不在运行时加载。

### 核心用途：

- 语言名称抓取与生成
  - getLanguagesNames.js：抓取 Google/Yandex 提供的语言及其显示名称，生成用于后续本地化的数据文件（输出到 extra/out）。有独立运行环境，见 package.json。
- Crowdin 导出处理
  - crowdin.js：解压 Crowdin 的翻译包 “DualTran (translations).zip”，仅保留 messages.json，规范化语言目录名（将连字符改为下划线，例如 zh-CN → zh_CN），输出到 extra/result，方便后续拷贝/合并到 _locales。

### 与主工程关系：
- 它们只是维护/预处理本地化资源的脚本，和构建产物解耦；打包流程由 webpack.production.js 等处理，不会包含本报。
- 产出目录如 extra/result 已在 .gitignore 中忽略。

### 使用方法：
````sh
# 运行语言名称抓取（在 extra 子项目中）
cd extra
npm install
npm start

# 处理 Crowdin 导出包（将 zip 放到 extra/ 目录后）
node extra/crowdin.js
````

完成之后，可配合主仓库的本地化脚本进行同步，比如：
- 同步 keys： sync-locales.js（`npm run i18n:sync`）
- 校验差异： check-i18n-equals-en.js（`npm run i18n:verify`）