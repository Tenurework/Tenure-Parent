import { test, expect, type Page } from "@playwright/test"

/**
 * STUDIO-100-001 / 100-002 / 030-011 — the fleet table, driven in a browser.
 *
 * Every assertion here is one the pure `fleet-health-logic.spec.ts` cannot make,
 * and that is the whole reason this file exists. That spec calls `healthOf()`
 * with an input it constructs, so it passes whatever the page passes — and the
 * page passed a literal `hasDeployment: true` for every tenant, which made the
 * `never-deployed` branch unreachable from the only production caller there is.
 * A helper's test cannot see a producer that stopped using it.
 *
 * So this reads the rendered page for a tenant seeded WITHOUT a DEPLOYMENT sort
 * key (`tools/dev/seed-studio-fleet.mjs`), which is a property of the data
 * rather than of a fixture flag.
 */

const OPERATOR = (process.env.PLATFORM_OPERATORS ?? "").split(",")[0]?.split(":")[0]?.trim() ?? ""
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = !!process.env.TENANT_TABLE

/**
 * The fleet inventory, located by what it SAYS rather than by what it is
 * styled with.
 *
 * It used to be `table.grid.fleet`. That class pair is gone: the surface now
 * composes `components/md3/DataTable`, whose whole point is that a header and
 * its cells are derived from one declaration — so a table's identity is its
 * required, visible caption rather than a class name a restyle can take away.
 *
 * The assertions underneath are unchanged and are the part that matters: the
 * same sixteen columns, in the same order, with the same four probe strings.
 * `page.getByTestId("fleet-count")` still pins the truncation sentence. Nothing
 * here is weaker than it was; it is pinned to different markup because the
 * markup deliberately changed.
 */
function fleetTable(page: Page) {
  return page.locator("table", {
    has: page.locator("caption", { hasText: "Tenants registered in this console" }),
  })
}

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

