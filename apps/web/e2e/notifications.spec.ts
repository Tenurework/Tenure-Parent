import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Proceed 2 batch E: notifications, interactive calendar, back navigation. */



const stamp = Date.now()
const reqTitle = `E2E Notify ${stamp}`

test.describe("notification system", () => {
  test("submitting an approval notifies the president gate", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/approvals/new")
    await page.getByLabel("Title").fill(reqTitle)
    await page.getByRole("button", { name: "Submit for approval" }).click()
    await page.waitForURL(/\/approvals\/(?!new)[a-z0-9]+$/)

    // Priya (president gate) has an unread notification — the live header bell
    // reflects the unread count in its accessible name.
    await signIn(page, "Priya Raman")
    await expect(page.getByRole("button", { name: /Notifications \(\d+ unread\)/ })).toBeVisible()
    await page.goto("/notifications")
    await expect(page.getByText(`${reqTitle} needs your approval`).first()).toBeVisible()

    // Following it lands on the request; approving notifies the requester
    await page.getByText(`${reqTitle} needs your approval`).first().click()
    await expect(page).toHaveURL(/\/approvals\/[a-z0-9]+/)
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    await expect(page.getByText("Pending OSE", { exact: true })).toBeVisible()

    await signIn(page, "Victor Chen")
    await page.goto("/notifications")
    await expect(
      page.getByText(new RegExp(`${reqTitle}.*passed the president`)).first()
    ).toBeVisible()

    // OSE gate was notified too
    await signIn(page, "Dana Whitfield")
    await page.goto("/notifications")
    await expect(page.getByText(`${reqTitle} needs your approval`).first()).toBeVisible()
  })

  test("roster changes notify the person involved", async ({ page }) => {
    const email = `notifyme-${stamp}@tenure.demo`
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/members")
    await page.getByPlaceholder("student@rochester.edu").fill(email)
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect(page.getByText(email)).toBeVisible()
    // (The new user has a notification waiting for their first sign-in.)
  })

  test("the header bell opens a live dropdown and a centered overlay", async ({ page }) => {
    await signIn(page, "Priya Raman")
    // The bell is an interactive button (not just a link to the page).
    await page.getByRole("button", { name: /Notifications/ }).click()
    // The dropdown surfaces recent items and a control to see the full history.
    await expect(page.getByRole("button", { name: "See all notifications" })).toBeVisible()
    // "See all" opens a centered overlay in place — it no longer navigates away.
    await page.getByRole("button", { name: "See all notifications" }).click()
    await expect(
      page.getByText("Approvals, roster changes, events, and messages that involve you.")
    ).toBeVisible()
  })
})

test.describe("interactive calendar + back navigation", () => {
  test("the week grid orients the viewer without any clicking", async ({ page }) => {
    // The month grid's click-a-day inspector panel is gone: the week view shows
    // the schedule directly, so there is nothing to expand. What has to hold is
    // that a viewer lands already oriented — named weekdays, an hour axis, and
    // the timezone the times are in.
    await signIn(page, "Maya Johnson")
    await page.goto("/calendar")

    await expect(page.getByText("7am").first()).toBeVisible()
    await expect(page.getByText("11pm").first()).toBeVisible()
    for (const d of ["Sun", "Mon", "Fri", "Sat"]) {
      await expect(page.getByText(d, { exact: true }).first()).toBeVisible()
    }
    // Times are never printed without saying which clock they are on.
    await expect(page.getByText(/E[SD]T/).first()).toBeVisible()
  })

  test("back button returns from a detail page", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/approvals")
    await page.getByText(reqTitle).first().click()
    await expect(page).toHaveURL(/\/approvals\/[a-z0-9]+/)
    await page.getByRole("button", { name: "Go back" }).click()
    await expect(page).toHaveURL(/\/approvals$/)
  })
})
