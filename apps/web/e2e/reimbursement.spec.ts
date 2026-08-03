import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * Three-way-match reimbursements: a member files → the request rides the normal
 * approval chain → on final approval it auto-posts a SPEND to the club ledger,
 * linked to the approval. Uses the Venue line (untouched by other specs) so the
 * post-approval actual is deterministic: seeded $1,350 + $50 = $1,400.
 */

test.describe("reimbursements (three-way match)", () => {
  test("member files → both gates approve → auto-posts a spend to the ledger", async ({ page }) => {
    // 1. A member files a reimbursement against the Venue line.
    await signIn(page, "Maya Johnson") // Member, consulting club
    await page.goto("/orgs/simon-consulting-club/finance")
    await page.getByLabel("Budget line").selectOption({ label: "Venue & Space" })
    await page.getByLabel("Amount").fill("50")
    await page.getByLabel("What is this for?").fill("E2E venue reimbursement")
    await page.getByRole("button", { name: "Submit request" }).click()

    // Redirected to the approval; the reimbursement panel shows the match legs.
    await page.waitForURL(/\/approvals\/[a-z0-9]+/)
    const approvalUrl = page.url()
    await expect(page.getByRole("heading", { name: /Reimbursement: E2E venue/ })).toBeVisible()
    await expect(page.getByText("$50.00").first()).toBeVisible()
    await expect(page.getByText("Venue & Space").first()).toBeVisible()

    // 2. The club president approves (club gate).
    await signIn(page, "Priya Raman") // President, consulting club
    await page.goto(approvalUrl)
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    await expect(page.getByText("Pending OSE", { exact: true }).first()).toBeVisible()

    // 3. OSE gives final approval → the auto-post fires inside that transaction.
    await signIn(page, "Dana Whitfield") // OSE Director
    await page.goto(approvalUrl)
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    await page.getByRole("button", { name: "Approve request" }).click()
    // Exact, and it matters. `getByText("Approved")` is a case-insensitive
    // SUBSTRING match, and the confirmation dialog this click submits says "The
    // request is approved for good" — so the loose form was satisfied by the
    // dialog's own copy before anything was submitted. The test then navigated
    // away mid-action and read the ledger below before the write had committed.
    // The status badge is the only element whose whole text is "Approved", and
    // it is rendered from the committed row, so waiting for it waits for the
    // transaction.
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible()

    // 4. The ledger now carries the auto-posted spend and the actual is $1,400.
    await signIn(page, "Victor Chen") // VP Finance
    await page.goto("/orgs/simon-consulting-club/finance")
    await page.getByRole("button", { name: "$1,400.00" }).first().click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Venue & Space — ledger")).toBeVisible()
    // The auto-posted entry is present…
    await expect(dialog.getByText("E2E venue reimbursement").first()).toBeVisible()
    // …and links back to its approval — the "approval" leg of the three-way match.
    await expect(dialog.getByRole("link", { name: /Reimbursement: E2E venue/ })).toBeVisible()
  })

  test("the budget guardrail warns before filing over the line's budget", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto("/orgs/simon-consulting-club/finance")
    await page.getByLabel("Budget line").selectOption({ label: "Catering & Food" })
    // Catering has ~$625 remaining; $5,000 blows past it.
    await page.getByLabel("Amount").fill("5000")
    await expect(page.getByText(/exceeds the line.s remaining budget/i)).toBeVisible()
  })
})
