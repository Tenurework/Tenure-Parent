import { test, expect, type Page } from "@playwright/test"

/** Board resources: quick links on the dashboard, full board under /resources. */

async function signIn(page: Page, userName: string) {
  await page.context().clearCookies()
  await page.goto("/signin")
  await page.getByRole("button", { name: new RegExp(userName) }).click()
  await page.waitForURL(/\/dashboard/)
}

test.describe("board resources", () => {
  test("dashboard surfaces a compact rotating quick-links card", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await expect(page.getByText("Quick links")).toBeVisible()
    // The compact card rotates through the seat's resource links and offers a
    // route to the full resource hub.
    await expect(page.getByRole("link", { name: /All resources/ })).toBeVisible()
  })

  test("resources page groups by seat and links out to the real forms", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/resources")

    await expect(page.getByRole("heading", { name: "Board Resources" })).toBeVisible()

    await expect(
      page.getByRole("link", { name: /SimonSource/ }).first()
    ).toHaveAttribute("href", /12twenty\.com/)
    await expect(
      page.getByRole("link", { name: /Student Expense Form/ }).first()
    ).toHaveAttribute("href", /form\.jotform\.com/)
    await expect(
      page.getByRole("link", { name: /Purchase Request/ }).first()
    ).toHaveAttribute("href", /student-purchase-request-form/)
    await expect(
      page.getByRole("link", { name: /Simon Merch Request/ }).first()
    ).toHaveAttribute("href", /ainslie-ose-merch/)
  })

  test("a president sees president-only resources", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/resources")

    await expect(page.getByText("Leadership Eligibility Checklist")).toBeVisible()
    await expect(page.getByText("Club Transition & Onboarding Checklist")).toBeVisible()
  })

  test("VP Events resources carry the padlet links", async ({ page }) => {
    await signIn(page, "Dana Whitfield") // OSE sees every section
    await page.goto("/resources")

    await expect(
      page.getByRole("link", { name: /Club Event Flyer Process/ }).first()
    ).toHaveAttribute("href", /padlet\.com/)
    await expect(
      page.getByRole("link", { name: /Event Planning Checklist/ }).first()
    ).toHaveAttribute("href", /padlet\.com/)
  })

  test("hard rules are shown next to the resource they constrain", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/resources")

    await expect(page.getByText(/at least 3 weeks \(21 days\) in advance/i)).toBeVisible()
  })
})

/**
 * Authoring. The resource board previously had no Add control for anyone —
 * resources were a hardcoded array, so publishing a form meant a pull request
 * and a deploy, and the OSE Director who owns the programme could not do it at
 * all. These tests pin the capability and its boundaries.
 */
test.describe("resource authoring", () => {
  const title = `E2E Room Booking ${Date.now()}`

  test("the OSE Director can publish a resource onto the board", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/resources")

    await page.getByRole("button", { name: "Add resource" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Title").fill(title)
    await dialog.getByLabel("Description").fill("Reserve a room for a club meeting.")
    await dialog
      .getByRole("textbox", { name: "Link", exact: true })
      .fill("https://rochester.edu/rooms")
    await dialog.getByLabel("Type").selectOption("FORM")
    await dialog.getByRole("button", { name: "VP Events & Partnerships" }).click()
    await dialog.getByRole("button", { name: "Publish resource" }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await page.reload()
    await expect(page.getByRole("heading", { name: title }).first()).toBeVisible()
    // Routed to the seats that were chosen, so it lands in both sections.
    await expect(page.getByRole("heading", { name: title })).toHaveCount(2)
  })

  test("a published resource reaches officers who hold that seat", async ({ page }) => {
    await signIn(page, "Priya Raman") // president — inherits "Every board member"
    await page.goto("/resources")
    await expect(page.getByRole("heading", { name: title }).first()).toBeVisible()
    // …but they cannot edit it.
    await expect(page.getByRole("button", { name: "Add resource" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0)
  })

  test("a dangerous link is refused rather than published", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/resources")

    await page.getByRole("button", { name: "Add resource" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Title").fill("Should never publish")
    await dialog.getByLabel("Description").fill("A javascript: URL on a link the school trusts.")
    await dialog.getByRole("textbox", { name: "Link", exact: true }).fill("javascript:alert(1)")
    await dialog.getByRole("button", { name: "Publish resource" }).click()

    await expect(dialog.getByRole("alert")).toContainText(/full https:\/\/ link/)
    await expect(dialog).toBeVisible()
  })

  test("OSE can retire a resource and restore it", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/resources")

    const card = () => page.locator("[data-resource-card]").filter({ hasText: title }).first()
    await card().getByRole("button", { name: /Retire/ }).click()
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0)

    // Soft delete: it is parked, not destroyed, and comes back.
    // The Segmented control is react-aria, which hides the real <input> behind
    // its <label> — click the label, not the input Playwright resolves to.
    await page.locator("label").filter({ hasText: /^Retired/ }).click()
    await expect(card()).toBeVisible()
    // Scoped to this card: the retired shelf accumulates across runs, so a
    // bare .first() would restore somebody else's resource.
    await card().getByRole("button", { name: /Restore/ }).click()
    await page.goto("/resources")
    await expect(page.getByRole("heading", { name: title }).first()).toBeVisible()
  })

  test("a club officer cannot publish through the action either", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto("/resources")
    await expect(page.getByRole("button", { name: "Add resource" })).toHaveCount(0)
  })
})
