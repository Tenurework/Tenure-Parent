import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * GE-022-004 — the document's language and direction come from the tenant.
 *
 * `textDirectionFor` and the business calendar are proved by unit test; what a
 * unit test cannot prove is that the value reaches `<html>`. `lang="en"` was
 * hardcoded in the root layout, which meant every tenant declared English to
 * every screen reader regardless of what it was configured to — a WCAG 3.1.1
 * failure that no amount of correct configuration would have fixed.
 *
 * These drive it through the real cookie, because the cookie IS the mechanism.
 */
test.describe("the document announces the tenant's language", () => {
  test("lang and dir are on the document at all", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")

    const doc = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
    }))
    // Not empty. `dir` unset resolves to `auto` in some browsers, which guesses
    // per element and can disagree with itself down one page.
    expect(doc.lang).toBeTruthy()
    expect(["ltr", "rtl"]).toContain(doc.dir)
  })

  test("the pilot gets its configured locale, not a hardcoded 'en'", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")
    // `rochester` is bound to the university blueprint, which sets en-US. The
    // point is the specificity: a hardcoded "en" also looks correct here, and
    // "en-US" can only have come from the registry.
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-US")
  })

  test("a different tenant produces a different document", async ({ page }) => {
    await signIn(page, "Dana Whitfield")

    // Set the presentation cookie directly. It is the whole mechanism, and it
    // is safe to forge by design: it decides formatting and nothing else, which
    // `lib/tenant-switching.itest.ts` covers from the other side by proving
    // authority is re-derived from the database on every request.
    await page.context().addCookies([
      {
        name: "tenure.acting-slug",
        value: "midtown-arts",
        url: page.url().replace(/\/[^/]*$/, ""),
      },
    ])
    await page.goto("/dashboard")
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-GB")

    // And the right-to-left fixture, which is the case neither real tenant can
    // exercise: both are English and left-to-right, so without this the
    // direction logic would be true by accident.
    await page.context().addCookies([
      {
        name: "tenure.acting-slug",
        value: "fixture-rtl",
        url: page.url().replace(/\/[^/]*$/, ""),
      },
    ])
    await page.goto("/dashboard")
    const rtl = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      // The property every logical CSS value resolves against. If `dir` were
      // only an attribute nothing read, this would still say ltr.
      computed: getComputedStyle(document.documentElement).direction,
    }))
    expect(rtl).toEqual({ lang: "ar-AE", dir: "rtl", computed: "rtl" })

    // `dir` on its own only right-aligns text. The frame has to move too: a
    // right-to-left reader whose navigation is still pinned to the left is
    // reading a left-to-right layout with the words turned round. These are the
    // shell's physical properties made logical.
    const frame = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Primary navigation"]')!
      const main = document.querySelector("main")!
      return {
        navRight: Math.round(nav.getBoundingClientRect().right),
        viewport: document.documentElement.clientWidth,
        mainPaddingStart: getComputedStyle(main).paddingInlineStart,
        navWidth: getComputedStyle(document.documentElement).getPropertyValue("--sidenav-width").trim(),
      }
    })
    // The nav's right edge is the viewport's right edge — it is on the far side.
    expect(frame.navRight).toBe(frame.viewport)
    // And the content is inset from the same side the nav is on.
    expect(frame.mainPaddingStart).toBe(frame.navWidth)
  })

  test("an unknown tenant renders the platform default rather than failing", async ({ page }) => {
    // Formatting is not an authority decision. A slug with no binding should
    // give the default conventions, not a 500.
    await signIn(page, "Dana Whitfield")
    await page.context().addCookies([
      { name: "tenure.acting-slug", value: "no-such-tenant", url: page.url().replace(/\/[^/]*$/, "") },
    ])
    const response = await page.goto("/dashboard")
    expect(response?.status()).toBeLessThan(400)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-US")
  })
})
