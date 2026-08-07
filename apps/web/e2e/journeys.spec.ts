import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"
import { measureJourney } from "./support/journey-metrics"

/**
 * TTES-050-001 — the task scorecard's left-hand side, driven through the UI.
 *
 * Every other spec in this directory teleports with `page.goto` because it is
 * asserting what a page contains. These four do the opposite: they only ever
 * click, because the number being measured is how much work the shell makes a
 * person do to get somewhere. A `goto` is a measurement of nothing — nobody
 * types a URL to find their club.
 *
 * Sign-in sits outside the measured window on purpose. The persona buttons are
 * the dev-login stand-in for institutional SSO, so their cost belongs to the
 * fixture rather than to the product.
 *
 * Budgets live in `docs/architecture/ux-task-scorecard.md`. The four rows below
 * are declared and unmeasured — see the "Why the product rows are still
 * unmeasured" section of that document — so today these tests prove the
 * journeys still complete and record what they cost; the moment a row carries
 * numbers the same call starts failing on a regression.
 */

const NAV = { name: "Primary navigation" } as const

test.describe("persona task scorecard", () => {
  test("J01 — a member reaches their club's roster", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await expect(page.getByRole("navigation", NAV)).toBeVisible()

    await measureJourney(
      page,
      {
        id: "J01-first-day",
        persona: "Club member",
        journey: "From the dashboard, find my club and open its roster",
      },
      async () => {
        await page.getByRole("navigation", NAV).getByRole("link", { name: "All Clubs" }).click()
        await expect(page.getByRole("heading", { name: "My Clubs" })).toBeVisible()

        await page.getByRole("link", { name: /Simon Consulting Club/ }).first().click()
        // The roster is the destination: a name on it is the proof the journey
        // finished rather than merely navigated.
        await expect(page.getByText("Victor Chen")).toBeVisible()
      },
    )
  })

  test("J02 — the director reaches institution reporting", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await expect(page.getByRole("heading", { name: "OSE Dashboard" })).toBeVisible()

    await measureJourney(
      page,
      {
        id: "J02-executive-metrics",
        persona: "OSE director",
        journey: "From the dashboard, reach institution-wide reporting",
      },
      async () => {
        await page.getByRole("navigation", NAV).getByRole("link", { name: "Reports" }).click()
        await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible()
        await expect(page.getByText("Active clubs")).toBeVisible()
      },
    )
  })

  test("J03 — a board member reaches the club handoff packet", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await expect(page.getByRole("navigation", NAV)).toBeVisible()

    await measureJourney(
      page,
      {
        id: "J03-handoff-packet",
        persona: "Club board member",
        journey: "From the dashboard, reach the handoff packet for my club",
      },
      async () => {
        await page.getByRole("navigation", NAV).getByRole("link", { name: "All Clubs" }).click()
        await page.getByRole("link", { name: /Simon Consulting Club/ }).first().click()
        await page.getByRole("link", { name: "Handoff" }).click()
        await expect(page.getByText(/handoff contacts/i)).toBeVisible()
      },
    )
  })

  test("J04 — a board member searches for a record from the shell", async ({ page }) => {
    await signIn(page, "Victor Chen")
    // `combobox`, not `textbox` — the palette carries the ARIA 1.2 combobox
    // contract since TTES-030-001, and an explicit role="combobox" stops the
    // element matching the textbox role. See e2e/shell.spec.ts.
    const search = page.getByRole("combobox", { name: "Search Tenure" })
    await expect(search).toBeVisible()

    await measureJourney(
      page,
      {
        id: "J04-find-a-record",
        persona: "Club board member",
        journey: "From anywhere in the shell, search for a record by name",
      },
      async () => {
        await search.click()
        // Typed, not filled. `fill()` would set the value in one shot and the
        // harness would refuse the journey, because a keystroke count that
        // skipped the keystrokes is not a measurement.
        await search.pressSequentially("Consulting")
        await search.press("Enter")
        await page.waitForURL(/\/search\?q=/)
        await expect(page.locator("main")).toBeVisible()
      },
    )
  })
})
