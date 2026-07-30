import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** The institution audit trail — filterable append-only record (OSE admin). */

test.describe("audit trail", () => {
  test("OSE sees a filterable audit log", async ({ page }) => {
    await signIn(page, "Dana Whitfield") // OSE Director
    await page.goto("/admin/audit")

    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible()
    // Summary counts and the append-only trail render
    await expect(page.getByText(/events/).first()).toBeVisible()
    await expect(page.getByText(/denied/).first()).toBeVisible()

    // Filter to denials
    await page.getByRole("link", { name: "Denied", exact: true }).click()
    await expect(page).toHaveURL(/outcome=deny/)

    // Search by action keyword
    await page.getByPlaceholder(/Filter by action/).fill("Approval")
    await page.getByRole("button", { name: "Search" }).click()
    await expect(page).toHaveURL(/q=Approval/)
    // The outcome filter is preserved through the search
    await expect(page).toHaveURL(/outcome=deny/)
  })
})
