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

/**
 * WRK-110-005 — "without provider-console knowledge", as an assertion.
 *
 * The half of the requirement that earns its place. A connect / ask-admin /
 * fix / disconnect / confirm path that finishes by telling somebody to open the
 * Azure portal, find an API key or visit a developer console has not been made
 * usable by a nontechnical person; it has been handed to a different person.
 * So every journey below records what it SAW along the way and this refuses any
 * of it.
 */
const PROVIDER_CONSOLE_VOCABULARY = [
  "portal.azure.com",
  "admin center",
  "api key",
  "client secret",
  "developer console",
]

/**
 * A journey's own witness: the pages it walked and the visible text on each.
 *
 * `measureJourney` counts routes; it does not remember them, and the two
 * assertions this requirement needs are about WHERE the path went and WHAT it
 * said. Reading `innerText` fires no trusted click, keypress or input, so
 * collecting evidence cannot inflate a journey's score.
 */
class PathWitness {
  readonly urls: string[] = []
  readonly texts: string[] = []

  constructor(private readonly page: import("@playwright/test").Page) {}

  async see(): Promise<void> {
    this.urls.push(this.page.url())
    this.texts.push(await this.page.locator("body").innerText())
  }

  /** Never left Tenure, and never asked anyone to open a provider console. */
  assertSelfContained(baseURL: string): void {
    expect(this.urls.length).toBeGreaterThan(0)
    const origin = new URL(baseURL).origin
    for (const url of this.urls) expect(new URL(url).origin).toBe(origin)

    const seen = this.texts.join("\n").toLowerCase()
    for (const phrase of PROVIDER_CONSOLE_VOCABULARY) {
      expect(seen).not.toContain(phrase)
    }
  }
}

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

/**
 * WRK-110-005 — the connection paths, driven by somebody who has never seen a
 * provider console.
 *
 * `resolveCapability` has decided exactly one control per capability since it
 * was written, and the Connection Centre rendered none of them: `resolved.action`
 * appeared nowhere in `settings/page.tsx`, so `connect`, `ask-admin` and
 * `disconnect` were decisions with no surface and therefore no test could run
 * them. These four run them.
 *
 * Each is measured the same way every other journey is — trusted clicks,
 * trusted keys, real route commits — and each additionally asserts the two
 * things this requirement is actually about: the path never leaves the Tenure
 * origin, and nothing along it names a provider console.
 */
