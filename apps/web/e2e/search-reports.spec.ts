import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"
import { RUN_ID } from "./run-id"

/** Week 7: permission-aware search with citations + OSE reports. */

const stamp = RUN_ID
const cardTitle = `Catering vendor SIMONX${stamp}`

test.describe("search", () => {
  test("finds a memory card via the header search with a citation", async ({ page }) => {
    // Seed a distinctive card
    await signIn(page, "Victor Chen")
    await page.goto("/orgs/simon-consulting-club/memory")
    await page.getByLabel("Type").selectOption("VENDOR")
    await page.getByLabel("Title").fill(cardTitle)
    await page
      .getByPlaceholder("The details your successor will thank you for.")
      .fill(`CampusEats gives us 15% off with code SIMONX${stamp}.`)
    await page.getByRole("button", { name: "Save card" }).click()
    await expect(page.getByText(cardTitle)).toBeVisible()

    // Search from the shell header
    await page.getByRole("textbox", { name: "Search Tenure" }).fill(`SIMONX${stamp}`)
    await page.getByRole("textbox", { name: "Search Tenure" }).press("Enter")
    await page.waitForURL(/\/search\?q=/)
    await expect(page.getByText(cardTitle)).toBeVisible()
    await expect(page.getByText("[1]")).toBeVisible()
    await expect(page.getByText(/Sources \(\d+\)/)).toBeVisible()
  })

  test("search respects role scoping — seat cards stay hidden", async ({ page }) => {
    // Priya writes a President-seat-only card with a unique token
    const secret = `SEATSECRET${stamp}`
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/memory")
    await page.getByLabel("Type").selectOption("CREDENTIAL")
    await page.getByLabel("Title").fill(`Bank portal ${stamp}`)
    await page.getByLabel("Visible to").selectOption({ label: "President seat only" })
    await page
      .getByPlaceholder("The details your successor will thank you for.")
      .fill(`Login hint: ${secret}`)
    await page.getByRole("button", { name: "Save card" }).click()

    // Maya searches for it — invisible to her
    await signIn(page, "Maya Johnson")
    await page.goto(`/search?q=${secret}`)
    await expect(page.getByText("No results")).toBeVisible()

    // Isaiah (shadow president) finds it — the seat's memory is his
    await signIn(page, "Isaiah Brooks")
    await page.goto(`/search?q=${secret}`)
    await expect(page.getByText(`Bank portal ${stamp}`)).toBeVisible()
  })

  test("searching for approvals and events works", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/search?q=E2E")
    await expect(page.getByText(/Sources \(\d+\)/)).toBeVisible()
  })
})

test.describe("reports", () => {
  test("OSE director sees institution metrics", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/reports")
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible()
    await expect(page.getByText("Active clubs")).toBeVisible()
    await expect(page.getByText("Filled seats")).toBeVisible()
    await expect(page.getByText("Approval pipeline")).toBeVisible()
    await expect(page.getByText("Institutional memory")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Denied actions" })).toBeVisible()
  })

  test("reports are hidden from club members", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    // No nav link…
    await expect(page.getByRole("link", { name: "Reports" })).not.toBeVisible()
    // …and direct access 404s
    await page.goto("/reports")
    await expect(
      page.getByRole("heading", { name: /find that page/ })
    ).toBeVisible()
  })
})
