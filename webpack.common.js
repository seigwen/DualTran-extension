const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const variant = require('./scripts/manifest-variant.js');

// Build target (plan 62 M1): chrome by default, firefox via `TARGET=firefox`.
const TARGET = process.env.TARGET === 'firefox' ? 'firefox' : 'chrome';
const OUT_DIR = TARGET === 'firefox' ? 'dist/firefox' : 'dist/chrome';

module.exports = {
  // webpack5中可在entry中通过键名(而不是键值)指定输出路径和名称: https://webpack.js.org/configuration/entry-context/#entry-descriptor
  entry: {
    // Service Worker 以 ESM 模式注册（manifest: background.type="module"），不支持 importScripts()。
    // 用 chunkLoading: 'import' 让 webpack 通过 ES import() 加载动态 chunk，与 ESM SW 兼容。
    // 之前用 'import-scripts' 会在 ESM 上下文中触发 "Module scripts don't support importScripts()"。
    "/background/sw.js": { import: '/src/background/sw.js', chunkLoading: 'import' },
    "/contentScript/contentScript.js": '/src/contentScript/contentScript.js',
    "/popup/old-popup.js": '/src/popup/old-popup.js',
    "/popup/popup-change-language.js": '/src/popup/popup-change-language.js',
    "/popup/popup-translate-document.js": '/src/popup/popup-translate-document.js',
    "/popup/popup-translate-text.js": '/src/popup/popup-translate-text.js',
    "/popup/popup.js": '/src/popup/popup.js',
    "/options/options.js": '/src/options/options.js',
  },
  output: {
    filename: '[name]', // 保持源文件名
    // parth.resolve: path.resolve() 方法将一系列路径或路径段解析为绝对路径。
    // see https://nodejs.org/api/path.html#pathresolvepaths
    path: path.resolve(__dirname, OUT_DIR),
    publicPath: '/', // 扩展根路径，chunk 从 chrome-extension://<id>/ 加载
    chunkFilename: '[name].js', // 动态 import() 产生的 chunk 带 .js 后缀，便于 importScripts() 加载
    clean: true,
  },
  experiments: {
    topLevelAwait: true
  },

  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/_locales', to: '_locales' },
        { from: 'src/background/offscreen-audio.html', to: 'background/offscreen-audio.html' },
        { from: 'src/background/offscreen-audio.js', to: 'background/offscreen-audio.js' },
        { from: 'src/contentScript/css', to: 'contentScript/css' },
        { from: 'src/contentScript/checkScriptIsInjected.js', to: 'contentScript/checkScriptIsInjected.js' },
        { from: 'src/contentScript/deepl.js', to: 'contentScript/deepl.js' },
        { from: 'src/icons', to: 'icons' },
        { from: 'src/options/options.css', to: 'options/options.css' },
        { from: 'src/options/options.html', to: 'options/options.html' },
        { from: 'src/popup/detect-pdf.js', to: 'popup/detect-pdf.js' },
        { from: 'src/popup/old-popup.css', to: 'popup/old-popup.css' },
        { from: 'src/popup/old-popup.html', to: 'popup/old-popup.html' },
        { from: 'src/popup/popup-change-language.html', to: 'popup/popup-change-language.html' },
        { from: 'src/popup/popup-translate-document.html', to: 'popup/popup-translate-document.html' },
        { from: 'src/popup/popup-translate-text.html', to: 'popup/popup-translate-text.html' },
        { from: 'src/popup/popup.css', to: 'popup/popup.css' },
        { from: 'src/popup/popup.html', to: 'popup/popup.html' },
        { from: 'src/w3css', to: 'w3css' },
        { from: 'src/rules', to: 'rules' },
        {
          from: 'src/manifest.json',
          to: '.',
          transform(content) {
            // Per-target manifest: comment stripping plus the declared Firefox
            // differences live in scripts/manifest-variant.js (plan 62 M1).
            const manifest = variant.buildManifest(content.toString('utf8'), TARGET);
            return JSON.stringify(manifest, null, 2);
          },
        },
      ]
    })
  ],
};