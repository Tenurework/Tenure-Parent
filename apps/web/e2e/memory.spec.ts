import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"
import { RUN_ID } from "./run-id"

/**
 * Week 6: institutional memory + documents.
 * The handoff test is the core promise: a role-scoped card written by the
 * active VP is readable by the incoming SHADOW president's seat successor.
 */

const stamp = RUN_ID
const orgCardTitle = `Gala catering contact ${stamp}`
const seatCardTitle = `President transition notes ${stamp}`

test.describe("institutional memory", () => {
  test("an active member writes an org-wide card everyone in the club sees", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/orgs/simon-consulting-club/memory")
    await page.getByLabel("Type").selectOption("CONTACT")
    await page.getByLabel("Title").fill(orgCardTitle)
    await page
      .getByPlaceholder("The details your successor will thank you for.")
      .fill("Maria at CampusEats — 15% discount code SIMON15, ask two weeks ahead.")
    await page.getByRole("button", { name: "Save card" }).click()
    await expect(page.getByText(orgCardTitle)).toBeVisible()

    // Another member sees it too
    await signIn(page, "Maya Johnson")
    await page.goto("/orgs/simon-consulting-club/memory")
    await expect(page.getByText(orgCardTitle)).toBeVisible()
  })

  test("a President-seat card reaches the incoming shadow president (the handoff)", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/memory")
    await page.getByLabel("Type").selectOption("LESSON")
    await page.getByLabel("Title").fill(seatCardTitle)
    await page.getByLabel("Visible to").selectOption({ label: "President seat only" })
    await page
      .getByPlaceholder("The details your successor will thank you for.")
      .fill("Book Schlegel rooms in August — they're gone by September.")
    await page.getByRole("button", { name: "Save card" }).click()
    await expect(page.getByText(seatCardTitle)).toBeVisible()

    // Isaiah holds the President seat as SHADOW — he inherits the memory
    await signIn(page, "Isaiah Brooks")
    await page.goto("/orgs/simon-consulting-club/memory")
    await expect(page.getByText(seatCardTitle)).toBeVisible()

    // Maya doesn't hold the seat — the card is hidden from her
    await signIn(page, "Maya Johnson")
    await page.goto("/orgs/simon-consulting-club/memory")
    await expect(page.getByText(orgCardTitle)).toBeVisible()
    await expect(page.getByText(seatCardTitle)).not.toBeVisible()
  })

  test("shadow members read memory but cannot add to it", async ({ page }) => {
    await signIn(page, "Isaiah Brooks")
    await page.goto("/orgs/simon-consulting-club/memory")
    await expect(page.getByText("Add to memory")).not.toBeVisible()
  })

  test("documents tab renders with upload gated by storage config", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/documents")
    await expect(page.getByText("Club documents", { exact: false })).toBeVisible()
    // No S3 in CI — the upload form must be hidden, not broken
    await expect(page.getByText("No documents yet")).toBeVisible()
  })

  test("org tabs navigate between members, documents, and memory", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/members")
    await page.getByRole("link", { name: "Memory", exact: true }).click()
    await expect(page).toHaveURL(/\/memory$/)
    await page.getByRole("link", { name: "Documents", exact: true }).click()
    await expect(page).toHaveURL(/\/documents$/)
    await page.getByRole("link", { name: "Members", exact: true }).click()
    await expect(page).toHaveURL(/\/members$/)
  })
})
