import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Soft-delete / restore — archived documents can be brought back. */

test("an archived document can be restored", async ({ page }) => {
  await signIn(page, "Dana Whitfield") // OSE Director — can manage the club
  await page.goto("/orgs/simon-consulting-club/documents")

  // The seeded archived doc shows in the Archived section with a Restore control.
  await expect(page.getByRole("heading", { name: "Archived documents" })).toBeVisible()
  await expect(page.getByText("Old Sponsor Deck")).toBeVisible()

  await page.getByRole("button", { name: /Restore/ }).first().click()

  // After restoring, the Archived section is gone and the doc is back in the list.
  await expect(page.getByRole("heading", { name: "Archived documents" })).toBeHidden()
  await expect(page.getByText("Old Sponsor Deck")).toBeVisible()
})
