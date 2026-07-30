import { test, expect, type Page } from "@playwright/test"

/** The dedicated admin console: gating, and assign / transfer / remove roles
 *  through the University directory picker. */

async function signIn(page: Page, userName: string) {
  await page.context().clearCookies()
  await page.goto("/signin")
  await page.getByRole("button", { name: new RegExp(userName) }).click()
  await page.waitForURL(/\/dashboard/)
}

const stamp = Date.now()
const SEARCH = "Search the directory by name or email…"

test.describe("admin console", () => {
  test("the director sees the console; a member cannot", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/admin")
    await expect(page.getByText("Administration Console")).toBeVisible()
    await expect(page.getByText("OSE Director")).toBeVisible()
    // The side nav exposes the Admin entry for OSE users.
    await expect(page.getByRole("link", { name: "Admin Console" })).toBeVisible()

    await signIn(page, "Maya Johnson") // plain member
    await page.goto("/admin")
    await expect(page.getByText("Administration Console")).toHaveCount(0)
  })

  test("admin assigns, transfers and removes a role via the directory", async ({ page }) => {
    await signIn(page, "Dana Whitfield")

    // Self-contained club so we never disturb the seeded roster.
    await page.goto("/admin/clubs")
    await page.getByPlaceholder("Simon Real Estate Club").fill(`E2E Roles ${stamp}`)
    await page.getByRole("button", { name: "Charter club" }).click()
    await page.waitForURL(/\/admin\/clubs\/[a-z0-9-]+$/)

    // Assign Arjun (a real directory person) to the first seat.
    await page.getByPlaceholder(SEARCH).first().fill("amoghe")
    await page.getByRole("button", { name: /amoghe@simon/ }).first().click()
    await page.getByRole("button", { name: "Assign", exact: true }).first().click()
    await expect(page.getByRole("button", { name: /Remove Arjun Prashant Moghe/ })).toBeVisible()

    // Transfer the seat to a different person.
    await page.getByRole("button", { name: "Clear selection" }).first().click()
    await page.getByPlaceholder(SEARCH).first().fill("esquivel")
    await page.getByRole("button", { name: /esquivel/i }).first().click()
    await page.getByRole("button", { name: /Transfer to this person/ }).first().click()
    await page.getByRole("dialog").getByRole("button", { name: "Transfer seat" }).click()
    await expect(page.getByRole("button", { name: /Remove Jaime Esquivel/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /Remove Arjun Prashant Moghe/ })).toHaveCount(0)

    // Remove the current holder.
    await page.getByRole("button", { name: /Remove Jaime Esquivel/ }).first().click()
    await page.getByRole("dialog").getByRole("button", { name: "Remove from seat" }).click()
    await expect(page.getByRole("button", { name: /Remove Jaime Esquivel/ })).toHaveCount(0)
  })

  test("admin can force-decide any approval, overriding the gates", async ({ page }) => {
    const title = `E2E Override ${stamp}`
    // A VP submits a request — it enters the normal President/OSE gate.
    await signIn(page, "Victor Chen")
    await page.goto("/approvals/new")
    await page.getByLabel("Title").fill(title)
    await page.getByRole("button", { name: "Submit for approval" }).click()
    await page.waitForURL(/\/approvals\/(?!new)[a-z0-9]+$/)

    // The director force-approves it directly from the console.
    await signIn(page, "Dana Whitfield")
    await page.goto("/admin/approvals")
    const row = page.locator("li").filter({ hasText: title })
    await row.getByRole("button", { name: "Force approve" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Force approve" }).click()
    await expect(row.getByText("Approved")).toBeVisible()
    await expect(row.getByRole("button", { name: "Force approve" })).toHaveCount(0)
  })

  test("admin can archive any content via overrides", async ({ page }) => {
    const title = `E2E Moderate ${stamp}`
    // A VP writes a memory card.
    await signIn(page, "Victor Chen")
    await page.goto("/orgs/simon-consulting-club/memory")
    await page.getByLabel("Type").selectOption("VENDOR")
    await page.getByLabel("Title").fill(title)
    await page
      .getByPlaceholder("The details your successor will thank you for.")
      .fill(`moderation details ${stamp}`)
    await page.getByRole("button", { name: "Save card" }).click()
    await expect(page.getByText(title)).toBeVisible()

    // The director archives it institution-wide from the overrides hub.
    await signIn(page, "Dana Whitfield")
    await page.goto("/admin/overrides")
    const row = page.locator("li").filter({ hasText: title })
    await row.getByRole("button", { name: "Archive" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Archive memory record" }).click()
    await expect(row.getByText("archived")).toBeVisible()
  })
})

test.describe("console navigation matches capability", () => {
  /**
   * The console used to link to its own 404s: AdminNav rendered all six tabs
   * for every admin, while each page calls notFound() when the capability is
   * missing. OSE_STAFF clicking "Approvals" landed on a not-found page inside
   * the console they had just been admitted to.
   */
  test("OSE staff are not offered tabs whose pages would 404", async ({ page }) => {
    await signIn(page, "Sam Ortiz") // OSE_STAFF
    await page.goto("/admin")

    const nav = page.getByRole("navigation", { name: "Admin sections" })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole("link", { name: "Overview" })).toBeVisible()

    // Every tab the staff member IS offered must resolve to a real page.
    const labels = await nav.getByRole("link").allInnerTexts()
    for (const label of labels) {
      await nav.getByRole("link", { name: label.trim(), exact: true }).click()
      await expect(page.getByText(/could not be found|404/i)).toHaveCount(0)
      await page.goto("/admin")
    }
  })

  test("the director still gets the full console", async ({ page }) => {
    await signIn(page, "Dana Whitfield") // OSE_DIRECTOR
    await page.goto("/admin")
    const nav = page.getByRole("navigation", { name: "Admin sections" })
    for (const label of ["Overview", "Clubs", "Approvals", "Overrides", "Audit log"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible()
    }
  })
})

test.describe("reimbursement filing is offered only to those who can file", () => {
  /**
   * submitReimbursement requires an ACTIVE seat in the club, so that a
   * requester never sits on their own approval gate. The form was rendered to
   * every finance viewer regardless, so OSE and alumni discovered they were
   * ineligible only via an unhandled server error on submit.
   */
  test("an active officer sees the form", async ({ page }) => {
    await signIn(page, "Victor Chen") // VP Finance, ACTIVE seat
    await page.goto("/orgs/simon-consulting-club/finance")
    await expect(page.getByRole("heading", { name: /reimbursement/i }).first()).toBeVisible()
  })

  test("the OSE director sees finance but is not offered the form", async ({ page }) => {
    await signIn(page, "Dana Whitfield") // OSE — oversight, no club seat
    await page.goto("/orgs/simon-consulting-club/finance")
    await expect(page.getByText(/budget/i).first()).toBeVisible()
    await expect(page.getByRole("heading", { name: /reimbursement/i })).toHaveCount(0)
  })
})
