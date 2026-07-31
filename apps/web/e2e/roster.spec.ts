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

    // Asserted structurally rather than by naming a person. This test named a
    // real advisor and their university address, which put personal data in the
    // spec as well as in the roster file, and pinned the test to one particular
    // member of staff. What it is actually for — its own name — is that every
    // listed address is a working mailto, so check exactly that: the link's
    // href is its own visible text.
    const advisor = page.getByRole("link", { name: /@/ }).first()
    await expect(advisor).toBeVisible()
    const advisorEmail = (await advisor.textContent())?.trim()
    expect(advisorEmail).toMatch(/^[^@\s]+@[^@\s]+$/)
    const advisorHref = (await advisor.getAttribute("href")) ?? ""
    expect(
      advisorHref === `mailto:${advisorEmail}` || advisorHref.startsWith(`mailto:${advisorEmail}?`),
    ).toBe(true)
  })

  test("board members show with mailto links", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs/simon-consulting-club/members")

    // Every address on the roster must be a working mailto, so assert that of
    // all of them rather than of one named person. This also covers more than
    // the original did: it previously checked a single hardcoded student.
    const links = page.getByRole("link", { name: /@/ })
    const count = await links.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const link = links.nth(i)
      const email = (await link.textContent())?.trim()
      const href = (await link.getAttribute("href")) ?? ""
      // Roster links prefill a subject, so the href is `mailto:<addr>?subject=…`.
      // Matched as address-then-boundary rather than a bare prefix, so a link to
      // `<addr>.example.com` could not pass.
      expect(href === `mailto:${email}` || href.startsWith(`mailto:${email}?`)).toBe(true)
    }
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
