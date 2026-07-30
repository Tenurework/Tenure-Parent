import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Proceed 2 batch D: brand shell, footer, nav layout, notifications page. */



test.describe("shell + brand", () => {
  test("the Tenure AI entry opens the right-side assistant panel", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    const ai = page.getByRole("button", { name: "Ask Tenure AI" })
    await expect(ai).toBeVisible()
    await ai.click()
    const panel = page.getByRole("complementary", { name: "Tenure AI assistant" })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole("textbox", { name: "Ask Tenure AI" })).toBeVisible()
    await panel.getByRole("button", { name: "Close Tenure AI" }).click()
  })

  test("footer with wordmark and copyright renders on every page", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    for (const path of ["/dashboard", "/orgs", "/calendar", "/messages"]) {
      await page.goto(path)
      await expect(
        page.getByText(/© \d{4} Tenure\. All rights reserved\./)
      ).toBeVisible()
    }
  })

  test("side panel has sections and Settings pinned at the bottom", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    const nav = page.getByRole("navigation", { name: "Primary navigation" })
    await expect(nav.getByText("Community", { exact: true })).toBeVisible()
    await expect(nav.getByText("Operations", { exact: true })).toBeVisible()
    await expect(nav.getByText("Knowledge", { exact: true })).toBeVisible()
    const settings = nav.getByRole("link", { name: "Settings" })
    await expect(settings).toBeVisible()
    // Settings sits below every section label (pinned bottom)
    const settingsBox = (await settings.boundingBox())!
    const opsBox = (await nav.getByText("Operations").boundingBox())!
    expect(settingsBox.y).toBeGreaterThan(opsBox.y)
  })

  test("the bell opens a centered notifications overlay (no side-nav entry)", async ({ page }) => {
    await signIn(page, "Alex Kim")
    // Notifications is no longer a side-nav item — the header bell owns it.
    await expect(
      page.getByRole("navigation").getByRole("link", { name: /Notifications/ })
    ).toHaveCount(0)
    // Bell → dropdown → "See all notifications" opens a centered overlay, not a page.
    await page.getByRole("button", { name: /Notifications/ }).click()
    await page.getByRole("button", { name: "See all notifications" }).click()
    await expect(
      page.getByText("Approvals, roster changes, events, and messages that involve you.")
    ).toBeVisible()
    // The standalone page still works as a deep link.
    await page.goto("/notifications")
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible()
  })
})
