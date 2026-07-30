import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** OSE finance portfolio roll-up — two-tier ERP consolidation, OSE-only. */

test.describe("finance portfolio (OSE)", () => {
  test("OSE rolls up every club's budget and drills into one", async ({ page }) => {
    await signIn(page, "Dana Whitfield") // OSE Director
    await page.goto("/reports")
    await page.getByRole("link", { name: /Finance portfolio/ }).click()
    await page.waitForURL(/\/reports\/finance/)

    await expect(page.getByRole("heading", { name: /Finance portfolio/ })).toBeVisible()
    await expect(page.getByText("Total budgeted")).toBeVisible()

    // A club is listed and drills into its finance dashboard.
    const clubLink = page.getByRole("link", { name: /Consulting/ }).first()
    await expect(clubLink).toBeVisible()
    await clubLink.click()
    await expect(page).toHaveURL(/\/orgs\/.*\/finance/)
  })

  test("a club member cannot reach the portfolio", async ({ page }) => {
    await signIn(page, "Maya Johnson") // Member, consulting club
    await page.goto("/reports/finance")
    await expect(page.getByRole("heading", { name: /find that page/i })).toBeVisible()
  })
})
