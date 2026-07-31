import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** VP of Finance dashboard: actual-vs-budget chart, live forecasting, Excel upload.
 *
 * The chart asserts as role="group", not role="img". Charts here are
 * interactive — every bar is a focusable hit target carrying its own value in
 * an aria-label — and role="img" makes an element's entire subtree
 * presentational, which silenced all of those. The accessible name being
 * checked is unchanged; only the role it hangs on is corrected. */

const FINANCE_URL = "/orgs/simon-consulting-club/finance"

test.describe("finance dashboard", () => {
  test("VP of Finance lands on a Club finances card that links to the graph", async ({
    page,
  }) => {
    await signIn(page, "Victor Chen")

    // Straight on the dashboard — no digging through club tabs
    await expect(page.getByText("Club finances")).toBeVisible()
    await expect(page.getByText(/of .* spent/).first()).toBeVisible()

    await page
      .getByRole("link", { name: /Simon Consulting Club/ })
      .first()
      .click()
    await expect(page).toHaveURL(/\/orgs\/simon-consulting-club\/finance/)
    await expect(
      page.getByRole("group", { name: /Budget versus actual spending/ })
    ).toBeVisible()
  })

  test("VP of Finance sees budget lines, summary and the chart", async ({ page }) => {
    await signIn(page, "Victor Chen") // VP Finance & Operations, consulting club
    await page.goto(FINANCE_URL)

    await expect(page.getByText("Total budget")).toBeVisible()
    await expect(page.getByText("Spent to date")).toBeVisible()
    await expect(
      page.getByRole("group", { name: /Budget versus actual spending/ })
    ).toBeVisible()
    // Rendered in both the chart and the table
    await expect(page.getByText("Catering & Food").first()).toBeVisible()
  })

  test("editing a projected value updates savings live, without saving", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto(FINANCE_URL)

    // Seeded totals leave the club projecting a saving
    await expect(page.getByText("Projected savings")).toBeVisible()

    // Push one category's projection way past budget → now an overspend
    const travel = page.getByLabel("Projected spend for Travel (Career Treks)")
    await travel.fill("9000")
    await travel.blur()

    await expect(page.getByText("Projected overspend")).toBeVisible()
    await expect(
      page.getByText(/Unsaved projection/)
    ).toBeVisible()
  })

  test("a general member gets a read-only view", async ({ page }) => {
    await signIn(page, "Maya Johnson") // Member, consulting club
    await page.goto(FINANCE_URL)

    await expect(page.getByText("Total budget")).toBeVisible()
    await expect(page.getByText(/Read-only/)).toBeVisible()
    // No editable projection inputs
    await expect(page.getByLabel(/Projected spend for/)).toHaveCount(0)
  })

  test("VP of Finance can add a budget line", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto(FINANCE_URL)

    const unique = `Test Line ${Date.now()}`
    await page.getByPlaceholder("Category, e.g. Catering").fill(unique)
    await page.getByLabel("Budgeted").fill("500")
    await page.getByLabel("Spent so far").fill("120")
    await page.getByRole("button", { name: "Add line" }).click()

    // Appears in both the chart and the table
    await expect(page.getByText(unique).first()).toBeVisible()
  })

  test("budget template downloads and round-trips through the importer", async ({ page }) => {
    await signIn(page, "Victor Chen")

    // Download via the real route, with the session cookie
    const res = await page.request.get("/api/templates/budget")
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toContain("spreadsheetml")
    expect(res.headers()["content-disposition"]).toContain("Budget Template")

    // The template must survive its own importer: fill in two rows the way a
    // club would, upload, and expect a clean parse of exactly those rows.
    const XLSX = await import("xlsx")
    const wb = XLSX.read(await res.body(), { type: "buffer" })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    expect(wb.SheetNames[0]).toBe("Club Budget")
    XLSX.utils.sheet_add_aoa(sheet, [[1500, 900]], { origin: "B2" }) // Catering row
    const filled = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    await page.goto(FINANCE_URL)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "Tenure Club Budget Template.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: filled,
    })

    // Exactly one category read (the one with numbers); Total row skipped
    await expect(page.getByText(/Read 1 category\b/)).toBeVisible()
    await expect(page.getByText("Catering & Food").first()).toBeVisible()
  })

  test("template is linked from the resources hub", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/resources")

    const link = page.getByRole("link", { name: /Club Budget Template/ }).first()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute("href", "/api/templates/budget")
  })

  test("uploading a spreadsheet turns it into the dashboard", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto(FINANCE_URL)

    const csv = [
      "Category,Planned Budget,Amount Spent",
      "Workshop Series,1500,900",
      "Networking Night,800,650",
      "Total,2300,1550",
    ].join("\n")

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "budget.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    })

    // Preview reads two rows and skips the Total row
    await expect(page.getByText(/Read 2 categories/)).toBeVisible()
    await expect(page.getByText(/skipped 1 row/)).toBeVisible()

    await page.getByRole("button", { name: /Replace imported lines/ }).click()

    // The imported categories now appear in the live dashboard (chart + table)
    await expect(page.getByText("Workshop Series").first()).toBeVisible()
    await expect(page.getByText("Networking Night").first()).toBeVisible()
  })

  test("a line's actual drills down to its ledger, and posting recomputes it", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto(FINANCE_URL)

    // Click the Catering & Food actual to open the ledger drill-down.
    await page.getByRole("button", { name: "$1,875.00" }).first().click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Catering & Food — ledger")).toBeVisible()
    // Seeded transactions + their source (the vendor) are shown.
    await expect(dialog.getByText("Kickoff mixer catering")).toBeVisible()
    await expect(dialog.getByText("Rochester Catering Co.").first()).toBeVisible()

    // Post a $100 spend; the actual recomputes from the ledger to $1,975.00.
    await dialog.getByPlaceholder("What was this?").fill("E2E ledger spend")
    await dialog.getByPlaceholder("0.00").fill("100")
    await dialog.getByRole("button", { name: "Post entry" }).click()

    await expect(dialog.getByText("E2E ledger spend")).toBeVisible({ timeout: 10000 })
    await expect(dialog.getByText("$1,975.00")).toBeVisible()
  })
})
