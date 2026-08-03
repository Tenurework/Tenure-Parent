import { test, expect, type Page } from "@playwright/test"
import { signIn } from "./support/auth"
import { RUN_ID, RUN_SEED } from "./run-id"

/**
 * Week 4: shared calendar, conflict detection, approval-linked publishing.
 * Runs after app.spec.ts (workers=1) against the same seeded database.
 *
 * The calendar is week-only. Month/Day/Agenda were retired, so these tests
 * assert the single week grid, its timezone correctness, and the in-place edit
 * paths (drag to reschedule, inspector to edit) that replaced the read-only
 * month tiles.
 */

/**
 * Wait for the event detail page after a proposal.
 *
 * NOT `/\/calendar\/[a-z0-9]+/` — that pattern also matches `/calendar/new`,
 * so it returns the instant the form loads and the caller races an unsubmitted
 * form. Match a real record id instead.
 */
async function waitForEventPage(page: Page) {
  await page.waitForURL((url) => /^\/calendar\/[a-z0-9]{8,}$/.test(url.pathname))
}

const stamp = RUN_ID

/**
 * Every run parks on its own far-future week, and every test on its own day
 * inside it.
 *
 * Conflict detection flags same-day and same-club overlaps, so events left
 * behind by an earlier run on a shared day make "No conflicts detected" fail
 * for a reason that has nothing to do with the code under test. Spreading runs
 * across days keeps each assertion about this run only.
 */
const dayOffset = 60 + (RUN_SEED % 240)
const dayAt = (n: number) =>
  new Date(Date.now() + (dayOffset + n) * 864e5).toISOString().slice(0, 10)

const day = dayAt(0)
const firstTitle = `E2E Mixer ${stamp}`
const clashTitle = `E2E Clash ${stamp}`
const venue = `Schlegel ${stamp}`

