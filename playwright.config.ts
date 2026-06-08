import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  use: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    baseURL: "https://time-attendance-app-amber.vercel.app",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
