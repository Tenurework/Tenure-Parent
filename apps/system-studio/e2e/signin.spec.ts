import { test, expect } from "@playwright/test"

/**
 * Signing in through the FORM, in a browser.
 *
 * This suite exists because of a specific failure. The credentials were
 * verified by posting directly to `/api/auth/callback/operator`, which returned
 * 302 and a session cookie — and the form was still broken, because the server
 * action wrapping it discarded the success. A correct email and secret were
 * answered with "Those credentials were not accepted".
 *
 * Testing the layer underneath the one people use proves the layer underneath
 * works. These drive the page.
 */

const OPERATOR = process.env.PLATFORM_OPERATORS ?? ""
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  // Fail loudly rather than silently testing a weaker configuration: without
  // these, every assertion below would pass for the wrong reason.
  expect(OPERATOR, "PLATFORM_OPERATORS must be set for this suite").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set for this suite").not.toBe("")
})

test.describe("operator sign-in", () => {
  test("correct credentials reach the console", async ({ page }) => {
    await page.goto("/signin")
    await expect(page.getByRole("heading", { name: "Tenure staff" })).toBeVisible()

    await page.getByLabel("Email").fill(OPERATOR)
    await page.getByLabel("Operator secret").fill(SECRET)
    await page.getByRole("button", { name: "Sign in" }).click()

    // The regression this pins: this used to land back on /signin showing the
    // failure message, because the handler mistook the success redirect for an
    // error.
    await expect(page.getByText("Those credentials were not accepted.")).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()

    // And it shows the systems, which is the point of getting in.
    await expect(page.getByText("Simon Business School — Ainslie OSE")).toBeVisible()
    await expect(page.getByText("Midtown Arts Collective")).toBeVisible()
  })

  test("a wrong secret is refused", async ({ page }) => {
    await page.goto("/signin")
    await page.getByLabel("Email").fill(OPERATOR)
    await page.getByLabel("Operator secret").fill("not-the-operator-secret-at-all-x")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page.getByText("Those credentials were not accepted.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Organization systems" })).toHaveCount(0)
  })

  test("an address that is not an operator is refused, identically", async ({ page }) => {
    // Same message as a wrong secret, deliberately: the page must not confirm
    // which addresses are Tenure staff.
    await page.goto("/signin")
    await page.getByLabel("Email").fill("someone-else@example.test")
    await page.getByLabel("Operator secret").fill(SECRET)
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page.getByText("Those credentials were not accepted.")).toBeVisible()
  })

  test("the console is unreachable without signing in", async ({ page }) => {
    await page.context().clearCookies()
    await page.goto("/")
    await expect(page).toHaveURL(/\/signin/)
    await expect(page.getByRole("heading", { name: "Organization systems" })).toHaveCount(0)
  })
})
