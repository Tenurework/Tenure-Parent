import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * End-to-end coverage of every user-facing endpoint:
 *
 *  /api/health, / (redirect), /signin, /dashboard, /orgs,
 *  /orgs/[slug], /orgs/[slug]/members (+ roster mutations),
 *  /approvals, /approvals/new, /approvals/[id] (+ full state machine),
 *  /calendar, /messages, /settings placeholders.
 *
 * Uses the seeded demo users. Mutating flows create their own records,
 * so the suite is safe to re-run against the same database.
 */



test.describe("public endpoints", () => {
  test("health endpoint reports ok with a version", async ({ request }) => {
    const res = await request.get("/api/health")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body).toHaveProperty("version")
  })

  test("root and app pages redirect unauthenticated users to sign-in", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/signin/)
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/signin/)
    await page.goto("/orgs")
    await expect(page).toHaveURL(/\/signin/)
    await page.goto("/approvals")
    await expect(page).toHaveURL(/\/signin/)
  })

  test("sign-in page lists all seven demo personas", async ({ page }) => {
    await page.goto("/signin")
    for (const name of [
      "Dana Whitfield",
      "Sam Ortiz",
      "Priya Raman",
      "Victor Chen",
      "Maya Johnson",
      "Isaiah Brooks",
      "Alex Kim",
    ]) {
      await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible()
    }
  })
})

test.describe("dashboard + navigation", () => {
  test("OSE director sees the dashboard with live KPI tiles", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await expect(page.getByRole("heading", { name: "OSE Dashboard" })).toBeVisible()
    await expect(page.getByText("Pending Approvals")).toBeVisible()
    await expect(page.getByText("Upcoming Events")).toBeVisible()
    await expect(page.getByText("Unread Messages")).toBeVisible()
    await expect(page.getByText("Active Members", { exact: true })).toBeVisible()
    await expect(page.getByText("Enrolled Clubs")).toBeVisible()
  })

  test("long panels cap their list behind a See-all overlay", async ({ page }) => {
    await signIn(page, "Dana Whitfield") // OSE sees every club — well over the preview cap
    const clubsPanel = page.locator("section", { hasText: "Enrolled Clubs" })
    await clubsPanel.getByRole("button", { name: /See all \(\d+\)/ }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Simon Consulting Club (SCC)")).toBeVisible()
  })

  test("module placeholders render for calendar, messages, settings", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/calendar")
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible()
    await page.goto("/messages")
    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible()
    await page.goto("/settings")
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  })
})

test.describe("organizations + roster RBAC", () => {
  test("OSE director sees all clubs; member sees only their own", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs")
    await expect(page.getByRole("heading", { name: "All Clubs" })).toBeVisible()
    // Real Simon clubs across categories
    await expect(page.getByText("Simon Consulting Club")).toBeVisible()
    await expect(page.getByText("Simon Women in Business")).toBeVisible()
    await expect(page.getByText("Gaming Club")).toBeVisible()
    await expect(page.getByText("Graduate Business Council")).toBeVisible()

    await signIn(page, "Maya Johnson")
    await page.goto("/orgs")
    await expect(page.getByRole("heading", { name: "My Clubs" })).toBeVisible()
    await expect(page.getByText("Simon Consulting Club")).toBeVisible()
    await expect(page.getByText("Gaming Club")).not.toBeVisible()
  })

  test("roster shows lifecycle badges and gates the manage form", async ({ page }) => {
    // President: full roster + manage form
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/members")
    await expect(page.getByText("Victor Chen")).toBeVisible()
    await expect(page.getByText("Isaiah Brooks")).toBeVisible()
    await expect(page.getByText("Shadow", { exact: true })).toBeVisible()
    await expect(page.getByText("Past holders")).toBeVisible()
    await expect(page.getByText("Add to roster")).toBeVisible()

    // Regular member: read-only
    await signIn(page, "Maya Johnson")
    await page.goto("/orgs/simon-consulting-club/members")
    await expect(page.getByText("Victor Chen")).toBeVisible()
    await expect(page.getByText("Add to roster")).not.toBeVisible()
  })

  test("president can add a member to the roster", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/members")
    const email = `e2e-${Date.now()}@tenure.demo`
    await page.getByPlaceholder("student@rochester.edu").fill(email)
    await page.getByRole("combobox").first().selectOption({ label: "Member" })
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect(page.getByText(email)).toBeVisible()
  })
})

