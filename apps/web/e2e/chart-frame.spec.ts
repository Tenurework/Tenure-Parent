import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * TTES-020-002-CHART-FRAME — every chart carries its provenance, an accessible
 * table alternative and an export.
 *
 * The assertion that matters is the last one: the table's cell values are
 * compared against the values the MARK plotted, read out of the SVG's own
 * per-point labels. A table assembled separately from the picture is a second
 * source of truth, and this is what stops the two drifting.
 */
test.describe("chart frame", () => {
  test("the dashboard Activity chart carries source, freshness, unit and a real table", async ({
    page,
  }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")

    const frame = page.locator('[data-chart-frame="tenure-activity-30-days"]')
    await expect(frame).toBeVisible()

    // §11's header line: the question, where the numbers came from, when, and
    // in what unit. None of this existed on a bare mark in a Card.
    await expect(frame).toContainText("How much is happening across my clubs")
    const provenance = frame.locator("[data-chart-provenance]")
    await expect(provenance).toContainText("Audit events for the clubs you can see")
    await expect(provenance).toContainText("as of")
    await expect(provenance).toContainText("events per day")

    // The alternative, disclosed rather than always open.
    const toggle = frame.getByRole("button", { name: "Show the numbers" })
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await toggle.click()
    await expect(frame.getByRole("button", { name: "Hide the numbers" })).toBeVisible()

    const table = frame.locator("table")
    await expect(table).toBeVisible()
    await expect(table.locator("caption")).toContainText("events per day")
    // A header row a screen reader can associate cells with.
    const headers = table.locator("th[scope=col]")
    await expect(headers).toHaveCount(2)
    await expect(headers.first()).toHaveText("Day")
    await expect(headers.nth(1)).toHaveText("Events")

    // The table IS the plotted data. LineAreaChart labels each keyboard hit
    // target "<category>: Events <value>" (LineAreaChart.tsx:179); every table
    // row must agree with its point.
    const plotted = await frame
      .locator("svg [aria-label]")
      .evaluateAll((nodes) =>
        nodes
          .map((n) => /^(.+):\s*Events\s+([\d,]+)$/.exec(n.getAttribute("aria-label") ?? ""))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => ({ category: m[1].trim(), value: m[2].replace(/,/g, "") })),
      )
    expect(plotted.length, "the mark exposed no labelled points to compare against").toBeGreaterThan(0)

    const rows = await table
      .locator("tbody tr")
      .evaluateAll((trs) =>
        trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "")),
      )
    const byCategory = new Map(rows.map((r) => [r[0], r[1]]))
    for (const point of plotted) {
      expect(byCategory.get(point.category), `no table row for ${point.category}`).toBe(point.value)
    }

    // And there is an export at all, which there was not.
    await expect(frame.getByRole("button", { name: "Download CSV" })).toBeVisible()
  })
})
