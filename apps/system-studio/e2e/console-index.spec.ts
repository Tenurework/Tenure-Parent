import { test, expect, type Page } from "@playwright/test"
import fs from "fs"
import path from "path"

import { operatorFor } from "./operator-identity"

/**
 * `/` — the console index, as a structure rather than as a wall of rows.
 *
 * `layout.spec.ts` already measures this route's geometry (overlap, overflow,
 * DOM budget, RTL) and `preferences.spec.ts` measures its contrast in eight
 * theme/density/contrast combinations. Neither of them asserts a single thing
 * about what the page SAYS, which is how this route accumulated three
 * organisations that do not exist, a catalog of twenty-five unbuilt connectors
 * above the one real pilot, and no timestamp anywhere.
 *
 * So these are about content and order:
 *
 *   1. the answer leads — the system cards come before the apparatus they are
 *      assembled from;
 *   2. no fixture tenant is rendered as a customer;
 *   3. every panel says what it is AS OF;
 *   4. an unknown is named as UNKNOWN, and never defaulted or left blank;
 *   5. the page contains no literal colour and no legacy ad-hoc class — the
 *      Material 3 adoption, checked in source rather than described;
 *   6. the two disclosures work and are honest about what they are holding back.
 *
 * Every one of these was proven by mutation before it was committed; the
 * mutations are recorded in the session result rather than in comments here,
 * because a comment claiming a test fails is not evidence that it does.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

/**
 * The engine version this SERVER was given.
 *
 * Read from the Playwright process's own environment, which the Studio suite
 * requires to be the same environment the server was started in (there is no
 * `webServer` block; the operator env has to reach both). That is what makes
 * assertion 4 a comparison rather than a tautology: the page must print this
 * value, or print UNKNOWN when there is none — never a default, and never a
 * blank.
 */
const ENGINE_VERSION = (process.env.ENGINE_VERSION ?? process.env.SCHEMA_VERSION ?? "").trim()

test.beforeAll(() => {
  expect(OPERATOR, "PLATFORM_OPERATORS must be set").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set").not.toBe("")
})

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()

  // The session cookie, not `networkidle`. The credentials submit is a client
  // POST to `/api/auth/callback/operator`, and on a cold server the network can
  // go idle before that request has even been issued — every assertion after it
  // then runs against the sign-in form and fails for a reason that has nothing
  // to do with what is being tested. Waiting for the artefact the sign-in
  // PRODUCES is the only wait that cannot pass early.
  await expect
    .poll(
      async () => (await page.context().cookies()).some((c) => c.name.includes("session-token")),
      { timeout: 30_000, message: "no session cookie was ever set — the sign-in did not happen" },
    )
    .toBe(true)

  // The click settles on the auth callback, which returns no HTML.
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. The answer leads.
 */

test("the systems come before the catalog they are assembled from", async ({ page }) => {
  await signIn(page)

  // Document order, measured as vertical position, so a restyle that moves the
  // catalog back to the top with the markup unchanged still fails.
  const summary = await page.locator("#summary").boundingBox()
  const system = await page.getByRole("heading", { name: /Ainslie OSE/ }).boundingBox()
  const catalog = await page.locator("#catalog").boundingBox()

  expect(summary, "the summary card is missing").not.toBeNull()
  expect(system, "the pilot's card is missing").not.toBeNull()
  expect(catalog, "the catalog card is missing").not.toBeNull()

  expect(summary!.y, "the summary is not first").toBeLessThan(system!.y)
  expect(
    system!.y,
    "the integration catalog is drawn above the systems. An operator opening this page came to " +
      "find out what the configured systems are; twenty-five refusals about connectors nobody " +
      "has built is the apparatus, and it goes underneath.",
  ).toBeLessThan(catalog!.y)
})

