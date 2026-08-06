import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadDarkModeModule() {
  vi.resetModules();
  return import("../../src/options/darkmode.js");
}

describe("options/darkmode", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  it("enableDarkMode sets sessionStorage to yes", async () => {
    const { enableDarkMode } = await loadDarkModeModule();

    enableDarkMode();

    expect(sessionStorage.getItem("darkModeIsEnabled")).toBe("yes");
  });

  it("enableDarkMode creates the stylesheet in document head", async () => {
    const { enableDarkMode } = await loadDarkModeModule();

    enableDarkMode();

    const style = document.head.querySelector("#darkModeElement");
    expect(style).not.toBeNull();
    expect(style?.tagName).toBe("STYLE");
    expect(style?.getAttribute("rel")).toBe("stylesheet");
  });

  it("enableDarkMode does not create duplicate styles", async () => {
    const { enableDarkMode } = await loadDarkModeModule();

    enableDarkMode();
    enableDarkMode();

    expect(document.querySelectorAll("#darkModeElement")).toHaveLength(1);
  });

  it("style element contains expected dark mode CSS rules", async () => {
    const { enableDarkMode } = await loadDarkModeModule();

    enableDarkMode();

    const css = document.querySelector("#darkModeElement")?.textContent ?? "";
    expect(css).toContain("scrollbar-color: #202324 #454a4d");
    expect(css).toContain("background-color: #181a1b");
    expect(css).toContain("#donation select");
    expect(css).toContain("color: black !important");
  });

  it("disableDarkMode sets sessionStorage to no", async () => {
    const { disableDarkMode } = await loadDarkModeModule();

    disableDarkMode();

    expect(sessionStorage.getItem("darkModeIsEnabled")).toBe("no");
  });

  it("disableDarkMode removes the stylesheet from the DOM", async () => {
    const { enableDarkMode, disableDarkMode } = await loadDarkModeModule();

    enableDarkMode();
    disableDarkMode();

    expect(document.querySelector("#darkModeElement")).toBeNull();
  });

  it("disableDarkMode is a no-op when the stylesheet does not exist", async () => {
    const { disableDarkMode } = await loadDarkModeModule();

    expect(() => disableDarkMode()).not.toThrow();
    expect(document.querySelector("#darkModeElement")).toBeNull();
  });

  it("auto-enables dark mode on import when sessionStorage is yes", async () => {
    sessionStorage.setItem("darkModeIsEnabled", "yes");

    await loadDarkModeModule();

    expect(document.querySelector("#darkModeElement")).not.toBeNull();
    expect(sessionStorage.getItem("darkModeIsEnabled")).toBe("yes");
  });

  it("does not auto-enable dark mode on import when sessionStorage is no", async () => {
    sessionStorage.setItem("darkModeIsEnabled", "no");

    await loadDarkModeModule();

    expect(document.querySelector("#darkModeElement")).toBeNull();
  });

  it("does not auto-enable dark mode on import when sessionStorage is missing", async () => {
    await loadDarkModeModule();

    expect(document.querySelector("#darkModeElement")).toBeNull();
  });

  it("supports an enable-disable-enable toggle cycle", async () => {
    const { enableDarkMode, disableDarkMode } = await loadDarkModeModule();

    enableDarkMode();
    disableDarkMode();
    enableDarkMode();

    expect(document.querySelectorAll("#darkModeElement")).toHaveLength(1);
    expect(sessionStorage.getItem("darkModeIsEnabled")).toBe("yes");
  });
});
