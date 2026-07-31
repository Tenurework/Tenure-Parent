import { readFileSync } from "node:fs"
import path from "node:path"
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
 *
 * Resolved against this file, not against process.cwd(): `.env` lives at
 * apps/web/.env, and a run started from the monorepo root would otherwise hit
 * the silent `catch { return }` below and leave JOB_SECRET and
 * DEV_LOGIN_PASSPHRASE undefined — which surfaces as auth failures in the
 * specs, not as a missing file.
 *
 * __dirname, not import.meta.url: Playwright transpiles this config to CJS
 * (apps/web/package.json is not "type": "module"), so import.meta is a hard
 * SyntaxError here — the whole suite fails to load before a single spec runs.
 */
function loadDotenv(file = path.join(__dirname, ".env")) {
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

/**
 * Seed the suite's run identifier here, in the main process, before any worker
 * is forked — workers inherit the environment, so every spec and every retry
 * reads the same value. See e2e/run-id.ts for why a per-import `Date.now()`
 * makes a retried test unable to pass.
 *
 * `||=`, so an outer runner (a matrix job wanting one id across shards) can set
 * it and be respected.
 */
process.env.E2E_RUN_ID ||= String(Date.now())

/**
 * One seeded account is Tenure staff for the duration of the suite.
 *
 * The System Studio is gated on `PLATFORM_OPERATORS`, which fails closed when
 * unset — so without this, studio.spec.ts would pass its three "cannot reach it"
 * assertions for the wrong reason and its "operator can" assertion would fail.
 * Set here rather than in CI's env block so a local run and a CI run agree, and
 * because `webServer` below inherits this process's environment.
 *
 * `||=`, so a run that wants a different operator can say so.
 */
process.env.PLATFORM_OPERATORS ||= "director@tenure.demo"

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