test.describe("calendar + conflicts + publishing", () => {
  test("VP proposes an event — it enters the approval chain pending", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/calendar/new")
    await page.getByLabel("Title").fill(firstTitle)
    await page.getByLabel("Starts").fill(`${day}T18:00`)
    await page.getByLabel("Ends").fill(`${day}T20:00`)
    await page.getByLabel("Venue").fill(venue)
    await page.getByRole("button", { name: /Check conflicts/ }).click()
    await waitForEventPage(page)

    await expect(page.getByText("Pending Approval", { exact: true })).toBeVisible()
    await expect(page.getByText("No conflicts detected", { exact: false })).toBeVisible()
    await expect(page.getByRole("link", { name: "View request" })).toBeVisible()
  })

  test("an overlapping same-venue proposal is flagged as a hard conflict", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/calendar/new")
    await page.getByLabel("Title").fill(clashTitle)
    await page.getByLabel("Starts").fill(`${day}T19:00`)
    await page.getByLabel("Ends").fill(`${day}T21:00`)
    await page.getByLabel("Venue").fill(venue)
    await page.getByRole("button", { name: /Check conflicts/ }).click()
    await waitForEventPage(page)

    await expect(page.getByText("Hard conflict", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Venue clash/).first()).toBeVisible()
  })

  test("approvers see the conflicts on the approval request", async ({ page }) => {
    // Priya is the president — her own proposal went straight to the OSE gate
    await signIn(page, "Dana Whitfield")
    await page.goto("/approvals")
    await page.getByText(clashTitle).first().click()
    await expect(page.getByText("Schedule conflicts")).toBeVisible()
    await expect(page.getByText("Hard conflict", { exact: true }).first()).toBeVisible()
  })

  test("approving through both gates publishes the event onto the week grid", async ({ page }) => {
    // President approves the VP's clean event
    await signIn(page, "Priya Raman")
    await page.goto("/approvals")
    await page.getByText(firstTitle).first().click()
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    await expect(page.getByText("Pending OSE", { exact: true })).toBeVisible()

    // OSE approves → event publishes
    await signIn(page, "Dana Whitfield")
    await page.goto("/approvals")
    await page.getByText(firstTitle).first().click()
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    await page.getByRole("button", { name: "Approve request" }).click()
    await expect(page.getByText("Approved", { exact: true })).toBeVisible()

    // The event sits on the week containing its date.
    await page.goto(`/calendar?d=${day}`)
    await expect(page.getByRole("button", { name: new RegExp(firstTitle) })).toBeVisible()
  })

  test("rejecting an event proposal drops it off the shared calendar", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/approvals")
    await page.getByText(clashTitle).first().click()
    await page.getByPlaceholder(/Optional note/).fill("Venue is double-booked — pick another slot.")
    await page.getByRole("button", { name: "Reject", exact: true }).click()
    await page.getByRole("button", { name: "Reject request" }).click()
    await expect(page.getByText("Rejected", { exact: true })).toBeVisible()

    await page.goto(`/calendar?d=${day}`)
    await expect(page.getByRole("button", { name: new RegExp(clashTitle) })).toHaveCount(0)
  })

  test("published events appear for regular members too", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto(`/calendar?d=${day}`)
    await expect(page.getByRole("button", { name: new RegExp(firstTitle) })).toBeVisible()
  })

  test("the week grid is the only view, and it navigates by week", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto("/calendar")

    // The hourly grid, labelled with the institution's zone.
    await expect(page.getByText("7am").first()).toBeVisible()
    await expect(page.getByRole("link", { name: "Next week" })).toBeVisible()

    // Month / Day / Agenda are gone — one calendar, one contract.
    await expect(page.getByRole("link", { name: "Month", exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Day", exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Agenda", exact: true })).toHaveCount(0)

    await page.getByRole("link", { name: "Next week" }).click()
    await expect(page).toHaveURL(/calendar\?d=\d{4}-\d{2}-\d{2}/)
  })

  test("legacy month and view links resolve to the week rather than 404ing", async ({ page }) => {
    await signIn(page, "Maya Johnson")

    // Old bookmarks and shared links must keep working.
    await page.goto("/calendar?view=agenda")
    await expect(page.getByText("7am").first()).toBeVisible()

    await page.goto(`/calendar?m=${day.slice(0, 7)}`)
    await expect(page.getByText("7am").first()).toBeVisible()

    // A crafted, well-formed-but-impossible date falls back instead of crashing.
    await page.goto("/calendar?d=2026-13-40")
    await expect(page.getByText("7am").first()).toBeVisible()
  })

  /**
   * The grid-editing tests below each stand up their own event rather than
   * reusing `firstTitle`.
   *
   * A Playwright worker that dies (a timeout does it) re-imports the spec file,
   * which re-evaluates the module-scope `Date.now()` stamp — so a test that
   * inherits an identifier from an earlier test starts hunting for a record
   * that was never created, and one genuine failure cascades into six
   * misleading ones. Self-contained fixtures keep each failure honest. A
   * proposal is visible to its own club immediately, so no approval is needed.
   */
  async function proposeEvent(
    page: Page,
    who: string,
    title: string,
    opts: { on: string; start: string; end: string }
  ) {
    await signIn(page, who)
    await page.goto("/calendar/new")
    await page.getByLabel("Title").fill(title)
    await page.getByLabel("Starts").fill(`${opts.on}T${opts.start}`)
    await page.getByLabel("Ends").fill(`${opts.on}T${opts.end}`)
    await page.getByLabel("Venue").fill(`${title} room`)
    await page.getByRole("button", { name: /Check conflicts/ }).click()
    await waitForEventPage(page)
  }

  test("an event renders at the wall-clock time it was filed for", async ({ page }) => {
    // The regression this guards: a datetime-local field parsed against the
    // server's zone (UTC in production) stored 18:00 as 18:00Z, and the grid
    // then rendered the UTC wall clock — so an 18:00 event showed at 22:00 and
    // disagreed with the ICS feed Tenure publishes for it.
    const on = dayAt(1)
    const title = `E2E Clock ${Date.now()}`
    await proposeEvent(page, "Victor Chen", title, { on, start: "18:00", end: "20:00" })

    await page.goto(`/calendar?d=${on}`)
    const chip = page.getByRole("button", { name: new RegExp(title) })
    await expect(chip).toBeVisible()
    // The accessible name carries the resolved local start/end times.
    await expect(chip).toHaveAccessibleName(/6:00 PM to 8:00 PM/)
  })

  test("an officer can reschedule their own event from the grid", async ({ page }) => {
    const on = dayAt(2)
    const title = `E2E Move ${Date.now()}`
    await proposeEvent(page, "Victor Chen", title, { on, start: "13:00", end: "15:00" })

    await page.goto(`/calendar?d=${on}`)
    const chip = page.getByRole("button", { name: new RegExp(title) })
    await expect(chip).toBeVisible()

    // Keyboard is a first-class path — drag-and-drop must never be the only way.
    await chip.focus()
    await page.keyboard.press("Shift+ArrowDown") // +1 hour
    await expect(
      page.getByRole("button", { name: new RegExp(`${title}.*2:00 PM to 4:00 PM`) })
    ).toBeVisible({ timeout: 10_000 })

    // And back, proving the move is a real round-trip rather than a one-way nudge.
    await page.getByRole("button", { name: new RegExp(title) }).focus()
    await page.keyboard.press("Shift+ArrowUp")
    await expect(
      page.getByRole("button", { name: new RegExp(`${title}.*1:00 PM to 3:00 PM`) })
    ).toBeVisible({ timeout: 10_000 })
  })

  test("a member who does not own the event cannot reschedule it", async ({ page }) => {
    const on = dayAt(3)
    const title = `E2E Guard ${Date.now()}`
    await proposeEvent(page, "Victor Chen", title, { on, start: "09:00", end: "10:00" })
    const eventUrl = page.url()

    // Maya holds no seat in the consulting club, so this is read-only for her.
    await signIn(page, "Maya Johnson")
    const id = eventUrl.split("/").pop()!
    const res = await page.request.post("/api/calendar/reschedule", {
      data: { id, date: on, startMinute: 600, endMinute: 660 },
    })
    expect(res.status()).toBe(403)
  })

  test("the inspector edits an event in place", async ({ page }) => {
    const on = dayAt(4)
    const title = `E2E Inspect ${Date.now()}`
    const newVenue = `Gleason ${Date.now()}`
    await proposeEvent(page, "Victor Chen", title, { on, start: "11:00", end: "12:00" })

    await page.goto(`/calendar?d=${on}`)
    await page.getByRole("button", { name: new RegExp(title) }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    await dialog.getByLabel("Venue").fill(newVenue)
    await dialog.getByRole("button", { name: "Save changes" }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page.getByRole("button", { name: new RegExp(newVenue) })).toBeVisible({
      timeout: 10_000,
    })
  })

  test("clicking an empty slot opens a prefilled proposal", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto(`/calendar?d=${day}`)

    await page.getByLabel(`Propose an event on ${day} at 10:00 AM`).click()
    await page.waitForURL(/\/calendar\/new\?date=/)
    await expect(page.getByLabel("Starts")).toHaveValue(`${day}T10:00`)
    // A 90-minute default so the officer only adjusts what is actually different.
    await expect(page.getByLabel("Ends")).toHaveValue(`${day}T11:30`)
  })

  test("theme switching still works from settings", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto("/settings")
    await expect(page.getByRole("radio", { name: "Dark" })).toBeVisible()
    await page.getByRole("radio", { name: "Dark" }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.getByRole("radio", { name: "Light" }).click()
    await expect(page.locator("html")).not.toHaveClass(/dark/)
    await expect(page.getByText("Your seats")).toBeVisible()
  })

  test("Outlook subscription and the ICS feed", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/calendar")

    await page.getByRole("button", { name: "Subscribe" }).click()
    const url = await page.locator("input[readonly]").inputValue()
    expect(url).toContain("/api/calendar/ics/")

    const res = await page.request.get(url)
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toContain("text/calendar")
    expect(await res.text()).toContain("BEGIN:VCALENDAR")
  })
})
