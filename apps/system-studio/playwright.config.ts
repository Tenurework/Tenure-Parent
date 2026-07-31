import { defineConfig, devices } from "@playwright/test"

/**
 * Drives the Studio in a browser.
 *
 * `PLAYWRIGHT_BASE_URL` points it at a running instance — a local container, or
 * the deployed engine. There is no `webServer` block: this app needs an
 * operator allowlist and secret in its environment, and a config that started
 * one for itself would be testing whatever defaults it invented rather than the
 * thing that is actually deployed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 45_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
