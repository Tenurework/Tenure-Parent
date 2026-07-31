import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Proceed 1: real clubs, permanent position IDs, OSE club administration. */



const stamp = Date.now()

test.describe("real clubs + permanent position IDs", () => {
  test("clubs are grouped by category with the real Simon roster", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs")
    await expect(page.getByText(/Professional \(\d+\)/)).toBeVisible()
    await expect(page.getByText(/Community \(\d+\)/)).toBeVisible()
    await expect(page.getByText(/Social \(\d+\)/)).toBeVisible()
    await expect(page.getByText(/Organizations \(\d+\)/)).toBeVisible()
    await expect(page.getByText("Simon School Venture Fund")).toBeVisible()
    await expect(page.getByText("Uncorked")).toBeVisible()
  })

  test("roster seats show their permanent position IDs", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/members")
    await expect(page.getByText("Position ID SCC-PRES", { exact: false })).toBeVisible()
    await expect(page.getByText("Position ID SCC-VP-CASI", { exact: false })).toBeVisible()
  })

  test("OSE director charters a club with standard seats from the admin console", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/admin/clubs")
    await page.getByPlaceholder("Simon Real Estate Club").fill(`E2E Chess Club ${stamp}`)
    await page.getByRole("button", { name: "Charter club" }).click()
    await page.waitForURL(/\/admin\/clubs\/[a-z0-9-]+$/)
    await expect(page.getByRole("heading", { name: `E2E Chess Club ${stamp}` })).toBeVisible()
    await expect(page.getByText("President", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Position ID /).first()).toBeVisible()
  })

  test("club members cannot reach the admin console", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/admin/clubs")
    await expect(page.getByText("Administration Console")).toHaveCount(0)
    // The charter form is admin-only and no longer on the public clubs page.
    await page.goto("/orgs")
    await expect(page.getByText("Charter a new club")).toHaveCount(0)
  })
})