test.describe("the fleet table", () => {
  test.skip(!configured, "needs TENANT_TABLE and a reachable DynamoDB")

  test("a tenant with no deployment row is reported never deployed", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    // The seeded pair differ in exactly one thing: whether a DEPLOYMENT item
    // exists under their partition. If `hasDeployment` were assumed, both would
    // read the same and this assertion would be impossible to write.
    const row = page.locator("tr", { has: page.getByRole("link", { name: "seed-nodeploy" }) })
    await expect(row).toContainText(/never.deployed/i)

    const healthy = page.locator("tr", { has: page.getByRole("link", { name: "seed-deployed" }) })
    await expect(healthy).not.toContainText(/never.deployed/i)
  })

  /**
   * Seventeen, not sixteen — and the seventeenth is the point of the change.
   *
   * `State last read` was added deliberately and this list is updated rather
   * than loosened: it still pins every header, in order, exactly. Nine of the
   * other columns are registry facts and two (`Health / SLO`, and the blockers
   * derived from it) can be readings of the live estate, and a row that printed
   * both with no attribution made `ACTIVE` and `dependency failing` look like
   * one verdict from one source — when in fact one is a DynamoDB row somebody
   * last wrote in March and the other is a certificate that expired this
   * morning. The assertions below are strictly more than they were.
   */
  test("the seventeen columns are all present and all have a source", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    const headers = await fleetTable(page).locator("thead th").allTextContents()
    expect(headers.map((h) => h.trim())).toEqual([
      "Tenant",
      "Owner",
      "Lifecycle",
      "Plan",
      "Cell / account / region",
      "Isolation",
      "Release / config / schema",
      "Health / SLO",
      "Last activity",
      "State last read",
      "Data volume",
      "Resources",
      "Actual / forecast",
      "Drift",
      "Blockers",
      "Next action",
      "Cost note",
    ])

    const row = page.locator("tr", { has: page.getByRole("link", { name: "seed-deployed" }) })
    // Owner, plan, cell and release come from the REGISTRY row, which the
    // previous projection did not read at all.
    await expect(row).toContainText("owner@seed-deployed.example")
    await expect(row).toContainText("growth")
    await expect(row).toContainText("seed-release")
    // The three honest probe states. Blanks here would read as zero.
    await expect(row).toContainText("not measured")
    await expect(row).toContainText("not inventoried")
    await expect(row).toContainText("no bill connected")
  })

  test("the fleet is listed worst first, not in the Scan's order", async ({ page }) => {
    /*
     * The question this page answers ends "…and which need me right now?", and
     * an inventory in DynamoDB's partition order answers it by accident at
     * best. `seed-nodeploy` is ACTIVE with no DEPLOYMENT row — `never-deployed`,
     * which outranks everything the other two carry — and `seed-deployed` sits
     * in PURGE_PENDING with a deployment, which is somewhere somebody put it on
     * purpose and needs nobody.
     *
     * Asserted on ROW POSITION rather than on a class or an attribute, because
     * position is the whole of what an operator gets from ranking: the tenant
     * that needs them is on the first screen or it is not.
     */
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    const slugs = await fleetTable(page).locator("tbody tr td:first-child a").allTextContents()
    const needsAnOperator = slugs.indexOf("seed-nodeploy")
    const needsNobody = slugs.indexOf("seed-deployed")

    expect(needsAnOperator, "seed-nodeploy is not in the inventory").toBeGreaterThanOrEqual(0)
    expect(needsNobody, "seed-deployed is not in the inventory").toBeGreaterThanOrEqual(0)
    expect(
      needsAnOperator,
      "the tenant with a never-deployed signal must be listed above the one that needs nobody",
    ).toBeLessThan(needsNobody)
  })

  test("every row says when its state was read, and from which of the two sources", async ({
    page,
  }) => {
    /*
     * The registry and the live estate are different sources with different
     * clocks, and a row that silently mixes them is unreadable. Both are named
     * on every row, and neither is allowed to render as a blank — a blank in
     * this column reads as "fine", which is precisely what an unobserved tenant
     * is not known to be.
     */
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    const row = page.locator("tr", { has: page.getByRole("link", { name: "seed-deployed" }) })
    const cell = row.locator("td").nth(9)

    await expect(cell).toContainText("registry")
    await expect(cell).toContainText("live estate")
    // An ISO instant, not a localised one: two operators comparing the same
    // screenshot have to be able to agree about when this was read.
    await expect(cell).toContainText(/read \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    // The estate half is either an instant or the explicit admission that no
    // reading was taken. It is never empty.
    await expect(cell).toContainText(/observed \d{4}-\d{2}-\d{2}T|not observed/)
  })

  test("the count says how much of the fleet is on screen", async ({ page }) => {
    // STUDIO-030-011. A truncated table that does not say so reads as complete.
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    const count = page.getByTestId("fleet-count")
    await expect(count).toBeVisible()

    const rows = await fleetTable(page).locator("tbody tr").count()
    const text = (await count.textContent()) ?? ""
    const total = Number(text.match(/(\d+)\s+tenants/)?.[1] ?? text.match(/of\s+(\d+)/)?.[1] ?? 0)

    expect(total).toBeGreaterThan(0)
    if (rows < total) {
      expect(text, "a truncated table did not say it was truncated").toContain("showing")
    } else {
      expect(rows).toBe(total)
    }
  })

  test("the filter is the URL, and it narrows the table", async ({ page }) => {
    await signIn(page)

    await page.goto("/tenants?q=seed-nodeploy")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("link", { name: "seed-nodeploy" })).toBeVisible()
    await expect(page.getByRole("link", { name: "seed-deployed", exact: true })).toHaveCount(0)

    // `?signal=` runs through the same health the panel above uses, so a filter
    // and a badge cannot disagree.
    await page.goto("/tenants?signal=never-deployed")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("link", { name: "seed-nodeploy" })).toBeVisible()
    await expect(page.getByRole("link", { name: "seed-deployed", exact: true })).toHaveCount(0)

    // A filter that matches nothing says so, and says it differently from an
    // empty fleet — the distinction `EmptyState.because` exists for.
    await page.goto("/tenants?q=zzz-no-such-tenant")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("[data-state='empty']")).toContainText(/none match this filter/i)
  })
})
