import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * TTES-020-002 / TTES-030-003 / TTES-030-005 — the Relay surface's contract.
 *
 * Every assertion here reads what the PRODUCTION panel emits. A test that
 * called `relayReply` or a scope helper directly would stay green the day the
 * panel stopped calling them, which is the failure this file exists to avoid.
 */

const TENANT = "University of Rochester"

async function openPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Ask Tenure AI" }).click()
  const panel = page.getByRole("complementary", { name: "Tenure AI assistant" })
  await expect(panel).toBeVisible()
  return panel
}

test.describe("Relay is anchored, announced and cancellable", () => {
  test("the panel names the tenant and the active scope, and announces politely", async ({
    page,
  }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/dashboard")
    const panel = await openPanel(page)

    // The tenant comes from the layout's `tenants.active`, passed as a REQUIRED
    // prop. Delete the prop at the construction site and this reds.
    const scopeLine = panel.getByTestId("relay-scope")
    await expect(scopeLine).toContainText(TENANT)

    // Mounted even with an empty transcript — a live region that appears at the
    // same moment as its content announces nothing.
    const transcript = panel.getByTestId("relay-transcript")
    await expect(transcript).toHaveAttribute("aria-live", "polite")
    await expect(transcript).toHaveAttribute("aria-atomic", "false")

    const status = panel.getByTestId("relay-live-status")
    await expect(status).toHaveAttribute("role", "status")
    await expect(status).toHaveAttribute("aria-live", "polite")
  })

  test("asking from a club record scopes the question to THAT record", async ({ page }) => {
    await signIn(page, "Priya Raman")
    // A record page: it mounts AIScopeAnchor with the club's slug and name.
    await page.goto("/orgs/simon-consulting-club/handoff")
    await page.waitForLoadState("networkidle")

    const panel = await openPanel(page)
    await expect(panel.getByTestId("relay-scope")).toContainText("Simon Consulting Club")

    // And the record travels with the request, rather than being a label.
    const posted = page.waitForRequest(
      (r) => r.url().includes("/api/ai/chat") && r.method() === "POST",
    )
    await panel.getByRole("textbox", { name: "Ask Tenure AI" }).fill("who holds the president seat")
    await panel.getByRole("button", { name: "Send to Tenure AI" }).click()

    const body = JSON.parse((await posted).postData() ?? "{}")
    expect(body.scope).toBeTruthy()
    expect(body.scope.kind).toBe("record")
    expect(body.scope.id).toBe("simon-consulting-club")
  })

  test("SC 4.1.3 — the live region changes when an answer lands", async ({ page }) => {
    await signIn(page, "Priya Raman")
    await page.goto("/dashboard")
    const panel = await openPanel(page)

    const status = panel.getByTestId("relay-live-status")
    await expect(status).toHaveText("")

    await panel.getByRole("textbox", { name: "Ask Tenure AI" }).fill("what are my deadlines")
    await panel.getByRole("button", { name: "Send to Tenure AI" }).click()

    // Either "thinking" (in flight) or "Answer ready" (already back). Both are
    // announcements the reader gets; before this change there were none.
    await expect(status).toHaveText(/Tenure AI is thinking|Answer ready, \d+ sources/, {
      timeout: 20_000,
    })
    await expect(status).toHaveText(/Answer ready, \d+ sources/, { timeout: 30_000 })
  })

  test("an unconnected model produces the owned card, not a bare sentence", async ({ page }) => {
    // ANTHROPIC_API_KEY is unset in CI and in a local run, so `aiConfigured()`
    // is false and the route returns aiEnabled:false with no toolRefusal. That
    // is genuine not-connected state, not a fixture.
    test.skip(!!process.env.ANTHROPIC_API_KEY, "a model IS connected in this environment")

    await signIn(page, "Priya Raman")
    await page.goto("/dashboard")
    const panel = await openPanel(page)

    await panel.getByRole("textbox", { name: "Ask Tenure AI" }).fill("what are my deadlines")
    await panel.getByRole("button", { name: "Send to Tenure AI" }).click()

    const card = panel.locator('[data-capability="ai.model"]')
    await expect(card).toBeVisible({ timeout: 30_000 })
    // resolveCapability decided this, not the call site: unconfigured +
    // admin-owned is NEEDS_ADMIN, whose one path is ask-an-administrator.
    await expect(card).toHaveAttribute("data-connection-outcome", "NEEDS_ADMIN")
    await expect(card.getByRole("button", { name: "Ask an administrator" })).toBeVisible()
    // The question is preserved for resumption.
    await expect(card).toContainText("what are my deadlines")
    // And it must not claim the workspace is empty — nothing was searched by a
    // model, and the retrieval that did run is reported separately.
    await expect(panel.getByTestId("relay-transcript")).toContainText("No model is connected")
  })
})
