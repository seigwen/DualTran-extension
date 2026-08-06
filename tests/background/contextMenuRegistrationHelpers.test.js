import { describe, expect, it } from "vitest";
import { buildStaticActionContextMenuConfigs } from "../../src/background/contextMenuRegistrationHelpers.js";

describe("contextMenuRegistrationHelpers", () => {
  it("builds the static browserAction, pageAction, and shared menu configs in order", () => {
    expect(buildStaticActionContextMenuConfigs({
      showPopupLabel: "Show popup",
      neverTranslateLabel: "Never translate this site",
      moreOptionsLabel: "More options",
      pdfToHtmlLabel: "PDF to HTML",
    })).toEqual([
      {
        id: "browserAction-showPopup",
        title: "Show popup",
        contexts: ["browser_action"],
      },
      {
        id: "pageAction-showPopup",
        title: "Show popup",
        contexts: ["page_action"],
      },
      {
        id: "never-translate",
        title: "Never translate this site",
        contexts: ["browser_action", "page_action"],
      },
      {
        id: "more-options",
        title: "More options",
        contexts: ["browser_action", "page_action"],
      },
      {
        id: "browserAction-pdf-to-html",
        title: "PDF to HTML",
        contexts: ["browser_action"],
      },
      {
        id: "pageAction-pdf-to-html",
        title: "PDF to HTML",
        contexts: ["page_action"],
      },
    ]);
  });

  it("reuses the same labels for browser and page action popup entries", () => {
    const configs = buildStaticActionContextMenuConfigs({
      showPopupLabel: "Popup",
      neverTranslateLabel: "Never",
      moreOptionsLabel: "Options",
      pdfToHtmlLabel: "PDF",
    });

    expect(configs[0].title).toBe("Popup");
    expect(configs[1].title).toBe("Popup");
    expect(configs[4].title).toBe("PDF");
    expect(configs[5].title).toBe("PDF");
  });

  it("keeps shared entries scoped to both browser and page action contexts", () => {
    const configs = buildStaticActionContextMenuConfigs({
      showPopupLabel: "Popup",
      neverTranslateLabel: "Never",
      moreOptionsLabel: "Options",
      pdfToHtmlLabel: "PDF",
    });

    expect(configs[2].contexts).toEqual(["browser_action", "page_action"]);
    expect(configs[3].contexts).toEqual(["browser_action", "page_action"]);
  });
});