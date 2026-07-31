import { test, expect } from "@playwright/test"

/**
 * Diagnostic: capture what the BROWSER says, not only what the page shows.
 *
 * The sign-in suite asserts visible text. A client-side exception can happen
 * after the assertion passes, or replace the page a moment later, and nothing
 * in that suite would notice — which is how "Application error: a client-side
 * exception has occurred" reached a user through four green tests.
 */

const OPERATOR = process.env.PLATFORM_OPERATORS ?? ""
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test("capture console and page errors through the whole sign-in flow", async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`))
  page.on("requestfailed", (req) =>
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`),
  )
  page.on("response", (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`)
  })

  await page.goto("/signin", { waitUntil: "networkidle" })
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()

  await page.waitForLoadState("networkidle")
  // Give any post-hydration error time to surface.
  await page.waitForTimeout(3000)

  const body = await page.locator("body").innerText()

  console.log("\n─── URL ───\n" + page.url())
  console.log("\n─── BODY (first 400) ───\n" + body.slice(0, 400))
  console.log("\n─── PAGE ERRORS ───\n" + (pageErrors.join("\n") || "(none)"))
  console.log("\n─── CONSOLE ERRORS ───\n" + (consoleErrors.join("\n") || "(none)"))
  console.log("\n─── FAILED REQUESTS ───\n" + (failedRequests.join("\n") || "(none)"))

  expect(body, "the page shows Next's client-side exception screen").not.toContain(
    "Application error",
  )
  expect(pageErrors, "uncaught errors in the browser").toEqual([])
})
