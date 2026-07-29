import { readFileSync } from "node:fs"
import { defineConfig, devices } from "@playwright/test"

/**
 * Headless e2e suite. Runs against:
 *  - a local production build (`npm run start`) by default — CI spins up
 *    Postgres, pushes the schema, and seeds before this runs
 *  - any deployed URL via PLAYWRIGHT_BASE_URL (e.g. the CloudFront domain)
 */

/**
 * Next loads `.env` for the server it runs, but the Playwright process never
 * sees it — so a test that signs a job request with `process.env.JOB_SECRET`
 * was sending `undefined` locally while the server expected the real value, and
 * only CI (which sets the vars explicitly) agreed with itself. Mirror `.env`
 * into the runner, without overriding anything already set.
 */
function loadDotenv(file = ".env") {
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    return // CI supplies its own environment
  }
  for (const line of raw.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || line.trimStart().startsWith("#")) continue
    const [, key, value] = match
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "")
    }
  }
}
loadDotenv()

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // flows share seeded data and mutate state — run serially
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 45_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          command: "npm run start",
          url: "http://localhost:3000/api/health",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
})
