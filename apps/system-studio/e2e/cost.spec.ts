import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

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

const OPERATOR = operatorFor()
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

/**
 * The structure, as against the content.
 *
 * These were added when the page was rebuilt on the Material 3 primitives, and
 * they exist because the defects they catch are the ones a `toBeVisible()` on
 * the old markup could not see: the page led with a paragraph about allocation
 * methodology instead of with a number, and a panel could describe the estate
 * without ever saying WHEN it was describing it.
 */
test.describe("the FinOps Center leads with the answer", () => {
  test("puts the answer above the apparatus, and never invents one", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform/cost")

    // First panel on the page, not the third. An operator arriving here wants a
    // number; how the number is produced is a second question and belongs under
    // the first.
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
      "What the fleet costs this month",
    )

    const answer = page.locator("section", { hasText: "What the fleet costs this month" })

    // Three tiles: what the fleet costs, what reached nobody, and who it was
    // attributed to. `who it costs it for` had no answer at all on this page
    // before, in either arm.
    await expect(answer).toContainText("Fleet total, month to date")
    await expect(answer).toContainText("Reached no tenant")
    await expect(answer).toContainText("Tenants with attributed spend")

    // No CUR is connected in any environment yet, so all three read Unknown —
    // the WORD. Not a zero, not a dash, not a sample. This is the assertion the
    // whole page exists to keep true: `$0.00 spent this month` is a claim, and a
    // false one, on the surface an Aurora cluster gets approved from.
    await expect(answer.getByText("Unknown", { exact: true })).toHaveCount(3)
    await expect(answer).not.toContainText(/\$\d/)

    // And each unknown says WHY it is unknown. "Unknown" on its own is a defect
    // report; "Unknown, because no bill has ever been read" is an answer.
    await expect(answer).toContainText(/no billed line has ever been read/i)
  })

  test("every panel says what it is as of", async ({ page }) => {
    // A panel that states a fact about the estate without stating when it was
    // true is a panel whose reader guesses, and the guess is always "now".
    await signIn(page)
    await page.goto("/platform/cost")

    for (const panel of [
      "What the fleet costs this month",
      "No billing data is connected",
      "Approval thresholds",
    ]) {
      const section = page.locator("section", { hasText: panel })
      await expect(section, `${panel} does not say what it is as of`).toContainText(/as of/i)
    }
  })

  test("reads the approval thresholds from the policy rather than transcribing them", async ({
    page,
  }) => {
    /*
     * The bands are built by feeding each boundary amount to `approvalFor` —
     * the same function `previewPlanCost` uses to gate a real plan — so the
     * table cannot disagree with the policy it describes.
     *
     * Asserting the CHAIN rather than the four literal amounts is deliberate:
     * the amounts are policy and may legitimately change, while the property
     * that band N+1 begins exactly where band N ends may not. A transcribed
     * table where somebody edited one constant and not the row beside it breaks
     * the chain; so does a mis-ordered verdict column.
     */
    await signIn(page)
    await page.goto("/platform/cost")

    const thresholds = page.locator("section", { hasText: "Approval thresholds" })
    const rows = await thresholds.locator("tbody tr").evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim())),
    )
    expect(rows).toHaveLength(4)

    const amountsIn = (cell: string) => cell.match(/\$[\d.,]+/g) ?? []
    const value = (amount: string) => parseFloat(amount.replace(/[$,]/g, ""))

    const [first, second, third, fourth] = rows.map((cells) => amountsIn(cells[0]))
    expect(first, "the first band is open at the bottom, so it names one amount").toHaveLength(1)
    expect(second[0], "the second band does not start where the first ends").toBe(first[0])
    expect(third[0], "the third band does not start where the second ends").toBe(second[1])
    expect(fourth[0], "the last band does not start where the third ends").toBe(third[1])
    expect(fourth, "the last band is open at the top, so it names one amount").toHaveLength(1)

    expect(value(second[0])).toBeGreaterThan(0)
    expect(value(third[0])).toBeGreaterThan(value(second[0]))
    expect(value(fourth[0])).toBeGreaterThan(value(third[0]))

    // Ascending, and each verdict on its own band.
    expect(rows.map((cells) => cells[1])).toEqual([
      "none",
      "one reviewer",
      "two people",
      "executive",
    ])
  })
})
