// Dirty fixture for the i18n write-site guard self-test (#157 / spec 47 L1).
// One seeded violation per rule (R1 write-site literal, R1b unwired innerHTML
// template, R2 missing key, R3 dead data-i18n binding); the last line carries
// an exemption marker and must NOT be reported.
export function applyDirty(el) {
  el.textContent = "Hardcoded label";
  el.setAttribute("title", "Hardcoded tip");
  prompt("Question text");
  el.innerHTML = `<div>Visible Text</div>`;
  chrome.i18n.getMessage("nonexistentKeyXyz");
  el.innerHTML = `<span data-i18n="lblSettings">x</span>`;
  el.textContent = "Exempted"; // i18n-exempt: legacy — fixture self-test
}
