import { test, expect, type Page } from "@playwright/test"

/**
 * GE-022-007 — the launcher in a browser.
 *
 * These cover the three things a command palette usually breaks, none of which
 * a unit test can see: where focus goes, what the Back button does afterwards,
 * and whether the page moved under the operator while it was open. Bible
 * §26.3.8 names context loss as the thing to minimise, and all three are it.
 */

const OPERATOR = process.env.PLATFORM_OPERATORS ?? ""
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  expect(OPERATOR, "PLATFORM_OPERATORS must be set").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set").not.toBe("")
})

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
  await page.goto("/")
  await page.waitForLoadState("networkidle")
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Command search" })
const open = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+k")
  await expect(palette(page)).toBeVisible()
}

test.describe("opening and closing", () => {
  test("opens on the shortcut and closes on Escape", async ({ page }) => {
    await signIn(page)
    await open(page)
    await page.keyboard.press("Escape")
    await expect(palette(page)).toBeHidden()
  })

  test("the shortcut toggles rather than only opening", async ({ page }) => {
    await signIn(page)
    await open(page)
    await page.keyboard.press("ControlOrMeta+k")
    await expect(palette(page)).toBeHidden()
  })

  test("takes focus into the input, so typing goes where it looks", async ({ page }) => {
    await signIn(page)
    await open(page)
    expect(await page.evaluate(() => document.activeElement?.className)).toContain("palette-input")
  })

  test("returns focus exactly where it came from", async ({ page }) => {
    // The one that matters most. A palette that drops focus on <body> sends a
    // keyboard user to the top of the document, so pressing Escape costs them
    // their place — the context loss §26.3.8 names, delivered by the component
    // meant to prevent it.
    await signIn(page)
    const trigger = page.locator(".pref-trigger")
    await trigger.focus()
    const before = await page.evaluate(() => document.activeElement?.className)

    await open(page)
    await page.keyboard.press("Escape")
    await expect(palette(page)).toBeHidden()

    expect(await page.evaluate(() => document.activeElement?.className)).toBe(before)
  })

  test("closes on the backdrop but not on the panel", async ({ page }) => {
    // A click that lands on the panel and drifts a pixel must not discard what
    // was typed.
    await signIn(page)
    await open(page)
    await page.locator(".palette-input").fill("plat")
    await page.locator(".palette").click({ position: { x: 5, y: 5 } })
    await expect(palette(page)).toBeVisible()

    await page.locator(".palette-backdrop").click({ position: { x: 5, y: 5 } })
    await expect(palette(page)).toBeHidden()
  })
})

test.describe("it does not disturb the page it opens over", () => {
  test("opening adds no history entry, so Back still goes back", async ({ page }) => {
    // A palette that pushes history makes Back close the palette instead of
    // navigating, and the operator who wanted the previous page presses it
    // twice and overshoots.
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    await open(page)
    await page.keyboard.press("Escape")
    await expect(palette(page)).toBeHidden()

    await page.goBack()
    await page.waitForLoadState("networkidle")
    // Back from /tenants lands on / — not on "/tenants with the palette shut".
    expect(new URL(page.url()).pathname).toBe("/")
  })

  test("does not move the page underneath it", async ({ page }) => {
    // The usual `body { overflow: hidden }` lock collapses the scrollbar and,
    // on a page taller than the viewport, shifts and jumps the content. The
    // operator closes the palette somewhere they did not leave.
    await signIn(page)
    await page.goto("/platform")
    await page.waitForLoadState("networkidle")
    await page.setViewportSize({ width: 1000, height: 600 })
    await page.evaluate(() => window.scrollTo(0, 400))

    // Both axes. Neither is sufficient on its own and neither catches the
    // classic defect here, which is worth being precise about: a mutation
    // adding `body { overflow: hidden }` passed BOTH. `overflow: hidden` does
    // not move window.scrollY, and headless Chromium draws overlay scrollbars
    // of zero width, so removing one shifts nothing. The symptom needs a
    // classic scrollbar to appear at all.
    //
    // So the mechanism is asserted directly below instead of its symptom. That
    // is weaker — it guards the implementation rather than the outcome — and
    // saying so is better than a measurement that looks like proof and is not.
    const measure = () =>
      page.evaluate(() => ({
        scrollY: window.scrollY,
        contentX: document.querySelector("main")!.getBoundingClientRect().x,
        contentWidth: document.querySelector("main")!.getBoundingClientRect().width,
      }))

    const before = await measure()
    expect(before.scrollY).toBeGreaterThan(0)

    await open(page)
    expect(await measure()).toEqual(before)

    // The direct assertion: nothing locks the page's scroll while the palette
    // is open. This is what actually catches the mutation.
    expect(
      await page.evaluate(() => [
        getComputedStyle(document.body).overflow,
        getComputedStyle(document.documentElement).overflow,
      ]),
    ).not.toContain("hidden")

    await page.keyboard.press("Escape")
    await expect(palette(page)).toBeHidden()
    expect(await measure()).toEqual(before)
  })
})

