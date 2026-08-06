"use strict";

/**
 * Show/hide "Loading" text above the select element
 */
function setLoadingVisible(select, visible) {
  try {
    const labelP = select?.previousElementSibling;
    if (!labelP) return;
    const span = labelP.querySelector(".model-loading-msg");
    if (span) span.style.display = visible ? "" : "none";
  } catch (_) { /* silent */ }
}

export function renderLoadingState(select, loadingText = "Loading...") {
  if (!select || select._isMissingElement) return;
  const ownerDocument = select.ownerDocument;
  select.disabled = true;
  select.innerHTML = "";
  const loadingOption = ownerDocument.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = loadingText;
  loadingOption.disabled = true;
  select.appendChild(loadingOption);
  setLoadingVisible(select, true);
}

export function renderFallbackState(select, { notice, fallbackOptions = [], storedValue = "" }) {
  if (!select || select._isMissingElement) return;
  const ownerDocument = select.ownerDocument;
  select.innerHTML = "";

  if (notice) {
    const noticeOption = ownerDocument.createElement("option");
    noticeOption.value = "";
    noticeOption.textContent = notice;
    noticeOption.disabled = true;
    select.appendChild(noticeOption);
  }

  fallbackOptions.forEach((item) => {
    const option = ownerDocument.createElement("option");
    option.value = item.value;
    option.textContent = item.text;
    select.appendChild(option);
  });

  if (storedValue && !fallbackOptions.some((item) => item.value === storedValue)) {
    const preservedOption = ownerDocument.createElement("option");
    preservedOption.value = storedValue;
    preservedOption.textContent = storedValue;
    select.appendChild(preservedOption);
  }

  select.disabled = false;
  if (storedValue) {
    select.value = storedValue;
  }
  setLoadingVisible(select, false);
}

/**
 * @param {HTMLSelectElement} select
 * @param {Object} opts
 * @param {Array<{value:string,text:string}>} opts.models
 * @param {string} [opts.storedValue=""]
 * @param {string} [opts.smartDefault] - Smart default model value, used only when no storedValue exists
 * @param {Function} [opts.getValue]
 * @param {Function} [opts.getLabel]
 * @returns {Array<{value:string,text:string}>} normalized
 */
export function renderModelOptions(select, { models = [], storedValue = "", smartDefault, getValue, getLabel }) {
  if (!select || select._isMissingElement) return [];
  const ownerDocument = select.ownerDocument;

  const normalized = models
    .map((model) => {
      const value = getValue(model);
      if (!value) return null;
      return {
        value,
        text: getLabel(model) || value,
      };
    })
    .filter(Boolean);

  select.innerHTML = "";
  normalized.forEach((item) => {
    const option = ownerDocument.createElement("option");
    option.value = item.value;
    option.textContent = item.text;
    select.appendChild(option);
  });

  if (storedValue && !normalized.some((item) => item.value === storedValue)) {
    const preservedOption = ownerDocument.createElement("option");
    preservedOption.value = storedValue;
    preservedOption.textContent = storedValue;
    select.appendChild(preservedOption);
  }

  select.disabled = false;
  if (storedValue) {
    select.value = storedValue;
  } else if (smartDefault && normalized.some((item) => item.value === smartDefault)) {
    select.value = smartDefault;
  }
  // Otherwise don't select (selectedIndex stays -1)

  setLoadingVisible(select, false);
  return normalized;
}
