import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * GE-GATE-3 — the configuration engine, exercised end to end instead of
 * described.
 *
 * Every one of the twenty-one items this gate certifies passed on its own.
 * `planPublication`, `commit`, four-eyes approval, the immutability check and
 * the rollback action were all tested — as pure functions, over an
 * `InMemoryConfigStore`. What had never run, in any environment, was the whole
 * path: sign in, edit, review, publish, publish again, roll back, and read the
 * history that comes back out of DynamoDB.
 *
 * It was worth running. **The publish path was dead in the real UI.** React 19
 * resets a form once an action attached to it completes, and every input here
 * was uncontrolled, so "Review the change" wiped the values, the reason and the
 * required approver. The plan still rendered — the action had already read the
 * submitted data — so the screen looked right. Publish was then enabled and did
 * nothing at all: the emptied `required` approver failed HTML5 validation,
 * which blocks submission silently and shows no message. An operator would
 * click Publish, see no error and no confirmation, and click again.
 *
 * Three items were recorded PASS over that: GE-031-006, GE-032-001, GE-032-003.
 * None of them was wrong about what it tested. Nothing exercised a browser, so
 * nothing noticed. That is the exact failure a phase gate exists to catch, and
 * it is why this spec drives the page rather than importing the store.
 *
 * ## Asserted on the history table, not on the success banner
 *
 * The banner is transient: `revalidatePath` re-renders the tree and the action
 * state goes with it. The history table is what persists and what an operator
 * actually reads, so it is what this asserts. A test that waited for a toast
 * would be testing the toast.
 *
 * Skipped without a table, and skipped loudly: a spec that quietly passes when
 * the database is absent is worse than none, because the gate would cite it.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = !!process.env.TENANT_TABLE

/** The tenant this suite publishes against — the one in the registry. */
const SLUG = "rochester"

/** A second identity, because a publication cannot approve itself. */
const APPROVER = "second-operator@tenure.example"

/**
 * A suffix unique to this run.
 *
 * The suite is not idempotent — it publishes into a table that keeps what it
 * publishes — and the first version of this spec used fixed values. Re-run, and
 * the first "change" was identical to what a previous run had already
 * published, so there was nothing to publish and the revision count never
 * moved. The spec failed while the engine was behaving correctly, which is the
 * worst kind of red.
 */
const RUN = process.env.GITHUB_RUN_ID ?? Date.now().toString(36)

/**
 * The field this suite edits.
 *
 * A real key from `PLATFORM_DEFINITIONS`. The first draft of this spec used
 * `identity.sessionMinutes`, which does not exist — a spec that invents a field
 * tests the element-not-found path and calls it coverage.
 */
const FIELD = "platform.terminology.staffOfficeName"
const FIELD_SELECTOR = `#${FIELD.replace(/\./g, "\\.")}`

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
}

async function openConfiguration(page: Page) {
  await page.goto(`/tenants/${SLUG}/configuration`)
  // The registry load streams in; the form means nothing until it has.
  await expect(page.locator(FIELD_SELECTOR)).toBeVisible({ timeout: 20_000 })
}

/**
 * The revisions the history table shows, re-read from the server.
 *
 * Reloads first, deliberately. Publishing calls `revalidatePath`, but the page
 * does not visibly update: the success banner lives in `useActionState`, and
 * the server re-render remounts the editor and takes that state with it. So
 * after a successful publish the operator sees no confirmation and an unchanged
 * history until they navigate — recorded as an open finding against GE-032-003
 * rather than papered over here.
 *
 * Reading after a reload is also the stronger assertion: it is what persisted,
 * not what a component briefly claimed.
 */
async function historyRevisions(page: Page): Promise<number[]> {
  await openConfiguration(page)
  const cells = await page.locator("table tbody tr td:first-child").allTextContents()
  return cells.map((c) => Number(c.trim())).filter((n) => Number.isInteger(n))
}

