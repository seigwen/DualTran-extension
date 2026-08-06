// Dynamic imports work in classic content scripts (no type:module needed in manifest).
// Each imported module is loaded as an ES module with full import/export support.
// webpackMode: "eager" — prevents webpack from creating separate async chunks,
// which would fail to load in a Chrome extension content script context.
import(/* webpackMode: "eager" */ "./showTranslated.js") // 在已翻译过但之后又显示原文的页面悬停显译文
import(/* webpackMode: "eager" */ "./translateSelected.js") // 翻译选中文本
import(/* webpackMode: "eager" */ "./floatingBtn.js") // 浮动按钮，点击后翻译页面文本
