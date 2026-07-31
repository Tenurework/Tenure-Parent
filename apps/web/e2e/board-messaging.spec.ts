import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Board-member names route to in-app messaging (a 1:1 DM). */

test("a board member's name opens an in-app DM", async ({ page }) => {
  await signIn(page, "Victor Chen") // VP Finance, consulting club
  await page.goto("/orgs/simon-consulting-club/members")

  // The president's name (a messageable board member) is a link into messaging.
  await page.getByRole("button", { name: /Priya Raman/ }).first().click()
  await expect(page).toHaveURL(/\/messages\/[a-z0-9]+/)
})