test.describe("approvals: full state machine", () => {
  const title = `E2E Budget ${Date.now()}`

  test("VP submits → President approves → OSE approves", async ({ page }) => {
    // 1. VP creates and submits
    await signIn(page, "Victor Chen")
    await page.goto("/approvals/new")
    await page.getByLabel("Type").selectOption("BUDGET")
    await page.getByLabel("Title").fill(title)
    await page.getByLabel("Description").fill("Catering for the spring case competition.")
    await page.getByLabel(/Amount/).fill("1500.00")
    await page.getByRole("button", { name: "Submit for approval" }).click()
    await page.waitForURL(/\/approvals\/[a-z0-9]+/)
    await expect(page.getByText("Pending President", { exact: true })).toBeVisible()

    // VP cannot approve their own request
    await expect(page.getByRole("button", { name: "Approve", exact: true })).not.toBeVisible()

    // 2. President approves → moves to OSE gate
    await signIn(page, "Priya Raman")
    await page.goto("/approvals")
    await page.getByText(title).first().click()
    await page.getByPlaceholder(/Optional note/).fill("Looks reasonable.")
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    await expect(page.getByText("Pending OSE", { exact: true })).toBeVisible()

    // 3. OSE director approves → APPROVED
    await signIn(page, "Dana Whitfield")
    await page.goto("/approvals")
    await page.getByText(title).first().click()
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    // Final OSE-gate approval is terminal + publishes — it now asks to confirm.
    await page.getByRole("button", { name: "Approve request" }).click()
    await expect(page.getByText("Approved", { exact: true })).toBeVisible()

    // History shows the full decision trail
    await expect(page.getByText(/moved this from DRAFT to PENDING PRESIDENT/)).toBeVisible()
    await expect(page.getByText(/moved this from PENDING PRESIDENT to PENDING OSE/)).toBeVisible()
    await expect(page.getByText(/moved this from PENDING OSE to APPROVED/)).toBeVisible()
  })

  test("president requests changes and the requester resubmits", async ({ page }) => {
    const t2 = `E2E Changes ${Date.now()}`
    await signIn(page, "Victor Chen")
    await page.goto("/approvals/new")
    await page.getByLabel("Title").fill(t2)
    await page.getByRole("button", { name: "Submit for approval" }).click()
    await page.waitForURL(/\/approvals\/[a-z0-9]+/)

    await signIn(page, "Priya Raman")
    await page.goto("/approvals")
    await page.getByText(t2).first().click()
    await page.getByPlaceholder(/Optional note/).fill("Add a cost breakdown.")
    await page.getByRole("button", { name: "Request changes" }).click()
    await expect(page.getByText("Needs Changes", { exact: true })).toBeVisible()

    await signIn(page, "Victor Chen")
    await page.goto("/approvals")
    await page.getByText(t2).first().click()
    await expect(page.getByText("Add a cost breakdown.")).toBeVisible()
    await page.getByRole("button", { name: "Resubmit" }).click()
    await expect(page.getByText("Pending President", { exact: true })).toBeVisible()
  })

  test("president's own request skips straight to the OSE gate", async ({ page }) => {
    const t3 = `E2E PresReq ${Date.now()}`
    await signIn(page, "Priya Raman")
    await page.goto("/approvals/new")
    await page.getByLabel("Title").fill(t3)
    await page.getByRole("button", { name: "Submit for approval" }).click()
    await page.waitForURL(/\/approvals\/[a-z0-9]+/)
    await expect(page.getByText("Pending OSE", { exact: true })).toBeVisible()
  })

  test("uninvolved member cannot act on someone else's request", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto("/approvals")
    await page.getByText(title).first().click()
    await expect(page.getByText("Take action")).not.toBeVisible()
  })
})