/** Set the office name, review, publish. Returns the revisions afterwards. */
async function publishOfficeName(page: Page, name: string, reason: string): Promise<number[]> {
  // Counted first. `historyRevisions` reloads, and a reload after the form is
  // filled throws the operator's input away — which is what the first version
  // of this helper did, and it failed at the Publish click with an empty form.
  const before = await historyRevisions(page)

  await page.locator(FIELD_SELECTOR).fill(name)
  await page.fill("#changeReason", reason)
  await page.fill("#approvedBy", APPROVER)

  // Publish is disabled until a review has run. Asserting the transition means
  // a regression that allows publish-without-review shows up here.
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled()
  await page.getByRole("button", { name: "Review the change" }).click()
  await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled({ timeout: 20_000 })

  // The review must not have eaten the operator's input. This is the assertion
  // that fails if the inputs go back to being uncontrolled — the whole publish
  // path dies from here, silently, and this is where it becomes visible.
  await expect(page.locator(FIELD_SELECTOR)).toHaveValue(name)
  await expect(page.locator("#approvedBy")).toHaveValue(APPROVER)

  await page.getByRole("button", { name: "Publish" }).click()

  // Wait for the durable evidence rather than the banner.
  await expect
    .poll(async () => (await historyRevisions(page)).length, { timeout: 30_000 })
    .toBe(before.length + 1)

  return historyRevisions(page)
}

test.describe("configuration publish and rollback, against a real DynamoDB", () => {
  test.skip(!configured, "needs TENANT_TABLE and a reachable DynamoDB")

  test("publishes, publishes again, rolls back, and never rewinds history", async ({ page }) => {
    await signIn(page)
    const before = await historyRevisions(page)

    const afterFirst = await publishOfficeName(
      page,
      `Ainslie Office of Student Engagement ${RUN}`,
      "Full legal name for the letterhead.",
    )
    expect(afterFirst.length).toBe(before.length + 1)

    const afterSecond = await publishOfficeName(page, `Ainslie OSE ${RUN}`, "Shortened after staff feedback.")
    expect(afterSecond.length).toBe(before.length + 2)

    // Ordering read out of the database rather than out of an array, and
    // asserted in the direction the table actually renders: newest first, so
    // the most recent change is the first thing an operator sees.
    //
    // This matters more than presentation. The sort key is zero-padded
    // precisely so revision 10 does not collate before revision 9; unpadded,
    // `latest` silently returns something that is not the latest and "what was
    // live at 14:20" gets a confident wrong answer. Sorted descending here is
    // the ascending Query result reversed for display — either way, a collation
    // bug breaks it.
    expect(afterSecond).toEqual([...afterSecond].sort((a, b) => b - a))

    // Order-independent, so this survives a decision to render oldest-first.
    const live = Math.max(...afterSecond)
    const target = Math.max(...afterSecond.filter((r) => r !== live))

    // ── Roll back ────────────────────────────────────────────────────────
    await openConfiguration(page)
    await page.selectOption("#toRevision", String(target))
    await page.fill("#rollbackApprovedBy", APPROVER)
    await page.getByRole("button", { name: "Roll back" }).click()

    await expect
      .poll(async () => (await historyRevisions(page)).length, { timeout: 20_000 })
      .toBe(afterSecond.length + 1)

    // A rollback is a publication, not a rewind. It takes the NEXT revision
    // number, and every revision it passed over is still on the record — which
    // is what an incident review asking "what was live at 14:20" depends on.
    const rolled = await historyRevisions(page)
    expect(Math.max(...rolled)).toBe(live + 1)
    for (const revision of afterSecond) expect(rolled).toContain(revision)

    // And it restored the values, not merely the revision number.
    await expect(page.locator(FIELD_SELECTOR)).toHaveValue(`Ainslie Office of Student Engagement ${RUN}`)
  })

  test("refuses a publication that approves itself", async ({ page }) => {
    // Four-eyes, at the field where it is easiest to get wrong: a free-text
    // email box next to the button. The operator publishing cannot be the
    // operator approving.
    await signIn(page)
    await openConfiguration(page)

    await page.locator(FIELD_SELECTOR).fill(`Self-approved Office ${RUN}`)
    await page.fill("#changeReason", "Self-approved, which must not be allowed.")
    await page.fill("#approvedBy", OPERATOR)
    await page.getByRole("button", { name: "Review the change" }).click()

    // The refusal must name the reason. "Invalid" would leave an operator
    // during an incident guessing which of nine checks they tripped.
    await expect(page.locator("body")).toContainText(/approv/i, { timeout: 20_000 })
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled()
  })
})
