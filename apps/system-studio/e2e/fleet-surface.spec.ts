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

  test("the sixteen columns are all present and all have a source", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    const headers = await page.locator("table.grid.fleet thead th").allTextContents()
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

  test("the count says how much of the fleet is on screen", async ({ page }) => {
    // STUDIO-030-011. A truncated table that does not say so reads as complete.
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    const count = page.getByTestId("fleet-count")
    await expect(count).toBeVisible()

    const rows = await page.locator("table.grid.fleet tbody tr").count()
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
