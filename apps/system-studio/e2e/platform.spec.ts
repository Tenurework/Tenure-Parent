import { test, expect } from "@playwright/test"
import { operatorFor } from "./operator-identity"

import truth from "../src/generated/platform-truth.json"

/**
 * The Platform console, rendered in a browser.
 *
 * Two distinct things are asserted, and only the second is interesting:
 *
 *   1. the page renders and is behind the operator gate;
 *   2. the numbers on it are the numbers in the generated artifact.
 *
 * (2) is the point. A console that reports progress is worth having only if it
 * cannot report a number nobody generated — the failure mode of a status page
 * is not that it breaks, it is that it quietly keeps showing something
 * plausible. So the expected values come from the same JSON the page imports,
 * and `tools/platform-truth.mjs --check` (asserted in the platform suite) fails
 * the build if that JSON drifts from the ledger and the inventory it is
 * compiled from. The chain is: ledger → generated JSON → page, checked at every
 * link.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  expect(OPERATOR, "PLATFORM_OPERATORS must be set for this suite").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set for this suite").not.toBe("")
})

const browserErrors = new Map<string, string[]>()

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = []
  browserErrors.set(testInfo.testId, errors)
  page.on("pageerror", (err) => {
    errors.push(`${err.name}: ${err.message}`)
  })
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
  })
})

test.afterEach(async ({ page }, testInfo) => {
  const errors = browserErrors.get(testInfo.testId) ?? []
  browserErrors.delete(testInfo.testId)

  const body = await page.locator("body").innerText().catch(() => "")
  expect(body, "Next's client-side exception screen").not.toContain("Application error")
  expect(errors, "uncaught errors in the browser").toEqual([])
})

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
}

test.describe("platform console", () => {
  test("is behind the operator gate", async ({ page }) => {
    // Signed out, it must not render — the estate, the findings and the open
    // gaps are a map of where the platform is weakest.
    await page.goto("/platform")
    await expect(page).toHaveURL(/\/signin/)
    await expect(page.getByRole("heading", { name: "Platform", exact: true })).toHaveCount(0)
  })

  test("is reachable from the systems page, and back", async ({ page }) => {
    await signIn(page)
    await page.getByRole("link", { name: "Platform" }).click()
    await expect(page.getByRole("heading", { name: "Platform", exact: true })).toBeVisible()

    // The nav entry is "Systems"; the page it lands on is headed "Organization
    // systems". This looked for a link by the heading's name and had therefore
    // never passed — nothing ran this suite, so nothing said so. See the CI job
    // added alongside this fix.
    await page.getByRole("link", { name: "Systems", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
  })

  test("reports the programme exactly as the ledger records it", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    const { programme, ledger } = truth

    // The denominator is the whole programme, not the phase currently open.
    // Reporting 14/15 would be true of Phase 0 and misleading about the rest,
    // and this is the assertion that stops it drifting back to that.
    //
    // The numerator is `decided`, not `done`. They differ, and the difference
    // is items settled without being built — blocked on an external dependency,
    // or not applicable. The page states both; the badge carries the larger,
    // because a queue that will never return to an item has finished with it.
    // Scoped to the badge. The paragraph below it states the same two numbers
    // in a sentence, so an unscoped text match resolves to both and fails on
    // strict mode — which is the locator telling the truth, not a nuisance.
    await expect(page.locator(".badge", { hasText: `${programme.decided} of ${programme.totalItems}` })).toBeVisible()
    expect(programme.decided).toBeGreaterThanOrEqual(ledger.done)

    // Both numerators are stated, and they are not the same number. The badge
    // carries `decided`; the sentence separates what is built from what is
    // merely settled. Publishing only the larger would overstate what exists.
    await expect(page.getByText(`${ledger.done} implemented`)).toBeVisible()

    // Four binding execution prompts, not one. This was `toBe(18)` — the phase
    // count of the superseded v1.1 prompt, which the console was still parsing.
    expect(programme.totalItems).toBeGreaterThan(1000)
    expect(programme.phases.length).toBeGreaterThan(100)

    // Grouped by document, because 178 phase rows is a wall. Each of the four
    // is named, with its own totals.
    for (const source of ["GE", "EXT", "STUDIO", "SIMON"]) {
      await expect(page.getByRole("cell", { name: source, exact: true })).toBeVisible()
    }
  })

  test("shows every open finding with the item that owns it", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    const { findings } = truth
    expect(findings.length).toBeGreaterThan(0)

    for (const finding of findings) {
      await expect(page.getByRole("cell", { name: finding.finding, exact: true })).toBeVisible()
    }

    // A finding with no owner is a finding nobody closes.
    for (const finding of findings) {
      expect(finding.owner).toMatch(/^GE-/)
    }
  })

  test("shows the estate, and never the unmasked account id", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    await expect(page.getByRole("heading", { name: "AWS estate" })).toBeVisible()
    await expect(page.getByText(truth.estate.account)).toBeVisible()

    // The console is behind a login, but the masking is done at the point the
    // inventory is written and this proves the page did not undo it.
    const body = await page.locator("body").innerText()
    expect(body, "an unmasked 12-digit AWS account id is rendered").not.toMatch(/\b\d{12}\b/)
  })

  test("names the queues that have no producer and no consumer", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    // This is the clearest infrastructure/code drift in the estate, and the
    // reason it is on the console rather than only in a document: an operator
    // looking at a green dead-letter alarm should be told the queue it watches
    // cannot be written to.
    for (const queue of truth.estate.sqsQueues) {
      await expect(page.getByText(queue, { exact: true })).toBeVisible()
    }
  })
})
