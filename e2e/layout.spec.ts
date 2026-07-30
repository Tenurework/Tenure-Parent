import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * Layout must adapt to any resolution: no dead half-screen on wide monitors,
 * no horizontal scrolling on small ones.
 */



const PAGES = ["/dashboard", "/orgs", "/resources", "/calendar", "/feed"]

test.describe("responsive layout", () => {
  test("content fills a wide monitor instead of hugging the left edge", async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 })
    await signIn(page, "Dana Whitfield")

    for (const path of PAGES) {
      await page.goto(path)
      const shell = page.locator(".page-shell").first()
      const box = (await shell.boundingBox())!

      // Uses a serious portion of the available width rather than stopping
      // at the old 1536px cap
      expect(box.width).toBeGreaterThan(1500)

      // Centered in the area beside the side nav: the gap on the right must
      // not dwarf the gap on the left (the old bug left ~1000px dead).
      // Read the real side-nav width from the design token so this stays
      // correct as the shell is resized.
      const navWidth = await page.evaluate(() =>
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--sidenav-width")
        )
      )
      const leftGap = box.x - navWidth
      const rightGap = 2560 - (box.x + box.width)
      expect(Math.abs(leftGap - rightGap)).toBeLessThan(60)
    }
  })

  test("no horizontal scrolling at laptop or tablet width", async ({ page }) => {
    await signIn(page, "Dana Whitfield")

    for (const width of [1280, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of PAGES) {
        await page.goto(path)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
        expect(overflow, `${path} at ${width}px overflows horizontally`).toBeLessThanOrEqual(1)
      }
    }
  })

  test("footer branding is present but understated", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")

    const copyright = page.getByText(/© \d{4} Tenure\. All rights reserved\./)
    await expect(copyright).toBeVisible()

    const fontSize = await copyright.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize)
    )
    expect(fontSize).toBeLessThanOrEqual(12)
  })
})
