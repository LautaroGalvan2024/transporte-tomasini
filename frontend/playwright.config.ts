import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  outputDir: "../output/qa/browser-results",
  use: {
    baseURL: "https://tomasini.invalid",
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/Argentina/Buenos_Aires",
    serviceWorkers: "block",
  },
});