test.describe("finding and going", () => {
  test("filters as you type and Enter navigates", async ({ page }) => {
    await signIn(page)
    await open(page)
    await page.locator(".palette-input").fill("platf")
    await expect(page.getByRole("option").first()).toContainText("Platform")

    await page.keyboard.press("Enter")
    // waitForURL, not waitForLoadState: `router.push` is a client-side
    // navigation, and "networkidle" resolves before the URL has changed. The
    // first version of this test read the OLD path and reported a broken
    // launcher that worked perfectly.
    await page.waitForURL("**/platform")
    expect(new URL(page.url()).pathname).toBe("/platform")
  })

  test("arrow keys move the selection and it wraps", async ({ page }) => {
    await signIn(page)
    await open(page)
    const options = page.getByRole("option")
    const count = await options.count()
    expect(count).toBeGreaterThan(1)

    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("ArrowDown")
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true")
    // Up from the second is the first; up again wraps to the last.
    await page.keyboard.press("ArrowUp")
    await page.keyboard.press("ArrowUp")
    await expect(options.nth(count - 1)).toHaveAttribute("aria-selected", "true")
  })

  test("universal create is reachable from anywhere", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")
    await page.waitForLoadState("networkidle")
    await open(page)
    await page.locator(".palette-input").fill("new")
    await page.keyboard.press("Enter")
    await page.waitForURL("**/tenants/new")
    expect(new URL(page.url()).pathname).toBe("/tenants/new")
  })

  test("says so when nothing matches, rather than offering something else", async ({ page }) => {
    await signIn(page)
    await open(page)
    await page.locator(".palette-input").fill("zzzznope")
    await expect(page.getByRole("option")).toHaveCount(0)
    await expect(page.locator(".palette-none")).toBeVisible()
  })

  test("remembers where you went, and offers it first next time", async ({ page }) => {
    await signIn(page)
    await open(page)
    await page.locator(".palette-input").fill("platf")
    await page.keyboard.press("Enter")
    await page.waitForURL("**/platform")

    await open(page)
    // No query: the most recent destination leads.
    await expect(page.getByRole("option").first()).toContainText("Platform")
  })

  test("a pin survives a reload", async ({ page }) => {
    await signIn(page)
    await open(page)
    await page.getByRole("button", { name: /^Pin / }).first().click()
    await page.keyboard.press("Escape")

    await page.reload()
    await page.waitForLoadState("networkidle")
    await open(page)
    await expect(page.getByRole("button", { name: /^Unpin / })).toHaveCount(1)
  })
})

test("every launcher control clears the target-size floor", async ({ page }) => {
  // WCAG 2.2 AA 2.5.8. A dense list of rows is exactly where 24px gets lost.
  await signIn(page)
  await open(page)
  const small = await page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll(".palette button, .palette input"))) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      if (box.height < 24 || box.width < 24) out.push(`${el.className} ${box.width.toFixed(0)}x${box.height.toFixed(0)}`)
    }
    return out
  })
  expect(small).toEqual([])
})
