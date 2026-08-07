import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"
import { RUN_ID } from "./run-id"

/**
 * TTES-020-002-GRID — the owned grid contract, on the densest surface in the
 * product.
 *
 * The audit log used to emit six bare `<th>` inside a table with no caption, no
 * `aria-rowcount` and no sortable header, so a screen-reader user in a 200-row
 * log got an unlabelled grid (WCAG 1.3.1).
 */
test.describe("audit log through the owned grid", () => {
  test("the table has a caption, scoped headers and a working sort", async ({ page }) => {
    // Force at least one audit row into this institution through the product's
    // own path — an override is audited — so the grid has data to render.
    const title = `E2E Grid ${RUN_ID}`
    await signIn(page, "Victor Chen")
    await page.goto("/orgs/simon-consulting-club/memory")
    await page.getByLabel("Type").selectOption("VENDOR")
    await page.getByLabel("Title").fill(title)
    await page
      .getByPlaceholder("The details your successor will thank you for.")
      .fill(`grid fixture ${RUN_ID}`)
    await page.getByRole("button", { name: "Save card" }).click()
    await expect(page.getByText(title)).toBeVisible()

    await signIn(page, "Dana Whitfield")
    await page.goto("/admin/overrides")
    const row = page.locator("li").filter({ hasText: title })
    await row.getByRole("button", { name: "Archive" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Archive memory record" }).click()
    await expect(row.getByText("archived")).toBeVisible()

    await page.goto("/admin/audit")
    const table = page.locator("table").first()
    await expect(table).toBeVisible()

    // A name, so the grid is announced as something rather than as "table".
    await expect(table.locator("caption")).toContainText("Audit log")

    // Every header carries scope="col". This is the 1.3.1 failure.
    const headers = table.locator("thead th")
    const count = await headers.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(headers.nth(i)).toHaveAttribute("scope", "col")
    }

    // aria-rowcount, so a reader knows how far the grid goes.
    await expect(table).toHaveAttribute("aria-rowcount", /^\d+$/)

    // Sorting is real, announced, and survives a reload — the order is a URL
    // parameter, computed by sortRows in data-table-model.ts.
    const actionHeader = table.locator('th[scope=col]').filter({ hasText: "Action" })
    await expect(actionHeader).toHaveAttribute("aria-sort", "none")
    await actionHeader.getByRole("link").click()
    await page.waitForURL(/sort=action%3Aasc|sort=action:asc/)

    const sortedHeader = page.locator("table th[scope=col]").filter({ hasText: "Action" })
    await expect(sortedHeader).toHaveAttribute("aria-sort", "ascending")

    const actions = await page
      .locator("table tbody tr")
      .evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("td")[2]?.textContent?.trim() ?? ""))
    expect(actions.length).toBeGreaterThan(0)
    expect([...actions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))).toEqual(
      actions,
    )

    // ...and descending is the same comparator with the direction honoured.
    await sortedHeader.getByRole("link").click()
    await page.waitForURL(/sort=action%3Adesc|sort=action:desc/)
    const descending = await page
      .locator("table tbody tr")
      .evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("td")[2]?.textContent?.trim() ?? ""))
    expect([...descending].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))).toEqual(
      descending,
    )
  })
})
