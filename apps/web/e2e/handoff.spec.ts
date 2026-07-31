import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** The term-transition handoff packet — Tenure's governance wedge. */

test.describe("handoff packet", () => {
  test("assembles seats, predecessors, knowledge counts and open items", async ({ page }) => {
    await signIn(page, "Victor Chen") // VP Finance, consulting club
    await page.goto("/orgs/simon-consulting-club/handoff")

    await expect(page.getByRole("heading", { name: /Simon Consulting Club/ })).toBeVisible()
    await expect(page.getByText(/handoff contacts/i)).toBeVisible()

    // A board seat with its permanent position id and a knowledge count
    await expect(page.getByText("Position ID SCC-PRES")).toBeVisible()
    await expect(page.getByText(/knowledge card/).first()).toBeVisible()

    // The handoff contact — who held the seat before, so a successor knows who to ask
    await expect(page.getByText(/Held it before/i).first()).toBeVisible()

    // Club open items travel with the seat (card headings; the KPI labels reuse
    // the same words, so scope to the heading role)
    await expect(page.getByRole("heading", { name: "Upcoming deadlines" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Open approvals" })).toBeVisible()
  })

  test("is reachable as a club tab", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/orgs/simon-consulting-club/members")
    await expect(page.getByRole("link", { name: "Handoff" })).toBeVisible()
  })
})
