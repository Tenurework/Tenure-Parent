import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** 2026-2027 OSE roster: real board members, advisors, vacancies, predecessors. */

test.describe("club roster", () => {
  test("clubs are renamed to their official roster names", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs")
    await expect(page.getByText("Simon Consulting Club (SCC)").first()).toBeVisible()
    await expect(page.getByText("Simon Women in Business (SWiB)").first()).toBeVisible()
  })

  test("advisors are listed with clickable contact addresses", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs/simon-consulting-club/members")

    await expect(page.getByText("Club advisors")).toBeVisible()
    const advisor = page.getByRole("link", { name: "wayne.france@simon.rochester.edu" })
    await expect(advisor).toBeVisible()
    await expect(advisor).toHaveAttribute("href", /^mailto:wayne\.france@simon\.rochester\.edu/)
  })

  test("board members show with mailto links", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs/simon-consulting-club/members")

    // He also appears as last year's 1Y MBA Rep further down the page
    await expect(page.getByText("Arjun Prashant Moghe").first()).toBeVisible()
    const member = page.getByRole("link", { name: "amoghe@simon.rochester.edu" }).first()
    await expect(member).toHaveAttribute("href", /^mailto:amoghe@simon\.rochester\.edu/)
  })

  test("empty seats read as Vacant Position with the roster's reason", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs/simon-consulting-club/members")

    // VP Marketing & Communications is unfilled, noted "Opening in the fall"
    await expect(page.getByText("Vacant Position").first()).toBeVisible()
    await expect(page.getByText(/Opening in the fall/)).toBeVisible()
  })

  test("previous holders are shown so a new officer knows who to ask", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs/simon-consulting-club/members")

    await expect(page.getByText("Previously held by").first()).toBeVisible()
    // Last year's VP Finance & Operations
    await expect(page.getByText("Jaime Esquivel")).toBeVisible()
  })

  test("Director can filter clubs by category", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs")

    const nav = page.getByRole("navigation", { name: "Filter clubs by category" })
    await expect(nav).toBeVisible()

    await nav.getByRole("link", { name: /^Social/ }).click()
    await expect(page).toHaveURL(/category=SOCIAL/)
    await expect(page.getByText("Simon Gaming Club").first()).toBeVisible()
    // A professional club must not survive the social filter
    await expect(page.getByText("Simon Pricing Club")).toHaveCount(0)

    await nav.getByRole("link", { name: /^All/ }).click()
    await expect(page.getByText("Simon Pricing Club").first()).toBeVisible()
  })
})
