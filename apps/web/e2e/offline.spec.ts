import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * TTES-030-002 — the bounded offline pattern.
 *
 * `states.ts` has declared an `offline` state (role=status, aria-live=polite,
 * presentsAsComplete:false, copy that says changes will not save) since the
 * vocabulary was written, and nothing rendered it. `OfflineBoundary`, mounted
 * from src/app/(app)/layout.tsx, is the production caller.
 *
 * Both assertions read what the PRODUCTION path emits: the role and the
 * politeness come from STATE_SEMANTICS via StateSurface, not from the boundary,
 * so flipping the table changes what this spec sees.
 */
test.describe("offline boundary", () => {
  test("going offline announces it politely and disarms the submit controls", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    // A route with a real form on it, so the boundary has something to bound.
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")

    const banner = page.locator('[data-state="offline"]')
    await expect(banner).toHaveCount(0)

    const submit = page.locator('form button[type="submit"], form button:not([type])').first()
    await expect(submit).toBeVisible()

    await page.context().setOffline(true)
    // The banner is driven by the window 'offline' event; Playwright's
    // setOffline fires it, but give React a tick to commit.
    await expect(banner).toBeVisible({ timeout: 10_000 })

    // The role and politeness are the table's, not the call site's.
    await expect(banner).toHaveAttribute("role", "status")
    await expect(banner).toHaveAttribute("aria-live", "polite")
    // DEFAULT_COPY.offline — the sentence the "bounded" part has to make true.
    await expect(banner).toContainText("You are offline")
    await expect(banner).toContainText("Changes will not save")
    // `presentsAsComplete: false` reaches the DOM too.
    await expect(banner).toHaveAttribute("data-complete", "false")

    // The bound: the submit affordance is inert and says so.
    await expect(page.locator("html")).toHaveAttribute("data-offline", "true")
    await expect(submit).toHaveAttribute("aria-disabled", "true")
    const pointerEvents = await submit.evaluate((el) => getComputedStyle(el).pointerEvents)
    expect(pointerEvents).toBe("none")

    await page.context().setOffline(false)
    await expect(banner).toHaveCount(0, { timeout: 10_000 })
    await expect(submit).not.toHaveAttribute("aria-disabled", "true")
  })
})
