// Clean fixture for the i18n write-site guard self-test (#157 / spec 47 L1).
// Every write site below is either produced by an i18n wrapper, lexically
// non-text, a deliberate fallback, or a data-i18n-wired template with a
// translateDocument() pass in the file. The guard must report zero violations.
export function applyClean(el) {
  el.textContent = chrome.i18n.getMessage("lblSettings");
  el.placeholder = chrome.i18n.getMessage("enterShortcut") || "Enter a shortcut";
  el.setAttribute("title", "42");
  el.setAttribute("data-kind", "primary");
  el.innerHTML = `<span data-i18n="lblSettings">Settings</span>`;
  chrome.i18n.translateDocument(el);
  const label = `${chrome.i18n.getMessage("lblSettings")} — ok`;
  el.title = label;
}
