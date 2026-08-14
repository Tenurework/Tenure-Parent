import { test, expect } from "@playwright/test"
import { operatorFor } from "./operator-identity"

import truth from "../src/generated/platform-truth.json"
// The capability registry is a plain TypeScript object with no SDK import and
// no `node:` builtin, so a Playwright spec can read it directly — which is the
// point: the page and this spec count out of the same closed list, and a number
// written into either would drift from it the next time a capability landed.
import { ALL_CAPABILITIES, CAPABILITIES } from "../src/lib/aws/capabilities"

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

  test("shows connector setup references without credential values", async ({ page }) => {
    await signIn(page)

    await expect(page.getByRole("heading", { name: "Setup references — 4" })).toBeVisible()
    await expect(page.getByRole("cell", { name: "slack.workspace", exact: true }).first()).toBeVisible()
    for (const name of ["SLACK_APP_ID", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"]) {
      await expect(page.getByRole("cell", { name, exact: true })).toBeVisible()
    }

    const body = await page.locator("body").innerText()
    expect(body).not.toMatch(/\bxox[abposr]-/)
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
    //
    // `.md3-badge`, not `.badge`. The class changed because the page did: the
    // ad-hoc `.badge` rule in `globals.css` hand-sets an 11px font size and its
    // own pill geometry, and `/platform` now uses the `Badge` primitive from
    // `components/md3/` like every other Material 3 surface. The ASSERTION is
    // unchanged — same element, same two numbers, same reason for scoping to
    // it. Only the selector follows the component.
    await expect(page.locator(".md3-badge", { hasText: `${programme.decided} of ${programme.totalItems}` })).toBeVisible()
    const percent = ((programme.decided / programme.totalItems) * 100).toFixed(1)
    await expect(page.locator(".md3-badge", { hasText: `${percent}%` })).toBeVisible()

    // `progressbar`, not `meter`. The bar was a `<div role="meter">` whose fill
    // was an inline `style={{ inlineSize }}`; it is now the `ProgressIndicator`
    // primitive, which is a real `<progress value max>`. Both halves of the
    // change are the reason: an inline style in a product module is the hole a
    // literal colour arrives through, and `meter` is the wrong role — a meter
    // is a static gauge within a known range and this is progress toward
    // completion. The ASSERTION is unchanged: same element, same percentage,
    // still required to be visible. Only the role and the accessible name
    // follow the component, and the number moved from the name to
    // `aria-valuetext`, which is where a progressbar carries it.
    const bar = page.getByRole("progressbar", { name: "Programme settled" })
    await expect(bar).toBeVisible()
    await expect(bar).toHaveAttribute("aria-valuetext", `${percent}%`)
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
    for (const source of ["CFG", "CAT", "ANL"]) {
      const rows = programme.phases.filter((p) => p.source === source)
      const items = rows.reduce((n, p) => n + p.items, 0)
      const decided = rows.reduce((n, p) => n + p.done, 0)
      await expect(page.getByRole("row", { name: new RegExp(`^${source}\\b.*${((decided / items) * 100).toFixed(1)}%`) })).toBeVisible()
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

  /* ───────────────────────────────────────────────────────────────────────
   * The question this page answers, and the four panels that answer it.
   *
   * Everything below asserts a property that survives running with or without
   * AWS credentials, because CI has none and a deployed console has some. An
   * assertion that only holds in one of those is an assertion that will be
   * deleted the first time it fails in the other.
   */

  test("leads with the question, in words, before any apparatus", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    const heading = page.getByRole("heading", { name: "Platform", exact: true })
    await expect(heading).toBeVisible()

    // The question is the first thing under the heading. Not "somewhere on the
    // page" — a console that buries its own subject under a table of counts is
    // the layout this page was rebuilt out of.
    const question = page.getByText("Is the engine itself healthy, and what does it currently know?")
    await expect(question).toBeVisible()

    const headingBox = await heading.boundingBox()
    const questionBox = await question.boundingBox()
    expect(headingBox).not.toBeNull()
    expect(questionBox).not.toBeNull()
    expect(questionBox!.y).toBeGreaterThanOrEqual(headingBox!.y)

    // And the answer is above every card. `What this page found` is the first
    // card; the programme table is below it.
    const found = page.getByRole("heading", { name: "What this page found" })
    const programme = page.getByRole("heading", { name: "Where the programme stands" })
    await expect(found).toBeVisible()
    expect((await found.boundingBox())!.y).toBeLessThan((await programme.boundingBox())!.y)
  })

  test("says which commit it is running, or that it is not stamped — never neither", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    await expect(
      page.getByRole("heading", { name: "This build, and the figures compiled into it" }),
    ).toBeVisible()

    // The snapshot's commit is always stated, from the artifact the page imports.
    await expect(page.getByText(truth.commit, { exact: true }).first()).toBeVisible()

    // And the running build is either a commit or a named remedy. The defect
    // this replaces is the third possibility: silence, read as a match.
    const body = await page.locator("body").innerText()
    const stamped = process.env.BUILD_COMMIT?.trim()
    if (stamped) {
      expect(body).toContain(stamped)
    } else {
      expect(body).toContain("BUILD_COMMIT")
      expect(body).toContain("not stamped")
    }
  })

  test("names every refused read with the statement that would grant it", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    await expect(
      page.getByRole("heading", { name: "What this engine may read, and what it was refused" }),
    ).toBeVisible()

    const denials = truth.estate.deniedCalls
    expect(denials.length).toBeGreaterThan(0)

    const refused = page.getByRole("table", { name: /Every read that was refused/ })
    for (const denial of denials) {
      // The call itself, exactly as the collector recorded it.
      await expect(refused.getByRole("cell", { name: denial.call, exact: true })).toBeVisible()
    }

    // A refusal without a remedy is a refusal that stays. Every refused call
    // this engine declares a capability for renders a pasteable statement; the
    // one it does not declare says so instead of printing a plausible statement
    // that would grant nothing.
    const body = await page.locator("body").innerText()
    expect(body).toContain('"Effect":"Allow"')
    expect(body).toContain("organizations:DescribeOrganization")
    expect(body).toContain("not declared by this engine")

    // And it is never rendered as a zero or an empty list.
    await expect(page.locator(".md3-badge", { hasText: `${denials.length} refused` })).toBeVisible()
  })

  test("counts the reads it declares out of the registry, not out of a number somebody typed", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    // The registry is a closed union compiled into the build, so the page and
    // this spec read the same source. A count written into either would drift
    // from it the next time a capability landed.
    const surfaces = new Set(ALL_CAPABILITIES.map((c) => CAPABILITIES[c].surface))
    const body = await page.locator("body").innerText()
    expect(body).toContain(`${ALL_CAPABILITIES.length} reads are declared`)

    for (const surface of surfaces) {
      await expect(
        page
          .getByRole("table", { name: /What this engine declares it can ask for/ })
          .getByRole("cell", { name: surface, exact: true }),
      ).toBeVisible()
    }

    // Every surface's row states its reads, and the rows account for the whole
    // registry. Read back off the page so the sum is the rendered one.
    // Scoped to the table by its caption. An unscoped row locator would match
    // any row on the page whose first cell happens to start with the same
    // word — "cost" and "health" are surface names AND route names — and a
    // strict-mode violation there would look like a page defect.
    const table = page.getByRole("table", {
      name: /What this engine declares it can ask for/,
    })
    const rendered = await Promise.all(
      [...surfaces].map(async (surface) => {
        const row = table.getByRole("row", { name: new RegExp(`^${surface}\\b`) })
        const cells = await row.getByRole("cell").allInnerTexts()
        return Number(cells[1])
      }),
    )
    expect(rendered.reduce((n, x) => n + x, 0)).toBe(ALL_CAPABILITIES.length)
  })

  test("reports the identity it is running as, or renders UNKNOWN — never a blank", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")

    await expect(
      page.getByRole("heading", { name: "The identity this engine is running as" }),
    ).toBeVisible()

    // CI runs with no AWS credentials and a deployment runs with some, so the
    // property asserted is the one that holds either way: the card states a
    // read state, and when that state is not a reading it carries the governed
    // UNKNOWN block rather than an empty panel.
    const badge = page
      .locator(".md3-badge")
      .filter({ hasText: /^(ACTUAL|STALE|DENIED|THROTTLED|UNCONFIGURED|ERROR|EMPTY)$/ })
    await expect(badge).toBeVisible()
    const state = (await badge.innerText()).trim()

    if (state === "ACTUAL" || state === "STALE") {
      await expect(page.getByText("Account", { exact: true })).toBeVisible()
      await expect(page.getByText("Partition", { exact: true })).toBeVisible()
    } else {
      // The whole point of STUDIO-000-007: not an empty list, not a zero.
      const unknown = page.locator(`.md3-unknown[data-reason="${state}"]`)
      await expect(unknown).toBeVisible()
      await expect(unknown).toContainText("sts:GetCallerIdentity")
    }
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
