import { test, expect, type Page } from "@playwright/test"

import fs from "fs"
import path from "path"

import { operatorFor } from "./operator-identity"

/**
 * `/platform/data`, in a browser, against an estate this console cannot reach.
 *
 * ── What this file is for, that the other two suites cannot see ─────────────
 *
 * `src/app/platform/data/answer.test.ts` drives every arm of the page's ordering
 * at the node level — a registry with point-in-time recovery off, a bucket S3
 * calls public, a forced RDS apply date — none of which can be produced from a
 * browser. `e2e/layout.spec.ts` measures geometry, but only for the routes in
 * its own `ROUTES` array, and `/platform/data` is not in it: a navigation agent
 * adds the route to the nav after this page lands, and editing that shared array
 * from here is how two agents collide on one file. So the geometry this route
 * must satisfy is measured HERE, at the same four widths and with the same two
 * assertions, until the route joins that array.
 *
 * What is left is the part only a real render shows:
 *
 *   1. **It boots with no AWS credentials at all.** This suite runs against a
 *      Studio whose credential chain cannot reach an AWS endpoint, so every read
 *      on this page lands in a valueless arm of `AwsRead`. A page that 500s for
 *      want of STS fails the heading assertion, which is the point of it.
 *
 *   2. **What it renders in that state is a NAMED unknown, not an empty table.**
 *      This is the whole thesis of the surface. `UnknownState` carries the
 *      principal, the action and a pasteable statement; an `EmptyState` carries
 *      "there is nothing". Asserting the first is present is weak. Asserting the
 *      second is ABSENT, on a page where nothing answered, is the assertion that
 *      catches a reader silently degrading a refusal into `[]`.
 *
 *   3. **The verdict cannot read "Protected" while anything went unread.** The
 *      guard lives in `verdictOf` and `answer.test.ts` proves it in isolation.
 *      This proves the rendered page is actually wired to it — a page that
 *      computed the verdict correctly and then printed a hard-coded badge would
 *      pass every unit test in the repository.
 *
 * The invariants are written so they hold in BOTH estates: run against an
 * account that answers, (2) and (3) still hold, because they are conditioned on
 * what the page itself reports rather than on an assumed environment. A spec
 * that only passes with no credentials is a spec that starts failing the day the
 * console gets some.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = OPERATOR !== "" && SECRET !== ""

const ROUTE = "/platform/data"

/** The widths `layout.spec.ts` uses. 320 is WCAG 2.2 AA 1.4.10 reflow, not a phone. */
const WIDTHS = [1440, 1180, 900, 320]

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

async function openData(page: Page) {
  await signIn(page)
  await page.goto(ROUTE)
  await page.waitForLoadState("networkidle")
}

/* ═════════════════════════════════════════════ 1. it renders without AWS ══ */

