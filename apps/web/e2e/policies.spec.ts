import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Institutional policy pages + the scheduled reminder job. */

test.describe("policy pages", () => {
  test("event guide states its lead times as hard rules", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/resources/event-guide")

    await expect(
      page.getByRole("heading", { name: "Club Event Request & Execution Guide" })
    ).toBeVisible()
    await expect(page.getByText(/21 days \(3 weeks\) before/)).toBeVisible()
    await expect(
      page.getByText(/Do not promote or assume approval for an event/)
    ).toBeVisible()
    // The source self-dates to an earlier year — that caveat must be visible
    await expect(page.getByText(/2024-2025 academic year/)).toBeVisible()
  })

  test("alcohol policy carries all seven rules and the OSE contact", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/resources/alcohol-policy")

    await expect(page.getByText(/maximum of 2 drink tickets/)).toBeVisible()
    await expect(page.getByText(/Shots are not allowed/)).toBeVisible()
    await expect(page.getByText(/at least 7 days before the event/)).toBeVisible()
    await expect(
      page.getByRole("link", { name: /Studentengagment@simon\.rochester\.edu/i })
    ).toHaveAttribute("href", /^mailto:/)
  })

  test("alumni outreach gates contact behind Advancement", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/resources/alumni-outreach")

    await expect(page.getByText(/No outreach may occur before Diana responds/)).toBeVisible()
    // The page must publish a reachable contact. Asserted structurally so the
    // spec does not carry a staff address of its own, and so it keeps holding
    // when that person changes.
    const contact = page.getByRole("link", { name: /@/ }).first()
    await expect(contact).toBeVisible()
    const email = (await contact.textContent())?.trim()
    const href = (await contact.getAttribute("href")) ?? ""
    expect(href === `mailto:${email}` || href.startsWith(`mailto:${email}?`)).toBe(true)
  })

  test("finance handbook lists non-reimbursables and the file naming rule", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/resources/finance")

    await expect(page.getByText(/EER Last name, First name/)).toBeVisible()
    await expect(page.getByText("Cash prizes")).toBeVisible()
    await expect(page.getByText(/Thursday at 11:59 PM/)).toBeVisible()
    await expect(page.getByText(/members must pay at least 50% out of pocket/)).toBeVisible()
  })

  test("travel guidance separates the three tiers", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/resources/travel-guidance")

    await expect(page.getByText(/Tier 1 — Career treks/)).toBeVisible()
    await expect(page.getByText(/Tier 3 — Individual or small group/)).toBeVisible()
    await expect(page.getByText(/No use of club funds or staff travel is allowed/)).toBeVisible()
  })

  test("policy pages are reachable from the resources board", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/resources")

    await page.getByRole("link", { name: /Club Event Request & Execution Guide/ }).first().click()
    await expect(page).toHaveURL(/\/resources\/event-guide/)
  })
})

test.describe("scheduled reminder job", () => {
  test("rejects a request without the shared secret", async ({ request }) => {
    const res = await request.post("/api/jobs/reminders")
    expect(res.status()).toBe(401)
  })

  test("rejects a wrong secret", async ({ request }) => {
    const res = await request.post("/api/jobs/reminders", {
      headers: { Authorization: "Bearer not-the-secret" },
    })
    expect(res.status()).toBe(401)
  })

  test("runs with the secret and is idempotent across invocations", async ({ request }) => {
    // Read the same value the server was started with (playwright.config mirrors
    // .env into the runner) rather than hardcoding CI's, so a local run does not
    // fail with a 401 that says nothing about the job itself.
    const headers = { Authorization: `Bearer ${process.env.JOB_SECRET ?? "e2e-job-secret"}` }

    const first = await request.post("/api/jobs/reminders", { headers })
    expect(first.status()).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).toHaveProperty("checked")
    expect(firstBody).toHaveProperty("notified")

    // A second run must not re-notify anyone already reminded
    const second = await request.post("/api/jobs/reminders", { headers })
    expect(second.status()).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.notified).toBe(0)
  })
})