test.describe("connection paths a nontechnical person can finish", () => {
  test("J05 — a member connects their calendar from the Connection Centre", async ({
    page,
    baseURL,
  }) => {
    await signIn(page, "Maya Johnson")
    await expect(page.getByRole("navigation", NAV)).toBeVisible()
    const witness = new PathWitness(page)

    await measureJourney(
      page,
      {
        id: "J05-connect-calendar",
        persona: "Club member",
        journey: "From the dashboard, find the calendar subscription and connect it",
      },
      async () => {
        await page.getByRole("navigation", NAV).getByRole("link", { name: "Settings" }).click()
        const row = page.locator('[data-connection="calendar.feed"]')
        await expect(row).toBeVisible()
        // The state the platform can actually support: Tenure stores no record
        // that this account's calendar app is subscribed, so the row does not
        // claim one — and the control it offers is therefore Connect.
        await expect(row).toHaveAttribute("data-connection-outcome", "NEEDS_USER_CONNECT")
        const control = row.locator("[data-connection-action]")
        await expect(control).toHaveAttribute("data-connection-action", "connect")
        await witness.see()

        await control.click()
        // The destination is the page where the link is issued, inside Tenure.
        await page.waitForURL(/\/calendar/)
        await witness.see()

        await page.getByRole("button", { name: "Subscribe" }).click()
        // The end state is the feed URL in the person's hands.
        await expect(page.getByLabel("Subscription URL")).toBeVisible()
        await witness.see()
      },
    )

    witness.assertSelfContained(baseURL!)
  })

  test("J06 — a member is sent to a person, not a console, for an admin-owned connection", async ({
    page,
    baseURL,
  }) => {
    await signIn(page, "Maya Johnson")
    await expect(page.getByRole("navigation", NAV)).toBeVisible()
    const witness = new PathWitness(page)

    await measureJourney(
      page,
      {
        id: "J06-ask-admin-storage",
        persona: "Club member",
        journey: "From the dashboard, ask an administrator about a connection only they can make",
      },
      async () => {
        await page.getByRole("navigation", NAV).getByRole("link", { name: "Settings" }).click()
        const row = page.locator('[data-connection="documents.storage"]')
        await expect(row).toBeVisible()
        await expect(row).toHaveAttribute("data-connection-outcome", "NEEDS_ADMIN")
        const control = row.locator("[data-connection-action]")
        // Not Connect. Offering it would teach somebody that the button is the
        // answer to a thing they cannot do.
        await expect(control).toHaveAttribute("data-connection-action", "ask-admin")
        await expect(control).toHaveText("Ask an administrator")
        await witness.see()

        await control.click()
        await page.waitForURL(/\/messages\/compose/)
        await expect(page.locator("main")).toBeVisible()
        await witness.see()
      },
    )

    witness.assertSelfContained(baseURL!)
  })

  test("J07 — a gate owner disconnects the person who could act for them", async ({
    page,
    baseURL,
  }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/settings")

    // Outside the measured window: getting INTO the connected state is not the
    // journey being measured, and charging it to the disconnect would make the
    // number a measurement of two jobs.
    const backup = page.locator("form", { has: page.getByRole("combobox", { name: "Backup approver" }) })
    if (await backup.isVisible().catch(() => false)) {
      await backup.getByRole("button", { name: "Set backup" }).click()
    }
    await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible()

    const witness = new PathWitness(page)

    await measureJourney(
      page,
      {
        id: "J07-disconnect-backup-approver",
        persona: "OSE director",
        journey: "From settings, disconnect the backup approver who can act on my gate",
      },
      async () => {
        await witness.see()
        await page.getByRole("button", { name: "Revoke" }).click()
        // The end state is the connection gone and the way back offered — a
        // disconnect that leaves no route to reconnect is a dead end.
        await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0)
        // The way back, asserted as the control rather than as the words.
        // `getByText(/Backup approver/)` matched two nodes — the card's `h2`
        // and the `<label>` naming the picker — and neither duplication is a
        // defect: the heading names the section, the label is the select's
        // accessible name, and a form control that borrowed a distant heading
        // for its name would be the accessibility bug. Scoping to the combobox
        // also makes the assertion the one the comment above claims, because
        // the heading survives a revoke that offered no route back and the
        // picker does not.
        await expect(page.getByRole("combobox", { name: "Backup approver" })).toBeVisible()
        await witness.see()
      },
    )

    witness.assertSelfContained(baseURL!)
  })

  test("J08 — a board member confirms what the assistant did with their question", async ({
    page,
    baseURL,
  }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/dashboard")
    const witness = new PathWitness(page)

    await measureJourney(
      page,
      {
        id: "J08-confirm-relay-action",
        persona: "Club board member",
        journey: "Ask Tenure AI a question and confirm from the reply what it was allowed to do",
      },
      async () => {
        await page.getByRole("button", { name: "Ask Tenure AI" }).click()
        const panel = page.getByRole("complementary", { name: "Tenure AI assistant" })
        await expect(panel).toBeVisible()

        const box = panel.getByRole("textbox", { name: "Ask Tenure AI" })
        await box.click()
        // Typed, not filled — see J04.
        await box.pressSequentially("deadlines")
        await box.press("Enter")

        // The confirmation is the reply naming what happened, whichever of the
        // outcomes it is. A blank transcript, or one claiming the workspace is
        // empty, is the failure `relayReply` exists to prevent.
        const transcript = panel.getByTestId("relay-transcript")
        await expect(transcript).toContainText(/\S/, { timeout: 30_000 })
        await expect(panel.getByTestId("relay-live-status")).toHaveText(
          /Answer ready, \d+ sources/,
          { timeout: 30_000 },
        )
        await witness.see()
      },
    )

    witness.assertSelfContained(baseURL!)
  })
})
