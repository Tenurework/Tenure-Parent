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
    /**
     * A band with no amount in it is a broken table, not a zero. Assert the cell
     * was there before parsing it, so the failure names the missing amount rather
     * than arriving later as a NaN comparison nobody can read.
     */
    const value = (amount: string | undefined) => {
      expect(amount, "a threshold band named no dollar amount").toBeDefined()
      return parseFloat(String(amount).replace(/[$,]/g, ""))
    }

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

/**
 * The other two thirds of the question.
 *
 * The page's heading asks three things — what is this fleet costing, who is it
 * costing it for, and is anything running away — and until this route consumed
 * the tag and budget readers it answered only the first, and only in the arm
 * where a Cost and Usage Report exists, which is no arm at all today. These
 * assertions are about the two answers that ARE available before a bill: the
 * `tenure:tenant` attribution of the estate, and AWS's own budget forecasts.
 *
 * They are written to hold in EVERY arm of both reads. In this job the AWS
 * credentials are DynamoDB-Local shaped, so both reads come back refused and
 * both panels render the shared `UnknownState` — but a spec that assumed that
 * would red the day the job is given a real read-only role, which is a change
 * that should make this page better rather than break its tests. So each check
 * asserts the property that must hold whatever came back: the panel says what it
 * is as of, it renders one of the three legitimate shapes, and a read that could
 * not be performed is never worded as good news.
 */
test.describe("the FinOps Center answers all three parts of its question", () => {
  test("asks the question at the top, in words, before any apparatus", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform/cost")

    await expect(
      page.getByText(
        "What is this fleet costing, who is it costing it for, and is anything running away?",
      ),
    ).toBeVisible()
  })

  test("answers the three parts in the order the question asks them", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform/cost")

    const headings = await page.getByRole("heading", { level: 2 }).allTextContents()
    const at = (text: string) => headings.findIndex((heading) => heading.includes(text))

    // The cost answer is still first — an operator arriving here wants a number
    // before they want any of the machinery that produced it.
    expect(at("What the fleet costs this month")).toBe(0)
    expect(at("Who it is costing it for")).toBeGreaterThan(at("What the fleet costs this month"))
    expect(at("Is anything running away")).toBeGreaterThan(at("Who it is costing it for"))
    // And what a new commitment needs to be approved comes last, because it is
    // policy rather than a reading.
    expect(at("Approval thresholds")).toBeGreaterThan(at("Is anything running away"))
  })

  test("both AWS panels say what they are as of, in every arm", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform/cost")

    for (const panel of ["Who it is costing it for", "Is anything running away"]) {
      const section = page.locator("section", { hasText: panel })
      await expect(section, `${panel} does not say what it is as of`).toContainText(/as of/i)
    }
  })

  test("neither AWS panel can render as an empty region", async ({ page }) => {
    // STUDIO-000-007. A read this engine could not perform must never render as
    // an empty list. Each panel shows exactly one of three legitimate shapes —
    // the UnknownState, a table of what was read, or a stated emptiness — and
    // "nothing at all" is not among them.
    await signIn(page)
    await page.goto("/platform/cost")

    for (const panel of ["Who it is costing it for", "Is anything running away"]) {
      const section = page.locator("section", { hasText: panel })
      const shapes = section.locator("[data-reason], table.md3-table, .md3-empty")
      expect(await shapes.count(), `${panel} rendered nothing at all`).toBeGreaterThan(0)
    }
  })

  test("a refused read is never worded as good news", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform/cost")

    const budgets = page.locator("section", { hasText: "Is anything running away" })
    if ((await budgets.locator("[data-reason]").count()) > 0) {
      // The engine could not read the budgets. It may not say anything is within
      // its limit, and it must say the word.
      await expect(budgets).not.toContainText(/within limits/i)
      await expect(budgets).toContainText(/UNKNOWN/i)
      // And the refusal carries its own remedy rather than a support link.
      await expect(budgets).toContainText(/capability/i)
    }

    const attribution = page.locator("section", { hasText: "Who it is costing it for" })
    if ((await attribution.locator("table.md3-table").count()) > 0) {
      // Shared is a decision somebody made; untagged is a gap. Two facts, and
      // the page states them separately or not at all.
      await expect(attribution).toContainText("Shared, by decision")
      await expect(attribution).toContainText("Reaching no tenant at all")
    }
  })

  test("a budget that cannot be shown to notify anybody is not reported as fine", async ({
    page,
  }) => {
    /*
     * The defect this page exists to stop. A budget alert threshold with an
     * empty subscriber list fires into nothing: AWS evaluates the notification,
     * it is breached, and no human is told — and on every console that has ever
     * shipped that renders as the same quiet row as a budget that is fine.
     *
     * This engine cannot read subscriber lists yet, so when it CAN see budgets,
     * every one of them must carry the unknown in its own row.
     */
    await signIn(page)
    await page.goto("/platform/cost")

    const budgets = page.locator("section", { hasText: "Is anything running away" })
    const rows = budgets.locator("table.md3-table tbody tr")
    const count = await rows.count()
    if (count > 0 && (await budgets.locator(".md3-empty").count()) === 0) {
      await expect(budgets).toContainText(/notif/i)
      for (let index = 0; index < count; index += 1) {
        await expect(rows.nth(index)).not.toHaveText("")
      }
    }
  })
})

