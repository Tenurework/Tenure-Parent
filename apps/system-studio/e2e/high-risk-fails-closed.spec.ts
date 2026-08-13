import { test, expect, type Page } from "@playwright/test"

import { operatorFor } from "./operator-identity"

/**
 * STUDIO-140-006 — the high-risk confirmation refuses, and refuses differently
 * every time.
 *
 * Before this, `HighRiskConfirmation` rendered five facts as a `<dl>`, took no
 * value from the operator, and sat BESIDE the form rather than inside it. The
 * server action received a slug, a destination and a free-text approver address
 * and nothing whatever from the panel — so the panel was a caption, and a POST
 * to the action's id skipped it entirely.
 *
 * Five refusals are asserted here, each through the real form:
 *
 *   1. the target was not typed
 *   2. the digest submitted is not the digest of the consequence that would run
 *   3. the operator named themselves as the approver
 *   4. the approver is not on the allowlist
 *   5. the move is a destructive AWS mutation this console does not perform
 *
 * Every one produces a DIFFERENT message, and the last assertion in the file is
 * that all five differ — because "it refused" passing for the wrong reason is
 * how a fail-closed suite goes green against a gate that stopped working.
 *
 * Everything runs against a real DynamoDB, through real clicks. Skipped without
 * a table, because a spec that quietly passes with no registry is asserting that
 * a form does not render.
 *
 * ## And because it is skippable, it is not the only proof
 *
 * `src/lib/high-risk-gate.test.ts` drives the same five refusals through the
 * same `advanceState` — the real authorization, the real audit ledger, the real
 * command gate, the real change-class gate and the real lifecycle engine, with
 * only DynamoDB replaced — and it runs unconditionally in `npm run test`. This
 * file adds what that one cannot see: that the operator can actually reach the
 * field, that it is inside the `<form>` that submits it, and that the refusals
 * survive a browser round trip. A fail-closed gate whose ONLY proof is
 * conditional is a gate that can silently stop being one.
 */

const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const OPERATOR = operatorFor()
/**
 * A second allowlisted operator, for the approval that is meant to SUCCEED
 * at case 5 — so the destructive refusal there cannot be mistaken for an
 * approver refusal.
 */
const SECOND_OPERATOR = (() => {
  const entries = (process.env.PLATFORM_OPERATORS ?? "").split(",").map((e) => e.trim())
  const emails = entries.map((e) => e.split(":")[0].trim()).filter(Boolean)
  return emails.find((e) => e !== OPERATOR) ?? ""
})()

/** Deliberately not on the allowlist. */
const STRANGER = "not-an-operator@example.invalid"

const configured = !!process.env.TENANT_TABLE

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

/**
 * Compose a tenant through the real form.
 *
 * A fresh slug per run, because the registry refuses a duplicate and this suite
 * is not idempotent by design — it composes systems and moves them.
 */
async function compose(page: Page, slug: string): Promise<void> {
  await page.goto("/tenants/new")
  await page.fill("#slug", slug)
  await page.fill("#legalName", `${slug} Collective`)
  await page.fill("#displayName", slug)
  await page.fill("#initialAdminEmail", `admin@${slug}.invalid`)
  await page.getByRole("button", { name: /Register|Compose/i }).first().click()
  await page.waitForURL(new RegExp(`/tenants/${slug}`), { timeout: 30_000 })
}

