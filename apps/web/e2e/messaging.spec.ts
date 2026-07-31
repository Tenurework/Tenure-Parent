import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"
import { RUN_ID } from "./run-id"

/** Week 5: DMs, board channels, approval threads, broadcasts. */

const stamp = RUN_ID

test.describe("messaging", () => {
  const subject = `Budget question ${stamp}`

  test("VP composes an email-style message; president replies; cc'd member sees it", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/messages/compose")
    const toSel = page.getByLabel("To", { exact: true })
    await toSel.selectOption(
      (await toSel.getByRole("option", { name: /Priya Raman/ }).getAttribute("value"))!
    )
    const ccSel = page.getByLabel(/^Cc/)
    await ccSel.selectOption(
      (await ccSel.getByRole("option", { name: /Maya Johnson/ }).getAttribute("value"))!
    )
    await page.getByLabel("Subject").fill(subject)
    await page.getByLabel("Message").fill("Can we bump the catering budget by $200?")
    await page.getByRole("button", { name: "Send", exact: true }).click()
    // Must actually leave /messages/compose for a thread page
    await page.waitForURL(/\/messages\/(?!compose)[a-z0-9]+$/)
    // Recipients render with avatars: From Victor, To Priya, Cc Maya.
    await expect(page.getByText("From", { exact: true })).toBeVisible()
    await expect(page.getByText("Victor Chen").first()).toBeVisible()
    await expect(page.getByText("Priya Raman").first()).toBeVisible()
    await expect(page.getByText("Maya Johnson").first()).toBeVisible()

    // Priya replies in the thread
    await signIn(page, "Priya Raman")
    await page.goto("/messages")
    await page.getByText(subject).first().click()
    const reply = `Approved informally — submit it ${stamp}`
    await page.getByPlaceholder("Write a message…").fill(reply)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByText(reply)).toBeVisible()

    // Cc'd Maya can read the whole thread
    await signIn(page, "Maya Johnson")
    await page.goto("/messages")
    await page.getByText(subject).first().click()
    await expect(page.getByText(reply)).toBeVisible()
  })

  test("recipient lists follow the strict hierarchy", async ({ page }) => {
    // Member: own club's active board only — no OSE, no shadow members
    await signIn(page, "Maya Johnson")
    await page.goto("/messages/compose")
    const to = page.getByLabel("To", { exact: true })
    await expect(to.getByRole("option", { name: /Priya Raman/ })).toBeVisible()
    await expect(to.getByRole("option", { name: /Victor Chen/ })).toBeVisible()
    await expect(to.getByRole("option", { name: /Dana Whitfield/ })).not.toBeVisible()
    await expect(to.getByRole("option", { name: /Isaiah Brooks/ })).not.toBeVisible()

    // Shadow president cannot compose at all
    await signIn(page, "Isaiah Brooks")
    await page.goto("/messages/compose")
    await expect(page.getByText("cannot start messages", { exact: false })).toBeVisible()

    // OSE can reach everyone
    await signIn(page, "Dana Whitfield")
    await page.goto("/messages/compose")
    await expect(
      page.getByLabel("To", { exact: true }).getByRole("option", { name: /Maya Johnson/ })
    ).toBeVisible()
  })

  test("board channel: active member posts, shadow reads only", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto("/messages")
    await page.getByRole("button", { name: /Simon Consulting Club/ }).click()
    await page.waitForURL(/\/messages\/[a-z0-9]+/)

    const post = `Weekly sync notes ${stamp}`
    await page.getByPlaceholder("Write a message…").fill(post)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByText(post)).toBeVisible()

    // Isaiah (shadow president) can read but not post
    await signIn(page, "Isaiah Brooks")
    await page.goto("/messages")
    await page.getByRole("button", { name: /Simon Consulting Club/ }).click()
    await page.waitForURL(/\/messages\/[a-z0-9]+/)
    await expect(page.getByText(post)).toBeVisible()
    await expect(page.getByPlaceholder("Write a message…")).not.toBeVisible()
    await expect(page.getByText("read-only access")).toBeVisible()
  })

  test("approval discussion thread connects requester and approver", async ({ page }) => {
    const reqTitle = `E2E Thread ${stamp}`
    await signIn(page, "Victor Chen")
    await page.goto("/approvals/new")
    await page.getByLabel("Title").fill(reqTitle)
    await page.getByRole("button", { name: "Submit for approval" }).click()
    await page.waitForURL(/\/approvals\/[a-z0-9]+/)

    await page.getByRole("button", { name: "Discussion" }).click()
    await page.waitForURL(/\/messages\/[a-z0-9]+/)
    await expect(page.getByText(`Re: ${reqTitle}`)).toBeVisible()
    const q = `Can I get this expedited? ${stamp}`
    await page.getByPlaceholder("Write a message…").fill(q)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByText(q)).toBeVisible()

    // President opens the same thread from the approval and replies
    await signIn(page, "Priya Raman")
    await page.goto("/approvals")
    await page.getByText(reqTitle).first().click()
    await page.getByRole("button", { name: "Discussion" }).click()
    await page.waitForURL(/\/messages\/[a-z0-9]+/)
    await expect(page.getByText(q)).toBeVisible()
  })

  // Broadcast bodies are identical from run to run, so assertions on the body
  // text are scoped with `.first()` — a bare getByText matches every prior
  // run's copy on a database that is not reset between runs.
  test("OSE broadcast reaches members read-only", async ({ page }) => {
    const subject = `Fall deadlines ${stamp}`
    await signIn(page, "Dana Whitfield")
    await page.goto("/messages")
    await page.getByPlaceholder("Subject").fill(subject)
    await page.getByPlaceholder("Message to all clubs…").fill("Budget submissions close Oct 15.")
    await page.getByRole("button", { name: "Send broadcast" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Send broadcast" }).click()
    await page.waitForURL(/\/messages\/[a-z0-9]+/)
    await expect(page.getByText("Budget submissions close Oct 15.").first()).toBeVisible()

    // A member sees it but cannot reply
    await signIn(page, "Maya Johnson")
    await page.goto("/messages")
    await page.getByText(subject).first().click()
    await expect(page.getByText("Budget submissions close Oct 15.").first()).toBeVisible()
    await expect(page.getByPlaceholder("Write a message…")).not.toBeVisible()
    await expect(page.getByText("Broadcasts are read-only.")).toBeVisible()
  })

  test("unread count shows on the dashboard KPI", async ({ page }) => {
    // Victor has at least one unread (Priya's DM reply may be read; send fresh)
    await signIn(page, "Priya Raman")
    await page.goto("/messages")
    await page.getByText(subject).first().click()
    const ping = `Ping ${stamp}`
    await page.getByPlaceholder("Write a message…").fill(ping)
    await page.getByRole("button", { name: "Send", exact: true }).click()

    await signIn(page, "Victor Chen")
    await page.goto("/dashboard")
    const kpi = page.getByRole("link", { name: /Unread Messages/ })
    await expect(kpi).toBeVisible()
    await expect(kpi.getByText(/^[1-9][0-9]*$/)).toBeVisible()
  })
})
