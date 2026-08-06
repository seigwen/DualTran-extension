chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabUrl = tabs && tabs[0] && tabs[0].url;
  if (tabUrl && tabUrl.toLowerCase().endsWith(".pdf")) {
    window.location = "popup-translate-document.html";
  }
});

chrome.runtime.sendMessage({ action: "getTabMimeType" }, (mimeType) => {
  if (mimeType && mimeType.toLowerCase() === "application/pdf") {
    window.location = "popup-translate-document.html";
  }
});
