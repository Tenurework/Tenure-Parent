import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Uniform club cards, the Archived section, and club images. */



const stamp = Date.now()

test.describe("club cards", () => {
  test("archiving a club moves it to the Archived section, out of the active grid", async ({
    page,
  }) => {
    const name = `E2E Archivable ${stamp}`
    await signIn(page, "Dana Whitfield")

    // Charter a throwaway club from the admin console so the test is self-contained.
    await page.goto("/admin/clubs")
    await page.getByPlaceholder("Simon Real Estate Club").fill(name)
    await page.getByRole("button", { name: "Charter club" }).click()
    await page.waitForURL(/\/admin\/clubs\/[a-z0-9-]+$/)

    // It starts active — its card sits in the category grid with an Archive action.
    await page.goto("/orgs")
    const card = page.locator("article").filter({ hasText: name })
    await expect(card).toBeVisible()
    await card.getByRole("button", { name: `Archive ${name}` }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Archive club" }).click()

    // Now it lives under the Archived section with a Reactivate control, and no
    // longer offers an Archive action in the active grid.
    await expect(page.getByRole("button", { name: `Reactivate ${name}` })).toBeVisible()
    await expect(page.getByText(/Archived clubs \(\d+\)/)).toBeVisible()
    await expect(page.getByRole("button", { name: `Archive ${name}` })).toHaveCount(0)
  })

  test("a club manager can set the club image via URL", async ({ page }) => {
    const imageUrl = `https://picsum.photos/seed/${stamp}/240`
    await signIn(page, "Priya Raman") // President of Simon Consulting Club

    await page.goto("/orgs/simon-consulting-club/members")
    await page.getByRole("button", { name: /image for Simon Consulting Club/i }).click()
    await page.locator('input[name="imageUrl"]').fill(imageUrl)
    await page.getByRole("button", { name: "Use URL" }).click()

    // The club now renders that image (avatar in the header).
    await expect(page.locator(`img[src="${imageUrl}"]`).first()).toBeVisible()
  })

  test("club members cannot edit the club image", async ({ page }) => {
    await signIn(page, "Maya Johnson") // a plain member
    await page.goto("/orgs/simon-consulting-club/members")
    await expect(page.getByRole("button", { name: /image for Simon Consulting Club/i })).toHaveCount(0)
  })
})