/**
 * The rate a quote is built from — STUDIO-070-004 (Pricing adapter).
 *
 * The three panels above answer what the fleet HAS spent. None of them answers
 * what a change WOULD cost, which is what every approval on this page is
 * actually about, and Cost Explorer cannot answer it either — it reports
 * consumption. `lib/aws/pricing.ts` reads AWS's own published on-demand rates
 * for the shapes this estate provisions, and until this panel existed that
 * reader — real, tested, with a capability and an IAM grant — reached no screen
 * at all.
 *
 * These assertions are written to hold in EVERY arm, for the reason the block
 * above gives: in this job the credentials are DynamoDB-Local shaped, so the
 * region does not resolve and most shapes come back unconfigured — but a spec
 * that assumed that would red the day the job is given a real read-only role,
 * which is a change that should make this page better rather than break its
 * tests.
 */
test.describe("the FinOps Center shows the rate a quote is built from", () => {
  const RATES = "What its shapes cost, per unit"

  test("prices the shapes this estate provisions, and says what it is as of", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform/cost")

    await expect(page.getByRole("heading", { name: RATES })).toBeVisible()

    const rates = page.locator("section", { hasText: RATES }).first()
    await expect(rates, "the rates panel does not say what it is as of").toContainText(/as of/i)

    // One of the three legitimate shapes, never nothing at all. STUDIO-000-007.
    const shapes = rates.locator("[data-reason], table.md3-table, .md3-empty")
    expect(await shapes.count(), "the rates panel rendered nothing at all").toBeGreaterThan(0)

    // The quantity behind any monthly figure is on the page rather than implied:
    // a monthly cost is a rate times a quantity, and a page showing the product
    // while hiding the quantity is showing an opinion.
    await expect(rates).toContainText(/730 hours/)
  })

  test("never prints a total that costed an unpriced shape at zero", async ({ page }) => {
    /*
     * The rule this panel exists to hold. A total is stated only when every
     * shape resolved; one denial, one throttle, one ambiguous SKU and the figure
     * is the word Unknown. The most convincing wrong answer available is the sum
     * of whatever happened to resolve, printed under the word total — so this
     * asserts on the total block itself rather than on the page, where the rows'
     * own figures legitimately appear.
     */
    await signIn(page)
    await page.goto("/platform/cost")

    const total = page.locator('dl[aria-label^="The running total"]')
    await expect(total).toHaveCount(1)

    const text = (await total.textContent()) ?? ""
    if (/Unknown/.test(text)) {
      expect(text, "an unknown total printed a currency amount anyway").not.toMatch(/\$\d/)
      // And it says what would make it knowable, rather than just refusing.
      expect(text).toMatch(/unpriced|no resolved rate|currenc|hourly/i)
      // A commitment whose cost is unknown may not be banded as though it were
      // small — that is the approval this page's thresholds govern.
      expect(text).toMatch(/cannot be approved on cost/i)
    } else {
      // If it IS known, it names what is in it and what is not. A total whose
      // composition is invisible is a total nobody can check.
      expect(text).toMatch(/hourly shape/i)
    }
  })

  test("a rate it could not read is a refusal with a remedy, never a free shape", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/platform/cost")

    const rates = page.locator("section", { hasText: RATES }).first()

    if ((await rates.locator("[data-reason]").count()) > 0) {
      // The refusal carries the capability and its own remedy rather than a
      // support link, exactly as every other panel's does.
      await expect(rates).toContainText(/pricing:GetProducts/)
      await expect(rates).toContainText(/capability/i)
    }

    /*
     * And nothing in this panel prices anything at zero — not a refused read,
     * and not a real sub-cent rate rendered at the currency's display precision.
     * `$0.0000001250` per write request unit formatted as `$0.00` is a genuine
     * charge shown as free, on the surface a database gets approved from.
     */
    await expect(rates).not.toContainText("$0.00")
  })

  test("keeps the approval verdicts out of a second table", async ({ page }) => {
    /*
     * The approval bands are policy, stated once. This panel reads that policy
     * against one figure and renders the verdict in its own description list —
     * never in a table cell, because a second cell carrying the same verdict
     * word makes the band table's assertions above resolve two elements and
     * turns a policy statement into a policy that appears to be stated twice.
     */
    await signIn(page)
    await page.goto("/platform/cost")

    const rates = page.locator("section", { hasText: RATES }).first()
    await expect(rates.getByRole("cell", { name: /executive/i })).toHaveCount(0)
    await expect(rates.getByRole("cell", { name: "two people" })).toHaveCount(0)

    // And the band table itself still resolves to exactly one cell per verdict.
    await expect(page.getByRole("cell", { name: "two people" })).toHaveCount(1)
    await expect(page.getByRole("cell", { name: /executive/i })).toHaveCount(1)
  })
})
