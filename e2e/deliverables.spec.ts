import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * OSE club deliverables seeded onto the shared calendar.
 *
 * Deliverables are dates, not timed blocks, so on the week grid they ride the
 * all-day "Due" band above the hours rather than being pinned to an invented
 * hour. Retiring the month view must not have quietly dropped a compliance
 * deadline, which is what these tests are really guarding.
 */

test.describe("club deliverables", () => {
  test("monthly audit deadline appears on the calendar with its term", async ({ page }) => {
    await signIn(page, "Victor Chen")
    // Sept 30 2026 is the last weekday of the month
    await page.goto("/calendar?d=2026-09-30")

    const audit = page.getByText(/Monthly club audit due — September/).first()
    await expect(audit).toBeVisible()
    // The owning office and mini-mester ride the accessible name, so the term
    // the month grid used to print is still available.
    await expect(audit).toHaveAttribute("aria-label", /Ainslie OSE · Fall A/)
  })

  test("audit dates land on weekdays, never a weekend", async ({ page }) => {
    await signIn(page, "Victor Chen")

    // October 31 2026 is a Saturday, so the audit must fall back to Friday 30th.
    // `?d=` opens the whole week, and the 31st sits in it — so asserting the
    // text is merely *visible* passes whether the deadline landed on Friday or
    // on the Saturday this rule exists to prevent. Assert the column.
    await page.goto("/calendar?d=2026-10-30")

    await expect(
      page.locator('[data-allday-date="2026-10-30"]').getByText(/Monthly club audit due — October/)
    ).toBeVisible()
    await expect(
      page.locator('[data-allday-date="2026-10-31"]').getByText(/Monthly club audit due/)
    ).toHaveCount(0)
  })

  test("event submission deadlines carry the right mini-mester label", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/calendar?d=2026-12-04")

    await expect(page.getByText(/Spring A event submissions due/).first()).toBeVisible()
  })

  test("deliverables render inert — no link to a detail page that does not exist", async ({
    page,
  }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/calendar?d=2026-09-30")

    await expect(page.getByText(/Monthly club audit due/).first()).toBeVisible()
    // The deliverable must not be wrapped in an anchor, or be draggable like a
    // club event — it is an institution rule, not a club's own activity.
    await expect(page.getByRole("link", { name: /Monthly club audit due/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Monthly club audit due/ })).toHaveCount(0)
  })

  test("a deadline sits in the column of the day it is due", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/calendar?d=2026-09-30")

    // The band shares the week grid's column template, so the deadline must be
    // horizontally aligned with its own weekday header (Wed 30 September).
    // Scope to the grid header: a bare "30" also matches the mini-month rail.
    const chip = page.getByText(/Monthly club audit due — September/).first()
    const header = page.locator('[data-day-header="2026-09-30"]')
    const chipBox = await chip.boundingBox()
    const headerBox = await header.boundingBox()
    expect(chipBox).not.toBeNull()
    expect(headerBox).not.toBeNull()
    const chipCentre = chipBox!.x + chipBox!.width / 2
    const headerCentre = headerBox!.x + headerBox!.width / 2
    expect(Math.abs(chipCentre - headerCentre)).toBeLessThan(60)
  })
})
