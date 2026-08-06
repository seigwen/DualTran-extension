"use strict";

export function buildStaticActionContextMenuConfigs({
  showPopupLabel,
  neverTranslateLabel,
  moreOptionsLabel,
  pdfToHtmlLabel,
}) {
  return [
    {
      id: "browserAction-showPopup",
      title: showPopupLabel,
      contexts: ["browser_action"],
    },
    {
      id: "pageAction-showPopup",
      title: showPopupLabel,
      contexts: ["page_action"],
    },
    {
      id: "never-translate",
      title: neverTranslateLabel,
      contexts: ["browser_action", "page_action"],
    },
    {
      id: "more-options",
      title: moreOptionsLabel,
      contexts: ["browser_action", "page_action"],
    },
    {
      id: "browserAction-pdf-to-html",
      title: pdfToHtmlLabel,
      contexts: ["browser_action"],
    },
    {
      id: "pageAction-pdf-to-html",
      title: pdfToHtmlLabel,
      contexts: ["page_action"],
    },
  ];
}