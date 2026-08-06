const path = require("path");
const { webcrypto } = require("node:crypto");
const { defineConfig } = require("vitest/config");

// Vitest boots Vite before any test files run. In some Node setups the global
// crypto object is missing Web Crypto helpers at that point, which causes Vite
// config resolution to fail when it asks for crypto.getRandomValues().
if (
  !globalThis.crypto ||
  typeof globalThis.crypto.getRandomValues !== "function"
) {
  globalThis.crypto = webcrypto;
}

module.exports = defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
    globals: true,
    restoreMocks: true,
    environmentMatchGlobs: [
      ["tests/popup/**", "jsdom"],
      ["tests/contentScript/**", "jsdom"],
      ["tests/options/**", "jsdom"],
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.js"],
      exclude: [
        "src/icons/**",
        "src/_locales/**",
        "src/w3css/**",
        "src/rules/**",
        "src/**/old-*",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
        // TODO: 当关键文件覆盖率提升后，启用 perFile 以防止回归
        // perFile: true,  当前会导致 fetchSSE.js / sw.js 等低覆盖文件 CI 失败
      },
    },
  },
});