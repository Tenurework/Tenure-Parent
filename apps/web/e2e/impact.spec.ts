import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Club Impact page — auto-generated shareable outcome summary. */

test.describe("club impact", () => {
  test("summarizes the club's outcomes and is reachable as a tab", async ({ page }) => {
    await signIn(page, "Victor Chen") // VP Finance, consulting club
    await page.goto("/orgs/simon-consulting-club/impact")

    await expect(page.getByText(/a shareable summary of what this club has achieved/i)).toBeVisible()
    await expect(page.getByText("Events published")).toBeVisible()
    await expect(page.getByText("Knowledge captured")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Approval outcomes" })).toBeVisible()

    // reachable from the club tabs
    await page.goto("/orgs/simon-consulting-club/members")
    await expect(page.getByRole("link", { name: "Impact" })).toBeVisible()
  })
})