test.describe("the data protection surface", () => {
  test.skip(!configured, "needs PLATFORM_OPERATORS and PLATFORM_OPERATOR_SECRET")

  test("it boots without AWS, and leads with the question in words", async ({ page }) => {
    await openData(page)

    // If the console had 500'd for want of STS, this is the line that fails.
    await expect(page.getByRole("heading", { name: "Data", level: 1 })).toBeVisible()

    // The question the route answers, before any apparatus that answers it.
    const question = page.getByTestId("page-question")
    await expect(question).toBeVisible()
    await expect(question).toHaveText(
      /Where does this platform keep state, is it protected, and is anything about to interrupt it\?/,
    )

    // Every card the requirement names, by its own heading. A card that failed
    // to render because its reader threw would take its heading with it.
    for (const heading of [
      "Protection",
      "About to interrupt",
      "The tenant registry, and the tables around it",
      "Object storage",
      "Cache",
      "Restore points",
      "Where this came from",
    ]) {
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
        `the "${heading}" card should render`,
      ).toBeVisible()
    }

    // The answer is a sentence, not a number. It is the first thing under the
    // verdict badge and it is never blank.
    const headline = page.getByTestId("protection-headline")
    await expect(headline).toBeVisible()
    expect((await headline.innerText()).trim().length).toBeGreaterThan(40)
  })

  /* ══════════════════════════════════ 2. a refusal is not an empty table ══ */

  test("a read that did not answer renders as a named unknown, never as an empty list", async ({
    page,
  }) => {
    await openData(page)

    const unknowns = page.locator(".md3-unknown")
    const empties = page.locator(".md3-empty")
    const unknownCount = await unknowns.count()

    if (unknownCount === 0) {
      // The estate answered everything. Then the page must NOT be claiming that
      // reads went unanswered — the two statements are the same fact and this
      // catches them disagreeing.
      await expect(page.getByTestId("incomplete")).toHaveCount(0)
      return
    }

    /*
     * Something went unread. Two things must hold, and the second is the one
     * with teeth.
     *
     * Every unknown must NAME what it could not do. `UnknownState` renders the
     * action and, for a denial, the principal and a pasteable statement; a panel
     * that rendered the word "Unknown" over a blank body would satisfy a
     * visibility check and tell an operator nothing.
     */
    for (let i = 0; i < unknownCount; i += 1) {
      const panel = unknowns.nth(i)
      await expect(panel).toHaveAttribute("role", "status")
      const text = await panel.innerText()
      expect(text, "an unknown panel must say what it is").toMatch(/Unknown/i)
      expect(
        text.trim().length,
        "an unknown panel must carry a remedy, not just the word",
      ).toBeGreaterThan(40)
    }

    /*
     * THE ASSERTION THIS FILE EXISTS FOR.
     *
     * On a page where reads did not answer, no card may be showing an
     * EmptyState — "we looked and there is nothing" — because nothing looked.
     * This is the exact defect `lib/aws/read.ts` was built against, one layer up
     * where the type can no longer enforce it: a reader that turned a denial
     * into `[]` would render a calm, empty, entirely wrong table here and every
     * other check on this page would still pass.
     */
    await expect(page.getByTestId("incomplete")).toBeVisible()
    expect(
      await empties.count(),
      "no card may claim emptiness on a page that reports unanswered reads",
    ).toBe(0)
  })

  /* ════════════════════════════ 3. the guard, proven through the render ══ */

  test("the verdict never reads Protected while the page reports an unanswered read", async ({
    page,
  }) => {
    await openData(page)

    const protection = page.locator("#protection")
    await expect(protection).toBeVisible()

    const verdictWord = (await protection.locator(".md3-badge").first().innerText()).trim()
    const incomplete = await page.getByTestId("incomplete").count()

    if (incomplete > 0) {
      // The load-bearing line. `verdictOf` refuses PROTECTED while `unknowns` is
      // non-empty; this proves the badge an operator actually reads is wired to
      // that refusal and is not computed a second time in the render.
      expect(
        verdictWord,
        "a page reporting unanswered reads must not badge itself Protected",
      ).not.toBe("Protected")

      // And the headline must say so in words, not only in a badge — the badge
      // is one word and a word is not an explanation.
      const headline = await page.getByTestId("protection-headline").innerText()
      expect(headline.toLowerCase()).toMatch(/cannot say|did not answer|floor of what is wrong/)
    } else {
      // Nothing went unread, so "Protected" is a claim the page is allowed to
      // make — but only from the closed vocabulary, never from free text.
      expect([
        "Registry unrecoverable",
        "Open to the internet",
        "No restore point",
        "Not encrypted",
        "Interruption forced",
        "No failover",
        "Deletable",
        "Not known",
        "Routine",
        "Protected",
      ]).toContain(verdictWord)
    }
  })

  /* ═══════════════════════════════════════════════════════ 4. geometry ══ */

  for (const width of WIDTHS) {
    test(`it fits its container at ${width}px with no sideways page scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openData(page)
      await expect(page.getByRole("heading", { name: "Data", level: 1 })).toBeVisible()

      // (a) The page itself never scrolls sideways. WCAG 2.2 AA 1.4.10 at 320.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(
        overflow.scrollWidth,
        `the page scrolls sideways at ${width}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1)

      /*
       * (b) Nothing escapes its card. A wide table is allowed to scroll INSIDE
       * its own container — that is the designed behaviour — so the check walks
       * cards and asks whether their content escapes the card box, skipping any
       * ancestor that is itself a scroll container. A 63-character bucket name
       * or an inline IAM statement is exactly the content that does this.
       */
      const escaped = await page.evaluate(() => {
        const bad: string[] = []
        for (const card of Array.from(document.querySelectorAll("[data-surface='data'] .md3-card"))) {
          const box = card.getBoundingClientRect()
          for (const child of Array.from(card.querySelectorAll("*"))) {
            const el = child as HTMLElement
            if (!el.textContent?.trim()) continue
            // Inside a scroller: overflowing it is the intended design.
            let inScroller = false
            for (let p = el.parentElement; p && p !== card; p = p.parentElement) {
              const overflowX = getComputedStyle(p).overflowX
              if (overflowX === "auto" || overflowX === "scroll") {
                inScroller = true
                break
              }
            }
            if (inScroller) continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue
            if (r.right > box.right + 1 || r.left < box.left - 1) {
              bad.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 40)}"`)
            }
          }
        }
        return bad.slice(0, 8)
      })
      expect(escaped, `content escapes its card at ${width}px`).toEqual([])
    })
  }
})

/* ══════════════════════════════════════════ 5. the stylesheet's own rule ══ */

/**
 * The route's stylesheet may hold geometry and nothing else.
 *
 * `data.module.css` says so in its own header comment, and a comment is not a
 * check. A colour set here is a colour `e2e/preferences.spec.ts`'s contrast
 * audit cannot see, because that audit reads the token layer — which is exactly
 * why the rule exists and exactly why breaking it is invisible.
 *
 * Runs without a browser and without a server: it reads the file.
 */
test("the route stylesheet declares no colour of its own", () => {
  const file = path.join(__dirname, "..", "src", "app", "platform", "data", "data.module.css")
  const css = fs.readFileSync(file, "utf8")
  // Comments carry prose about colour; the rule is about declarations.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "")

  const literals = [
    /#[0-9a-fA-F]{3,8}\b/g,
    /\brgba?\(/g,
    /\bhsla?\(/g,
    /\boklch\(/g,
    /\bcolor-mix\(/g,
  ]
  for (const pattern of literals) {
    expect(
      declarations.match(pattern) ?? [],
      `data.module.css must not contain ${pattern.source} — colour is the token layer's answer`,
    ).toEqual([])
  }

  // Every custom property it reads must be a declared token, not one invented here.
  expect(declarations).not.toMatch(/^\s*--[\w-]+\s*:/m)
})
