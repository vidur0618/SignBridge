import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  ],
  webServer: [
    {
      command: "pnpm --filter @signbridge/api dev",
      url: "http://127.0.0.1:8080/api/health",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @signbridge/web dev --host 127.0.0.1",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
  ],
});
