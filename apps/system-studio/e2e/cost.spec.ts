import { test, expect, type Page } from "@playwright/test"

/**
 * STUDIO-120-008/009/010 — the FinOps Center in the browser.
 *
 * The page has two arms and only two: a Cost and Usage Report is connected and
 * every figure traces to a billed line, or none is and the page says so. There
 * is deliberately no third arm showing sample data, and most of these assertions
 * exist to keep it that way — this is the page an operator approves an Aurora
 * cluster from, and the bible's prohibited-shortcut list names "fake cost".
 *
 * An empty page is obviously empty. `$4,182.55` is actionable and wrong.
 */

const OPERATOR = process.env.PLATFORM_OPERATORS?.split(",")[0]?.trim() ?? ""
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
}

test.describe("the FinOps Center", () => {
  test("refuses to show a number it does not have", async ({ page }) => {
    // No CUR is connected in any environment yet, so the page must say that
    // rather than render a zero — "$0.00 spent this month" is a claim, and a
    // false one.
    await signIn(page)
    await page.goto("/platform/cost")

    await expect(page.getByRole("heading", { name: "Cost", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "No billing data is connected" })).toBeVisible()

    // The specific failure this guards: a currency figure appearing in the
    // month-to-date region while nothing is connected. Thresholds below are
    // allowed to show dollars — they are policy, not spend — so this is scoped
    // to the not-configured section.
    const section = page.locator("section", { hasText: "No billing data is connected" })
    await expect(section).not.toContainText(/\$\d/)
  })

  test("says exactly what an operator must do to connect it", async ({ page }) => {
    // A blocked dependency with a known remedy belongs where the gap is
    // visible. "Cost is unavailable" tells an operator nothing they can act on.
    await signIn(page)
    await page.goto("/platform/cost")

    const steps = page.locator("ol.steps li")
    await expect(steps).not.toHaveCount(0)
    await expect(page.locator("ol.steps")).toContainText("FINOPS_CUR_BUCKET")
    await expect(page.locator("ol.steps")).toContainText("tenure:tenant")
  })

  test("shows the approval thresholds whether or not billing is connected", async ({ page }) => {
    // They govern what a plan may commit to, and that is true before the first
    // bill arrives. STUDIO-120-010.
    await signIn(page)
    await page.goto("/platform/cost")

    await expect(page.getByRole("heading", { name: "Approval thresholds" })).toBeVisible()
    await expect(page.getByRole("cell", { name: "two people" })).toBeVisible()
    await expect(page.getByRole("cell", { name: /executive/i })).toBeVisible()

    // Monthly recurring, not one-off. The distinction is the whole point: a NAT
    // gateway is $32 to create and $390 a year to keep.
    await expect(page.locator("body")).toContainText(/recurring monthly/i)
  })

  test("is reachable from the console's own navigation", async ({ page }) => {
    // A page nobody can find is one nobody uses.
    await signIn(page)
    await page.getByRole("link", { name: "Cost", exact: true }).click()
    await page.waitForURL(/\/platform\/cost/)
    await expect(page.getByRole("heading", { name: "Cost", exact: true })).toBeVisible()
  })

  test("lights exactly one navigation entry", async ({ page }) => {
    // `/platform/cost` sits under `/platform`, and subtree matching alone lit
    // both — two current pages, which tells a reader nothing about where they
    // are. The most specific entry wins, and only it.
    await signIn(page)
    await page.goto("/platform/cost")
    await expect(page.locator('nav.tabs [aria-current="page"]')).toHaveCount(1)
    await expect(page.locator('nav.tabs [aria-current="page"]')).toHaveText("Cost")

    // And the parent still lights on its own page.
    await page.goto("/platform")
    await expect(page.locator('nav.tabs [aria-current="page"]')).toHaveCount(1)
    await expect(page.locator('nav.tabs [aria-current="page"]')).toHaveText("Platform")
  })

  test("is not reachable without an operator session", async ({ page }) => {
    await page.goto("/platform/cost")
    await page.waitForURL(/\/signin/)
  })
})