/** Pick a destination chip and wait for the form it reveals. */
async function choose(page: Page, to: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${to}`) }).click()
  await expect(page.locator("form input[name='to']")).toHaveValue(to)
}

/** Move a tenant one state, expecting it to work. Used only to reach the interesting states. */
async function advance(page: Page, slug: string, to: string, owner?: string): Promise<void> {
  await page.goto(`/tenants/${slug}`)
  await choose(page, to)
  if (owner) await page.fill("#ownerPrincipalId", owner)
  await page.fill("#reason", `walking to ${to}`)
  await page.getByRole("button", { name: `Move to ${to}` }).click()
  await expect(page.locator(".advance .error, .advance .state")).toHaveCount(0, { timeout: 30_000 })
  await page.goto(`/tenants/${slug}`)
  /*
   * `section.md3-card`, not `section.system`.
   *
   * This asserts "the tenant page rendered a panel" before reading the state out
   * of it, and it named the class the page used to carry. The tenant page is now
   * built from `components/md3/Card`, whose element is `<section class="md3-surface
   * md3-card">` — a freshly composed tenant has no deployment and no evidence, so
   * the only two `section.system` elements left on the route (the shared
   * deployment and evidence panels) are both absent and the old locator matched
   * nothing.
   *
   * Deliberately the same strength: one structural class naming the page's own
   * panels, replaced by the structural class that now names them. A weaker
   * version — `main`, or `body` — would pass on a page that rendered a heading
   * and nothing else, which is exactly the failure this line is here to catch.
   */
  await expect(page.locator("section.md3-card").first()).toBeVisible()
  await expect(page.getByText(to, { exact: false }).first()).toBeVisible()
}

/** Submit the currently-chosen move and return whatever the action said. */
async function submitAndReadRefusal(page: Page, to: string): Promise<string> {
  await page.getByRole("button", { name: `Move to ${to}` }).click()
  const refusal = page.locator(".advance .error, .advance .state-headline")
  await expect(refusal.first()).toBeVisible({ timeout: 30_000 })
  return (await refusal.first().innerText()).trim()
}

