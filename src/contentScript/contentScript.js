// Dynamic imports work in classic content scripts (no type:module needed in manifest).
// Each imported module is loaded as an ES module with full import/export support.
// webpackMode: "eager" — prevents webpack from creating separate async chunks,
// which would fail to load in a Chrome extension content script context.
import(/* webpackMode: "eager" */ "./showTranslated.js") // Hover to show translated text on previously-translated pages
import(/* webpackMode: "eager" */ "./translateSelected.js") // Translate selected text
import(/* webpackMode: "eager" */ "./floatingBtn.js") // Floating button, click to translate page text