test("the summary states the count, the verdict and nothing it has not checked", async ({
  page,
}) => {
  await signIn(page)
  const summary = page.locator("#summary")

  await expect(summary).toContainText(/\d+ organization system/)
  // The verdict badge is a WORD, not a colour (Bible 26.3.2).
  await expect(summary.locator(".md3-badge")).toHaveText(/all resolved|with problems|broken/i)
  // All three counts, including the zeroes: "checked and found none" and "not
  // checked" are different facts and only one of them may be silent.
  await expect(summary).toContainText(/\d+ resolved cleanly/)
  await expect(summary).toContainText(/\d+ with configuration problems/)
  await expect(summary).toContainText(/\d+ broken/)
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 1b. The page's actual question: is each system WHERE IT SHOULD BE?
 *
 * The four assertions below are the ones the route was missing entirely. The
 * page listed what was configured and said nothing about whether any of it was
 * anywhere — no lifecycle state, no address, and no comparison against the live
 * AWS estate. An operator could read the whole thing and still not know whether
 * the pilot was running.
 */

test("the answer is a sentence at the top, before any apparatus", async ({ page }) => {
  await signIn(page)

  const answer = page.getByTestId("fleet-answer")
  await expect(answer, "the page does not lead with the state of the fleet").toHaveCount(1)

  const text = (await answer.innerText()).trim()
  // A sentence, not a status word. Six verdicts compressed into one coloured
  // token is the shape that made "unknown" look like "fine".
  expect(text.split(/\s+/).length, `"${text}" is not a sentence`).toBeGreaterThan(6)
  expect(text).toMatch(/configured system/)

  // Above the first system card, and above the catalog.
  const answerBox = await answer.boundingBox()
  const system = await page.getByRole("heading", { name: /Ainslie OSE/ }).boundingBox()
  expect(answerBox!.y).toBeLessThan(system!.y)
})

test("every configured system is in exactly one bucket, and the buckets add up", async ({
  page,
}) => {
  await signIn(page)
  const summary = page.locator("#summary")

  // The placement chips are the first `.chips` row in the summary; the
  // configuration chips are the second and count a different axis.
  const chips = await summary.locator(".chips").first().locator(".md3-chip").allInnerTexts()
  expect(chips.length, "the summary carries no placement counts").toBeGreaterThanOrEqual(5)

  const summed = chips.reduce((total, chip) => {
    const n = Number(chip.trim().split(/\s+/)[0])
    expect(Number.isFinite(n), `"${chip}" does not start with a count`).toBe(true)
    return total + n
  }, 0)

  const headline = await summary.locator(".md3-card-headline").first().innerText()
  const configured = Number(headline.match(/(\d+) organization system/)![1])

  expect(
    summed,
    "the placement buckets do not add up to the number of configured systems. A system whose " +
      "state could not be read has been dropped from the count rather than counted as UNKNOWN.",
  ).toBe(configured)
})

test("each system states its lifecycle, its blueprint, its address and its AWS footprint", async ({
  page,
}) => {
  await signIn(page)

  const card = page.locator("main .md3-card").filter({ hasText: "Ainslie OSE" }).first()
  await expect(card).toHaveCount(1)

  for (const label of ["Lifecycle state", "Blueprint", "Served at", "Live AWS footprint"]) {
    const row = card.locator("tr").filter({ hasText: label }).first()
    expect(
      await card.locator("tr").filter({ hasText: label }).count(),
      `"${label}" is not on the system's card — the page cannot answer whether the system is ` +
        `where it should be without it`,
    ).toBeGreaterThan(0)

    const value = (await row.locator("td").last().innerText()).trim()
    expect(value, `"${label}" rendered blank`).not.toBe("")
    // A dash is a character an operator has to interpret, and its two readings
    // — nothing was recorded, and nothing is required — are different facts.
    expect(value, `"${label}" rendered as a dash`).not.toMatch(/^[—–-]$/)

    // An UNKNOWN with no remedy is a dead end. Every one on this page is paired
    // with the sentence that says what would make it known.
    if (value.includes("UNKNOWN")) {
      expect(
        value.split(/\s+/).length,
        `"${label}" says UNKNOWN and stops. Say what would make it known.`,
      ).toBeGreaterThan(6)
    }
  }
})

test("a system's verdict is a word an operator can act on, never a colour alone", async ({
  page,
}) => {
  await signIn(page)

  const card = page.locator("main .md3-card").filter({ hasText: "Ainslie OSE" }).first()
  const badge = card.locator(".md3-badge").first()

  await expect(badge).toHaveText(
    /where it should be|not where it should be|not deployed|not registered|UNKNOWN|broken/,
  )
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 2. No fixture tenant is rendered as a customer.
 */

test("no organisation that does not exist is drawn beside the pilot", async ({ page }) => {
  await signIn(page)

  const body = await page.evaluate(() => document.body.innerText)

  // The pilot is present — an absence assertion over a page that rendered
  // nothing would pass on a blank screen.
  expect(body, "the real pilot is not on the page").toContain("Ainslie OSE")

  for (const fixture of ["Midtown Arts", "Right-to-left conventions", "External-ERP coexistence"]) {
    expect(
      body,
      `"${fixture}" is a fixture — an organisation that does not exist. Rendering it here is ` +
        `where somebody advances a lifecycle on one. Use CUSTOMER_TENANT_BINDINGS.`,
    ).not.toContain(fixture)
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. Every panel says what it is as of.
 */

test("every card carries a machine-readable timestamp", async ({ page }) => {
  await signIn(page)

  const cards = page.locator("main .md3-card")
  const count = await cards.count()
  expect(count, "the page rendered no cards at all").toBeGreaterThanOrEqual(3)

  const missing: string[] = []
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i)
    const stamps = await card.locator("time[datetime]").count()
    if (stamps === 0) {
      missing.push((await card.locator(".md3-card-headline").first().innerText()).slice(0, 48))
    }
  }
  expect(
    missing,
    "these panels do not say when they were read. A console that prints a verdict without an " +
      "as-of is a console an operator cannot tell apart from a cached one.",
  ).toEqual([])
})

test("the stamp is UTC and comparable, not a locale rendering", async ({ page }) => {
  await signIn(page)
  const shown = await page.locator("main time[datetime]").first().innerText()
  expect(shown, `"${shown}" is not YYYY-MM-DD HH:MM UTC`).toMatch(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/,
  )
  const machine = await page.locator("main time[datetime]").first().getAttribute("datetime")
  expect(machine).toMatch(/^\d{4}-\d{2}-\d{2}T/)
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 4. An unknown is named, never defaulted and never blank.
 */

test("the scope prints the engine version it was given, or UNKNOWN", async ({ page }) => {
  await signIn(page)
  const catalog = page.locator("#catalog")

  const chip = catalog.locator(".md3-chip", { hasText: /^engine / })
  await expect(chip, "there is no engine chip in the catalog's scope").toHaveCount(1)

  const text = (await chip.innerText()).replace(/^engine\s+/, "").trim()
  expect(text, "the engine chip is blank — an empty value is not an answer").not.toBe("")

  if (ENGINE_VERSION) {
    expect(text).toBe(ENGINE_VERSION)
    // The remedy paragraph belongs only to the case that needs it.
    await expect(catalog).not.toContainText("The engine version is UNKNOWN")
  } else {
    expect(text).toBe("UNKNOWN")
    // Not just the word: the sentence that says what to set, because "UNKNOWN"
    // with no remedy is a dead end.
    await expect(catalog).toContainText("The engine version is UNKNOWN")
    await expect(catalog).toContainText("ENGINE_VERSION")
  }
})

test("no scope chip is left blank", async ({ page }) => {
  await signIn(page)
  const chips = page.locator("#catalog .md3-chip")
  const texts = await chips.allInnerTexts()
  expect(texts.length).toBeGreaterThanOrEqual(4)
  const blank = texts.filter((t) => /^(region|partition|engine)\s*$/.test(t.trim()))
  expect(blank, "a scope label with no value after it").toEqual([])
})

test("a refusal always carries an explanation, never a bare status word", async ({ page }) => {
  await signIn(page)
  const items = page.locator("#catalog ul li")
  const count = await items.count()
  expect(count, "no refusal rows rendered").toBeGreaterThan(0)

  const thin: string[] = []
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).innerText()).trim()
    // key + badge + one sentence. A row that stops after the status word is the
    // defect: the reason code alone sends an operator nowhere.
    if (text.split(/\s+/).length < 8) thin.push(text)
  }
  expect(thin, "these refusals say a status and nothing else").toEqual([])
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 5. The Material 3 adoption, checked in the source.
 *
 * The rendered-page checks above cannot see a hex that happens to resolve to
 * the same colour the token would, and `preferences.spec.ts` cannot see one in
 * a branch that did not render. This reads the file.
 */

const PAGE = path.join(__dirname, "..", "src", "app", "page.tsx")

/** Source with comments removed, so a guard cannot fire on the prose about it. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

test.describe("the index consumes the design system rather than restating it", () => {
  test("the file being scanned is the real one", () => {
    // An absence check over an empty file passes on every input.
    expect(code(PAGE).length, "page.tsx has stopped being read").toBeGreaterThan(4000)
  })

  test("no literal colour, in any syntax", () => {
    const source = code(PAGE)
    const offences: string[] = []
    for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) offences.push(match[0])
    for (const match of source.matchAll(
      /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|light-dark)\s*\(/g,
    )) {
      offences.push(`${match[1]}(`)
    }
    expect(
      offences,
      "A raw colour in a product module is a pair the token audit does not know exists. Name a " +
        "--md-sys-color-* role through a primitive instead.",
    ).toEqual([])
  })

  test("no inline style attribute", () => {
    // `style={{ display: "contents" }}` is what the `dl` this page used to draw
    // needed, and an inline style is where a colour hides once it is a variable.
    expect(/\bstyle\s*=\s*\{/.test(code(PAGE))).toBe(false)
  })

  test("no legacy ad-hoc class from before the primitives existed", () => {
    const source = code(PAGE)
    // `.chips` is deliberately absent from this list and deliberately still
    // used: it is a pure layout utility in globals.css (flex, wrap, gap) with
    // no colour, no size and no shape in it, and this page may not add CSS of
    // its own. Every name below carries a colour, a size or a border that a
    // primitive now owns.
    const legacy = [
      "system",
      "slug",
      "badge",
      "chip",
      "grid",
      "kv",
      "refused",
      "error",
      "misconfigured",
      "id",
      "num",
    ]
    const offences: string[] = []
    for (const match of source.matchAll(/className="([^"]+)"/g)) {
      for (const name of match[1].split(/\s+/)) {
        if (legacy.includes(name)) offences.push(name)
      }
    }
    expect(
      offences,
      "these class names predate components/md3 and carry their own colours and sizes. Use the " +
        "primitive that owns the role.",
    ).toEqual([])
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 6. The disclosures, and the honesty of what they hold back.
 */

test("a system's detail opens from its own card and closes back", async ({ page }) => {
  await signIn(page)

  const toggle = page.getByTestId("detail-rochester")
  await expect(toggle).toContainText(/Show all \d+ configuration values/)
  await toggle.click()
  await page.waitForLoadState("networkidle")

  await expect(page).toHaveURL(/\?show=rochester/)
  // The three things the disclosure exists to carry, each named in its caption.
  await expect(page.locator("caption", { hasText: /^Configuration —/ })).toBeVisible()
  await expect(page.locator("caption", { hasText: /^Payments capabilities —/ })).toBeVisible()
  await expect(page.locator("caption", { hasText: /^Module limitations —/ })).toBeVisible()

  await page.getByTestId("detail-rochester").click()
  await page.waitForLoadState("networkidle")
  await expect(page.locator("caption", { hasText: /^Configuration —/ })).toHaveCount(0)
})

test("a truncated list says how much of it is being held back", async ({ page }) => {
  await signIn(page)

  const refusals = page.getByTestId("catalog-count")
  await expect(refusals).toContainText(/Showing \d+ of \d+ refusals/)
  const capabilities = page.getByTestId("capability-count")
  await expect(capabilities).toContainText(/Showing \d+ of \d+ capability rows/)

  await refusals.getByRole("link").click()
  await page.waitForLoadState("networkidle")
  await expect(page.getByTestId("catalog-count")).toContainText(/All \d+ refusals shown/)
  await expect(page.getByTestId("capability-count")).toContainText(/All \d+ capability rows shown/)
})

test("every table says what it is, in a visible caption", async ({ page }) => {
  await signIn(page)
  const tables = page.locator("main table")
  const count = await tables.count()
  expect(count, "the page drew no tables").toBeGreaterThan(0)

  for (let i = 0; i < count; i++) {
    const caption = tables.nth(i).locator("caption")
    await expect(caption, `table ${i} has no caption`).toHaveCount(1)
    expect((await caption.innerText()).trim().length).toBeGreaterThan(4)
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * The two disclosure URLs are not in `layout.spec.ts`'s route list, and they are
 * where this page is widest. WCAG 2.2 AA 1.4.10.
 */
for (const route of ["/?show=rochester", "/?show=catalog"]) {
  test(`${route} does not scroll the page sideways at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 })
    await signIn(page)
    await page.goto(route)
    await page.waitForLoadState("networkidle")

    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(sideways, "the page scrolls sideways — a wide table must scroll inside its own shell").toBe(
      false,
    )
  })
}