test.describe("a high-risk move is a gate, not a caption", () => {
  test.skip(!configured, "needs TENANT_TABLE and a reachable DynamoDB")
  test.skip(!SECOND_OPERATOR, "needs a second allowlisted operator to approve with")

  // One tenant walked to the first approval-gated transition
  // (AWAITING_APPROVAL -> PROVISIONING), and one walked down the offboarding
  // path to the destructive one (PURGE_PENDING -> PURGING).
  const stamp = `${Date.now()}`.slice(-8)
  const approvalSlug = `hr-approve-${stamp}`
  const purgeSlug = `hr-purge-${stamp}`

  const messages: Record<string, string> = {}

  test("the confirmation refuses without the target typed", async ({ page }) => {
    await signIn(page)
    await compose(page, approvalSlug)
    await advance(page, approvalSlug, "VALIDATING")
    await advance(page, approvalSlug, "PLANNED")
    await advance(page, approvalSlug, "AWAITING_APPROVAL")

    await page.goto(`/tenants/${approvalSlug}`)
    await choose(page, "PROVISIONING")

    // The panel is inside the form and carries both controls. If either of
    // these is missing the rest of this suite is proving nothing.
    await expect(page.locator("form input[name='confirmTarget']")).toBeVisible()
    await expect(page.locator("form input[name='riskDigest']")).toHaveCount(1)

    await page.fill("#approvedBy", SECOND_OPERATOR)
    // `required` is dropped rather than honoured, because that is what a POST to
    // the action's id looks like: the browser attribute is a courtesy, and the
    // question is whether the SERVER refuses.
    await page.evaluate(() => {
      document.querySelector("input[name='confirmTarget']")?.removeAttribute("required")
    })

    messages.notTyped = await submitAndReadRefusal(page, "PROVISIONING")
    expect(messages.notTyped).toMatch(/Type .* exactly to confirm/i)
  })

  test("it refuses a digest that is not the consequence that would run", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${approvalSlug}`)
    await choose(page, "PROVISIONING")

    await page.fill("input[name='confirmTarget']", approvalSlug)
    await page.fill("#approvedBy", SECOND_OPERATOR)
    // An approver who read a DIFFERENT consequence did not approve this one.
    // Rewriting the hidden field is exactly what a stale page — or a hand-built
    // POST — presents to the server.
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("input[name='riskDigest']")
      if (input) input.value = "00000000000000000000000000000000"
    })

    messages.staleDigest = await submitAndReadRefusal(page, "PROVISIONING")
    expect(messages.staleDigest).toMatch(/consequence changed/i)
  })

  test("it refuses an operator approving their own move", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${approvalSlug}`)
    await choose(page, "PROVISIONING")

    await page.fill("input[name='confirmTarget']", approvalSlug)
    // Separation of duties. The person who asked is not the person who agrees.
    await page.fill("#approvedBy", OPERATOR)

    messages.selfApproval = await submitAndReadRefusal(page, "PROVISIONING")
    expect(messages.selfApproval).toMatch(/cannot approve their own|same|self/i)
  })

  test("it refuses an approver the allowlist does not know", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${approvalSlug}`)
    await choose(page, "PROVISIONING")

    await page.fill("input[name='confirmTarget']", approvalSlug)
    // Not our own address, and not anybody's: before the lookup existed this
    // satisfied the whole approval check.
    await page.fill("#approvedBy", STRANGER)

    messages.stranger = await submitAndReadRefusal(page, "PROVISIONING")
    expect(messages.stranger).toMatch(/not verified as a platform operator|allowlist|operator/i)
  })

  test("it refuses to perform the destructive AWS mutation, and hands over the command", async ({
    page,
  }) => {
    await signIn(page)
    await compose(page, purgeSlug)
    // DRAFT -> OFFBOARDING needs a successor owner, and nothing else.
    await advance(page, purgeSlug, "OFFBOARDING", SECOND_OPERATOR)
    await advance(page, purgeSlug, "PURGE_PENDING")

    await page.goto(`/tenants/${purgeSlug}`)
    await choose(page, "PURGING")

    // Everything else correct: the target typed, the digest as rendered, and a
    // second allowlisted approver. The only thing wrong with this request is
    // that the console will not do it.
    await page.fill("input[name='confirmTarget']", purgeSlug)
    await page.fill("#approvedBy", SECOND_OPERATOR)

    messages.destructive = await submitAndReadRefusal(page, "PURGING")
    expect(messages.destructive).toContain("REFUSED_IRREVERSIBLE")
    // The remedy travels with the refusal, naming the real table.
    expect(messages.destructive).toContain("aws dynamodb")
    expect(messages.destructive).toContain(purgeSlug)
  })

  test("the five refusals do not share a message", async () => {
    // The assertion the other five exist for. A gate whose arms all say "not
    // allowed" is a gate a test cannot tell from a gate that stopped working.
    const said = Object.values(messages)
    expect(said.length, "an earlier case did not record its refusal").toBe(5)
    expect(new Set(said).size).toBe(5)
  })

  test("every attempt is on the audit ledger, refusals included, and the chain links", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(`/tenants/${approvalSlug}`)

    const rows = page.locator("[data-testid='audit-ledger'] tbody tr")
    // Four refused attempts against this tenant, each an intent row and an
    // outcome row, on top of the three moves that were allowed. The exact
    // number matters less than the fact that a REFUSAL is here at all: the
    // lifecycle's own STEP# rows record only what succeeded.
    await expect(rows.first()).toBeVisible()
    const seen = await rows.count()
    expect(seen).toBeGreaterThan(4)

    await expect(
      page.locator("[data-testid='audit-ledger'] [data-audit-outcome='REFUSED_CONFIRMATION']").first(),
    ).toBeVisible()

    // The chain. Rendered newest-first, so each row's previousHash is the hash
    // of the row BELOW it. A dropped row breaks this, which is the whole point
    // of writing a hash chain rather than a table of events.
    //
    // `[data-audit-hash]` rather than `td[data-audit-hash]`. The ledger is now
    // rendered through `components/md3/DataTable`, which owns the `<td>` and
    // takes each cell's CONTENT from the caller — so the chain attributes moved
    // one element in, onto the span inside the cell. Nothing else changed: this
    // still reads every rendered chain link, still expects one per row, and
    // still fails if a row is dropped. Dropping the `td` widens what the
    // selector may match and narrows nothing.
    const links = await page.locator("[data-testid='audit-ledger'] [data-audit-hash]").evaluateAll(
      (cells) =>
        cells.map((c) => ({
          hash: c.getAttribute("data-audit-hash") ?? "",
          previous: c.getAttribute("data-audit-previous") ?? "",
        })),
    )
    expect(links.length).toBeGreaterThan(1)
    for (let i = 0; i < links.length - 1; i++) {
      expect(links[i].previous, `row ${i} does not chain onto row ${i + 1}`).toBe(links[i + 1].hash)
    }
  })
})
